#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="vereinsverwaltung"
IMAGE_NAME="ghcr.io/matkaise/svg-mitgliederverwaltung:latest"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"

cd "$ROOT_DIR"

current_container="$(docker compose ps -q "$SERVICE_NAME" 2>/dev/null || true)"
previous_image=""
if [[ -n "$current_container" ]]; then
  previous_image="$(docker inspect --format '{{.Image}}' "$current_container" 2>/dev/null || true)"
fi

echo "Lade das freigegebene Image von GitHub …"
docker compose pull "$SERVICE_NAME"
new_image="$(docker image inspect --format '{{.Id}}' "$IMAGE_NAME")"

if [[ -n "$previous_image" && "$previous_image" == "$new_image" ]]; then
  echo "Das NAS verwendet bereits das aktuelle Image."
fi

echo "Starte die Vereinsverwaltung mit dem neuen Image …"
docker compose up -d --no-build "$SERVICE_NAME"

container_id="$(docker compose ps -q "$SERVICE_NAME")"
if [[ -z "$container_id" ]]; then
  echo "Fehler: Der Container wurde nicht erstellt." >&2
  exit 1
fi

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  case "$state" in
    healthy|running)
      echo "Update erfolgreich: Container ist $state."
      docker compose ps "$SERVICE_NAME"
      exit 0
      ;;
    unhealthy|exited|dead)
      break
      ;;
  esac
  sleep 2
done

echo "Das neue Image wurde nicht rechtzeitig gesund." >&2
if [[ -n "$previous_image" && "$previous_image" != "$new_image" ]]; then
  echo "Stelle das vorherige Image wieder her …" >&2
  docker image tag "$previous_image" "$IMAGE_NAME"
  docker compose up -d --no-build --pull never --force-recreate "$SERVICE_NAME"
  echo "Rollback ausgelöst. Bitte 'docker compose ps' und die Logs prüfen." >&2
else
  echo "Kein vorheriges Image für ein automatisches Rollback vorhanden." >&2
fi
exit 1
