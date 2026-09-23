@echo off
chcp 65001 > nul
title TechZone HRM - Khoi chay he thong
cd /d "%~dp0"

if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
)

python run.py
pause
