// firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

const firebaseConfig = {
    apiKey: "AIzaSyBobhek9X2bAfLf29vaIRvsFr8XWikXqS8",
    authDomain: "psyc-app.firebaseapp.com",
    projectId: "psyc-app",
    storageBucket: "psyc-app.firebasestorage.app",
    messagingSenderId: "850502892481",
    appId: "1:850502892481:web:69515e2cfebaf7ec648d40",
    measurementId: "G-NXH9F15YYP"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

function buildNotificationPayload(payload = {}) {
    const notificationTitle = payload.notification?.title || payload.data?.title || 'Alwan Update';
    const notificationBody = payload.notification?.body || payload.data?.body || '';
    const notificationType = payload.data?.type || 'default';

    let tag = notificationType || 'default';
    let requireInteraction = false;

    if (notificationType === 'sos') {
        tag = 'sos-alert';
        requireInteraction = true;
    }

    const notificationOptions = {
        body: notificationBody,
        icon: '/assets/logo/logo.jpg',
        badge: '/assets/logo/logo.jpg',
        tag,
        requireInteraction,
        renotify: true,
        vibrate: notificationType === 'sos' ? [200, 100, 200, 100, 200] : [200, 100, 200],
        data: {
            ...payload.data,
            url: payload.data?.url || '/dashboard.html',
            type: notificationType
        },
        actions: notificationType === 'sos' ? [
            { action: 'view', title: 'View Details' },
            { action: 'close', title: 'Dismiss' }
        ] : []
    };

    return { notificationTitle, notificationOptions };
}

async function focusOrOpenDashboard(targetUrl) {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
        if (client.url.includes('/dashboard.html') || client.url.includes(targetUrl)) {
            await client.focus();
            if ('navigate' in client && targetUrl && !client.url.includes(targetUrl)) {
                try { await client.navigate(targetUrl); } catch (_) { }
            }
            return;
        }
    }

    if (clients.openWindow) {
        return clients.openWindow(targetUrl || '/dashboard.html');
    }
}

// FCM background messages
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw] FCM background message:', payload);
    const { notificationTitle, notificationOptions } = buildNotificationPayload(payload);
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Standard Web Push payload support (for VAPID/web-push server payloads)
self.addEventListener('push', (event) => {
    if (!event.data) return;

    let payload = {};
    try {
        payload = event.data.json();
    } catch (_) {
        payload = { notification: { title: 'Alwan Update', body: event.data.text() } };
    }

    const { notificationTitle, notificationOptions } = buildNotificationPayload(payload);
    event.waitUntil(self.registration.showNotification(notificationTitle, notificationOptions));
});

// Notification click handling
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'close') return;

    const targetUrl = event.notification?.data?.url || '/dashboard.html';
    event.waitUntil(focusOrOpenDashboard(targetUrl));
});
