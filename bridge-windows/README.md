# Windows-SPG-Brücke

Die Brücke läuft auf dem Windows-Rechner und unter demselben Windows-Benutzer,
unter dem SPG-VEREIN gestartet wird. Der gefundene Bestand verwendet
`(LocalDb)\MSSQLLocalDB` und die Datenbank `spg_verein_GUT`. Nur diese
SQL-Server-Generation kann eine `.bak`-Datei erzeugen, die vom vorhandenen SPG
wieder eingelesen werden kann.

## Noch nicht produktiv freigeben

Der aktuelle Stand implementiert die strenge Versionsprüfung, das Lesen des
vorhandenen Mitgliederbestands und die originale ZIP-Erzeugung. Der Schreibweg
ruft die in SPG vorhandenen Prozeduren `SP_MitgliedNeu`,
`SP_MitgliedAktualisieren` und die Beitrags-Prozeduren auf. Er wird erst
freigegeben, wenn der Roundtrip-Test mit einer isolierten SPG-Kopie alle
114 Mitgliedsfelder sowie die Untertabellen für Beiträge, Funktionen und
Ehrungen bestanden hat. Bis dahin erzeugt die Brücke nur Sicherungen des bereits
in SPG vorhandenen Bestands.

## Lokaler Teststart

1. `config.example.json` nach `config.json` kopieren und Werte anpassen.
2. Ein langes zufälliges Token setzen und Port 8787 nur für die NAS-IP in der
   Windows-Firewall freigeben.
3. PowerShell unter demselben Windows-Benutzer wie SPG starten:
   `powershell.exe -ExecutionPolicy Bypass -File .\Start-SpgBridge.ps1`

`EnableWrites` bleibt bis zum bestandenen Abnahmetest auf `false`. Das Lesen und
das Sichern des bestehenden SPG-Bestands funktionieren unabhängig davon.

Die Datei `config.json` darf nicht in Git eingecheckt werden.
