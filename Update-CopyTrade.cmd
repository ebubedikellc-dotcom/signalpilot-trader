@echo off
echo Updating your existing laptop CopyTrade...
wsl.exe --cd "%~dp0." bash deploy/update-copytrade-replay.sh
pause
