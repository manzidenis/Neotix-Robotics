"""
Data loader for LeRobot v2.1 datasets.

Provided utility — candidates use this in their backend.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd


class DatasetLoader:
    """Load and inspect a LeRobot v2.1 dataset."""

    def __init__(self, dataset_path: str | Path):
        self.root = Path(dataset_path)
        if not (self.root / "meta" / "info.json").exists():
            raise ValueError(f"Not a valid LeRobot v2.1 dataset: {self.root}")
        self._info: Optional[Dict] = None
        self._tasks: Optional[Dict[int, str]] = None
        self._episodes: Optional[List[Dict]] = None

    # ── Metadata ──────────────────────────────────────────────────────────────

    def get_info(self) -> Dict[str, Any]:
        """Return parsed info.json."""
        if self._info is None:
            with open(self.root / "meta" / "info.json") as f:
                self._info = json.load(f)
        return self._info

    def get_tasks(self) -> Dict[int, str]:
        """Return {task_index: task_description} mapping."""
        if self._tasks is None:
            self._tasks = {}
            tasks_file = self.root / "meta" / "tasks.jsonl"
            if tasks_file.exists():
                with open(tasks_file) as f:
                    for line in f:
                        if line.strip():
                            t = json.loads(line)
                            self._tasks[t["task_index"]] = t["task"]
        return self._tasks

    def get_episodes(self) -> List[Dict[str, Any]]:
        """Return list of episode metadata dicts from episodes.jsonl."""
        if self._episodes is None:
            self._episodes = []
            with open(self.root / "meta" / "episodes.jsonl") as f:
                for line in f:
                    if line.strip():
                        self._episodes.append(json.loads(line))
        return self._episodes

    def get_cameras(self) -> List[str]:
        """Return list of camera names (e.g. ['env', 'wrist'])."""
        info = self.get_info()
        return [
            k.replace("observation.images.", "")
            for k in info.get("features", {})
            if k.startswith("observation.images.")
        ]

    # ── Episode data ──────────────────────────────────────────────────────────

    def get_episode_data(self, episode_index: int) -> pd.DataFrame:
        """Load and return the parquet DataFrame for one episode."""
        path = self._parquet_path(episode_index)
        if not path.exists():
            raise FileNotFoundError(f"Episode {episode_index} parquet not found: {path}")
        return pd.read_parquet(path)

    def get_observation_states(self, episode_index: int) -> np.ndarray:
        """Return observation.state as (N, 7) float32 array."""
        df = self.get_episode_data(episode_index)
        return np.stack(df["observation.state"].values).astype(np.float32)

    def get_actions(self, episode_index: int) -> np.ndarray:
        """Return action as (N, 7) float32 array."""
        df = self.get_episode_data(episode_index)
        return np.stack(df["action"].values).astype(np.float32)

    def get_timestamps(self, episode_index: int) -> np.ndarray:
        """Return timestamps as (N,) float32 array."""
        df = self.get_episode_data(episode_index)
        return df["timestamp"].values.astype(np.float32)

    # ── Video paths ───────────────────────────────────────────────────────────

    def get_video_path(self, episode_index: int, camera: str) -> Path:
        """Return Path to the MP4 for a given episode and camera."""
        return (
            self.root
            / "videos"
            / "chunk-000"
            / f"observation.images.{camera}"
            / f"episode_{episode_index:06d}.mp4"
        )

    def get_all_video_paths(self, episode_index: int) -> Dict[str, Path]:
        """Return {camera_name: Path} for all cameras of one episode."""
        return {cam: self.get_video_path(episode_index, cam) for cam in self.get_cameras()}

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _parquet_path(self, episode_index: int) -> Path:
        return (
            self.root / "data" / "chunk-000" / f"episode_{episode_index:06d}.parquet"
        )

    def episode_duration(self, episode_index: int) -> float:
        """Return duration of episode in seconds."""
        ts = self.get_timestamps(episode_index)
        return float(ts[-1] - ts[0]) if len(ts) > 1 else 0.0

    def __repr__(self) -> str:
        info = self.get_info()
        return (
            f"DatasetLoader({self.root.name!r}, "
            f"episodes={info.get('total_episodes')}, "
            f"fps={info.get('fps')})"
        )
