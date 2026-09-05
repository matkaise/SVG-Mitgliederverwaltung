#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAS_SSH="${NAS_SSH:-matthias@192.168.1.196}"
NAS_APP_DIR="${NAS_APP_DIR:-/home/matthias/docker/svg-mitgliederverwaltung}"
EXAMPLE_FILE="$ROOT_DIR/bridge-windows/config.example.json"
OUTPUT_FILE="$ROOT_DIR/bridge-windows/config.json"

echo "Lese das Bridge-Token geschützt vom NAS. Das SSH-Kennwort wird interaktiv abgefragt."
TOKEN="$(ssh "$NAS_SSH" "sed -n 's/^SPG_BRIDGE_TOKEN=//p' '$NAS_APP_DIR/.env'")"

if [[ ! "$TOKEN" =~ ^[A-Fa-f0-9]{64}$ ]]; then
  echo "Fehler: Auf dem NAS wurde kein gültiges Bridge-Token gefunden." >&2
  exit 1
fi

umask 077
sed "s/BITTE_EIN_LANGES_ZUFAELLIGES_TOKEN_SETZEN/$TOKEN/" "$EXAMPLE_FILE" > "$OUTPUT_FILE"
unset TOKEN

echo "Windows-Konfiguration erstellt: $OUTPUT_FILE"
echo "EnableWrites bleibt absichtlich auf false."
