from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from api.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA cache_size=-32000")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables (call once at startup)."""
    from api import models  # noqa: F401 — registers models with Base
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _run_migrations() -> None:
    """Lightweight migration: add columns that may be missing in existing DBs."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("datasets")} if insp.has_table("datasets") else set()
    with engine.begin() as conn:
        if "source" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN source VARCHAR(16) DEFAULT 'original'"))
        if "user_id" not in cols:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN user_id INTEGER REFERENCES users(id)"))
            conn.execute(text("UPDATE datasets SET user_id = (SELECT MIN(id) FROM users) WHERE user_id IS NULL"))

        # Drop the unique constraint on datasets.name so different users can
        # have datasets with the same name (SQLite requires table recreation).
        has_name_unique = False
        if insp.has_table("datasets"):
            row = conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='datasets'"
            )).fetchone()
            if row and row[0] and "UNIQUE" in row[0].upper():
                has_name_unique = True

        if has_name_unique:
            conn.execute(text("""
                CREATE TABLE datasets_new (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    name VARCHAR(255) NOT NULL,
                    path TEXT NOT NULL,
                    is_active BOOLEAN DEFAULT 0,
                    robot_type VARCHAR(16) DEFAULT 'single',
                    total_episodes INTEGER DEFAULT 0,
                    total_frames INTEGER DEFAULT 0,
                    fps FLOAT DEFAULT 30.0,
                    cameras TEXT DEFAULT '[]',
                    source VARCHAR(16) DEFAULT 'original',
                    created_at DATETIME,
                    updated_at DATETIME
                )
            """))
            conn.execute(text("""
                INSERT INTO datasets_new
                SELECT id, user_id, name, path, is_active, robot_type,
                       total_episodes, total_frames, fps, cameras, source,
                       created_at, updated_at
                FROM datasets
            """))
            conn.execute(text("DROP TABLE datasets"))
            conn.execute(text("ALTER TABLE datasets_new RENAME TO datasets"))
            conn.execute(text("CREATE INDEX ix_datasets_id ON datasets (id)"))
            conn.execute(text("CREATE INDEX ix_datasets_user_id ON datasets (user_id)"))
