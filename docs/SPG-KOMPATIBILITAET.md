# SPG-Kompatibilität

## Geprüfter Ausgangsbestand

Untersucht wurde die vom Benutzer bereitgestellte `GUT_<Zeitstempel>.zip`:

- 348 Dateien
- SQL-Server-Sicherung `spg_verein_GUT_<Zeitstempel>.bak`
- SQL Server Major Version 12 (SQL Server 2014)
- internes Datenbankformat 782
- gefundene lokale Instanz `(LocalDb)\MSSQLLocalDB-SPG`, Datenbank `spg_verein_GUT`
- SPG-Datenversion 432
- `restoreInfo.txt`
- Ordner `mandanten/GUT/dta-historie`, `listen`, `bausteine`, `briefe`,
  `etikett` und `formular`

Die Sicherung enthält 138 Tabellen. Die zentrale Tabelle `tbl_Mitglied` besitzt
114 Spalten; Beiträge, Funktionen und Ehrungen liegen in eigenen Untertabellen.
Ein CSV-Export ist daher kein vollständiger Ersatz für eine SPG-Sicherung.

## Architektur

```text
Browser
   │
   ▼
NAS: Docker-Webapp ─── Token ───► Ubuntu-Forwarder ───► WinBoat/Windows-SPG-Brücke
   │                       nur bei manueller Übertragung              │
   ▼                                                                  ▼
SQLite-Arbeitsbestand                                             SQL Server 2014
                                                                      │
                                                                      ▼
                                                        .bak + restoreInfo + Dateien
                                                                      │
                                                                      ▼
                                                               GUT_<Zeit>.zip
```

Es gibt keinen dauerhaften Sync. Der Forwarder und die Windows-Brücke werden
nur für eine bewusst ausgelöste Übertragung gestartet und danach beendet.

Die Brücke gibt eine Sicherung nur frei, wenn alle harten Merkmale passen:

1. SQL Server Major Version ist 12.
2. Datenbankformat ist 782.
3. Mandant ist `GUT`.
4. `tbl_Mitglied` ist vorhanden.
5. Alle benötigten SPG-Dateiverzeichnisse sind vorhanden.

Das Einlesen in die Webapp ist bereits implementiert. Vorhandene SPG-Datensätze
werden anhand der Mitgliedsnummer zusammengeführt; lokale, noch nicht nach SPG
synchronisierte Änderungen werden dabei nicht überschrieben.

## Warum die Brücke erforderlich ist

Ein Backup, das nach dem Öffnen der Datenbank auf SQL Server 2017 oder neuer
erstellt wird, lässt sich nicht auf SQL Server 2014 wiederherstellen. Offizielle
Linux-Container existieren erst ab SQL Server 2017. Darum darf die NAS-App die
SPG-`.bak` nicht selbst neu erzeugen.

## Noch ausstehender Freigabetest

Die Schreibschnittstelle bleibt bis zum folgenden Test gesperrt:

1. Originales Backup in eine isolierte SQL-Server-2014/SPG-Testumgebung
   wiederherstellen.
2. Je einen Webapp-Datensatz mit allen Feldgruppen anlegen und ändern.
3. Daten über eine parametrisierte Transaktion und die originalen SPG-Prozeduren
   `SP_MitgliedNeu`, `SP_MitgliedAktualisieren`,
   `SP_MitgliedAbteilungBeitragAnfuegen` und
   `SP_MitgliedAbteilungBeitragAktualisieren` schreiben.
4. ZIP über die Brücke erzeugen.
5. ZIP in einer zweiten leeren SPG-Testumgebung wiederherstellen.
6. Alle 114 Mitgliedsspalten, Untertabellen, Stammdaten, Vorlagen und Historien
   per Hash beziehungsweise Datenvergleich prüfen.
7. Mitglied in SPG öffnen, Beitragserhebung testweise vorbereiten und erneut
   sichern.
8. Erst nach bestandenem Roundtrip `STRICT_SPG_WRITE=true` freigeben.

Dieses Vorgehen ist Teil der Produktanforderung „100 % kompatibel“ und kein
optionaler Test.
