"""
Sim Replay Helper — YAM Pro (i2rt) in MuJoCo

Provided skeleton for Part C. The MuJoCo setup, joint mapping, frame
rendering, and ffmpeg encoding are all here. Your job:

  1. Implement `replay_episode()` using the helpers below
  2. Wire it up as a FastAPI background job in your API

Usage (standalone test):
    python tools/sim_replay.py data/ball_to_cup/data/chunk-000/episode_000000.parquet /tmp/replay.mp4
"""

import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

import mujoco
import numpy as np
import pandas as pd

# ── Paths ──────────────────────────────────────────────────────────────────────
_HERE  = Path(__file__).parent
_REPO  = _HERE.parent
MODEL_PATH = _REPO / "models" / "i2rt_yam" / "scene.xml"
MODEL_PATH_BIMANUAL = _REPO / "models" / "i2rt_yam" / "scene_bimanual.xml"

# ── Render resolution ──────────────────────────────────────────────────────────
RENDER_W = 640
RENDER_H = 480
FPS      = 30

# ── Gripper mapping ────────────────────────────────────────────────────────────
# observation.state[6] is in [0, 1] where 0=open, 1=closed.
# MuJoCo has two coupled prismatic fingers (joint7, joint8)
# with range [-0.0475, 0] where -0.0475=open, 0=closed.
GRIPPER_OPEN = -0.0475  # metres (fully open position)


# ══════════════════════════════════════════════════════════════════════════════
# Provided helpers
# ══════════════════════════════════════════════════════════════════════════════

def load_model(bimanual: bool = False) -> tuple:
    """Load YAM Pro MuJoCo model. Returns (model, data, renderer).

    Args:
        bimanual: If True, load the dual-arm scene (16 qpos).
                  If False, load the single-arm scene (8 qpos).
    """
    path = MODEL_PATH_BIMANUAL if bimanual else MODEL_PATH
    if not path.exists():
        raise FileNotFoundError(
            f"YAM Pro model not found: {path}\n"
            "The model should be included in models/i2rt_yam/"
        )
    model    = mujoco.MjModel.from_xml_path(str(path))
    data     = mujoco.MjData(model)
    renderer = mujoco.Renderer(model, height=RENDER_H, width=RENDER_W)
    return model, data, renderer


def _set_arm(data: mujoco.MjData, obs_7d: np.ndarray, qpos_offset: int = 0) -> None:
    """Set one arm's joints from a 7-element state vector.

    obs_7d: [joint1..joint6, gripper] where gripper ≈ 1.0=open, ≈ 0.0=closed.
    qpos_offset: 0 for single/left arm, 8 for right arm in bimanual.
    """
    data.qpos[qpos_offset:qpos_offset + 6] = obs_7d[0:6]
    gripper = GRIPPER_OPEN * obs_7d[6]  # 1.0 → -0.0475 (open), 0.0 → 0 (closed)
    data.qpos[qpos_offset + 6] = gripper
    data.qpos[qpos_offset + 7] = gripper


def set_pose(data: mujoco.MjData, observation_state: np.ndarray) -> None:
    """Set robot joint positions from observation.state vector.

    Auto-detects single-arm (7D) vs bimanual (14D):
      - 7D:  [joint1..6, gripper] → qpos[0:8]
      - 14D: [left_joint1..6, left_gripper, right_joint1..6, right_gripper] → qpos[0:16]
    """
    n = len(observation_state)
    if n == 7:
        _set_arm(data, observation_state, qpos_offset=0)
    elif n == 14:
        _set_arm(data, observation_state[0:7], qpos_offset=8)   # left data → right model (arms swapped due to mirrored layout)
        _set_arm(data, observation_state[7:14], qpos_offset=0)  # right data → left model
    else:
        raise ValueError(f"Unexpected observation.state length: {n} (expected 7 or 14)")


def render_frame(
    renderer: mujoco.Renderer,
    model:    mujoco.MjModel,
    data:     mujoco.MjData,
    cam:      Optional[mujoco.MjvCamera] = None,
) -> np.ndarray:
    """Run mj_forward, update scene, and render one RGB frame (H, W, 3)."""
    mujoco.mj_forward(model, data)
    renderer.update_scene(data, camera=cam)
    return renderer.render().copy()


