import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.routes.websocket import router as websocket_router
from app.core.config import get_settings
from app.services.evidence_clips import (
    recover_pending_evidence_clips,
    shutdown_evidence_clip_tasks,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    recovery_task = asyncio.create_task(recover_pending_evidence_clips())
    yield
    recovery_task.cancel()
    await asyncio.gather(recovery_task, return_exceptions=True)
    await shutdown_evidence_clip_tasks()


app = FastAPI(
    title=settings.app_name,
    description="Backend API for BRAVE AI anti-bullying CCTV monitoring.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)
app.include_router(websocket_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "environment": settings.environment,
    }
