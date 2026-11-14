@echo off
echo Opening your existing Ubuntu/WSL environment...
wsl.exe --cd "%~dp0." bash deploy/install-laptop.sh
pause
