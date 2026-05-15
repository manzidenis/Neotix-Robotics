import json
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from api.activity_logger import log_activity
from api.config import settings
from api.database import get_db
from api.deps import get_current_user
from api.models import Dataset, EpisodeRecord, User
from api.storage import (
    dataset_root_uri,
    delete_prefix,
    is_r2_uri,
    join_uri,
    r2_enabled,
    read_text,
    upload_directory,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _resolve_storage_path(root: str | Path, relative_path: str) -> str | Path:
    if is_r2_uri(root):
        return join_uri(str(root), relative_path)
    return Path(root) / relative_path


def _read_storage_lines(root: str | Path, relative_path: str) -> list[str]:
    try:
        return read_text(str(_resolve_storage_path(root, relative_path))).splitlines()
    except FileNotFoundError:
        return []


def _read_dataset_meta(path: str | Path) -> dict:
    try:
        info = json.loads(read_text(str(_resolve_storage_path(path, "meta/info.json"))))
    except FileNotFoundError:
        raise ValueError(f"Not a valid LeRobot v2.1 dataset - missing meta/info.json: {path}")

    state_shape = (
        info.get("features", {})
        .get("observation.state", {})
        .get("shape", [7])
    )
    n_joints = state_shape[0] if state_shape else 7
    robot_type = "bimanual" if n_joints == 14 else "single"

    cameras = [
        key.replace("observation.images.", "")
        for key in info.get("features", {})
        if key.startswith("observation.images.")
    ]

    return {
        "robot_type": robot_type,
        "total_episodes": info.get("total_episodes", 0),
        "total_frames": info.get("total_frames", 0),
        "fps": float(info.get("fps", 30)),
        "cameras": cameras,
    }


def _detect_dataset_root(root: Path) -> Path:
    candidate = root
    while True:
        if (candidate / "meta" / "info.json").exists():
            return candidate

        entries = list(candidate.iterdir())
        dirs = [entry for entry in entries if entry.is_dir()]
        files = [entry for entry in entries if entry.is_file()]
        if len(dirs) == 1 and not files:
            candidate = dirs[0]
            continue
        break

    raise ValueError(f"Not a valid LeRobot v2.1 dataset - missing meta/info.json: {root}")


def _cleanup_storage_path(path: str | Path) -> None:
    if is_r2_uri(path):
        delete_prefix(str(path))
        return
    shutil.rmtree(Path(path), ignore_errors=True)


def _persist_dataset_directory(local_dir: Path, name: str, db: Session, user_id: int) -> Dataset:
    actual = _detect_dataset_root(local_dir)

    if r2_enabled():
        storage_path: str | Path = dataset_root_uri(user_id, name)
        upload_directory(actual, storage_path)
    else:
        storage_path = settings.DATASET_BASE_PATH / name
        if Path(storage_path).exists():
            shutil.rmtree(storage_path, ignore_errors=True)
        shutil.copytree(actual, storage_path)

    try:
        return _register_dataset(db, name, storage_path, user_id=user_id)
    except ValueError:
        _cleanup_storage_path(storage_path)
        raise


def _safe_upload_relative_path(filename: str) -> Path:
    relative = filename.replace("\\", "/").lstrip("/")
    parts = [part for part in PurePosixPath(relative).parts if part not in {"", "."}]
    if not parts or any(part == ".." for part in parts):
        raise HTTPException(status_code=422, detail=f"Invalid uploaded path: {filename!r}")
    return Path(*parts)


def _sync_episodes(db: Session, dataset: Dataset, path: str | Path) -> None:
    tasks: dict[int, str] = {}
    for line in _read_storage_lines(path, "meta/tasks.jsonl"):
        if line.strip():
            task = json.loads(line)
            tasks[task["task_index"]] = task["task"]

    episode_lines = _read_storage_lines(path, "meta/episodes.jsonl")
    if not episode_lines:
        return

    existing_indexes = {
        idx
        for (idx,) in db.query(EpisodeRecord.episode_index)
        .filter(EpisodeRecord.dataset_id == dataset.id)
        .all()
    }

    ep_task_map: dict[int, tuple[str, int]] = {}
    new_records: list[EpisodeRecord] = []
    for line in episode_lines:
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


def _register_dataset(db: Session, name: str, path: str | Path, user_id: int | None = None) -> Dataset:
    meta = _read_dataset_meta(path)
    stored_path = str(path) if is_r2_uri(path) else str(Path(path).resolve())
    ds = Dataset(
        name=name,
        path=stored_path,
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


def _verify_dataset_owner(db: Session, dataset_id: int, user: User) -> Dataset:
    ds = db.query(Dataset).filter(Dataset.id == dataset_id, Dataset.user_id == user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


@router.get("")
def list_datasets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_dataset_out(ds) for ds in db.query(Dataset).filter(Dataset.user_id == current_user.id).all()]


@router.get("/scan")
def scan_datasets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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

    storage_path: str | Path = path
    try:
        actual = _detect_dataset_root(path)
        if r2_enabled():
            storage_path = dataset_root_uri(current_user.id, name)
            upload_directory(actual, storage_path)
        else:
            storage_path = actual
        ds = _register_dataset(db, name, storage_path, user_id=current_user.id)
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

    temp_root = Path(tempfile.mkdtemp(prefix="neotix_upload_"))
    zip_path = temp_root / "upload.zip"
    try:
        with open(zip_path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)

        extract_dir = temp_root / "dataset"
        extract_dir.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(extract_dir)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=422, detail="Uploaded file is not a valid ZIP")

        if r2_enabled():
            ds = _persist_dataset_directory(extract_dir, name, db, current_user.id)
        else:
            ds = _persist_dataset_directory(extract_dir, name, db, current_user.id)

        log_activity(db, current_user, "upload_dataset", f"Uploaded '{name}'", dataset_id=ds.id)
        db.commit()
        return _dataset_out(ds)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


@router.post("/upload-folder")
async def upload_dataset_folder(
    files: list[UploadFile] = File(...),
    name: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not files:
        raise HTTPException(status_code=422, detail="No files were uploaded")

    temp_root = Path(tempfile.mkdtemp(prefix="neotix_folder_upload_"))
    staging_root = temp_root / "dataset"
    staging_root.mkdir(parents=True, exist_ok=True)

    try:
        top_level_names: list[str] = []
        for upload in files:
            relative_path = _safe_upload_relative_path(upload.filename or "")
            top_level_names.append(relative_path.parts[0])
            target_path = staging_root / relative_path
            target_path.parent.mkdir(parents=True, exist_ok=True)

            with open(target_path, "wb") as dest:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    dest.write(chunk)

        inferred_name = name.strip() if name else ""
        if not inferred_name:
            inferred_name = top_level_names[0] if len(set(top_level_names)) == 1 else "uploaded_folder"

        if db.query(Dataset).filter(Dataset.name == inferred_name, Dataset.user_id == current_user.id).first():
            raise HTTPException(status_code=409, detail=f"Dataset '{inferred_name}' already exists")

        try:
            ds = _persist_dataset_directory(staging_root, inferred_name, db, current_user.id)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

        log_activity(db, current_user, "upload_dataset", f"Uploaded folder '{inferred_name}'", dataset_id=ds.id)
        db.commit()
        return _dataset_out(ds)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


@router.get("/{dataset_id}")
def get_dataset(dataset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ds = _verify_dataset_owner(db, dataset_id, current_user)
    out = _dataset_out(ds)

    tasks: dict[int, str] = {}
    for line in _read_storage_lines(ds.path, "meta/tasks.jsonl"):
        if line.strip():
            task = json.loads(line)
            tasks[task["task_index"]] = task["task"]
    out["tasks"] = tasks

    try:
        info = json.loads(read_text(str(_resolve_storage_path(ds.path, "meta/info.json"))))
        out["features"] = info.get("features", {})
    except FileNotFoundError:
        pass

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
    if is_r2_uri(ds.path):
        delete_prefix(ds.path)
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
    _sync_episodes(db, ds, ds.path)
    log_activity(db, current_user, "activate_dataset", f"Activated '{ds.name}'", dataset_id=ds.id)
    db.commit()
    return _dataset_out(ds)
