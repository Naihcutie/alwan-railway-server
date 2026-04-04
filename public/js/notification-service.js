// Notification Service - Unified notification handling for web and mobile
// Supports both browser notifications and Capacitor native notifications

class NotificationService {
    constructor() {
        this.isCapacitor = this.checkCapacitor();
        this.notificationId = 1;
        this.initializePermissions();
    }

    // Check if running in Capacitor environment
    checkCapacitor() {
        return typeof window !== 'undefined' && window.Capacitor !== undefined;
    }

    // Check if iOS Safari (web push only works on iOS 16.4+ PWA)
    isIOSSafari() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    isPWA() {
        return window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true;
    }

    // Initialize notification permissions
    async initializePermissions() {
        if (this.isCapacitor) {
            try {
                // LOCAL Notifications setup
                const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
                if (LocalNotifications) {
                    const permission = await LocalNotifications.requestPermissions();
                    console.log('✅ Capacitor local notification permission:', permission.display);
                } else {
                    // console.warn('⚠️ Capacitor LocalNotifications plugin not found during permission check');
                }

                // PUSH Notifications setup
                const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
                if (PushNotifications) {
                    let permStatus = await PushNotifications.checkPermissions();
                    if (permStatus.receive === 'prompt') {
                        permStatus = await PushNotifications.requestPermissions();
                    }

                    if (permStatus.receive === 'granted') {
                        // Register with Apple / Google to receive push via APNS/FCM
                        await PushNotifications.register();
                        console.log('✅ Capacitor PushNotifications requested and registered.');
                    } else {
                        console.log('⚠️ User denied push notifications permission');
                    }

                    // On successful registration, save the token to DB
                    PushNotifications.addListener('registration', async (token) => {
                        console.log('✅ Push notification token received:', token.value);
                        this.savePushTokenToServer(token.value);
                    });

                    PushNotifications.addListener('registrationError',
                        (error) => {
                            console.error('❌ Error on push registration:', error);
                        }
                    );

                    PushNotifications.addListener('pushNotificationReceived',
                        (notification) => {
                            console.log('📲 Push notification received: ', notification);
                        }
                    );

                    PushNotifications.addListener('pushNotificationActionPerformed',
                        (notification) => {
                            console.log('📲 Push notification action performed: ', notification);
                        }
                    );

                } else {
                    // console.warn('⚠️ Capacitor PushNotifications plugin not found');
                }
            } catch (error) {
                console.error('❌ Error requesting Capacitor permissions:', error);
            }
        } else {
            // Web notification permission
            if (!('Notification' in window)) {
                console.log('⚠️ Notifications not supported in this browser');
                return;
            }

            // iOS Safari: push only works on iOS 16.4+ when added to home screen
            if (this.isIOSSafari() && !this.isPWA()) {
                console.log('ℹ️ iOS Safari detected — push notifications require adding app to home screen (iOS 16.4+)');
                return;
            }

            Notification.requestPermission().then(async permission => {
                console.log('✅ Web notification permission:', permission);
                if (permission === 'granted' && typeof firebase !== 'undefined' && firebase.messaging) {
                    try {
                        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
                        console.log('✅ Service Worker Registered');

                        const messaging = firebase.messaging();
                        const VAPID_KEY = 'BJ1bQIlak6Dz_JofHDTFEHwTQoAjM-nTr1s2OaIOSnyeYoDH4F3Ls6B1ER9s-FdBmSQFNNlRGTrgQX7lIOkkUjQ';

                        const currentToken = await messaging.getToken({
                            serviceWorkerRegistration: registration,
                            vapidKey: VAPID_KEY
                        });

                        if (currentToken) {
                            console.log('📱 Web Push Token received.');
                            this.savePushTokenToServer(currentToken);
                        } else {
                            console.warn('⚠️ No FCM token received. Check VAPID key configuration.');
                        }

                        messaging.onMessage((payload) => {
                            console.log('📲 Web Notification Received while app is open:', payload);
                            const title = payload.notification?.title || payload.data?.title || 'Notification';
                            const body = payload.notification?.body || payload.data?.body || '';
                            if (typeof showToast !== 'undefined') {
                                showToast(`${title}: ${body}`, '🔔');
                            }
                        });

                    } catch (err) {
                        console.error('❌ Error setting up Web Push Notification:', err);
                    }
                }
            });
        }
    }

