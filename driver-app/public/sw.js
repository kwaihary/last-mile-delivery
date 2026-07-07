/**
 * SERVICE WORKER - PWA
 * Hỗ trợ offline mode, caching, push notifications
 */

const CACHE_NAME = 'driver-app-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/src/css/style.css',
  '/src/js/app.js',
  '/src/services/api.js',
  '/src/services/socket.js',
  '/icon-192.svg',
  '/icon-512.svg',
  '/manifest.json'
];
const RUNTIME_CACHE = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.socket.io/4.7.5/socket.io.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

// =============================================================================
// INSTALL EVENT
// =============================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Skip waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Install failed:', error);
      })
  );
});

// =============================================================================
// ACTIVATE EVENT
// =============================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        return self.clients.claim();
      })
  );
});

// =============================================================================
// FETCH EVENT - CACHE STRATEGIES
// =============================================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip WebSocket connections
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // Skip Socket.IO
  if (url.pathname.includes('socket.io')) return;

  // API requests: Network First, fallback to cache
  if (url.pathname.startsWith('/api')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // CDN/External resources: Cache First, fallback to network
  if (url.origin !== location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Local resources: Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// =============================================================================
// CACHE STRATEGIES
// =============================================================================

/**
 * Network First - Try network, fallback to cache
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/');
    }
    
    throw error;
  }
}

/**
 * Cache First - Try cache, fallback to network
 */
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    console.log('[SW] Cache hit:', request.url);
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache first failed:', error);
    throw error;
  }
}

/**
 * Stale While Revalidate - Return cached, update cache in background
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  // Fetch in background
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);
  
  // Return cached immediately if available
  return cachedResponse || fetchPromise;
}

// =============================================================================
// PUSH NOTIFICATIONS
// =============================================================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');
  
  if (!event.data) return;
  
  let data;
  try {
    data = event.data.json();
  } catch {
    data = {
      title: 'Thông báo',
      body: event.data.text()
    };
  }
  
  const options = {
    body: data.body || data.message || '',
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      orderId: data.orderId
    },
    actions: [
      { action: 'open', title: 'Xem' },
      { action: 'dismiss', title: 'Bỏ qua' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Tài Xế Giao Hàng', options)
  );
});

// =============================================================================
// NOTIFICATION CLICK
// =============================================================================
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'dismiss') return;
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if available
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// =============================================================================
// BACKGROUND SYNC (for offline order updates)
// =============================================================================
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncOrders());
  }
});

async function syncOrders() {
  // Get pending updates from IndexedDB
  // This would be implemented with actual IndexedDB storage
  console.log('[SW] Syncing pending orders...');
}

// =============================================================================
// MESSAGE HANDLING
// =============================================================================
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls;
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urls))
      .then(() => event.ports[0].postMessage({ success: true }))
      .catch((error) => event.ports[0].postMessage({ success: false, error }));
  }
});

console.log('[SW] Service Worker loaded');
