"""
Neotix Robotics Data Platform — FastAPI Backend

Run:
    uvicorn api.main:app --reload --port 8000
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.config import settings
from api.database import init_db

# Routers
from api.routers import activity, assets, auth, datasets, episodes, merge, qa, simulator, stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all DB tables
    init_db()
    # Ensure replay output directory exists
    settings.REPLAY_OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="Neotix Robotics Data Platform",
    description="API for browsing, reviewing, and managing YAM Pro teleoperation datasets",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return JSONResponse(status_code=404, content={"detail": "Not found"})


@app.exception_handler(500)
async def server_error_handler(request: Request, exc):
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(assets.router)
app.include_router(auth.router)
app.include_router(datasets.router)
app.include_router(episodes.router)
app.include_router(qa.router)
app.include_router(merge.router)
app.include_router(activity.router)
app.include_router(stats.router)
app.include_router(simulator.router)


@app.get("/")
def root():
    return {"status": "ok", "message": "Neotix Robotics Data Platform API", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}
