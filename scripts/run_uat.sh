#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export APP_ENV=uat
npm --prefix frontend run build
exec .venv/bin/python -m backend.app.local_https serve
