# Project Assessment

## Project status

End-to-end flow verified: **FastAPI** on port **8000** + **Vite** dev server + **Tauri** desktop build (Windows). Backend must be running for episode video proxy, QA export, simulator WebSocket, and related API calls.

**Screenshots for review:** (see `screenshots/README.md` and the **Screenshots** section in root **`README.md`**).

---

## How to Run

### 1. Install dependencies

```bash
python -m venv venv
venv\Scripts\activate          # Windows: venv\Scripts\activate
# source venv/bin/activate      # Linux/macOS

pip install -r requirements.txt

# Download datasets (optional sample data)
huggingface-cli download Neotix-Robotics/ball_to_cup \
  --repo-type dataset --local-dir data/ball_to_cup
huggingface-cli download Neotix-Robotics/dirty_towels \
  --repo-type dataset --revision v2.1 --local-dir data/dirty_towels
```

> The YAM Pro MuJoCo models (single + bimanual) are included in `models/i2rt_yam/`.

### 2. Start the backend

```bash
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

Keep this terminal open. Use `.env` / `SECRET_KEY` in production (see `.env.example`).

### 3. Start the frontend

```bash
cd frontend && npm install && npm run dev
```

If port **3000** is taken, Vite may use **3001+**, align `frontend/src-tauri/tauri.conf.json` **`devUrl`** with the printed URL when using Tauri.

### 4. Open in browser

```
http://localhost:3000
```

(or the port shown by Vite)

### 5. (Optional) Run with Docker Compose

```bash
docker compose up --build
# Backend  -> http://localhost:8000
# Frontend -> http://localhost:3000
```

### 6. (Optional) Run as Tauri Desktop App

```bash
cd frontend
npm install
npm run tauri dev    # development
npm run tauri build  # production installer
```

Requires **Rust** (need to install it). Windows builds need valid **`frontend/src-tauri/icons/icon.ico`** (BMP-based ICO for `rc.exe`).

---

## Environment

- **OS / Platform:** Windows 11 / Linux (Docker)
- **Python version:** 3.11+
- **Node.js:** 18+ or 20+ / 22 LTS (see `frontend/package.json`)
- **Frontend:** Vite 6 + React 18 + TypeScript + React Router 6
- **Browser tested on:** Chrome, MS Edge

---

## Checklist

### Part A: Backend

**Auth**
- [x] `POST /auth/register` — hashed passwords (bcrypt via passlib)
- [x] `POST /auth/login` — returns JWT (HS256, python-jose)
- [x] `POST /auth/login/swagger` — form-data login for Swagger UI Authorize dialog
- [x] `GET /auth/me` — requires token
- [x] Protected endpoints return 401 without token

**Datasets**
- [x] `GET /datasets` — lists all with metadata + active flag (user-scoped)
- [x] `POST /datasets/import` — register from local path
- [x] `POST /datasets/upload` — upload ZIP (auto-extracted server-side)
- [x] `PATCH /datasets/{id}` — rename
- [x] `DELETE /datasets/{id}` — delete (blocked on active)
- [x] `POST /datasets/{id}/activate` — switch active dataset
- [x] Auto-detects 7D (single) vs 14D (bimanual) from info.json

**Episodes**
- [x] `GET /episodes` — filter by task/status, search by task name or episode index, sort, paginate
- [x] `GET /episodes/{id}/video/{camera}` — MP4 streaming with range requests (auth required)
- [x] `GET /episodes/{id}/data` — joint states as JSON

**QA**
- [x] `PATCH /episodes/{id}/status` — auth required, logged
- [x] `PATCH /episodes/{id}/task` — auth required, logged
- [x] `POST /qa/export` — valid LeRobot v2.1 output (renumbered, metadata updated)
- [x] `GET /qa/export/{name}/download` — download exported dataset as ZIP

**Merge**
- [x] `POST /datasets/merge` — 2+ datasets, compatibility check, task remapping
- [x] N-dataset merge (N>2) works via chained pairwise merges
- [x] `POST /datasets/merge/check` — pre-merge compatibility + task mapping preview

**Activity**
- [x] `GET /activity` — paginated, filterable by user and action type
- [x] All mutating actions logged with username

**Code**
- [x] Proper router structure (auth, datasets, episodes, qa, merge, activity, simulator, stats)
- [x] At least one pytest test (tests/test_auth.py)
- [x] SQLite persistence (survives restart, auto-migration on startup)

### Part B: Frontend

**Auth & Sessions**
- [x] Login + register pages 
- [x] JWT persists across refresh (Zustand persist middleware)
- [x] User indicator in sidebar + logout (with sign-out confirmation dialog)
- [x] Protected routes redirect to login

**Datasets**
- [x] Dataset cards with metadata (episodes, frames, fps, cameras, source badge)
- [x] Activate, import (drag-and-drop folder), upload ZIP, rename, delete
- [x] Multi-select merge (with compatibility wizard)
- [x] Active dataset indicator in sidebar (hydrated from backend on refresh)
- [x] Source filtering (imported/exported/merged) and name search
- [x] Download button for exported/merged datasets

**Episodes**
- [x] Episode browser with filter/sort (task, status, search by task/episode ID)
- [x] Multi-camera video playback (synchronized, speed control)
- [x] Joint trajectory chart (generated from episode parquet data)
- [x] QA controls on detail page (validate/delete/flag + task edit)

**QA Review**
- [x] Review tab with keyboard shortcuts 
- [x] Summary tab with reviewed episodes table
- [x] Export validated episodes (select individual validated episodes or export all)
- [x] Progress indicator (progress bar + stats)

**Merge & Activity**
- [x] Merge wizard with compatibility check and task mapping preview
- [x] Activity feed with filtering (user, action type)

### Part C: Live Simulator & Replay

**Live Simulator**
- [x] WebSocket streaming of MuJoCo frames (authenticated via token query param)
- [x] Mouse orbit / scroll zoom / right-drag pan 
- [x] Episode sidebar with pagination and search
- [x] Play / pause / step / frame slider / restart
- [x] Auto-detects single vs bimanual model
- [x] Camera info overlay + reset button
- [x] FPS counter and speed control

**Sim Replay Video**
- [x] `POST /episodes/{id}/replay` — async background job (auth required)
- [x] `POST /episodes/{id}/replay/cancel` — cancel in-progress replay
- [x] Status polling endpoint (auth required)
- [x] Rendered MP4 plays in browser (H.264 codec)
- [x] Correct joint mapping (single + bimanual)

**Frontend Integration**
- [x] "Replay in Simulation" button with progress bar and stop button
- [x] Sim video alongside real camera videos on episode detail page

### Bonus
- [x] Tauri desktop app (src-tauri/ config included)
- [x] Docker Compose (`docker compose up` works)
- [x] WebSocket real-time sim streaming (no HTTP polling)
- [x] Multi-user data isolation (user-scoped datasets, episodes, QA, activity)
- [x] 3D WebGL landing page with robot model + bloom post-processing
- [x] Swagger UI authentication support (`/auth/login/swagger`)

---

## API Documentation

Interactive Swagger docs are available at:

```
http://localhost:8000/docs
```

Use the **Authorize** button (lock icon) to authenticate with username/password. Leave `client_id` and `client_secret` blank.

---

## Design Decisions

### Architecture

**Backend (FastAPI + SQLite + SQLAlchemy):**
Structured into focused routers (`auth`, `datasets`, `episodes`, `qa`, `merge`, `activity`, `simulator`, `stats`). SQLAlchemy ORM manages SQLite persistence for users, datasets, episode metadata, activity logs, and replay jobs. A central `log_activity()` helper ensures every mutating action is audited.

**Frontend (Vite + React 18 + TypeScript):**
SPA with React Router v6. TanStack Query manages all server state (caching, re-fetching, polling). Zustand handles cross-page client state (active dataset, auth, simulator playback). All UI uses a dark sci-fi design system built on shadcn/ui + Tailwind CSS v4. The landing page uses `@react-three/fiber` for a WebGL YAM Pro robot model with bloom/chromatic-aberration post-processing and glassmorphism auth panel.

### Dataset Management

Datasets are registered in the SQLite `datasets` table with an `is_active` flag. Only one dataset can be active per user at a time. All episode/QA/stats endpoints read from the active dataset. EpisodeRecord rows are synced from `episodes.jsonl` on import/upload. Robot type is auto-detected from `features.observation.state.shape` in `info.json`.

### Live Simulator

WebSocket endpoint at `/ws/simulator`. Server-side: MuJoCo renders frames to RGB numpy arrays, encoded to JPEG (quality 85) at 960x720, sent as binary WebSocket messages with a JSON header. Client: `<img>` element swaps `src` via blob URLs on each frame. Camera control: mouse events send `{type:"camera", azimuth, elevation, distance}` messages which update the `MjvCamera` server-side. Rendering runs in a dedicated `ThreadPoolExecutor` (single thread) to keep MuJoCo's OpenGL context thread-affine.

### Bimanual Support

`info.json -> features.observation.state.shape[0]` is 7 for single-arm, 14 for bimanual. This drives: (1) which MuJoCo scene XML to load, (2) which `set_pose()` branch executes (single: qpos[0:8], bimanual: left qpos[8:16], right qpos[0:8] due to mirrored model layout), (3) joint trajectory chart labels.

### QA Export

`POST /qa/export` queries EpisodeRecord rows with `status="validated"` (or selected episode IDs). Episodes are renumbered from 0. Parquet files have `episode_index`, `frame_index`, and `task_index` columns rewritten. Videos are copied to matching paths. Metadata files (`info.json`, `episodes.jsonl`, `tasks.jsonl`) are regenerated. The exported dataset is auto-registered in the DB with `source="export"` and can be downloaded as a ZIP via `GET /qa/export/{name}/download`.

### Multi-User Isolation

All data is scoped by `user_id`. Datasets, episodes, QA state, and activity logs are fully separated between users. The React Query cache is cleared on login/logout to prevent cross-user data leakage. The `datasets.name` column has no unique constraint, allowing different users to import datasets with the same name.

---

## Known Limitations

1. **Live simulator stream quality** — JPEG-encoded WebSocket frames are lower fidelity than offline-rendered MP4 replays. This is an inherent trade-off for real-time streaming performance.
2. **SQLite concurrency** — SQLite handles moderate concurrent reads well but may bottleneck under heavy parallel writes. Suitable for single-user / small-team usage; a PostgreSQL migration would be needed for production scale.
3. **Video codec dependency** — H.264 replay rendering requires the OpenH264 DLL on Windows. Falls back to mp4v if unavailable, which some browsers cannot play inline.
4. **No WebSocket reconnect** — If the simulator WebSocket drops, the user must manually reconnect. No automatic retry is implemented.
5. **Dataset folder import** — Uses drag-and-drop only (no file picker dialog) to avoid browser-native multi-file upload confirmation dialogs. The folder must contain a valid LeRobot v2.1 structure with `meta/info.json`.

---

## Notes

- **Swagger UI**: Visit `/docs` and click Authorize. Enter username/password, leave client fields blank. The `/auth/login/swagger` endpoint handles form-data auth for Swagger; the frontend uses `/auth/login` with JSON.
- **Multi-user isolation**: All data is scoped by `user_id`. Cache is cleared on auth state changes to prevent cross-user leakage.
- **Auto-migration**: The backend runs SQLite schema migrations on startup (`database.py`), so no manual `ALTER TABLE` steps are needed.
- **MuJoCo models**: Both single-arm and bimanual YAM Pro models are bundled in `models/i2rt_yam/`. The system auto-selects the correct model based on the dataset's `robot_type` field.
- **Docker Compose**: Builds separate containers for backend (FastAPI + uvicorn) and frontend (Vite build -> nginx). The frontend nginx config proxies `/api/` and `/ws/` to the backend container.
