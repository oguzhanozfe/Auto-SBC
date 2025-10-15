#!/bin/bash
cd /Users/oguzhanozdemir/Auto-SBC
source .venv/bin/activate
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --log-level info