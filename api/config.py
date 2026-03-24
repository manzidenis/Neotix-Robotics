import os
from pathlib import Path


class Settings:
    SECRET_KEY: str = os.getenv("SECRET_KEY", "neotix-secret-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24h

    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./neotix.db")
    DATASET_BASE_PATH: Path = Path(os.getenv("DATASET_BASE_PATH", "data"))
    MODELS_PATH: Path = Path("models/i2rt_yam")
    REPLAY_OUTPUT_PATH: Path = Path("data/replays")

    # CORS origins (comma-separated, or * for all)
    CORS_ORIGINS: list[str] = ["*"]


settings = Settings()
