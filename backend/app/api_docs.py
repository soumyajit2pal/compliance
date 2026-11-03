"""UAT-only Swagger UI using vendored assets and an external CSP-safe bootstrap."""
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .config import ROOT


def install_uat_docs(app: FastAPI, environment: str):
    if environment != 'uat':
        return
    app.mount('/docs/assets', StaticFiles(directory=ROOT / 'backend/static/swagger'), name='swagger-assets')

    @app.get('/docs', include_in_schema=False)
    def swagger():
        return FileResponse(ROOT / 'backend/templates/swagger.html', media_type='text/html')
