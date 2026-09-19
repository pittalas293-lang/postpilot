@echo off
setlocal
where ollama >nul 2>nul
if errorlevel 1 (
  echo Ollama is not installed. Install it from https://ollama.com/download
  pause
  exit /b 1
)
echo Pulling the configured PostPilot model...
ollama pull qwen2.5:7b
if errorlevel 1 (
  echo Model pull failed. You can pull another model manually and set OLLAMA_MODEL.
  pause
  exit /b 1
)
echo Ollama setup complete.
pause
