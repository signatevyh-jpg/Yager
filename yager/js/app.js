const App = (() => {

  let currentUser = null;
  let chats = [];               // [{id, name, online, isGroup, isBot, lastMessageAt, unread}]
  let messagesByChat = {};      // chatId -> [messages]
  let activeChatId = null;
  let unsubscribers = [];

  const PALETTE = ['#FF6B6B', '#4D96FF', '#6BCB77', '#FFA45B', '#B983FF', '#3DCCC7', '#FF8FA3', '#5AC8FA'];
  function colorFor(name) {
    let h = 0;
    for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
    return PALETTE[Math.abs(h) % PALETTE.length];
  }
  function initials(name) {
    return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  function escapeHtml(s) {
    return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtListTime(iso) {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(iso);
    const diffDays = Math.round((now - d) / 86400000);
    if (diffDays === 1) return 'вчера';
    if (diffDays < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  function fmtDateSeparator(iso) {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
  function avatarHtml(chat, size) {
    const bg = colorFor(chat.name);
    const dot = chat.online ? '<div class="online-dot"></div>' : '';
    const icon = chat.isBot ? '🤖' : (chat.isChannel ? '📣' : initials(chat.name));
    return `<div class="avatar" style="background:${bg}; width:${size}px; height:${size}px; font-size:${size * 0.34}px;">${icon}${dot}</div>`;
  }
  function statusLabel(chat) {
    if (chat.isBot) return 'бот';
    if (chat.isGroup) return 'группа';
    return chat.online ? 'в сети' : 'был(а) недавно';
  }

  async function start(user) {
    currentUser = user;
    Auth.hide();
    document.getElementById('current-user-name').textContent = user.displayName;
    document.getElementById('current-user-avatar').innerHTML = avatarInitialsOnly(user.displayName);

    chats = await PoyetAPI.getChats();
    for (const chat of chats) {
      messagesByChat[chat.id] = await PoyetAPI.getMessages(chat.id);
    }
    renderChatList();
    renderMain();
    wireGlobalEvents();
    subscribeToRealtime();
  }

  function avatarInitialsOnly(name) {
    return `<div class="avatar" style="background:${colorFor(name)}; width:36px; height:36px; font-size:13px;">${initials(name)}</div>`;
  }

  function wireGlobalEvents() {
    document.getElementById('search-input').addEventListener('input', (e) => renderChatList(e.target.value));
    document.getElementById('logout-btn').addEventListener('click', async () => {
      unsubscribers.forEach(u => u());
      unsubscribers = [];
      await PoyetAPI.logout();
      currentUser = null; chats = []; messagesByChat = {}; activeChatId = null;
      Auth.show();
    });
    wireNewChatModal();
  }

  function wireNewChatModal() {
    const overlay = document.getElementById('new-chat-modal');
    const form = document.getElementById('new-chat-form');
    const input = document.getElementById('new-chat-username');
    const errorBox = document.getElementById('new-chat-error');

    function open() {
      errorBox.hidden = true;
      input.value = '';
      overlay.hidden = false;
      input.focus();
    }
    function close() { overlay.hidden = true; }

    document.getElementById('new-chat-btn').addEventListener('click', open);
    document.getElementById('new-chat-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = input.value.trim();
      if (!username) return;
      errorBox.hidden = true;
      try {
        const chat = await PoyetAPI.startChat(username);
        if (!chats.some(c => c.id === chat.id)) {
          messagesByChat[chat.id] = messagesByChat[chat.id] || [];
          chats.push(chat);
        }
        close();
        openChat(chat.id);
        if (!messagesByChat[chat.id] || messagesByChat[chat.id].length === 0) {
          messagesByChat[chat.id] = await PoyetAPI.getMessages(chat.id);
          renderMessages(chat);
        }
      } catch (err) {
        errorBox.textContent = err.message || 'Не удалось начать чат';
        errorBox.hidden = false;
      }
    });
  }

  function subscribeToRealtime() {
    unsubscribers.push(PoyetAPI.onMessage(({ chatId, message }) => {
      messagesByChat[chatId] = messagesByChat[chatId] || [];
      if (!messagesByChat[chatId].some(m => m.id === message.id)) {
        messagesByChat[chatId].push(message);
      }
      const chat = chats.find(c => c.id === chatId);
      if (chat) chat.lastMessageAt = message.createdAt;

      if (chatId === activeChatId) {
        renderMessages(chat);
      } else if (message.senderId !== currentUser.id) {
        chat.unread = (chat.unread || 0) + 1;
      }
      renderChatList(document.getElementById('search-input').value);
    }));

    unsubscribers.push(PoyetAPI.onMessageStatus(({ chatId, messageId, status }) => {
      const msg = (messagesByChat[chatId] || []).find(m => m.id === messageId);
      if (msg) { msg.status = status; if (chatId === activeChatId) renderMessages(chats.find(c => c.id === chatId)); }
    }));

    unsubscribers.push(PoyetAPI.onTyping(({ chatId, isTyping }) => {
      if (chatId !== activeChatId) return;
      const status = document.getElementById('chat-header-status');
      const chat = chats.find(c => c.id === chatId);
      if (!status || !chat) return;
      if (isTyping) { status.textContent = 'печатает…'; status.classList.add('typing'); }
      else { status.textContent = statusLabel(chat); status.classList.remove('typing'); }
    }));

    if (PoyetAPI.onPresence) {
      unsubscribers.push(PoyetAPI.onPresence(({ userId, online }) => {
        // В mock-режиме этого события нет; в real-режиме userId — это id
        // собеседника, а не id чата, поэтому ищем чат по совпадению.
        let changed = false;
        chats.forEach(chat => {
          if (chat.contactId === userId || chat.otherUserId === userId) { chat.online = online; changed = true; }
        });
        if (changed) {
          renderChatList(document.getElementById('search-input').value);
          const activeChat = chats.find(c => c.id === activeChatId);
          if (activeChat) {
            const status = document.getElementById('chat-header-status');
            if (status && !status.classList.contains('typing')) status.textContent = statusLabel(activeChat);
          }
        }
      }));
    }
  }

  function renderChatList(filter = '') {
    const list = document.getElementById('chat-list');
    const sorted = [...chats].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    const f = filter.trim().toLowerCase();
    const filtered = f ? sorted.filter(c => c.name.toLowerCase().includes(f)) : sorted;

    list.innerHTML = filtered.map(chat => {
      const msgs = messagesByChat[chat.id] || [];
      const lm = msgs[msgs.length - 1];
      if (!lm) return '';
      const mine = lm.senderId === currentUser.id;
      const prefix = mine ? 'Вы: ' : '';
      const preview = escapeHtml(prefix + lm.text);
      const unread = chat.unread || 0;
      const badge = unread > 0 ? `<div class="unread-badge">${unread}</div>` : '';
      return `
        <div class="chat-item ${chat.id === activeChatId ? 'active' : ''}" data-id="${chat.id}">
          ${avatarHtml(chat, 48)}
          <div class="chat-item-body">
            <div class="chat-item-top">
              <div class="chat-name">${chat.name}</div>
              <div class="chat-time">${fmtListTime(lm.createdAt)}</div>
            </div>
            <div class="chat-item-bottom">
              <div class="chat-preview">${preview}</div>
              ${badge}
            </div>
          </div>
        </div>`;
    }).join('') || `<div class="empty-list">Ничего не найдено</div>`;

    list.querySelectorAll('.chat-item').forEach(el => {
      el.addEventListener('click', () => openChat(el.dataset.id));
    });
  }

  function openChat(id) {
    activeChatId = id;
    const chat = chats.find(c => c.id === id);
    if (chat && chat.unread) {
      chat.unread = 0;
      PoyetAPI.markRead(id).catch(() => {});
    }
    renderChatList(document.getElementById('search-input').value);
    renderMain();
    if (window.innerWidth <= 760) {
      document.getElementById('sidebar').classList.add('hide');
      document.getElementById('main').classList.remove('hide');
    }
  }

  function renderMain() {
    const main = document.getElementById('main');
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) {
      main.innerHTML = emptyStateHtml();
      return;
    }
    main.innerHTML = `
      <div id="chat-header">
        <button class="icon-btn" id="back-btn">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        ${avatarHtml(chat, 40)}
        <div id="chat-header-info">
          <div id="chat-header-name">${chat.name}</div>
          <div id="chat-header-status">${statusLabel(chat)}</div>
        </div>
      </div>
      <div id="messages"></div>
      <div id="composer">
        <textarea id="msg-input" rows="1" placeholder="Написать сообщение"></textarea>
        <button class="icon-btn" id="send-btn" title="Отправить">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
        </button>
      </div>
    `;
    document.getElementById('back-btn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('hide');
      document.getElementById('main').classList.add('hide');
    });
    renderMessages(chat);

    const input = document.getElementById('msg-input');
    let typingTimeout = null;
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';

      if (PoyetAPI.sendTyping) {
        PoyetAPI.sendTyping(chat.id, true);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => PoyetAPI.sendTyping(chat.id, false), 1500);
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(chat); }
    });
    document.getElementById('send-btn').addEventListener('click', () => send(chat));
    input.focus();
  }

  function emptyStateHtml() {
    return `
      <div id="empty-state">
        <div class="glyph">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="white"><path d="M21.4 3.4 2.6 10.9c-.9.4-.9 1.7.1 2l4.4 1.4 1.7 5.4c.2.7 1.1.9 1.6.3l2.5-2.7 4.7 3.5c.7.5 1.7.1 1.9-.7l3.4-15.7c.2-1-.8-1.8-1.5-1.5Zm-3 3.2L9.8 13.9l-.4 3-1.4-4.4 10.8-6.7c.3-.2.6.2.2.4Z"/></svg>
        </div>
        <h2>Выберите чат</h2>
        <p>Личные сообщения защищены сквозным просмотром внутри этого прототипа</p>
      </div>`;
  }

  function renderMessages(chat) {
    const container = document.getElementById('messages');
    if (!container) return;
    const msgs = messagesByChat[chat.id] || [];
    let html = '';
    let lastDate = null;
    msgs.forEach(m => {
      const day = new Date(m.createdAt).toDateString();
      if (day !== lastDate) { html += `<div class="date-sep">${fmtDateSeparator(m.createdAt)}</div>`; lastDate = day; }
      const mine = m.senderId === currentUser.id;
      const ticks = mine ? (m.status === 'read'
        ? `<span class="ticks"><svg width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 5.5l3 3 4-6"/><path d="M6 5.5l3 3 6-8"/></svg></span>`
        : `<span class="ticks"><svg width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 5.5l3 3 8-8"/></svg></span>`) : '';
      html += `
        <div class="msg-row ${mine ? 'out' : 'in'}">
          <div class="bubble">
            <span class="text">${escapeHtml(m.text)}</span>
            <span class="meta">${fmtTime(m.createdAt)}${ticks}</span>
          </div>
        </div>`;
    });
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  async function send(chat) {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    try {
      await PoyetAPI.sendMessage(chat.id, text);
    } catch (err) {
      alert(err.message || 'Не удалось отправить сообщение');
    }
  }

  return { start };
})();
