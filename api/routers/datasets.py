import json
import math
import shutil
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import as_completed
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from api.activity_logger import log_activity
from api.config import settings
from api.database import SessionLocal, get_db
from api.deps import get_current_user
from api.models import Dataset, DatasetUploadJob, EpisodeRecord, User
from api.storage import (
    abort_multipart_upload,
    complete_multipart_upload,
    create_multipart_upload,
    dataset_root_uri,
    delete_prefix,
    delete_object,
    download_file,
    is_r2_uri,
    join_uri,
    open_zip,
    object_exists,
    presign_put_object,
    presign_upload_part,
    r2_enabled,
    read_text,
    upload_archive_uri,
    upload_directory,
    upload_fileobj,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])
_ingest_executor = ThreadPoolExecutor(max_workers=2)


def _temp_root() -> Path:
    settings.TEMP_WORK_PATH.mkdir(parents=True, exist_ok=True)
    return settings.TEMP_WORK_PATH


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


def _detect_dataset_root_in_archive(names: list[str]) -> PurePosixPath:
    normalized = {
        str(PurePosixPath(name.replace("\\", "/"))): PurePosixPath(name.replace("\\", "/"))
        for name in names
        if name and not name.endswith("/")
    }
    candidates: list[PurePosixPath] = []
    for path in normalized.values():
        if len(path.parts) >= 2 and path.parts[-2:] == ("meta", "info.json"):
            candidates.append(path.parent.parent)

    if not candidates:
        raise ValueError("Not a valid LeRobot v2.1 dataset - missing meta/info.json in ZIP archive")

    candidates.sort(key=lambda item: len(item.parts))
    return candidates[0]


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


def _persist_dataset_archive(source_path: str, name: str, db: Session, user_id: int, progress_job: DatasetUploadJob | None = None) -> Dataset:
    storage_path: str | Path = dataset_root_uri(user_id, name) if r2_enabled() else settings.DATASET_BASE_PATH / name
    uploaded = False
    try:
        with open_zip(source_path) as zf:
            file_infos = [info for info in zf.infolist() if not info.is_dir()]
            archive_root = _detect_dataset_root_in_archive([info.filename for info in file_infos])
            dataset_infos = [info for info in file_infos if PurePosixPath(info.filename.replace("\\", "/")).is_relative_to(archive_root)]
            total_uncompressed = sum(max(0, info.file_size) for info in dataset_infos) or 1
            processed_uncompressed = 0
            uploaded = True

            if is_r2_uri(storage_path):
                def upload_member(member_name: str, file_size: int) -> int:
                    archive_member = PurePosixPath(member_name.replace("\\", "/"))
                    relative_path = archive_member.relative_to(archive_root)
                    target_uri = join_uri(str(storage_path), relative_path.as_posix())
                    with open_zip(source_path) as worker_zip:
                        with worker_zip.open(member_name) as member_stream:
                            upload_fileobj(member_stream, target_uri)
                    return max(0, file_size)

                max_workers = max(1, min(settings.R2_INGEST_MAX_CONCURRENCY, len(dataset_infos)))
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    futures = [
                        executor.submit(upload_member, info.filename, info.file_size)
                        for info in dataset_infos
                    ]
                    for future in as_completed(futures):
                        processed_uncompressed += future.result()
                        if progress_job is not None:
                            progress_job.progress = 0.3 + (processed_uncompressed / total_uncompressed) * 0.55
                            db.commit()
            else:
                actual_root = Path(storage_path)
                if actual_root.exists():
                    shutil.rmtree(actual_root, ignore_errors=True)
                actual_root.mkdir(parents=True, exist_ok=True)
                for info in dataset_infos:
                    archive_member = PurePosixPath(info.filename.replace("\\", "/"))
                    relative_path = Path(*archive_member.relative_to(archive_root).parts)
                    target_path = actual_root / relative_path
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(info) as member_stream, open(target_path, "wb") as dest:
                        shutil.copyfileobj(member_stream, dest, length=1024 * 1024)
                    processed_uncompressed += max(0, info.file_size)
                    if progress_job is not None:
                        progress_job.progress = 0.3 + (processed_uncompressed / total_uncompressed) * 0.55
                        db.commit()

        uploaded = True
        return _register_dataset(db, name, storage_path, user_id=user_id)
    except ValueError:
        if uploaded:
            _cleanup_storage_path(storage_path)
        raise
    except Exception:
        if uploaded:
            _cleanup_storage_path(storage_path)
        raise


def _safe_upload_relative_path(filename: str) -> Path:
    relative = filename.replace("\\", "/").lstrip("/")
    parts = [part for part in PurePosixPath(relative).parts if part not in {"", "."}]
    if not parts or any(part == ".." for part in parts):
        raise HTTPException(status_code=422, detail=f"Invalid uploaded path: {filename!r}")
    return Path(*parts)


def _dataset_root_storage_path(user_id: int, dataset_name: str) -> str | Path:
    if r2_enabled():
        return dataset_root_uri(user_id, dataset_name)
    return settings.DATASET_BASE_PATH / dataset_name


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


