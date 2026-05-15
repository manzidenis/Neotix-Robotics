from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session

from api.config import settings
from api.database import get_db
from api.models import Dataset
from api.storage import is_r2_uri, join_uri, object_exists, presigned_url, r2_enabled

router = APIRouter(tags=["assets"])


def _normalize_asset_path(asset_path: str) -> str:
    rel = asset_path.replace("\\", "/").lstrip("/")
    parts = [part for part in PurePosixPath(rel).parts if part not in {"", "."}]
    if not parts or any(part == ".." for part in parts):
        raise HTTPException(status_code=404, detail="Asset not found")
    return "/".join(parts)


def _resolve_local_asset(relative_path: str) -> Path | None:
    candidate = settings.DATASET_BASE_PATH.joinpath(*relative_path.split("/"))
    return candidate if candidate.is_file() else None


def _resolve_public_r2_asset(relative_path: str) -> str | None:
    prefix = settings.R2_PUBLIC_DATASET_PREFIX.strip("/")
    if not prefix or not r2_enabled():
        return None
    uri = f"r2://{settings.R2_BUCKET}/{prefix}/{relative_path}"
    return uri if object_exists(uri) else None


def _resolve_demo_dataset_asset(relative_path: str, db: Session) -> str | Path | None:
    parts = relative_path.split("/")
    if len(parts) < 2:
        return None

    dataset_name = parts[0]
    if dataset_name not in settings.PUBLIC_DEMO_DATASET_NAMES:
        return None

    ds = (
        db.query(Dataset)
        .filter(Dataset.name == dataset_name)
        .order_by(Dataset.id.asc())
        .first()
    )
    if not ds:
        return None

    dataset_relative = "/".join(parts[1:])
    if is_r2_uri(ds.path):
        candidate = join_uri(ds.path, dataset_relative)
        return candidate if object_exists(candidate) else None

    candidate = Path(ds.path).joinpath(*dataset_relative.split("/"))
    return candidate if candidate.is_file() else None


@router.get("/data/{asset_path:path}")
def get_data_asset(asset_path: str, db: Session = Depends(get_db)):
    relative_path = _normalize_asset_path(asset_path)

    local_asset = _resolve_local_asset(relative_path)
    if local_asset is not None:
        return FileResponse(local_asset)

    public_r2_asset = _resolve_public_r2_asset(relative_path)
    if public_r2_asset is not None:
        return RedirectResponse(presigned_url(public_r2_asset), status_code=307)

    demo_asset = _resolve_demo_dataset_asset(relative_path, db)
    if demo_asset is not None:
        if is_r2_uri(demo_asset):
            return RedirectResponse(presigned_url(str(demo_asset)), status_code=307)
        return FileResponse(demo_asset)

    raise HTTPException(status_code=404, detail="Asset not found")
