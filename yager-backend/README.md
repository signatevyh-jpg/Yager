# Ягерь — бэкенд (Python / FastAPI / PostgreSQL)

Реальный сервер: регистрация/вход по паролю, PostgreSQL для хранения
пользователей/чатов/сообщений, доставка сообщений в реальном времени
через WebSocket.

## Быстрый старт (Docker — рекомендуется)

Нужен установленный Docker и Docker Compose.

```bash
cd poyet-backend
docker compose up --build
```

Поднимутся два контейнера:
- `db` — PostgreSQL на порту 5432
- `api` — сервер на `http://localhost:8000`

Проверить, что работает: `http://localhost:8000/api/health` → `{"status":"ok"}`.
Интерактивная документация API (Swagger): `http://localhost:8000/docs`.

## Запуск без Docker (локальный Postgres)

```bash
cd poyet-backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# отредактируйте .env: укажите DATABASE_URL от вашего Postgres и свой JWT_SECRET

uvicorn app.main:app --reload --port 8000
```

Таблицы в БД создаются автоматически при первом старте сервера.

## Подключение фронтенда

В файле `poyet/js/config.js` фронтенд-проекта:

```js
const CONFIG = {
  USE_MOCK: false,
  API_BASE_URL: 'http://localhost:8000',
  WS_URL: 'ws://localhost:8000/ws',
};
```

Для продакшена — `https://` и `wss://`, и сервер должен быть развёрнут
за HTTPS (например, через Nginx/Caddy с TLS-сертификатом или облачный
хостинг, который делает это автоматически: Railway, Render, Fly.io и т.п.).

## REST API

| Метод | Путь | Тело запроса | Ответ | Описание |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{username, password}` | `{token, user}` | Регистрация |
| POST | `/api/auth/login` | `{username, password}` | `{token, user}` | Вход |
| GET | `/api/auth/me` | — (заголовок `Authorization: Bearer <token>`) | `{id, username, displayName}` | Текущий пользователь |
| GET | `/api/chats` | — | `[{id, name, isGroup, isBot, online, lastMessageAt, unread}]` | Список чатов |
| POST | `/api/chats` | `{username}` | `{...chat}` | Найти/создать личный чат с пользователем по имени |
| GET | `/api/chats/{id}/messages` | — | `[{id, chatId, senderId, text, createdAt, status}]` | История сообщений |
| POST | `/api/chats/{id}/messages` | `{text}` | `{...message}` | Отправить сообщение |
| POST | `/api/chats/{id}/read` | — | `{ok:true}` | Отметить чат прочитанным |

Все эндпоинты, кроме `register`/`login`, требуют заголовок
`Authorization: Bearer <token>`, полученный при входе/регистрации.

## WebSocket

Подключение: `ws(s)://<host>/ws?token=<jwt>`

Сервер присылает клиенту:
```json
{"type":"message","chatId":"...","message":{...}}
{"type":"typing","chatId":"...","userId":"...","isTyping":true}
{"type":"presence","userId":"...","online":true}
```

Клиент может отправлять серверу только индикатор набора текста:
```json
{"type":"typing","chatId":"...","isTyping":true}
```

## Безопасность (что уже сделано и что доделать для реального прода)

Сделано:
- Пароли хэшируются на сервере через bcrypt (`passlib`), в открытом виде нигде не хранятся
- JWT-токены с сроком действия (по умолчанию 7 дней)
- Проверка, что пользователь — участник чата, перед выдачей сообщений

Стоит доделать перед реальным продакшеном:
- Alembic-миграции вместо `create_all` (чтобы менять схему БД без потери данных)
- Rate limiting на `/api/auth/*` (защита от подбора пароля)
- Ограничение `CORS_ORIGINS` конкретным доменом фронтенда вместо `*`
- Refresh-токены / возможность отозвать сессию
- Если нужно несколько серверных инстансов — вынести `ws_manager.py` на Redis Pub/Sub
