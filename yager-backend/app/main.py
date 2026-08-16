from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from .routers import auth as auth_router
from .routers import chats as chats_router
from .routers import ws as ws_router

app = FastAPI(title="Ягерь API", version="1.0.0")

origins = ["*"] if settings.cors_origins.strip() == "*" else [o.strip() for o in settings.cors_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(chats_router.router)
app.include_router(ws_router.router)


@app.on_event("startup")
async def on_startup():
    # Для продакшена лучше заменить на Alembic-миграции;
    # create_all достаточно для старта и разработки.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
