@echo off
echo Updating CopyTrade trader amounts and preserving your sizing choices...
wsl.exe --cd "%~dp0." bash deploy/update-start-markets.sh
pause
