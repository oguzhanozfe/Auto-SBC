"""Local Auto-SBC service. Club data stays in memory and EA submits stay manual."""
from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from threading import Lock, Thread
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool

from . import logger, setup, planner
from .catalog import Catalog

VERSION = "27.0.0-preview"
ROOT = Path(__file__).resolve().parent.parent
EA_ORIGINS = {"https://www.ea.com", "https://www.easports.com"}
LOCAL_ORIGINS = {"http://127.0.0.1:8000", "http://localhost:8000"}
MAX_BODY_BYTES = 24 * 1024 * 1024


class MarketScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gameYear: Literal[26, 27] | None = None
    platform: Literal["ps5", "pc"] | None = None


class SolveRequest(MarketScope):
    sbcData: dict[str, Any]
    clubPlayers: list[dict[str, Any]] = Field(default_factory=list, max_length=20000)
    maxSolveTime: float = Field(default=15, ge=1, le=120, allow_inf_nan=False)
    solverPolicy: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_pool(self):
        if not self.clubPlayers and self.solverPolicy.get("allowConcept") is not True:
            raise ValueError("Load club players or enable market concepts.")
        return self


class SyncRequest(MarketScope):
    maxPages: int = Field(default=10, ge=1, le=1000)


class ConceptRequest(MarketScope):
    sbcData: dict[str, Any]
    solverPolicy: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=1500, ge=1, le=20000)


