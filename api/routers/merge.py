import json
import shutil
import sys
import tempfile
from contextlib import ExitStack
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.activity_logger import log_activity
from api.config import settings
from api.database import get_db
from api.deps import get_current_user
from api.models import Dataset, User
from api.storage import dataset_root_uri, materialize_dataset, r2_enabled, upload_directory

router = APIRouter(tags=["merge"])

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from tools.merge_lerobot_datasets import merge_datasets, validate_compatibility  # noqa: E402


def _load_info(path: Path) -> dict:
    with open(path / "meta" / "info.json") as f:
        return json.load(f)


def _owned_datasets(dataset_ids: list[int], db: Session, user: User) -> list[Dataset]:
    datasets: list[Dataset] = []
    for did in dataset_ids:
        ds = db.query(Dataset).filter(Dataset.id == did, Dataset.user_id == user.id).first()
        if not ds:
            raise HTTPException(status_code=404, detail=f"Dataset {did} not found")
        datasets.append(ds)
    return datasets


@router.post("/datasets/merge/check")
def check_merge_compatibility(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dataset_ids: list[int] = body.get("dataset_ids", [])
    if len(dataset_ids) < 2:
        raise HTTPException(status_code=422, detail="Provide at least 2 dataset IDs")

    datasets = _owned_datasets(dataset_ids, db, current_user)

    with ExitStack() as stack:
        local_paths = [stack.enter_context(materialize_dataset(ds.path)) for ds in datasets]

        info0 = _load_info(local_paths[0])
        errors: list[str] = []
        for local_path in local_paths[1:]:
            info_i = _load_info(local_path)
            ok, errs = validate_compatibility(info0, info_i)
            if not ok:
                errors.extend(errs)

        all_tasks: list[dict] = []
        seen: set[str] = set()
        for ds, local_path in zip(datasets, local_paths):
            tasks_path = local_path / "meta" / "tasks.jsonl"
            if not tasks_path.exists():
                continue
            with open(tasks_path) as f:
                for line in f:
                    if not line.strip():
                        continue
                    task = json.loads(line)
                    label = task.get("task", "")
                    if label and label not in seen:
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

    datasets = _owned_datasets(dataset_ids, db, current_user)

    with ExitStack() as stack:
        local_paths = [stack.enter_context(materialize_dataset(ds.path)) for ds in datasets]

        info0 = _load_info(local_paths[0])
        for ds, local_path in zip(datasets[1:], local_paths[1:]):
            info_i = _load_info(local_path)
            ok, errors = validate_compatibility(info0, info_i)
            if not ok:
                raise HTTPException(
                    status_code=422,
                    detail=f"Incompatible datasets '{datasets[0].name}' and '{ds.name}': {'; '.join(errors)}",
                )

        merge_root = Path(tempfile.mkdtemp(prefix="neotix_merge_output_"))
        temp_outputs: list[Path] = []
        try:
            current_path = local_paths[0]
            for i, next_path in enumerate(local_paths[1:], start=1):
                is_last = i == len(local_paths) - 1
                dest = merge_root / output_name if is_last else Path(tempfile.mkdtemp(prefix="neotix_merge_step_"))
                if not is_last:
                    temp_outputs.append(dest)

                success = merge_datasets(str(current_path), str(next_path), str(dest))
                if not success:
                    raise HTTPException(status_code=500, detail=f"Merge failed at step {i}")
                current_path = dest

            output_path = merge_root / output_name
            merged_info = _load_info(output_path)

            if r2_enabled():
                storage_path: str | Path = dataset_root_uri(current_user.id, output_name)
                upload_directory(output_path, storage_path)
            else:
                storage_path = settings.DATASET_BASE_PATH / output_name
                if Path(storage_path).exists():
                    shutil.rmtree(storage_path, ignore_errors=True)
                shutil.copytree(output_path, storage_path)

            from api.routers.datasets import _register_dataset
            new_ds = _register_dataset(db, output_name, storage_path, user_id=current_user.id)
            new_ds.source = "merge"

            log_activity(
                db, current_user, "merge_datasets",
                f"Merged {[d.name for d in datasets]} -> '{output_name}'",
                dataset_id=new_ds.id,
            )
            db.commit()
            return {
                "output_path": str(storage_path),
                "total_episodes": merged_info.get("total_episodes", 0),
                "total_frames": merged_info.get("total_frames", 0),
                "dataset_id": new_ds.id,
            }
        finally:
            for temp_output in temp_outputs:
                shutil.rmtree(temp_output, ignore_errors=True)
            shutil.rmtree(merge_root, ignore_errors=True)
