self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Push notification event (Apple iOS 16.4+, Android, Windows, macOS, Linux)
self.addEventListener('push', (event) => {
  let data = {
    title: 'Ягерь',
    body: 'Новое сообщение',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'yager-message',
    data: { url: '/' },
  };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const title = data.title || 'Ягерь';
  const options = {
    body: data.body || 'Новое сообщение',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || ('chat_' + (data.data?.chatId || 'general')),
    renotify: true,
    vibrate: [100, 50, 100],
    data: data.data || { url: '/' },
    actions: [
      { action: 'open', title: 'Открыть' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event: focus or open app and navigate to chat
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const clickData = event.notification.data || {};
  const chatId = clickData.chatId;
  const targetUrl = clickData.url || (chatId ? `/?chat=${encodeURIComponent(chatId)}` : '/');

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and tell it to navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (chatId) {
            client.postMessage({
              type: 'NAVIGATE_CHAT',
              chatId,
            });
          }
          return client;
        }
      }
      // If no window is open, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

