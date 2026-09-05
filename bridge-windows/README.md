# Windows-SPG-Brücke

Die Brücke läuft auf dem Windows-Rechner und unter demselben Windows-Benutzer,
unter dem SPG-VEREIN gestartet wird. Der gefundene Bestand verwendet
`(LocalDb)\MSSQLLocalDB-SPG` und die Datenbank `spg_verein_GUT`. Nur diese
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

## Manueller Start mit WinBoat

Es gibt ausdrücklich keinen Hintergrund-Sync. Die Brücke und der Ubuntu-
Forwarder laufen nur während einer manuell gestarteten Übertragung.

Einmalig:

1. Auf Ubuntu `scripts/configure-spg-bridge.sh` ausführen. Das erzeugt die
   ignorierte `config.json` mit dem Token vom NAS.
2. Der vorbereitete Ordner ist in WinBoat über die Freigabe
   `\\host.lan\Data\Dokumente\ChatGPT\Mitgliederverwaltung\bridge-windows`
   erreichbar. Ein Laufwerksbuchstabe ist nicht erforderlich.
3. In Windows `Windows-Firewall-einmalig.ps1` einmal als Administrator
   ausführen. Die Regel gilt nur für TCP-Port 8787 aus dem lokalen
   WinBoat-Docker-Netz.
4. Auf Ubuntu `scripts/spg-transfer.sh prepare` ausführen. Das baut nur das
   kleine lokale Forwarder-Image und startet noch keine Verbindung.

Für jede Übertragung:

1. In Windows `Start-SPG-Uebertragung.cmd` starten.
2. Auf Ubuntu `scripts/spg-transfer.sh start` ausführen.
3. In der Webapp den Bestand einlesen oder eine SPG-Sicherung erstellen.
4. Auf Ubuntu `scripts/spg-transfer.sh stop` ausführen.
5. Das Windows-Fenster der SPG-Brücke mit `Strg+C` schließen.

`EnableWrites` bleibt bis zum bestandenen Abnahmetest auf `false`. Das Lesen und
das Sichern des bestehenden SPG-Bestands funktionieren unabhängig davon.

Die Datei `config.json` darf nicht in Git eingecheckt werden.
