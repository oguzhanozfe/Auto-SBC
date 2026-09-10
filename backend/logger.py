"""Bounded in-memory diagnostic log. Never persists club inventory."""
import time
from collections import deque
from threading import Lock

_lock = Lock()
solver_logs = deque(maxlen=300)


def add_log(message, result=None):
    with _lock:
        solver_logs.append({"time": time.time(), "message": str(message), "result": result or []})


def clear_logs():
    with _lock:
        solver_logs.clear()


def snapshot():
    with _lock:
        return list(solver_logs)
