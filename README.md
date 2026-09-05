# GUT Mitgliederverwaltung

Lokale, selbst gehostete Vereinsverwaltung für Mitglieder, Beiträge, SEPA und
den Rückweg in SPG-VEREIN.

## Aktueller Stand

- responsive Weboberfläche mit Übersicht, Mitglieder, Beiträge, SEPA,
  SPG-Sicherung und Einstellungen
- vollständige Mitgliedsmaske in acht Bereichen
- persistente lokale SQLite-Datenbank im Docker-Volume
- SEPA-Export als `pain.008.001.08` sowie Legacy-Format
- kennwortgeschützter Zugriff über HTTP Basic Auth
- strenge SPG-Kompatibilitätsprüfung gegen SQL Server 2014 / Datenbankformat 782
- Windows-Brücke zur Erzeugung der echten SPG-ZIP-Struktur
- manuell startbarer WinBoat-Forwarder ohne Hintergrund-Synchronisation
- Einlesen des vorhandenen SPG-Mitgliederbestands über die geprüfte Brücke
- Rückschreiben über die originalen SPG-Prozeduren, standardmäßig bis zum
  Roundtrip-Test gesperrt

Die Anwendung ist absichtlich noch als Vorabversion gekennzeichnet: Der
vorhandene SPG-Bestand kann bereits in die Webapp eingelesen werden. Neue oder
geänderte Webapp-Datensätze werden aber erst dann zurück in die SPG-Datenbank
geschrieben, wenn der Roundtrip-Test in einer isolierten SPG-Installation
bestanden und `EnableWrites` in der Windows-Brücke aktiviert ist. Ein
scheinbar passendes, tatsächlich aber nicht wiederherstellbares ZIP wird nicht
erzeugt.

## Lokal starten

```bash
corepack enable
pnpm install
pnpm build
cp .env.example .env
pnpm start
```

Danach ist die Anwendung unter `http://localhost:3000` erreichbar.

## Auf dem NAS mit Docker

```bash
cp .env.example .env
# .env bearbeiten und sichere Kennwörter/Adressen setzen
docker compose up -d --build
```

Danach ist die Anwendung standardmäßig unter `http://NAS-IP:8180` erreichbar.
Der Host-Port kann mit `APP_PORT` in `.env` geändert werden.

Die Daten liegen ausschließlich in `./data` und sind durch `.gitignore` vom
GitHub-Repository ausgeschlossen. Für Zugriff außerhalb des Heimnetzes sollte
vor der App ein HTTPS-Reverse-Proxy stehen.

## SPG-Sicherung

Die originale Sicherung enthält nicht nur exportierte Mitgliederdaten, sondern
eine SQL-Server-`.bak`, `restoreInfo.txt`, Vorlagen und SEPA-Historie. Der
Docker-Container auf Linux kann diese `.bak` nicht kompatibel neu erzeugen.
Deshalb läuft der zweite Teil aus `bridge-windows/` auf dem SPG-Windows-Rechner
mit der originalen SQL-Server-Version.

Details und Abnahmekriterien: [docs/SPG-KOMPATIBILITAET.md](docs/SPG-KOMPATIBILITAET.md)

Bei WinBoat wird die Verbindung nur für den einzelnen Import oder Export
gestartet. Die Befehle stehen in
[bridge-windows/README.md](bridge-windows/README.md).

## Datenschutz

Die originale SPG-Sicherung und die produktive SQLite-Datenbank gehören nie ins
Git-Repository. In Git liegen nur Quellcode, leere Konfigurationsvorlagen und
Dokumentation.
