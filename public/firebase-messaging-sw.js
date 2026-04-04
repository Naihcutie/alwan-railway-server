// firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

// Initialize the Firebase app in the service worker by passing in
// your app's Firebase config object.
// https://firebase.google.com/docs/web/setup#config-object
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

// Retrieve an instance of Firebase Messaging so that it can handle background
// messages.
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log(
        "✅ [firebase-messaging-sw.js] Received background message ",
        payload
    );

    // Extract notification data
    const notificationTitle = payload.notification?.title || payload.data?.title || 'Alwan Update';
    const notificationBody = payload.notification?.body || payload.data?.body || '';
    const notificationType = payload.data?.type || 'default';
    const userName = payload.data?.userName || '';
    
    // Customize notification based on type
    let icon = "/assets/logo/logo.jpg";
    let badge = "/assets/logo/logo.jpg";
    let tag = notificationType;
    let requireInteraction = false;
    
    // SOS alerts should be high priority
    if (notificationType === 'sos') {
        requireInteraction = true; // Stay on screen until user interacts
        tag = 'sos-alert';
    }
    
    const notificationOptions = {
        body: notificationBody,
        icon: icon,
        badge: badge,
        tag: tag,
        requireInteraction: requireInteraction,
        vibrate: notificationType === 'sos' ? [200, 100, 200, 100, 200] : [200, 100, 200],
        data: {
            ...payload.data,
            url: '/dashboard.html',
            type: notificationType
        },
        actions: notificationType === 'sos' ? [
            {
                action: 'view',
                title: 'View Details',
                icon: '/assets/logo/logo.jpg'
            },
            {
                action: 'close',
                title: 'Dismiss'
            }
        ] : []
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('✅ Notification clicked:', event.notification.tag);
    
    event.notification.close();
    
    // Open the app when notification is clicked
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Check if app is already open
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url.includes('/dashboard.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not open, open new window
            if (clients.openWindow) {
                return clients.openWindow('/dashboard.html');
            }
        })
    );
});
