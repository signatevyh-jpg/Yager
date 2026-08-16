# Ягерь — мессенджер (фронтенд + бэкенд)

```
poyet/            фронтенд: PWA (устанавливается на iOS/Android), HTML/CSS/JS
poyet-backend/    бэкенд: Python (FastAPI) + PostgreSQL + WebSocket
```

## Запуск за 2 шага

**1. Бэкенд**
```bash
cd poyet-backend
docker compose up --build
```
Сервер поднимется на `http://localhost:8000` (документация API — `/docs`).

**2. Фронтенд**

В `poyet/js/config.js` поставьте:
```js
USE_MOCK: false,
API_BASE_URL: 'http://localhost:8000',
WS_URL: 'ws://localhost:8000/ws',
```

Затем:
```bash
cd poyet
python3 -m http.server 8080
```
Откройте `http://localhost:8080` — зарегистрируйте пользователя, откройте
это же приложение в другой вкладке/браузере, зарегистрируйте второго,
нажмите «+» рядом с поиском и введите имя первого пользователя — сообщения
теперь реально идут через сервер и доставляются мгновенно через WebSocket.

## Установка на телефон

Когда фронтенд выложен на https-хостинг (Vercel/Netlify/GitHub Pages и т.п.,
а `API_BASE_URL`/`WS_URL` указывают на настоящий https/wss-сервер):
- Android (Chrome): меню → «Установить приложение»
- iOS (Safari): «Поделиться» → «На экран Домой»

Подробности — в `poyet/README.md` и `poyet-backend/README.md`.
