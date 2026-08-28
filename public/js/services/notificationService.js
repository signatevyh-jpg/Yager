/**
 * Notifications Engine for Ягерь
 * Supports Apple (iOS / iPadOS PWA / macOS Safari), Android (Chrome / Samsung / Firefox),
 * Windows (Edge / Chrome / Firefox), Linux (Chrome / Firefox / GNOME / KDE)
 */

const Notifications = (() => {
  let swRegistration = null;
  let audioCtx = null;
  let isAudioUnlocked = false;

  // Settings in localStorage
  const SETTINGS_KEY = 'yager_notif_settings';
  let settings = {
    enabled: true,
    sound: true,
    vibrate: true,
    preview: true,
    badge: true,
  };

  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) settings = { ...settings, ...JSON.parse(saved) };
  } catch {}

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  // Detect Operating System & Environment
  function getPlatformInfo() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const isMac = /Macintosh|Mac OS X/.test(ua) && !isIOS;
    const isWindows = /Windows/.test(ua);
    const isLinux = /Linux/.test(ua) && !isAndroid;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    let osName = 'Неизвестная ОС';
    let osIcon = '💻';
    if (isIOS) { osName = 'Apple iOS (iPhone/iPad)'; osIcon = '🍏'; }
    else if (isMac) { osName = 'Apple macOS'; osIcon = '🍏'; }
    else if (isAndroid) { osName = 'Android'; osIcon = '🤖'; }
    else if (isWindows) { osName = 'Windows'; osIcon = '🪟'; }
    else if (isLinux) { osName = 'Linux'; osIcon = '🐧'; }

    return { isIOS, isAndroid, isMac, isWindows, isLinux, isStandalone, osName, osIcon };
  }

  // Web Audio API Synthesizer - Clean harmonic 2-tone chime
  function initAudioUnlock() {
    if (isAudioUnlocked) return;
    const unlock = () => {
      try {
        if (!audioCtx) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) audioCtx = new AudioContextClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        isAudioUnlocked = true;
      } catch {}
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', unlock);
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('click', unlock, { passive: true });
  }

  function playNotificationSound() {
    if (!settings.sound) return;
    try {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
      }
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const now = audioCtx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.23);

      // Note 2: A5 (880.00 Hz) - cheerful chime
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.09);
      gain2.gain.setValueAtTime(0.001, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.32, now + 0.11);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.09);
      osc2.stop(now + 0.43);
    } catch {}
  }

  function triggerVibration() {
    if (!settings.vibrate) return;
    if (navigator.vibrate) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch {}
    }
  }

  // App Badging API (Apple iOS 16.4+ PWA / macOS / Windows / Android)
  function updateAppBadge(unreadCount) {
    if (!settings.badge) return;
    try {
      if ('setAppBadge' in navigator) {
        if (unreadCount > 0) {
          navigator.setAppBadge(unreadCount).catch(() => {});
        } else {
          navigator.clearAppBadge().catch(() => {});
        }
      }
    } catch {}
  }

  // Dynamic Browser Tab Title Flasher
  let titleFlashTimer = null;
  const originalTitle = 'Ягерь — мессенджер';

  function flashTabTitle(senderName, previewText, unreadTotal) {
    clearTimeout(titleFlashTimer);
    if (!document.hidden) {
      document.title = unreadTotal > 0 ? `(${unreadTotal}) ${originalTitle}` : originalTitle;
      return;
    }

    let isAlt = false;
    const cleanSender = senderName.split(' ')[0] || senderName;
    const cleanPreview = previewText ? `: ${previewText.slice(0, 24)}` : '';
    const notifTitle = `💬 ${cleanSender}${cleanPreview}`;
    const badgeTitle = unreadTotal > 0 ? `(${unreadTotal}) ${originalTitle}` : originalTitle;

    document.title = notifTitle;

    let flashes = 0;
    const step = () => {
      if (!document.hidden || flashes > 10) {
        document.title = unreadTotal > 0 ? `(${unreadTotal}) ${originalTitle}` : originalTitle;
        return;
      }
      flashes++;
      isAlt = !isAlt;
      document.title = isAlt ? notifTitle : badgeTitle;
      titleFlashTimer = setTimeout(step, 1500);
    };
    titleFlashTimer = setTimeout(step, 1500);
  }

  window.addEventListener('focus', () => {
    clearTimeout(titleFlashTimer);
    document.title = originalTitle;
  });

  // Base64 VAPID Key to Uint8Array helper
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Register Service Worker & Subscribe to Web Push
  async function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;

    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js');
      
      // Listen for message from service worker notification click
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'NAVIGATE_CHAT' && event.data.chatId) {
          if (window.App && typeof window.App.openChat === 'function') {
            window.App.openChat(event.data.chatId);
          }
        }
      });

      return swRegistration;
    } catch (err) {
      console.warn('Service Worker registration failed:', err);
      return null;
    }
  }

  async function subscribePush() {
    if (!swRegistration) {
      swRegistration = await initServiceWorker();
    }
    if (!swRegistration || !('pushManager' in swRegistration)) {
      return { success: false, reason: 'Push не поддерживается в этом браузере' };
    }

    try {
      const publicKey = await PoyetAPI.getVapidPublicKey();
      if (!publicKey) return { success: false, reason: 'Нет VAPID ключа' };

      const existingSub = await swRegistration.pushManager.getSubscription();
      if (existingSub) {
        // Already subscribed, ensure server knows
        await PoyetAPI.subscribePush(existingSub, navigator.userAgent);
        return { success: true, subscription: existingSub };
      }

      const newSub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await PoyetAPI.subscribePush(newSub, navigator.userAgent);
      return { success: true, subscription: newSub };
    } catch (err) {
      console.warn('Push subscription failed:', err);
      return { success: false, reason: err.message || 'Ошибка подписки' };
    }
  }

  async function requestPermission() {
    if (!('Notification' in window)) {
      return { status: 'unsupported' };
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        settings.enabled = true;
        saveSettings();
        await subscribePush();
      }
      return { status: permission };
    } catch (err) {
      return { status: 'denied', error: err.message };
    }
  }

  function formatMessagePreview(msg) {
    if (!msg) return 'Новое сообщение';
    if (msg.mediaType === 'voice') {
      const dur = msg.mediaMeta?.duration ? ` (${Math.floor(msg.mediaMeta.duration / 60)}:${String(msg.mediaMeta.duration % 60).padStart(2, '0')})` : '';
      return `🎤 Голосовое сообщение${dur}`;
    }
    if (msg.mediaType === 'round_video') return '🔘 Видеосообщение (кружочек)';
    if (msg.mediaType === 'image') return msg.text ? `📷 Фото: ${msg.text}` : '📷 Фотография';
    if (msg.mediaType === 'video') return msg.text ? `📹 Видео: ${msg.text}` : '📹 Видеозапись';
    if (msg.mediaType === 'file') return `📎 Файл: ${msg.mediaMeta?.fileName || 'документ'}`;
    return msg.text || 'Новое сообщение';
  }

  // Floating In-App Top Notification Banner
  function showInAppBanner(chat, message) {
    let banner = document.getElementById('in-app-notification-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'in-app-notification-banner';
      banner.className = 'in-app-notif-banner';
      document.body.appendChild(banner);
    }

    const senderName = chat.isGroup ? `${chat.name} (${message.senderName || 'Участник'})` : chat.name;
    const preview = formatMessagePreview(message);
    const avatarHtml = chat.avatar
      ? `<img src="${chat.avatar}" class="avatar-img-circle" style="width:38px;height:38px;" alt="${senderName}">`
      : `<div class="avatar" style="width:38px;height:38px;font-size:14px;background:#2AABEE;">${senderName[0] || '💬'}</div>`;

    banner.innerHTML = `
      <div class="in-app-notif-content" id="in-app-notif-click-target">
        <div class="in-app-notif-avatar">${avatarHtml}</div>
        <div class="in-app-notif-text">
          <div class="in-app-notif-title">${escapeHtml(senderName)}</div>
          <div class="in-app-notif-body">${escapeHtml(preview)}</div>
        </div>
      </div>
      <button type="button" class="in-app-notif-close" id="in-app-notif-close" title="Закрыть">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    banner.classList.add('show');

    clearTimeout(banner._dismissTimer);
    banner._dismissTimer = setTimeout(() => {
      banner.classList.remove('show');
    }, 4500);

    const clickTarget = document.getElementById('in-app-notif-click-target');
    if (clickTarget) {
      clickTarget.onclick = () => {
        banner.classList.remove('show');
        if (window.App && typeof window.App.openChat === 'function') {
          window.App.openChat(chat.id);
        }
      };
    }

    const closeBtn = document.getElementById('in-app-notif-close');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        banner.classList.remove('show');
      };
    }
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // Trigger Notification for an incoming message
  function handleIncomingMessage(chat, message, isCurrentChatOpen, totalUnread) {
    updateAppBadge(totalUnread);

    // If current chat is open AND window is focused, just do a subtle in-chat action (no system notif)
    const isTabActive = !document.hidden && document.hasFocus();
    if (isCurrentChatOpen && isTabActive) {
      return;
    }

    // Play Sound & Vibration
    playNotificationSound();
    triggerVibration();

    const senderName = chat.isGroup ? `${chat.name}` : chat.name;
    const bodyText = settings.preview ? formatMessagePreview(message) : 'Новое сообщение';

    // Flash Browser Tab Title
    flashTabTitle(senderName, bodyText, totalUnread);

    // If app tab is in foreground (focused or looking at another chat), show sleek In-App Banner
    if (isTabActive && !isCurrentChatOpen) {
      showInAppBanner(chat, message);
    }

    // If tab is in background or minimized, and Notifications are granted, show System Notification
    if (document.hidden || !isTabActive) {
      if ('Notification' in window && Notification.permission === 'granted' && settings.enabled) {
        const title = chat.isGroup ? `${chat.name} (${message.senderName || 'Участник'})` : chat.name;
        const icon = chat.avatar || '/icons/icon-192.png';

        if (swRegistration && swRegistration.showNotification) {
          swRegistration.showNotification(title, {
            body: bodyText,
            icon,
            badge: '/icons/icon-192.png',
            tag: `chat_${chat.id}`,
            renotify: true,
            vibrate: [100, 50, 100],
            data: { chatId: chat.id, url: `/?chat=${encodeURIComponent(chat.id)}` },
          }).catch(() => {});
        } else {
          try {
            const notif = new Notification(title, {
              body: bodyText,
              icon,
              tag: `chat_${chat.id}`,
            });
            notif.onclick = () => {
              window.focus();
              notif.close();
              if (window.App && typeof window.App.openChat === 'function') {
                window.App.openChat(chat.id);
              }
            };
          } catch {}
        }
      }
    }
  }

  // Render Notification Settings Modal
  async function triggerTest() {
    playNotificationSound();
    triggerVibration();
    updateAppBadge(1);

    showInAppBanner({ id: 'test_chat', name: 'Ягерь', avatar: null, isGroup: false }, {
      text: 'Тестовое уведомление успешно доставлено! 🚀',
      senderName: 'Ягерь',
      mediaType: 'text',
    });

    if ('Notification' in window && Notification.permission === 'granted') {
      if (swRegistration && swRegistration.showNotification) {
        swRegistration.showNotification('Ягерь — Тест', {
          body: 'Уведомления на вашем устройстве работают отлично! 🚀',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'test_local',
          vibrate: [100, 50, 100],
        }).catch(() => {});
      } else {
        try {
          new Notification('Ягерь — Тест', {
            body: 'Уведомления на вашем устройстве работают отлично! 🚀',
            icon: '/icons/icon-192.png',
          });
        } catch {}
      }
    }

    // Also trigger server push test if user has active session
    try {
      if (window.PoyetAPI && typeof window.PoyetAPI.testPushNotification === 'function') {
        await window.PoyetAPI.testPushNotification();
      }
    } catch {}

    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast('Тестовое уведомление отправлено!');
    }
  }

  function openSettingsModal() {
    let modal = document.getElementById('notifications-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'notifications-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const platform = getPlatformInfo();
    const permStatus = 'Notification' in window ? Notification.permission : 'unsupported';
    let statusLabel = 'Не включены';
    let statusColor = '#f5a623';
    if (permStatus === 'granted') {
      statusLabel = 'Активны и разрешены';
      statusColor = '#4cd964';
    } else if (permStatus === 'denied') {
      statusLabel = 'Заблокированы в браузере';
      statusColor = '#ff3b30';
    }

    modal.innerHTML = `
      <div class="modal-card notif-modal-card" style="max-width: 480px; width: 100%;">
        <div class="profile-modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">🔔</span>
            <h3 style="margin: 0; font-size: 17px;">Настройки уведомлений</h3>
          </div>
          <button type="button" class="icon-btn" id="notif-modal-close" title="Закрыть">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="notif-status-badge-row">
          <div class="notif-status-indicator" style="background:${statusColor};"></div>
          <div style="flex:1;">
            <div style="font-size: 13.5px; font-weight: 600;">Статус: ${statusLabel}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${platform.osIcon} Ваша система: ${platform.osName}</div>
          </div>
          ${permStatus !== 'granted' ? `
            <button type="button" id="notif-enable-btn" class="modal-btn primary notif-compact-btn">Включить</button>
          ` : `
            <button type="button" id="notif-test-btn" class="modal-btn secondary notif-compact-btn">Проверить</button>
          `}
        </div>

        <div class="notif-toggles-list">
          <label class="notif-toggle-row">
            <div class="notif-toggle-info">
              <span class="notif-toggle-title">Всплывающие уведомления (Push)</span>
              <span class="notif-toggle-sub">Системные баннеры на экране при новых сообщениях</span>
            </div>
            <input type="checkbox" id="notif-toggle-enabled" class="notif-switch" ${settings.enabled && permStatus === 'granted' ? 'checked' : ''}>
          </label>

          <label class="notif-toggle-row">
            <div class="notif-toggle-info">
              <span class="notif-toggle-title">Звуковые сигналы 🔊</span>
              <span class="notif-toggle-sub">Приятный мелодичный звук при входящих</span>
            </div>
            <input type="checkbox" id="notif-toggle-sound" class="notif-switch" ${settings.sound ? 'checked' : ''}>
          </label>

          <label class="notif-toggle-row">
            <div class="notif-toggle-info">
              <span class="notif-toggle-title">Вибрация 📳</span>
              <span class="notif-toggle-sub">Тактильный отклик на смартфонах и планшетах</span>
            </div>
            <input type="checkbox" id="notif-toggle-vibrate" class="notif-switch" ${settings.vibrate ? 'checked' : ''}>
          </label>

          <label class="notif-toggle-row">
            <div class="notif-toggle-info">
              <span class="notif-toggle-title">Предпросмотр сообщений 👁️</span>
              <span class="notif-toggle-sub">Отображать текст и имя отправителя в уведомлении</span>
            </div>
            <input type="checkbox" id="notif-toggle-preview" class="notif-switch" ${settings.preview ? 'checked' : ''}>
          </label>

          <label class="notif-toggle-row">
            <div class="notif-toggle-info">
              <span class="notif-toggle-title">Бейдж на иконке (App Badge) 🏷️</span>
              <span class="notif-toggle-sub">Счётчик непрочитанных на значке приложения</span>
            </div>
            <input type="checkbox" id="notif-toggle-badge" class="notif-switch" ${settings.badge ? 'checked' : ''}>
          </label>
        </div>

        <div class="notif-os-guidelines-box">
          <div class="notif-os-guidelines-header">Поддержка на ваших устройствах:</div>
          
          <div class="notif-os-item">
            <div class="notif-os-title">🍏 Apple iOS / iPadOS (iPhone / iPad)</div>
            <div class="notif-os-desc">Для push-уведомлений в Safari: нажмите «Поделиться» (иконка квадрата со стрелкой) → выберите <b>«На экран «Домой»»</b> → откройте приложение с главного экрана и включите уведомления.</div>
          </div>

          <div class="notif-os-item">
            <div class="notif-os-title">🍏 Apple macOS</div>
            <div class="notif-os-desc">Работают баннеры Notification Center, звук и бейдж в Dock (Safari, Chrome, Edge).</div>
          </div>

          <div class="notif-os-item">
            <div class="notif-os-title">🤖 Android</div>
            <div class="notif-os-desc">Мгновенные системные push-уведомления со звуком и вибрацией. Можно установить как PWA (Меню Chrome → «Установить»).</div>
          </div>

          <div class="notif-os-item">
            <div class="notif-os-title">🪟 Windows & 🐧 Linux</div>
            <div class="notif-os-desc">Интеграция с Центром уведомлений Windows 10/11 и системным демоном уведомлений Linux (GNOME / KDE).</div>
          </div>
        </div>

        <div class="modal-actions" style="margin-top: 18px;">
          <button type="button" class="modal-btn secondary" id="notif-send-test-btn">Отправить тест</button>
          <button type="button" class="modal-btn primary" id="notif-modal-done">Готово</button>
        </div>
      </div>
    `;

    modal.hidden = false;
    modal.style.display = 'flex';
    modal.classList.add('open');

    // Event listeners
    const close = () => {
      modal.hidden = true;
      modal.style.display = 'none';
      modal.classList.remove('open');
    };

    document.getElementById('notif-modal-close').onclick = close;
    document.getElementById('notif-modal-done').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };

    const enableBtn = document.getElementById('notif-enable-btn');
    if (enableBtn) {
      enableBtn.onclick = async () => {
        enableBtn.disabled = true;
        enableBtn.textContent = 'Запрос...';
        const res = await requestPermission();
        if (res.status === 'granted') {
          if (window.App && typeof window.App.showToast === 'function') {
            window.App.showToast('Уведомления успешно включены! 🎉');
          }
          openSettingsModal(); // Refresh modal UI
        } else if (res.status === 'denied') {
          if (window.App && typeof window.App.showToast === 'function') {
            window.App.showToast('Уведомления заблокированы в настройках браузера');
          }
          openSettingsModal();
        } else {
          openSettingsModal();
        }
      };
    }

    const testBtn = document.getElementById('notif-test-btn') || document.getElementById('notif-send-test-btn');
    const sendTestBtn = document.getElementById('notif-send-test-btn');

    if (testBtn) testBtn.onclick = triggerTest;
    if (sendTestBtn) sendTestBtn.onclick = triggerTest;

    // Toggle checkboxes
    document.getElementById('notif-toggle-sound').onchange = (e) => {
      settings.sound = e.target.checked;
      saveSettings();
      if (settings.sound) playNotificationSound();
    };
    document.getElementById('notif-toggle-vibrate').onchange = (e) => {
      settings.vibrate = e.target.checked;
      saveSettings();
      if (settings.vibrate) triggerVibration();
    };
    document.getElementById('notif-toggle-preview').onchange = (e) => {
      settings.preview = e.target.checked;
      saveSettings();
    };
    document.getElementById('notif-toggle-badge').onchange = (e) => {
      settings.badge = e.target.checked;
      saveSettings();
    };
    document.getElementById('notif-toggle-enabled').onchange = async (e) => {
      if (e.target.checked) {
        const res = await requestPermission();
        if (res.status !== 'granted') {
          e.target.checked = false;
        }
      } else {
        settings.enabled = false;
        saveSettings();
      }
    };
  }

  // Initialization
  async function init() {
    initAudioUnlock();
    await initServiceWorker();

    // If permission was already granted, ensure push subscription is active
    if ('Notification' in window && Notification.permission === 'granted') {
      subscribePush().catch(() => {});
    }
  }

  return {
    init,
    openSettingsModal,
    requestPermission,
    subscribePush,
    playNotificationSound,
    triggerVibration,
    updateAppBadge,
    triggerTest,
    setSetting: (key, val) => {
      settings[key] = val;
      saveSettings();
    },
    onIncomingMessage: handleIncomingMessage,
    getPlatformInfo,
    getSettings: () => ({ ...settings }),
  };
})();

window.Notifications = Notifications;
