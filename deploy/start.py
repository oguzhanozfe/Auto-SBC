"""One-process hosted entry point; configuration errors stop startup."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.runtime_config import RuntimeConfig


def main():
    config = RuntimeConfig.read()
    if not config.hosted:
        raise SystemExit("This deployment entry point requires AUTOSBC_HOSTED=1. Use Start Studio for local mode.")
    if os.environ.get("WEB_CONCURRENCY", "1") != "1":
        raise SystemExit("Hosted jobs require WEB_CONCURRENCY=1.")
    port = int(os.environ.get("PORT", "10000"))
    if not 1 <= port <= 65535:
        raise SystemExit("PORT must be from 1 to 65535.")
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, workers=1,
                access_log=False, proxy_headers=False, timeout_graceful_shutdown=35)


if __name__ == "__main__":
    main()
