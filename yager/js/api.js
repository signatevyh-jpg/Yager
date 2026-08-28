/**
 * PoyetAPI — единственный модуль, с которым говорит UI (auth.js, app.js).
 * Режим переключается в config.js через CONFIG.USE_MOCK:
 *
 *  MOCK: всё живёт в localStorage браузера — для демонстрации интерфейса
 *        без сервера, без реального обмена между людьми.
 *
 *  REAL: полноценные запросы к бэкенду (см. poyet-backend/, FastAPI +
 *        PostgreSQL + WebSocket) — сообщения реально доходят от одного
 *        зарегистрированного пользователя к другому.
 *
 * Контракт запросов и формат ответов описаны в poyet-backend/README.md.
 */

const PoyetAPI = (() => {

  const bus = new EventTarget(); // общая шина событий и для mock, и для real (WebSocket сюда же эмитит)

  function emit(type, detail) {
    bus.dispatchEvent(new CustomEvent(type, { detail }));
  }
  function on(type, handler) {
    const wrapped = (e) => handler(e.detail);
    bus.addEventListener(type, wrapped);
    return () => bus.removeEventListener(type, wrapped);
  }

  // Подписки на события — общие для обоих режимов, чтобы app.js
  // не знал, откуда именно пришло событие (localStorage-эмуляция
  // или настоящий WebSocket).
  const shared = {
    onMessage: (handler) => on('message', handler),
    onMessageStatus: (handler) => on('message-status', handler),
    onMessageEdit: (handler) => on('message-edit', handler),
    onMessageDelete: (handler) => on('message-delete', handler),
    onMessageReaction: (handler) => on('message-reaction', handler),
    onTyping: (handler) => on('typing', handler),
    onPresence: (handler) => on('presence', handler),
  };

  // =========================================================
  // MOCK — данные в localStorage, для демо без бэкенда
  // =========================================================

  const LS_USERS = 'poyet_users';
  const LS_SESSION = 'poyet_session';
  const LS_CHATS_PREFIX = 'poyet_chats_';
  const LS_MESSAGES_PREFIX = 'poyet_msgs_';

  async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar || null,
      bio: user.bio || "",
    };
  }

  const mock = {
    ...shared,

    async register(username, password, displayName) {
      username = username.trim().replace(/^@/, '');
      displayName = (displayName || '').trim() || username;
      if (username.length < 3) throw new Error('Юз (username) — минимум 3 символа');
      if (password.length < 4) throw new Error('Пароль — минимум 4 символа');
      const users = readJSON(LS_USERS, []);
      if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        throw new Error('Этот юз уже занят другим пользователем');
      }
      const passwordHash = await sha256(password + '::' + username.toLowerCase());
      const user = { id: uid('user'), username, passwordHash, displayName, avatar: null, bio: "", createdAt: new Date().toISOString() };
      users.push(user);
      writeJSON(LS_USERS, users);
      writeJSON(LS_SESSION, { userId: user.id });
      seedChatsForUser(user.id);
      return publicUser(user);
    },

    async login(username, password) {
      const users = readJSON(LS_USERS, []);
      const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
      if (!user) throw new Error('Пользователь не найден');
      const passwordHash = await sha256(password + '::' + user.username.toLowerCase());
      if (passwordHash !== user.passwordHash) throw new Error('Неверный пароль');
      writeJSON(LS_SESSION, { userId: user.id });
      if (!readJSON(LS_CHATS_PREFIX + user.id, null)) seedChatsForUser(user.id);
      return publicUser(user);
    },

    async logout() { localStorage.removeItem(LS_SESSION); },

    async getCurrentUser() {
      const session = readJSON(LS_SESSION, null);
      if (!session) return null;
      const users = readJSON(LS_USERS, []);
      const user = users.find(u => u.id === session.userId);
      return user ? publicUser(user) : null;
    },

    async updateProfile(payload = {}) {
      const session = readJSON(LS_SESSION, null);
      if (!session) throw new Error('Не авторизован');
      const users = readJSON(LS_USERS, []);
      const user = users.find(u => u.id === session.userId);
      if (!user) throw new Error('Пользователь не найден');
      if (payload.displayName) user.displayName = payload.displayName;
      if (payload.avatar !== undefined) user.avatar = payload.avatar;
      if (payload.bio !== undefined) user.bio = payload.bio;
      writeJSON(LS_USERS, users);
      return publicUser(user);
    },

    async getUserProfile(userId) {
      const users = readJSON(LS_USERS, []);
      const user = users.find(u => u.id === userId);
      return user ? publicUser(user) : null;
    },

    async getChats() {
      const session = readJSON(LS_SESSION, null);
      if (!session) return [];
      return readJSON(LS_CHATS_PREFIX + session.userId, []);
    },

    async getMessages(chatId) {
      return readJSON(LS_MESSAGES_PREFIX + chatId, []);
    },

    async sendMessage(chatId, payload) {
      const session = readJSON(LS_SESSION, null);
      if (!session) throw new Error('Не авторизован');
      const messages = readJSON(LS_MESSAGES_PREFIX + chatId, []);
      const msgObj = typeof payload === 'string' ? { text: payload } : payload;
      const message = {
        id: uid('msg'),
        chatId,
        senderId: session.userId,
        text: msgObj.text || '',
        createdAt: new Date().toISOString(),
        status: 'sent',
        mediaType: msgObj.mediaType || 'text',
        mediaUrl: msgObj.mediaUrl,
        mediaMeta: msgObj.mediaMeta,
        replyTo: msgObj.replyTo,
        forwardedFrom: msgObj.forwardedFrom,
      };
      messages.push(message);
      writeJSON(LS_MESSAGES_PREFIX + chatId, messages);
      touchChat(session.userId, chatId, message);
      emit('message', { chatId, message });

      setTimeout(() => {
        message.status = 'read';
        writeJSON(LS_MESSAGES_PREFIX + chatId, messages);
        emit('message-status', { chatId, messageId: message.id, status: 'read' });
      }, 600);

      maybeAutoReply(session.userId, chatId);
      return message;
    },

    async editMessage(chatId, messageId, text) {
      const messages = readJSON(LS_MESSAGES_PREFIX + chatId, []);
      const msg = messages.find(m => m.id === messageId);
      if (!msg) throw new Error('Сообщение не найдено');
      msg.text = text;
      msg.isEdited = true;
      msg.editedAt = new Date().toISOString();
      writeJSON(LS_MESSAGES_PREFIX + chatId, messages);
      emit('message-edit', { chatId, message: msg });
      return msg;
    },

    async deleteMessage(chatId, messageId) {
      let messages = readJSON(LS_MESSAGES_PREFIX + chatId, []);
      messages = messages.filter(m => m.id !== messageId);
      writeJSON(LS_MESSAGES_PREFIX + chatId, messages);
      emit('message-delete', { chatId, messageId });
      return { ok: true, messageId };
    },

    async toggleReaction(chatId, messageId, emoji) {
      const session = readJSON(LS_SESSION, null);
      if (!session) throw new Error('Не авторизован');
      const messages = readJSON(LS_MESSAGES_PREFIX + chatId, []);
      const msg = messages.find(m => m.id === messageId);
      if (!msg) throw new Error('Сообщение не найдено');
      if (!msg.reactions) msg.reactions = {};
      const cleanEmoji = emoji.trim();
      const list = msg.reactions[cleanEmoji] || [];
      const idx = list.indexOf(session.userId);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) delete msg.reactions[cleanEmoji];
        else msg.reactions[cleanEmoji] = list;
      } else {
        list.push(session.userId);
        msg.reactions[cleanEmoji] = list;
      }
      writeJSON(LS_MESSAGES_PREFIX + chatId, messages);
      emit('message-reaction', { chatId, messageId, reactions: msg.reactions, userId: session.userId, emoji: cleanEmoji });
      return { ok: true, reactions: msg.reactions };
    },

    async markRead(chatId) {
      const chats = readJSON(LS_CHATS_PREFIX + (readJSON(LS_SESSION, {}) || {}).userId, []);
      const chat = chats.find(c => c.id === chatId);
      if (chat) { chat.unread = 0; writeJSON(LS_CHATS_PREFIX + readJSON(LS_SESSION, {}).userId, chats); }
    },

    async searchUsers(query = '') {
      const users = readJSON(LS_USERS, []);
      const current = readJSON(LS_SESSION, {}) || {};
      const q = query.toLowerCase().trim();
      return users
        .filter(u => u.id !== current.userId && (!q || u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q)))
        .map(u => ({ id: u.id, username: u.username, displayName: u.displayName, online: true }));
    },

    async startChat() {
      throw new Error('В демо-режиме нельзя написать реальному пользователю — подключите бэкенд (CONFIG.USE_MOCK = false)');
    },

    sendTyping() { /* в mock-режиме печатание собеседника имитируется само по себе */ },
  };

  function seedChatsForUser(userId) {
    const chats = MOCK_CONTACTS.map(c => ({
      id: uid('chat'), contactId: c.id, name: c.name, online: !!c.online,
      isGroup: !!c.isGroup, isBot: !!c.isBot, lastMessageAt: new Date().toISOString(),
    }));
    writeJSON(LS_CHATS_PREFIX + userId, chats);
    chats.forEach((chat, i) => {
      const contact = MOCK_CONTACTS[i];
      const seedMsgs = contact.seed.map((text, j) => ({
        id: uid('msg'), chatId: chat.id, senderId: chat.contactId, text,
        createdAt: new Date(Date.now() - (contact.seed.length - j) * 3600000).toISOString(), status: 'read',
      }));
      writeJSON(LS_MESSAGES_PREFIX + chat.id, seedMsgs);
    });
  }
  function touchChat(userId, chatId, message) {
    const chats = readJSON(LS_CHATS_PREFIX + userId, []);
    const chat = chats.find(c => c.id === chatId);
    if (chat) { chat.lastMessageAt = message.createdAt; writeJSON(LS_CHATS_PREFIX + userId, chats); }
  }
  function maybeAutoReply(userId, chatId) {
    const chats = readJSON(LS_CHATS_PREFIX + userId, []);
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    setTimeout(() => emit('typing', { chatId, userId: chat.contactId, isTyping: true }), 500);
    setTimeout(() => {
      emit('typing', { chatId, userId: chat.contactId, isTyping: false });
      const messages = readJSON(LS_MESSAGES_PREFIX + chatId, []);
      const reply = {
        id: uid('msg'), chatId, senderId: chat.contactId,
        text: AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)],
        createdAt: new Date().toISOString(), status: 'read',
      };
      messages.push(reply);
      writeJSON(LS_MESSAGES_PREFIX + chatId, messages);
      touchChat(userId, chatId, reply);
      emit('message', { chatId, message: reply });
    }, 500 + 1300);
  }

  // =========================================================
  // REAL — настоящий бэкенд (FastAPI + PostgreSQL + WebSocket)
  // =========================================================

  const LS_TOKEN = 'poyet_token';
  let socket = null;
  let socketReconnectTimer = null;

  function authHeaders() {
    const token = localStorage.getItem(LS_TOKEN);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      let message = `Ошибка запроса (${res.status})`;
      try { message = (await res.json()).detail || message; } catch { /* noop */ }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function connectSocket() {
    const token = localStorage.getItem(LS_TOKEN);
    if (!token || !CONFIG.WS_URL) return;
    if (socket && socket.readyState <= 1) return; // уже подключаемся/подключены

    socket = new WebSocket(`${CONFIG.WS_URL}?token=${encodeURIComponent(token)}`);

    socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message') emit('message', { chatId: data.chatId, message: data.message });
        else if (data.type === 'message_status') emit('message-status', { chatId: data.chatId, messageId: data.messageId, status: data.status });
        else if (data.type === 'message_edit') emit('message-edit', { chatId: data.chatId, message: data.message });
        else if (data.type === 'message_delete') emit('message-delete', { chatId: data.chatId, messageId: data.messageId });
        else if (data.type === 'message_reaction') emit('message-reaction', { chatId: data.chatId, messageId: data.messageId, reactions: data.reactions, userId: data.userId, emoji: data.emoji });
        else if (data.type === 'typing') emit('typing', { chatId: data.chatId, userId: data.userId, isTyping: data.isTyping });
        else if (data.type === 'presence') emit('presence', { userId: data.userId, online: data.online });
      } catch { /* игнорируем некорректные пакеты */ }
    });

    socket.addEventListener('close', (event) => {
      socket = null;
      if (event.code === 4401) {
        localStorage.removeItem(LS_TOKEN);
        return;
      }
      const token = localStorage.getItem(LS_TOKEN);
      if (token) {
        clearTimeout(socketReconnectTimer);
        socketReconnectTimer = setTimeout(connectSocket, 2000); // авто-переподключение
      }
    });
  }

  function disconnectSocket() {
    clearTimeout(socketReconnectTimer);
    if (socket) { socket.close(); socket = null; }
  }

  const real = {
    ...shared,

    async register(username, password, displayName) {
      const { token, user } = await apiFetch('/api/auth/register', {
        method: 'POST', body: JSON.stringify({ username, password, displayName }),
      });
      localStorage.setItem(LS_TOKEN, token);
      connectSocket();
      return user;
    },

    async login(username, password) {
      const { token, user } = await apiFetch('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ username, password }),
      });
      localStorage.setItem(LS_TOKEN, token);
      connectSocket();
      return user;
    },

    async logout() {
      disconnectSocket();
      localStorage.removeItem(LS_TOKEN);
    },

    async getCurrentUser() {
      if (!localStorage.getItem(LS_TOKEN)) return null;
      try {
        const user = await apiFetch('/api/auth/me');
        connectSocket();
        return user;
      } catch {
        localStorage.removeItem(LS_TOKEN);
        return null;
      }
    },

    async getChats() {
      return apiFetch('/api/chats');
    },

    async getMessages(chatId) {
      return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages`);
    },

    async sendMessage(chatId, payload) {
      // Сервер сам разошлёт событие 'message' всем участникам чата через
      // WebSocket (включая отправителя) — поэтому здесь не эмитим вручную.
      const body = typeof payload === 'string' ? { text: payload } : payload;
      return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        method: 'POST', body: JSON.stringify(body),
      });
    },

    async editMessage(chatId, messageId, text) {
      return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ text }),
      });
    },

    async deleteMessage(chatId, messageId) {
      return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
      });
    },

    async toggleReaction(chatId, messageId, emoji) {
      return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
    },

    async markRead(chatId) {
      return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: 'POST' });
    },

    async startChat(usernameOrId) {
      return apiFetch('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ username: usernameOrId, userId: usernameOrId }),
      });
    },

    async createGroupChat(name, memberUsernames, avatar) {
      return apiFetch('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ isGroup: true, name, memberUsernames, avatar }),
      });
    },

    async updateProfile(payload) {
      return apiFetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },

    async getUserProfile(userId) {
      return apiFetch(`/api/users/${encodeURIComponent(userId)}`);
    },

    async searchUsers(query = '') {
      return apiFetch(`/api/users?q=${encodeURIComponent(query)}`);
    },

    sendTyping(chatId, isTyping) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'typing', chatId, isTyping }));
      }
    },

    async getVapidPublicKey() {
      const res = await apiFetch('/api/push/vapid-public-key');
      return res.publicKey;
    },

    async subscribePush(subscription, device) {
      return apiFetch('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription, device }),
      });
    },

    async unsubscribePush(endpoint) {
      return apiFetch('/api/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint }),
      });
    },

    async testPushNotification() {
      return apiFetch('/api/push/test', {
        method: 'POST',
      });
    },
  };

  return CONFIG.USE_MOCK ? mock : real;
})();
