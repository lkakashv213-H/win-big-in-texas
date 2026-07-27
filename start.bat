@echo off
title LotChance - Texas Lottery Analyzer
echo.
echo ========================================
echo    LotChance - Starting Server...
echo ========================================
echo.

cd /d "%~dp0"

:: Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    echo.
    npm install
    echo.
)

echo Starting server...
echo.
echo Open your browser to: http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

npm start

pause
