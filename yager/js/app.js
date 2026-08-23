const App = (() => {

  let currentUser = null;
  let chats = [];               // [{id, name, avatar, online, isGroup, isBot, lastMessageAt, unread, bio, participants}]
  let messagesByChat = {};      // chatId -> [messages]
  let activeChatId = null;
  let unsubscribers = [];

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
    updateCurrentUserHeaderUI();

    chats = await PoyetAPI.getChats();
    for (const chat of chats) {
      messagesByChat[chat.id] = await PoyetAPI.getMessages(chat.id);
    }
    renderChatList();
    renderMain();
    wireGlobalEvents();
    subscribeToRealtime();
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

  function wireGlobalEvents() {
    document.getElementById('search-input').addEventListener('input', (e) => renderChatList(e.target.value));
    document.getElementById('logout-btn').addEventListener('click', async () => {
      unsubscribers.forEach(u => u());
      unsubscribers = [];
      await PoyetAPI.logout();
      currentUser = null; chats = []; messagesByChat = {}; activeChatId = null;
      Auth.show();
    });

    document.getElementById('current-user-profile-trigger')?.addEventListener('click', () => {
      openMyProfileModal();
    });

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

    document.getElementById('new-chat-btn').addEventListener('click', open);
    document.getElementById('new-chat-cancel').addEventListener('click', close);
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

  function openMyProfileModal() {
    const overlay = document.getElementById('profile-modal');
    const titleEl = document.getElementById('profile-modal-title');
    const bodyEl = document.getElementById('profile-modal-body');

    titleEl.textContent = 'Редактирование профиля';
    let tempAvatar = currentUser.avatar || null;

    bodyEl.innerHTML = `
      <div class="profile-avatar-box">
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

      <div id="profile-edit-error" class="auth-error" hidden></div>

      <div class="modal-actions" style="margin-top: 18px;">
        <button type="button" class="modal-btn secondary" id="profile-cancel-btn">Отмена</button>
        <button type="button" class="modal-btn primary" id="profile-save-btn">Сохранить</button>
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

    document.getElementById('my-profile-avatar-btn').addEventListener('click', () => {
      startAvatarCropFlow((cropped) => {
        tempAvatar = cropped;
        const prev = document.getElementById('my-profile-avatar-preview');
        if (prev) {
          prev.innerHTML = `<img src="${cropped}" class="avatar-img-circle" style="width:100%; height:100%;">`;
        }
      });
    });

    document.getElementById('profile-cancel-btn').addEventListener('click', () => {
      overlay.hidden = true;
      overlay.style.display = 'none';
      overlay.classList.remove('open');
    });

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
        showToast('Профиль успешно обновлен!');
      } catch (err) {
        errBox.textContent = err.message || 'Ошибка обновления профиля';
        errBox.hidden = false;
      }
    });
  }

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

      let bodyHtml = '';
      const mediaType = m.mediaType || 'text';

      if (mediaType === 'image' && m.mediaUrl) {
        bodyHtml = `
          <img src="${escapeHtml(m.mediaUrl)}" class="bubble-image" alt="Изображение" onclick="window.open('${escapeHtml(m.mediaUrl)}', '_blank')">
          ${m.text ? `<div class="bubble-caption">${escapeHtml(m.text)}</div>` : ''}
        `;
      } else if (mediaType === 'video' && m.mediaUrl) {
        bodyHtml = `
          <video src="${escapeHtml(m.mediaUrl)}" class="bubble-video" controls playsinline preload="metadata"></video>
          ${m.text ? `<div class="bubble-caption">${escapeHtml(m.text)}</div>` : ''}
        `;
      } else if (mediaType === 'round_video' && m.mediaUrl) {
        bodyHtml = `
          <div class="round-video-player">
            <video src="${escapeHtml(m.mediaUrl)}" playsinline loop controls></video>
          </div>
          ${m.text ? `<div class="bubble-caption">${escapeHtml(m.text)}</div>` : ''}
        `;
      } else if (mediaType === 'voice' && m.mediaUrl) {
        const dur = (m.mediaMeta && m.mediaMeta.duration) ? formatDuration(m.mediaMeta.duration) : '0:00';
        bodyHtml = `
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
        bodyHtml = `<span class="text">${escapeHtml(m.text)}</span>`;
      }

      html += `
        <div class="msg-row ${mine ? 'out' : 'in'}">
          <div class="bubble ${mediaType !== 'text' ? 'has-media' : ''}">
            ${bodyHtml}
            <span class="meta">${fmtTime(m.createdAt)}${ticks}</span>
          </div>
        </div>`;
    });
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
    wireAudioPlayers();
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

  function wireAudioPlayers() {
    document.querySelectorAll('.voice-player').forEach(player => {
      const audio = player.querySelector('audio');
      const btn = player.querySelector('.voice-play-btn');
      const fill = player.querySelector('.voice-progress-fill');
      const timeBox = player.querySelector('.voice-time');
      if (!audio || !btn || player._wired) return;
      player._wired = true;

      btn.addEventListener('click', () => {
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
    let stream = null;

    voiceBtn.addEventListener('click', async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceChunks = [];
        voiceSeconds = 0;
        timeEl.textContent = '0:00';
        bar.hidden = false;

        voiceMediaRecorder = new MediaRecorder(stream);
        voiceMediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) voiceChunks.push(e.data);
        };
        voiceMediaRecorder.start();

        voiceTimer = setInterval(() => {
          voiceSeconds++;
          timeEl.textContent = formatDuration(voiceSeconds);
        }, 1000);
      } catch (err) {
        showToast('Нет доступа к микрофону: ' + (err.message || ''));
      }
    });

    cancelBtn.addEventListener('click', () => {
      cleanupVoice();
    });

    sendVoiceBtn.addEventListener('click', () => {
      if (!voiceMediaRecorder || voiceMediaRecorder.state === 'inactive') return;
      const duration = voiceSeconds;
      voiceMediaRecorder.onstop = async () => {
        const blob = new Blob(voiceChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            await PoyetAPI.sendMessage(chat.id, {
              text: '',
              mediaType: 'voice',
              mediaUrl: reader.result,
              mediaMeta: { duration },
            });
          } catch (err) {
            showToast(err.message || 'Ошибка отправки аудио');
          }
        };
        reader.readAsDataURL(blob);
      };
      voiceMediaRecorder.stop();
      cleanupVoice();
    });

    function cleanupVoice() {
      clearInterval(voiceTimer);
      bar.hidden = true;
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      voiceMediaRecorder = null;
    }
  }

  function wireRoundVideoRecorder(chat) {
    const videoBtn = document.getElementById('video-round-btn');

    videoBtn.addEventListener('click', async () => {
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
        openVideoCircleModal(chat);
      } catch (err) {
        showToast('Нет доступа к камере или микрофону: ' + (err.message || ''));
      }
    });
  }

  function openVideoCircleModal(chat) {
    let modal = document.getElementById('video-circle-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'video-circle-modal';
      modal.className = 'video-circle-modal';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="video-circle-wrap">
        <video id="circle-preview-video" autoplay muted playsinline></video>
        <div id="circle-timer" class="video-circle-timer">0:00</div>
      </div>
      <div class="video-circle-actions">
        <button type="button" class="circle-btn cancel" id="circle-cancel-btn">Отмена</button>
        <button type="button" class="circle-btn record" id="circle-record-btn">Запись</button>
        <button type="button" class="circle-btn send" id="circle-send-btn" style="display:none;">Отправить</button>
      </div>
    `;
    modal.hidden = false;

    const vidEl = document.getElementById('circle-preview-video');
    vidEl.srcObject = videoStream;

    const timerEl = document.getElementById('circle-timer');
    const recordBtn = document.getElementById('circle-record-btn');
    const sendBtn = document.getElementById('circle-send-btn');
    const cancelBtn = document.getElementById('circle-cancel-btn');

    videoChunks = [];
    videoSeconds = 0;
    let isRecording = false;

    function cleanup() {
      clearInterval(videoTimer);
      if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
        videoStream = null;
      }
      modal.hidden = true;
    }

    cancelBtn.addEventListener('click', cleanup);

    recordBtn.addEventListener('click', () => {
      if (!isRecording) {
        isRecording = true;
        videoChunks = [];
        videoSeconds = 0;
        recordBtn.textContent = 'Стоп';
        recordBtn.style.background = '#8e8e93';

        videoMediaRecorder = new MediaRecorder(videoStream);
        videoMediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) videoChunks.push(e.data);
        };
        videoMediaRecorder.start();

        videoTimer = setInterval(() => {
          videoSeconds++;
          timerEl.textContent = formatDuration(videoSeconds);
        }, 1000);
      } else {
        isRecording = false;
        clearInterval(videoTimer);
        recordBtn.style.display = 'none';
        sendBtn.style.display = 'flex';
        videoMediaRecorder.stop();
      }
    });

    sendBtn.addEventListener('click', () => {
      const blob = new Blob(videoChunks, { type: 'video/webm' });
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await PoyetAPI.sendMessage(chat.id, {
            text: '',
            mediaType: 'round_video',
            mediaUrl: reader.result,
            mediaMeta: { duration: videoSeconds },
          });
        } catch (err) {
          showToast(err.message || 'Ошибка отправки видео');
        }
      };
      reader.readAsDataURL(blob);
      cleanup();
    });
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
      showToast(err.message || 'Не удалось отправить сообщение');
    }
  }

  return { start };
})();
