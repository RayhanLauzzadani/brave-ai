from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BRAVE AI API"
    environment: str = "development"
    api_prefix: str = "/api"

    database_url: str = (
        "postgresql+asyncpg://brave:brave_password@localhost:5432/brave_ai"
    )
    redis_url: str = "redis://localhost:6379/0"

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://192.168.110.211:3000",
    ]
    media_base_url: str = "http://localhost:8000/media"
    media_hls_base_url: str = "http://localhost:8888"
    media_recordings_dir: str = "/recordings"
    media_record_segment_duration_seconds: int = 10
    secret_key: str = "change-this-development-key"
    access_token_expire_minutes: int = 1440

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
