"""
Storage Service for TechZone HRM
Quản lý upload và lưu trữ file chứng từ, hợp đồng, đơn thôi việc.
- Ưu tiên upload trực tiếp lên Cloudinary qua REST API (không phụ thuộc SDK python-cloudinary).
- Tự động fallback lưu cục bộ trong thư mục /uploads nếu Cloudinary chưa cấu hình hoặc mất kết nối.
"""
import os
import time
import hashlib
import logging
from uuid import uuid4
import httpx
from app.core.config import settings

logger = logging.getLogger("techzone_hrm.storage")

async def upload_file_to_storage(
    content: bytes,
    filename: str,
    folder: str = "general",
    content_type: str = "application/octet-stream"
) -> str:
    """
    Upload file lên Cloudinary hoặc local storage fallback.
    
    Returns:
        URL truy cập tệp an toàn (https://res.cloudinary.com/... hoặc /uploads/...)
    """
    cloud_name = settings.CLOUDINARY_CLOUD_NAME or os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = settings.CLOUDINARY_API_KEY or os.getenv("CLOUDINARY_API_KEY")
    api_secret = settings.CLOUDINARY_API_SECRET or os.getenv("CLOUDINARY_API_SECRET")

    # 1. Thử tải lên Cloudinary nếu đầy đủ thông tin xác thực
    if all([cloud_name, api_key, api_secret]):
        try:
            timestamp = int(time.time())
            nonce = str(uuid4())[:8]
            safe_folder = folder.strip("/")
            
            is_image = any(img_t in (content_type or "").lower() for img_t in ["image/jpeg", "image/png", "image/webp", "image/gif"])
            resource_type = "image" if is_image else "raw"
            
            ext = os.path.splitext(filename)[1] or (".pdf" if "pdf" in (content_type or "") else "")
            if is_image:
                public_id = f"techzone/{safe_folder}/{timestamp}_{nonce}"
            else:
                public_id = f"techzone/{safe_folder}/{timestamp}_{nonce}{ext}"

            raw_to_sign = f"public_id={public_id}&timestamp={timestamp}{api_secret}"
            signature = hashlib.sha1(raw_to_sign.encode()).hexdigest()

            upload_url = f"https://api.cloudinary.com/v1_1/{cloud_name}/{resource_type}/upload"

            async with httpx.AsyncClient(timeout=45.0) as client:
                res = await client.post(
                    upload_url,
                    data={
                        "api_key": api_key,
                        "timestamp": str(timestamp),
                        "public_id": public_id,
                        "signature": signature
                    },
                    files={"file": (filename, content, content_type)}
                )

                if res.status_code == 200:
                    res_data = res.json()
                    secure_url = res_data.get("secure_url") or res_data.get("url")
                    if secure_url:
                        logger.info(f"-> Upload file lên Cloudinary thành công: {secure_url}")
                        return secure_url
                else:
                    logger.warning(f"-> Cloudinary trả về mã lỗi {res.status_code}: {res.text}. Chuyển sang lưu cục bộ.")
        except Exception as exc:
            logger.warning(f"-> Lỗi khi kết nối Cloudinary ({exc}). Chuyển sang lưu cục bộ.")

    # 2. Fallback: Lưu vào thư mục uploads cục bộ trên máy chủ
    try:
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        upload_dir = os.path.join(backend_dir, "uploads", folder)
        os.makedirs(upload_dir, exist_ok=True)

        ext = os.path.splitext(filename)[1] or (".pdf" if "pdf" in (content_type or "") else ".bin")
        unique_name = f"{int(time.time())}_{str(uuid4())[:8]}{ext}"
        filepath = os.path.join(upload_dir, unique_name)

        with open(filepath, "wb") as f:
            f.write(content)

        local_url = f"/uploads/{folder}/{unique_name}"
        logger.info(f"-> Đã lưu file cục bộ tại: {filepath} -> URL: {local_url}")
        return local_url
    except Exception as exc:
        logger.error(f"-> Lỗi khi lưu file cục bộ: {exc}")
        raise exc
