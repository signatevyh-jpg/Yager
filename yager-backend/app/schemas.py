import datetime

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: str
    username: str
    displayName: str


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class ChatOut(BaseModel):
    id: str
    name: str
    isGroup: bool
    isBot: bool
    online: bool
    lastMessageAt: datetime.datetime
    unread: int = 0
    otherUserId: str | None = None  # id собеседника в личном чате — нужен для live-обновления статуса "в сети"


class MessageOut(BaseModel):
    id: str
    chatId: str
    senderId: str
    text: str
    createdAt: datetime.datetime
    status: str = "sent"


class SendMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class StartChatRequest(BaseModel):
    username: str
