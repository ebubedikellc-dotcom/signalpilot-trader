@echo off
echo Updating CopyTrade markets and Start controls...
wsl.exe --cd "%~dp0." bash deploy/update-start-markets.sh
pause
