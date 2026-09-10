"""Explicit local or single-owner hosted configuration; never infer public access."""
from __future__ import annotations

from dataclasses import dataclass, field
import os
import re
from urllib.parse import urlsplit


def solver_workers():
    value = os.environ.get("AUTOSBC_SOLVER_WORKERS")
    if value is None:
        return 1 if os.environ.get("AUTOSBC_HOSTED") == "1" else min(8, os.cpu_count() or 1)
    if not re.fullmatch(r"[1-8]", value):
        raise ValueError("AUTOSBC_SOLVER_WORKERS must be an integer from 1 to 8.")
    if os.environ.get("AUTOSBC_HOSTED") == "1" and value != "1":
        raise ValueError("The hosted free profile requires one solver worker.")
    return int(value)


@dataclass(frozen=True)
class RuntimeConfig:
    hosted: bool = False
    public_origin: str = ""
    hostname: str = ""
    token: str = field(default="", repr=False)
    extension_origins: frozenset[str] = frozenset()
    max_chemistry_players: int = 200

    @classmethod
    def read(cls):
        mode = os.environ.get("AUTOSBC_HOSTED", "0")
        if mode not in {"0", "1"}:
            raise ValueError("AUTOSBC_HOSTED must be 0 or 1.")
        solver_workers()  # Reject unsafe worker configuration at startup.
        if mode == "0":
            return cls()
        if os.environ.get("WEB_CONCURRENCY", "1") != "1":
            raise ValueError("Hosted in-memory jobs require WEB_CONCURRENCY=1.")
        origin = os.environ.get("AUTOSBC_PUBLIC_ORIGIN") or os.environ.get("RENDER_EXTERNAL_URL", "")
        parsed = urlsplit(origin)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.netloc != parsed.hostname
                or parsed.path or parsed.query or parsed.fragment
                or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", parsed.hostname)
                or "." not in parsed.hostname or ".." in parsed.hostname):
            raise ValueError("Hosted mode requires AUTOSBC_PUBLIC_ORIGIN (or RENDER_EXTERNAL_URL) as one exact HTTPS origin without a path or port.")
        token = os.environ.get("AUTOSBC_API_TOKEN", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,512}", token):
            raise ValueError("Hosted mode requires a 32–512 character URL-safe AUTOSBC_API_TOKEN.")
        ids = os.environ.get("AUTOSBC_EXTENSION_IDS", "")
        extensions = ids.split(",") if ids else []
        if len(extensions) > 5 or any(not re.fullmatch(r"[a-p]{32}", value) for value in extensions):
            raise ValueError("AUTOSBC_EXTENSION_IDS must contain up to five exact comma-separated Chrome extension IDs.")
        chemistry_limit = os.environ.get("AUTOSBC_MAX_CHEMISTRY_PLAYERS", "200")
        if not re.fullmatch(r"[1-9][0-9]{0,3}", chemistry_limit) or not 11 <= int(chemistry_limit) <= 5000:
            raise ValueError("AUTOSBC_MAX_CHEMISTRY_PLAYERS must be an integer from 11 to 5000.")
        return cls(True, origin, parsed.hostname, token,
                   frozenset(f"chrome-extension://{value}" for value in extensions), int(chemistry_limit))

    @property
    def capabilities(self):
        return {"allowConcept": False, "allowChemistry": True,
                "maxSolveTime": 30, "maxClubPlayers": 5000,
                "maxChemistryPlayers": self.max_chemistry_players}
