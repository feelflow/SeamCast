@echo off
chcp 65001 >nul
title SeamCast
cd /d "%~dp0"

echo === SeamCast wird gestartet ===

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren.
  pause
  exit /b 1
)

echo Suche nach Updates ...
git checkout main
if errorlevel 1 (
  echo Der Wechsel auf "main" hat nicht geklappt, vermutlich wegen eigener Aenderungen im Ordner.
  echo SeamCast startet mit dem bisherigen Stand. Bitte die Meldung oben ansehen.
  pause
)
git pull --ff-only
echo Pruefe Abhaengigkeiten ...
call pnpm install --frozen-lockfile
if errorlevel 1 (
  echo Installation fehlgeschlagen. Bitte die Meldung oben ansehen.
  pause
  exit /b 1
)

rem Browser einmalig oeffnen, sobald der Server oben ist
start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:8080/control/"

:run
echo.
echo SeamCast laeuft. Zum Beenden dieses Fenster schliessen.
call pnpm start
echo.
echo SeamCast wurde beendet oder ist abgestuerzt. Neustart in 3 Sekunden ...
timeout /t 3 >nul
goto run
