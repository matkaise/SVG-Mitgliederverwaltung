# GitHub- und NAS-Betrieb

## GitHub

Das Repository ist so vorbereitet, dass personenbezogene Daten nicht
eingecheckt werden. Vor dem ersten Push prüfen:

```bash
git status --short
git grep -n -I -E 'IBAN|SPG_BRIDGE_TOKEN|ADMIN_PASSWORD'
```

Die produktiven Dateien `.env`, `bridge-windows/config.json`, `data/` und
Backups sind ignoriert.

## NAS

Voraussetzungen:

- Docker Engine mit Compose
- x86-64 oder ARM64 für die Webapp
- persistenter Ordner für `./data`
- erreichbarer Windows-Rechner oder Windows-VM mit SPG/SQL Server 2014 für die
  strikte SPG-Sicherung

Start:

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

Die Weboberfläche läuft standardmäßig auf Port `8180`. Bei Bedarf kann der
Host-Port über `APP_PORT` in `.env` angepasst werden.

Ein regelmäßiges NAS-Backup muss mindestens `./data` sichern. SPG-ZIP-Dateien
sollten zusätzlich in einen getrennten Sicherungsordner geschrieben werden.
