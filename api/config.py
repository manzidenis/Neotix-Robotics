import os
from pathlib import Path


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://") and "+psycopg" not in url:
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def _parse_cors_origins(raw_value: str | None) -> list[str]:
    if not raw_value or raw_value.strip() == "*":
        return ["*"]
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


class Settings:
    SECRET_KEY: str = os.getenv("SECRET_KEY", "neotix-secret-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24h

    DATABASE_URL: str = _normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///./neotix.db"))
    DATASET_BASE_PATH: Path = Path(os.getenv("DATASET_BASE_PATH", "data"))
    MODELS_PATH: Path = Path("models/i2rt_yam")
    REPLAY_OUTPUT_PATH: Path = Path("data/replays")

    # CORS origins (comma-separated, or * for all)
    CORS_ORIGINS: list[str] = _parse_cors_origins(os.getenv("CORS_ORIGINS", "*"))


settings = Settings()
