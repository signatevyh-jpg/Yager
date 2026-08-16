import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import Chat, ChatParticipant, Message, User
from ..schemas import ChatOut, MessageOut, SendMessageRequest, StartChatRequest
from ..ws_manager import manager

router = APIRouter(prefix="/api/chats", tags=["chats"])


async def _ensure_participant(db: AsyncSession, chat_id: str, user_id: str) -> ChatParticipant:
    result = await db.execute(
        select(ChatParticipant).where(ChatParticipant.chat_id == chat_id, ChatParticipant.user_id == user_id)
    )
    part = result.scalar_one_or_none()
    if not part:
        raise HTTPException(403, "Нет доступа к этому чату")
    return part


async def _chat_to_out(db: AsyncSession, chat: Chat, current_user: User) -> ChatOut:
    parts_result = await db.execute(select(ChatParticipant).where(ChatParticipant.chat_id == chat.id))
    parts = parts_result.scalars().all()
    other_ids = [p.user_id for p in parts if p.user_id != current_user.id]

    name = chat.name or "Без названия"
    online = False
    other_user_id = None
    if not chat.is_group and other_ids:
        other = (await db.execute(select(User).where(User.id == other_ids[0]))).scalar_one_or_none()
        if other:
            name = other.display_name
            online = manager.is_online(other.id)
            other_user_id = other.id

    lm_result = await db.execute(
        select(Message).where(Message.chat_id == chat.id).order_by(Message.created_at.desc()).limit(1)
    )
    last_message = lm_result.scalar_one_or_none()

    my_part = next((p for p in parts if p.user_id == current_user.id), None)
    unread = 0
    if my_part:
        count_result = await db.execute(
            select(func.count(Message.id)).where(
                Message.chat_id == chat.id,
                Message.created_at > my_part.last_read_at,
                Message.sender_id != current_user.id,
            )
        )
        unread = count_result.scalar_one()

    return ChatOut(
        id=chat.id,
        name=name,
        isGroup=chat.is_group,
        isBot=False,
        online=online,
        lastMessageAt=last_message.created_at if last_message else chat.created_at,
        unread=unread,
        otherUserId=other_user_id,
    )


@router.get("", response_model=list[ChatOut])
async def list_chats(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    parts_result = await db.execute(select(ChatParticipant).where(ChatParticipant.user_id == current_user.id))
    chat_ids = [p.chat_id for p in parts_result.scalars().all()]
    if not chat_ids:
        return []

    chats_result = await db.execute(select(Chat).where(Chat.id.in_(chat_ids)))
    chats = chats_result.scalars().all()

    out = [await _chat_to_out(db, c, current_user) for c in chats]
    out.sort(key=lambda c: c.lastMessageAt, reverse=True)
    return out


@router.post("", response_model=ChatOut)
async def start_chat(
    body: StartChatRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Найти существующий личный чат с пользователем или создать новый."""
    target_result = await db.execute(select(User).where(User.username.ilike(body.username.strip())))
    target = target_result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Пользователь с таким именем не найден")
    if target.id == current_user.id:
        raise HTTPException(400, "Нельзя начать чат с самим собой")

    my_parts = (
        await db.execute(select(ChatParticipant).where(ChatParticipant.user_id == current_user.id))
    ).scalars().all()

    for p in my_parts:
        other = (
            await db.execute(
                select(ChatParticipant).where(
                    ChatParticipant.chat_id == p.chat_id, ChatParticipant.user_id == target.id
                )
            )
        ).scalar_one_or_none()
        if other:
            existing_chat = (
                await db.execute(select(Chat).where(Chat.id == p.chat_id, Chat.is_group == False))  # noqa: E712
            ).scalar_one_or_none()
            if existing_chat:
                return await _chat_to_out(db, existing_chat, current_user)

    chat = Chat(is_group=False)
    db.add(chat)
    await db.flush()
    db.add(ChatParticipant(chat_id=chat.id, user_id=current_user.id))
    db.add(ChatParticipant(chat_id=chat.id, user_id=target.id))
    await db.commit()
    return await _chat_to_out(db, chat, current_user)


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
async def get_messages(
    chat_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _ensure_participant(db, chat_id, current_user.id)
    result = await db.execute(select(Message).where(Message.chat_id == chat_id).order_by(Message.created_at.asc()))
    return [
        MessageOut(id=m.id, chatId=m.chat_id, senderId=m.sender_id, text=m.text, createdAt=m.created_at, status="read")
        for m in result.scalars().all()
    ]


@router.post("/{chat_id}/messages", response_model=MessageOut)
async def send_message(
    chat_id: str,
    body: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_participant(db, chat_id, current_user.id)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Пустое сообщение")

    msg = Message(chat_id=chat_id, sender_id=current_user.id, text=text)
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    out = MessageOut(id=msg.id, chatId=chat_id, senderId=current_user.id, text=text, createdAt=msg.created_at, status="sent")

    parts_result = await db.execute(select(ChatParticipant).where(ChatParticipant.chat_id == chat_id))
    participant_ids = [p.user_id for p in parts_result.scalars().all()]
    # Рассылаем всем участникам чата, включая самого отправителя —
    # так все его вкладки/устройства тоже увидят сообщение мгновенно.
    await manager.send_to_users(participant_ids, {"type": "message", "chatId": chat_id, "message": out.model_dump()})

    return out


@router.post("/{chat_id}/read")
async def mark_read(
    chat_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    part = await _ensure_participant(db, chat_id, current_user.id)
    part.last_read_at = datetime.datetime.utcnow()
    await db.commit()
    return {"ok": True}
