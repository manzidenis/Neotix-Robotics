import json
import shutil
import zipfile
from datetime import datetime
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.activity_logger import log_activity
from api.database import get_db
from api.deps import get_current_user
from api.models import Dataset, EpisodeRecord, User
from api.config import settings

router = APIRouter(prefix="/datasets", tags=["datasets"])


# Helpers
def _read_dataset_meta(path: Path) -> dict:
    """Read info.json, episodes.jsonl, tasks.jsonl and return combined metadata."""
    info_path = path / "meta" / "info.json"
    if not info_path.exists():
        raise ValueError(f"Not a valid LeRobot v2.1 dataset — missing meta/info.json: {path}")

    with open(info_path) as f:
        info = json.load(f)

    # Detect robot type from state shape
    state_shape = (
        info.get("features", {})
            .get("observation.state", {})
            .get("shape", [7])
    )
    n_joints = state_shape[0] if state_shape else 7
    robot_type = "bimanual" if n_joints == 14 else "single"

    # Camera names
    cameras = [
        k.replace("observation.images.", "")
        for k in info.get("features", {})
        if k.startswith("observation.images.")
    ]

    return {
        "robot_type": robot_type,
        "total_episodes": info.get("total_episodes", 0),
        "total_frames": info.get("total_frames", 0),
        "fps": float(info.get("fps", 30)),
        "cameras": cameras,
    }


def _sync_episodes(db: Session, dataset: Dataset, path: Path) -> None:
    """Create/update EpisodeRecord rows from episodes.jsonl and tasks.jsonl.
    Does NOT commit — caller is responsible for db.commit().
    """
    tasks_path = path / "meta" / "tasks.jsonl"
    tasks: dict[int, str] = {}
    if tasks_path.exists():
        with open(tasks_path) as f:
            for line in f:
                if line.strip():
                    t = json.loads(line)
                    tasks[t["task_index"]] = t["task"]

    episodes_path = path / "meta" / "episodes.jsonl"
    if not episodes_path.exists():
        return

    existing_indexes = {
        idx
        for (idx,) in db.query(EpisodeRecord.episode_index)
        .filter(EpisodeRecord.dataset_id == dataset.id)
        .all()
    }

    ep_task_map: dict[int, tuple[str, int]] = {}
    new_records: list[EpisodeRecord] = []
    with open(episodes_path) as f:
        for line in f:
            if not line.strip():
                continue
            ep = json.loads(line)
            idx = ep.get("episode_index", 0)

            raw_tasks = ep.get("tasks", [])
            first_task = raw_tasks[0] if raw_tasks else None
            if isinstance(first_task, int):
                task_idx = first_task
                task_label = tasks.get(task_idx, "")
            elif isinstance(first_task, str):
                task_label = first_task
                task_idx = next((k for k, v in tasks.items() if v == first_task), 0)
            else:
                task_idx = 0
                task_label = tasks.get(0, "")

            ep_task_map[idx] = (task_label, task_idx)

            if idx in existing_indexes:
                continue
            new_records.append(EpisodeRecord(
                dataset_id=dataset.id,
                episode_index=idx,
                task_label=task_label,
                task_index=task_idx,
                frame_count=ep.get("length", 0),
                duration=ep.get("length", 0) / max(dataset.fps, 1),
            ))

    if new_records:
        db.add_all(new_records)

    blank = (
        db.query(EpisodeRecord)
        .filter(EpisodeRecord.dataset_id == dataset.id, EpisodeRecord.task_label == "")
        .all()
    )
    for rec in blank:
        label, tidx = ep_task_map.get(rec.episode_index, ("", 0))
        if label:
            rec.task_label = label
            rec.task_index = tidx


def _register_dataset(db: Session, name: str, path: Path, user_id: int | None = None) -> Dataset:
    """Register a dataset and sync its episodes.
    Uses flush() to obtain IDs — caller must db.commit().
    """
    meta = _read_dataset_meta(path)
    ds = Dataset(
        name=name,
        path=str(path.resolve()),
        user_id=user_id,
        robot_type=meta["robot_type"],
        total_episodes=meta["total_episodes"],
        total_frames=meta["total_frames"],
        fps=meta["fps"],
        cameras=json.dumps(meta["cameras"]),
    )
    db.add(ds)
    db.flush()
    _sync_episodes(db, ds, path)
    return ds


def _dataset_out(ds: Dataset) -> dict:
    return {
        "id": ds.id,
        "name": ds.name,
        "path": ds.path,
        "is_active": ds.is_active,
        "robot_type": ds.robot_type,
        "total_episodes": ds.total_episodes,
        "total_frames": ds.total_frames,
        "fps": ds.fps,
        "cameras": json.loads(ds.cameras or "[]"),
        "source": ds.source or "original",
        "user_id": ds.user_id,
        "created_at": ds.created_at,
        "updated_at": ds.updated_at,
    }


def _get_active(db: Session, user: User) -> Dataset:
    ds = db.query(Dataset).filter(Dataset.is_active == True, Dataset.user_id == user.id).first()  # noqa: E712
    if not ds:
        raise HTTPException(status_code=400, detail="No active dataset. Activate one first.")
    return ds


