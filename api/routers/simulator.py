"""
Part C — Live simulator (WebSocket) + async replay endpoints.
"""
import asyncio
import json
import struct
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from api.config import settings
from api.database import get_db
from api.deps import get_current_user, get_current_user_flexible
from api.models import Dataset, EpisodeRecord, ReplayJob, User
from api.activity_logger import log_activity

_SIM_AVAILABLE = False
_SIM_IMPORT_ERROR = ""

try:
    import cv2
    import mujoco
    import numpy as np

    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from tools.sim_replay import load_model, set_pose, render_frame, replay_episode  # noqa: E402

    _SIM_AVAILABLE = True
except Exception as _exc:
    _SIM_IMPORT_ERROR = str(_exc)
    np = None  # type: ignore[assignment]

router = APIRouter(tags=["simulator"])
_executor = ThreadPoolExecutor(max_workers=4)


# WebSocket simulator
DEFAULT_CAM = {"azimuth": 135.0, "elevation": -20.0, "distance": 1.5}

STREAM_W = 960
STREAM_H = 720
STREAM_JPEG_QUALITY = 85


def _load_model_streaming(bimanual: bool = False):
    """Load MuJoCo model with lower resolution renderer for WebSocket streaming."""
    from tools.sim_replay import MODEL_PATH, MODEL_PATH_BIMANUAL
    path = MODEL_PATH_BIMANUAL if bimanual else MODEL_PATH
    if not path.exists():
        raise FileNotFoundError(f"YAM Pro model not found: {path}")
    model = mujoco.MjModel.from_xml_path(str(path))
    data = mujoco.MjData(model)
    renderer = mujoco.Renderer(model, height=STREAM_H, width=STREAM_W)
    return model, data, renderer


def _encode_frame_jpeg(rgb, quality: int = STREAM_JPEG_QUALITY) -> bytes:
    _, jpeg = cv2.imencode(".jpg", rgb[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, quality])
    return jpeg.tobytes()


def _get_episode_states(episode_id: int, db: Session):
    """Return (states ndarray, bimanual bool, total_frames int, error_msg str|None)."""
    import pandas as pd

    ep = db.query(EpisodeRecord).filter(EpisodeRecord.id == episode_id).first()
    if not ep:
        return None, False, 0, f"Episode {episode_id} not found in database"
    ds = db.query(Dataset).filter(Dataset.id == ep.dataset_id).first()
    if not ds:
        return None, False, 0, f"Dataset for episode {episode_id} not found"
    parquet = Path(ds.path) / "data" / "chunk-000" / f"episode_{ep.episode_index:06d}.parquet"
    if not parquet.exists():
        return None, False, 0, (
            f"Parquet data file not found: {parquet}. "
            f"The dataset directory may be empty — ensure the LeRobot dataset "
            f"files are present at: {ds.path}"
        )
    df = pd.read_parquet(parquet)
    states = np.stack(df["observation.state"].values).astype(np.float32)
    bimanual = states.shape[1] == 14
    return states, bimanual, len(states), None


