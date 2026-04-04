// Native Push Notifications Handler for Capacitor
// This handles push notifications in the native Android app

import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

class NativePushNotificationService {
    constructor() {
        this.isNative = Capacitor.isNativePlatform();
        this.fcmToken = null;
    }

    async initialize() {
        if (!this.isNative) {
            console.log('Not running on native platform, skipping native push setup');
            return false;
        }

        try {
            // Request permission
            const permStatus = await PushNotifications.requestPermissions();
            
            if (permStatus.receive === 'granted') {
                // Register with FCM
                await PushNotifications.register();
                
                // Setup listeners
                this.setupListeners();
                
                console.log('Native push notifications initialized');
                return true;
            } else {
                console.log('Push notification permission denied');
                return false;
            }
        } catch (error) {
            console.error('Error initializing native push notifications:', error);
            return false;
        }
    }

    setupListeners() {
        // Called when registration is successful
        PushNotifications.addListener('registration', (token) => {
            console.log('FCM Token:', token.value);
            this.fcmToken = token.value;
            
            // Save token to your server
            this.saveFCMToken(token.value);
        });

        // Called when registration fails
        PushNotifications.addListener('registrationError', (error) => {
            console.error('Push registration error:', error);
        });

        // Called when notification is received while app is in foreground
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('Push notification received:', notification);
            
            // Show notification in app
            this.showInAppNotification(notification);
        });

        // Called when user taps on notification
        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
            console.log('Push notification action performed:', notification);
            
            // Handle notification tap
            this.handleNotificationTap(notification);
        });
    }

    async saveFCMToken(token) {
        try {
            const userId = localStorage.getItem('userId');
            if (!userId) {
                console.log('No user ID, will save token after login');
                localStorage.setItem('pendingFCMToken', token);
                return;
            }

            // Send token to your server
            const response = await fetch('/api/save-fcm-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: userId,
                    fcmToken: token,
                    platform: 'android'
                })
            });

            if (response.ok) {
                console.log('FCM token saved to server');
                localStorage.removeItem('pendingFCMToken');
            }
        } catch (error) {
            console.error('Error saving FCM token:', error);
        }
    }

    showInAppNotification(notification) {
        // Show notification banner in app
        const banner = document.createElement('div');
        banner.className = 'notification-banner';
        banner.innerHTML = `
            <div class="notification-content">
                <strong>${notification.title}</strong>
                <p>${notification.body}</p>
            </div>
        `;
        
        document.body.appendChild(banner);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            banner.remove();
        }, 5000);
    }

    handleNotificationTap(notification) {
        // Navigate based on notification data
        const data = notification.notification.data;
        
        if (data.type === 'mood_reminder') {
            // Open mood logging modal
            window.location.hash = '#log-mood';
        } else if (data.type === 'self_care') {
            // Open self-care section
            window.location.hash = '#self-care';
        }
    }

    async checkPendingToken() {
        // Check if there's a pending token to save after login
        const pendingToken = localStorage.getItem('pendingFCMToken');
        if (pendingToken) {
            await this.saveFCMToken(pendingToken);
        }
    }

    getFCMToken() {
        return this.fcmToken;
    }

    isNativePlatform() {
        return this.isNative;
    }
}

// Export singleton instance
const nativePushService = new NativePushNotificationService();

// Auto-initialize when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        nativePushService.initialize();
    });
} else {
    nativePushService.initialize();
}

export default nativePushService;
