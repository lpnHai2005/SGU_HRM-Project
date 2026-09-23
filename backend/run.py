import uvicorn
import os
import sys

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Đảm bảo đường dẫn thư mục hiện tại nằm trong sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

if __name__ == "__main__":
    print("=" * 60)
    print(" KHỞI ĐỘNG MÁY CHỦ TECHZONE HRM BACKEND (FASTAPI)")
    print(" Địa chỉ truy cập API : http://127.0.0.1:8000")
    print(" Tài liệu Swagger UI  : http://127.0.0.1:8000/docs")
    print(" Tài liệu ReDoc       : http://127.0.0.1:8000/redoc")
    print("=" * 60)
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
