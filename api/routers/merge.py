import json
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.activity_logger import log_activity
from api.database import get_db
from api.deps import get_current_user
from api.models import Dataset, User
from api.config import settings

router = APIRouter(tags=["merge"])

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from tools.merge_lerobot_datasets import merge_datasets, validate_compatibility  # noqa: E402


def _load_info(path: Path) -> dict:
    with open(path / "meta" / "info.json") as f:
        return json.load(f)


@router.post("/datasets/merge/check")
def check_merge_compatibility(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Pre-merge compatibility check with task mapping preview."""
    dataset_ids: list[int] = body.get("dataset_ids", [])
    if len(dataset_ids) < 2:
        raise HTTPException(status_code=422, detail="Provide at least 2 dataset IDs")

    datasets: list[Dataset] = []
    for did in dataset_ids:
        ds = db.query(Dataset).filter(Dataset.id == did, Dataset.user_id == current_user.id).first()
        if not ds:
            raise HTTPException(status_code=404, detail=f"Dataset {did} not found")
        datasets.append(ds)

    info0 = _load_info(Path(datasets[0].path))
    errors: list[str] = []
    for ds in datasets[1:]:
        info_i = _load_info(Path(ds.path))
        ok, errs = validate_compatibility(info0, info_i)
        if not ok:
            errors.extend(errs)

    all_tasks: list[dict] = []
    seen: set[str] = set()
    for ds in datasets:
        tasks_path = Path(ds.path) / "meta" / "tasks.jsonl"
        if tasks_path.exists():
            with open(tasks_path) as f:
                for line in f:
                    if line.strip():
                        t = json.loads(line)
                        label = t.get("task", "")
                        if label not in seen:
                            seen.add(label)
                            all_tasks.append({"task_index": len(all_tasks), "task": label, "source": ds.name})

    return {
        "compatible": len(errors) == 0,
        "errors": errors,
        "datasets": [{"id": ds.id, "name": ds.name, "episodes": ds.total_episodes, "fps": ds.fps, "robot_type": ds.robot_type} for ds in datasets],
        "merged_tasks": all_tasks,
    }


@router.post("/datasets/merge")
def merge_multiple_datasets(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dataset_ids: list[int] = body.get("dataset_ids", [])
    output_name: str = body.get("output_name", "").strip()

    if len(dataset_ids) < 2:
        raise HTTPException(status_code=422, detail="Provide at least 2 dataset IDs")
    if not output_name:
        raise HTTPException(status_code=422, detail="output_name is required")
    if db.query(Dataset).filter(Dataset.name == output_name, Dataset.user_id == current_user.id).first():
        raise HTTPException(status_code=409, detail=f"Dataset '{output_name}' already exists")

    datasets: list[Dataset] = []
    for did in dataset_ids:
        ds = db.query(Dataset).filter(Dataset.id == did, Dataset.user_id == current_user.id).first()
        if not ds:
            raise HTTPException(status_code=404, detail=f"Dataset {did} not found")
        datasets.append(ds)

    # Validate compatibility between all pairs (first vs rest)
    info0 = _load_info(Path(datasets[0].path))
    for ds in datasets[1:]:
        info_i = _load_info(Path(ds.path))
        ok, errors = validate_compatibility(info0, info_i)
        if not ok:
            raise HTTPException(
                status_code=422,
                detail=f"Incompatible datasets '{datasets[0].name}' and '{ds.name}': {'; '.join(errors)}",
            )

    # Chain merges: ds0 + ds1 → tmp, tmp + ds2 → tmp2, ..., tmpN → output
    import tempfile, shutil
    output_path = settings.DATASET_BASE_PATH / output_name

    current_path = Path(datasets[0].path)
    for i, ds in enumerate(datasets[1:], start=1):
        is_last = (i == len(datasets) - 1)
        if is_last:
            dest = output_path
        else:
            dest = Path(tempfile.mkdtemp(prefix="neotix_merge_"))

        success = merge_datasets(str(current_path), str(ds.path), str(dest))
        if not success:
            raise HTTPException(status_code=500, detail=f"Merge failed at step {i}")

        # Clean up previous temp if not the original
        if i > 1 and current_path.name.startswith("neotix_merge_"):
            shutil.rmtree(current_path, ignore_errors=True)

        current_path = dest

    merged_info = _load_info(output_path)

    from api.routers.datasets import _register_dataset
    new_ds = _register_dataset(db, output_name, output_path, user_id=current_user.id)
    new_ds.source = "merge"

    log_activity(
        db, current_user, "merge_datasets",
        f"Merged {[d.name for d in datasets]} → '{output_name}'",
        dataset_id=new_ds.id,
    )
    db.commit()
    return {
        "output_path": str(output_path),
        "total_episodes": merged_info.get("total_episodes", 0),
        "total_frames": merged_info.get("total_frames", 0),
        "dataset_id": new_ds.id,
    }
