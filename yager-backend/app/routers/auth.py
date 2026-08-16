from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import AuthResponse, LoginRequest, RegisterRequest, UserOut
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    username = body.username.strip()
    if len(username) < 3:
        raise HTTPException(400, "Имя пользователя — минимум 3 символа")
    if len(body.password) < 4:
        raise HTTPException(400, "Пароль — минимум 4 символа")

    existing = await db.execute(select(User).where(User.username.ilike(username)))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Это имя пользователя уже занято")

    user = User(username=username, display_name=username, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id)
    return AuthResponse(token=token, user=UserOut(id=user.id, username=user.username, displayName=user.display_name))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username.ilike(body.username.strip())))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(400, "Неверное имя пользователя или пароль")

    token = create_access_token(user.id)
    return AuthResponse(token=token, user=UserOut(id=user.id, username=user.username, displayName=user.display_name))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return UserOut(id=current_user.id, username=current_user.username, displayName=current_user.display_name)
