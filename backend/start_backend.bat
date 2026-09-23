@echo off
chcp 65001 > nul
title TechZone HRM - FastAPI Backend Server
echo ======================================================================
echo    HỆ THỐNG QUẢN LÝ NHÂN SỰ TECHZONE HRM - BACKEND SERVER
echo    Khởi chạy bởi: Huỳnh Viễn Thông (Nhóm trưởng)
echo ======================================================================
echo.
cd /d "%~dp0"

echo [1/2] Đang kiểm tra môi trường Python...
python --version
if errorlevel 1 (
    echo [LỖI] Không tìm thấy Python! Vui lòng cài đặt Python 3.11+.
    pause
    exit /b
)

echo.
echo [2/2] Đang khởi động máy chủ FastAPI Uvicorn trên cổng 8000...
echo Truy cập Swagger UI tại: http://localhost:8000/docs
echo.
python run.py

pause