def _upload_job_out(job: DatasetUploadJob) -> dict:
    part_size_bytes = max(5, settings.R2_MULTIPART_PART_SIZE_MB) * 1024 * 1024
    total_parts = max(1, math.ceil((job.file_size or 0) / part_size_bytes)) if job.file_size else 1
    return {
        "id": job.id,
        "dataset_name": job.dataset_name,
        "source_filename": job.source_filename,
        "status": job.status,
        "progress": round(job.progress * 100),
        "dataset_id": job.dataset_id,
        "error_message": job.error_message,
        "part_size_bytes": part_size_bytes,
        "total_parts": total_parts,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _run_dataset_ingest(job_id: int) -> None:
    db = SessionLocal()
    temp_root: Path | None = None
    try:
        job = db.query(DatasetUploadJob).filter(DatasetUploadJob.id == job_id).first()
        if not job:
            return

        job.status = "processing"
        job.progress = 0.05
        job.error_message = None
        db.commit()

        if db.query(Dataset).filter(Dataset.name == job.dataset_name, Dataset.user_id == job.user_id).first():
            raise RuntimeError(f"Dataset '{job.dataset_name}' already exists")

        if is_r2_uri(job.source_path):
            job.progress = 0.2
            db.commit()
            try:
                ds = _persist_dataset_archive(job.source_path, job.dataset_name, db, job.user_id, progress_job=job)
            except zipfile.BadZipFile as exc:
                raise RuntimeError("Uploaded file is not a valid ZIP archive") from exc
        else:
            temp_root = Path(tempfile.mkdtemp(prefix="neotix_ingest_", dir=_temp_root()))
            archive_path = temp_root / job.source_filename
            download_file(job.source_path, archive_path)

            job.progress = 0.25
            db.commit()

            extract_dir = temp_root / "dataset"
            extract_dir.mkdir(parents=True, exist_ok=True)
            try:
                with zipfile.ZipFile(archive_path) as zf:
                    zf.extractall(extract_dir)
            except zipfile.BadZipFile as exc:
                raise RuntimeError("Uploaded file is not a valid ZIP archive") from exc

            job.progress = 0.55
            db.commit()

            ds = _persist_dataset_directory(extract_dir, job.dataset_name, db, job.user_id)

        job.progress = 0.9
        db.commit()

        log_activity(db, db.query(User).filter(User.id == job.user_id).first(), "upload_dataset", f"Uploaded '{job.dataset_name}'", dataset_id=ds.id)
        job.dataset_id = ds.id
        job.status = "done"
        job.progress = 1.0
        db.commit()

        delete_object(job.source_path)
    except Exception as exc:
        db.rollback()
        job = db.query(DatasetUploadJob).filter(DatasetUploadJob.id == job_id).first()
        if job:
            job.status = "error"
            job.error_message = str(exc)
            db.commit()
    finally:
        if temp_root is not None:
            shutil.rmtree(temp_root, ignore_errors=True)
        db.close()


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

    temp_root = Path(tempfile.mkdtemp(prefix="neotix_upload_", dir=_temp_root()))
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

    temp_root = Path(tempfile.mkdtemp(prefix="neotix_folder_upload_", dir=_temp_root()))
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


@router.post("/folder-upload/prepare")
def prepare_direct_folder_upload(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not r2_enabled():
        raise HTTPException(status_code=400, detail="Direct folder uploads require R2 storage to be configured")

    dataset_name = str(body.get("dataset_name", "")).strip()
    raw_files = body.get("files", [])
    if not dataset_name:
        raise HTTPException(status_code=422, detail="dataset_name is required")
    if not isinstance(raw_files, list) or not raw_files:
        raise HTTPException(status_code=422, detail="files are required")
    if db.query(Dataset).filter(Dataset.name == dataset_name, Dataset.user_id == current_user.id).first():
        raise HTTPException(status_code=409, detail=f"Dataset '{dataset_name}' already exists")

    storage_path = str(_dataset_root_storage_path(current_user.id, dataset_name))
    delete_prefix(storage_path)

    uploads: list[dict[str, str]] = []
    saw_meta_info = False
    for item in raw_files:
        relative_path = _safe_upload_relative_path(str(item.get("relative_path", "")))
        content_type = str(item.get("content_type", "") or "application/octet-stream")
        target_uri = join_uri(storage_path, relative_path.as_posix())
        if relative_path.as_posix() == "meta/info.json":
            saw_meta_info = True
        uploads.append({
            "relative_path": relative_path.as_posix(),
            "url": presign_put_object(target_uri, content_type=content_type),
        })

    if not saw_meta_info:
        raise HTTPException(status_code=422, detail="Folder upload must include meta/info.json at the dataset root")

    return {
        "dataset_name": dataset_name,
        "target_path": storage_path,
        "uploads": uploads,
    }


@router.post("/folder-upload/complete")
def complete_direct_folder_upload(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dataset_name = str(body.get("dataset_name", "")).strip()
    if not dataset_name:
        raise HTTPException(status_code=422, detail="dataset_name is required")
    if db.query(Dataset).filter(Dataset.name == dataset_name, Dataset.user_id == current_user.id).first():
        raise HTTPException(status_code=409, detail=f"Dataset '{dataset_name}' already exists")

    storage_path = _dataset_root_storage_path(current_user.id, dataset_name)
    info_path = _resolve_storage_path(storage_path, "meta/info.json")
    if not object_exists(str(info_path)):
        _cleanup_storage_path(storage_path)
        raise HTTPException(status_code=422, detail="Uploaded folder is missing meta/info.json")

    try:
        ds = _register_dataset(db, dataset_name, storage_path, user_id=current_user.id)
    except ValueError as exc:
        _cleanup_storage_path(storage_path)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        _cleanup_storage_path(storage_path)
        raise

    log_activity(db, current_user, "upload_dataset", f"Uploaded folder '{dataset_name}'", dataset_id=ds.id)
    db.commit()
    return _dataset_out(ds)


@router.post("/folder-upload/abort")
def abort_direct_folder_upload(
    body: dict,
    current_user: User = Depends(get_current_user),
):
    dataset_name = str(body.get("dataset_name", "")).strip()
    if not dataset_name:
        raise HTTPException(status_code=422, detail="dataset_name is required")

    storage_path = _dataset_root_storage_path(current_user.id, dataset_name)
    _cleanup_storage_path(storage_path)
    return {"detail": f"Cleared upload for '{dataset_name}'"}


@router.post("/upload-jobs/init")
def init_dataset_upload_job(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not r2_enabled():
        raise HTTPException(status_code=400, detail="Direct uploads require R2 storage to be configured")

    dataset_name = str(body.get("dataset_name", "")).strip()
    filename = str(body.get("filename", "")).strip()
    file_size = int(body.get("file_size", 0) or 0)
    content_type = str(body.get("content_type", "")).strip() or "application/zip"

    if not dataset_name:
        raise HTTPException(status_code=422, detail="dataset_name is required")
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=422, detail="Only ZIP uploads are supported")
    if file_size <= 0:
        raise HTTPException(status_code=422, detail="file_size must be greater than 0")
    if db.query(Dataset).filter(Dataset.name == dataset_name, Dataset.user_id == current_user.id).first():
        raise HTTPException(status_code=409, detail=f"Dataset '{dataset_name}' already exists")

    source_path = upload_archive_uri(current_user.id, filename)
    upload_id = create_multipart_upload(source_path, content_type=content_type)
    job = DatasetUploadJob(
        user_id=current_user.id,
        dataset_name=dataset_name,
        source_filename=Path(filename).name,
        source_path=source_path,
        upload_id=upload_id,
        file_size=file_size,
        status="initiated",
        progress=0.0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _upload_job_out(job)


@router.post("/upload-jobs/{job_id}/parts")
def sign_dataset_upload_part(
    job_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(DatasetUploadJob).filter(DatasetUploadJob.id == job_id, DatasetUploadJob.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    if job.status != "initiated":
        raise HTTPException(status_code=409, detail=f"Upload job is already {job.status}")

    part_number = int(body.get("part_number", 0) or 0)
    if part_number <= 0:
        raise HTTPException(status_code=422, detail="part_number must be greater than 0")

    return {"url": presign_upload_part(job.source_path, job.upload_id, part_number)}


@router.post("/upload-jobs/{job_id}/complete")
def complete_dataset_upload_job(
    job_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(DatasetUploadJob).filter(DatasetUploadJob.id == job_id, DatasetUploadJob.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    if job.status != "initiated":
        raise HTTPException(status_code=409, detail=f"Upload job is already {job.status}")

    raw_parts = body.get("parts", [])
    if not raw_parts:
        raise HTTPException(status_code=422, detail="parts are required to complete the upload")

    parts: list[dict[str, int | str]] = []
    for item in raw_parts:
        try:
            part_number = int(item["part_number"])
            etag = str(item["etag"]).strip()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail="Each part must include part_number and etag") from exc
        if not etag:
            raise HTTPException(status_code=422, detail="Each part must include a non-empty etag")
        parts.append({"PartNumber": part_number, "ETag": etag})

    complete_multipart_upload(job.source_path, job.upload_id, parts)
    if not object_exists(job.source_path):
        raise HTTPException(status_code=500, detail="Upload completed but the archive object could not be found")

    job.status = "uploaded"
    job.progress = 0.01
    db.commit()

    _ingest_executor.submit(_run_dataset_ingest, job.id)
    db.refresh(job)
    return _upload_job_out(job)


@router.post("/upload-jobs/{job_id}/abort")
def abort_dataset_upload_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(DatasetUploadJob).filter(DatasetUploadJob.id == job_id, DatasetUploadJob.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    if job.status != "initiated":
        raise HTTPException(status_code=409, detail=f"Cannot abort an upload job that is {job.status}")

    abort_multipart_upload(job.source_path, job.upload_id)
    job.status = "aborted"
    job.error_message = "Cancelled by user"
    db.commit()
    return _upload_job_out(job)


@router.get("/upload-jobs/{job_id}")
def get_dataset_upload_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.query(DatasetUploadJob).filter(DatasetUploadJob.id == job_id, DatasetUploadJob.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    return _upload_job_out(job)


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
