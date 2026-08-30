const bus = new EventTarget();
function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}
function on(type, handler) {
  const wrapped = (e) => handler(e.detail);
  bus.addEventListener(type, wrapped);
  return () => bus.removeEventListener(type, wrapped);
}

const shared = {
  onMessage: (handler) => on('message', handler),
  onMessageStatus: (handler) => on('message-status', handler),
  onMessageEdit: (handler) => on('message-edit', handler),
  onMessageDelete: (handler) => on('message-delete', handler),
  onMessageReaction: (handler) => on('message-reaction', handler),
  onTyping: (handler) => on('typing', handler),
  onPresence: (handler) => on('presence', handler),
};

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
  if (socket && socket.readyState <= 1) return; 

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
    } catch { /* ignore */ }
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
      socketReconnectTimer = setTimeout(connectSocket, 2000); 
    }
  });
}

function disconnectSocket() {
  clearTimeout(socketReconnectTimer);
  if (socket) { socket.close(); socket = null; }
}

let firebaseAuth = null;
async function getFirebaseAuth() {
  if (firebaseAuth) return firebaseAuth;
  const [{ initializeApp }, { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js')
  ]);
  const res = await fetch('/api/firebase-config');
  const config = await res.json();
  const app = initializeApp(config);
  firebaseAuth = {
    auth: getAuth(app),
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut
  };
  return firebaseAuth;
}

const PoyetAPI = {
  ...shared,

  async register(username, password, displayName) {
    const fb = await getFirebaseAuth();
    const email = `${username.replace(/^@/, '')}@yager.local`;
    
    // Register in Firebase
    try {
      const userCredential = await fb.createUserWithEmailAndPassword(fb.auth, email, password);
      const token = await userCredential.user.getIdToken();
      localStorage.setItem(LS_TOKEN, token);

      // Register in backend
      const { user } = await apiFetch('/api/auth/register', {
        method: 'POST', body: JSON.stringify({ username, displayName }),
      });
      connectSocket();
      return user;
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        throw new Error('Такой юз уже занят');
      }
      throw new Error(err.message || 'Ошибка регистрации');
    }
  },

  async login(username, password) {
    const fb = await getFirebaseAuth();
    const email = `${username.replace(/^@/, '')}@yager.local`;
    
    try {
      const userCredential = await fb.signInWithEmailAndPassword(fb.auth, email, password);
      const token = await userCredential.user.getIdToken();
      localStorage.setItem(LS_TOKEN, token);

      const { user } = await apiFetch('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ username }),
      });
      connectSocket();
      return user;
    } catch (err) {
      throw new Error('Неверный юз или пароль');
    }
  },

  async logout() {
    disconnectSocket();
    localStorage.removeItem(LS_TOKEN);
    try {
      const fb = await getFirebaseAuth();
      await fb.signOut(fb.auth);
    } catch (e) {
      // ignore
    }
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

  async getChats() { return apiFetch('/api/chats'); },
  async getMessages(chatId) { return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages`); },
  async sendMessage(chatId, payload) {
    const body = typeof payload === 'string' ? { text: payload } : payload;
    return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async editMessage(chatId, messageId, text) {
    return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH', body: JSON.stringify({ text }),
    });
  },
  async deleteMessage(chatId, messageId) {
    return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  },
  async toggleReaction(chatId, messageId, emoji) {
    return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST', body: JSON.stringify({ emoji }),
    });
  },
  async markRead(chatId) { return apiFetch(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: 'POST' }); },
  async startChat(usernameOrId) {
    return apiFetch('/api/chats', {
      method: 'POST', body: JSON.stringify({ username: usernameOrId, userId: usernameOrId }),
    });
  },
  async createGroupChat(name, memberUsernames, avatar) {
    return apiFetch('/api/chats', {
      method: 'POST', body: JSON.stringify({ isGroup: true, name, memberUsernames, avatar }),
    });
  },
  async updateProfile(payload) {
    return apiFetch('/api/users/me', {
      method: 'PATCH', body: JSON.stringify(payload),
    });
  },
  async getUserProfile(userId) { return apiFetch(`/api/users/${encodeURIComponent(userId)}`); },
  async searchUsers(query = '') { return apiFetch(`/api/users?q=${encodeURIComponent(query)}`); },
  
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
      method: 'POST', body: JSON.stringify({ subscription, device }),
    });
  },
  async unsubscribePush(endpoint) {
    return apiFetch('/api/push/unsubscribe', {
      method: 'POST', body: JSON.stringify({ endpoint }),
    });
  },
  async testPushNotification() { return apiFetch('/api/push/test', { method: 'POST' }); },
};

window.PoyetAPI = PoyetAPI;
