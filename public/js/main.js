const App = (() => {

  let currentUser = null;
  let chats = [];               // [{id, name, avatar, online, isGroup, isBot, lastMessageAt, unread, bio, participants}]
  let messagesByChat = {};      // chatId -> [messages]
  let activeChatId = null;
  let unsubscribers = [];

  // Theme state: 'light' | 'dark' | 'system'
  let currentTheme = localStorage.getItem('yager_theme') || 'system';
  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

  // Reply & Edit state
  let replyingTo = null; // { id, senderName, text, mediaType }
  let editingMsg = null; // { id, text }
  let forwardTargetMsg = null; // message object

  function initTheme() {
    applyTheme(currentTheme);
    themeMedia.addEventListener('change', () => {
      if (currentTheme === 'system') applyTheme('system');
    });
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (currentTheme === 'system') setTheme('dark');
        else if (currentTheme === 'dark') setTheme('light');
        else setTheme('system');
      });
    }
  }

  function setTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('yager_theme', theme);
    applyTheme(theme);
    showToast(`Тема: ${theme === 'system' ? 'Системная' : (theme === 'dark' ? 'Тёмная' : 'Светлая')}`);
  }

  function applyTheme(theme) {
    let effective = theme;
    if (theme === 'system') {
      effective = themeMedia.matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', effective);
    const sunIcon = document.getElementById('theme-icon-sun');
    if (sunIcon) {
      if (effective === 'dark') {
        sunIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
      } else {
        sunIcon.innerHTML = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
      }
    }
  }

  const PALETTE = ['#FF6B6B', '#4D96FF', '#6BCB77', '#FFA45B', '#B983FF', '#3DCCC7', '#FF8FA3', '#5AC8FA'];
  function colorFor(name) {
    if (!name) return PALETTE[0];
    let h = 0;
    for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
    return PALETTE[Math.abs(h) % PALETTE.length];
  }
  function initials(name) {
    if (!name) return '?';
    return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
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

  const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🙏', '👏', '🎉', '💯', '🚀', '😍', '🤝', '💩'];

  const EMOJI_CATEGORIES = [
    {
      id: 'smileys',
      name: 'Смайлы',
      icon: '😀',
      emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👻', '👽', '👾', '🤖']
    },
    {
      id: 'gestures',
      name: 'Жесты',
      icon: '👍',
      emojis: ['👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐', '🖖', '👋', '🤙', '💪', '✍️', '🙏', '🤝', '👏', '🙌', '👐', '🤲', '💅', '🤳']
    },
    {
      id: 'hearts',
      name: 'Сердца',
      icon: '❤️',
      emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💯', '💢', '💥', '💫', '💦', '💨', '💣', '💬', '💭', '🗯️', '💤', '🔥', '✨', '⭐', '🌟', '⚡']
    },
    {
      id: 'celebrate',
      name: 'События',
      icon: '🎉',
      emojis: ['🎉', '🎊', '🎈', '🎂', '🎁', '🎀', '🪄', '🎃', '🎄', '🎆', '🎇', '🧨', '✨', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖', '🎫', '🎟', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸']
    },
    {
      id: 'food',
      name: 'Еда',
      icon: '🍕',
      emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🥑', '🥦', '🥒', '🌶', '🌽', '🥕', '🥔', '🥐', '🍞', '🥖', '🥨', '🧀', '🍳', '🥓', '🥩', '🍗', '🌭', '🍔', '🍟', '🍕', '🥪', '🌮', '🌯', '🥗', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙', '🍚', '🍢', '🍧', '🍨', '🍦', '🍰', '🎂', '🧁', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '☕', '🍵', '🧃', '🥤', '🧋', '🍺', '🍻', '🥂', '🍷', '🍸', '🍹', '🍾']
    },
    {
      id: 'travel',
      name: 'Предметы',
      icon: '🚀',
      emojis: ['🚀', '🛸', '🛰', '✈️', '🚗', '🚕', '🚙', '🏎', '🚲', '🛴', '🛵', '🏍', '📱', '💻', '🖥', '⌨️', '📷', '📹', '🎥', '🕹', '💡', '🔦', '🕯', '💎', '💰', '💳', '💵', '📦', '✉️', '📫', '📝', '📌', '📎', '🔒', '🔑', '🛠', '⚙️', '🧲', '🧪', '🧬', '🔬', '🔭', '📡', '🩺', '🩹', '🛡', '🔮']
    }
  ];

  function createEmojiPickerComponent(onEmojiSelect) {
    const container = document.createElement('div');
    container.className = 'emoji-picker-container';
    
    let activeCategory = 'all';
    let searchQuery = '';

    function renderPicker() {
      container.innerHTML = `
        <div class="emoji-picker-header">
          <button type="button" class="emoji-tab-btn ${activeCategory === 'all' ? 'active' : ''}" data-cat="all" title="Все">🌟</button>
          ${EMOJI_CATEGORIES.map(cat => `
            <button type="button" class="emoji-tab-btn ${activeCategory === cat.id ? 'active' : ''}" data-cat="${cat.id}" title="${escapeHtml(cat.name)}">${cat.icon}</button>
          `).join('')}
        </div>
        <div class="emoji-search-wrap">
          <input type="text" class="emoji-search-input" placeholder="Поиск эмодзи..." value="${escapeHtml(searchQuery)}">
        </div>
        <div class="emoji-grid-wrap"></div>
      `;

      const gridWrap = container.querySelector('.emoji-grid-wrap');
      const q = searchQuery.trim().toLowerCase();

      let categoriesToShow = EMOJI_CATEGORIES;
      if (activeCategory !== 'all') {
        categoriesToShow = EMOJI_CATEGORIES.filter(c => c.id === activeCategory);
      }

      let hasResults = false;
      categoriesToShow.forEach(cat => {
        let list = cat.emojis;
        if (q) {
          list = cat.emojis.filter(e => e.includes(q) || cat.name.toLowerCase().includes(q));
        }
        if (list.length > 0) {
          hasResults = true;
          const section = document.createElement('div');
          section.innerHTML = `
            <div class="emoji-category-title">${escapeHtml(cat.name)}</div>
            <div class="emoji-grid">
              ${list.map(e => `<button type="button" class="emoji-item-btn" data-emoji="${escapeHtml(e)}">${e}</button>`).join('')}
            </div>
          `;
          gridWrap.appendChild(section);
        }
      });

      if (!hasResults) {
        gridWrap.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-secondary); font-size:13px;">Ничего не найдено</div>`;
      }

      const searchInput = container.querySelector('.emoji-search-input');
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        updateGridOnly();
      });

      container.querySelectorAll('.emoji-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          activeCategory = btn.getAttribute('data-cat');
          container.querySelectorAll('.emoji-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          updateGridOnly();
        });
      });

      gridWrap.addEventListener('click', (e) => {
        const itemBtn = e.target.closest('.emoji-item-btn');
        if (itemBtn) {
          e.stopPropagation();
          const emoji = itemBtn.getAttribute('data-emoji');
          if (emoji && onEmojiSelect) {
            onEmojiSelect(emoji);
          }
        }
      });
    }

    function updateGridOnly() {
      const gridWrap = container.querySelector('.emoji-grid-wrap');
      if (!gridWrap) return;
      gridWrap.innerHTML = '';
      const q = searchQuery.trim().toLowerCase();

      let categoriesToShow = EMOJI_CATEGORIES;
      if (activeCategory !== 'all') {
        categoriesToShow = EMOJI_CATEGORIES.filter(c => c.id === activeCategory);
      }

      let hasResults = false;
      categoriesToShow.forEach(cat => {
        let list = cat.emojis;
        if (q) {
          list = cat.emojis.filter(e => e.includes(q) || cat.name.toLowerCase().includes(q));
        }
        if (list.length > 0) {
          hasResults = true;
          const section = document.createElement('div');
          section.innerHTML = `
            <div class="emoji-category-title">${escapeHtml(cat.name)}</div>
            <div class="emoji-grid">
              ${list.map(e => `<button type="button" class="emoji-item-btn" data-emoji="${escapeHtml(e)}">${e}</button>`).join('')}
            </div>
          `;
          gridWrap.appendChild(section);
        }
      });

      if (!hasResults) {
        gridWrap.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-secondary); font-size:13px;">Ничего не найдено</div>`;
      }
    }

    renderPicker();
    return container;
  }

  function avatarHtml(entity, size = 46) {
    const sz = size;
    const name = entity.displayName || entity.name || 'Пользователь';
    const av = entity.avatar;
    const dot = entity.online ? '<div class="online-dot"></div>' : '';
    
    if (av) {
      return `
        <div class="avatar" style="width:${sz}px; height:${sz}px; background:transparent;">
          <img src="${escapeHtml(av)}" alt="${escapeHtml(name)}" class="avatar-img-circle" style="width:100%; height:100%;">
          ${dot}
        </div>`;
    }

    const bg = colorFor(name);
    const icon = entity.isBot ? '🤖' : (entity.isGroup ? '👥' : initials(name));
    return `<div class="avatar" style="background:${bg}; width:${sz}px; height:${sz}px; font-size:${sz * 0.34}px;">${icon}${dot}</div>`;
  }

  function statusLabel(chat) {
    if (chat.isBot) return 'бот';
    if (chat.isGroup) {
      const count = (chat.participants && chat.participants.length) || 'несколько';
      return `группа • ${count} участн.`;
    }
    return chat.online ? 'в сети' : 'был(а) недавно';
  }

  async function start(user) {
    currentUser = user;
    Auth.hide();
    initTheme();
    updateCurrentUserHeaderUI();

    // Reset previous listeners and state
    unsubscribers.forEach(u => {
      try { u(); } catch {}
    });
    unsubscribers = [];
    activeChatId = null;
    replyingTo = null;
    editingMsg = null;

    // Expose app functions globally for notifications, auth, and service worker
    window.App = {
      start: (u) => start(u),
      openChat: (id) => openChat(id),
      openSettings: () => openSettingsModal(),
      showToast: (text) => showToast(text),
    };

    chats = await PoyetAPI.getChats();
    for (const chat of chats) {
      messagesByChat[chat.id] = await PoyetAPI.getMessages(chat.id);
    }
    renderChatList();
    renderMain();
    wireGlobalEvents();
    subscribeToRealtime();

    // Auto-open chat if opened via notification link (?chat=...)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const targetChat = urlParams.get('chat');
      if (targetChat) {
        openChat(targetChat);
      }
    } catch {}
  }

  function updateCurrentUserHeaderUI() {
    if (!currentUser) return;
    document.getElementById('current-user-name').textContent = currentUser.displayName;
    const avWrap = document.getElementById('current-user-avatar');
    if (currentUser.avatar) {
      avWrap.innerHTML = `<img src="${escapeHtml(currentUser.avatar)}" class="avatar-img-circle" style="width:36px; height:36px; display:block;" alt="${escapeHtml(currentUser.displayName)}">`;
    } else {
      avWrap.innerHTML = `<div class="avatar" style="background:${colorFor(currentUser.displayName)}; width:36px; height:36px; font-size:13px;">${initials(currentUser.displayName)}</div>`;
    }
  }

  async function handleLogout() {
    if (!confirm('Вы действительно хотите выйти из аккаунта?')) {
      return;
    }
    const overlay = document.getElementById('profile-modal');
    if (overlay) {
      overlay.hidden = true;
      overlay.style.display = 'none';
      overlay.classList.remove('open');
    }
    unsubscribers.forEach(u => {
      try { u(); } catch {}
    });
    unsubscribers = [];
    await PoyetAPI.logout();
    currentUser = null;
    chats = [];
    messagesByChat = {};
    activeChatId = null;
    replyingTo = null;
    editingMsg = null;
    Auth.show();
  }

  let globalEventsWired = false;
  function wireGlobalEvents() {
    if (globalEventsWired) return;
    globalEventsWired = true;

    document.getElementById('search-input').addEventListener('input', (e) => renderChatList(e.target.value));

    const openSettings = () => openSettingsModal();
    document.getElementById('settings-btn')?.addEventListener('click', openSettings);
    document.getElementById('current-user-profile-trigger')?.addEventListener('click', openSettings);

    wireNewChatModal();
    wireNewGroupModal();
    wireProfileModal();
    wireAvatarCropper();
  }

  // ==========================================
  // DIRECT CHAT MODAL
  // ==========================================
  let modalWired = false;
  function wireNewChatModal() {
    if (modalWired) return;
    modalWired = true;
    const overlay = document.getElementById('new-chat-modal');
    const form = document.getElementById('new-chat-form');
    const input = document.getElementById('new-chat-username');
    const errorBox = document.getElementById('new-chat-error');
    const suggestionsBox = document.getElementById('new-chat-suggestions');

    async function loadSuggestions(query = '') {
      if (!suggestionsBox) return;
      const q = query.trim();
      if (!q) {
        suggestionsBox.innerHTML = '';
        suggestionsBox.classList.remove('show');
        return;
      }
      try {
        const users = await PoyetAPI.searchUsers(q);
        if (!users || users.length === 0) {
          suggestionsBox.innerHTML = '<div style="padding:10px; font-size:12.5px; color:#8b8f94; text-align:center;">Пользователь не найден</div>';
          suggestionsBox.classList.add('show');
          return;
        }
        suggestionsBox.innerHTML = users.map(u => `
          <div class="suggestion-item" data-username="${escapeHtml(u.username)}">
            <div class="suggestion-avatar" style="background:${colorFor(u.displayName)}">${u.avatar ? `<img src="${escapeHtml(u.avatar)}" class="avatar-img-circle" style="width:100%;height:100%;">` : initials(u.displayName)}</div>
            <div class="suggestion-info">
              <div class="suggestion-name">${escapeHtml(u.displayName)}</div>
              <div class="suggestion-user">@${escapeHtml(u.username)} • ${u.online ? '<span style="color:#4cd964">в сети</span>' : 'не в сети'}</div>
            </div>
          </div>
        `).join('');
        suggestionsBox.classList.add('show');

        suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            const targetUsername = item.getAttribute('data-username');
            input.value = targetUsername;
            startChatWith(targetUsername);
          });
        });
      } catch {
        suggestionsBox.classList.remove('show');
      }
    }

    async function startChatWith(username) {
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
    }

    let debounceTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadSuggestions(input.value.trim()), 200);
    });

    function open() {
      errorBox.hidden = true;
      input.value = '';
      if (suggestionsBox) {
        suggestionsBox.innerHTML = '';
        suggestionsBox.classList.remove('show');
      }
      overlay.hidden = false;
      overlay.style.display = 'flex';
      overlay.classList.add('open');
      input.focus();
    }
    function close() {
      overlay.hidden = true;
      overlay.style.display = 'none';
      overlay.classList.remove('open');
      if (suggestionsBox) suggestionsBox.classList.remove('show');
    }

    document.getElementById('new-chat-btn')?.addEventListener('click', open);
    document.getElementById('new-chat-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = input.value.trim();
      if (!username) return;
      startChatWith(username);
    });
  }

  // ==========================================
  // GROUP CHAT MODAL
  // ==========================================
  let groupModalWired = false;
  let groupAvatarBase64 = null;
  let selectedGroupMembers = [];

  function wireNewGroupModal() {
    if (groupModalWired) return;
    groupModalWired = true;

    const overlay = document.getElementById('new-group-modal');
    const nameInput = document.getElementById('group-name-input');
    const memberInput = document.getElementById('group-member-search');
    const suggestions = document.getElementById('group-member-suggestions');
    const selectedBox = document.getElementById('group-selected-members');
    const errorBox = document.getElementById('group-create-error');
    const submitBtn = document.getElementById('new-group-submit');
    const cancelBtn = document.getElementById('new-group-cancel');
    const avatarTrigger = document.getElementById('group-avatar-trigger');
    const avatarPreview = document.getElementById('group-avatar-preview');

    function open() {
      groupAvatarBase64 = null;
      selectedGroupMembers = [];
      nameInput.value = '';
      memberInput.value = '';
      errorBox.hidden = true;
      renderSelectedMembers();
      avatarPreview.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span>Фото</span>
      `;
      overlay.hidden = false;
      overlay.style.display = 'flex';
      overlay.classList.add('open');
      nameInput.focus();
    }

    function close() {
      overlay.hidden = true;
      overlay.style.display = 'none';
      overlay.classList.remove('open');
      if (suggestions) suggestions.classList.remove('show');
    }

    document.getElementById('new-group-btn')?.addEventListener('click', open);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    avatarTrigger.addEventListener('click', () => {
      startAvatarCropFlow((croppedBase64) => {
        groupAvatarBase64 = croppedBase64;
        avatarPreview.innerHTML = `<img src="${croppedBase64}" class="avatar-img-circle" style="width:100%; height:100%;" alt="Group avatar">`;
      });
    });

    let debTimer = null;
    memberInput.addEventListener('input', () => {
      clearTimeout(debTimer);
      debTimer = setTimeout(async () => {
        const q = memberInput.value.trim();
        if (!q) {
          suggestions.innerHTML = '';
          suggestions.classList.remove('show');
          return;
        }
        try {
          const users = await PoyetAPI.searchUsers(q);
          const filtered = (users || []).filter(u => !selectedGroupMembers.some(m => m.username === u.username));
          if (filtered.length === 0) {
            suggestions.innerHTML = '<div style="padding:10px; font-size:12.5px; color:#8b8f94; text-align:center;">Никого не найдено</div>';
            suggestions.classList.add('show');
            return;
          }
          suggestions.innerHTML = filtered.map(u => `
            <div class="suggestion-item" data-user='${escapeHtml(JSON.stringify(u))}'>
              <div class="suggestion-avatar" style="background:${colorFor(u.displayName)}">${u.avatar ? `<img src="${escapeHtml(u.avatar)}" class="avatar-img-circle" style="width:100%;height:100%;">` : initials(u.displayName)}</div>
              <div class="suggestion-info">
                <div class="suggestion-name">${escapeHtml(u.displayName)}</div>
                <div class="suggestion-user">@${escapeHtml(u.username)}</div>
              </div>
            </div>
          `).join('');
          suggestions.classList.add('show');

          suggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
              const uData = JSON.parse(item.getAttribute('data-user'));
              selectedGroupMembers.push(uData);
              memberInput.value = '';
              suggestions.classList.remove('show');
              renderSelectedMembers();
            });
          });
        } catch {
          suggestions.classList.remove('show');
        }
      }, 200);
    });

    function renderSelectedMembers() {
      if (selectedGroupMembers.length === 0) {
        selectedBox.innerHTML = '';
        return;
      }
      selectedBox.innerHTML = selectedGroupMembers.map((m, idx) => `
        <div class="member-chip">
          <span>${escapeHtml(m.displayName)}</span>
          <span class="member-chip-remove" data-idx="${idx}" title="Удалить">&times;</span>
        </div>
      `).join('');

      selectedBox.querySelectorAll('.member-chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          selectedGroupMembers.splice(idx, 1);
          renderSelectedMembers();
        });
      });
    }

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorBox.textContent = 'Пожалуйста, введите название группы';
        errorBox.hidden = false;
        return;
      }

      errorBox.hidden = true;
      submitBtn.disabled = true;
      try {
        const memberUsernames = selectedGroupMembers.map(m => m.username);
        const groupChat = await PoyetAPI.createGroupChat(name, memberUsernames, groupAvatarBase64);
        if (!chats.some(c => c.id === groupChat.id)) {
          chats.unshift(groupChat);
          messagesByChat[groupChat.id] = await PoyetAPI.getMessages(groupChat.id);
        }
        close();
        renderChatList();
        openChat(groupChat.id);
        showToast(`Группа «${name}» создана!`);
      } catch (err) {
        errorBox.textContent = err.message || 'Ошибка создания группы';
        errorBox.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ==========================================
  // PROFILE MODAL (VIEW & EDIT)
  // ==========================================
  let profileModalWired = false;
  function wireProfileModal() {
    if (profileModalWired) return;
    profileModalWired = true;
    const overlay = document.getElementById('profile-modal');
    const closeBtn = document.getElementById('profile-modal-close');

    closeBtn.addEventListener('click', () => {
      overlay.hidden = true;
      overlay.style.display = 'none';
      overlay.classList.remove('open');
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.hidden = true;
        overlay.style.display = 'none';
        overlay.classList.remove('open');
      }
    });
  }

  function openSettingsModal() {
    const overlay = document.getElementById('profile-modal');
    const titleEl = document.getElementById('profile-modal-title');
    const bodyEl = document.getElementById('profile-modal-body');

    titleEl.textContent = 'Настройки';
    let tempAvatar = currentUser.avatar || null;

    const notifSettings = window.Notifications ? window.Notifications.getSettings() : { enabled: true, sound: true, vibrate: true, preview: true, badge: true };
    const platform = window.Notifications ? window.Notifications.getPlatformInfo() : { osName: 'Устройство', osIcon: '💻' };
    const permStatus = ('Notification' in window) ? Notification.permission : 'unsupported';
    
    let statusText = 'Включены';
    let statusColor = '#34c759';
    if (permStatus === 'denied') {
      statusText = 'Заблокированы в браузере';
      statusColor = '#ff3b30';
    } else if (permStatus === 'default') {
      statusText = 'Требуется разрешение';
      statusColor = '#ff9500';
    }

    bodyEl.innerHTML = `
      <!-- 1. ПРОФИЛЬ -->
      <div class="settings-section">
        <div class="settings-section-title">Профиль</div>
        <div class="profile-avatar-box" style="margin-bottom: 6px;">
          <div class="profile-avatar-circle" id="my-profile-avatar-btn" title="Изменить фото профиля">
            <div id="my-profile-avatar-preview" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
              ${tempAvatar 
                ? `<img src="${escapeHtml(tempAvatar)}" class="avatar-img-circle" style="width:100%; height:100%;">` 
                : `<div class="avatar" style="background:${colorFor(currentUser.displayName)}; width:100%; height:100%; font-size:32px;">${initials(currentUser.displayName)}</div>`}
            </div>
            <div class="profile-avatar-hover">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              <span>Изменить</span>
            </div>
          </div>
        </div>

        <div class="profile-field">
          <label>Имя и фамилия</label>
          <input type="text" id="profile-edit-name" value="${escapeHtml(currentUser.displayName)}" maxlength="50" required>
        </div>

        <div class="profile-field">
          <label>Имя пользователя (username)</label>
          <input type="text" value="@${escapeHtml(currentUser.username)}" disabled style="opacity: 0.6; cursor: not-allowed;">
        </div>

        <div class="profile-field">
          <label>О себе (до 100 символов)</label>
          <textarea id="profile-edit-bio" maxlength="100" placeholder="Расскажите немного о себе...">${escapeHtml(currentUser.bio || '')}</textarea>
          <div class="profile-char-limit" id="profile-bio-counter">${(currentUser.bio || '').length} / 100</div>
        </div>
      </div>

      <!-- 2. ТЕМА ОФОРМЛЕНИЯ -->
      <div class="settings-section" style="margin-top: 2px;">
        <div class="settings-section-title">Тема оформления</div>
        <div class="theme-selector-group">
          <button type="button" class="theme-chip ${currentTheme === 'light' ? 'active' : ''}" data-theme-val="light">☀️ Светлая</button>
          <button type="button" class="theme-chip ${currentTheme === 'dark' ? 'active' : ''}" data-theme-val="dark">🌙 Тёмная</button>
          <button type="button" class="theme-chip ${currentTheme === 'system' ? 'active' : ''}" data-theme-val="system">💻 Системная</button>
        </div>
      </div>

      <!-- 3. УВЕДОМЛЕНИЯ -->
      <div class="settings-section" style="margin-top: 2px;">
        <div class="settings-section-title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Уведомления</span>
          <span style="font-size:11px; font-weight:500; text-transform:none; color:var(--text-secondary);">${platform.osIcon} ${platform.osName}</span>
        </div>

        <div class="notif-status-badge-row" style="margin: 4px 0 8px;">
          <div class="notif-status-indicator" style="background:${statusColor}; color:${statusColor};"></div>
          <div style="flex:1; min-width:0;">
            <div id="settings-notif-status-label" style="font-size:13px; font-weight:600; color:var(--text-main);">${statusText}</div>
            <div style="font-size:11.5px; color:var(--text-secondary);">Push-уведомления и звук</div>
          </div>
          <button type="button" class="notif-compact-btn ${permStatus === 'granted' ? 'secondary' : 'primary'}" id="settings-notif-action-btn" style="font-size:12px; padding:5px 12px;">
            ${permStatus === 'granted' ? 'Проверить' : 'Включить'}
          </button>
        </div>

        <div class="notif-options-group">
          <label class="notif-toggle-row">
            <div class="notif-toggle-text">
              <span class="notif-toggle-title">Всплывающие Push-уведомления</span>
              <span class="notif-toggle-desc">Показывать системные баннеры на устройстве</span>
            </div>
            <input type="checkbox" id="settings-notif-enabled" ${notifSettings.enabled ? 'checked' : ''} class="notif-toggle-switch">
          </label>

          <label class="notif-toggle-row">
            <div class="notif-toggle-text">
              <span class="notif-toggle-title">Звуковые сигналы</span>
              <span class="notif-toggle-desc">Звук при получении новых сообщений</span>
            </div>
            <input type="checkbox" id="settings-notif-sound" ${notifSettings.sound ? 'checked' : ''} class="notif-toggle-switch">
          </label>

          <label class="notif-toggle-row">
            <div class="notif-toggle-text">
              <span class="notif-toggle-title">Вибрация</span>
              <span class="notif-toggle-desc">Тактильный отклик на смартфонах</span>
            </div>
            <input type="checkbox" id="settings-notif-vibrate" ${notifSettings.vibrate ? 'checked' : ''} class="notif-toggle-switch">
          </label>

          <label class="notif-toggle-row">
            <div class="notif-toggle-text">
              <span class="notif-toggle-title">Предпросмотр сообщений</span>
              <span class="notif-toggle-desc">Отображать имя и текст в уведомлении</span>
            </div>
            <input type="checkbox" id="settings-notif-preview" ${notifSettings.preview ? 'checked' : ''} class="notif-toggle-switch">
          </label>

          <label class="notif-toggle-row">
            <div class="notif-toggle-text">
              <span class="notif-toggle-title">Счетчик на иконке (App Badge)</span>
              <span class="notif-toggle-desc">Количество непрочитанных на значке приложения</span>
            </div>
            <input type="checkbox" id="settings-notif-badge" ${notifSettings.badge ? 'checked' : ''} class="notif-toggle-switch">
          </label>
        </div>
      </div>

      <!-- 4. АККАУНТ И ВЫХОД -->
      <div class="settings-section" style="margin-top: 2px;">
        <div class="settings-section-title">Аккаунт</div>
        <button type="button" class="settings-logout-btn" id="settings-logout-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
          <span>Выйти из аккаунта</span>
        </button>
      </div>

      <div id="profile-edit-error" class="auth-error" hidden></div>

      <!-- FOOTER ACTIONS -->
      <div class="modal-actions" style="margin-top: 10px; padding-top: 14px; border-top: 1px solid var(--border);">
        <button type="button" class="modal-btn secondary" id="profile-cancel-btn">Закрыть</button>
        <button type="button" class="modal-btn primary" id="profile-save-btn">Сохранить профиль</button>
      </div>
    `;

    overlay.hidden = false;
    overlay.style.display = 'flex';
    overlay.classList.add('open');

    const bioInput = document.getElementById('profile-edit-bio');
    const counter = document.getElementById('profile-bio-counter');
    bioInput.addEventListener('input', () => {
      counter.textContent = `${bioInput.value.length} / 100`;
    });

    // Theme selector
    overlay.querySelectorAll('.theme-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.getAttribute('data-theme-val');
        setTheme(val);
        overlay.querySelectorAll('.theme-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Avatar change
    document.getElementById('my-profile-avatar-btn').addEventListener('click', () => {
      startAvatarCropFlow((cropped) => {
        tempAvatar = cropped;
        const prev = document.getElementById('my-profile-avatar-preview');
        if (prev) {
          prev.innerHTML = `<img src="${cropped}" class="avatar-img-circle" style="width:100%; height:100%;">`;
        }
      });
    });

    // Notifications Toggles
    const toggleEnabled = document.getElementById('settings-notif-enabled');
    const toggleSound = document.getElementById('settings-notif-sound');
    const toggleVibrate = document.getElementById('settings-notif-vibrate');
    const togglePreview = document.getElementById('settings-notif-preview');
    const toggleBadge = document.getElementById('settings-notif-badge');
    const actionBtn = document.getElementById('settings-notif-action-btn');

    if (toggleSound) {
      toggleSound.onchange = (e) => {
        if (window.Notifications) window.Notifications.setSetting('sound', e.target.checked);
        if (e.target.checked && window.Notifications) window.Notifications.playNotificationSound();
      };
    }
    if (toggleVibrate) {
      toggleVibrate.onchange = (e) => {
        if (window.Notifications) window.Notifications.setSetting('vibrate', e.target.checked);
        if (e.target.checked && window.Notifications) window.Notifications.triggerVibration();
      };
    }
    if (togglePreview) {
      togglePreview.onchange = (e) => {
        if (window.Notifications) window.Notifications.setSetting('preview', e.target.checked);
      };
    }
    if (toggleBadge) {
      toggleBadge.onchange = (e) => {
        if (window.Notifications) window.Notifications.setSetting('badge', e.target.checked);
      };
    }
    if (toggleEnabled) {
      toggleEnabled.onchange = async (e) => {
        if (e.target.checked) {
          if (window.Notifications) {
            const res = await window.Notifications.requestPermission();
            if (res.status !== 'granted') {
              e.target.checked = false;
            } else {
              window.Notifications.setSetting('enabled', true);
            }
          }
        } else {
          if (window.Notifications) window.Notifications.setSetting('enabled', false);
        }
      };
    }

    if (actionBtn) {
      actionBtn.onclick = async () => {
        if (permStatus !== 'granted' && window.Notifications) {
          await window.Notifications.requestPermission();
          openSettingsModal();
        } else if (window.Notifications && typeof window.Notifications.triggerTest === 'function') {
          window.Notifications.triggerTest();
        }
      };
    }

    // Logout
    document.getElementById('settings-logout-btn')?.addEventListener('click', handleLogout);

    // Cancel / Close
    document.getElementById('profile-cancel-btn').addEventListener('click', () => {
      overlay.hidden = true;
      overlay.style.display = 'none';
      overlay.classList.remove('open');
    });

    // Save profile changes
    document.getElementById('profile-save-btn').addEventListener('click', async () => {
      const newName = document.getElementById('profile-edit-name').value.trim();
      const newBio = bioInput.value.trim();
      const errBox = document.getElementById('profile-edit-error');

      if (!newName) {
        errBox.textContent = 'Имя не может быть пустым';
        errBox.hidden = false;
        return;
      }

      errBox.hidden = true;
      try {
        const updated = await PoyetAPI.updateProfile({
          displayName: newName,
          bio: newBio,
          avatar: tempAvatar,
        });

        currentUser.displayName = updated.displayName;
        currentUser.bio = updated.bio;
        currentUser.avatar = updated.avatar;

        updateCurrentUserHeaderUI();
        renderChatList();
        const activeChat = chats.find(c => c.id === activeChatId);
        if (activeChat) renderMain();

        overlay.hidden = true;
        overlay.style.display = 'none';
        overlay.classList.remove('open');
        showToast('Настройки профиля сохранены!');
      } catch (err) {
        errBox.textContent = err.message || 'Ошибка обновления профиля';
        errBox.hidden = false;
      }
    });
  }

  const openMyProfileModal = openSettingsModal;

  async function openUserProfileModal(chat) {
    const overlay = document.getElementById('profile-modal');
    const titleEl = document.getElementById('profile-modal-title');
    const bodyEl = document.getElementById('profile-modal-body');

    titleEl.textContent = chat.isGroup ? 'Информация о группе' : 'Профиль собеседника';

    let userBio = chat.bio || '';
    let membersHtml = '';

    if (chat.isGroup) {
      const parts = chat.participants || [];
      membersHtml = `
        <div style="margin-top: 14px; text-align: left;">
          <label class="modal-field-label">Участники (${parts.length}):</label>
          <div style="max-height: 150px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px;">
            ${parts.map(p => `
              <div class="suggestion-item" style="cursor: default;">
                <div class="suggestion-avatar" style="background:${colorFor(p.displayName)}">${p.avatar ? `<img src="${escapeHtml(p.avatar)}" class="avatar-img-circle" style="width:100%;height:100%;">` : initials(p.displayName)}</div>
                <div class="suggestion-info">
                  <div class="suggestion-name">${escapeHtml(p.displayName)} ${p.id === currentUser.id ? '(Вы)' : ''}</div>
                  <div class="suggestion-user">@${escapeHtml(p.username)} • ${p.online ? '<span style="color:#4cd964">в сети</span>' : 'не в сети'}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else if (chat.otherUserId) {
      try {
        const u = await PoyetAPI.getUserProfile(chat.otherUserId);
        if (u) {
          userBio = u.bio || '';
        }
      } catch { /* noop */ }
    }

    bodyEl.innerHTML = `
      <div class="profile-avatar-box">
        <div class="profile-avatar-circle" style="cursor: default; width: 90px; height: 90px;">
          ${chat.avatar 
            ? `<img src="${escapeHtml(chat.avatar)}" class="avatar-img-circle" style="width:100%; height:100%;">` 
            : `<div class="avatar" style="background:${colorFor(chat.name)}; width:100%; height:100%; font-size:32px;">${chat.isGroup ? '👥' : initials(chat.name)}</div>`}
        </div>
        <div style="font-size: 17px; font-weight: 600; margin-top: 4px;">${escapeHtml(chat.name)}</div>
        <div style="font-size: 13px; color: var(--text-secondary);">${statusLabel(chat)}</div>
      </div>

      ${!chat.isGroup ? `
        <div class="profile-info-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <div class="profile-info-content">
            <span class="profile-info-label">Имя пользователя</span>
            <span class="profile-info-val">@${escapeHtml(chat.name.toLowerCase().replace(/\s+/g, '_'))}</span>
          </div>
        </div>

        <div class="profile-info-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          <div class="profile-info-content">
            <span class="profile-info-label">О себе</span>
            <span class="profile-info-val profile-view-bio">${userBio ? escapeHtml(userBio) : '<span style="color:var(--text-secondary); font-style:italic;">Информация о себе не указана</span>'}</span>
          </div>
        </div>
      ` : membersHtml}

      <div class="modal-actions" style="margin-top: 20px;">
        <button type="button" class="modal-btn primary" id="profile-view-close-btn">Закрыть</button>
      </div>
    `;

    overlay.hidden = false;
    overlay.style.display = 'flex';
    overlay.classList.add('open');

    document.getElementById('profile-view-close-btn').addEventListener('click', () => {
      overlay.hidden = true;
      overlay.style.display = 'none';
      overlay.classList.remove('open');
    });
  }

  // ==========================================
  // AVATAR CIRCULAR CROPPER
  // ==========================================
  let onCropCompletedCallback = null;
  let cropImageObj = null;
  let cropScale = 1;
  let cropOffsetX = 0;
  let cropOffsetY = 0;
  let isDraggingCrop = false;
  let dragStartX = 0;
  let dragStartY = 0;

  function wireAvatarCropper() {
    const cropModal = document.getElementById('avatar-crop-modal');
    const canvas = document.getElementById('crop-canvas');
    const container = document.getElementById('crop-canvas-container');
    const zoomSlider = document.getElementById('crop-zoom');
    const cancelBtn = document.getElementById('crop-cancel-btn');
    const saveBtn = document.getElementById('crop-save-btn');
    const fileInput = document.getElementById('global-avatar-file-input');

    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      fileInput.value = '';
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          cropImageObj = img;
          cropScale = 1;
          cropOffsetX = 0;
          cropOffsetY = 0;
          zoomSlider.value = 1;
          renderCropCanvas();
          cropModal.hidden = false;
          cropModal.style.display = 'flex';
          cropModal.classList.add('open');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    function renderCropCanvas() {
      if (!cropImageObj) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width;
      const h = canvas.height;

      // Calculate cover dimensions
      const aspect = cropImageObj.width / cropImageObj.height;
      let drawW, drawH;
      if (aspect > 1) {
        drawH = h * cropScale;
        drawW = drawH * aspect;
      } else {
        drawW = w * cropScale;
        drawH = drawW / aspect;
      }

      const drawX = (w - drawW) / 2 + cropOffsetX;
      const drawY = (h - drawH) / 2 + cropOffsetY;

      ctx.drawImage(cropImageObj, drawX, drawY, drawW, drawH);
    }

    zoomSlider.addEventListener('input', () => {
      cropScale = parseFloat(zoomSlider.value);
      renderCropCanvas();
    });

    container.addEventListener('mousedown', (e) => {
      isDraggingCrop = true;
      dragStartX = e.clientX - cropOffsetX;
      dragStartY = e.clientY - cropOffsetY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingCrop) return;
      cropOffsetX = e.clientX - dragStartX;
      cropOffsetY = e.clientY - dragStartY;
      renderCropCanvas();
    });

    window.addEventListener('mouseup', () => {
      isDraggingCrop = false;
    });

    // Touch support for mobile devices
    container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDraggingCrop = true;
        dragStartX = e.touches[0].clientX - cropOffsetX;
        dragStartY = e.touches[0].clientY - cropOffsetY;
      }
    });
    container.addEventListener('touchmove', (e) => {
      if (isDraggingCrop && e.touches.length === 1) {
        cropOffsetX = e.touches[0].clientX - dragStartX;
        cropOffsetY = e.touches[0].clientY - dragStartY;
        renderCropCanvas();
        e.preventDefault();
      }
    }, { passive: false });
    container.addEventListener('touchend', () => {
      isDraggingCrop = false;
    });

    cancelBtn.addEventListener('click', () => {
      cropModal.hidden = true;
      cropModal.style.display = 'none';
      cropModal.classList.remove('open');
      cropImageObj = null;
    });

    saveBtn.addEventListener('click', () => {
      if (!cropImageObj) return;
      // Render final round cropped image to 300x300 output canvas
      const outCanvas = document.createElement('canvas');
      outCanvas.width = 300;
      outCanvas.height = 300;
      const outCtx = outCanvas.getContext('2d');

      outCtx.save();
      outCtx.beginPath();
      outCtx.arc(150, 150, 150, 0, Math.PI * 2);
      outCtx.closePath();
      outCtx.clip();

      // Render scaled and shifted image on output canvas
      const factor = 300 / canvas.width;
      const aspect = cropImageObj.width / cropImageObj.height;
      let drawW, drawH;
      if (aspect > 1) {
        drawH = canvas.height * cropScale;
        drawW = drawH * aspect;
      } else {
        drawW = canvas.width * cropScale;
        drawH = drawW / aspect;
      }
      const drawX = (canvas.width - drawW) / 2 + cropOffsetX;
      const drawY = (canvas.height - drawH) / 2 + cropOffsetY;

      outCtx.drawImage(cropImageObj, drawX * factor, drawY * factor, drawW * factor, drawH * factor);
      outCtx.restore();

      const finalBase64 = outCanvas.toDataURL('image/jpeg', 0.88);

      cropModal.hidden = true;
      cropModal.style.display = 'none';
      cropModal.classList.remove('open');

      if (onCropCompletedCallback) {
        onCropCompletedCallback(finalBase64);
        onCropCompletedCallback = null;
      }
    });
  }

  function startAvatarCropFlow(callback) {
    onCropCompletedCallback = callback;
    const fileInput = document.getElementById('global-avatar-file-input');
    fileInput.click();
  }

  function showToast(text) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,0.9);color:#fff;padding:10px 18px;border-radius:12px;font-size:14px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.25);transition:opacity 0.2s ease;';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }

  function subscribeToRealtime() {
    unsubscribers.push(PoyetAPI.onMessage(async ({ chatId, message }) => {
      messagesByChat[chatId] = messagesByChat[chatId] || [];
      if (!messagesByChat[chatId].some(m => m.id === message.id)) {
        messagesByChat[chatId].push(message);
      }
      let chat = chats.find(c => c.id === chatId);
      if (!chat) {
        try {
          const freshChats = await PoyetAPI.getChats();
          chats = freshChats;
          chat = chats.find(c => c.id === chatId);
        } catch { /* noop */ }
      }
      if (chat) chat.lastMessageAt = message.createdAt;

      if (chatId === activeChatId) {
        if (chat) renderMessages(chat);
        if (message.senderId !== currentUser.id) {
          PoyetAPI.markRead(chatId).catch(() => {});
        }
      } else if (message.senderId !== currentUser.id && chat) {
        chat.unread = (chat.unread || 0) + 1;
      }

      // Cross-platform Notifications Trigger (Apple, Android, Windows, Linux)
      if (message.senderId !== currentUser.id && chat) {
        const totalUnread = chats.reduce((acc, c) => acc + (c.unread || 0), 0);
        if (window.Notifications && typeof window.Notifications.onIncomingMessage === 'function') {
          window.Notifications.onIncomingMessage(chat, message, chatId === activeChatId, totalUnread);
        }
      }

      renderChatList(document.getElementById('search-input').value);
    }));

    unsubscribers.push(PoyetAPI.onMessageStatus(({ chatId, messageId, status }) => {
      const msg = (messagesByChat[chatId] || []).find(m => m.id === messageId);
      if (msg) { msg.status = status; if (chatId === activeChatId) renderMessages(chats.find(c => c.id === chatId)); }
    }));

    if (PoyetAPI.onMessageEdit) {
      unsubscribers.push(PoyetAPI.onMessageEdit(({ chatId, message }) => {
        const msgs = messagesByChat[chatId] || [];
        const idx = msgs.findIndex(m => m.id === message.id);
        if (idx !== -1) {
          msgs[idx] = message;
        } else {
          msgs.push(message);
        }
        if (chatId === activeChatId) {
          const chat = chats.find(c => c.id === chatId);
          if (chat) renderMessages(chat);
        }
        renderChatList(document.getElementById('search-input')?.value || '');
      }));
    }

    if (PoyetAPI.onMessageDelete) {
      unsubscribers.push(PoyetAPI.onMessageDelete(({ chatId, messageId }) => {
        if (messagesByChat[chatId]) {
          messagesByChat[chatId] = messagesByChat[chatId].filter(m => m.id !== messageId);
        }
        if (chatId === activeChatId) {
          const chat = chats.find(c => c.id === chatId);
          if (chat) renderMessages(chat);
        }
        renderChatList(document.getElementById('search-input')?.value || '');
      }));
    }

    if (PoyetAPI.onMessageReaction) {
      unsubscribers.push(PoyetAPI.onMessageReaction(({ chatId, messageId, reactions }) => {
        const msgs = messagesByChat[chatId] || [];
        const msg = msgs.find(m => m.id === messageId);
        if (msg) {
          msg.reactions = reactions;
          if (chatId === activeChatId) {
            const chat = chats.find(c => c.id === chatId);
            if (chat) renderMessages(chat);
          }
        }
      }));
    }

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

  let searchUsersDebounce = null;
  let lastSearchQuery = '';

  function renderChatList(filter = '') {
    const list = document.getElementById('chat-list');
    const sorted = [...chats].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    const rawF = filter.trim();
    const f = rawF.toLowerCase();
    const cleanF = f.replace(/^@/, '');
    lastSearchQuery = rawF;

    if (!f) {
      // Normal full list of chats
      list.innerHTML = sorted.map(chat => renderSingleChatItemHtml(chat)).join('') || `<div class="empty-list">Нет чатов. Введите имя или @username в поиске выше, чтобы найти собеседника.</div>`;
      bindChatItemClicks(list);
      updateAppBadge();
      return;
    }

    // 1. Matching existing chats (by name, username, or participants)
    const matchingChats = sorted.filter(c => {
      const cName = (c.name || '').toLowerCase();
      const uName = (c.username || c.contactUsername || '').toLowerCase();
      return cName.includes(f) || cName.includes(cleanF) || uName.includes(cleanF);
    });

    let html = '';

    if (matchingChats.length > 0) {
      html += `<div class="search-category-title">Чаты</div>`;
      html += matchingChats.map(chat => renderSingleChatItemHtml(chat)).join('');
    }

    // Placeholder for global users while fetching or if found
    html += `<div id="search-global-users-section">
      <div class="search-category-title">Пользователи</div>
      <div class="search-loading-hint">Поиск пользователей...</div>
    </div>`;

    if (matchingChats.length === 0) {
      list.innerHTML = `
        <div id="search-global-users-section">
          <div class="search-category-title">Пользователи</div>
          <div class="search-loading-hint">Поиск пользователей...</div>
        </div>
      `;
    } else {
      list.innerHTML = html;
    }

    bindChatItemClicks(list);
    updateAppBadge();

    // Trigger async global user search with debounce
    clearTimeout(searchUsersDebounce);
    searchUsersDebounce = setTimeout(async () => {
      if (lastSearchQuery !== rawF) return; // stale query
      try {
        const users = await PoyetAPI.searchUsers(rawF);
        const sec = document.getElementById('search-global-users-section');
        if (!sec || lastSearchQuery !== rawF) return;

        // Filter out current user
        const otherUsers = (users || []).filter(u => u.id !== currentUser.id && u.username !== currentUser.username);

        if (otherUsers.length === 0) {
          if (matchingChats.length === 0) {
            sec.innerHTML = `<div class="empty-list">Ничего не найдено по запросу «${escapeHtml(rawF)}»</div>`;
          } else {
            sec.innerHTML = `<div class="search-category-title">Пользователи</div><div class="empty-list" style="padding:12px;">Пользователи не найдены</div>`;
          }
          return;
        }

        sec.innerHTML = `
          <div class="search-category-title">Пользователи (${otherUsers.length})</div>
          <div class="search-users-container">
            ${otherUsers.map(u => `
              <div class="search-user-item" data-user='${escapeHtml(JSON.stringify(u))}'>
                <div class="avatar" style="background:${colorFor(u.displayName)}; width:44px; height:44px; font-size:15px; flex-shrink:0;">
                  ${u.avatar ? `<img src="${escapeHtml(u.avatar)}" class="avatar-img-circle" style="width:100%;height:100%;">` : initials(u.displayName)}
                  ${u.online ? '<div class="online-dot"></div>' : ''}
                </div>
                <div class="search-user-info">
                  <div class="search-user-name">${escapeHtml(u.displayName)}</div>
                  <div class="search-user-handle">@${escapeHtml(u.username)} • ${u.online ? '<span style="color:var(--online)">в сети</span>' : 'не в сети'}</div>
                </div>
                <button type="button" class="search-user-start-btn" title="Начать чат">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <span>Написать</span>
                </button>
              </div>
            `).join('')}
          </div>
        `;

        sec.querySelectorAll('.search-user-item').forEach(el => {
          el.addEventListener('click', async () => {
            const uData = JSON.parse(el.getAttribute('data-user'));
            await directStartChatWithUser(uData);
          });
        });
      } catch (err) {
        const sec = document.getElementById('search-global-users-section');
        if (sec) {
          sec.innerHTML = `<div class="empty-list" style="padding:12px;">Ошибка поиска пользователей</div>`;
        }
      }
    }, 180);
  }

  function renderSingleChatItemHtml(chat) {
    const msgs = messagesByChat[chat.id] || [];
    const lm = msgs[msgs.length - 1];
    const timeStr = lm ? fmtListTime(lm.createdAt) : fmtListTime(chat.lastMessageAt || new Date().toISOString());
    let preview = '<span style="opacity: 0.6; font-style: italic;">Чат создан</span>';
    if (lm) {
      const mine = lm.senderId === currentUser.id;
      const prefix = mine ? 'Вы: ' : '';
      if (lm.mediaType === 'image') preview = escapeHtml(prefix) + '📷 Фото' + (lm.text ? ': ' + escapeHtml(lm.text) : '');
      else if (lm.mediaType === 'video') preview = escapeHtml(prefix) + '📹 Видео' + (lm.text ? ': ' + escapeHtml(lm.text) : '');
      else if (lm.mediaType === 'round_video') preview = escapeHtml(prefix) + '🔘 Видеосообщение' + (lm.text ? ': ' + escapeHtml(lm.text) : '');
      else if (lm.mediaType === 'voice') preview = escapeHtml(prefix) + '🎤 Голосовое сообщение';
      else if (lm.mediaType === 'file') preview = escapeHtml(prefix) + '📎 ' + escapeHtml((lm.mediaMeta && lm.mediaMeta.fileName) || 'Файл');
      else preview = escapeHtml(prefix + (lm.text || ''));
    }
    const unread = chat.unread || 0;
    const badge = unread > 0 ? `<div class="unread-badge">${unread}</div>` : '';
    return `
      <div class="chat-item ${chat.id === activeChatId ? 'active' : ''}" data-id="${chat.id}">
        ${avatarHtml(chat, 48)}
        <div class="chat-item-body">
          <div class="chat-item-top">
            <div class="chat-name">${escapeHtml(chat.name)}</div>
            <div class="chat-time">${timeStr}</div>
          </div>
          <div class="chat-item-bottom">
            <div class="chat-preview">${preview}</div>
            ${badge}
          </div>
        </div>
      </div>`;
  }

  function bindChatItemClicks(container) {
    container.querySelectorAll('.chat-item').forEach(el => {
      el.addEventListener('click', () => openChat(el.dataset.id));
    });
  }

  function updateAppBadge() {
    const totalUnread = chats.reduce((acc, c) => acc + (c.unread || 0), 0);
    if (window.Notifications && typeof window.Notifications.updateAppBadge === 'function') {
      window.Notifications.updateAppBadge(totalUnread);
    }
  }

  async function directStartChatWithUser(userObj) {
    try {
      showToast(`Открываем диалог с ${userObj.displayName}...`);
      const targetIdentifier = userObj.id || userObj.username;
      const chat = await PoyetAPI.startChat(targetIdentifier);
      if (!chats.some(c => c.id === chat.id)) {
        messagesByChat[chat.id] = messagesByChat[chat.id] || [];
        chats.unshift(chat);
      }
      // Clear search input
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = '';
      openChat(chat.id);
      if (!messagesByChat[chat.id] || messagesByChat[chat.id].length === 0) {
        messagesByChat[chat.id] = await PoyetAPI.getMessages(chat.id);
        renderMessages(chat);
      }
    } catch (err) {
      showToast(err.message || 'Не удалось открыть чат');
    }
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

  function emptyStateHtml() {
    return `
      <div id="empty-state">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <h3>Выберите чат</h3>
        <p>Создайте групповой или личный чат, чтобы начать общение</p>
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
        ? `<span class="ticks" title="Прочитано"><svg width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 5.5l3 3 4-6"/><path d="M6 5.5l3 3 6-8"/></svg></span>`
        : `<span class="ticks" title="Отправлено"><svg width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 5.5l3 3 8-8"/></svg></span>`) : '';

      const editedBadge = m.isEdited ? `<span class="edited-tag" title="Отредактировано">ред.</span>` : '';

      // Forwarded header if forwarded
      let forwardedHtml = '';
      if (m.forwardedFrom && m.forwardedFrom.senderName) {
        forwardedHtml = `
          <div class="msg-forwarded-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
            Переслано от ${escapeHtml(m.forwardedFrom.senderName)}
          </div>
        `;
      }

      // Reply quote box if replied
      let replyQuoteHtml = '';
      if (m.replyTo && m.replyTo.id) {
        replyQuoteHtml = `
          <div class="msg-reply-quote" data-reply-id="${escapeHtml(m.replyTo.id)}">
            <div class="msg-reply-name">${escapeHtml(m.replyTo.senderName || 'Собеседник')}</div>
            <div class="msg-reply-text">${escapeHtml(m.replyTo.text || 'Сообщение')}</div>
          </div>
        `;
      }

      let bodyHtml = '';
      const mediaType = m.mediaType || 'text';

      if (mediaType === 'image' && m.mediaUrl) {
        bodyHtml = `
          ${forwardedHtml}
          ${replyQuoteHtml}
          <img src="${escapeHtml(m.mediaUrl)}" class="bubble-image" alt="Изображение" onclick="window.open('${escapeHtml(m.mediaUrl)}', '_blank')">
          ${m.text ? `<div class="bubble-caption">${escapeHtml(m.text)}</div>` : ''}
        `;
      } else if (mediaType === 'video' && m.mediaUrl) {
        bodyHtml = `
          ${forwardedHtml}
          ${replyQuoteHtml}
          <video src="${escapeHtml(m.mediaUrl)}" class="bubble-video" controls playsinline preload="metadata"></video>
          ${m.text ? `<div class="bubble-caption">${escapeHtml(m.text)}</div>` : ''}
        `;
      } else if (mediaType === 'round_video' && m.mediaUrl) {
        const dur = (m.mediaMeta && m.mediaMeta.duration) ? formatDuration(m.mediaMeta.duration) : '0:00';
        bodyHtml = `
          ${forwardedHtml}
          ${replyQuoteHtml}
          <div class="round-video-container" data-src="${escapeHtml(m.mediaUrl)}">
            <button type="button" class="round-context-btn" title="Действия">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="5" r="2.5"/><circle cx="12" cy="19" r="2.5"/></svg>
            </button>
            <div class="round-video-media-wrap">
              <video class="round-video-el" src="${escapeHtml(m.mediaUrl)}" playsinline preload="metadata"></video>
              <div class="round-video-play-overlay">
                <div class="round-play-icon-badge">
                  <svg class="round-play-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  <svg class="round-pause-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </div>
              </div>
              <div class="round-video-time-tag">${dur}</div>
            </div>
            <svg class="round-video-ring" viewBox="0 0 220 220">
              <circle class="round-ring-bg" cx="110" cy="110" r="105" />
              <circle class="round-ring-progress" cx="110" cy="110" r="105" />
              <circle class="round-ring-hitarea" cx="110" cy="110" r="105" />
              <circle class="round-ring-thumb" cx="110" cy="5" r="5.5" />
            </svg>
          </div>
          ${m.text ? `<div class="bubble-caption round-caption">${escapeHtml(m.text)}</div>` : ''}
        `;
      } else if (mediaType === 'voice' && m.mediaUrl) {
        const dur = (m.mediaMeta && m.mediaMeta.duration) ? formatDuration(m.mediaMeta.duration) : '0:00';
        bodyHtml = `
          ${forwardedHtml}
          ${replyQuoteHtml}
          <div class="voice-player" data-src="${escapeHtml(m.mediaUrl)}">
            <button class="voice-play-btn" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <div class="voice-track">
              <div class="voice-progress-bar"><div class="voice-progress-fill"></div></div>
              <div class="voice-time">${dur}</div>
            </div>
            <audio src="${escapeHtml(m.mediaUrl)}" preload="metadata"></audio>
          </div>
          ${m.text ? `<div class="bubble-caption">${escapeHtml(m.text)}</div>` : ''}
        `;
      } else if (mediaType === 'file' && m.mediaUrl) {
        const name = (m.mediaMeta && m.mediaMeta.fileName) || 'Файл';
        const sizeStr = (m.mediaMeta && m.mediaMeta.fileSize) ? formatFileSize(m.mediaMeta.fileSize) : '';
        bodyHtml = `
          ${forwardedHtml}
          ${replyQuoteHtml}
          <a href="${escapeHtml(m.mediaUrl)}" download="${escapeHtml(name)}" class="file-bubble-item">
            <div class="file-bubble-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
            </div>
            <div class="file-bubble-details">
              <div class="file-bubble-name">${escapeHtml(name)}</div>
              <div class="file-bubble-size">${sizeStr}</div>
            </div>
          </a>
          ${m.text ? `<div class="bubble-caption">${escapeHtml(m.text)}</div>` : ''}
        `;
      } else {
        bodyHtml = `
          ${forwardedHtml}
          ${replyQuoteHtml}
          <span class="text">${escapeHtml(m.text)}</span>
        `;
      }

      const swipeIconHtml = `
        <div class="msg-swipe-reply-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
        </div>
      `;

      let reactionsHtml = '';
      if (m.reactions && typeof m.reactions === 'object') {
        const activeEntries = Object.entries(m.reactions).filter(([_, uids]) => Array.isArray(uids) && uids.length > 0);
        if (activeEntries.length > 0) {
          reactionsHtml = `
            <div class="msg-reactions-row">
              ${activeEntries.map(([emoji, uids]) => {
                const hasMine = uids.includes(currentUser.id);
                return `
                  <button type="button" class="reaction-chip ${hasMine ? 'active' : ''}" data-emoji="${escapeHtml(emoji)}" data-msg-id="${escapeHtml(m.id)}" title="${uids.length} чел.">
                    <span class="reaction-chip-emoji">${escapeHtml(emoji)}</span>
                    <span class="reaction-chip-count">${uids.length}</span>
                  </button>
                `;
              }).join('')}
            </div>
          `;
        }
      }

      if (mediaType === 'round_video') {
        html += `
          <div class="msg-row ${mine ? 'out' : 'in'}" data-id="${escapeHtml(m.id)}">
            ${swipeIconHtml}
            <div class="msg-bubble-wrap">
              <div class="bubble is-round-video">
                ${bodyHtml}
                <span class="meta round-meta">${editedBadge}${fmtTime(m.createdAt)}${ticks}</span>
              </div>
              ${reactionsHtml}
            </div>
          </div>`;
      } else {
        html += `
          <div class="msg-row ${mine ? 'out' : 'in'}" data-id="${escapeHtml(m.id)}">
            ${swipeIconHtml}
            <div class="msg-bubble-wrap">
              <div class="bubble ${mediaType !== 'text' ? 'has-media' : ''}">
                ${bodyHtml}
                <span class="meta">${editedBadge}${fmtTime(m.createdAt)}${ticks}</span>
              </div>
              ${reactionsHtml}
            </div>
          </div>`;
      }
    });
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
    wireAudioPlayers();
    wireRoundVideoPlayers();
    wireMessageInteractions(chat);
  }

  function wireMessageInteractions(chat) {
    const container = document.getElementById('messages');
    if (!container) return;

    // Wire clicks on reaction chips
    container.querySelectorAll('.reaction-chip').forEach(chip => {
      chip.addEventListener('click', async (e) => {
        e.stopPropagation();
        const emoji = chip.getAttribute('data-emoji');
        const msgId = chip.getAttribute('data-msg-id');
        if (!emoji || !msgId) return;
        try {
          if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} }
          await PoyetAPI.toggleReaction(chat.id, msgId, emoji);
        } catch (err) {
          showToast(err.message || 'Ошибка реакции');
        }
      });
    });

    container.querySelectorAll('.msg-row').forEach(row => {
      const msgId = row.getAttribute('data-id');
      const msgs = messagesByChat[chat.id] || [];
      const msg = msgs.find(m => m.id === msgId);
      if (!msg) return;

      // 1. Right click on desktop opens context menu
      row.addEventListener('contextmenu', (e) => {
        openMessageContextMenu(msg, e);
      });

      // 2. Round video context button
      const roundCtxBtn = row.querySelector('.round-context-btn');
      if (roundCtxBtn) {
        roundCtxBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openMessageContextMenu(msg, e);
        });
      }

      // 3. Swipe to Reply & Long press
      let longPressTimer = null;
      let startX = 0;
      let startY = 0;
      let isSwiping = false;
      let replyTriggered = false;
      const swipeReplyIcon = row.querySelector('.msg-swipe-reply-icon');

      row.addEventListener('pointerdown', (e) => {
        // Skip interactive link downloads or seeker thumb/hitarea or context buttons or reaction chips
        if (e.target.closest('a') || e.target.closest('.reaction-chip') || e.target.closest('.round-context-btn') || e.target.closest('.round-ring-hitarea') || e.target.closest('.round-ring-thumb')) {
          return;
        }
        startX = e.clientX;
        startY = e.clientY;
        isSwiping = false;
        replyTriggered = false;

        longPressTimer = setTimeout(() => {
          if (!isSwiping) {
            openMessageContextMenu(msg, e);
          }
        }, 450);
      });

      row.addEventListener('pointermove', (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (Math.abs(dy) > 12 && Math.abs(dx) < 12) {
          clearTimeout(longPressTimer);
        }

        // Swipe left gesture
        if (dx < -10 && Math.abs(dy) < Math.abs(dx) * 1.5) {
          clearTimeout(longPressTimer);
          isSwiping = true;
          row.classList.add('swiping');
          const clamped = Math.max(dx, -70);
          row.style.transform = `translateX(${clamped}px)`;

          if (swipeReplyIcon) {
            if (clamped <= -28) {
              swipeReplyIcon.classList.add('active');
              if (!replyTriggered) {
                replyTriggered = true;
                row._swipedReply = true;
                startReply(msg);
                if (navigator.vibrate) {
                  try { navigator.vibrate(15); } catch {}
                }
              }
            } else {
              if (!replyTriggered) {
                swipeReplyIcon.classList.remove('active');
              }
            }
          }
        }
      });

      function finishSwipe(e) {
        clearTimeout(longPressTimer);
        if (isSwiping) {
          row.classList.remove('swiping');
          row.style.transform = '';
          if (swipeReplyIcon) swipeReplyIcon.classList.remove('active');
          isSwiping = false;
          setTimeout(() => {
            row._swipedReply = false;
          }, 300);
        }
      }

      row.addEventListener('pointerup', finishSwipe);
      row.addEventListener('pointercancel', finishSwipe);
    });

    // Wire clicks on reply quotes to scroll and highlight target message
    container.querySelectorAll('.msg-reply-quote').forEach(quote => {
      quote.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = quote.getAttribute('data-reply-id');
        if (!targetId) return;
        const targetEl = container.querySelector(`.msg-row[data-id="${targetId}"]`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetEl.classList.add('highlight-msg');
          setTimeout(() => targetEl.classList.remove('highlight-msg'), 2500);
        }
      });
    });
  }

  function openMessageContextMenu(m, e) {
    if (e) { e.preventDefault(); }
    const existing = document.getElementById('message-context-menu');
    if (existing) existing.remove();

    const isMine = m.senderId === currentUser.id;
    const canEdit = isMine && (!m.mediaType || m.mediaType === 'text');

    const overlay = document.createElement('div');
    overlay.id = 'message-context-menu';
    overlay.className = 'context-menu-overlay';

    const card = document.createElement('div');
    card.className = 'context-menu-card';

    // Quick reactions row
    const reactionsBar = document.createElement('div');
    reactionsBar.className = 'ctx-reactions-bar';
    reactionsBar.innerHTML = `
      ${QUICK_REACTIONS.map(emoji => {
        const isSelected = m.reactions && m.reactions[emoji] && m.reactions[emoji].includes(currentUser.id);
        return `<button type="button" class="ctx-reaction-item ${isSelected ? 'active' : ''}" data-emoji="${escapeHtml(emoji)}" title="${escapeHtml(emoji)}">${emoji}</button>`;
      }).join('')}
      <button type="button" class="ctx-reaction-more-btn" id="ctx-reaction-more" title="Все эмодзи">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
      </button>
    `;

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'context-menu-actions';
    actionsWrap.innerHTML = `
      <button class="context-menu-item" id="ctx-reply">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
        Ответить
      </button>
      ${canEdit ? `
        <button class="context-menu-item" id="ctx-edit">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Редактировать
        </button>
      ` : ''}
      <button class="context-menu-item" id="ctx-forward">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
        Переслать
      </button>
      ${m.text ? `
        <button class="context-menu-item" id="ctx-copy">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Копировать текст
        </button>
      ` : ''}
      <button class="context-menu-item danger" id="ctx-delete">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        Удалить для всех
      </button>
    `;

    card.appendChild(reactionsBar);
    card.appendChild(actionsWrap);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Compute smart positioning near the message bubble
    const rowEl = document.querySelector(`.msg-row[data-id="${m.id}"]`);
    const bubbleEl = rowEl ? (rowEl.querySelector('.bubble') || rowEl) : null;
    const bubbleRect = bubbleEl ? bubbleEl.getBoundingClientRect() : null;

    const menuWidth = 250;
    const estMenuHeight = 230;

    let targetLeft = 20;
    let targetTop = 100;

    if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number' && e.clientX > 0 && e.clientY > 0 && e.type === 'contextmenu') {
      targetLeft = isMine ? (e.clientX - menuWidth) : e.clientX;
      targetTop = e.clientY;
    } else if (bubbleRect) {
      targetLeft = isMine ? (bubbleRect.right - menuWidth) : bubbleRect.left;
      targetTop = bubbleRect.bottom + 4;
      if (targetTop + estMenuHeight > window.innerHeight - 10) {
        targetTop = Math.max(10, bubbleRect.top - estMenuHeight - 4);
      }
    } else {
      targetLeft = Math.max(12, (window.innerWidth - menuWidth) / 2);
      targetTop = Math.max(12, (window.innerHeight - estMenuHeight) / 2);
    }

    targetLeft = Math.max(10, Math.min(targetLeft, window.innerWidth - menuWidth - 10));
    targetTop = Math.max(10, Math.min(targetTop, window.innerHeight - estMenuHeight - 10));

    card.style.left = `${targetLeft}px`;
    card.style.top = `${targetTop}px`;

    const close = () => { overlay.remove(); };
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });

    // Wire quick reactions
    reactionsBar.querySelectorAll('.ctx-reaction-item').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const emoji = btn.getAttribute('data-emoji');
        close();
        if (!emoji) return;
        try {
          if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} }
          await PoyetAPI.toggleReaction(activeChatId, m.id, emoji);
        } catch (err) {
          showToast(err.message || 'Ошибка реакции');
        }
      });
    });

    // Wire "More" emoji reaction picker
    const moreBtn = reactionsBar.querySelector('#ctx-reaction-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        actionsWrap.style.display = 'none';
        moreBtn.style.display = 'none';

        const picker = createEmojiPickerComponent(async (emoji) => {
          close();
          try {
            if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} }
            await PoyetAPI.toggleReaction(activeChatId, m.id, emoji);
          } catch (err) {
            showToast(err.message || 'Ошибка реакции');
          }
        });
        card.appendChild(picker);

        const pickerRect = card.getBoundingClientRect();
        if (pickerRect.bottom > window.innerHeight - 10) {
          card.style.top = `${Math.max(10, window.innerHeight - pickerRect.height - 10)}px`;
        }
      });
    }

    actionsWrap.querySelector('#ctx-reply')?.addEventListener('click', () => {
      close();
      startReply(m);
    });
    actionsWrap.querySelector('#ctx-edit')?.addEventListener('click', () => {
      close();
      startEdit(m);
    });
    actionsWrap.querySelector('#ctx-forward')?.addEventListener('click', () => {
      close();
      openForwardModal(m);
    });
    actionsWrap.querySelector('#ctx-copy')?.addEventListener('click', () => {
      close();
      if (m.text) {
        navigator.clipboard.writeText(m.text).then(() => showToast('Текст скопирован')).catch(() => {});
      }
    });
    actionsWrap.querySelector('#ctx-delete')?.addEventListener('click', async () => {
      close();
      try {
        await PoyetAPI.deleteMessage(activeChatId, m.id);
        showToast('Сообщение удалено');
      } catch (err) {
        showToast(err.message || 'Не удалось удалить сообщение');
      }
    });
  }

  function startReply(m) {
    editingMsg = null;
    const sender = m.senderId === currentUser.id ? 'Вы' : (m.senderDisplayName || m.senderName || 'Собеседник');
    let previewText = m.text || '';
    if (!previewText) {
      if (m.mediaType === 'round_video') previewText = 'Видеосообщение';
      else if (m.mediaType === 'voice') previewText = 'Голосовое сообщение';
      else if (m.mediaType === 'image') previewText = 'Фотография';
      else if (m.mediaType === 'video') previewText = 'Видео';
      else if (m.mediaType === 'file') previewText = (m.mediaMeta && m.mediaMeta.fileName) || 'Файл';
    }
    replyingTo = {
      id: m.id,
      senderName: sender,
      text: previewText,
      mediaType: m.mediaType || 'text',
    };
    updateComposerActionBar();
    const input = document.getElementById('msg-input');
    if (input) input.focus();
  }

  function startEdit(m) {
    replyingTo = null;
    editingMsg = {
      id: m.id,
      text: m.text || '',
    };
    updateComposerActionBar();
    const input = document.getElementById('msg-input');
    if (input) {
      input.value = m.text || '';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function cancelComposerAction() {
    if (editingMsg) {
      const input = document.getElementById('msg-input');
      if (input) input.value = '';
    }
    replyingTo = null;
    editingMsg = null;
    updateComposerActionBar();
  }

  function updateComposerActionBar() {
    const existingBar = document.getElementById('composer-action-bar');
    if (existingBar) existingBar.remove();

    if (!replyingTo && !editingMsg) return;

    const composer = document.getElementById('composer');
    if (!composer) return;

    const bar = document.createElement('div');
    bar.id = 'composer-action-bar';
    bar.className = 'composer-action-bar';

    if (replyingTo) {
      bar.innerHTML = `
        <div class="composer-action-left">
          <div class="composer-action-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          </div>
          <div class="composer-action-content">
            <div class="composer-action-title">В ответ ${escapeHtml(replyingTo.senderName)}</div>
            <div class="composer-action-text">${escapeHtml(replyingTo.text)}</div>
          </div>
        </div>
        <button type="button" class="composer-action-close" id="composer-action-close" title="Отменить">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
    } else if (editingMsg) {
      bar.innerHTML = `
        <div class="composer-action-left">
          <div class="composer-action-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </div>
          <div class="composer-action-content">
            <div class="composer-action-title">Редактирование</div>
            <div class="composer-action-text">${escapeHtml(editingMsg.text)}</div>
          </div>
        </div>
        <button type="button" class="composer-action-close" id="composer-action-close" title="Отменить">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
    }

    composer.insertBefore(bar, composer.firstChild);
    document.getElementById('composer-action-close')?.addEventListener('click', cancelComposerAction);
  }

  function openForwardModal(m) {
    forwardTargetMsg = m;
    const modal = document.getElementById('forward-modal');
    const previewBox = document.getElementById('forward-preview-box');
    const searchInput = document.getElementById('forward-search-input');
    const list = document.getElementById('forward-chats-list');
    const closeBtn = document.getElementById('forward-modal-close');

    if (!modal) return;

    const sender = m.senderId === currentUser.id ? 'Вы' : (m.senderDisplayName || m.senderName || 'Собеседник');
    let previewText = m.text || '';
    if (!previewText) {
      if (m.mediaType === 'round_video') previewText = '🔘 Видеосообщение';
      else if (m.mediaType === 'voice') previewText = '🎤 Голосовое сообщение';
      else if (m.mediaType === 'image') previewText = '📷 Фото';
      else if (m.mediaType === 'video') previewText = '📹 Видео';
      else if (m.mediaType === 'file') previewText = '📎 ' + ((m.mediaMeta && m.mediaMeta.fileName) || 'Файл');
    }
    previewBox.innerHTML = `<strong>${escapeHtml(sender)}:</strong> ${escapeHtml(previewText)}`;
    searchInput.value = '';

    function renderForwardChats(filter = '') {
      const q = filter.trim().toLowerCase();
      const filtered = q ? chats.filter(c => c.name.toLowerCase().includes(q)) : chats;
      list.innerHTML = filtered.map(c => `
        <div class="forward-chat-item" data-chat-id="${c.id}">
          ${avatarHtml(c, 38)}
          <div>
            <div class="name">${escapeHtml(c.name)}</div>
            <div class="sub">${statusLabel(c)}</div>
          </div>
        </div>
      `).join('') || '<div style="padding:10px;text-align:center;color:var(--text-secondary);">Чаты не найдены</div>';

      list.querySelectorAll('.forward-chat-item').forEach(item => {
        item.addEventListener('click', async () => {
          const targetChatId = item.getAttribute('data-chat-id');
          await executeForward(targetChatId);
        });
      });
    }

    async function executeForward(targetChatId) {
      try {
        const fwdPayload = {
          text: m.text || '',
          mediaType: m.mediaType || 'text',
          mediaUrl: m.mediaUrl || null,
          mediaMeta: m.mediaMeta || null,
          forwardedFrom: {
            senderName: sender,
            originalChatId: activeChatId,
          }
        };
        await PoyetAPI.sendMessage(targetChatId, fwdPayload);
        closeForwardModal();
        showToast('Сообщение переслано');
      } catch (err) {
        showToast(err.message || 'Ошибка пересылки');
      }
    }

    renderForwardChats();
    searchInput.oninput = () => renderForwardChats(searchInput.value);

    modal.hidden = false;
    modal.style.display = 'flex';
    modal.classList.add('open');

    closeBtn.onclick = closeForwardModal;
  }

  function closeForwardModal() {
    const modal = document.getElementById('forward-modal');
    if (modal) {
      modal.hidden = true;
      modal.style.display = 'none';
      modal.classList.remove('open');
    }
    forwardTargetMsg = null;
  }

  function formatDuration(sec) {
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function wireRoundVideoPlayers() {
    document.querySelectorAll('.round-video-container').forEach(container => {
      if (container._wired) return;
      container._wired = true;

      const video = container.querySelector('.round-video-el');
      const mediaWrap = container.querySelector('.round-video-media-wrap');
      const hitarea = container.querySelector('.round-ring-hitarea');
      const thumb = container.querySelector('.round-ring-thumb');
      const progressCircle = container.querySelector('.round-ring-progress');
      const playIcon = container.querySelector('.round-play-icon');
      const pauseIcon = container.querySelector('.round-pause-icon');
      const timeTag = container.querySelector('.round-video-time-tag');

      if (!video || !progressCircle || !thumb) return;

      const circumference = 2 * Math.PI * 105; // ~659.734
      progressCircle.style.strokeDasharray = `${circumference}`;
      progressCircle.style.strokeDashoffset = `${circumference}`;

      function updateUI() {
        if (!video.duration || isNaN(video.duration)) return;
        const progress = Math.min(1, Math.max(0, video.currentTime / video.duration));
        const offset = circumference * (1 - progress);
        progressCircle.style.strokeDashoffset = `${offset}`;

        // Angle: 0 is at 12 o'clock (-90deg), clockwise
        const angle = progress * 2 * Math.PI - Math.PI / 2;
        const tx = 110 + 105 * Math.cos(angle);
        const ty = 110 + 105 * Math.sin(angle);
        thumb.setAttribute('cx', tx.toFixed(1));
        thumb.setAttribute('cy', ty.toFixed(1));

        if (timeTag) timeTag.textContent = formatDuration(video.currentTime);
      }

      function togglePlay(e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        const row = container.closest('.msg-row');
        if (row && row._swipedReply) return;

        if (video.paused) {
          // Pause all other playing media
          document.querySelectorAll('audio, video').forEach(media => {
            if (media !== video) {
              media.pause();
              const p = media.closest('.round-video-container');
              if (p) {
                p.classList.remove('playing');
                const pIcon = p.querySelector('.round-play-icon');
                const psIcon = p.querySelector('.round-pause-icon');
                if (pIcon) pIcon.style.display = 'block';
                if (psIcon) psIcon.style.display = 'none';
              }
            }
          });
          video.play().then(() => {
            container.classList.add('playing');
            if (playIcon) playIcon.style.display = 'none';
            if (pauseIcon) pauseIcon.style.display = 'block';
          }).catch(err => {
            console.warn('Video play error', err);
          });
        } else {
          video.pause();
          container.classList.remove('playing');
          if (playIcon) playIcon.style.display = 'block';
          if (pauseIcon) pauseIcon.style.display = 'none';
        }
      }

      // Clicking anywhere inside the round video toggles play / pause
      mediaWrap.addEventListener('click', togglePlay);

      // Scrubbing / rewinding ONLY when interacting with hitarea or thumb
      let isScrubbing = false;

      function seekAtPoint(clientX, clientY) {
        const rect = container.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = clientX - cx;
        const dy = clientY - cy;
        let rad = Math.atan2(dy, dx) + Math.PI / 2; // 0 at top
        if (rad < 0) rad += 2 * Math.PI;
        const frac = Math.min(1, Math.max(0, rad / (2 * Math.PI)));
        if (video.duration && !isNaN(video.duration)) {
          video.currentTime = frac * video.duration;
          updateUI();
        }
      }

      function startScrub(e) {
        e.preventDefault();
        e.stopPropagation();
        isScrubbing = true;
        container.classList.add('scrubbing');
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch {}
        seekAtPoint(e.clientX, e.clientY);
      }

      function onScrubMove(e) {
        if (!isScrubbing) return;
        seekAtPoint(e.clientX, e.clientY);
      }

      function stopScrub(e) {
        if (isScrubbing) {
          isScrubbing = false;
          container.classList.remove('scrubbing');
          try { e.target.releasePointerCapture(e.pointerId); } catch {}
        }
      }

      if (hitarea) {
        hitarea.addEventListener('pointerdown', startScrub);
        hitarea.addEventListener('pointermove', onScrubMove);
        hitarea.addEventListener('pointerup', stopScrub);
        hitarea.addEventListener('pointercancel', stopScrub);
      }

      if (thumb) {
        thumb.addEventListener('pointerdown', startScrub);
        thumb.addEventListener('pointermove', onScrubMove);
        thumb.addEventListener('pointerup', stopScrub);
        thumb.addEventListener('pointercancel', stopScrub);
      }

      video.addEventListener('timeupdate', updateUI);

      video.addEventListener('loadedmetadata', () => {
        if (timeTag && video.duration) timeTag.textContent = formatDuration(video.duration);
      });

      video.addEventListener('ended', () => {
        container.classList.remove('playing');
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
        progressCircle.style.strokeDashoffset = `${circumference}`;
        thumb.setAttribute('cx', '110');
        thumb.setAttribute('cy', '5');
        if (video.duration && timeTag) timeTag.textContent = formatDuration(video.duration);
      });
    });
  }

  function wireAudioPlayers() {
    document.querySelectorAll('.voice-player').forEach(player => {
      const audio = player.querySelector('audio');
      const btn = player.querySelector('.voice-play-btn');
      const fill = player.querySelector('.voice-progress-fill');
      const timeBox = player.querySelector('.voice-time');
      if (!audio || !btn || player._wired) return;
      player._wired = true;

      btn.addEventListener('click', () => {
        const row = player.closest('.msg-row');
        if (row && row._swipedReply) return;

        if (audio.paused) {
          document.querySelectorAll('audio').forEach(a => { if (a !== audio) a.pause(); });
          audio.play().catch(() => {});
          btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        } else {
          audio.pause();
          btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
        }
      });

      audio.addEventListener('timeupdate', () => {
        if (audio.duration) {
          const pct = (audio.currentTime / audio.duration) * 100;
          fill.style.width = pct + '%';
          timeBox.textContent = formatDuration(audio.currentTime);
        }
      });

      audio.addEventListener('ended', () => {
        fill.style.width = '0%';
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
        if (audio.duration) timeBox.textContent = formatDuration(audio.duration);
      });
    });
  }

  // Voice recording state
  let voiceMediaRecorder = null;
  let voiceChunks = [];
  let voiceTimer = null;
  let voiceSeconds = 0;

  // Round video recording state
  let videoMediaRecorder = null;
  let videoStream = null;
  let videoChunks = [];
  let videoTimer = null;
  let videoSeconds = 0;

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
        <div id="chat-header-avatar" title="Посмотреть профиль">
          ${avatarHtml(chat, 40)}
        </div>
        <div id="chat-header-info" title="Посмотреть профиль">
          <div id="chat-header-name">${escapeHtml(chat.name)}</div>
          <div id="chat-header-status">${statusLabel(chat)}</div>
        </div>
      </div>
      <div id="messages"></div>

      <div id="composer">
        <!-- Attachment trigger button -->
        <button class="composer-btn" id="attach-btn" title="Прикрепить фото, видео или файл">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>

        <textarea id="msg-input" rows="1" placeholder="Написать сообщение"></textarea>

        <!-- Emoji picker button -->
        <button class="composer-btn" id="emoji-btn" type="button" title="Эмодзи">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>

        <!-- Voice message button -->
        <button class="composer-btn" id="voice-btn" title="Голосовое сообщение">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>

        <!-- Round video button (кружочек) -->
        <button class="composer-btn" id="video-round-btn" title="Видеосообщение (кружочек)">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
        </button>

        <!-- Text send button -->
        <button class="composer-btn primary" id="send-btn" title="Отправить">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
        </button>

        <!-- Hidden file inputs -->
        <input type="file" id="file-photo-video" accept="image/*,video/*" multiple hidden>
        <input type="file" id="file-doc" multiple hidden>

        <!-- Attachment popup menu -->
        <div id="attach-menu" class="attach-menu" hidden>
          <button type="button" class="attach-menu-item" id="opt-media">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Фото или видео
          </button>
          <button type="button" class="attach-menu-item" id="opt-file">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
            Файл / Документ
          </button>
        </div>

        <!-- Voice recording bar overlay -->
        <div id="voice-recording-bar" class="recording-bar" hidden>
          <div class="recording-bar-left">
            <div class="recording-indicator"></div>
            <span id="voice-recording-time" class="recording-time">0:00</span>
            <div class="recording-waves">
              <div class="recording-wave-bar"></div>
              <div class="recording-wave-bar"></div>
              <div class="recording-wave-bar"></div>
              <div class="recording-wave-bar"></div>
              <div class="recording-wave-bar"></div>
            </div>
          </div>
          <div class="recording-bar-right">
            <button type="button" class="composer-btn" id="voice-cancel-btn" title="Отменить запись">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <button type="button" class="composer-btn primary" id="voice-send-btn" title="Отправить голосовое сообщение">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('back-btn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('hide');
      document.getElementById('main').classList.add('hide');
    });

    const openProfile = () => openUserProfileModal(chat);
    document.getElementById('chat-header-avatar')?.addEventListener('click', openProfile);
    document.getElementById('chat-header-info')?.addEventListener('click', openProfile);

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

    // Emoji button in composer
    const emojiBtn = document.getElementById('emoji-btn');
    const composerEl = document.getElementById('composer');
    if (emojiBtn && composerEl) {
      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = composerEl.querySelector('.composer-emoji-panel');
        if (existing) {
          existing.remove();
          return;
        }

        const panel = createEmojiPickerComponent((emoji) => {
          const start = input.selectionStart || input.value.length;
          const end = input.selectionEnd || input.value.length;
          const text = input.value;
          input.value = text.substring(0, start) + emoji + text.substring(end);
          input.selectionStart = input.selectionEnd = start + emoji.length;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 120) + 'px';
          input.focus();
        });

        panel.classList.add('composer-emoji-panel');
        composerEl.appendChild(panel);

        const closeEmoji = (ev) => {
          if (!panel.contains(ev.target) && ev.target !== emojiBtn && !emojiBtn.contains(ev.target)) {
            panel.remove();
            document.removeEventListener('click', closeEmoji);
          }
        };
        setTimeout(() => document.addEventListener('click', closeEmoji), 10);
      });
    }

    wireAttachments(chat);
    wireVoiceRecorder(chat);
    wireRoundVideoRecorder(chat);
    input.focus();
  }

  function wireAttachments(chat) {
    const attachBtn = document.getElementById('attach-btn');
    const menu = document.getElementById('attach-menu');
    const photoInput = document.getElementById('file-photo-video');
    const docInput = document.getElementById('file-doc');
    const optMedia = document.getElementById('opt-media');
    const optFile = document.getElementById('opt-file');

    attachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== attachBtn) {
        menu.hidden = true;
      }
    });

    optMedia.addEventListener('click', () => { menu.hidden = true; photoInput.click(); });
    optFile.addEventListener('click', () => { menu.hidden = true; docInput.click(); });

    photoInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      for (const file of files) {
        const isVideo = file.type.startsWith('video/');
        const mediaType = isVideo ? 'video' : 'image';
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            await PoyetAPI.sendMessage(chat.id, {
              text: '',
              mediaType,
              mediaUrl: reader.result,
              mediaMeta: { fileName: file.name, fileSize: file.size, mimeType: file.type },
            });
          } catch (err) {
            showToast(err.message || 'Ошибка загрузки медиа');
          }
        };
        reader.readAsDataURL(file);
      }
      photoInput.value = '';
    });

    docInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            await PoyetAPI.sendMessage(chat.id, {
              text: '',
              mediaType: 'file',
              mediaUrl: reader.result,
              mediaMeta: { fileName: file.name, fileSize: file.size, mimeType: file.type },
            });
          } catch (err) {
            showToast(err.message || 'Ошибка загрузки файла');
          }
        };
        reader.readAsDataURL(file);
      }
      docInput.value = '';
    });
  }

  function wireVoiceRecorder(chat) {
    const voiceBtn = document.getElementById('voice-btn');
    const bar = document.getElementById('voice-recording-bar');
    const timeEl = document.getElementById('voice-recording-time');
    const cancelBtn = document.getElementById('voice-cancel-btn');
    const sendVoiceBtn = document.getElementById('voice-send-btn');
    if (!voiceBtn || !bar) return;

    let isHolding = false;
    let isLocked = false;
    let startX = 0;
    let startY = 0;
    let stream = null;
    let voiceRecorder = null;
    let voiceChunks = [];
    let voiceTimer = null;
    let voiceSeconds = 0;

    async function startVoiceFlow(e) {
      if (isHolding) return;
      isHolding = true;
      isLocked = false;
      voiceChunks = [];
      voiceSeconds = 0;
      startX = e.clientX;
      startY = e.clientY;

      voiceBtn.classList.add('is-recording');

      try {
        voiceBtn.setPointerCapture(e.pointerId);
      } catch {}

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isHolding && !isLocked) {
          stream.getTracks().forEach(t => t.stop());
          cleanupVoice();
          return;
        }

        timeEl.textContent = '0:00';
        bar.hidden = false;
        bar.classList.remove('locked');

        voiceRecorder = new MediaRecorder(stream);
        voiceRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
        };
        voiceRecorder.start();

        voiceTimer = setInterval(() => {
          voiceSeconds++;
          if (timeEl) timeEl.textContent = formatDuration(voiceSeconds);
        }, 1000);
      } catch (err) {
        showToast('Нет доступа к микрофону: ' + (err.message || ''));
        cleanupVoice();
      }
    }

    function onVoicePointerMove(e) {
      if (!isHolding || isLocked) return;
      const dy = e.clientY - startY; // negative is up
      const dx = e.clientX - startX; // negative is left

      // Swipe up: lock hands-free recording
      if (dy < -40) {
        isLocked = true;
        bar.classList.add('locked');
        showToast('Запись зафиксирована');
      }

      // Swipe left: cancel recording
      if (dx < -65) {
        showToast('Запись отменена');
        cleanupVoice();
      }
    }

    function onVoicePointerUp(e) {
      if (!isHolding) return;
      isHolding = false;
      voiceBtn.classList.remove('is-recording');
      try { voiceBtn.releasePointerCapture(e.pointerId); } catch {}

      if (isLocked) {
        // Continue hands-free mode
        return;
      }

      // Releasing button without locking -> send immediately!
      finishVoiceAndSend();
    }

    function finishVoiceAndSend() {
      if (!voiceRecorder || voiceRecorder.state === 'inactive') {
        cleanupVoice();
        return;
      }
      const dur = Math.max(1, voiceSeconds);
      voiceRecorder.onstop = async () => {
        const blob = new Blob(voiceChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const payload = {
              text: '',
              mediaType: 'voice',
              mediaUrl: reader.result,
              mediaMeta: { duration: dur },
            };
            if (replyingTo) {
              payload.replyTo = replyingTo;
              cancelComposerAction();
            }
            await PoyetAPI.sendMessage(chat.id, payload);
          } catch (err) {
            showToast(err.message || 'Ошибка отправки аудио');
          }
        };
        reader.readAsDataURL(blob);
      };
      voiceRecorder.stop();
      cleanupVoice();
    }

    function cleanupVoice() {
      clearInterval(voiceTimer);
      bar.hidden = true;
      bar.classList.remove('locked');
      voiceBtn.classList.remove('is-recording');
      isHolding = false;
      isLocked = false;
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      voiceRecorder = null;
    }

    voiceBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startVoiceFlow(e);
    });
    voiceBtn.addEventListener('pointermove', onVoicePointerMove);
    voiceBtn.addEventListener('pointerup', onVoicePointerUp);
    voiceBtn.addEventListener('pointercancel', onVoicePointerUp);

    cancelBtn.addEventListener('click', cleanupVoice);
    sendVoiceBtn.addEventListener('click', finishVoiceAndSend);
  }

  function wireRoundVideoRecorder(chat) {
    const videoBtn = document.getElementById('video-round-btn');
    if (!videoBtn) return;

    let isHolding = false;
    let isLocked = false;
    let startX = 0;
    let startY = 0;
    let isStreamReady = false;
    let videoStream = null;
    let videoRecorder = null;
    let videoChunks = [];
    let videoTimer = null;
    let videoSeconds = 0;
    let overlay = null;
    let currentFacingMode = 'user'; // 'user' | 'environment'

    function createOrGetOverlay() {
      let el = document.getElementById('round-recorder-overlay');
      if (!el) {
        el = document.createElement('div');
        el.id = 'round-recorder-overlay';
        el.className = 'round-recorder-overlay';
        document.body.appendChild(el);
      }
      return el;
    }

    async function initCameraStream(facing) {
      if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
      }
      currentFacingMode = facing;
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacingMode, width: { ideal: 480 }, height: { ideal: 480 } },
        audio: true,
      });
      const previewVid = document.getElementById('round-rec-preview');
      if (previewVid) {
        previewVid.srcObject = videoStream;
      }
      return videoStream;
    }

    async function startRecordingFlow(e) {
      if (isHolding) return;
      isHolding = true;
      isLocked = false;
      isStreamReady = false;
      videoChunks = [];
      videoSeconds = 0;
      startX = e.clientX;
      startY = e.clientY;

      videoBtn.classList.add('is-recording');

      try {
        videoBtn.setPointerCapture(e.pointerId);
      } catch {}

      overlay = createOrGetOverlay();
      overlay.className = 'round-recorder-overlay';
      overlay.innerHTML = `
        <div class="round-recorder-center">
          <div class="round-recorder-viewfinder-wrap">
            <video id="round-rec-preview" autoplay muted playsinline></video>
            <div class="round-recorder-pulse-ring"></div>
            <button type="button" class="round-camera-switch-btn" id="round-cam-switch-btn" title="Сменить камеру">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
          </div>
          <div class="round-recorder-timer-badge">
            <div class="round-recorder-timer-dot"></div>
            <span id="round-rec-timer">0:00</span>
          </div>
        </div>

        <div class="round-recorder-hud">
          <div class="round-recorder-gestures-row">
            <div class="round-recorder-cancel-hint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
              <span>Свайп влево — отмена</span>
            </div>
            <div class="round-recorder-lock-column" id="round-lock-col">
              <div class="round-recorder-lock-btn" id="round-lock-btn">
                <svg id="round-lock-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0"/></svg>
              </div>
              <span style="font-size: 11.5px; opacity:0.85;">Вверх — зафиксировать</span>
            </div>
          </div>

          <div class="round-recorder-locked-controls">
            <button type="button" class="round-rec-btn cancel" id="round-locked-cancel-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Отмена
            </button>
            <button type="button" class="round-rec-btn send" id="round-locked-send-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
              Отправить
            </button>
          </div>
        </div>
      `;
      overlay.style.display = 'flex';

      document.getElementById('round-locked-cancel-btn')?.addEventListener('click', () => {
        cleanup(false);
      });
      document.getElementById('round-locked-send-btn')?.addEventListener('click', () => {
        finishAndSend();
      });

      document.getElementById('round-cam-switch-btn')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try {
          const newFacing = currentFacingMode === 'user' ? 'environment' : 'user';
          await initCameraStream(newFacing);
          if (videoRecorder && videoRecorder.state === 'recording') {
            videoRecorder.stop();
            videoRecorder = new MediaRecorder(videoStream);
            videoRecorder.ondataavailable = (eEv) => {
              if (eEv.data && eEv.data.size > 0) videoChunks.push(eEv.data);
            };
            videoRecorder.start();
          }
          showToast(newFacing === 'user' ? 'Фронтальная камера' : 'Основная камера');
        } catch (err) {
          showToast('Не удалось переключить камеру');
        }
      });

      try {
        await initCameraStream('user');

        if (!isHolding && !isLocked) {
          videoStream.getTracks().forEach(t => t.stop());
          cleanup(false);
          return;
        }

        videoRecorder = new MediaRecorder(videoStream);
        videoRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) videoChunks.push(ev.data);
        };
        videoRecorder.start();
        isStreamReady = true;

        const timerEl = document.getElementById('round-rec-timer');
        videoTimer = setInterval(() => {
          videoSeconds++;
          if (timerEl) timerEl.textContent = formatDuration(videoSeconds);
        }, 1000);

      } catch (err) {
        showToast('Нет доступа к камере или микрофону: ' + (err.message || ''));
        cleanup(false);
      }
    }

    function onPointerMove(e) {
      if (!isHolding || isLocked) return;
      const dy = e.clientY - startY; // negative is up
      const dx = e.clientX - startX; // negative is left

      const lockCol = document.getElementById('round-lock-col');
      if (lockCol && dy < 0) {
        lockCol.style.transform = `translateY(${Math.max(dy, -50)}px)`;
      }

      // Swipe Up: lock hands-free recording
      if (dy < -40) {
        isLocked = true;
        if (overlay) {
          overlay.classList.add('locked');
        }
        showToast('Запись зафиксирована');
      }

      // Swipe Left: cancel recording
      if (dx < -65) {
        showToast('Запись отменена');
        cleanup(false);
      }
    }

    function onPointerUp(e) {
      if (!isHolding) return;
      isHolding = false;
      videoBtn.classList.remove('is-recording');
      try {
        videoBtn.releasePointerCapture(e.pointerId);
      } catch {}

      if (isLocked) {
        // Continue recording hands-free in locked mode
        return;
      }

      // User released finger without swiping up -> send immediately!
      finishAndSend();
    }

    function finishAndSend() {
      if (!videoRecorder || videoRecorder.state === 'inactive') {
        cleanup(false);
        return;
      }
      const dur = Math.max(1, videoSeconds);
      videoRecorder.onstop = async () => {
        const blob = new Blob(videoChunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const payload = {
              text: '',
              mediaType: 'round_video',
              mediaUrl: reader.result,
              mediaMeta: { duration: dur },
            };
            if (replyingTo) {
              payload.replyTo = replyingTo;
              cancelComposerAction();
            }
            await PoyetAPI.sendMessage(chat.id, payload);
          } catch (err) {
            showToast(err.message || 'Ошибка отправки видеосообщения');
          }
        };
        reader.readAsDataURL(blob);
      };
      videoRecorder.stop();
      cleanup(true);
    }

    function cleanup(isSending = false) {
      clearInterval(videoTimer);
      videoBtn.classList.remove('is-recording');
      isHolding = false;
      isLocked = false;
      isStreamReady = false;
      if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
        videoStream = null;
      }
      if (overlay) {
        overlay.style.display = 'none';
        overlay.innerHTML = '';
      }
    }

    videoBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startRecordingFlow(e);
    });
    videoBtn.addEventListener('pointermove', onPointerMove);
    videoBtn.addEventListener('pointerup', onPointerUp);
    videoBtn.addEventListener('pointercancel', onPointerUp);
  }

  async function send(chat) {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';

    // 1. Edit mode
    if (editingMsg) {
      const msgIdToEdit = editingMsg.id;
      cancelComposerAction();
      try {
        await PoyetAPI.editMessage(chat.id, msgIdToEdit, text);
        showToast('Сообщение отредактировано');
      } catch (err) {
        showToast(err.message || 'Не удалось отредактировать сообщение');
      }
      return;
    }

    // 2. Reply mode
    if (replyingTo) {
      const replyData = { ...replyingTo };
      cancelComposerAction();
      try {
        await PoyetAPI.sendMessage(chat.id, {
          text,
          replyTo: replyData,
        });
      } catch (err) {
        showToast(err.message || 'Не удалось отправить ответ');
      }
      return;
    }

    // 3. Regular send
    try {
      await PoyetAPI.sendMessage(chat.id, text);
    } catch (err) {
      showToast(err.message || 'Не удалось отправить сообщение');
    }
  }

  const appObj = {
    start: (u) => start(u),
    openChat: (id) => openChat(id),
    openSettings: () => openSettingsModal(),
    showToast: (text) => showToast(text),
  };
  window.App = appObj;
  return appObj;
})();
