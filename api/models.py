from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Index, Integer, String, Text,
)

from api.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id             = Column(Integer, primary_key=True, index=True)
    username       = Column(String(64), unique=True, index=True, nullable=False)
    email          = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at     = Column(DateTime, default=_now)


class Dataset(Base):
    __tablename__ = "datasets"

    id             = Column(Integer, primary_key=True, index=True)
    user_id        = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name           = Column(String(255), nullable=False)
    path           = Column(Text, nullable=False)           # absolute or relative path
    is_active      = Column(Boolean, default=False)
    robot_type     = Column(String(16), default="single")  # "single" | "bimanual"
    total_episodes = Column(Integer, default=0)
    total_frames   = Column(Integer, default=0)
    fps            = Column(Float, default=30.0)
    cameras        = Column(Text, default="[]")             # JSON list of camera names
    source         = Column(String(16), default="original") # "original" | "export" | "merge"
    created_at     = Column(DateTime, default=_now)
    updated_at     = Column(DateTime, default=_now, onupdate=_now)


class EpisodeRecord(Base):
    __tablename__ = "episode_records"
    __table_args__ = (
        Index("ix_ep_dataset_index", "dataset_id", "episode_index", unique=True),
        Index("ix_ep_dataset_status", "dataset_id", "status"),
    )

    id            = Column(Integer, primary_key=True, index=True)
    dataset_id    = Column(Integer, ForeignKey("datasets.id"), nullable=False, index=True)
    episode_index = Column(Integer, nullable=False)
    status        = Column(String(16), default="unreviewed", index=True)
    task_label    = Column(Text, default="")
    task_index    = Column(Integer, default=0)
    duration      = Column(Float, default=0.0)
    frame_count   = Column(Integer, default=0)
    created_at    = Column(DateTime, default=_now)
    updated_at    = Column(DateTime, default=_now, onupdate=_now)


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_created", "created_at"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, nullable=True)
    username   = Column(String(64), nullable=False)
    action     = Column(String(64), nullable=False, index=True)
    details    = Column(Text, default="")
    dataset_id = Column(Integer, nullable=True)
    episode_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=_now)


class ReplayJob(Base):
    __tablename__ = "replay_jobs"

    id            = Column(Integer, primary_key=True, index=True)
    episode_id    = Column(Integer, nullable=False, index=True)
    dataset_id    = Column(Integer, nullable=False)
    status        = Column(String(16), default="pending")  # pending/running/done/error
    progress      = Column(Float, default=0.0)             # 0.0–1.0
    output_path   = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at    = Column(DateTime, default=_now)
    updated_at    = Column(DateTime, default=_now, onupdate=_now)


class DatasetUploadJob(Base):
    __tablename__ = "dataset_upload_jobs"

    id             = Column(Integer, primary_key=True, index=True)
    user_id        = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    dataset_name   = Column(String(255), nullable=False)
    source_filename = Column(String(512), nullable=False)
    source_path    = Column(Text, nullable=False)
    upload_id      = Column(String(255), nullable=False)
    file_size      = Column(Integer, default=0)
    status         = Column(String(24), default="initiated", index=True)
    progress       = Column(Float, default=0.0)
    dataset_id     = Column(Integer, nullable=True)
    error_message  = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=_now)
    updated_at     = Column(DateTime, default=_now, onupdate=_now)
