@echo off
REM One-command WorkGuide launcher for Windows cmd/PowerShell.
REM Usage: workguide
REM        workguide --no-browser
REM        workguide --stop

cd /d "%~dp0"
python scripts\launch_workguide.py %*
