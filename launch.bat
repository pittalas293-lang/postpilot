@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 18+ is required.
  echo Install from https://nodejs.org/
  pause
  exit /b 1
)

where ollama >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Ollama is not installed.
  echo Install from https://ollama.com/download/windows
  pause
  exit /b 1
)

echo Checking Ollama...
ollama list > "%TEMP%\postpilot_ollama_models.txt" 2>nul
findstr /B /C:"qwen2.5:7b" "%TEMP%\postpilot_ollama_models.txt" >nul 2>nul
if errorlevel 1 (
  echo PostPilot model qwen2.5:7b is not installed yet.
  echo Starting model download. This may take several minutes.
  ollama pull qwen2.5:7b
  if errorlevel 1 (
    echo [ERROR] Model download failed.
    pause
    exit /b 1
  )
)

echo Starting PostPilot...
start "PostPilot Server" cmd /k "cd /d "%~dp0" && node server.js"
timeout /t 2 /nobreak >nul
start "PostPilot" http://localhost:3000

echo.
echo PostPilot is running at http://localhost:3000
pause
