#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export APP_ENV=uat
npm --prefix frontend run build
exec .venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8010
