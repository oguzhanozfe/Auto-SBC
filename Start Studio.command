#!/bin/sh
# Explicit double-click launcher; does not install an autorun service.
set -eu
studio_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${AUTOSBC_PYTHON:-}" ] && [ -x "$AUTOSBC_PYTHON" ]; then
  studio_python=$AUTOSBC_PYTHON
elif [ -x "$studio_dir/.venv/bin/python" ]; then
  studio_python="$studio_dir/.venv/bin/python"
elif [ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" ]; then
  studio_python="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
elif command -v python3 >/dev/null 2>&1; then
  studio_python=$(command -v python3)
else
  echo 'Python 3.12 veya daha yenisi bulunamadı. Python’u kurup yeniden açın.'
  exit 1
fi
exec "$studio_python" "$studio_dir/scripts/start_studio.py" "$@"
