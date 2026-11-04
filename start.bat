@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Lieferwerk

where node >nul 2>nul
if errorlevel 1 goto nonode

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 goto oldnode

if "%PORT%"=="" set PORT=3000

echo.
echo  Lieferwerk wird gestartet ...
echo  Der Browser oeffnet sich gleich auf http://localhost:%PORT%
echo  Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"

node --disable-warning=ExperimentalWarning src\server.ts

echo.
echo  Lieferwerk wurde beendet.
pause
exit /b 0

:nonode
echo.
echo  Node.js wurde nicht gefunden.
echo  Bitte Node.js (LTS, Version 22 oder neuer) installieren: https://nodejs.org
echo  Danach diese Datei erneut doppelklicken.
echo.
start https://nodejs.org
pause
exit /b 1

:oldnode
echo.
echo  Die installierte Node.js-Version ist zu alt. Benoetigt wird 22.18 oder neuer.
echo  Bitte aktualisieren: https://nodejs.org
echo.
start https://nodejs.org
pause
exit /b 1
