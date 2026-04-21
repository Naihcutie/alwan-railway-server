// Service Worker for Offline Support & Notifications
const CACHE_NAME = 'psyc-offline-v2';
const OFFLINE_URLS = [
    '/dashboard.html',
    '/css/dashboard.css',
    '/css/modals.css',
    '/css/style.css',
    '/css/entry.css',
    '/js/app.js',
    '/js/auth.js',
    '/js/mood-resources.js',
    '/assets/mood-resources.json',
    // Add other essential assets
];

console.log('🔧 Service Worker loaded');

self.addEventListener('install', (event) => {
    console.log('✅ Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('📦 Caching offline resources');
                return cache.addAll(OFFLINE_URLS);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker activated');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => clients.claim())
    );
});

// Fetch strategy: Network first, fallback to cache
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;
    
    // Skip Firebase/external API calls - only cache app resources
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;
    
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Clone the response before caching
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });
                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(event.request)
                    .then(response => {
                        if (response) {
                            console.log('📦 Serving from cache:', event.request.url);
                            return response;
                        }
                        // Return offline page if available
                        return caches.match('/dashboard.html');
                    });
            })
    );
});

// Listen for notification trigger from main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, tag } = event.data;
        
        console.log('🔔 Service Worker showing notification:', title);
        
        self.registration.showNotification(title, {
            body: body,
            icon: '/assets/logo/logo.jpg',
            badge: '/assets/logo/logo.jpg',
            tag: tag,
            requireInteraction: true,
            vibrate: [200, 100, 200],
            data: { url: '/dashboard.html' }
        });
    }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('🔔 Notification clicked');
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow(event.notification.data.url || '/dashboard.html')
    );
});