@router.websocket("/ws/simulator")
async def simulator_ws(ws: WebSocket, token: str | None = None):
    if not token:
        await ws.close(code=4001, reason="Missing auth token")
        return
    from api.auth import decode_token as _decode
    try:
        payload = _decode(token)
        ws_user_id = int(payload.get("sub", 0))
    except Exception:
        await ws.close(code=4001, reason="Invalid token")
        return

    await ws.accept()

    if not _SIM_AVAILABLE:
        await ws.send_text(json.dumps({
            "type": "error",
            "message": f"Simulator unavailable: {_SIM_IMPORT_ERROR}. "
                       "Install mujoco, opencv-python-headless, and numpy to enable.",
        }))
        await ws.close()
        return

    # Dedicated single-thread executor so all MuJoCo/OpenGL ops
    # share the same thread (renderer context is thread-affine).
    mj_executor = ThreadPoolExecutor(max_workers=1)

    model = None
    data = None
    renderer = None
    cam = None
    states = None
    total_frames = 0
    current_frame = 0
    playing = False
    play_speed = 1.0
    play_task: asyncio.Task | None = None
    loop = asyncio.get_event_loop()

    def _setup_camera() -> mujoco.MjvCamera:
        c = mujoco.MjvCamera()
        c.azimuth   = DEFAULT_CAM["azimuth"]
        c.elevation = DEFAULT_CAM["elevation"]
        c.distance  = DEFAULT_CAM["distance"]
        c.lookat[:] = [0.0, 0.0, 0.3]
        return c

    def _render_frame_sync(frame_idx: int) -> bytes:
        """Runs inside mj_executor — pose + render + JPEG encode."""
        set_pose(data, states[frame_idx])
        rgb = render_frame(renderer, model, data, cam=cam)
        return _encode_frame_jpeg(rgb)

    async def _send_frame(frame_idx: int):
        if model is None or states is None:
            return
        jpeg_bytes = await loop.run_in_executor(mj_executor, _render_frame_sync, frame_idx)

        header = json.dumps({
            "type": "frame",
            "frame_index": frame_idx,
            "total_frames": total_frames,
            "timestamp": float(frame_idx) / 30.0,
            "camera": {
                "azimuth": cam.azimuth if cam else DEFAULT_CAM["azimuth"],
                "elevation": cam.elevation if cam else DEFAULT_CAM["elevation"],
                "distance": cam.distance if cam else DEFAULT_CAM["distance"],
            },
        }).encode()
        await ws.send_bytes(struct.pack(">I", len(header)) + header + jpeg_bytes)

    async def _play_loop():
        nonlocal current_frame, playing
        fps = 30
        base_interval = 1.0 / fps
        try:
            while playing and current_frame < total_frames:
                frame_interval = base_interval / max(play_speed, 0.1)
                t0 = time.monotonic()
                await _send_frame(current_frame)
                elapsed = time.monotonic() - t0

                # Skip frames if rendering is slower than target to stay real-time
                skip = int(elapsed / frame_interval) if elapsed > frame_interval else 0
                current_frame += 1 + skip
                if current_frame >= total_frames:
                    current_frame = total_frames - 1
                    playing = False
                    await _send_frame(current_frame)
                    break
                await asyncio.sleep(max(0, frame_interval - elapsed))
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            playing = False
            try:
                await ws.send_text(json.dumps({"type": "error", "message": f"Playback error: {exc}"}))
            except Exception:
                pass

    from api.database import SessionLocal

    cam_seq = 0
    _last_cam_render = [0.0]

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            cmd = msg.get("type")

            if cmd == "load":
                episode_id = int(msg.get("episode_id", 0))
                playing = False
                if play_task and not play_task.done():
                    play_task.cancel()

                try:
                    db_session = SessionLocal()
                    try:
                        _ep = db_session.query(EpisodeRecord).filter(EpisodeRecord.id == episode_id).first()
                        if _ep:
                            _ds = db_session.query(Dataset).filter(Dataset.id == _ep.dataset_id, Dataset.user_id == ws_user_id).first()
                            if not _ds:
                                await ws.send_text(json.dumps({"type": "error", "message": "Episode not found"}))
                                continue
                        ep_states, bimanual, n_frames, err_msg = await loop.run_in_executor(
                            _executor, _get_episode_states, episode_id, db_session
                        )
                    finally:
                        db_session.close()

                    if ep_states is None:
                        await ws.send_text(json.dumps({"type": "error", "message": err_msg or f"Episode {episode_id} not found"}))
                        continue

                    if renderer:
                        await loop.run_in_executor(mj_executor, renderer.close)

                    model, data, renderer = await loop.run_in_executor(
                        mj_executor, _load_model_streaming, bimanual
                    )
                    cam = _setup_camera()
                    states = ep_states
                    total_frames = n_frames
                    current_frame = 0

                    await ws.send_text(json.dumps({
                        "type": "info",
                        "episode_id": episode_id,
                        "total_frames": total_frames,
                        "bimanual": bimanual,
                        "joints": 14 if bimanual else 7,
                    }))
                    await _send_frame(0)
                except Exception as exc:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "message": f"Failed to load episode {episode_id}: {exc}",
                    }))

            elif cmd == "play":
                if model is None:
                    continue
                playing = True
                play_task = asyncio.create_task(_play_loop())

            elif cmd == "pause":
                playing = False
                if play_task and not play_task.done():
                    play_task.cancel()

            elif cmd == "step":
                playing = False
                if play_task and not play_task.done():
                    play_task.cancel()
                direction = msg.get("direction", "forward")
                if direction == "forward":
                    current_frame = min(current_frame + 1, total_frames - 1)
                else:
                    current_frame = max(current_frame - 1, 0)
                try:
                    await _send_frame(current_frame)
                except Exception as exc:
                    await ws.send_text(json.dumps({"type": "error", "message": f"Render error: {exc}"}))

            elif cmd == "seek":
                playing = False
                if play_task and not play_task.done():
                    play_task.cancel()
                current_frame = max(0, min(int(msg.get("frame", 0)), total_frames - 1))
                try:
                    await _send_frame(current_frame)
                except Exception as exc:
                    await ws.send_text(json.dumps({"type": "error", "message": f"Render error: {exc}"}))

            elif cmd == "speed":
                play_speed = max(0.25, min(4.0, float(msg.get("speed", 1.0))))

            elif cmd == "camera":
                if cam is None:
                    cam = _setup_camera()
                cam.azimuth   = float(msg.get("azimuth", cam.azimuth))
                cam.elevation = float(msg.get("elevation", cam.elevation))
                cam.distance  = float(msg.get("distance", cam.distance))
                if "lookat" in msg:
                    la = msg["lookat"]
                    cam.lookat[:] = [float(la[0]), float(la[1]), float(la[2])]
                cam_seq += 1
                # During playback, the play_loop already renders with the updated cam — skip extra render.
                # When paused, throttle: only render if enough time passed since last camera render.
                if model is not None and not playing:
                    now = time.monotonic()
                    if now - _last_cam_render[0] >= 0.033:
                        _last_cam_render[0] = now
                        try:
                            await _send_frame(current_frame)
                        except Exception as exc:
                            await ws.send_text(json.dumps({"type": "error", "message": f"Render error: {exc}"}))

            elif cmd == "reset_camera":
                cam = _setup_camera()
                if model is not None:
                    try:
                        await _send_frame(current_frame)
                    except Exception as exc:
                        await ws.send_text(json.dumps({"type": "error", "message": f"Render error: {exc}"}))

    except WebSocketDisconnect:
        pass
    finally:
        playing = False
        if play_task and not play_task.done():
            play_task.cancel()
        if renderer:
            try:
                await loop.run_in_executor(mj_executor, renderer.close)
            except Exception:
                pass
        mj_executor.shutdown(wait=False)


