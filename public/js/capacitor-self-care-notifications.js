// Capacitor Self-Care Notifications Integration
// Converts self-care reminders to native notifications

// Send self-care reminder notification
async function sendSelfCareReminder(activity) {
    if (!window.notificationService) {
        console.warn('⚠️ Notification service not initialized');
        return;
    }

    const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;
    const localized = getLocalizedActivity(activity);

    const title = isFilipino
        ? `⏰ Oras na para sa ${localized.title}`
        : `⏰ Time for ${localized.title}`;

    const body = isFilipino
        ? `Simulan ang iyong ${localized.title} ngayon!`
        : `Start your ${localized.title} now!`;

    try {
        await window.notificationService.sendNotification(title, body, {
            id: `self-care-${activity.id}-${Date.now()}`,
            sound: true,
            badge: 1,
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#488AFF'
        });

        // Also save to notification history
        saveNotificationToHistory({
            type: 'self-care-reminder',
            title,
            body,
            activityId: activity.id,
            activityTitle: localized.title,
            timestamp: new Date().toISOString(),
            read: false,
            icon: activity.icon
        });
    } catch (error) {
        console.error('❌ Error sending self-care reminder:', error);
    }
}

// Schedule self-care reminders for the day
async function scheduleDailySelfCareReminders() {
    if (!window.notificationService || !window.notificationService.isCapacitor) {
        console.log('⚠️ Capacitor not available, skipping native notification scheduling');
        return;
    }

    if (!selfCareActivities) {
        console.warn('⚠️ Self-care activities not loaded');
        return;
    }

    const today = new Date();
    const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;

    for (const activity of selfCareActivities) {
        if (!activity.reminderTime) continue;

        const [hours, minutes] = activity.reminderTime.split(':');
        const reminderDate = new Date(today);
        reminderDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        // Skip if time has already passed today
        if (reminderDate < new Date()) {
            continue;
        }

        const localized = getLocalizedActivity(activity);
        const title = isFilipino
            ? `⏰ Oras na para sa ${localized.title}`
            : `⏰ Time for ${localized.title}`;

        const body = isFilipino
            ? `Simulan ang iyong ${localized.title} ngayon!`
            : `Start your ${localized.title} now!`;

        try {
            await window.notificationService.scheduleNotification({
                title,
                body,
                id: `self-care-${activity.id}`,
                schedule: {
                    on: {
                        hour: parseInt(hours),
                        minute: parseInt(minutes)
                    }
                },
                sound: true,
                badge: 1,
                smallIcon: 'ic_stat_icon_config_sample',
                iconColor: '#488AFF'
            });

            console.log(`✅ Scheduled reminder for ${activity.title} at ${activity.reminderTime}`);
        } catch (error) {
            console.error(`❌ Error scheduling reminder for ${activity.id}:`, error);
        }
    }
}

// Send debriefing notification
async function sendDebriefingNotification(debriefing, type = 'scheduled') {
    if (!window.notificationService) {
        console.warn('⚠️ Notification service not initialized');
        return;
    }

    const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;

    let title, body, id;

    switch (type) {
        case 'scheduled':
            title = isFilipino
                ? `📅 Bagong Debriefing Session`
                : `📅 New Debriefing Session`;
            body = isFilipino
                ? `"${debriefing.title}" ay scheduled para sa ${debriefing.date} at ${debriefing.time}`
                : `"${debriefing.title}" is scheduled for ${debriefing.date} at ${debriefing.time}`;
            id = `debriefing-scheduled-${debriefing.id}`;
            break;

        case 'reminder':
            title = isFilipino
                ? `⏰ Debriefing Session Reminder`
                : `⏰ Debriefing Session Reminder`;
            body = isFilipino
                ? `"${debriefing.title}" ay magsisimula na! Join now!`
                : `"${debriefing.title}" is starting now! Join now!`;
            id = `debriefing-reminder-${debriefing.id}`;
            break;

        case 'started':
            title = isFilipino
                ? `🔴 Debriefing Session Live`
                : `🔴 Debriefing Session Live`;
            body = isFilipino
                ? `"${debriefing.title}" ay live na ngayon`
                : `"${debriefing.title}" is live now`;
            id = `debriefing-started-${debriefing.id}`;
            break;

        case 'completed':
            title = isFilipino
                ? `✅ Debriefing Session Completed`
                : `✅ Debriefing Session Completed`;
            body = isFilipino
                ? `"${debriefing.title}" ay tapos na`
                : `"${debriefing.title}" has been completed`;
            id = `debriefing-completed-${debriefing.id}`;
            break;

        default:
            return;
    }

    try {
        await window.notificationService.sendNotification(title, body, {
            id,
            sound: true,
            badge: 1,
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#488AFF'
        });

        console.log(`✅ Debriefing notification sent: ${type}`);
    } catch (error) {
        console.error('❌ Error sending debriefing notification:', error);
    }
}

