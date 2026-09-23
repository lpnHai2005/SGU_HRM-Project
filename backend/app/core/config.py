import os
import json
from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Đường dẫn linh hoạt tới file .env
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(CURRENT_DIR)
BACKEND_DIR = os.path.dirname(APP_DIR)
ENV_PATH = os.path.join(BACKEND_DIR, ".env")

class Settings(BaseSettings):
    PROJECT_NAME: str = "TechZone HRM API"
    API_V1_STR: str = "/api/v1"
    
    # Cấu hình CSDL Supabase PostgreSQL
    DATABASE_URL: str = "postgresql+asyncpg://postgres.ywfarvcehlsbfovovujp:VIENTHONGDEPTRAINHATNHOMAICUNGBIET@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
    SYNC_DATABASE_URL: str = "postgresql://postgres.ywfarvcehlsbfovovujp:VIENTHONGDEPTRAINHATNHOMAICUNGBIET@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
    
    # Cấu hình bảo mật JWT Token
    JWT_SECRET_KEY: str = "techzone_hrm_super_secret_jwt_key_2026_sgu_cnpm_htttdn"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480 # 8 giờ làm việc
    
    # Danh sách tên miền CORS cho phép
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000"
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    model_config = SettingsConfigDict(
        env_file=ENV_PATH if os.path.exists(ENV_PATH) else None,
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
