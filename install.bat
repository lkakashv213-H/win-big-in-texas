@echo off
title LotChance - Installing Dependencies
echo.
echo ========================================
echo    LotChance - Installing...
echo ========================================
echo.

cd /d "%~dp0"

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo.
    echo Please download and install Node.js from:
    echo https://nodejs.org
    echo.
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)

echo Node.js found:
node --version
echo.

echo Installing npm packages...
echo.
npm install

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo    Installation Complete!
    echo ========================================
    echo.
    echo To start the app, double-click: start.bat
    echo Or run: npm start
    echo.
) else (
    echo.
    echo ERROR: Installation failed!
    echo.
)

pause