def frames_to_mp4(
    frames:      list,
    output_path: Path | str,
    fps:         int = FPS,
) -> None:
    """Encode a list of RGB numpy frames to an H.264 MP4 file via ffmpeg.

    Args:
        frames:      List of (H, W, 3) uint8 numpy arrays in RGB order.
        output_path: Destination .mp4 file path.
        fps:         Frames per second.
    """
    if not frames:
        raise ValueError("frames list is empty")

    H, W = frames[0].shape[:2]
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-y",
        "-r", str(fps),
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{W}x{H}", "-pix_fmt", "rgb24",
        "-i", "pipe:0",
        "-vcodec", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(output_path),
    ]
    proc = subprocess.Popen(
        cmd, stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    for frame in frames:
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (exit {proc.returncode})")


# ══════════════════════════════════════════════════════════════════════════════
# TODO (Part C): implement replay_episode()
# ══════════════════════════════════════════════════════════════════════════════

def replay_episode(
    parquet_path: Path | str,
    output_path:  Path | str,
    progress_callback=None,
) -> Path:
    """Replay a recorded episode in MuJoCo simulation and save to MP4.

    Streams rendered frames directly to ffmpeg via pipe — no intermediate
    list — so memory stays constant regardless of episode length.

    Args:
        parquet_path:      Path to the episode_XXXXXX.parquet file.
        output_path:       Where to write the rendered .mp4.
        progress_callback: Optional callable(current_frame, total_frames)
                           called periodically during rendering.

    Returns:
        Path to the written MP4.
    """
    parquet_path = Path(parquet_path)
    output_path  = Path(output_path)

    if not parquet_path.exists():
        raise FileNotFoundError(f"Parquet not found: {parquet_path}")

    df = pd.read_parquet(parquet_path)
    states = np.stack(df["observation.state"].values).astype(np.float32)
    N = len(states)

    if N == 0:
        raise ValueError("Episode has no frames")

    n_joints = states.shape[1]
    bimanual = (n_joints == 14)

    model, data, renderer = load_model(bimanual=bimanual)

    cam           = mujoco.MjvCamera()
    cam.azimuth   = 135.0
    cam.elevation = -20.0
    cam.distance  = 1.5
    cam.lookat[:] = [0.0, 0.0, 0.3]

    fps = FPS
    try:
        info_path = parquet_path.parent.parent.parent / "meta" / "info.json"
        if info_path.exists():
            import json
            with open(info_path) as f:
                info = json.load(f)
            fps = int(info.get("fps", FPS))
    except Exception:
        pass

    import cv2

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Try H.264 (browser-compatible), fall back to mp4v
    for fourcc_str in ("avc1", "mp4v"):
        fourcc = cv2.VideoWriter_fourcc(*fourcc_str)
        writer = cv2.VideoWriter(str(output_path), fourcc, fps, (RENDER_W, RENDER_H))
        if writer.isOpened():
            break
    if not writer.isOpened():
        raise RuntimeError(f"Failed to open video writer for {output_path}")

    progress_interval = max(1, N // 50)
    try:
        for i in range(N):
            set_pose(data, states[i])
            frame = render_frame(renderer, model, data, cam=cam)
            writer.write(cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
            if progress_callback is not None and (i % progress_interval == 0 or i == N - 1):
                progress_callback(i + 1, N)
    finally:
        writer.release()

    renderer.close()

    return output_path


# ══════════════════════════════════════════════════════════════════════════════
# Standalone test
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python tools/sim_replay.py <episode.parquet> <output.mp4>")
        sys.exit(1)

    parquet = Path(sys.argv[1])
    output  = Path(sys.argv[2])

    print(f"Replaying {parquet.name} → {output} ...")

    def progress(cur, total):
        pct = 100 * cur // total
        print(f"\r  {cur}/{total} frames ({pct}%)", end="", flush=True)

    result = replay_episode(parquet, output, progress_callback=progress)
    print(f"\nDone: {result}")
