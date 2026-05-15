import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.database import get_db
from api.deps import get_current_user
from api.models import Dataset, EpisodeRecord, User

router = APIRouter(tags=["stats"])


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ds = db.query(Dataset).filter(Dataset.is_active == True, Dataset.user_id == current_user.id).first()  # noqa: E712
    if not ds:
        raise HTTPException(status_code=400, detail="No active dataset")

    rows = (
        db.query(
            EpisodeRecord.status,
            func.count(EpisodeRecord.id),
            func.coalesce(func.sum(EpisodeRecord.duration), 0.0),
        )
        .filter(EpisodeRecord.dataset_id == ds.id)
        .group_by(EpisodeRecord.status)
        .all()
    )

    status_counts: dict[str, int] = {}
    total = 0
    total_duration = 0.0
    for status, count, duration in rows:
        status_counts[status] = count
        total += count
        total_duration += float(duration)

    return {
        "dataset": {
            "id": ds.id,
            "name": ds.name,
            "robot_type": ds.robot_type,
            "fps": ds.fps,
            "cameras": json.loads(ds.cameras or "[]"),
            "total_episodes": ds.total_episodes,
            "total_frames": ds.total_frames,
        },
        "episodes": {
            "total": total,
            **status_counts,
        },
        "total_duration_seconds": round(total_duration, 2),
    }


@router.get("/tasks")
def list_tasks(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import json
    from pathlib import Path

    from api.storage import is_r2_uri, join_uri, read_text

    ds = db.query(Dataset).filter(Dataset.is_active == True, Dataset.user_id == current_user.id).first()  # noqa: E712
    if not ds:
        raise HTTPException(status_code=400, detail="No active dataset")

    tasks = []
    if is_r2_uri(ds.path):
        try:
            lines = read_text(join_uri(ds.path, "meta/tasks.jsonl")).splitlines()
        except FileNotFoundError:
            lines = []
        for line in lines:
            if line.strip():
                tasks.append(json.loads(line))
    else:
        tasks_path = Path(ds.path) / "meta" / "tasks.jsonl"
        if tasks_path.exists():
            with open(tasks_path) as f:
                for line in f:
                    if line.strip():
                        tasks.append(json.loads(line))
    return tasks
