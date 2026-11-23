#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

engine=
case "${1:-}" in
    docker|podman)
        engine=$1
        shift
        ;;
    -h|--help)
        printf 'Usage: %s [docker|podman] [Compose up options]\n' "$0"
        exit 0
        ;;
esac

uid=$(id -u)
gid=$(id -g)
if [ "$uid" -eq 0 ]; then
    printf '%s\n' 'Start the portal as the non-root account that owns the deployment profile and keys.' >&2
    exit 1
fi

if [ -z "$engine" ]; then
    if docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        engine=docker
    elif command -v podman >/dev/null 2>&1; then
        engine=podman
    else
        printf '%s\n' 'Start Docker with Compose or make Podman Compose available, then try again.' >&2
        exit 1
    fi
fi

userns=
if [ "$engine" = podman ]; then
    rootless=$(podman info --format '{{.Host.Security.Rootless}}')
    if [ "$rootless" = true ]; then
        userns=keep-id
    fi
    set -- up -d "$@"
    if [ "$(uname -s)" = Linux ]; then
        set -- -f compose.yaml -f deploy/compose.podman.yaml "$@"
    fi
else
    set -- up -d --wait "$@"
fi

exec env PORTAL_UID="$uid" PORTAL_GID="$gid" PORTAL_USERNS_MODE="$userns" \
    "$engine" compose "$@"