def create_app(data_dir=None):
    app = FastAPI(title="Auto-SBC Studio", version=VERSION)
    catalog = Catalog(data_dir=data_dir, game_year=int(os.environ.get("AUTOSBC_GAME_YEAR", "26")),
                      platform=os.environ.get("AUTOSBC_PLATFORM", "ps5"))
    catalogs = {(catalog.game_year, catalog.platform): catalog}
    catalog_lock = Lock()
    def get_catalog(game_year=None, platform=None):
        key = (game_year or catalog.game_year, platform or catalog.platform)
        with catalog_lock:
            if key not in catalogs:
                catalogs[key] = Catalog(data_dir=data_dir, game_year=key[0], platform=key[1])
            return catalogs[key]
    solve_lock = Lock()
    sync_lock = Lock()
    jobs_lock = Lock()
    jobs = {}
    app.state.catalog = catalog
    app.state.get_catalog = get_catalog
    app.state.solve_lock = solve_lock
    app.state.sync_lock = sync_lock
    allowed_origins = EA_ORIGINS | LOCAL_ORIGINS
    port = os.environ.get("AUTOSBC_PORT", "8000")
    allowed_origins |= {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
    app.add_middleware(CORSMiddleware, allow_origins=sorted(allowed_origins),
                       allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
                       allow_credentials=False, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"])
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def guard_request(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in allowed_origins and not re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
            return JSONResponse(status_code=403, content={"detail": "This origin cannot access the local solver."})
        if request.method == "POST":
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid content length."})
            if length > MAX_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "Request is too large."})
            size = 0
            body_parts = []
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BODY_BYTES:
                    return JSONResponse(status_code=413, content={"detail": "Request is too large."})
                body_parts.append(chunk)
            request._body = b"".join(body_parts)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        if request.url.path == "/":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self'; "
                "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
            )
        return response

    @app.get("/")
    def dashboard():
        return FileResponse(ROOT / "backend/static/index.html")

    @app.get("/static/{filename}")
    def static_file(filename: str):
        if filename not in {"app.js", "style.css"}:
            raise HTTPException(404, "File not found")
        return FileResponse(ROOT / "backend/static" / filename)

    @app.get("/health")
    def health(gameYear: int | None = Query(default=None, ge=26, le=27), platform: Literal["ps5", "pc"] | None = None):
        return {"status": "ok", "version": VERSION, "solverBusy": solve_lock.locked(),
                "database": get_catalog(gameYear, platform).status()}

    @app.get("/api/database/status")
    def database_status(gameYear: int | None = Query(default=None, ge=26, le=27), platform: Literal["ps5", "pc"] | None = None):
        return {**get_catalog(gameYear, platform).status(), "syncing": sync_lock.locked()}

    @app.get("/api/players")
    def players(q: str = Query(default="", max_length=120), limit: int = Query(default=50, ge=1, le=1000),
                offset: int = Query(default=0, ge=0), gameYear: int | None = Query(default=None, ge=26, le=27),
                platform: Literal["ps5", "pc"] | None = None):
        selected = get_catalog(gameYear, platform)
        return {"players": selected.search(q, limit=limit, offset=offset),
                "database": selected.status(), "total": selected.count(q), "limit": limit, "offset": offset}

    @app.post("/api/concepts")
    async def concept_candidates(body: ConceptRequest):
        try:
            selected = get_catalog(body.gameYear, body.platform)
            return await run_in_threadpool(selected.concept_candidates, body.sbcData, body.solverPolicy, body.limit)
        except (ValueError, TypeError, KeyError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/database/sync")
    async def sync_database(body: SyncRequest):
        if not sync_lock.acquire(blocking=False):
            raise HTTPException(409, "A database update is already running.")
        def work():
            try:
                return get_catalog(body.gameYear, body.platform).sync(max_pages=body.maxPages)
            except Exception as exc:
                logging.exception("Public catalog sync failed")
                raise HTTPException(502, f"Database update failed; existing data was kept. {exc}") from exc
            finally:
                sync_lock.release()
        return await run_in_threadpool(work)

    def solve_work(body, progress=None):
        logger.clear_logs()
        try:
            return planner.plan(body, get_catalog(body.gameYear, body.platform), progress)
        except (ValueError, TypeError, KeyError) as exc:
            logger.add_log(f"Invalid solve input: {exc}")
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:
            logging.exception("Solver failed")
            logger.add_log("Solver failed. No squad was applied.")
            raise HTTPException(500, "The solver failed. No squad was applied; check local diagnostics.") from exc
        finally:
            solve_lock.release()

    def acquire_solver():
        if not solve_lock.acquire(blocking=False):
            raise HTTPException(409, "A solution is already being calculated. Wait for it to finish.")

    @app.post("/solve")
    async def solve(body: SolveRequest):
        acquire_solver()
        return await run_in_threadpool(solve_work, body)

    def prune_jobs():
        # Caller holds jobs_lock. Store at most five recent results for ten minutes.
        cutoff = time.monotonic() - 600
        for job_id in list(jobs):
            if jobs[job_id]["status"] != "running" and jobs[job_id]["created"] < cutoff:
                del jobs[job_id]
        finished = [key for key in jobs if jobs[key]["status"] != "running"]
        for key in finished[:-4]:
            del jobs[key]

    @app.post("/api/solve/jobs", status_code=202)
    def start_solve_job(body: SolveRequest):
        acquire_solver()
        job_id = uuid.uuid4().hex
        with jobs_lock:
            prune_jobs()
            jobs[job_id] = {"status": "running", "created": time.monotonic()}
        def work():
            try:
                def progress(value):
                    with jobs_lock:
                        jobs[job_id]["progress"] = value
                result = solve_work(body, progress)
                update = {"status": "done", "result": result}
            except HTTPException as exc:
                update = {"status": "error", "detail": exc.detail, "statusCode": exc.status_code}
            except Exception:
                logging.exception("Asynchronous solver failed")
                update = {"status": "error", "detail": "The background solver failed."}
            with jobs_lock:
                jobs[job_id].update(update)
        try:
            Thread(target=work, name=f"autosbc-{job_id[:8]}", daemon=True).start()
        except Exception:
            solve_lock.release()
            with jobs_lock:
                del jobs[job_id]
            raise HTTPException(503, "Could not start the solver.")
        return {"jobId": job_id, "status": "running"}

    @app.get("/api/solve/jobs/{job_id}")
    def get_solve_job(job_id: str):
        with jobs_lock:
            prune_jobs()
            if job_id not in jobs:
                raise HTTPException(404, "This solve job is missing or expired. Results stay in memory for ten minutes.")
            return {key: value for key, value in jobs[job_id].items() if key != "created"}

    @app.get("/solver-logs")
    def solver_logs():
        return {"logs": logger.snapshot()}

    @app.post("/clear-logs")
    def clear_logs():
        if solve_lock.locked():
            raise HTTPException(409, "Cannot clear diagnostics while solving.")
        logger.clear_logs()
        return {"status": "success"}

    @app.get("/conceptPlayers.csv")
    def concept_csv(gameYear: int | None = Query(default=None, ge=26, le=27), platform: Literal["ps5", "pc"] | None = None):
        return Response(get_catalog(gameYear, platform).csv_text(), media_type="text/csv",
                        headers={"Content-Disposition": "inline; filename=conceptPlayers.csv"})

    @app.get("/allPlayers.csv")
    def club_csv():
        # Never disguise a public player catalog as the user's owned inventory.
        raise HTTPException(404, "Club inventory is kept in memory. Export it explicitly from the Web App panel.")

    @app.get("/download/userscript")
    def userscript():
        return FileResponse(ROOT / "tampermonkey-ai-sbc.user.js", media_type="application/javascript",
                            filename="autosbc-studio.user.js")

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=int(os.environ.get("AUTOSBC_PORT", 8000)))
