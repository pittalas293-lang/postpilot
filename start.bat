@echo off
setlocal
if not exist data mkdir data
if not exist node_modules echo No npm install is required for this project.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required.
  pause
  exit /b 1
)
start "PostPilot Server" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "PostPilot" http://localhost:3000
