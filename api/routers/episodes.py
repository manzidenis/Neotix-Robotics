import json
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from api.database import get_db
from api.deps import get_current_user, get_current_user_flexible
from api.models import Dataset, EpisodeRecord, User

router = APIRouter(prefix="/episodes", tags=["episodes"])


# Helpers
def _get_active(db: Session, user: User) -> Dataset:
    ds = db.query(Dataset).filter(Dataset.is_active == True, Dataset.user_id == user.id).first()  # noqa: E712
    if not ds:
        raise HTTPException(status_code=400, detail="No active dataset. Activate one first.")
    return ds


def _verify_episode_owner(db: Session, episode_id: int, user: User) -> EpisodeRecord:
    ep = db.query(EpisodeRecord).filter(EpisodeRecord.id == episode_id).first()
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    ds = db.query(Dataset).filter(Dataset.id == ep.dataset_id, Dataset.user_id == user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Episode not found")
    return ep


def _ep_out(ep: EpisodeRecord, db: Session | None = None) -> dict:
    out = {
        "id": ep.id,
        "dataset_id": ep.dataset_id,
        "episode_index": ep.episode_index,
        "status": ep.status,
        "task_label": ep.task_label,
        "task_index": ep.task_index,
        "duration": ep.duration,
        "frame_count": ep.frame_count,
        "created_at": ep.created_at,
        "updated_at": ep.updated_at,
    }
    if db is not None:
        ds = db.query(Dataset).filter(Dataset.id == ep.dataset_id).first()
        if ds:
            out["cameras"] = json.loads(ds.cameras or "[]")
    return out


# Endpoints
@router.get("")
def list_episodes(
    task: str | None = None,
    status: str | None = None,
    sort: str = "episode_index",
    order: str = "asc",
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import or_, cast, String

    ds = _get_active(db, current_user)
    q = db.query(EpisodeRecord).filter(EpisodeRecord.dataset_id == ds.id)

    if task:
        term = task.strip()
        cleaned = term.lower().removeprefix("ep_").lstrip("0") or "0"
        filters = [EpisodeRecord.task_label.ilike(f"%{term}%")]
        filters.append(cast(EpisodeRecord.episode_index, String).contains(cleaned))
        try:
            filters.append(EpisodeRecord.episode_index == int(cleaned))
        except ValueError:
            pass
        q = q.filter(or_(*filters))
    if status:
        q = q.filter(EpisodeRecord.status == status)

    sort_col = getattr(EpisodeRecord, sort, EpisodeRecord.episode_index)
    q = q.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

    total = q.count()
    items = q.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [_ep_out(ep) for ep in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, -(-total // page_size)),
    }


@router.get("/{episode_id}")
def get_episode(episode_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ep = _verify_episode_owner(db, episode_id, current_user)
    return _ep_out(ep, db)


@router.get("/{episode_id}/data")
def get_episode_data(episode_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import numpy as np
    import pandas as pd

    ep = _verify_episode_owner(db, episode_id, current_user)

    ds = db.query(Dataset).filter(Dataset.id == ep.dataset_id).first()
    ds_path = Path(ds.path)
    parquet = ds_path / "data" / "chunk-000" / f"episode_{ep.episode_index:06d}.parquet"
    if not parquet.exists():
        raise HTTPException(status_code=404, detail="Parquet file not found")

    df = pd.read_parquet(parquet)
    states = np.stack(df["observation.state"].values).tolist()
    actions = np.stack(df["action"].values).tolist()
    timestamps = df["timestamp"].values.tolist()

    return {
        "timestamps": timestamps,
        "states": states,
        "actions": actions,
        "joints": len(states[0]) if states else 7,
    }


@router.get("/{episode_id}/video/{camera}")
async def stream_video(episode_id: int, camera: str, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    ep = _verify_episode_owner(db, episode_id, current_user)

    ds = db.query(Dataset).filter(Dataset.id == ep.dataset_id).first()
    ds_path = Path(ds.path)
    video_path = (
        ds_path / "videos" / "chunk-000"
        / f"observation.images.{camera}"
        / f"episode_{ep.episode_index:06d}.mp4"
    )
    if not video_path.exists():
        raise HTTPException(status_code=404, detail=f"Video not found for camera '{camera}'")

    file_size = video_path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        start_str, _, end_str = range_header.replace("bytes=", "").partition("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        async def _iter():
            async with aiofiles.open(video_path, "rb") as f:
                await f.seek(start)
                remaining = chunk_size
                while remaining:
                    read_size = min(65536, remaining)
                    data = await f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            _iter(),
            status_code=206,
            media_type="video/mp4",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    async def _full():
        async with aiofiles.open(video_path, "rb") as f:
            while True:
                chunk = await f.read(65536)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        _full(),
        media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        },
    )
