# syntax=docker/dockerfile:1
FROM python:3.13-slim-bookworm AS python-base
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

FROM python-base AS dropdown-check
COPY scripts/dropdown_catalogue.py ./scripts/
COPY backend/app/dropdown_catalogue.json ./backend/app/
COPY frontend/ ./frontend/
RUN python scripts/dropdown_catalogue.py

FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci --include=dev
COPY --from=dropdown-check /app/frontend/ ./frontend/
COPY scripts/build_swagger_login.mjs scripts/sync_frontend_public.mjs ./scripts/
COPY backend/static/swagger/ ./backend/static/swagger/
RUN npm --prefix frontend run build:bundle

FROM python-base AS backend
COPY backend/requirements.txt ./backend/requirements.txt
RUN python -m pip install --no-cache-dir -r backend/requirements.txt
COPY backend/__init__.py ./backend/
COPY backend/app/ ./backend/app/
COPY backend/alembic.ini ./backend/
COPY backend/alembic/ ./backend/alembic/
COPY backend/templates/ ./backend/templates/
COPY --from=frontend-build /app/backend/static/swagger/ ./backend/static/swagger/
RUN install -d -m 0777 /run/portal-socket
ARG PORTAL_IMAGE_TAG=2026.11.23-r2
LABEL org.opencontainers.image.title="Compliance by Design backend" org.opencontainers.image.version="${PORTAL_IMAGE_TAG}"
ENV PORTAL_RELEASE=${PORTAL_IMAGE_TAG} PORTAL_SERVE_FRONTEND=false
USER 10001:10001
# Nginx is the sole peer on the mounted socket and replaces incoming forwarding headers.
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--uds", "/run/portal-socket/portal.sock", "--proxy-headers", "--forwarded-allow-ips", "*"]

FROM nginx:1.30-alpine AS frontend
RUN install -d -m 0777 /run/portal-edge
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-build /app/frontend/dist/ /srv/portal/assets/
ARG PORTAL_IMAGE_TAG=2026.11.23-r2
LABEL org.opencontainers.image.title="Compliance by Design frontend" org.opencontainers.image.version="${PORTAL_IMAGE_TAG}"
USER 10001:10001
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
