import json
import shutil
import zipfile
import io
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.activity_logger import log_activity
from api.database import get_db
from api.deps import get_current_user, get_current_user_flexible
from api.models import Dataset, EpisodeRecord, User
from api.config import settings

router = APIRouter(tags=["qa"])

VALID_STATUSES = {"unreviewed", "validated", "deleted", "flagged"}


def _get_active(db: Session, user: User) -> Dataset:
    ds = db.query(Dataset).filter(Dataset.is_active == True, Dataset.user_id == user.id).first()  # noqa: E712
    if not ds:
        raise HTTPException(status_code=400, detail="No active dataset")
    return ds


# Status & task updates
@router.patch("/episodes/{episode_id}/status")
def set_episode_status(
    episode_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    new_status = body.get("status", "")
    if new_status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {VALID_STATUSES}")

    ep = db.query(EpisodeRecord).filter(EpisodeRecord.id == episode_id).first()
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    ds = db.query(Dataset).filter(Dataset.id == ep.dataset_id, Dataset.user_id == current_user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Episode not found")

    old_status = ep.status
    ep.status = new_status
    log_activity(
        db, current_user, "status_change",
        f"Episode {ep.episode_index}: {old_status} → {new_status}",
        dataset_id=ep.dataset_id, episode_id=ep.id,
    )
    db.commit()
    return {"id": ep.id, "status": ep.status}


@router.patch("/episodes/{episode_id}/task")
def set_episode_task(
    episode_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task_label = body.get("task_label", "")
    ep = db.query(EpisodeRecord).filter(EpisodeRecord.id == episode_id).first()
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    ds = db.query(Dataset).filter(Dataset.id == ep.dataset_id, Dataset.user_id == current_user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Episode not found")

    old_label = ep.task_label
    ep.task_label = task_label
    log_activity(
        db, current_user, "task_rename",
        f"Episode {ep.episode_index}: '{old_label}' → '{task_label}'",
        dataset_id=ep.dataset_id, episode_id=ep.id,
    )
    db.commit()
    return {"id": ep.id, "task_label": ep.task_label}


@router.get("/qa/progress")
def qa_progress(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ds = _get_active(db, current_user)
    rows = (
        db.query(EpisodeRecord.status, func.count(EpisodeRecord.id))
        .filter(EpisodeRecord.dataset_id == ds.id)
        .group_by(EpisodeRecord.status)
        .all()
    )
    counts: dict[str, int] = {"unreviewed": 0, "validated": 0, "deleted": 0, "flagged": 0}
    total = 0
    for status, count in rows:
        counts[status] = count
        total += count
    reviewed = total - counts["unreviewed"]
    return {"total": total, "reviewed": reviewed, **counts}


# Export
@router.post("/qa/export")
def export_validated(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    output_name = body.get("output_name", "").strip()
    if not output_name:
        raise HTTPException(status_code=422, detail="output_name is required")

    episode_ids: list[int] | None = body.get("episode_ids")

    ds = _get_active(db, current_user)
    src = Path(ds.path)

    if episode_ids:
        episodes_to_export = (
            db.query(EpisodeRecord)
            .filter(EpisodeRecord.dataset_id == ds.id, EpisodeRecord.id.in_(episode_ids))
            .order_by(EpisodeRecord.episode_index)
            .all()
        )
    else:
        episodes_to_export = (
            db.query(EpisodeRecord)
            .filter(EpisodeRecord.dataset_id == ds.id, EpisodeRecord.status == "validated")
            .order_by(EpisodeRecord.episode_index)
            .all()
        )
    if not episodes_to_export:
        raise HTTPException(status_code=400, detail="No episodes to export")

    dest = settings.DATASET_BASE_PATH / output_name
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "data" / "chunk-000").mkdir(parents=True, exist_ok=True)
    (dest / "meta").mkdir(parents=True, exist_ok=True)

    # Read original info.json
    with open(src / "meta" / "info.json") as f:
        info = json.load(f)

    # Build task remap
    task_set: dict[str, int] = {}
    next_task_idx = 0
    task_remap: dict[int, int] = {}
    for ep in episodes_to_export:
        if ep.task_label not in task_set:
            task_set[ep.task_label] = next_task_idx
            next_task_idx += 1
        task_remap[ep.task_index] = task_set[ep.task_label]

    total_frames = 0
    new_episodes: list[dict] = []

    for new_idx, ep in enumerate(episodes_to_export):
        # --- Parquet ---
        src_parquet = src / "data" / "chunk-000" / f"episode_{ep.episode_index:06d}.parquet"
        if not src_parquet.exists():
            continue
        df = pd.read_parquet(src_parquet)
        n = len(df)
        df["episode_index"] = new_idx
        df["frame_index"] = range(n)
        df["index"] = range(total_frames, total_frames + n)
        old_ti = df["task_index"].iloc[0] if "task_index" in df.columns else ep.task_index
        new_ti = task_remap.get(int(old_ti), 0)
        df["task_index"] = new_ti
        df.to_parquet(dest / "data" / "chunk-000" / f"episode_{new_idx:06d}.parquet", index=False)

        # --- Videos ---
        cameras = json.loads(ds.cameras or "[]")
        for cam in cameras:
            src_vid = src / "videos" / "chunk-000" / f"observation.images.{cam}" / f"episode_{ep.episode_index:06d}.mp4"
            dest_vid_dir = dest / "videos" / "chunk-000" / f"observation.images.{cam}"
            dest_vid_dir.mkdir(parents=True, exist_ok=True)
            if src_vid.exists():
                shutil.copy2(src_vid, dest_vid_dir / f"episode_{new_idx:06d}.mp4")

        total_frames += n
        new_episodes.append({"episode_index": new_idx, "tasks": [new_ti], "length": n})

    # --- meta/episodes.jsonl ---
    with open(dest / "meta" / "episodes.jsonl", "w") as f:
        for ep_meta in new_episodes:
            f.write(json.dumps(ep_meta) + "\n")

    # --- meta/tasks.jsonl ---
    with open(dest / "meta" / "tasks.jsonl", "w") as f:
        for label, idx in task_set.items():
            f.write(json.dumps({"task_index": idx, "task": label}) + "\n")

    # --- meta/info.json ---
    info["total_episodes"] = len(new_episodes)
    info["total_frames"] = total_frames
    with open(dest / "meta" / "info.json", "w") as f:
        json.dump(info, f, indent=2)

    if not db.query(Dataset).filter(Dataset.name == output_name, Dataset.user_id == current_user.id).first():
        from api.routers.datasets import _register_dataset
        new_ds = _register_dataset(db, output_name, dest, user_id=current_user.id)
        new_ds.source = "export"

    log_activity(
        db, current_user, "export",
        f"Exported {len(new_episodes)} validated episodes as '{output_name}'",
        dataset_id=ds.id,
    )
    db.commit()
    return {
        "output_name": output_name,
        "output_path": str(dest),
        "episodes_exported": len(new_episodes),
        "frames_exported": total_frames,
    }


@router.get("/qa/export/{dataset_name}/download")
def download_exported_dataset(dataset_name: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    dataset_path = settings.DATASET_BASE_PATH / dataset_name
    if not dataset_path.exists() or not dataset_path.is_dir():
        raise HTTPException(status_code=404, detail="Exported dataset not found")

    def _zip_stream():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for file in dataset_path.rglob("*"):
                if file.is_file():
                    zf.write(file, f"{dataset_name}/{file.relative_to(dataset_path)}")
        buf.seek(0)
        yield from iter(lambda: buf.read(65536), b"")

    return StreamingResponse(
        _zip_stream(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{dataset_name}.zip"'},
    )
