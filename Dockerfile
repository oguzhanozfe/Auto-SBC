# syntax=docker/dockerfile:1
FROM node:22-alpine AS browser
WORKDIR /build
COPY VERSION LICENSE ./
COPY frontend ./frontend
RUN node frontend/build.mjs

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    AUTOSBC_HOSTED=1 AUTOSBC_SOLVER_WORKERS=1 WEB_CONCURRENCY=1 \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MALLOC_ARENA_MAX=2 \
    AUTOSBC_DATA_DIR=/tmp/autosbc-data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home autosbc
COPY requirements.txt requirements-lock.txt ./
RUN python -m pip install --no-cache-dir --only-binary=:all: -c requirements-lock.txt -r requirements.txt
COPY VERSION LICENSE ./
COPY backend ./backend
COPY deploy ./deploy
COPY --from=browser /build/dist/chrome-extension ./dist/chrome-extension
COPY --from=browser /build/tampermonkey-ai-sbc.user.js ./tampermonkey-ai-sbc.user.js
USER 10001
EXPOSE 10000
CMD ["python", "deploy/start.py"]
