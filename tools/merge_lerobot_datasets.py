#!/usr/bin/env python3
"""
Merge two LeRobot v2.1 datasets into a single dataset.

Provided utility — use this logic in your /merge API endpoints.

Usage (standalone):
    python tools/merge_lerobot_datasets.py dataset1/ dataset2/ output/
"""

import json
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd


def load_info(dataset_path: Path | str) -> dict:
    with open(Path(dataset_path) / "meta" / "info.json") as f:
        return json.load(f)


def validate_compatibility(info1: dict, info2: dict) -> Tuple[bool, List[str]]:
    """Check if two datasets are compatible for merging.

    Returns:
        (compatible: bool, issues: List[str])
    """
    issues = []

    if info1.get("fps") != info2.get("fps"):
        issues.append(f"FPS mismatch: {info1.get('fps')} vs {info2.get('fps')}")

    f1 = info1.get("features", {})
    f2 = info2.get("features", {})

    if f1.get("observation.state", {}).get("shape") != f2.get("observation.state", {}).get("shape"):
        issues.append("observation.state shape mismatch")

    if f1.get("action", {}).get("shape") != f2.get("action", {}).get("shape"):
        issues.append("action shape mismatch")

    cams1 = {k.replace("observation.images.", "") for k in f1 if k.startswith("observation.images.")}
    cams2 = {k.replace("observation.images.", "") for k in f2 if k.startswith("observation.images.")}
    if cams1 != cams2:
        issues.append(f"Camera mismatch: {sorted(cams1)} vs {sorted(cams2)}")

    return len(issues) == 0, issues


def load_tasks(dataset_path: Path) -> List[Dict]:
    tasks = []
    f = dataset_path / "meta" / "tasks.jsonl"
    if f.exists():
        with open(f) as fh:
            for line in fh:
                if line.strip():
                    tasks.append(json.loads(line))
    return tasks


def merge_tasks(tasks1: List[Dict], tasks2: List[Dict]) -> Tuple[List[Dict], Dict[int, int]]:
    """Build merged task list (union). Returns (merged_tasks, task2_remap)."""
    merged = list(tasks1)
    desc_to_idx = {t["task"]: t["task_index"] for t in tasks1}
    next_idx = max((t["task_index"] for t in tasks1), default=-1) + 1

    remap: Dict[int, int] = {}
    for t in tasks2:
        old_idx, desc = t["task_index"], t["task"]
        if desc in desc_to_idx:
            remap[old_idx] = desc_to_idx[desc]
        else:
            remap[old_idx] = next_idx
            merged.append({"task_index": next_idx, "task": desc})
            desc_to_idx[desc] = next_idx
            next_idx += 1

    return merged, remap


def merge_datasets(path1: Path | str, path2: Path | str, output: Path | str) -> bool:
    """Merge two LeRobot v2.1 datasets into output/."""
    path1, path2, output = Path(path1), Path(path2), Path(output)
    info1 = load_info(path1)
    info2 = load_info(path2)

    ok, issues = validate_compatibility(info1, info2)
    if not ok:
        print("Datasets are not compatible:")
        for i in issues:
            print(f"  - {i}")
        return False

    tasks1 = load_tasks(path1)
    tasks2 = load_tasks(path2)
    merged_tasks, task2_remap = merge_tasks(tasks1, tasks2)

    cameras = [
        k.replace("observation.images.", "")
        for k in info1["features"]
        if k.startswith("observation.images.")
    ]

    # Create output structure
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    (output / "data" / "chunk-000").mkdir(parents=True)
    (output / "meta").mkdir(parents=True)
    for cam in cameras:
        (output / "videos" / "chunk-000" / f"observation.images.{cam}").mkdir(parents=True)

    fps = info1["fps"]
    parquets1 = sorted((path1 / "data" / "chunk-000").glob("episode_*.parquet"))
    parquets2 = sorted((path2 / "data" / "chunk-000").glob("episode_*.parquet"))
    n1 = len(parquets1)
    global_frame_offset = info1["total_frames"]

    # Copy dataset 1 as-is
    for pf in parquets1:
        df = pd.read_parquet(pf)
        if "timestamp" in df.columns:
            n = len(df)
            df["timestamp"] = np.arange(n, dtype=np.float32) / fps
        df.to_parquet(output / "data" / "chunk-000" / pf.name, index=False)
        for cam in cameras:
            src = path1 / "videos" / "chunk-000" / f"observation.images.{cam}" / pf.name.replace(".parquet", ".mp4")
            if src.exists():
                shutil.copy2(src, output / "videos" / "chunk-000" / f"observation.images.{cam}" / src.name)

    # Copy dataset 2 with renumbering
    for i, pf in enumerate(parquets2):
        new_ep = n1 + i
        new_name = f"episode_{new_ep:06d}.parquet"
        df = pd.read_parquet(pf)
        df["episode_index"] = new_ep
        df["index"] = list(range(global_frame_offset, global_frame_offset + len(df)))
        n = len(df)
        if "timestamp" in df.columns:
            df["timestamp"] = np.arange(n, dtype=np.float32) / fps
        if "task_index" in df.columns and task2_remap:
            df["task_index"] = df["task_index"].map(lambda x: task2_remap.get(x, x))
        df.to_parquet(output / "data" / "chunk-000" / new_name, index=False)
        global_frame_offset += len(df)
        for cam in cameras:
            src = path2 / "videos" / "chunk-000" / f"observation.images.{cam}" / pf.name.replace(".parquet", ".mp4")
            dst = output / "videos" / "chunk-000" / f"observation.images.{cam}" / f"episode_{new_ep:06d}.mp4"
            if src.exists():
                shutil.copy2(src, dst)

    # Metadata: episodes.jsonl
    all_episodes = []
    with open(path1 / "meta" / "episodes.jsonl") as f:
        for line in f:
            if line.strip():
                all_episodes.append(json.loads(line))
    with open(path2 / "meta" / "episodes.jsonl") as f:
        for line in f:
            if line.strip():
                ep = json.loads(line)
                ep["episode_index"] += n1
                all_episodes.append(ep)
    with open(output / "meta" / "episodes.jsonl", "w") as f:
        for ep in all_episodes:
            f.write(json.dumps(ep) + "\n")

    # tasks.jsonl
    with open(output / "meta" / "tasks.jsonl", "w") as f:
        for t in merged_tasks:
            f.write(json.dumps(t) + "\n")

    # info.json
    total_ep = n1 + len(parquets2)
    total_fr = info1["total_frames"] + info2["total_frames"]
    merged_info = info1.copy()
    merged_info.update({
        "total_episodes": total_ep,
        "total_frames": total_fr,
        "total_tasks": len(merged_tasks),
        "total_videos": total_ep * len(cameras),
        "splits": {"train": f"0:{total_ep}"},
    })
    with open(output / "meta" / "info.json", "w") as f:
        json.dump(merged_info, f, indent=2)

    print(f"Merged: {total_ep} episodes, {total_fr} frames, {len(merged_tasks)} tasks -> {output}")
    return True


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    ok = merge_datasets(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    sys.exit(0 if ok else 1)
