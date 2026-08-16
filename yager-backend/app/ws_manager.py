import json
from typing import Dict, Iterable, Set

from fastapi import WebSocket


class ConnectionManager:
    """
    Держит в памяти процесса активные WebSocket-соединения по user_id.
    Годится для одного инстанса сервера. Если бэкенд будет масштабироваться
    на несколько инстансов — эту часть нужно заменить на что-то вроде
    Redis Pub/Sub, чтобы события доходили до пользователя независимо от
    того, к какому именно инстансу он подключён.
    """

    def __init__(self) -> None:
        self.active: Dict[str, Set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.active.setdefault(user_id, set()).add(ws)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        conns = self.active.get(user_id)
        if not conns:
            return
        conns.discard(ws)
        if not conns:
            del self.active[user_id]

    def is_online(self, user_id: str) -> bool:
        return bool(self.active.get(user_id))

    async def send_to_user(self, user_id: str, payload: dict) -> None:
        for ws in list(self.active.get(user_id, [])):
            try:
                await ws.send_text(json.dumps(payload, default=str))
            except Exception:
                pass

    async def send_to_users(self, user_ids: Iterable[str], payload: dict) -> None:
        for uid in set(user_ids):
            await self.send_to_user(uid, payload)


manager = ConnectionManager()