    // Save token to Server — uses Firebase ID token, not a stored key
    async savePushTokenToServer(fcmToken) {
        try {
            const user = typeof firebase !== 'undefined' && firebase.auth().currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            await fetch(SERVER_URL + '/api/user/fcm-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ token: fcmToken })
            });
            console.log('✅ Push token stored on server.');
        } catch (err) {
            console.error('❌ Failed to store push token:', err);
        }
    }

    // Schedule a notification
    async scheduleNotification(options) {
        const {
            title,
            body,
            id = this.notificationId++,
            schedule = null,
            sound = true,
            badge = 1,
            smallIcon = 'ic_stat_icon_config_sample',
            iconColor = '#488AFF',
            actionTypeId = null,
            actions = []
        } = options;

        try {
            if (this.isCapacitor) {
                // Native notification via Capacitor
                await this.scheduleNativeNotification({
                    title,
                    body,
                    id,
                    schedule,
                    sound,
                    badge,
                    smallIcon,
                    iconColor,
                    actionTypeId,
                    actions
                });
            } else {
                // Web notification
                await this.scheduleWebNotification({
                    title,
                    body,
                    id,
                    schedule,
                    sound,
                    badge
                });
            }

            console.log(`📢 Notification scheduled: ${title}`);
            return id;
        } catch (error) {
            console.error('❌ Error scheduling notification:', error);
            return null;
        }
    }

    // Schedule native notification (Capacitor)
    async scheduleNativeNotification(options) {
        const {
            title,
            body,
            id,
            schedule,
            sound,
            badge,
            smallIcon,
            iconColor,
            actionTypeId,
            actions
        } = options;

        // Check if Capacitor LocalNotifications is available
        const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LocalNotifications) {
            console.warn('⚠️ Capacitor LocalNotifications not available for scheduling');
            return;
        }

        // LocalNotifications is already declared above via the null check

        // Capacitor LocalNotifications requires a numeric ID (especially for Android)
        let numericId;
        if (typeof id === 'string') {
            let hash = 0;
            for (let i = 0; i < id.length; i++) {
                hash = ((hash << 5) - hash) + id.charCodeAt(i);
                hash = hash & hash; // Convert to 32bit integer
            }
            numericId = Math.abs(hash);
        } else {
            numericId = typeof id === 'number' ? id : this.notificationId++;
        }

        const notification = {
            title,
            body,
            id: numericId,
            smallIcon,
            iconColor,
            sound: sound ? 'default' : undefined,
            badge,
            actionTypeId,
            actions: actions.length > 0 ? actions : undefined
        };

        // Add schedule if provided
        if (schedule) {
            const { at, every, on } = schedule;
            if (on) {
                // OS-level daily repeating notification at a specific time (e.g. on: { hour: 8, minute: 30 })
                notification.schedule = {
                    on: on,
                    repeats: true
                };
            } else if (at) {
                // One-time notification
                notification.schedule = {
                    at: new Date(at)
                };
            } else if (every) {
                notification.schedule = {
                    every: every // 'year', 'month', 'two-weeks', 'week', 'day', 'hour', 'minute', 'second'
                };
            }
        }


        await LocalNotifications.schedule({
            notifications: [notification]
        });
    }

    // Schedule web notification
    async scheduleWebNotification(options) {
        const { title, body, id, schedule, sound } = options;

        if (!('Notification' in window)) {
            console.warn('⚠️ Notifications not supported in this browser');
            return;
        }

        if (Notification.permission !== 'granted') {
            console.warn('⚠️ Notification permission not granted');
            return;
        }

        if (schedule && schedule.at) {
            // Schedule for later
            const delay = new Date(schedule.at).getTime() - Date.now();
            if (delay > 0) {
                setTimeout(() => {
                    new Notification(title, {
                        body,
                        icon: '/assets/icon.png',
                        tag: `notification-${id}`,
                        requireInteraction: false,
                        sound: sound ? '/assets/notification.mp3' : undefined
                    });
                }, delay);
            }
        } else {
            // Send immediately
            new Notification(title, {
                body,
                icon: '/assets/icon.png',
                tag: `notification-${id}`,
                requireInteraction: false,
                sound: sound ? '/assets/notification.mp3' : undefined
            });
        }
    }

    // Send immediate notification
    async sendNotification(title, body, options = {}) {
        return this.scheduleNotification({
            title,
            body,
            ...options
        });
    }

    // Cancel notification
    async cancelNotification(id) {
        try {
            if (this.isCapacitor) {
                const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
                if (LocalNotifications) {
                    await LocalNotifications.cancel({ notifications: [{ id }] });
                    console.log(`✅ Notification ${id} cancelled`);
                }
            }
        } catch (error) {
            console.error('❌ Error cancelling notification:', error);
        }
    }

    // Cancel all notifications
    async cancelAllNotifications() {
        try {
            if (this.isCapacitor) {
                const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
                if (LocalNotifications) {
                    await LocalNotifications.cancelAll();
                    console.log('✅ All notifications cancelled');
                }
            }
        } catch (error) {
            console.error('❌ Error cancelling all notifications:', error);
        }
    }

    // Get pending notifications
    async getPendingNotifications() {
        try {
            if (this.isCapacitor) {
                const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
                if (LocalNotifications) {
                    const result = await LocalNotifications.getPending();
                    return result.notifications;
                }
            }
            return [];
        } catch (error) {
            console.error('❌ Error getting pending notifications:', error);
            return [];
        }
    }

    // Listen for notification clicks
    onNotificationClick(callback) {
        if (this.isCapacitor) {
            const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
            if (LocalNotifications) {
                LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
                    console.log('🔔 Notification clicked:', notification);
                    callback(notification);
                });
            } else {
                // console.warn('⚠️ Capacitor LocalNotifications plugin not found');
            }
        }
    }

    // Listen for notification received
    onNotificationReceived(callback) {
        if (this.isCapacitor) {
            const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
            if (LocalNotifications) {
                LocalNotifications.addListener('localNotificationReceived', (notification) => {
                    console.log('📬 Notification received:', notification);
                    callback(notification);
                });
            } else {
                // console.warn('⚠️ Capacitor LocalNotifications plugin not found');
            }
        }
    }
}

// Create singleton instance
const notificationService = new NotificationService();

// Export for use
window.notificationService = notificationService;