def _verify_dataset_owner(db: Session, dataset_id: int, user: User) -> Dataset:
    ds = db.query(Dataset).filter(Dataset.id == dataset_id, Dataset.user_id == user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


# Endpoints
@router.get("")
def list_datasets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_dataset_out(ds) for ds in db.query(Dataset).filter(Dataset.user_id == current_user.id).all()]


@router.get("/scan")
def scan_datasets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Return subdirectories in DATASET_BASE_PATH that look like LeRobot datasets
    but are not yet registered by this user."""
    base = settings.DATASET_BASE_PATH
    registered_paths = {ds.path for ds in db.query(Dataset).filter(Dataset.user_id == current_user.id).all()}
    results = []
    if base.exists():
        for d in sorted(base.iterdir()):
            if d.is_dir() and (d / "meta" / "info.json").exists():
                str_path = str(d)
                if str_path not in registered_paths:
                    results.append({"name": d.name, "path": str_path})
    return results


@router.post("/import")
def import_dataset(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    path = Path(body.get("path", ""))
    name = body.get("name", path.name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")
    if db.query(Dataset).filter(Dataset.name == name, Dataset.user_id == current_user.id).first():
        raise HTTPException(status_code=409, detail=f"Dataset '{name}' already exists")
    try:
        ds = _register_dataset(db, name, path, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    log_activity(db, current_user, "import_dataset", f"Imported '{name}' from {path}", dataset_id=ds.id)
    db.commit()
    return _dataset_out(ds)


@router.post("/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    name: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if db.query(Dataset).filter(Dataset.name == name, Dataset.user_id == current_user.id).first():
        raise HTTPException(status_code=409, detail=f"Dataset '{name}' already exists")

    dest = settings.DATASET_BASE_PATH / name
    dest.mkdir(parents=True, exist_ok=True)

    contents = await file.read()
    try:
        with zipfile.ZipFile(BytesIO(contents)) as zf:
            zf.extractall(dest)
    except zipfile.BadZipFile:
        raise HTTPException(status_code=422, detail="Uploaded file is not a valid ZIP")

    entries = list(dest.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        actual = entries[0]
    else:
        actual = dest

    try:
        ds = _register_dataset(db, name, actual, user_id=current_user.id)
    except ValueError as e:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(e))

    log_activity(db, current_user, "upload_dataset", f"Uploaded '{name}'", dataset_id=ds.id)
    db.commit()
    return _dataset_out(ds)


@router.get("/{dataset_id}")
def get_dataset(dataset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ds = _verify_dataset_owner(db, dataset_id, current_user)
    path = Path(ds.path)
    out = _dataset_out(ds)

    tasks: dict[int, str] = {}
    tasks_path = path / "meta" / "tasks.jsonl"
    if tasks_path.exists():
        with open(tasks_path) as f:
            for line in f:
                if line.strip():
                    t = json.loads(line)
                    tasks[t["task_index"]] = t["task"]
    out["tasks"] = tasks

    info_path = path / "meta" / "info.json"
    if info_path.exists():
        with open(info_path) as f:
            out["features"] = json.load(f).get("features", {})

    return out


@router.patch("/{dataset_id}")
def rename_dataset(
    dataset_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ds = _verify_dataset_owner(db, dataset_id, current_user)
    new_name = body.get("name", "").strip()
    if not new_name:
        raise HTTPException(status_code=422, detail="name is required")
    if db.query(Dataset).filter(Dataset.name == new_name, Dataset.user_id == current_user.id, Dataset.id != dataset_id).first():
        raise HTTPException(status_code=409, detail=f"Name '{new_name}' already in use")
    old_name = ds.name
    ds.name = new_name
    log_activity(db, current_user, "rename_dataset", f"'{old_name}' -> '{new_name}'", dataset_id=ds.id)
    db.commit()
    return _dataset_out(ds)


@router.delete("/{dataset_id}")
def delete_dataset(
    dataset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ds = _verify_dataset_owner(db, dataset_id, current_user)
    if ds.is_active:
        raise HTTPException(status_code=400, detail="Cannot delete the active dataset")
    name = ds.name
    db.query(EpisodeRecord).filter(EpisodeRecord.dataset_id == dataset_id).delete()
    db.delete(ds)
    log_activity(db, current_user, "delete_dataset", f"Deleted '{name}'")
    db.commit()
    return {"detail": f"Dataset '{name}' deleted"}


@router.post("/{dataset_id}/activate")
def activate_dataset(
    dataset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ds = _verify_dataset_owner(db, dataset_id, current_user)
    db.query(Dataset).filter(Dataset.is_active == True, Dataset.user_id == current_user.id).update({"is_active": False})  # noqa: E712
    ds.is_active = True
    _sync_episodes(db, ds, Path(ds.path))
    log_activity(db, current_user, "activate_dataset", f"Activated '{ds.name}'", dataset_id=ds.id)
    db.commit()
    return _dataset_out(ds)