# Replay to video (HTTP background job)
@router.post("/episodes/{episode_id}/replay")
def start_replay(
    episode_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not _SIM_AVAILABLE:
        raise HTTPException(status_code=501, detail=f"Simulator unavailable: {_SIM_IMPORT_ERROR}")

    ep = db.query(EpisodeRecord).filter(EpisodeRecord.id == episode_id).first()
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    ds = db.query(Dataset).filter(Dataset.id == ep.dataset_id, Dataset.user_id == current_user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Episode not found")

    existing = (
        db.query(ReplayJob)
        .filter(ReplayJob.episode_id == episode_id, ReplayJob.status.in_(["pending", "running"]))
        .first()
    )
    if existing:
        return {"job_id": existing.id, "status": existing.status}
    parquet = Path(ds.path) / "data" / "chunk-000" / f"episode_{ep.episode_index:06d}.parquet"
    output_path = settings.REPLAY_OUTPUT_PATH / f"episode_{episode_id}.mp4"

    job = ReplayJob(
        episode_id=episode_id,
        dataset_id=ep.dataset_id,
        status="pending",
    )
    db.add(job)
    db.flush()
    job_id = job.id

    log_activity(db, current_user, "replay_start", f"Started replay for episode {ep.episode_index}", dataset_id=ds.id, episode_id=ep.id)
    db.commit()

    # Run in background thread
    def _run():
        from api.database import SessionLocal
        _db = SessionLocal()
        try:
            _job = _db.query(ReplayJob).filter(ReplayJob.id == job_id).first()
            _job.status = "running"
            _db.commit()

            _last_commit = [0]

            def _progress(cur, total):
                _job.progress = cur / max(total, 1)
                now = time.monotonic()
                if now - _last_commit[0] > 1.0:
                    _db.commit()
                    _last_commit[0] = now

            result = replay_episode(parquet, output_path, progress_callback=_progress)
            _job.status = "done"
            _job.output_path = str(result)
            _job.progress = 1.0
            _db.commit()
        except Exception as e:
            _db.rollback()
            _job = _db.query(ReplayJob).filter(ReplayJob.id == job_id).first()
            if _job:
                _job.status = "error"
                _job.error_message = str(e)
                _db.commit()
        finally:
            _db.close()

    _executor.submit(_run)
    return {"job_id": job_id, "status": "pending"}


@router.get("/episodes/{episode_id}/replay/status")
def replay_status(episode_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.expire_all()
    job = (
        db.query(ReplayJob)
        .filter(ReplayJob.episode_id == episode_id)
        .order_by(ReplayJob.created_at.desc())
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="No replay job found")
    return {
        "job_id": job.id,
        "status": job.status,
        "progress": round(job.progress * 100),
        "error_message": job.error_message,
    }


@router.post("/episodes/{episode_id}/replay/cancel")
def cancel_replay(episode_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = (
        db.query(ReplayJob)
        .filter(ReplayJob.episode_id == episode_id, ReplayJob.status.in_(["pending", "running"]))
        .order_by(ReplayJob.created_at.desc())
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="No active replay job found")
    job.status = "error"
    job.error_message = "Cancelled by user"
    db.commit()
    return {"status": "cancelled", "job_id": job.id}


@router.get("/episodes/{episode_id}/replay/video")
async def replay_video(episode_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_flexible)):
    import aiofiles
    from fastapi.responses import StreamingResponse

    job = (
        db.query(ReplayJob)
        .filter(ReplayJob.episode_id == episode_id, ReplayJob.status == "done")
        .order_by(ReplayJob.created_at.desc())
        .first()
    )
    if not job or not job.output_path:
        raise HTTPException(status_code=404, detail="Replay video not ready")

    video_path = Path(job.output_path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Replay video file not found")

    async def _iter():
        async with aiofiles.open(video_path, "rb") as f:
            while True:
                chunk = await f.read(65536)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(_iter(), media_type="video/mp4",
                             headers={"Content-Length": str(video_path.stat().st_size)})
