@echo off
title SPG-Uebertragung (nur bei Bedarf)
echo Die SPG-Bruecke laeuft nur, solange dieses Fenster geoeffnet ist.
echo Mit Strg+C oder durch Schliessen des Fensters wird sie beendet.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-SpgBridge.ps1" -ConfigPath "%~dp0config.json"
pause
