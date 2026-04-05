@echo off
echo ====================================
echo   Brewery Simulator - Starting...
echo ====================================
echo.
echo Opening game in browser at http://localhost:3000
echo Press Ctrl+C to stop the server.
echo.

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" http://localhost:3000
    python -m http.server 3000
) else (
    where npx >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        start "" http://localhost:3000
        npx serve -l 3000
    ) else (
        echo ERROR: Neither Python nor Node.js found.
        echo Install one of them and try again.
        pause
    )
)