// Send SOS alert notification
async function sendSOSNotification(sosData) {
    if (!window.notificationService) {
        console.warn('⚠️ Notification service not initialized');
        return;
    }

    const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;

    const title = isFilipino ? `🆘 SOS Alert` : `🆘 SOS Alert`;
    const body = isFilipino
        ? `${sosData.userName} ay nangangailangan ng tulong`
        : `${sosData.userName} needs immediate support`;

    try {
        await window.notificationService.sendNotification(title, body, {
            id: `sos-${sosData.id}`,
            sound: true,
            badge: 1,
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#ef4444' // Red for urgent
        });

        console.log('✅ SOS notification sent');
    } catch (error) {
        console.error('❌ Error sending SOS notification:', error);
    }
}

// Send goal reminder notification
async function sendGoalReminderNotification(goal) {
    if (!window.notificationService) {
        console.warn('⚠️ Notification service not initialized');
        return;
    }

    const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;

    const title = isFilipino ? `🎯 Goal Reminder` : `🎯 Goal Reminder`;
    const body = isFilipino
        ? `Oras na para sa iyong goal: ${goal.title}`
        : `Time for your goal: ${goal.title}`;

    try {
        await window.notificationService.sendNotification(title, body, {
            id: `goal-${goal.id}`,
            sound: true,
            badge: 1,
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#3b82f6'
        });

        console.log('✅ Goal reminder notification sent');
    } catch (error) {
        console.error('❌ Error sending goal reminder notification:', error);
    }
}

// Send important day notification
async function sendImportantDayNotification(day) {
    if (!window.notificationService) {
        console.warn('⚠️ Notification service not initialized');
        return;
    }

    const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;

    const title = isFilipino ? `📅 Mahalagang Araw` : `📅 Important Day`;
    const body = isFilipino
        ? `Reminder: ${day.title}`
        : `Reminder: ${day.title}`;

    try {
        await window.notificationService.sendNotification(title, body, {
            id: `event-${day.id}`,
            sound: true,
            badge: 1,
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#ec4899',
            data: { dayId: day.id }
        });

        console.log('✅ Important day notification sent');

        // Save to history
        saveNotificationToHistory({
            type: 'important_day',
            title,
            body,
            dayId: day.id,
            timestamp: new Date().toISOString(),
            read: false,
            icon: 'bi-calendar-event'
        });
    } catch (error) {
        console.error('❌ Error sending important day notification:', error);
    }
}

// Send mood check-in notification
async function sendMoodCheckInNotification() {
    if (!window.notificationService) {
        console.warn('⚠️ Notification service not initialized');
        return;
    }

    const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;

    const title = isFilipino ? `💭 Paano ang iyong feeling?` : `💭 How's your feeling?`;
    const body = isFilipino
        ? `Mag-log ng iyong mood ngayon`
        : `Log your mood now`;

    try {
        await window.notificationService.sendNotification(title, body, {
            id: `mood-checkin-${Date.now()}`,
            sound: true,
            badge: 1,
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#8b5cf6'
        });

        console.log('✅ Mood check-in notification sent');
    } catch (error) {
        console.error('❌ Error sending mood check-in notification:', error);
    }
}

// Save notification to history
function saveNotificationToHistory(notification) {
    try {
        const history = JSON.parse(localStorage.getItem('psyc_notification_history') || '[]');
        history.unshift({
            ...notification,
            id: `notif-${Date.now()}`
        });

        // Keep only last 50
        if (history.length > 50) {
            history.pop();
        }

        localStorage.setItem('psyc_notification_history', JSON.stringify(history));

        // Update UI if functions exist
        if (typeof updateNotificationBadge === 'function') {
            updateNotificationBadge();
        }
        if (typeof renderNotificationHistory === 'function') {
            renderNotificationHistory();
        }
    } catch (error) {
        console.error('❌ Error saving notification to history:', error);
    }
}

// Initialize Capacitor notifications on app load
function initCapacitorNotifications() {
    if (!window.notificationService) {
        console.warn('⚠️ Notification service not available');
        return;
    }

    console.log('🔔 Initializing Capacitor notifications...');

    // Listen for notification clicks
    window.notificationService.onNotificationClick((notification) => {
        console.log('🔔 Notification clicked:', notification);
        // Handle notification click - navigate to relevant page
        handleNotificationClick(notification);
    });

    // Listen for notifications received
    window.notificationService.onNotificationReceived((notification) => {
        console.log('📬 Notification received:', notification);
    });

    // Schedule daily self-care reminders
    scheduleDailySelfCareReminders();

    console.log('✅ Capacitor notifications initialized');
}

// Handle notification click
function handleNotificationClick(notification) {
    const { data } = notification;

    if (data && data.activityId) {
        // Self-care activity - open activity detail
        if (typeof openActivityDetail === 'function') {
            openActivityDetail(data.activityId);
        }
    } else if (data && data.debriefingId) {
        // Debriefing session - navigate to debriefing
        console.log('Opening debriefing:', data.debriefingId);
    } else if (data && data.goalId) {
        // Goal - navigate to goals
        console.log('Opening goal:', data.goalId);
    }
}

// Export functions
window.capacitorNotifications = {
    sendSelfCareReminder,
    scheduleDailySelfCareReminders,
    sendDebriefingNotification,
    sendSOSNotification,
    sendGoalReminderNotification,
    sendImportantDayNotification,
    sendMoodCheckInNotification,
    initCapacitorNotifications
};

// Auto-initialize when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCapacitorNotifications);
} else {
    initCapacitorNotifications();
}
