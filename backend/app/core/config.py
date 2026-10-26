import os
import json
from datetime import date
from typing import Literal, Optional
from typing import List, Union
from pydantic import ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Đường dẫn linh hoạt tới file .env
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(CURRENT_DIR)
BACKEND_DIR = os.path.dirname(APP_DIR)
ENV_PATH = os.path.join(BACKEND_DIR, ".env")

class Settings(BaseSettings):
    # Leave disabled until the project owner approves a Vietnam business-date cutoff.
    OT_REGISTRATION_POLICY_MODE: Literal["DISABLED", "LEGACY_ONLY_BEFORE_CUTOFF", "NEW_PERIOD_HOLD"] = "DISABLED"
    OT_REGISTRATION_POLICY_EFFECTIVE_FROM: Optional[date] = None

    @model_validator(mode="after")
    def validate_ot_registration_policy(self):
        if self.OT_REGISTRATION_POLICY_MODE != "DISABLED" and self.OT_REGISTRATION_POLICY_EFFECTIVE_FROM is None:
            raise ValueError("OT_REGISTRATION_POLICY_EFFECTIVE_FROM is required when OT policy is enabled")
        return self
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""
    TRACKASIA_API_KEY: str = ""
    PROJECT_NAME: str = "TechZone HRM API"
    API_V1_STR: str = "/api/v1"

    # Mistral AI & LangChain / LangSmith Configuration
    MISTRAL_API_KEY: str = ""
    MISTRAL_CHAT_MODEL: str = "ministral-14b-2512"  # Đổi model tại đây (ví dụ: mistral-small-latest, mistral-large-latest, open-mistral-nemo, codestral-latest)
    MISTRAL_EMBED_MODEL: str = "mistral-embed-2312"   # Model tạo vector 1024 chiều
    MISTRAL_TEMPERATURE: float = 0.1
    LANGCHAIN_API_KEY: str = ""
    LANGSMITH_API_KEY: str = ""
    LANGCHAIN_PROJECT: str = "hrm-rag-chatbot"
    LANGSMITH_PROJECT: str = ""
    LANGCHAIN_ENDPOINT: str = "https://api.smith.langchain.com"
    LANGSMITH_ENDPOINT: str = ""
    LANGCHAIN_TRACING_V2: str = "true"
    LANGSMITH_TRACING: str = "true"

    @model_validator(mode="after")
    def sync_langsmith_tracing(self):
        api_key = self.LANGSMITH_API_KEY or self.LANGCHAIN_API_KEY
        if api_key:
            os.environ["LANGCHAIN_API_KEY"] = api_key
            os.environ["LANGSMITH_API_KEY"] = api_key
            os.environ["LANGCHAIN_TRACING_V2"] = "true"
            os.environ["LANGSMITH_TRACING"] = "true"

            project = self.LANGSMITH_PROJECT or self.LANGCHAIN_PROJECT or "hrm-rag-chatbot"
            os.environ["LANGCHAIN_PROJECT"] = project
            os.environ["LANGSMITH_PROJECT"] = project

            endpoint = self.LANGSMITH_ENDPOINT or self.LANGCHAIN_ENDPOINT or "https://api.smith.langchain.com"
            os.environ["LANGCHAIN_ENDPOINT"] = endpoint
            os.environ["LANGSMITH_ENDPOINT"] = endpoint
        return self

    @field_validator("DATABASE_URL", "SYNC_DATABASE_URL", "JWT_SECRET_KEY", mode="before")
    @classmethod
    def require_security_configuration(cls, value):
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Required backend setting must not be empty")
        return value.strip()

    # Database credentials and JWT signing key must come from environment/secrets.
    
    # Cấu hình CSDL Supabase PostgreSQL
    DATABASE_URL: str
    SYNC_DATABASE_URL: str
    
    # Cấu hình bảo mật JWT Token
    JWT_SECRET_KEY: str
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
    # Exact LAN development origin used by frontend-web; keep this narrow.
    CORS_ORIGIN_REGEX: str = r"^http://192\.168\.1\.224:3000$"

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

def _load_settings(env_file=ENV_PATH) -> Settings:
    try:
        return Settings(_env_file=env_file)
    except ValidationError as exc:
        invalid_fields = sorted({str(error["loc"][0]) for error in exc.errors() if error.get("loc")})
        names = ", ".join(invalid_fields) if invalid_fields else "backend settings"
        raise RuntimeError(
            f"Missing or invalid required backend configuration: {names}. "
            "Set values in backend/.env for local development or in the deployment secret manager."
        ) from None


settings = _load_settings()
