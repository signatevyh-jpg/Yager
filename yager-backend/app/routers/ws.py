import json

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..database import async_session
from ..models import ChatParticipant
from ..security import decode_access_token
from ..ws_manager import manager

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query(...)):
    user_id = decode_access_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return

    await manager.connect(user_id, websocket)
    await _broadcast_presence(user_id, True)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            # Единственное сообщение, которое клиент шлёт серверу напрямую —
            # индикатор "печатает". Остальное (сообщения, read-статусы)
            # идёт через обычные REST-запросы, а сервер уже сам
            # рассылает события всем участникам чата.
            if data.get("type") == "typing":
                chat_id = data.get("chatId")
                is_typing = bool(data.get("isTyping"))
                if not chat_id:
                    continue
                async with async_session() as db:
                    result = await db.execute(
                        select(ChatParticipant).where(ChatParticipant.chat_id == chat_id)
                    )
                    other_ids = [p.user_id for p in result.scalars().all() if p.user_id != user_id]
                await manager.send_to_users(
                    other_ids, {"type": "typing", "chatId": chat_id, "userId": user_id, "isTyping": is_typing}
                )
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)
        await _broadcast_presence(user_id, False)


async def _broadcast_presence(user_id: str, online: bool) -> None:
    async with async_session() as db:
        result = await db.execute(select(ChatParticipant).where(ChatParticipant.user_id == user_id))
        chat_ids = [p.chat_id for p in result.scalars().all()]
        if not chat_ids:
            return
        other_result = await db.execute(
            select(ChatParticipant).where(
                ChatParticipant.chat_id.in_(chat_ids), ChatParticipant.user_id != user_id
            )
        )
        other_user_ids = {p.user_id for p in other_result.scalars().all()}
    if other_user_ids:
        await manager.send_to_users(other_user_ids, {"type": "presence", "userId": user_id, "online": online})
