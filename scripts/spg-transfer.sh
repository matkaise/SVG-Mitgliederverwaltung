#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="spg-winboat-forward"
IMAGE_NAME="svg-spg-forwarder:local"
LISTEN_IP="${SPG_LISTEN_IP:-192.168.1.53}"
LISTEN_PORT="${SPG_LISTEN_PORT:-8787}"
WINBOAT_NETWORK="${SPG_WINBOAT_NETWORK:-winboat_default}"
WINBOAT_HOST="${SPG_WINBOAT_HOST:-WinBoat}"

usage() {
  echo "Verwendung: $0 prepare|start|status|stop"
}

exists() {
  docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"
}

case "${1:-}" in
  prepare)
    docker build -t "$IMAGE_NAME" "$ROOT_DIR/bridge-forwarder"
    echo "Der lokale Forwarder ist vorbereitet und noch nicht gestartet."
    ;;
  start)
    if docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
      echo "Der Forwarder läuft bereits auf ${LISTEN_IP}:${LISTEN_PORT}."
      exit 0
    fi
    if exists; then
      docker rm "$CONTAINER_NAME" >/dev/null
    fi
    if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
      docker build -t "$IMAGE_NAME" "$ROOT_DIR/bridge-forwarder"
    fi
    docker run -d --rm \
      --name "$CONTAINER_NAME" \
      --network "$WINBOAT_NETWORK" \
      -p "${LISTEN_IP}:${LISTEN_PORT}:${LISTEN_PORT}" \
      "$IMAGE_NAME" \
      "TCP-LISTEN:${LISTEN_PORT},fork,reuseaddr" \
      "TCP:${WINBOAT_HOST}:${LISTEN_PORT}" >/dev/null
    echo "Forwarder gestartet: ${LISTEN_IP}:${LISTEN_PORT} -> WinBoat:${LISTEN_PORT}"
    echo "Nach der Übertragung beenden mit: $0 stop"
    ;;
  status)
    if docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
      docker ps --filter "name=^/${CONTAINER_NAME}$" --format 'Forwarder läuft: {{.Ports}}'
    else
      echo "Forwarder ist aus."
    fi
    ;;
  stop)
    if docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
      docker stop "$CONTAINER_NAME" >/dev/null
      echo "Forwarder beendet und entfernt."
    elif exists; then
      docker rm "$CONTAINER_NAME" >/dev/null
      echo "Gestoppten Forwarder entfernt."
    else
      echo "Forwarder war bereits aus."
    fi
    ;;
  *)
    usage
    exit 2
    ;;
esac
