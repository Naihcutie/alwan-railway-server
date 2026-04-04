// --- Alwan Dashboard (Daylio-style) --------------------------

// ─── iOS-safe storage helpers ────────────────────────────────────
function storageGet(key) {
    try { const v = localStorage.getItem(key); if (v !== null) return v; } catch (e) { }
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
}
function storageSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {
        try { sessionStorage.setItem(key, val); } catch (_) { }
    }
}
function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { }
    try { sessionStorage.removeItem(key); } catch (_) { }
}

let socket = null;
window.socket = null; // Expose globally for debugging
let currentUser = null;
let notificationLogs = []; // Initialize notification logs early

/**
 * Add a notification to the local log and re-render the reminders widget
 */
window.addNotificationToLog = function (title, body, type, userName = 'System', timestamp = null, id = null) {
    const notif = {
        id: id || Date.now() + Math.random(),
        title,
        body,
        type,
        userName,
        timestamp: timestamp || new Date().toISOString()
    };

    // Deduplicate
    if (notificationLogs.some(n => n.id === notif.id)) return;

    // Add to the beginning of the list
    notificationLogs.unshift(notif);

    // Keep only the last 50
    if (notificationLogs.length > 50) {
        notificationLogs.pop();
    }

    // Re-render
    renderNotificationLogs();
};
const membersMap = new Map();
let currentLang = storageGet('psyc_lang') || 'en';

// --- Daily Motivational Quotes (DEFINED EARLY) --------------------------
let quotesCache = [];
let currentQuoteIndex = 0;
let currentQuoteLiked = false;
let dailyQuote = null;

// Get archived quotes
function getArchivedQuotes() {
    const stored = localStorage.getItem('psyc_archived_quotes');
    return stored ? JSON.parse(stored) : {};
}

// Toggle archive for current quote - MONGODB VERSION
window.toggleQuoteArchive = async function () {
    console.log('=== toggleQuoteArchive called (MongoDB version) ===');

    // Get current user
    const user = firebase.auth().currentUser;
    if (!user) {
        console.error('User not logged in');
        if (typeof ldToast === 'function') {
            ldToast('Please log in to save quotes', 'error');
        }
        return;
    }

    // Try to get the quote from multiple sources
    let quote = window.currentDisplayedQuote || dailyQuote;

    if (!quote || !quote.q) {
        console.error('No quote available.');
        if (typeof ldToast === 'function') {
            ldToast('Could not find quote to save', 'error');
        }
        return;
    }

    // Set default author if missing
    if (!quote.a) {
        quote.a = "Alwan Team";
    }

    try {
        const token = await user.getIdToken();
        const quoteIdBase = `${quote.q}_${quote.a}`;
        const archiveBtn = document.getElementById('ld-quote-archive-btn');

        // Check if already archived in MongoDB
        const checkResponse = await fetch(SERVER_URL + '/api/archives/quotes', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        let existingQuote = null;
        if (checkResponse.ok) {
            const archives = await checkResponse.json();
            existingQuote = archives.find(q => q.quote === quote.q && q.author === quote.a);
        }

        if (existingQuote) {
            // Remove from archives
            console.log('Quote already archived, removing...');
            const deleteResponse = await fetch(SERVER_URL + `/api/archives/quotes/${existingQuote._id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (deleteResponse.ok) {
                // Also remove from localStorage
                const localArchives = getArchivedQuotes();
                delete localArchives[quoteIdBase];
                localStorage.setItem('psyc_archived_quotes', JSON.stringify(localArchives));

                // Update button
                if (archiveBtn) {
                    archiveBtn.innerHTML = '<i class="bi bi-archive"></i>';
                    archiveBtn.classList.remove('archived');
                }

                if (typeof ldToast === 'function') {
                    ldToast('Removed from archives', 'info');
                }
                console.log('? Quote removed from MongoDB');
            }
        } else {
            // Add to archives
            console.log('Saving to MongoDB...');
            const saveResponse = await fetch(SERVER_URL + '/api/archives/quotes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    quote: quote.q,
                    author: quote.a
                })
            });

            if (saveResponse.ok) {
                // Also save to localStorage for offline access
                const localArchives = getArchivedQuotes();
                localArchives[quoteIdBase] = {
                    quote: quote.q,
                    author: quote.a,
                    timestamp: Date.now()
                };
                localStorage.setItem('psyc_archived_quotes', JSON.stringify(localArchives));

                // Update button
                if (archiveBtn) {
                    archiveBtn.innerHTML = '<i class="bi bi-archive-fill"></i>';
                    archiveBtn.classList.add('archived');
                }

                if (typeof ldToast === 'function') {
                    ldToast('Saved to archives!', 'success');
                }
                console.log('? Quote saved to MongoDB successfully!');
            }
        }
    } catch (error) {
        console.error('MongoDB error:', error);
        if (typeof ldToast === 'function') {
            ldToast('Error saving quote: ' + error.message, 'error');
        }
    }
};

// Update archive button state based on current quote
window.updateArchiveButton = function () {
    if (!dailyQuote) return;

    const archives = getArchivedQuotes();
    const quoteId = `${dailyQuote.q}_${dailyQuote.a}`;
    const archiveBtn = document.getElementById('ld-quote-archive-btn');

    if (archiveBtn) {
        if (archives[quoteId]) {
            archiveBtn.innerHTML = '<i class="bi bi-archive-fill"></i>';
            archiveBtn.classList.add('archived');
        } else {
            archiveBtn.innerHTML = '<i class="bi bi-archive"></i>';
            archiveBtn.classList.remove('archived');
        }
    }
};
// --- End of Early Quotes Functions --------------------------------------

const LANGS = {
    en: {
        rad: 'Anger', good: 'Sadness', meh: 'Joy', bad: 'Disgust', awful: 'Fear',
        working: 'Working', meeting: 'Meeting', coding: 'Coding', designing: 'Designing',
        break: 'Break', lunch: 'Lunch', exercise: 'Exercise', reading: 'Reading',
        brainstorm: 'Brainstorm', presenting: 'Presenting', commuting: 'Commuting', socializing: 'Socializing',
        current_month_label: (val) => val, // placeholder for date
        filter_all: 'All', filter_me: 'Me',
        how_are_you: 'How are you today?',
        first_entry_msg: 'Pick a mood to create your first entry!',
        sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
        s_short: 'S', m_short: 'M', t_short: 'T', w_short: 'W', t_short_2: 'T', f_short: 'F', s_short_2: 'S',
        mood_count: 'Mood Count',
        days_in_a_row: 'Days in a Row',
        longest_chain: 'Longest Chain',
        month_in_pixels: 'Month in Pixels',
        mood_chart: 'Mood Chart',
        mood_dist: 'Mood Distribution',
        team_mood_dist: 'Team Mood Distribution',
        top_activities: 'Top Activities',
        view_year_stats: 'View Year Statistics',
        see_mood_trends: 'See your mood trends for 2026',
        connecting_team: 'Connecting to your team...',
        online: 'online', members: 'members', connected: 'Connected',
        admin_panel: 'Admin Panel', group_invite_code: 'Group Invite Code',
        share_code_hint: 'Share this code to invite others to your team',
        team_status: 'Team Status', goals: 'Goals', important_days: 'Important Days',
        reminders: 'Reminders', customize_activity: 'Customize Activity',
        settings: 'Settings', about: 'About', logout: 'Logout',
        language: 'Language', theme_color: 'Theme Color', pin_lock: 'PIN Lock',
        coming_soon: 'Coming soon', share_app: 'Share App', version: 'Version',
        about_desc: 'Track your mood and activities with your team in real-time. Build better habits and understand your emotional patterns.',
        privacy_policy: 'Privacy Policy', terms_service: 'Terms of Service', support: 'Support',
        all_rights: 'All rights reserved.', daily_checkin: 'Daily check-in reminder',
        remind_once_day: 'We\'ll remind you once a day to log your mood.',
        reminder_time: 'Reminder time',
        year_2026: '2026', year_in_pixels: 'Year in Pixels', year_pixels_hint: 'Tap mood to highlight it on the chart',
        monthly_mood_chart: 'Monthly Mood Chart', year_mood_dist: 'Year Mood Distribution',
        team_top_activities: 'Top Activities',
        today: 'TODAY', yesterday: 'YESTERDAY', event: 'EVENT', team: 'TEAM',
        how_are_you_short: 'How are you?',
        no_entries_for: 'No entries for',
        just_now: 'just now', ago: 'ago',
        m: 'm', h: 'h', d: 'd',
        admin: 'ADMIN', member: 'MEMBER',
        recent_notifications: 'Recent Notifications', no_notifications: 'No new notifications'
    },
    fil: {
        rad: 'Galit', good: 'Malungkot', meh: 'Masaya', bad: 'Nasusuklam', awful: 'Takot',
        working: 'Nagtatrabaho', meeting: 'Pagpupulong', coding: 'Nagsusulat ng Code', designing: 'Nagdidisenyo',
        break: 'Pahinga', lunch: 'Tanghalian', exercise: 'Ehersisyo', reading: 'Nagbabasa',
        brainstorm: 'Brainstorm', presenting: 'Nagtatanyag', commuting: 'Bumabyahe', socializing: 'Nakikihalubilo',
        current_month_label: (val) => val, // placeholder
        filter_all: 'Lahat', filter_me: 'Ako',
        how_are_you: 'Kumusta ka ngayong araw?',
        first_entry_msg: 'Pumili ng mood para gumawa ng iyong unang entry!',
        sun: 'Lin', mon: 'Lun', tue: 'Mar', wed: 'Miy', thu: 'Huw', fri: 'Biy', sat: 'Sab',
        s_short: 'L', m_short: 'L', t_short: 'M', w_short: 'M', t_short_2: 'H', f_short: 'B', s_short_2: 'S',
        mood_count: 'Bilang ng Mood',
        days_in_a_row: 'Sunod-sunod na Araw',
        longest_chain: 'Pinakamahabang Chain',
        month_in_pixels: 'Buwan sa Pixels',
        mood_chart: 'Tsart ng Mood',
        mood_dist: 'Distribusyon ng Mood',
        team_mood_dist: 'Distribusyon ng Mood ng Team',
        top_activities: 'Mga Pangunahing Gawain',
        view_year_stats: 'Tingnan ang Estadistika ng Taon',
        see_mood_trends: 'Tingnan ang trend ng iyong mood para sa 2026',
        connecting_team: 'Kumokonekta sa iyong team...',
        online: 'online', members: 'miyembro', connected: 'Konektado',
        admin_panel: 'Admin Panel', group_invite_code: 'Invite Code ng Grupo',
        share_code_hint: 'Ibahagi ang code na ito para mag-imbita ng iba sa iyong team',
        team_status: 'Katayuan ng Team', goals: 'Mga Layunin', important_days: 'Mahahalagang Araw',
        reminders: 'Mga Paalala', customize_activity: 'I-customize ang Gawain',
        settings: 'Mga Setting', about: 'Tungkol', logout: 'Mag-logout',
        language: 'Wika', theme_color: 'Kulay ng Tema', pin_lock: 'PIN Lock',
        coming_soon: 'Malapit na', share_app: 'Ibahagi ang App', version: 'Bersyon',
        about_desc: 'Subaybayan ang iyong mood at mga gawain kasama ang iyong team sa real-time. Bumuo ng mas mabuting gawi at unawain ang iyong emosyonal na pattern.',
        privacy_policy: 'Patakaran sa Privacy', terms_service: 'Mga Tuntunin ng Serbisyo', support: 'Suporta',
        all_rights: 'Lahat ng karapatan ay nakalaan.', daily_checkin: 'Pang-araw-araw na paalala',
        remind_once_day: 'Paalalahanan ka namin isang beses sa isang araw para i-log ang iyong mood.',
        reminder_time: 'Oras ng paalala',
        year_2026: '2026', year_in_pixels: 'Taon sa Pixels', year_pixels_hint: 'I-tap ang mood para i-highlight sa tsart',
        monthly_mood_chart: 'Buwanang Tsart ng Mood', year_mood_dist: 'Distribusyon ng Mood sa Taon',
        team_top_activities: 'Mga Pangunahing Gawain',
        today: 'NGAYON', yesterday: 'KAHAPON', event: 'KAGANAPAN', team: 'TEAM',
        how_are_you_short: 'Kumusta ka?',
        no_entries_for: 'Walang entry para sa',
        just_now: 'ngayon lang', ago: 'nakalipas',
        m: 'm', h: 'o', d: 'a',
        admin: 'ADMIN', member: 'MIYEMBRO',
        recent_notifications: 'Mga Kamakailang Notification', no_notifications: 'Walang bagong notification'
    }
};

function t(key, val = null) {
    const lang = LANGS[currentLang] || LANGS.en;
    const entry = lang[key] || LANGS.en[key] || key;
    return typeof entry === 'function' ? entry(val) : entry;
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        // Handle special case for current month label which is dynamic
        if (key === 'current_month_label') return;
        el.textContent = t(key);
    });
    // Update dropdown to match current language
    const langSelect = document.getElementById('language-select');
    if (langSelect) langSelect.value = currentLang;
}

// Mood options (kept for backward compatibility with server data)
const MOODS = [
    { key: 'rad', emoji: '😠', icon: 'bi-emoji-angry-fill', label: 'Anger', color: '#EF4444' },
    { key: 'good', emoji: '😢', icon: 'bi-emoji-tear-fill', label: 'Sadness', color: '#60A5FA' },
    { key: 'meh', emoji: '😄', icon: 'bi-emoji-laughing-fill', label: 'Joy', color: '#FACC15' },
    { key: 'bad', emoji: '🤢', icon: 'bi-emoji-frown-fill', label: 'Disgust', color: '#4ADE80' },
    { key: 'awful', emoji: '😨', icon: 'bi-emoji-dizzy-fill', label: 'Fear', color: '#A855F7' },
];

function getLocalizedMoods() {
    return MOODS.map(m => ({ ...m, label: t(m.key) }));
}

// Helper function to get mood data by key (for backward compatibility)
function getMoodByKey(key) {
    return MOODS.find(m => m.key === key) || {
        key: key,
        emoji: '??',
        label: key.charAt(0).toUpperCase() + key.slice(1),
        color: '#4ade80'
    };
}

// Activity options (Daylio-style)
const ACTIVITIES = [
    { key: 'working', icon: 'bi-laptop', label: 'Working' },
    { key: 'meeting', icon: 'bi-people', label: 'Meeting' },
    { key: 'coding', icon: 'bi-code-slash', label: 'Coding' },
    { key: 'designing', icon: 'bi-palette', label: 'Designing' },
    { key: 'break', icon: 'bi-cup-hot', label: 'Break' },
    { key: 'lunch', icon: 'bi-egg-fried', label: 'Lunch' },
    { key: 'exercise', icon: 'bi-bicycle', label: 'Exercise' },
    { key: 'reading', icon: 'bi-book', label: 'Reading' },
    { key: 'brainstorm', icon: 'bi-lightbulb', label: 'Brainstorm' },
    { key: 'presenting', icon: 'bi-graph-up', label: 'Presenting' },
    { key: 'commuting', icon: 'bi-car-front', label: 'Commuting' },
    { key: 'socializing', icon: 'bi-chat-left-dots', label: 'Socializing' },
];

function getLocalizedActivities() {
    return ACTIVITIES.map(a => ({ ...a, label: t(a.key) }));
}

let selectedActivities = new Set();
let moodEntries = []; // Organizational Feed entries
let personalEntries = []; // Personal History for Calendar
let allImportantDays = []; // cached for calendar integration
let goalsList = []; // cached for reminder engine
let feedFilter = 'all'; // 'all' or 'me'
let lastFeedTimestamp = null;
let hasMoreFeed = false;
let selectedFeedDay = new Date(); // Default to today
let pendingMood = null;
let customActivities = [];

// Audio for alarm
const alarmSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
alarmSound.volume = 0.5;




// --- Init on page load ------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // Pre-fill user and org from local storage so they "stay" on dashboard even before network calls
    const cachedUsername = storageGet('psyc_username');
    if (cachedUsername) {
        const userNameEl = document.getElementById('user-name');
        if (userNameEl) userNameEl.textContent = '@' + cachedUsername;
    }

    const cachedOrgName = storageGet('psyc_orgName');
    if (cachedOrgName) {
        const orgNameEl = document.getElementById('org-name');
        if (orgNameEl) orgNameEl.textContent = cachedOrgName;
        updateTeamHeader();
    }

    // Set month header
    updateMonthHeader();
    applyTranslations();

    // Dark Mode initialization
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const isDarkMode = localStorage.getItem('psyc_dark_mode') === 'true';

    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        if (darkModeToggle) darkModeToggle.checked = true;
    }

    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.body.classList.add('dark-mode');
                localStorage.setItem('psyc_dark_mode', 'true');
                showToast(currentLang === 'fil' ? 'Naka-on na ang Dark Mode' : 'Dark Mode enabled', '??');
            } else {
                document.body.classList.remove('dark-mode');
                localStorage.setItem('psyc_dark_mode', 'false');
                showToast(currentLang === 'fil' ? 'Naka-off na ang Dark Mode' : 'Dark Mode disabled', '??');
            }
        });
    }

    // Initialize notification system
    updateNotificationBadge();
    renderNotificationHistory();

    // Start Real-Time Reminder Engine
    startRemindersEngine();

    // Language selection listener
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.addEventListener('change', (e) => {
            currentLang = e.target.value;
            storageSet('psyc_lang', currentLang);
            applyTranslations();
            updateMonthHeader();

            // Re-render UI components that have static text labels
            if (feedFilter === 'all' || feedFilter === 'me') {
                renderFeed(moodEntries);
            }
            renderCalendar(personalEntries);
            renderMoodCountSummary(personalEntries);
            renderMonthPixels(personalEntries);

            // Notify user
            showToast(currentLang === 'fil' ? 'Binago ang wika sa Filipino' : 'Language changed to English', '??');

            // In a real app, we would also update the user's preference in Firestore here
            if (currentUser) {
                db.collection('users').doc(currentUser.uid).update({ language: currentLang })
                    .catch(err => console.error('Error updating language preference:', err));
            }
        });
    }

    let isInitCheck = false;
    auth.onAuthStateChanged(async (user) => {
        if (isInitCheck) return;
        if (!user) {
            storageRemove('psyc_orgId');
            if (!window.location.pathname.endsWith('/') && !window.location.pathname.includes('index.html')) {
                window.location.href = '/';
            }
            return;
        }

        isInitCheck = true;
        try {
            const token = await user.getIdToken();
            const res = await fetch(SERVER_URL + `/api/user/verify-org?t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            // Avoid hard redirect loops on generic backend failures
            if (!res.ok) {
                console.warn('verify-org failed on dashboard with status', res.status);

                // If auth is invalid, send user back to login once
                if (res.status === 401) {
                    storageRemove('psyc_orgId');
                    storageRemove('psyc_username');
                    storageRemove('psyc_orgName');
                    await auth.signOut();
                    window.location.href = '/';
                    return;
                }

                // Check if it's a quota exceeded error (500)
                if (res.status === 500) {
                    showToast('Firebase quota exceeded. Please try again later or contact admin.', '??');
                    // Show a more prominent error message
                    const mainContent = document.querySelector('.ld-scroll');
                    if (mainContent) {
                        mainContent.innerHTML = `
                            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;padding:40px;text-align:center;">
                                <div style="font-size:4rem;margin-bottom:20px;">??</div>
                                <h2 style="font-size:1.5rem;font-weight:700;color:#1e293b;margin-bottom:12px;">Service Temporarily Unavailable</h2>
                                <p style="color:#64748b;max-width:500px;line-height:1.6;">
                                    Firebase quota has been exceeded. The service will be available again after the daily quota resets (usually around 4PM Manila time).
                                </p>
                                <button onclick="location.reload()" style="margin-top:24px;padding:12px 24px;background:#3b82f6;color:white;border:none;border-radius:12px;font-weight:600;cursor:pointer;">
                                    Retry
                                </button>
                            </div>
                        `;
                    }
                    return;
                }

                // For other non-auth errors, stay on dashboard and just show limited data
                showToast('Cannot reach server right now. Some data may be missing.', '??');
                return;
            }

            const data = await res.json();

            // Use cached username as a soft fallback to avoid ping-pong redirects
            const cachedUsername = storageGet('psyc_username');
            const effectiveHasUsername = data && (data.hasUsername || !!cachedUsername);

            if (!effectiveHasUsername) {
                if (window.location.pathname.includes('dashboard.html')) {
                    console.warn("?? No username found in verify-org response. Redirecting to login setup...");
                    storageRemove('psyc_orgId');
                    window.location.href = '/?error=no_username';
                }
                return;
            }

            // Sync orgId to localStorage if server finds one
            if (data.orgId) {
                storageSet('psyc_orgId', data.orgId);
            } else {
                // No orgId from server - user is not in any organization
                storageRemove('psyc_orgId');
                storageRemove('psyc_orgName');

                if (window.location.pathname.includes('dashboard.html')) {
                    console.warn("?? No organization found for this user. Redirecting to setup...");
                    window.location.href = '/?error=no_org';
                    return;
                }
            }




            // Keep a reference to the raw Firebase user object for things like getIdToken
            currentUser = user;

            // photoURL is handled via APIs and MongoDB now

            const effectiveUsername = data.username || cachedUsername || '';
            const name = data.username || cachedUsername || user.displayName || user.email;

            // Update user name in More tab
            const userNameMore = document.getElementById('user-name-more');
            if (userNameMore) {
                userNameMore.textContent = "@" + name;
            }

            // Keep username cached for future visits
            storageSet('psyc_username', name);

            window.updateUserAvatarUI = (avatarUrl, uname) => {
                const initial = (uname || 'A').charAt(0).toUpperCase();

                // Edit Profile Preview
                const epInit = document.getElementById('edit-profile-initial');
                const epImg = document.getElementById('edit-profile-avatar-img');
                if (epInit && epImg) {
                    if (avatarUrl) {
                        epImg.src = avatarUrl;
                        epImg.style.display = 'block';
                        epInit.style.display = 'none';
                    } else {
                        epImg.style.display = 'none';
                        epInit.style.display = 'block';
                        epInit.textContent = initial;
                    }
                }

                // Dashboard Sidebar avatar
                const sbText = document.getElementById('ld-avatar-text');
                const sbImg = document.getElementById('ld-avatar-img');
                if (sbText && sbImg) {
                    if (avatarUrl) {
                        sbImg.src = avatarUrl;
                        sbImg.style.display = 'block';
                        sbText.style.display = 'none';
                    } else {
                        sbImg.style.display = 'none';
                        sbText.style.display = 'block';
                        sbText.textContent = initial;
                    }
                }

                // Sidebar username — always use the app username, not Google display name
                const sbUname = document.getElementById('ld-uname');
                if (sbUname && uname) {
                    sbUname.textContent = uname.startsWith('@') ? uname : '@' + uname;
                }

                // More Tab - Settings avatar
                const avatarLarge = document.getElementById('user-avatar-large');
                if (avatarLarge) {
                    if (avatarUrl) {
                        avatarLarge.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
                    } else {
                        avatarLarge.innerHTML = `<span id="user-avatar-letter-large">${initial}</span>`;
                    }
                }
            };

            // Initial call on load
            window.updateUserAvatarUI(data.user.avatarUrl, name);

            renderMoodGrid();
            renderActivityGrid();
            await loadOrgInfo(user);

            // Ensure today is the default filter state
            selectedFeedDay = new Date();
            updateDayNavigator();

            await loadOrgFeed(user);
            await connectSocket(user);
            await fetchNotifications(user);
            await loadGoals(true); // Load silently for background reminders
            await fetchImportantDaysForCalendar(); // Load for reminders and calendar

            // Load debriefing sessions
            await loadUpcomingDebriefings();
            await loadOngoingDebriefings();
            await loadCompletedSessions();

            // Load mood calendar
            await loadMoodCalendar();

            // Request notification permission on app load
            requestNotificationPermission();
        } catch (err) {
            console.error('Core init error:', err);
            showToast('Something went wrong loading your workspace.', '??');
        }
    });

    // --- Scroll-to-hide Topbar ------------------
    const topBar = document.querySelector('.topbar');
    let lastScrollY = window.scrollY;
    let scrollThreshold = 10;

    if (topBar) {
        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;
            const delta = Math.abs(currentScrollY - lastScrollY);

            if (delta > scrollThreshold) {
                if (currentScrollY > lastScrollY && currentScrollY > 100) {
                    topBar.classList.add('topbar-hidden');
                } else if (currentScrollY < lastScrollY) {
                    topBar.classList.remove('topbar-hidden');
                }
                lastScrollY = currentScrollY;
            }
        }, { passive: true });
    }
});


// --- Month Navigation System ------------------------------------
let viewMonth = new Date();
let availableMonths = [];
let currentCarouselIndex = 0;
let allMonthsData = [];
let maxSelectableIndex = 0;
let carouselRotation = 0;
let touchStartY = 0;
let isDragging = false;
let velocity = 0;
let lastY = 0;
let lastTime = 0;
let animationFrame = null;

// Previous Sessions Month Picker Carousel Variables
let previousSessionsCarouselRotation = 0;
let previousSessionsCurrentIndex = 0;
let previousSessionsMaxSelectableIndex = 0;
let previousSessionsAllMonthsData = [];
let previousSessionsTouchStartY = 0;
let previousSessionsLastY = 0;
let previousSessionsLastTime = 0;
let previousSessionsIsDragging = false;
let previousSessionsVelocity = 0;
let previousSessionsAnimationFrame = null;

function updateMonthHeader() {
    const el = document.getElementById('current-month');
    if (el) {
        const span = el.querySelector('span');
        if (span) {
            const options = { month: 'long', year: 'numeric' };
            const locale = currentLang === 'fil' ? 'fil-PH' : 'en-US';
            span.textContent = viewMonth.toLocaleDateString(locale, options).toUpperCase();
        }
    }
}

function updateMonthNavButtons() {
    // Placeholder function - implement if month navigation buttons exist
    // This prevents errors when called from various places
}

window.navigateMonth = function (dir) {
    if (!viewMonth) viewMonth = new Date();
    viewMonth.setMonth(viewMonth.getMonth() + dir);
    updateMonthHeader();
    if (typeof loadMoodCalendar === 'function') {
        loadMoodCalendar();
    }
}

window.navigateYear = function (dir) {
    if (!viewMonth) viewMonth = new Date();
    viewMonth.setFullYear(viewMonth.getFullYear() + dir);
    updateMonthHeader();
    if (typeof loadMoodCalendar === 'function') {
        loadMoodCalendar();
    }
}

function openMonthPicker() {
    const modal = document.getElementById('month-picker-modal');
    if (!modal) return;

    try {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        renderMonthCarousel3D();

        const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
        if (carouselWrapper) {
            carouselWrapper.addEventListener('touchstart', handleTouchStart, { passive: false });
            carouselWrapper.addEventListener('touchmove', handleTouchMove, { passive: false });
            carouselWrapper.addEventListener('touchend', handleTouchEnd);
            carouselWrapper.addEventListener('mousedown', handleMouseDown);
            carouselWrapper.addEventListener('mousemove', handleMouseMove);
            carouselWrapper.addEventListener('mouseup', handleMouseUp);
            carouselWrapper.addEventListener('mouseleave', handleMouseUp);
            carouselWrapper.addEventListener('wheel', handleWheel, { passive: false });
        }
    } catch (err) {
        console.error('Error opening month picker:', err);
    }
}

function closeMonthPicker() {
    const modal = document.getElementById('month-picker-modal');
    if (!modal) return;

    modal.classList.remove('open');
    document.body.style.overflow = '';

    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
    if (carouselWrapper) {
        carouselWrapper.removeEventListener('touchstart', handleTouchStart);
        carouselWrapper.removeEventListener('touchmove', handleTouchMove);
        carouselWrapper.removeEventListener('touchend', handleTouchEnd);
        carouselWrapper.removeEventListener('mousedown', handleMouseDown);
        carouselWrapper.removeEventListener('mousemove', handleMouseMove);
        carouselWrapper.removeEventListener('mouseup', handleMouseUp);
        carouselWrapper.removeEventListener('mouseleave', handleMouseUp);
        carouselWrapper.removeEventListener('wheel', handleWheel);
    }
}

function handleTouchStart(e) {
    touchStartY = e.touches[0].clientY;
    lastY = touchStartY;
    lastTime = Date.now();
    isDragging = true;
    velocity = 0;

    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
}

function handleTouchMove(e) {
    if (!isDragging) return;
    e.preventDefault();

    const currentY = e.touches[0].clientY;
    const currentTime = Date.now();
    const deltaY = currentY - lastY;
    const deltaTime = currentTime - lastTime;

    if (deltaTime > 0) {
        velocity = deltaY / deltaTime * 16;
    }

    const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const maxRotation = centerOffset;
    const minRotation = -maxSelectableIndex * 80 + centerOffset;
    const newRotation = carouselRotation + deltaY;

    if (newRotation > maxRotation) {
        carouselRotation = maxRotation + (newRotation - maxRotation) * 0.3;
    } else if (newRotation < minRotation) {
        carouselRotation = minRotation + (newRotation - minRotation) * 0.3;
    } else {
        carouselRotation = newRotation;
    }

    lastY = currentY;
    lastTime = currentTime;

    updateCarouselTransform();
}

function handleTouchEnd() {
    isDragging = false;
    applyMomentum();
}

function handleMouseDown(e) {
    touchStartY = e.clientY;
    lastY = touchStartY;
    lastTime = Date.now();
    isDragging = true;
    velocity = 0;

    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
}

function handleMouseMove(e) {
    if (!isDragging) return;

    const currentY = e.clientY;
    const currentTime = Date.now();
    const deltaY = currentY - lastY;
    const deltaTime = currentTime - lastTime;

    if (deltaTime > 0) {
        velocity = deltaY / deltaTime * 16;
    }

    const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const maxRotation = centerOffset;
    const minRotation = -maxSelectableIndex * 80 + centerOffset;
    const newRotation = carouselRotation + deltaY;

    if (newRotation > maxRotation) {
        carouselRotation = maxRotation + (newRotation - maxRotation) * 0.3;
    } else if (newRotation < minRotation) {
        carouselRotation = minRotation + (newRotation - minRotation) * 0.3;
    } else {
        carouselRotation = newRotation;
    }

    lastY = currentY;
    lastTime = currentTime;

    updateCarouselTransform();
}

function handleMouseUp() {
    isDragging = false;
    applyMomentum();
}

function handleWheel(e) {
    if (isDragging) return;
    e.preventDefault();

    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    velocity = e.deltaY > 0 ? -25 : 25;

    const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const maxRotation = centerOffset;
    const minRotation = -maxSelectableIndex * 80 + centerOffset;
    const newRotation = carouselRotation + velocity;

    if (newRotation > maxRotation) {
        carouselRotation = maxRotation + (newRotation - maxRotation) * 0.3;
    } else if (newRotation < minRotation) {
        carouselRotation = minRotation + (newRotation - minRotation) * 0.3;
    } else {
        carouselRotation = newRotation;
    }

    updateCarouselTransform();

    clearTimeout(window.wheelTimeout);
    window.wheelTimeout = setTimeout(() => {
        applyMomentum();
    }, 50);
}

function applyMomentum() {
    const friction = 0.95;
    const minVelocity = 0.1;
    const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const maxRotation = centerOffset;
    const minRotation = -maxSelectableIndex * 80 + centerOffset;

    function animate() {
        if (Math.abs(velocity) < minVelocity) {
            velocity = 0;
            snapToNearest();
            return;
        }

        velocity *= friction;
        const newRotation = carouselRotation + velocity;

        if (newRotation > maxRotation) {
            carouselRotation = maxRotation;
            velocity = 0;
            snapToNearest();
            return;
        } else if (newRotation < minRotation) {
            carouselRotation = minRotation;
            velocity = 0;
            snapToNearest();
            return;
        }

        carouselRotation = newRotation;
        updateCarouselTransform();

        animationFrame = requestAnimationFrame(animate);
    }

    if (Math.abs(velocity) > minVelocity) {
        animate();
    } else {
        snapToNearest();
    }
}

function snapToNearest() {
    const itemHeight = 80;
    const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const targetIndex = Math.round((-carouselRotation + centerOffset) / itemHeight);
    const clampedIndex = Math.max(0, Math.min(maxSelectableIndex, targetIndex));
    const targetRotation = -clampedIndex * itemHeight + centerOffset;

    animateToPosition(targetRotation, () => {
        currentCarouselIndex = clampedIndex;
    });
}

function animateToPosition(target, callback) {
    const start = carouselRotation;
    const distance = target - start;
    const duration = 300;
    const startTime = Date.now();

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        carouselRotation = start + distance * eased;
        updateCarouselTransform();

        if (progress < 1) {
            animationFrame = requestAnimationFrame(animate);
        } else {
            if (callback) callback();
        }
    }

    animate();
}

function updateCarouselTransform() {
    const carousel = document.getElementById('month-carousel-3d');
    if (!carousel) return;

    carousel.style.transform = `translateY(${carouselRotation}px)`;

    const items = carousel.querySelectorAll('.month-carousel-3d-item');
    items.forEach((item, index) => {
        const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
        const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;

        const itemY = index * 80;
        // offset from the center of the viewport/wrapper
        const offset = (itemY + carouselRotation - centerOffset) / 80;
        const distance = Math.abs(offset);
        const scale = Math.max(0.7, 1 - distance * 0.15);
        const opacity = Math.max(0.3, 1 - distance * 0.3);
        const translateZ = -distance * 50;

        item.style.transform = `translateX(-50%) scale(${scale}) translateZ(${translateZ}px)`;
        item.style.opacity = opacity;
        item.style.zIndex = Math.round(100 - distance * 10);

        if (distance < 0.5) {
            item.classList.add('center');
        } else {
            item.classList.remove('center');
        }
    });
}

function renderMonthCarousel3D() {
    const container = document.getElementById('month-carousel-3d');
    if (!container) return;

    const now = new Date();
    const viewMonthKey = `${viewMonth.getFullYear()}-${viewMonth.getMonth()}`;
    const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;

    allMonthsData = [];
    const startYear = now.getFullYear() - 2;
    const endDate = new Date(now);
    endDate.setMonth(now.getMonth() + 5); // Add 5 future months back for visual only
    let year = startYear;
    let month = 0;

    maxSelectableIndex = 0;

    while (year < endDate.getFullYear() || (year === endDate.getFullYear() && month <= endDate.getMonth())) {
        const isFuture = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());

        allMonthsData.push({
            year: year,
            month: month,
            key: `${year}-${month}`,
            isFuture: isFuture
        });

        if (!isFuture) {
            maxSelectableIndex = allMonthsData.length - 1;
        }

        month++;
        if (month > 11) {
            month = 0;
            year++;
        }
    }

    // Center on active view month when opening
    currentCarouselIndex = allMonthsData.findIndex(m => m.key === viewMonthKey);
    if (currentCarouselIndex === -1) {
        currentCarouselIndex = maxSelectableIndex;
    }

    const carouselWrapper = document.querySelector('.month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    carouselRotation = -currentCarouselIndex * 80 + centerOffset;

    container.innerHTML = '';

    allMonthsData.forEach((monthData, index) => {
        const date = new Date(monthData.year, monthData.month, 1);
        const locale = currentLang === 'fil' ? 'fil-PH' : 'en-US';
        const monthName = date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

        const item = document.createElement('div');
        item.className = 'month-carousel-3d-item';
        if (monthData.isFuture) {
            item.classList.add('future-month');
        } else {
            item.onclick = () => selectMonthFromCarousel(monthData.year, monthData.month);
        }
        item.innerHTML = `<div class="month-carousel-3d-item-name">${monthName}</div>`;
        item.style.top = `${index * 80}px`;

        container.appendChild(item);
    });

    updateCarouselTransform();
}

function selectMonthFromCarousel(year, month) {
    viewMonth = new Date(year, month, 1);
    selectedFeedDay = null;

    updateMonthHeader();
    closeMonthPicker();

    if (document.getElementById('tab-calendar')?.classList.contains('active')) {
        renderCalendarGrid();
    }

    if (currentUser) {
        loadOrgFeed(currentUser, true);
    }
}

function selectMonth(year, month) {
    viewMonth = new Date(year, month, 1);
    selectedFeedDay = null;

    updateMonthHeader();
    updateDayNavigator();
    closeMonthPicker();

    if (document.getElementById('tab-calendar')?.classList.contains('active')) {
        renderCalendarGrid();
    }

    if (currentUser) {
        loadOrgFeed(currentUser, true);
    }
}

// --- Day Navigation ---------------------------------------------
// --- Day Navigation (Simple Calendar Pick) ----------------------
function onDateInputChange(val) {
    if (!val) return;
    const [y, m, d] = val.split('-').map(Number);
    selectedFeedDay = new Date(y, m - 1, d);

    // Auto-update the month header if user picks a date from another month
    if (selectedFeedDay.getMonth() !== viewMonth.getMonth() || selectedFeedDay.getFullYear() !== viewMonth.getFullYear()) {
        viewMonth = new Date(y, m - 1, 1);
        updateMonthHeader();
        loadOrgFeed(currentUser, true); // reload organizational feed for new month
    }

    updateDayNavigator();
    renderEntries();
}

function updateDayNavigator() {
    const label = document.getElementById('current-day-label');
    if (!label) return;

    if (!selectedFeedDay) {
        label.textContent = 'TODAY';
    } else {
        const today = new Date();
        const isToday = selectedFeedDay.getDate() === today.getDate() &&
            selectedFeedDay.getMonth() === today.getMonth() &&
            selectedFeedDay.getFullYear() === today.getFullYear();

        if (isToday) {
            label.textContent = 'TODAY';
        } else {
            const options = { day: 'numeric', month: 'short' };
            label.textContent = selectedFeedDay.toLocaleDateString('en-US', options).toUpperCase();
        }
    }
}



function resetDayFilter() {
    selectedFeedDay = new Date(); // Reset to today
    // Sync month if needed
    viewMonth = new Date(selectedFeedDay.getFullYear(), selectedFeedDay.getMonth(), 1);
    updateMonthHeader();
    loadOrgFeed(currentUser, true);

    updateDayNavigator();
    renderEntries();
}




function toggleFabMenu() {
    const menu = document.getElementById('fab-menu-overlay');
    if (!menu) return;
    if (menu.classList.contains('open')) {
        menu.classList.remove('open');
    } else {
        menu.classList.add('open');
    }
}

function closeFabMenu() {
    const menu = document.getElementById('fab-menu-overlay');
    if (menu) menu.classList.remove('open');
}

// Open mood page from the "How are you?" hero
function openMoodPageWithMood(moodKey) {
    // Set the timestamp based on selectedFeedDay
    let targetDate;
    if (selectedFeedDay) {
        // Use the selected day
        targetDate = new Date(selectedFeedDay);
        // Set to current time of that day, or noon if it's a past day
        const now = new Date();
        const isToday = targetDate.getDate() === now.getDate() &&
            targetDate.getMonth() === now.getMonth() &&
            targetDate.getFullYear() === now.getFullYear();

        if (isToday) {
            targetDate = now; // Use current time for today
        } else {
            targetDate.setHours(12, 0, 0, 0); // Use noon for past days
        }
    } else {
        targetDate = new Date(); // Default to now
    }

    const timestamp = targetDate.getTime();

    // Open quick mood selector with the timestamp
    openQuickMoodSelector(timestamp);
}

function openYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0); // Noon
    closeFabMenu();
    openQuickMoodSelector(yesterday.getTime());
}

function openYesterdayEntry() {
    closeFabMenu();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Update state to filter by yesterday
    selectedFeedDay = yesterday;

    // Sync viewMonth if user navigated to a different month
    if (selectedFeedDay.getMonth() !== viewMonth.getMonth() || selectedFeedDay.getFullYear() !== viewMonth.getFullYear()) {
        viewMonth = new Date(selectedFeedDay.getFullYear(), selectedFeedDay.getMonth(), 1);
        updateMonthHeader();
        loadOrgFeed(currentUser, true);
    }

    // Switch to entries tab to see the filtered results (fixed function name)
    switchTab('entries');

    updateDayNavigator();
    renderEntries();
}

function openOtherDayPicker() {
    closeFabMenu();
    // Open the date picker
    const datePicker = document.getElementById('feed-date-picker');
    if (datePicker) {
        datePicker.showPicker();
    }
}

// --- Mood Modal -------------------------------------------------
async function openMoodModal(timestamp = null) {
    console.log('=== openMoodModal called ===');
    console.log('timestamp:', timestamp);
    console.log('pendingMood:', pendingMood);

    selectedPastDate = timestamp || new Date().getTime();
    closeFabMenu(); // Hide menu if we are opening picker

    // Clear selections for a fresh entry
    selectedActivities.clear();
    selectedEmotions.clear();

    const modal = document.getElementById('mood-modal');
    console.log('mood-modal element:', modal);

    // Update selected mood display if coming from quick selector
    if (pendingMood && typeof pendingMood === 'object') {
        const moodDisplay = document.getElementById('selected-mood-display');
        if (moodDisplay) {
            moodDisplay.innerHTML = `
                <span class="selected-mood-emoji">${pendingMood.emoji}</span>
                <span class="selected-mood-label">${pendingMood.label}</span>
            `;
            console.log('Updated mood display in openMoodModal');
        }
    }

    // Render emotion and activity grids with custom data
    console.log('Rendering grids...');
    await renderEmotionGrid();
    await renderActivityGrid();
    console.log('Grids rendered');

    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        console.log('Modal opened successfully');
    } else {
        console.error('mood-modal not found!');
    }
}

function closeMoodModal() {
    const modal = document.getElementById('mood-modal');
    if (modal) {
        // Add closing animation
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        // Wait for animation to complete before removing
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }

    // Reset selections
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
    selectedActivities.clear();
    selectedEmotions.clear();
    pendingMood = null;
    const note = document.getElementById('mood-note');
    if (note) note.value = '';
    setTimeout(() => { selectedPastDate = null; }, 300);
}


// --- Toggle Modal Section ---------------------------------------
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.toggle('collapsed');
    }
}

// --- Quick Mood Selector Functions ------------------------------
const DEFAULT_MOODS = [
    { emoji: "😠", label: "rad", color: "#EF4444" },
    { emoji: "😢", label: "good", color: "#60A5FA" },
    { emoji: "😄", label: "meh", color: "#FACC15" },
    { emoji: "🤢", label: "bad", color: "#4ADE80" },
    { emoji: "😨", label: "awful", color: "#A855F7" }
];

function openQuickMoodSelector(timestamp = null) {
    selectedPastDate = timestamp;
    // Close FAB menu first
    closeFabMenu();

    const modal = document.getElementById('quick-mood-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        renderQuickMoodGrid();
        updateQuickDateTime();
    }
}

function closeQuickMoodModal() {
    const modal = document.getElementById('quick-mood-modal');
    if (modal) {
        // Add closing animation
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        // Wait for animation to complete before removing
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

// --- New Quick Mood Modal Functions -----------------------------
function openQuickMoodNew() {
    const modal = document.getElementById('quick-mood-modal-new');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeQuickMoodNew() {
    const modal = document.getElementById('quick-mood-modal-new');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

async function selectQuickMood(moodKey) {
    console.log('?? Quick mood selected:', moodKey);

    // Use current timestamp
    const timestamp = Date.now();

    // Map mood to color and label
    const moodMap = {
        'joy': { color: '#FACC15', label: 'Joy', emoji: '😄' },
        'sadness': { color: '#3B82F6', label: 'Sadness', emoji: '😢' },
        'anger': { color: '#EF4444', label: 'Anger', emoji: '😠' },
        'disgust': { color: '#22C55E', label: 'Disgust', emoji: '🤢' },
        'fear': { color: '#A855F7', label: 'Fear', emoji: '😨' }
    };

    const moodData = moodMap[moodKey] || moodMap['joy'];

    try {
        // Use Socket.IO to emit mood update
        if (typeof socket !== 'undefined' && socket && socket.connected) {
            socket.emit('mood_update', {
                mood: moodKey,
                moodLabel: moodData.label,
                moodEmoji: moodData.emoji,
                moodColor: moodData.color,
                activity: '',
                activities: [],
                emotions: [],
                note: '',
                timestamp: timestamp
            });

            console.log('? Mood logged via socket');
            showToast(`Mood logged: ${moodData.label}`, '?');
            closeQuickMoodNew();

            // Add the new entry to local calendar data for immediate update
            const newEntry = {
                mood: moodKey,
                timestamp: timestamp,
                moodColor: moodData.color,
                moodLabel: moodData.label
            };
            moodCalendarEntries.push(newEntry);
            window.moodCalendarEntries = moodCalendarEntries;

            // Immediately update calendar display
            renderMoodCalendar();

            // Immediately hide the daily check-in banner
            if (typeof updateDailyCheckInBanner === 'function') {
                updateDailyCheckInBanner();
            }

            // Reload calendar from server to ensure sync after a short delay
            setTimeout(async () => {
                await loadMoodCalendar();
                // Update mood-based resources
                if (typeof updateMoodResources === 'function') {
                    updateMoodResources();
                }
            }, 500);

            // Switch to Journal tab to show the calendar
            if (typeof ldTab === 'function') {
                ldTab('journal');
            }
        } else {
            console.error('? Socket not connected');
            showToast('Connection error. Please refresh the page.', '?');
        }
    } catch (err) {
        console.error('? Error logging mood:', err);
        showToast('Error logging mood', '?');
    }
}

window.openQuickMoodNew = openQuickMoodNew;
window.closeQuickMoodNew = closeQuickMoodNew;
window.selectQuickMood = selectQuickMood;

// --- Mood Calendar Functions ------------------------------------
let currentMoodCalendarDate = new Date();
let moodCalendarEntries = [];

async function loadMoodCalendar() {
    try {
        if (!currentUser) return;

        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/user/calendar-logs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            moodCalendarEntries = data.logs || [];
            window.moodCalendarEntries = moodCalendarEntries; // Expose globally for auto filtering
            renderMoodCalendar();

            // Update stats preview
            updateStatsPreview();

            // Update daily check-in banner visibility
            updateDailyCheckInBanner();

            // Auto filter mood-based resources based on latest entries
            if (window.updateMoodResources) {
                window.updateMoodResources();
            }
        }
    } catch (err) {
        console.error('Error loading mood calendar:', err);
    }
}

/**
 * Update the visibility of the daily check-in banner based on whether 
 * the user has already logged a mood today (local time).
 */
function updateDailyCheckInBanner() {
    const banner = document.getElementById('daily-checkin-banner');
    if (!banner) return;

    if (!moodCalendarEntries || moodCalendarEntries.length === 0) {
        banner.style.display = 'flex';
        return;
    }

    // Use local date string to avoid UTC mismatch (Manila vs UTC)
    const todayStr = new Date().toDateString();

    const hasTodayEntry = moodCalendarEntries.some(entry => {
        if (!entry.timestamp) return false;
        // Handle Firestore Timestamp or Date object or ISO string
        const entryDate = entry.timestamp?.toDate?.() || new Date(entry.timestamp);
        return entryDate.toDateString() === todayStr;
    });

    // Hide banner if there's already an entry for today
    banner.style.display = hasTodayEntry ? 'none' : 'flex';
}
window.updateDailyCheckInBanner = updateDailyCheckInBanner;

function renderMoodCalendar() {
    const monthTitle = document.getElementById('mood-calendar-month');
    const grid = document.getElementById('mood-calendar-grid');

    if (!monthTitle || !grid) return;

    const year = currentMoodCalendarDate.getFullYear();
    const month = currentMoodCalendarDate.getMonth();

    // Set month title
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    monthTitle.textContent = `${monthNames[month]} ${year}`;

    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate = today.getDate();

    // Clear grid
    grid.innerHTML = '';

    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.style.padding = '0.5rem';
        grid.appendChild(emptyCell);
    }

    // Add day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const dayDate = new Date(year, month, day);
        dayDate.setHours(0, 0, 0, 0); // Reset to start of day
        const todayStart = new Date(today);
        todayStart.setHours(0, 0, 0, 0);

        // Find mood entry for this day
        const entry = moodCalendarEntries.find(e => {
            const entryDate = new Date(e.timestamp);
            return entryDate.getFullYear() === year &&
                entryDate.getMonth() === month &&
                entryDate.getDate() === day;
        });

        const isToday = isCurrentMonth && day === todayDate;
        const isPast = dayDate < todayStart;
        const isFuture = dayDate > todayStart;

        const dayCell = document.createElement('div');
        dayCell.style.cssText = `
            position: relative;
            padding: 0.5rem;
            cursor: ${isToday && !entry ? 'pointer' : 'default'};
            border-radius: 8px;
            transition: all 0.2s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.25rem;
            opacity: ${isFuture ? '0.4' : '1'};
        `;

        // Only allow clicking on today if no entry exists
        if (isToday && !entry) {
            dayCell.onclick = () => openQuickMoodForDate(year, month, day);
        }

        if (entry) {
            // Show mood icon with date below
            const moodSVG = getMoodSVG(entry.mood);
            dayCell.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; width: 100%; aspect-ratio: 1; max-width: 48px;">${moodSVG}</div>
                <div style="font-size: clamp(0.65rem, 1.8vw, 0.75rem); font-weight: 600; color: ${isToday ? '#3b82f6' : '#64748b'};">${day}</div>
            `;
        } else if (isToday) {
            // Today without entry - show + icon (can add)
            dayCell.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; width: 100%; aspect-ratio: 1; max-width: 48px; background: #f1f5f9; border-radius: 8px; border: 2px solid #3b82f6;">
                    <i class="bi bi-plus" style="font-size: clamp(1rem, 2.5vw, 1.2rem); color: #3b82f6;"></i>
                </div>
                <div style="font-size: clamp(0.65rem, 1.8vw, 0.75rem); font-weight: 600; color: #3b82f6;">${day}</div>
            `;
        } else if (isPast) {
            // Past day without entry - show X icon (missed)
            dayCell.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; width: 100%; aspect-ratio: 1; max-width: 48px; background: #fef2f2; border-radius: 8px;">
                    <i class="bi bi-x" style="font-size: clamp(1.2rem, 3vw, 1.5rem); color: #ef4444;"></i>
                </div>
                <div style="font-size: clamp(0.65rem, 1.8vw, 0.75rem); font-weight: 600; color: #94a3b8;">${day}</div>
            `;
        } else {
            // Future day - show empty (no icon)
            dayCell.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; width: 100%; aspect-ratio: 1; max-width: 48px; background: transparent; border-radius: 8px;">
                </div>
                <div style="font-size: clamp(0.65rem, 1.8vw, 0.75rem); font-weight: 600; color: #cbd5e1;">${day}</div>
            `;
        }

        // Only add hover effect for today without entry
        if (isToday && !entry) {
            dayCell.onmouseenter = () => {
                dayCell.style.background = '#f8fafc';
                dayCell.style.transform = 'scale(1.05)';
            };
            dayCell.onmouseleave = () => {
                dayCell.style.background = 'transparent';
                dayCell.style.transform = 'scale(1)';
            };
        }

        grid.appendChild(dayCell);
    }

    // Update navigation button states
    updateCalendarNavigation();
}

function getMoodSVG(mood) {
    // Normalize old keys to new Inside Out keys
    const keyMap = { 'rad': 'anger', 'good': 'sadness', 'meh': 'joy', 'sad': 'disgust', 'awful': 'fear', 'bad': 'disgust' };
    const key = keyMap[mood] || mood;

    const svgs = {
        'joy': `<svg class="joy" viewBox="0 0 100 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="max-width:48px;max-height:58px;overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#A16207"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#FACC15"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <text x="18" y="62" font-size="10" opacity="0.7">✦</text>
            <text x="72" y="62" font-size="10" opacity="0.7">✦</text>
            <path d="M 28 45 Q 34 35 40 45" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M 60 45 Q 66 35 72 45" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <circle cx="24" cy="54" r="5" fill="#F59E0B" opacity="0.5"/>
            <circle cx="76" cy="54" r="5" fill="#F59E0B" opacity="0.5"/>
            <path d="M 30 62 Q 50 80 70 62" stroke="#1F2937" stroke-width="5" stroke-linecap="round" fill="none"/>
        </svg>`,
        'sadness': `<svg class="sadness" viewBox="0 0 100 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="max-width:48px;max-height:58px;overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#1D4ED8"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#60A5FA"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M 28 42 Q 34 50 40 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M 60 42 Q 66 50 72 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M 26 36 L 42 40" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>
            <path d="M 74 36 L 58 40" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>
            <path class="tears" d="M 34 52 L 34 72" stroke="#93C5FD" stroke-width="4" stroke-linecap="round" stroke-dasharray="4 8"/>
            <path class="tears" d="M 66 52 L 66 72" stroke="#93C5FD" stroke-width="4" stroke-linecap="round" stroke-dasharray="4 8"/>
            <path d="M 34 76 Q 50 64 66 76" stroke="#1F2937" stroke-width="5" stroke-linecap="round" fill="none"/>
        </svg>`,
        'anger': `<svg class="anger" viewBox="0 0 100 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="max-width:48px;max-height:58px;overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#B91C1C"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#EF4444"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M 26 36 L 44 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round"/>
            <path d="M 74 36 L 56 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round"/>
            <circle cx="34" cy="48" r="4.5" fill="#1F2937"/>
            <circle cx="66" cy="48" r="4.5" fill="#1F2937"/>
            <line x1="40" y1="8" x2="40" y2="1" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="50" y1="6" x2="50" y2="0" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="60" y1="8" x2="60" y2="1" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <rect x="32" y="64" width="36" height="12" rx="4" fill="white" stroke="#1F2937" stroke-width="2"/>
            <line x1="32" y1="68" x2="68" y2="68" stroke="#1F2937" stroke-width="1.5" opacity="0.5"/>
            <line x1="32" y1="72" x2="68" y2="72" stroke="#1F2937" stroke-width="1.5" opacity="0.3"/>
        </svg>`,
        'disgust': `<svg class="disgust" viewBox="0 0 100 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="max-width:48px;max-height:58px;overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#166534"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#4ADE80"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M 25 38 Q 34 34 40 39" stroke="#1F2937" stroke-width="3.5" stroke-linecap="round" fill="none"/>
            <path d="M 75 38 Q 66 34 60 39" stroke="#1F2937" stroke-width="3.5" stroke-linecap="round" fill="none"/>
            <path d="M 26 49 Q 34 54 42 49" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
            <path d="M 58 49 Q 66 54 74 49" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
            <path d="M 26 49 Q 34 44 42 49" stroke="#1F2937" stroke-width="2.5" stroke-linecap="round" fill="none"/>
            <path d="M 58 49 Q 66 44 74 49" stroke="#1F2937" stroke-width="2.5" stroke-linecap="round" fill="none"/>
            <path d="M 34 64 Q 34 58 50 58 Q 66 58 66 64 Q 66 76 50 76 Q 34 76 34 64 Z" fill="#14532D" stroke="#1F2937" stroke-width="1.5"/>
            <g class="puke-stream" style="transform-origin:50px 76px;">
                <line class="puke-fall" x1="44" y1="76" x2="44" y2="115" stroke="#16A34A" stroke-width="4" stroke-linecap="round"/>
                <line class="puke-fall" x1="50" y1="76" x2="50" y2="118" stroke="#4ADE80" stroke-width="4" stroke-linecap="round" style="animation-delay:0.1s"/>
                <line class="puke-fall" x1="56" y1="76" x2="56" y2="115" stroke="#16A34A" stroke-width="4" stroke-linecap="round" style="animation-delay:0.2s"/>
            </g>
        </svg>`,
        'fear': `<svg class="fear" viewBox="0 0 100 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="max-width:48px;max-height:58px;overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#6B21A8"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#A855F7"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M 22 28 Q 33 20 42 27" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M 58 27 Q 67 20 78 28" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <ellipse cx="34" cy="47" rx="10" ry="11" fill="white" stroke="#1F2937" stroke-width="1.5"/>
            <ellipse cx="66" cy="47" rx="10" ry="11" fill="white" stroke="#1F2937" stroke-width="1.5"/>
            <circle cx="34" cy="41" r="4" fill="#1F2937"/>
            <circle cx="66" cy="41" r="4" fill="#1F2937"/>
            <circle cx="36" cy="39" r="1.5" fill="white"/>
            <circle cx="68" cy="39" r="1.5" fill="white"/>
            <path d="M 84 38 Q 87 33 84 30 Q 81 33 84 38 Z" fill="#C4B5FD"/>
            <path d="M 32 68 Q 34 62 50 62 Q 66 62 68 68 Q 66 82 50 82 Q 34 82 32 68 Z" fill="#1F2937"/>
            <rect x="35" y="62" width="8" height="5" rx="1" fill="white"/>
            <rect x="45" y="61" width="10" height="6" rx="1" fill="white"/>
            <rect x="57" y="62" width="8" height="5" rx="1" fill="white"/>
            <ellipse cx="50" cy="76" rx="9" ry="4" fill="#EC4899"/>
        </svg>`
    };

    return svgs[key] || svgs['joy'];
}

// Full animated Inside Out SVGs for mood picker UI
function getMoodAnimatedSVG(moodKey, size = 56) {
    const animClass = {
        'rad': 'mood-svg-anger',
        'good': 'mood-svg-sadness',
        'meh': 'mood-svg-joy',
        'bad': 'mood-svg-disgust',
        'awful': 'mood-svg-fear',
    };
    const cls = animClass[moodKey] || 'mood-svg-joy';
    const svgs = {
        // ANGER - Red (key: rad)
        'rad': `<svg class="${cls}" viewBox="0 0 100 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#B91C1C"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#EF4444"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M 26 36 L 44 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round"/>
            <path d="M 74 36 L 56 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round"/>
            <circle cx="34" cy="48" r="4.5" fill="#1F2937"/>
            <circle cx="66" cy="48" r="4.5" fill="#1F2937"/>
            <line x1="40" y1="8" x2="40" y2="1" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="50" y1="6" x2="50" y2="0" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="60" y1="8" x2="60" y2="1" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <rect x="32" y="64" width="36" height="12" rx="4" fill="white" stroke="#1F2937" stroke-width="2"/>
            <line x1="32" y1="68" x2="68" y2="68" stroke="#1F2937" stroke-width="1.5" opacity="0.5"/>
            <line x1="32" y1="72" x2="68" y2="72" stroke="#1F2937" stroke-width="1.5" opacity="0.3"/>
        </svg>`,
        // SADNESS - Blue (key: good)
        'good': `<svg class="${cls}" viewBox="0 0 100 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#1D4ED8"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#60A5FA"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M 28 42 Q 34 50 40 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M 60 42 Q 66 50 72 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M 26 36 L 42 40" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>
            <path d="M 74 36 L 58 40" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>
            <path class="tears" d="M 34 52 L 34 72" stroke="#93C5FD" stroke-width="4" stroke-linecap="round" stroke-dasharray="4 8"/>
            <path class="tears" d="M 66 52 L 66 72" stroke="#93C5FD" stroke-width="4" stroke-linecap="round" stroke-dasharray="4 8"/>
            <path d="M 34 76 Q 50 64 66 76" stroke="#1F2937" stroke-width="5" stroke-linecap="round" fill="none"/>
        </svg>`,
        // JOY - Yellow (key: meh)
        'meh': `<svg class="${cls}" viewBox="0 0 100 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#A16207"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#FACC15"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <text x="18" y="62" font-size="10" opacity="0.7">✦</text>
            <text x="72" y="62" font-size="10" opacity="0.7">✦</text>
            <path d="M 28 45 Q 34 35 40 45" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M 60 45 Q 66 35 72 45" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <circle cx="24" cy="54" r="5" fill="#F59E0B" opacity="0.5"/>
            <circle cx="76" cy="54" r="5" fill="#F59E0B" opacity="0.5"/>
            <path d="M 30 62 Q 50 80 70 62" stroke="#1F2937" stroke-width="5" stroke-linecap="round" fill="none"/>
        </svg>`,
        // DISGUST - Green (key: bad)
        'bad': `<svg class="${cls}" viewBox="0 0 100 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#166534"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#4ADE80"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M 25 38 Q 34 34 40 39" stroke="#1F2937" stroke-width="3.5" stroke-linecap="round" fill="none"/>
            <path d="M 75 38 Q 66 34 60 39" stroke="#1F2937" stroke-width="3.5" stroke-linecap="round" fill="none"/>
            <path d="M 26 49 Q 34 54 42 49" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
            <path d="M 58 49 Q 66 54 74 49" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
            <path d="M 26 49 Q 34 44 42 49" stroke="#1F2937" stroke-width="2.5" stroke-linecap="round" fill="none"/>
            <path d="M 58 49 Q 66 44 74 49" stroke="#1F2937" stroke-width="2.5" stroke-linecap="round" fill="none"/>
            <path d="M 34 64 Q 34 58 50 58 Q 66 58 66 64 Q 66 76 50 76 Q 34 76 34 64 Z" fill="#14532D" stroke="#1F2937" stroke-width="1.5"/>
            <g class="puke-stream" style="transform-origin: 50px 76px;">
                <line class="puke-fall" x1="44" y1="76" x2="44" y2="115" stroke="#16A34A" stroke-width="4" stroke-linecap="round"/>
                <line class="puke-fall" x1="50" y1="76" x2="50" y2="118" stroke="#4ADE80" stroke-width="4" stroke-linecap="round" style="animation-delay:0.1s"/>
                <line class="puke-fall" x1="56" y1="76" x2="56" y2="115" stroke="#16A34A" stroke-width="4" stroke-linecap="round" style="animation-delay:0.2s"/>
            </g>
        </svg>`,
        // FEAR - Purple (key: awful)
        'awful': `<svg class="${cls}" viewBox="0 0 100 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#6B21A8"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#A855F7"/>
            <path d="M 20 25 Q 50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M 22 28 Q 33 20 42 27" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M 58 27 Q 67 20 78 28" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <ellipse cx="34" cy="47" rx="10" ry="11" fill="white" stroke="#1F2937" stroke-width="1.5"/>
            <ellipse cx="66" cy="47" rx="10" ry="11" fill="white" stroke="#1F2937" stroke-width="1.5"/>
            <circle cx="34" cy="41" r="4" fill="#1F2937"/>
            <circle cx="66" cy="41" r="4" fill="#1F2937"/>
            <circle cx="36" cy="39" r="1.5" fill="white"/>
            <circle cx="68" cy="39" r="1.5" fill="white"/>
            <path d="M 84 38 Q 87 33 84 30 Q 81 33 84 38 Z" fill="#C4B5FD"/>
            <path d="M 32 68 Q 34 62 50 62 Q 66 62 68 68 Q 66 82 50 82 Q 34 82 32 68 Z" fill="#1F2937"/>
            <rect x="35" y="62" width="8" height="5" rx="1" fill="white"/>
            <rect x="45" y="61" width="10" height="6" rx="1" fill="white"/>
            <rect x="57" y="62" width="8" height="5" rx="1" fill="white"/>
            <ellipse cx="50" cy="76" rx="9" ry="4" fill="#EC4899"/>
        </svg>`,
    };
    return svgs[moodKey] || svgs['meh'];
}

function openQuickMoodForDate(year, month, day) {
    // Simply open the modal - user will log mood for current time
    // (We removed date/time pickers, so this just opens the modal)
    openQuickMoodNew();
}

function prevMonthMood() {
    currentMoodCalendarDate.setMonth(currentMoodCalendarDate.getMonth() - 1);
    renderMoodCalendar();
}

function nextMonthMood() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const calendarYear = currentMoodCalendarDate.getFullYear();
    const calendarMonth = currentMoodCalendarDate.getMonth();

    // Don't allow going to future months
    if (calendarYear > currentYear || (calendarYear === currentYear && calendarMonth >= currentMonth)) {
        return;
    }

    currentMoodCalendarDate.setMonth(currentMoodCalendarDate.getMonth() + 1);
    renderMoodCalendar();
}

function updateCalendarNavigation() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const calendarYear = currentMoodCalendarDate.getFullYear();
    const calendarMonth = currentMoodCalendarDate.getMonth();

    const nextBtn = document.getElementById('mood-calendar-next-btn');
    if (nextBtn) {
        // Disable next button if we're at current month
        if (calendarYear >= currentYear && calendarMonth >= currentMonth) {
            nextBtn.style.opacity = '0.3';
            nextBtn.style.cursor = 'not-allowed';
            nextBtn.disabled = true;
        } else {
            nextBtn.style.opacity = '1';
            nextBtn.style.cursor = 'pointer';
            nextBtn.disabled = false;
        }
    }
}

// Make calendar functions globally available
window.loadMoodCalendar = loadMoodCalendar;
window.prevMonthMood = prevMonthMood;
window.nextMonthMood = nextMonthMood;

window.loadMoodCalendar = loadMoodCalendar;
window.renderMoodCalendar = renderMoodCalendar;
window.prevMonthMood = prevMonthMood;
window.nextMonthMood = nextMonthMood;


// --- Day Details Modal ---------------------------------------
function openDayDetails(timestamp) {
    const d = new Date(timestamp);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();

    // Filter personalEntries for this day
    const entries = personalEntries.filter(e => e.uid === currentUser?.uid && e.timestamp >= dayStart && e.timestamp <= dayEnd);

    // Get important days for this date
    // Normalize date string to match YYYY-MM-DD
    const dateStr = d.toISOString().split('T')[0];
    const impDays = typeof getImportantDaysForDate === 'function' ? getImportantDaysForDate(dateStr) : [];

    // Sort entries by timestamp descending
    entries.sort((a, b) => b.timestamp - a.timestamp);

    const modal = document.getElementById('day-details-modal');
    const subtitle = document.getElementById('day-details-subtitle');
    const list = document.getElementById('day-entries-list');
    const addBtn = document.getElementById('add-more-btn');

    if (subtitle) {
        const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        subtitle.textContent = d.toLocaleDateString('en-US', options);
    }

    if (list) {
        if (entries.length === 0 && impDays.length === 0) {
            list.innerHTML = `<div style="text-align: center; color: var(--d-muted); padding: 20px;">No entries for this day.</div>`;
        } else {
            let html = '';

            // Render Important Days first
            if (impDays && impDays.length > 0) {
                html += impDays.map(day => {
                    const emoji = day.emoji || '?';
                    const color = day.color || '#6366f1';
                    return `
                        <div class="day-entry-mini-card imp-day-mini-card" style="border-left: 4px solid ${color};">
                            <div class="mini-card-mood" style="background: ${color}20; color: ${color};">
                                <span>${emoji}</span>
                            </div>
                            <div class="mini-card-info">
                                <span class="mini-card-time">EVENT</span>
                                <span class="mini-card-label" style="color: ${color}; font-weight: 700;">${escapeHtml(day.title)}</span>
                                ${day.notes ? `<span class="mini-card-note">${escapeHtml(day.notes)}</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }

            // Render Mood Entries
            html += entries.map(e => {
                const timeStr = new Date(e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                return `
                    <div class="day-entry-mini-card">
                        <div class="mini-card-mood" style="background: ${e.moodColor};">
                            <span>${e.moodEmoji}</span>
                        </div>
                        <div class="mini-card-info">
                            <span class="mini-card-time">${timeStr}</span>
                            <span class="mini-card-label" style="color: ${e.moodColor};">${e.moodLabel}</span>
                        </div>
                        <div class="mini-card-actions">
                            <i class="bi bi-chevron-right"></i>
                        </div>
                    </div>
                `;
            }).join('');

            list.innerHTML = html;
        }
    }

    if (addBtn) {
        addBtn.onclick = () => {
            closeDayDetails();
            // Use midday for past adds unless it's today
            let addTime = dayStart + (12 * 60 * 60 * 1000);
            const now = new Date().getTime();
            if (now >= dayStart && now <= dayEnd) addTime = now;

            openQuickMoodSelector(addTime);
        };
    }

    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeDayDetails() {
    const modal = document.getElementById('day-details-modal');
    if (modal) {
        // Add closing animation
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        // Wait for animation to complete before removing
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

// --- Goals Modal Functions --------------------------------------
let selectedGoalType = 'personal';
let currentGoalsFilter = 'personal';
let editingGoalId = null;
let goalsRefreshInterval = null;

function openGoalsModal() {
    closeFabMenu();

    // Request notification permission on first open
    if (Notification.permission === "default") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                console.log('? Notification permission granted');
            }
        });
    }

    const modal = document.getElementById('goals-modal');
    if (modal) {
        // Show list view, hide form
        document.getElementById('goals-list-view').style.display = 'block';
        document.getElementById('goal-form-view').style.display = 'none';
        document.getElementById('goals-add-btn').innerHTML = '<i class="bi bi-plus-lg"></i>';

        // Load all goals for the user/org to ensure reminders engine has the full list
        loadGoals();

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeGoalsModal() {
    const modal = document.getElementById('goals-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
            editingGoalId = null;
        }, 300);
    }
}

function showGoalForm(goalId = null) {
    console.log('?? showGoalForm called, goalId:', goalId);

    document.getElementById('goals-list-view').style.display = 'none';
    document.getElementById('goal-form-view').style.display = 'block';
    document.getElementById('goals-add-btn').innerHTML = '<i class="bi bi-arrow-left"></i>';
    document.getElementById('goals-add-btn').onclick = hideGoalForm;

    if (goalId) {
        // EDIT MODE
        console.log('?? EDIT MODE');
        editingGoalId = goalId;
        const goal = goalsList.find(g => g.id === goalId);
        if (goal) {
            document.getElementById('goal-title').value = goal.title;
            document.getElementById('goal-description').value = goal.description || '';

            // Handle new format
            if (goal.reminderFrequency) {
                document.getElementById('goal-reminder-frequency').value = goal.reminderFrequency || '';
                document.getElementById('goal-reminder-time').value = goal.reminderTime || '';

                // Show/hide custom days based on frequency
                toggleCustomDays();

                // Set custom days checkboxes
                if (goal.reminderFrequency === 'custom' && goal.reminderDays) {
                    document.querySelectorAll('#custom-days-group input[type="checkbox"]').forEach(cb => {
                        cb.checked = goal.reminderDays.includes(parseInt(cb.value));
                    });
                }
            }
            // Handle old format (reminderDateTime) - leave empty so user can set new format
            else if (goal.reminderDateTime) {
                document.getElementById('goal-reminder-frequency').value = '';
                document.getElementById('goal-reminder-time').value = '';
            }

            selectedGoalType = goal.type || 'personal';

            // Update type buttons
            document.querySelectorAll('.goal-type-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.type === selectedGoalType) {
                    btn.classList.add('active');
                }
            });
        }
    } else {
        // CREATE MODE - RESET EVERYTHING
        console.log('? CREATE MODE - Resetting form');
        editingGoalId = null;

        // Clear all inputs
        document.getElementById('goal-title').value = '';
        document.getElementById('goal-description').value = '';
        document.getElementById('goal-reminder-frequency').value = '';
        document.getElementById('goal-reminder-time').value = '';

        // Clear custom days checkboxes
        document.querySelectorAll('#custom-days-group input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });

        // Hide custom days and time
        document.getElementById('custom-days-group').style.display = 'none';
        document.getElementById('reminder-time-group').style.display = 'none';

        // Reset to defaults
        selectedGoalType = 'personal';

        // Reset type buttons
        document.querySelectorAll('.goal-type-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.type === 'personal') {
                btn.classList.add('active');
            }
        });

        console.log('? Form reset complete');
    }
}

function toggleCustomDays() {
    const frequency = document.getElementById('goal-reminder-frequency').value;
    const customDaysGroup = document.getElementById('custom-days-group');
    const reminderTimeGroup = document.getElementById('reminder-time-group');

    if (frequency === 'custom') {
        customDaysGroup.style.display = 'block';
        reminderTimeGroup.style.display = 'block';
    } else if (frequency === 'daily') {
        customDaysGroup.style.display = 'none';
        reminderTimeGroup.style.display = 'block';
    } else {
        customDaysGroup.style.display = 'none';
        reminderTimeGroup.style.display = 'none';
    }
}

function hideGoalForm() {
    document.getElementById('goals-list-view').style.display = 'block';
    document.getElementById('goal-form-view').style.display = 'none';
    document.getElementById('goals-add-btn').innerHTML = '<i class="bi bi-plus-lg"></i>';
    document.getElementById('goals-add-btn').onclick = () => showGoalForm(null);
    editingGoalId = null;

    // Clear form
    document.getElementById('goal-title').value = '';
    document.getElementById('goal-description').value = '';
    document.getElementById('goal-reminder-frequency').value = '';
    document.getElementById('goal-reminder-time').value = '';

    // Clear custom days checkboxes
    document.querySelectorAll('#custom-days-group input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });

    // Hide custom days and time
    document.getElementById('custom-days-group').style.display = 'none';
    document.getElementById('reminder-time-group').style.display = 'none';
}

function filterGoals(type) {
    currentGoalsFilter = type;

    // Update tab active state
    document.querySelectorAll('.goals-filter-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.filter === type) {
            tab.classList.add('active');
        }
    });

    // Reload goals for the new filter
    loadGoals();
}

async function loadGoals(silent = false) {
    try {
        if (!silent) {
            console.log('?? Loading goals...');
        }

        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        const res = await fetch(SERVER_URL + `/api/goals/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            const newGoals = data.goals || [];

            // Check if there are new goals
            const hasNewGoals = newGoals.length > goalsList.length;

            goalsList = newGoals;
            renderGoalsList();

            // Start the real-time notification engine
            startGoalNotificationEngine();

            if (!silent && hasNewGoals && currentGoalsFilter === 'team') {
                console.log('? New team goals detected!');
            }
        } else {
            if (!silent) {
                showToast('Failed to load goals', '??');
            }
        }
    } catch (err) {
        console.error('Error loading goals:', err);
        if (!silent) {
            showToast('Error loading goals', '??');
        }
    }
}

function renderGoalsList() {
    const container = document.getElementById('goals-list-container');
    if (!container) return;

    // Filter goals by current filter
    const filteredGoals = goalsList.filter(goal => {
        if (currentGoalsFilter === 'personal') {
            return goal.userId === currentUser.uid && goal.type === 'personal';
        } else {
            return goal.type === 'team';
        }
    });

    console.log('?? Rendering goals:', filteredGoals.length);
    if (filteredGoals.length > 0) {
        console.log('?? First goal data:', filteredGoals[0]);
    }

    if (filteredGoals.length === 0) {
        container.innerHTML = `
            <div class="goals-empty">
                <i class="bi bi-bullseye"></i>
                <p>No ${currentGoalsFilter} goals yet.<br>Click + to create one!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filteredGoals.map((goal, index) => {
        // Get this user's notification settings
        const userSettings = goal.userNotificationSettings?.[currentUser.uid] || {};

        // Only consider new format as having reminder (old format needs to be updated)
        const hasReminder = goal.reminderFrequency && goal.reminderTime;
        const notifEnabled = userSettings.enabled !== false && hasReminder;
        const notifInfo = getNotificationInfoFromGoal(goal);
        const isOwner = goal.userId === currentUser.uid;
        const animationDelay = (index * 0.05) + 's';

        const title = goal.title || 'Untitled Goal';
        const description = goal.description || '';
        const type = goal.type || 'personal';

        return `
        <div class="goal-item" style="animation: slideUpFade 0.4s ease forwards; animation-delay: ${animationDelay}; opacity: 0;">
            ${isOwner && hasReminder ? `
            <div class="goal-notif-bell ${notifEnabled ? 'active' : ''}" onclick="toggleGoalNotifications('${goal.id}', ${!notifEnabled})" title="Toggle Notifications">
                <i class="bi ${notifEnabled ? 'bi-bell-fill' : 'bi-bell-slash'}"></i>
            </div>
            ` : '<div style="width: 32px;"></div>'}
            <div class="goal-content">
                <div class="goal-title">${title}</div>
                ${description ? `<div class="goal-description">${description}</div>` : '<div class="goal-description" style="color: #94a3b8; font-style: italic;">No description</div>'}
                ${isOwner ? `
                <div class="goal-notif-info">
                    <i class="bi ${hasReminder ? (notifEnabled ? 'bi-bell-fill' : 'bi-bell-slash') : 'bi-bell-slash'}"></i> ${notifInfo}
                </div>
                ` : ''}
            </div>
            ${isOwner ? `
            <div class="goal-menu-btn" onclick="toggleGoalMenu(event, '${goal.id}')">
                <i class="bi bi-three-dots-vertical"></i>
                <div class="goal-menu-dropdown" id="goal-menu-${goal.id}">
                    <div class="goal-menu-item" onclick="editGoal('${goal.id}')">
                        <i class="bi bi-pencil"></i>
                        <span>Edit</span>
                    </div>
                    <div class="goal-menu-item delete" onclick="deleteGoal('${goal.id}')">
                        <i class="bi bi-trash"></i>
                        <span>Delete</span>
                    </div>
                </div>
            </div>
            ` : '<div style="width: 32px;"></div>'}
        </div>
    `;
    }).join('');
}

function getNotificationInfoFromGoal(goal) {
    // Handle new format (frequency + days + time)
    if (goal.reminderFrequency && goal.reminderTime) {
        const timeStr = formatTime(goal.reminderTime);

        if (goal.reminderFrequency === 'daily') {
            return `Every day at ${timeStr}`;
        } else if (goal.reminderFrequency === 'custom' && goal.reminderDays && goal.reminderDays.length > 0) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const selectedDays = goal.reminderDays.map(d => dayNames[d]).join(', ');
            return `${selectedDays} at ${timeStr}`;
        }
    }

    // Old format goals - don't show the date, just say "No reminder set"
    // User needs to edit and set new format
    return 'No reminder set';
}

function formatTime(time) {
    if (!time) return '';
    // Convert 24h to 12h format
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
}

function toggleGoalMenu(event, goalId) {
    event.stopPropagation();

    // Close all other menus
    document.querySelectorAll('.goal-menu-dropdown').forEach(menu => {
        if (menu.id !== `goal-menu-${goalId}`) {
            menu.classList.remove('open');
        }
    });

    // Toggle this menu
    const menu = document.getElementById(`goal-menu-${goalId}`);
    if (menu) {
        menu.classList.toggle('open');
    }
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.goal-menu-btn')) {
        document.querySelectorAll('.goal-menu-dropdown').forEach(menu => {
            menu.classList.remove('open');
        });
    }
});

function editGoal(goalId) {
    showGoalForm(goalId);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function toggleGoalNotifications(goalId, enabled) {
    console.log(`?? Toggling notifications for goal ${goalId}: ${enabled}`);

    // If enabling and permission not granted, request it
    if (enabled && 'Notification' in window && Notification.permission !== 'granted') {
        console.log('?? Requesting permission...');
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log('?? Permission denied');
                showToast('Please allow notifications in your browser', '??');
                return;
            }
            console.log('? Permission granted');
        } catch (err) {
            console.error('? Permission error:', err);
            showToast('Error requesting permission', '??');
            return;
        }
    }

    try {
        const token = await currentUser.getIdToken();

        const res = await fetch(SERVER_URL + '/api/goals/toggle-notifications', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ goalId, enabled })
        });

        if (res.ok) {
            // Update local list
            const goal = goalsList.find(g => g.id === goalId);
            if (goal) {
                if (!goal.userNotificationSettings) {
                    goal.userNotificationSettings = {};
                }
                if (!goal.userNotificationSettings[currentUser.uid]) {
                    goal.userNotificationSettings[currentUser.uid] = {};
                }
                goal.userNotificationSettings[currentUser.uid].enabled = enabled;
                renderGoalsList();
                // Re-schedule notifications after toggling
                forceRescheduleGoalNotifications();

                showToast(enabled ? 'Notifications enabled ??' : 'Notifications disabled', enabled ? '?' : '??');
            }
        } else {
            showToast('Failed to update notifications', '??');
        }
    } catch (err) {
        console.error('Error toggling notifications:', err);
        showToast('Error updating notifications', '??');
    }
}

async function deleteGoal(goalId) {
    if (!confirm('Are you sure you want to delete this goal?')) {
        return;
    }

    try {
        const token = await currentUser.getIdToken();

        const res = await fetch(SERVER_URL + '/api/goals/delete', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ goalId })
        });

        if (res.ok) {
            showToast('Goal deleted', '???');
            // Remove from local list
            goalsList = goalsList.filter(g => g.id !== goalId);
            renderGoalsList();
        } else {
            showToast('Failed to delete goal', '??');
        }
    } catch (err) {
        console.error('Error deleting goal:', err);
        showToast('Error deleting goal', '??');
    }
}

function selectGoalType(type) {
    selectedGoalType = type;
    document.querySelectorAll('.goal-type-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        }
    });
}

async function saveGoal() {
    const title = document.getElementById('goal-title').value.trim();
    const description = document.getElementById('goal-description').value.trim();
    const frequency = document.getElementById('goal-reminder-frequency').value;
    const reminderTime = document.getElementById('goal-reminder-time').value;

    console.log('?? Saving goal:', { title, frequency, reminderTime });

    if (!title) {
        showToast('Please enter a goal title', '??');
        return;
    }

    let reminderDays = [];
    if (frequency === 'daily') {
        reminderDays = [0, 1, 2, 3, 4, 5, 6]; // All days
    } else if (frequency === 'custom') {
        const checkboxes = document.querySelectorAll('#custom-days-group input[type="checkbox"]:checked');
        reminderDays = Array.from(checkboxes).map(cb => parseInt(cb.value));

        if (reminderDays.length === 0) {
            showToast('Please select at least one day', '??');
            return;
        }
    }

    if (frequency && !reminderTime) {
        showToast('Please set a reminder time', '??');
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        const goalData = {
            title,
            description,
            type: selectedGoalType,
            orgId,
            reminderFrequency: frequency || null,
            reminderDays: frequency ? reminderDays : [],
            reminderTime: frequency ? reminderTime : null
        };

        console.log('?? Sending to server:', goalData);

        let res;
        if (editingGoalId) {
            res = await fetch(SERVER_URL + '/api/goals/update', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ goalId: editingGoalId, ...goalData })
            });
        } else {
            res = await fetch(SERVER_URL + '/api/goals/create', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(goalData)
            });
        }

        if (res.ok) {
            const result = await res.json();
            console.log('? Server response:', result);
            showToast(editingGoalId ? 'Goal updated!' : 'Goal created!', '??');
            hideGoalForm();
            await loadGoals();
        } else {
            const error = await res.json();
            console.error('? Server error:', error);
            showToast(error.error || 'Failed to save goal', '??');
        }
    } catch (err) {
        console.error('? Save goal error:', err);
        showToast('Error saving goal', '??');
    }
}


// --- Important Days Functions --------------------------------------
let importantDaysList = [];
// allImportantDays defined at top for global access
let currentImportantDayFilter = 'personal';
let currentImportantDayType = 'personal';
let currentEventCategory = 'birthday';
let editingImportantDayId = null;

const EVENT_CATEGORIES = {
    birthday: { emoji: '??', label: 'Birthday', color: '#ec4899' },
    meeting: { emoji: '??', label: 'Meeting', color: '#3b82f6' },
    launch: { emoji: '??', label: 'Launch', color: '#8b5cf6' },
    engagement: { emoji: '??', label: 'Engagement', color: '#10b981' },
    anniversary: { emoji: '??', label: 'Anniversary', color: '#f59e0b' },
    event: { emoji: '?', label: 'Custom', color: '#6366f1' },
};

// Important Day Form - Emoji and Color Selection
let selectedEventEmoji = '??';
let selectedEventColor = '#ec4899';

function selectEventColor(color) {
    selectedEventColor = color;
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === color);
    });
}

function openEventEmojiPicker() {
    // Simple emoji picker - show common emojis
    const commonEmojis = [
        '??', '??', '??', '??', '??', '??', '??', '?',
        '??', '??', '??', '??', '??', '??', '??', '??',
        '??', '??', '??', '??', '??', '???', '??', '??',
        '??', '??', '??', '??', '??', '??', '??', '??',
        '?', '??', '??', '??', '??', '??', '??', '??',
        '??', '??', '??', '??', '??', '??', '??', '??',
        '?', '??', '??', '?', '??', '??', '??', '??',
        '??', '??', '??', '??', '??', '??', '??', '??',
        '?', '??', '??', '??', '??', '??', '??', '??',
        '???????????', '????????', '????????', '??', '??', '??', '??', '??'
    ];

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 20px;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        border-radius: 16px;
        max-width: 400px;
        width: 100%;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    `;

    modal.innerHTML = `
        <div style="padding: 20px 20px 15px 20px; border-bottom: 1px solid #e2e8f0;">
            <h3 style="margin: 0; color: #1e293b;">Choose Emoji</h3>
        </div>
        <div style="padding: 15px 20px; overflow-y: auto; overflow-x: hidden; flex: 1;">
            <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px;">
                ${commonEmojis.map(emoji => `
                    <button onclick="selectEventEmojiAndClose('${emoji}')" style="
                        font-size: 32px;
                        padding: 10px;
                        border: 2px solid transparent;
                        border-radius: 8px;
                        background: #f8fafc;
                        cursor: pointer;
                        transition: all 0.2s;
                        aspect-ratio: 1;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    " onmouseover="this.style.borderColor='#3b82f6'; this.style.transform='scale(1.1)'" 
                       onmouseout="this.style.borderColor='transparent'; this.style.transform='scale(1)'">${emoji}</button>
                `).join('')}
            </div>
        </div>
        <div style="padding: 15px 20px; border-top: 1px solid #e2e8f0;">
            <button onclick="this.closest('div').parentElement.parentElement.remove()" style="
                width: 100%;
                padding: 12px;
                background: #e2e8f0;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
            ">Cancel</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}

// Global function to select emoji and close picker
window.selectEventEmojiAndClose = function (emoji) {
    selectedEventEmoji = emoji;
    console.log('? Emoji selected:', emoji);
    console.log('?? selectedEventEmoji is now:', selectedEventEmoji);
    document.getElementById('selected-event-emoji').textContent = emoji;
    // Remove the picker overlay
    document.querySelectorAll('body > div').forEach(div => {
        if (div.style.position === 'fixed' && div.style.zIndex === '10000') {
            div.remove();
        }
    });
};

function filterImportantDays(type) {
    currentImportantDayFilter = type;
    document.querySelectorAll('.goals-filter-tab[data-id-filter]').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.idFilter === type);
    });
    loadImportantDays();
}

function selectImportantDayType(type) {
    currentImportantDayType = type;
    document.querySelectorAll('.goal-type-btn[data-id-type]').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.idType === type);
    });
}

function openImportantDaysModal() {
    closeFabMenu();
    const modal = document.getElementById('important-days-modal');
    if (modal) {
        document.getElementById('important-days-list-view').style.display = 'block';
        document.getElementById('important-day-form-view').style.display = 'none';
        document.getElementById('important-days-add-btn').innerHTML = '<i class="bi bi-plus-lg"></i>';
        document.getElementById('important-days-add-btn').onclick = showImportantDayForm;
        loadImportantDays();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeImportantDaysModal() {
    const modal = document.getElementById('important-days-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function showImportantDayForm(editDay) {
    document.getElementById('important-days-list-view').style.display = 'none';
    document.getElementById('important-day-form-view').style.display = 'block';
    document.getElementById('important-days-add-btn').innerHTML = '<i class="bi bi-arrow-left"></i>';
    document.getElementById('important-days-add-btn').onclick = hideImportantDayForm;

    const sheetTitle = document.querySelector('#important-days-modal .sheet-title');

    // Check if editDay is actually a day object and NOT a MouseEvent
    const isEditing = editDay && typeof editDay === 'object' && !(editDay instanceof MouseEvent);

    if (isEditing) {
        // Edit mode
        editingImportantDayId = editDay.id;
        if (sheetTitle) sheetTitle.innerHTML = '<span style="color:var(--d-primary); font-weight: 800;">?? Edit Event</span>';

        document.getElementById('important-day-title').value = editDay.title || '';
        document.getElementById('important-day-date').value = editDay.date || '';
        const timeInput = document.getElementById('important-day-time');
        if (timeInput) timeInput.value = editDay.time || '';
        document.getElementById('important-day-notes').value = editDay.notes || '';
        const reminderSelect = document.getElementById('important-day-reminder');
        if (reminderSelect) reminderSelect.value = editDay.reminderBefore || 'none';

        // Set emoji and color
        selectedEventEmoji = editDay.emoji || '??';
        selectedEventColor = editDay.color || '#ec4899';
        document.getElementById('selected-event-emoji').textContent = selectedEventEmoji;
        selectEventColor(selectedEventColor);

        currentImportantDayType = editDay.type || 'personal';

        const saveBtn = document.querySelector('#important-day-form-view .btn-primary');
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="bi bi-check2-circle"></i> Update Event';
            saveBtn.style.background = 'var(--d-primary)';
        }
    } else {
        // Create mode
        editingImportantDayId = null;
        const sheetTitle = document.querySelector('#important-days-modal .sheet-title');
        if (sheetTitle) sheetTitle.innerHTML = '<span style="color:var(--d-primary); font-weight: 800;">? New Event</span>';

        document.getElementById('important-day-title').value = '';
        document.getElementById('important-day-date').value = '';
        const timeInput = document.getElementById('important-day-time');
        if (timeInput) timeInput.value = '';
        document.getElementById('important-day-notes').value = '';
        const reminderSelect = document.getElementById('important-day-reminder');
        if (reminderSelect) reminderSelect.value = 'none';

        // Reset emoji and color to defaults
        selectedEventEmoji = '??';
        selectedEventColor = '#ec4899';
        console.log('?? CREATE MODE - Reset emoji to:', selectedEventEmoji, 'color:', selectedEventColor);
        document.getElementById('selected-event-emoji').textContent = '??';
        selectEventColor('#ec4899');

        currentImportantDayType = 'personal';

        const saveBtn = document.querySelector('#important-day-form-view .btn-primary');
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="bi bi-plus-lg"></i> Save Event';
            saveBtn.style.background = ''; // default
        }
    }

    document.querySelectorAll('.event-cat-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === currentEventCategory);
    });
    document.querySelectorAll('.goal-type-btn[data-id-type]').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.idType === currentImportantDayType);
    });
}

function hideImportantDayForm() {
    editingImportantDayId = null;
    const sheetTitle = document.querySelector('#important-days-modal .sheet-title');
    if (sheetTitle) sheetTitle.textContent = 'Important Days';
    document.getElementById('important-days-list-view').style.display = 'block';
    document.getElementById('important-day-form-view').style.display = 'none';
    document.getElementById('important-days-add-btn').innerHTML = '<i class="bi bi-plus-lg"></i>';
    document.getElementById('important-days-add-btn').onclick = showImportantDayForm;

    // Reset emoji and color to defaults
    selectedEventEmoji = '??';
    selectedEventColor = '#ec4899';
    if (document.getElementById('selected-event-emoji')) {
        document.getElementById('selected-event-emoji').textContent = '??';
    }
    selectEventColor('#ec4899');
}

async function loadImportantDays() {
    const container = document.getElementById('important-days-list-container');
    if (container) {
        container.innerHTML = '<div class="goals-empty" style="opacity:0.5;"><div class="spinner-small"></div><p style="margin-top:8px;">Loading events...</p></div>';
    }
    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId') || '';
        const res = await fetch(SERVER_URL + `/api/important-days/list?orgId=${encodeURIComponent(orgId)}&type=${encodeURIComponent(currentImportantDayFilter)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            importantDaysList = data.days || [];
            console.log('?? Loaded', importantDaysList.length, 'important days');
            if (importantDaysList.length > 0) {
                console.log('?? First day:', importantDaysList[0]);
            }
            // Cache for calendar
            if (currentImportantDayFilter === 'personal') {
                allImportantDays = [...importantDaysList];
            }
            renderImportantDaysList();
            // Schedule notifications for important days
            scheduleImportantDayNotifications();
        } else {
            const errData = await res.json().catch(() => ({}));
            console.error('Load important days error:', errData);
            if (container) {
                container.innerHTML = '<div class="goals-empty"><i class="bi bi-exclamation-triangle" style="color:#f59e0b;font-size:1.5rem;"></i><p>Could not load events.</p></div>';
            }
        }
    } catch (err) {
        console.error('Error loading important days:', err);
        if (container) {
            container.innerHTML = '<div class="goals-empty"><i class="bi bi-wifi-off" style="color:#ef4444;font-size:1.5rem;"></i><p>Network error.</p></div>';
        }
    }
}

// Fetch all important days for calendar markers (called during calendar render)
async function fetchImportantDaysForCalendar() {
    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId') || '';

        // Fetch personal
        const resP = await fetch(SERVER_URL + `/api/important-days/list?orgId=${encodeURIComponent(orgId)}&type=personal`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const dataP = resP.ok ? await resP.json() : { days: [] };

        // Fetch team (if orgId exists)
        let teamDays = [];
        if (orgId) {
            const resT = await fetch(SERVER_URL + `/api/important-days/list?orgId=${encodeURIComponent(orgId)}&type=team`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const dataT = resT.ok ? await resT.json() : { days: [] };
            teamDays = dataT.days || [];
        }

        allImportantDays = [...(dataP.days || []), ...teamDays];
        // Schedule notifications for all important days
        scheduleImportantDayNotifications();

        // Check for today's important days and show notification
        checkTodayImportantDays();
    } catch (e) {
        console.warn('Could not load important days for calendar', e);
    }
}

// Check if there are important days today and show notification (once per day)
function checkTodayImportantDays() {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const todayKey = `imp_day_notif_${todayStr}`;

    // Check if already shown today
    const alreadyShown = localStorage.getItem(todayKey);
    if (alreadyShown === 'true') {
        console.log('?? Important day notification already shown today');
        return;
    }

    // Get today's important days
    const todayImportantDays = getImportantDaysForDate(todayStr);

    if (todayImportantDays.length > 0) {
        console.log('?? Found important days today:', todayImportantDays);

        // Show notification popup
        showImportantDayNotification(todayImportantDays);

        // Mark as shown for today
        localStorage.setItem(todayKey, 'true');
    }
}

// Show important day notification popup
function showImportantDayNotification(importantDays) {
    console.log('?? showImportantDayNotification called with:', importantDays);

    // Save to notification history
    importantDays.forEach(day => {
        saveImportantDayToHistory(day);
    });

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: fadeIn 0.3s;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 16px;
        max-width: 400px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        animation: slideUp 0.3s;
    `;

    // Build content
    let content = `
        <div style="font-size: 60px; margin-bottom: 20px;">
            <i class="bi bi-calendar-event" style="color: #ec4899;"></i>
        </div>
        <h2 style="margin: 10px 0; color: #1e293b;">Important Day${importantDays.length > 1 ? 's' : ''} Today!</h2>
        <p style="font-size: 14px; color: #64748b; margin-bottom: 20px;">
            Don't forget these special events:
        </p>
    `;

    // List all important days
    importantDays.forEach(day => {
        const emoji = day.emoji || '??';
        const color = day.color || '#ec4899';
        const title = day.title || 'Untitled';
        const notes = day.notes || '';

        content += `
            <div style="background: ${color}10; padding: 15px; margin: 10px 0; border-radius: 8px; text-align: left;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                    <span style="font-size: 24px;">${emoji}</span>
                </div>
                <div style="font-size: 18px; font-weight: 700; color: ${color}; margin-bottom: 5px;">
                    ${title}
                </div>
                ${notes ? `<div style="font-size: 14px; color: #64748b;">${notes}</div>` : ''}
            </div>
        `;
    });

    content += `
        <button onclick="this.closest('div').parentElement.remove()" style="
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 20px;
            width: 100%;
        ">Got it!</button>
    `;

    modal.innerHTML = content;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Play sound
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGS57OihUBELTKXh8bllHAU2jdXvzn0pBSh+zPDajzsKElyx6OyrWBUIQ5zd8sFuJAUuhM/z24k2CBhku+zooVARC0yl4fG5ZRwFNo3V7859KQUofsz');
    audio.play().catch(() => { });

    // Auto-close after 10 seconds
    setTimeout(() => {
        if (overlay.parentElement) {
            overlay.remove();
        }
    }, 10000);

    console.log('? Important day popup added to DOM');
}

// Get important days for a specific date string (YYYY-MM-DD)
function getImportantDaysForDate(dateStr) {
    return allImportantDays.filter(d => d.date === dateStr);
}

function renderImportantDaysList() {
    const container = document.getElementById('important-days-list-container');
    if (!container) return;

    if (importantDaysList.length === 0) {
        const emptyMsg = currentImportantDayFilter === 'team'
            ? 'No team events yet.<br>Share an event with your team!'
            : 'No events yet.<br>Tap + to add your first event!';
        container.innerHTML = '<div class="goals-empty"><i class="bi bi-calendar-star" style="font-size:2.5rem;opacity:0.4;"></i><p style="margin-top:8px;">' + emptyMsg + '</p></div>';
        return;
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    container.innerHTML = importantDaysList.map((day, index) => {
        const dateObj = new Date(day.date + 'T00:00:00');
        const monthStr = dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const dayNum = dateObj.getDate();
        const animationDelay = (index * 0.06) + 's';

        // Use emoji and color from day object (new format) or fallback to category (old format)
        let emoji = '??'; // default
        let color = '#ec4899'; // default

        if (day.emoji && day.color) {
            // New format - use emoji and color directly
            emoji = day.emoji;
            color = day.color;
        } else if (day.category && EVENT_CATEGORIES[day.category]) {
            // Old format - use category emoji and color
            emoji = EVENT_CATEGORIES[day.category].emoji;
            color = EVENT_CATEGORIES[day.category].color;
        }

        const diffTime = dateObj.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        let countdown = '';
        if (diffDays === 0) countdown = '<span class="event-countdown event-countdown-today">?? Today!</span>';
        else if (diffDays === 1) countdown = '<span class="event-countdown event-countdown-soon">Tomorrow</span>';
        else if (diffDays > 1 && diffDays <= 7) countdown = '<span class="event-countdown event-countdown-soon">' + diffDays + ' days away</span>';
        else if (diffDays > 7) countdown = '<span class="event-countdown">' + diffDays + ' days away</span>';
        else countdown = '<span class="event-countdown event-countdown-past">' + Math.abs(diffDays) + ' days ago</span>';

        // Time display
        let timeDisplay = '';
        if (day.time) {
            timeDisplay = '<span class="event-card-time"><i class="bi bi-clock"></i> ' + formatTime(day.time) + '</span>';
        }

        // Reminder badge
        let reminderBadge = '';
        if (day.reminderBefore && day.reminderBefore !== 'none') {
            const reminderLabels = {
                'at_time': 'At event time',
                '15min': '15 min before',
                '30min': '30 min before',
                '1hour': '1 hour before',
                '1day': '1 day before',
                '1week': '1 week before'
            };
            reminderBadge = '<span class="event-reminder-badge"><i class="bi bi-bell-fill"></i> ' + (reminderLabels[day.reminderBefore] || day.reminderBefore) + '</span>';
        }

        let teamBadge = '';
        if (day.type === 'team' && day.userName) {
            teamBadge = '<div class="event-card-author"><i class="bi bi-person-fill"></i> ' + escapeHtml(day.userName) + '</div>';
        }

        const dayData = JSON.stringify(day).replace(/'/g, "\\'").replace(/"/g, '&quot;');

        return '<div class="event-card" style="animation:slideUpFade 0.4s ease forwards;animation-delay:' + animationDelay + ';opacity:0;">' +
            '<div class="event-card-icon-area">' +
            '<div class="event-card-emoji">' + emoji + '</div>' +
            '<div class="event-card-date">' +
            '<span class="event-card-month">' + monthStr + '</span>' +
            '<span class="event-card-day">' + dayNum + '</span>' +
            '</div>' +
            '</div>' +
            '<div class="event-card-body">' +
            '<div class="event-card-header">' +
            '<div class="event-card-title" style="color:' + color + '; font-weight: 700; background: ' + color + '15; padding: 4px 8px; border-radius: 6px; display: inline-block;">' + escapeHtml(day.title) + '</div>' +
            '<div class="event-card-actions">' +
            '<button class="event-action-btn" onclick="editImportantDay(\'' + day.id + '\')" title="Edit"><i class="bi bi-pencil"></i></button>' +
            '<button class="event-action-btn event-action-delete" onclick="deleteImportantDay(\'' + day.id + '\')" title="Delete"><i class="bi bi-trash3"></i></button>' +
            '</div>' +
            '</div>' +
            (timeDisplay ? '<div class="event-card-time-row">' + timeDisplay + '</div>' : '') +
            (day.notes ? '<div class="event-card-notes">' + escapeHtml(day.notes) + '</div>' : '') +
            '<div class="event-card-footer">' +
            countdown +
            reminderBadge +
            teamBadge +
            '</div>' +
            '</div>' +
            '</div>';
    }).join('');
}

function editImportantDay(dayId) {
    const day = importantDaysList.find(d => d.id === dayId);
    if (day) {
        showImportantDayForm(day);
    }
}

async function deleteImportantDay(dayId) {
    if (!confirm('Delete this event?')) return;

    // Find the day to check if it's a team day
    const day = allImportantDays.find(d => d.id === dayId);
    const isTeamDay = day && day.type === 'team';

    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/important-days/delete', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ dayId })
        });
        if (res.ok) {
            showToast('Event deleted!', '???');

            // Emit socket event for team important days
            if (isTeamDay && socket && socket.connected) {
                console.log('?? Emitting important day deletion to team');
                socket.emit('important_day_updated', {
                    action: 'deleted',
                    orgId: storageGet('psyc_orgId')
                });
            }

            loadImportantDays();
            // Refresh calendar markers
            await fetchImportantDaysForCalendar();
            if (typeof renderCalendarGrid === 'function') renderCalendarGrid();
        } else {
            showToast('Failed to delete event', '??');
        }
    } catch (err) {
        console.error('Delete important day error:', err);
        showToast('Error deleting event', '??');
    }
}

async function saveImportantDay() {
    const title = document.getElementById('important-day-title').value.trim();
    const date = document.getElementById('important-day-date').value;
    const time = document.getElementById('important-day-time')?.value || null;
    const notes = document.getElementById('important-day-notes').value.trim();
    const reminderSelect = document.getElementById('important-day-reminder');
    const reminderBefore = reminderSelect ? reminderSelect.value : null;

    if (!title) { showToast('Please enter an event name', '??'); return; }
    if (!date) { showToast('Please select a date', '??'); return; }

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId') || '';
        const payload = {
            title,
            date,
            time,
            notes,
            orgId,
            type: currentImportantDayType,
            emoji: selectedEventEmoji,
            color: selectedEventColor,
            reminderBefore
        };

        console.log('?? Saving important day with emoji:', selectedEventEmoji, 'color:', selectedEventColor);
        console.log('?? Full payload:', payload);

        let url = '/api/important-days/create';
        if (editingImportantDayId) {
            url = '/api/important-days/update';
            payload.dayId = editingImportantDayId;
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            const result = await res.json();
            console.log('? Server response:', result);
            showToast(editingImportantDayId ? 'Event updated!' : 'Event added!', '?');

            // Emit socket event for team important days to notify other team members
            if (currentImportantDayType === 'team' && socket && socket.connected) {
                console.log('?? Emitting important day update to team');
                socket.emit('important_day_updated', {
                    action: editingImportantDayId ? 'updated' : 'created',
                    orgId: storageGet('psyc_orgId')
                });
            }

            editingImportantDayId = null;
            hideImportantDayForm();

            // Refresh both lists to ensure new data is loaded
            await loadImportantDays();
            await fetchImportantDaysForCalendar();
            if (typeof renderCalendarGrid === 'function') renderCalendarGrid();
        } else {
            showToast('Failed to save event', '??');
        }
    } catch (err) {
        console.error('Error saving event:', err);
        showToast('Error saving event', '??');
    }
}

function renderQuickMoodGrid() {
    const container = document.getElementById('quick-mood-grid');
    if (!container) return;

    const keys = ['rad', 'good', 'meh', 'bad', 'awful'];
    container.innerHTML = keys.map((key, index) => {
        const m = getMoodByKey(key);
        return `
        <div class="quick-mood-btn" onclick="selectQuickMood(${index})">
            ${getMoodAnimatedSVG(key, 56)}
            <span class="quick-mood-label">${m.label}</span>
        </div>`;
    }).join('');
}

function updateQuickDateTime() {
    const now = selectedPastDate ? new Date(selectedPastDate) : new Date();
    const dateDisplay = document.getElementById('quick-date-display');
    const timeDisplay = document.getElementById('quick-time-display');

    if (dateDisplay) {
        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        dateDisplay.textContent = now.toLocaleDateString('en-US', options);
    }

    if (timeDisplay) {
        const options = { hour: 'numeric', minute: '2-digit', hour12: true };
        timeDisplay.textContent = now.toLocaleTimeString('en-US', options);
    }
}

// --- Connect to Socket.io ---------------------------------------
async function connectSocket(user) {
    const token = await user.getIdToken();
    const orgId = storageGet('psyc_orgId');

    socket = io(SERVER_URL, {
        auth: { token, orgId },
    });
    window.socket = socket;

    socket.on('connect', () => {
        console.log('?? Connected to server');
        updateConnectionStatus(true);
    });

    socket.on('disconnect', () => {
        console.log('?? Disconnected from server');
        updateConnectionStatus(false);
    });

    socket.on('connect_error', (err) => {
        console.error('Connection error:', err.message);
        updateConnectionStatus(false);
    });

    // Initial state
    socket.on('initial_state', (data) => {
        console.log('👥 Received initial_state:', data.members.length, 'members');
        // Preserve any existing avatarUrl already loaded from REST before clearing
        const existingAvatars = new Map();
        membersMap.forEach((v, k) => { if (v.avatarUrl) existingAvatars.set(k, v.avatarUrl); });
        membersMap.clear();
        data.members.forEach(member => {
            // Restore avatarUrl from REST data if socket didn't include it
            if (!member.avatarUrl && existingAvatars.has(member.uid)) {
                member.avatarUrl = existingAvatars.get(member.uid);
            }
            membersMap.set(member.uid, member);
        });
        renderTeamGrid();
    });

    // Someone came online
    socket.on('user_online', (data) => {
        const existing = membersMap.get(data.uid) || {};
        membersMap.set(data.uid, { ...existing, ...data, isOnline: true });
        renderTeamGrid();
        showToast(`${data.displayName || data.email} is now online`, '??');
    });

    // Someone went offline
    socket.on('user_offline', (data) => {
        const member = membersMap.get(data.uid);
        if (member) {
            member.isOnline = false;
            membersMap.set(data.uid, member);
            renderTeamGrid();
        }
    });

    // Real-time organizational feed entry
    socket.on('new_feed_entry', async (data) => {
        const moodObj = getMoodByKey(data.mood);

        // Add to the ORGANIZATIONAL feed list
        addEntry({
            id: data.id,
            uid: data.uid,
            name: data.name,
            mood: data.mood,
            moodEmoji: moodObj?.emoji || '??',
            moodLabel: moodObj?.label || data.mood,
            moodColor: moodObj?.color || '#fff',
            activity: data.activity || '',
            emotions: data.emotions || [],
            note: data.note || '',
            timestamp: data.timestamp || Date.now(),
        });

        // Also update the local moodEntries for calendar if it belongs to the current user
        if (data.uid === currentUser.uid) {
            // Reload mood calendar to show new entry
            await loadMoodCalendar();
        }

        if (data.uid !== currentUser.uid) {
            showToast(`${data.name} just logged: ${moodObj?.label || data.mood}`, moodObj?.emoji || '??');
        }

        // Live update for Team Stats modal if open
        if (typeof loadTeamStats === 'function') {
            const statsModal = document.getElementById('team-stats-modal');
            if (statsModal && statsModal.classList.contains('open')) {
                const rangeSelect = document.getElementById('stats-range-select');
                loadTeamStats(rangeSelect ? rangeSelect.value : '30');
            }
        }
    });

    // --- Real-time Group Notifications --------------------------
    socket.on('new_group_notification', (data) => {
        console.log('?? Received live notification:', data);

        // Deduplicate using notification ID if available
        if (data.id && notificationLogs.some(n => n.id === data.id)) {
            console.log('?? Duplicate notification received, ignoring');
            return;
        }

        // Add to the log (this will also call renderNotificationLogs)
        if (typeof addNotificationToLog === 'function') {
            addNotificationToLog(data.title, data.body, data.type, data.userName || 'System', data.timestamp, data.id);
        }

        // Special handling for important days (only show popup for others)
        if (data.type === 'important_day' && data.dayData && data.userId !== currentUser?.uid) {
            showImportantDayNotification([data.dayData]);
        }

        // Toast for others' notifications
        if (data.userId !== currentUser?.uid) {
            showToast(`${data.userName}: ${data.title}`, '??');
        }
    });

    // --- Real-time Scheduled Session Notifications --------------------------
    socket.on('debriefing:scheduled', (data) => {
        showToast(`New Debriefing Scheduled: ${data.title}`, '??');
        showNewSessionBadge();

        if (typeof loadUpcomingDebriefings === 'function') {
            loadUpcomingDebriefings();
        }
    });

    socket.on('debriefing:reminder', async (data) => {
        console.log('? Debriefing reminder:', data);
        await loadOngoingDebriefings();
        await loadUpcomingDebriefings();
        showOngoingSessionBadge();
        showToast(`? "${data.title}" starts at ${data.timeStr}!`, '??');
        playNotificationSound();
    });

    // Real-time important day updates
    socket.on('important_day_updated', async (data) => {
        console.log('?? Important day updated:', data);
        // Reload important days list
        await loadImportantDays();
        await fetchImportantDaysForCalendar();
        if (typeof renderCalendarGrid === 'function') renderCalendarGrid();
    });

    // Real-time debriefing updates
    socket.on('debriefing_updated', async (data) => {
        console.log('?? Debriefing updated:', data);
        // Reload debriefings list
        await loadDebriefings();
        // Reload upcoming and ongoing sessions
        await loadUpcomingDebriefings();
        await loadOngoingDebriefings();
        // Show toast notification
        if (data.action === 'created') {
            showToast('New debriefing session scheduled!', '??');
        }
    });

    // Real-time debriefing scheduled notification
    socket.on('debriefing:scheduled', async (data) => {
        console.log('?? New debriefing scheduled:', data);
        // Reload upcoming and ongoing sessions
        await loadUpcomingDebriefings();
        await loadOngoingDebriefings();
        // Show visual indicators
        showNewSessionBadge();
        // Real-time debriefing reminder
        socket.on('debriefing:reminder', async (data) => {
            console.log('? Debriefing reminder:', data);
            // Reload ongoing and upcoming sessions (session may have moved to ongoing)
            await loadOngoingDebriefings();
            await loadUpcomingDebriefings();
            // Show visual indicators for ongoing session
            showOngoingSessionBadge();
            // Show urgent reminder toast
            showToast(`? "${data.title}" starts at ${data.timeStr}! ${data.meetingLink ? 'Join now!' : ''}`, '??');
            // Play notification sound
            playNotificationSound();
        }); await loadOngoingDebriefings();
        await loadUpcomingDebriefings();
        // Show urgent reminder toast
        showToast(`? "${data.title}" starts at ${data.timeStr}! ${data.meetingLink ? 'Join now!' : ''}`, '??');
        // Play notification sound
        playNotificationSound();
    });

    // Real-time status update for Team Grid
    socket.on('status_update', (data) => {
        const member = membersMap.get(data.uid);
        if (member) {
            member.currentMood = data.mood;
            member.currentActivity = data.activity;
            member.lastUpdated = data.timestamp;
            membersMap.set(data.uid, member);
            renderTeamGrid();
            animateCard(data.uid);
        }
    });

    // Real-time team goal updates
    socket.on('new_team_goal', (data) => {
        console.log('?? New team goal received:', data);

        // Add to goals list if we're viewing team goals
        if (currentGoalsFilter === 'team') {
            goalsList.unshift(data); // Add to beginning of list
            renderGoalsList();
            showToast(`New team goal: ${data.title}`, '??');
        }
    });

    // Real-time debriefing status updates (Marked as done, Evaluation posted, etc.)
    socket.on('debriefing_updated', async (data) => {
        console.log('?? Debriefing updated:', data);

        // Reload all debriefing sections to sync with server state
        await loadOngoingDebriefings();
        await loadUpcomingDebriefings();
        await loadCompletedSessions();

        // Show a helpful toast based on the action
        if (data.action === 'completed') {
            showToast('A debriefing session was marked as done', '?');
        } else if (data.action === 'deleted') {
            showToast('A debriefing session was deleted', '???');
        } else if (data.action === 'evaluation_posted') {
            showToast('A new evaluation form has been posted', '??');
        } else if (data.action === 'evaluation_ended') {
            showToast('Evaluation submission period has ended', '??');
        } else if (data.action === 'evaluation_submitted') {
            // For supervisors, if the results modal is currently open for THIS debriefing, refresh it live
            if (typeof renderEvaluationOverview === 'function' &&
                window.currentResultsDebriefingId === data.debriefingId) {
                // We typically use openEvaluationResults to fetch and show
                await openEvaluationResults(data.debriefingId, window.currentResultsSessionTitle || 'Evaluation');
            }
        }
    });

    // Real-time SOS alerts are handled in admin.js via initSOSListener()
    // Removed duplicate listener to prevent double notifications

    socket.on('sos:alert_resolved', (data) => {
        console.log('? SOS Alert resolved:', data);
        if (window.isSupervisor) {
            showToast(`? SOS Alert resolved by ${data.resolvedBy}`, '?');
            if (typeof loadSOSAlerts === 'function') {
                loadSOSAlerts();
            }
        }
    });

    socket.on('error_msg', (data) => {
        showToast(data.message, '??');
    });

    // Listen for member leaving organization
    socket.on('member:left', (data) => {
        console.log('Member left:', data);

        // Remove member from membersMap
        if (membersMap.has(data.uid)) {
            membersMap.delete(data.uid);
            renderTeamGrid();
            updateTeamHeader();
            showToast(`${data.name || 'A user'} left the organization`, '??');
        }
    });

    // Listen for being removed from organization
    socket.on('you:removed', (data) => {
        console.log('?? Access Revoked by server', data);

        // Show removal modal
        const adminName = data.adminName || 'an administrator';
        const modal = document.getElementById('removed-modal');
        const message = document.getElementById('removed-message');

        if (modal && message) {
            message.textContent = `You have been removed from the organization by ${adminName}.`;
            modal.classList.add('open');
            document.body.style.overflow = 'hidden';
        } else {
            // Fallback to alert if modal not found
            alert(`You have been removed from the organization by ${adminName}.`);
            handleRemovalConfirm();
        }
    });

    // Listen for other members being removed
    socket.on('member:removed', (data) => {
        console.log('Member removed event:', data);

        // Identify if "I" am the one removed
        const myUid = currentUser?.uid || (firebase.auth().currentUser ? firebase.auth().currentUser.uid : null);

        if (data && String(data.uid) === String(myUid)) {
            console.log('Self-removal detected via member:removed event');
            // This shouldn't happen since you:removed should fire first, but handle it anyway
            alert(`Ikaw ay inalis sa grupo ni ${data.adminName || 'isang administrator'}.`);
            localStorage.clear();
            if (socket) socket.disconnect();
            if (typeof auth !== 'undefined' && auth) {
                auth.signOut().then(() => window.location.replace('/')).catch(() => window.location.replace('/'));
            } else {
                window.location.replace('/');
            }
        } else if (data && data.uid) {
            // Handle others being removed
            if (membersMap.has(data.uid)) {
                const member = membersMap.get(data.uid);
                membersMap.delete(data.uid);
                renderTeamGrid();
                updateTeamHeader();
                if (member) {
                    showToast(member.displayName + " was removed", "??");
                }
            }
        }
    });

    // Listen for org settings updates (for members can invite feature)
    socket.on('org:settings-updated', (data) => {
        console.log('Org settings updated:', data);

        // Update member invite section if user is not admin
        const userDoc = Array.from(membersMap.values()).find(m => m.uid === currentUser?.uid);
        if (userDoc && userDoc.role !== 'admin') {
            const section = document.getElementById('member-invite-section');
            const codeEl = document.getElementById('member-invite-code');

            if (section && codeEl) {
                if (data.membersCanInvite && data.memberInviteCode) {
                    section.classList.remove('hidden');
                    codeEl.textContent = data.memberInviteCode;
                    showToast('Group invite is now enabled!', '?');
                } else {
                    section.classList.add('hidden');
                    showToast('Group invite has been disabled', '??');
                }
            }
        }
    });
}

// --- Load Org Info ----------------------------------------------
async function loadOrgInfo(user) {
    try {
        const token = await user.getIdToken();
        const orgId = storageGet('psyc_orgId');
        if (!orgId) {
            window.location.href = '/';
            return;
        }

        const res = await fetch(SERVER_URL + '/api/org/members?orgId=' + encodeURIComponent(orgId), {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();

        if (data.org) {
            const orgNameEl = document.getElementById('org-name');
            if (orgNameEl) orgNameEl.textContent = data.org.name;
            // Cache org name and invite code so it persists on refresh
            storageSet('psyc_orgName', data.org.name);
            if (data.org.inviteCode) storageSet('psyc_inviteCode', data.org.inviteCode);
            updateTeamHeader();

            if (data.members && data.members.length > 0) {
                data.members.forEach(member => {
                    const existing = membersMap.get(member.uid);
                    if (!existing) {
                        membersMap.set(member.uid, member);
                    } else {
                        // REST data has avatarUrl; preserve it over socket data which may not
                        membersMap.set(member.uid, { ...existing, ...member });
                    }
                });
                renderTeamGrid();
            }

            // Admin panel & Supervisor visibility
            const userRecord = data.members.find(m => m.uid === user.uid);
            const isAdmin = userRecord && (userRecord.role === 'admin' || userRecord.role === 'owner');
            window.isSupervisor = isAdmin;

            // Hide Previous Sessions sidebar button for non-supervisors
            const prevSessionsSidebarBtn = document.getElementById('previous-sessions-sidebar-btn');
            if (prevSessionsSidebarBtn) {
                prevSessionsSidebarBtn.style.display = isAdmin ? '' : 'none';
            }

            // Show supervisor group actions in sidebar dropdown
            const supervisorGroupActions = document.getElementById('supervisor-group-actions');
            if (supervisorGroupActions) {
                supervisorGroupActions.style.display = isAdmin ? 'block' : 'none';
            }

            const adminPanelBtn = document.getElementById('admin-panel-btn');
            const ldAdminBtn = document.getElementById('ld-admin-btn');
            const manageBtnTeam = document.getElementById('manage-members-btn-team');
            const leaveOrgBtn = document.getElementById('leave-org-btn');
            const leaveOrgBtnRS = document.getElementById('leave-org-btn-rs');
            const leaveOrgBtnTab = document.getElementById('leave-org-btn-tab');
            const leaveOrgBtnTeam = document.getElementById('leave-org-btn-team');

            if (isAdmin) {
                if (adminPanelBtn) adminPanelBtn.classList.remove('hidden');
                if (ldAdminBtn) ldAdminBtn.classList.remove('hidden');
                if (manageBtnTeam) manageBtnTeam.classList.remove('hidden');
                // Admins typically don't leave their own org, but if they can:
                if (leaveOrgBtn) leaveOrgBtn.classList.remove('hidden');
                if (leaveOrgBtnRS) leaveOrgBtnRS.classList.remove('hidden');
                if (leaveOrgBtnTab) leaveOrgBtnTab.classList.remove('hidden');
                if (leaveOrgBtnTeam) leaveOrgBtnTeam.classList.remove('hidden');
            } else if (userRecord) {
                // Member visibility
                if (adminPanelBtn) adminPanelBtn.classList.add('hidden');
                if (ldAdminBtn) ldAdminBtn.classList.add('hidden');
                if (manageBtnTeam) manageBtnTeam.classList.add('hidden');

                // Show leave organization button for non-admin members
                if (leaveOrgBtn) leaveOrgBtn.classList.remove('hidden');
                if (leaveOrgBtnRS) leaveOrgBtnRS.classList.remove('hidden');
                if (leaveOrgBtnTab) leaveOrgBtnTab.classList.remove('hidden');
                if (leaveOrgBtnTeam) leaveOrgBtnTeam.classList.remove('hidden');
            }

            // Check if members can invite (for non-admin members)
            if (data.org && data.org.membersCanInvite && userRecord && userRecord.role !== 'admin' && userRecord.role !== 'owner') {
                const memberInviteSection = document.getElementById('member-invite-section');
                const memberInviteCode = document.getElementById('member-invite-code');

                if (memberInviteSection && memberInviteCode && data.org.inviteCode) {
                    memberInviteSection.classList.remove('hidden');
                    memberInviteCode.textContent = data.org.inviteCode;  // Use org inviteCode
                }
            }
        }
    } catch (err) {
        console.error('Load org error:', err);
    }
}

async function loadOrgFeed(user, reset = false) {
    try {
        if (reset) {
            moodEntries = [];
            lastFeedTimestamp = null;
        }

        const token = await user.getIdToken();
        const orgId = storageGet('psyc_orgId');
        const month = viewMonth.getMonth();
        const year = viewMonth.getFullYear();

        const res = await fetch(SERVER_URL + `/api/org/feed?orgId=${encodeURIComponent(orgId || '')}&month=${month}&year=${year}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();
        if (data.logs) {
            const rawLogs = data.logs.map(log => {
                const moodObj = getMoodByKey(log.mood);
                return {
                    id: log.id,
                    uid: log.uid,
                    name: log.name,
                    mood: log.mood,
                    moodEmoji: moodObj?.emoji || '??',
                    moodLabel: moodObj?.label || log.mood,
                    moodColor: moodObj?.color || '#fff',
                    activity: log.activity || '',
                    emotions: log.emotions || [],
                    note: log.note || '',
                    timestamp: new Date(log.timestamp).getTime(),
                };
            });

            // Prevent duplicates (especially relevant after socket updates)
            const existingIds = new Set(moodEntries.map(e => e.id));
            const uniqueNew = rawLogs.filter(log => !existingIds.has(log.id));
            moodEntries = [...moodEntries, ...uniqueNew];

            // Sort by timestamp descending
            moodEntries.sort((a, b) => b.timestamp - a.timestamp);

            // Update pagination state
            hasMoreFeed = data.hasMore;
            if (moodEntries.length > 0) {
                lastFeedTimestamp = moodEntries[moodEntries.length - 1].timestamp;
            }

            renderEntries();

            // Set default view to TODAY if first load
            if (!reset && !selectedFeedDay) {
                selectedFeedDay = new Date();
                updateDayNavigator();
                renderEntries();
            }

            // Update month navigation buttons
            updateMonthNavButtons();

            // Also fetch important days so they can be merged into the feed
            await fetchImportantDaysForCalendar();
            renderEntries();
        }
    } catch (err) {
        console.error('Failed to load org feed', err);
    }
}




// --- Render Mood Picker (in modal) ------------------------------
async function renderMoodGrid() {
    const container = document.getElementById('mood-grid');
    if (!container) return;

    const moods = await getCustomMoods();
    const primaryKeys = ['rad', 'good', 'meh', 'bad', 'awful'];

    container.innerHTML = moods.map((m, index) => {
        // Use animated SVG for primary Inside Out moods, fallback to emoji for custom
        const isPrimary = primaryKeys.includes(m.key);
        const iconHtml = isPrimary
            ? getMoodAnimatedSVG(m.key, 48)
            : (m.icon
                ? `<i class="bi ${m.icon}"></i>`
                : (m.emoji.length > 5 || m.emoji.includes('.png')
                    ? `<img src="/assets/openmoji-618x618-color/${m.emoji}.png" alt="${m.label}" class="emoji-img">`
                    : m.emoji));

        return `
        <button class="mood-btn" data-mood="${index}" style="--mood-color: ${m.color}" onclick="selectMood(${index}, false)">
          <span class="mood-emoji">${iconHtml}</span>
          <span class="mood-label">${m.label}</span>
        </button>`;
    }).join('');
}

// --- Render Emotion Grid (custom emotions) ----------------------
const CUSTOM_EMOTIONS_KEY = 'psyc_custom_emotions';
let selectedEmotions = new Set();

async function getCustomEmotions() {
    const stored = localStorage.getItem(CUSTOM_EMOTIONS_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Failed to parse custom emotions:', e);
        }
    }
    // Default emotions
    return [
        { icon: "bi-emoji-smile-fill", label: "happy", color: "#10b981" },
        { icon: "bi-emoji-frown-fill", label: "sad", color: "#64748b" },
        { icon: "bi-emoji-angry-fill", label: "angry", color: "#ef4444" },
        { icon: "bi-emoji-expressionless-fill", label: "anxious", color: "#8b5cf6" }
    ];
}

function saveCustomEmotions(emotions) {
    localStorage.setItem(CUSTOM_EMOTIONS_KEY, JSON.stringify(emotions));
}

async function renderEmotionGrid() {
    const container = document.getElementById('emotion-grid');
    if (!container) return;

    const emotions = await getCustomEmotions();

    container.innerHTML = emotions.map((e, index) => {
        const iconHtml = e.icon
            ? `<i class="bi ${e.icon}" style="color: ${e.color || 'inherit'}"></i>`
            : (e.emoji.length > 5 || e.emoji.includes('.png')
                ? `<img src="/assets/openmoji-618x618-color/${e.emoji}.png" alt="${e.label}" class="emoji-img">`
                : e.emoji);

        return `
        <button class="activity-btn" data-emotion="${index}" onclick="toggleEmotion(${index})">
          <div class="activity-emoji">${iconHtml}</div>
          <span class="activity-label">${e.label}</span>
        </button>`;
    }).join('');
}

function toggleEmotion(emotionIndex) {
    const btn = document.querySelector(`[data-emotion="${emotionIndex}"]`);
    if (selectedEmotions.has(emotionIndex)) {
        selectedEmotions.delete(emotionIndex);
        btn?.classList.remove('active');
    } else {
        selectedEmotions.add(emotionIndex);
        btn?.classList.add('active');
    }
}

// --- Open Customizer for specific section -----------------------
window.currentCustomizeType = null;

function openCustomizer(type) {
    window.currentCustomizeType = type;
    const modal = document.getElementById('customize-modal');
    const title = document.getElementById('customize-title');
    const emotionsSection = document.getElementById('customize-emotions-section');
    const activitiesSection = document.getElementById('customize-activities-section');

    if (!modal) return;

    // Hide both sections first
    if (emotionsSection) emotionsSection.style.display = 'none';
    if (activitiesSection) activitiesSection.style.display = 'none';

    // Show the relevant section
    if (type === 'emotions') {
        if (title) title.textContent = 'Customize Emotions';
        if (emotionsSection) emotionsSection.style.display = 'block';
        renderCustomizeEmotions();
    } else if (type === 'activities') {
        if (title) title.textContent = 'Customize Activities';
        if (activitiesSection) activitiesSection.style.display = 'block';
        renderCustomizeActivities();
    }

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

async function renderCustomizeEmotions() {
    const grid = document.getElementById('customize-emotion-grid');
    if (!grid) return;

    const emotions = await getCustomEmotions();
    console.log('renderCustomizeEmotions - emotions:', emotions);

    grid.innerHTML = emotions.map((emotion, index) => {
        const emojiHtml = emotion.emoji.includes('.png') || emotion.emoji.length > 5
            ? `<img src="/assets/openmoji-618x618-color/${emotion.emoji}.png" alt="${emotion.label}" class="emoji-img">`
            : emotion.emoji;

        return `
        <div class="customize-activity-item" onclick="editEmotion(${index})">
            <span class="activity-emoji">${emojiHtml}</span>
            <span class="activity-label">${emotion.label}</span>
        </div>`;
    }).join('');
}

async function renderCustomizeActivities() {
    const grid = document.getElementById('customize-activity-grid');
    if (!grid) return;

    const activities = await window.getCustomActivities();

    grid.innerHTML = activities.map((activity, index) => {
        const emojiHtml = activity.emoji.includes('.png') || activity.emoji.length > 5
            ? `<img src="/assets/openmoji-618x618-color/${activity.emoji}.png" alt="${activity.label}" class="emoji-img">`
            : activity.emoji;

        return `
        <div class="customize-activity-item" onclick="editActivity(${index})">
            <span class="activity-emoji">${emojiHtml}</span>
            <span class="activity-label">${activity.label}</span>
        </div>`;
    }).join('');
}

function editEmotion(index) {
    window.editingType = 'emotion';
    window.editingIndex = index;
    getCustomEmotions().then(emotions => {
        window.editingItem = { ...emotions[index] };
        openEditItemModal();
    });
}

function addNewEmotionItem() {
    window.editingType = 'emotion';
    window.editingIndex = -1;
    window.editingItem = { emoji: '??', label: '' };
    console.log('addNewEmotionItem called:', window.editingItem);
    console.log('editingIndex:', window.editingIndex);
    openEditItemModal();
}

function addNewActivityItem() {
    window.editingType = 'activity';
    window.editingIndex = -1;
    window.editingItem = { emoji: '??', label: '' };
    console.log('addNewActivityItem called:', window.editingItem);
    console.log('editingIndex:', window.editingIndex);
    openEditItemModal();
}

async function resetEmotions() {
    if (confirm('Reset emotions to default? This cannot be undone.')) {
        const defaultEmotions = [
            { emoji: "??", label: "happy" },
            { emoji: "??", label: "sad" },
            { emoji: "??", label: "angry" },
            { emoji: "??", label: "anxious" }
        ];
        saveCustomEmotions(defaultEmotions);
        renderCustomizeEmotions();
        showToast('Emotions reset to default', '??');
    }
}

// Export functions to window for onclick handlers
window.openCustomizer = openCustomizer;
window.editEmotion = editEmotion;
window.addNewEmotionItem = addNewEmotionItem;
window.addNewActivityItem = addNewActivityItem;
window.resetEmotions = resetEmotions;
window.toggleEmotion = toggleEmotion;
window.getCustomEmotions = getCustomEmotions;
window.saveCustomEmotions = saveCustomEmotions;
window.renderCustomizeEmotions = renderCustomizeEmotions;
window.renderCustomizeActivities = renderCustomizeActivities;

// --- Render Activity Picker -------------------------------------
async function renderActivityGrid() {
    const container = document.getElementById('activity-grid');
    if (!container) return;

    const activities = await window.getCustomActivities();

    container.innerHTML = activities.map((a, index) => {
        const iconHtml = a.icon
            ? `<i class="bi ${a.icon}"></i>`
            : (a.emoji && (a.emoji.length > 5 || a.emoji.includes('.png'))
                ? `<img src="/assets/openmoji-618x618-color/${a.emoji}.png" alt="${a.label}" class="emoji-img">`
                : (a.emoji || ''));

        return `
        <button class="activity-btn" data-activity="${index}" onclick="toggleActivity(${index})">
          <span class="activity-emoji">${iconHtml}</span>
          <span class="activity-label">${a.label}</span>
        </button>`;
    }).join('');
}

// --- Toggle Activity Selection ----------------------------------
function toggleActivity(activityIndex) {
    const btn = document.querySelector(`[data-activity="${activityIndex}"]`);
    if (selectedActivities.has(activityIndex)) {
        selectedActivities.delete(activityIndex);
        btn?.classList.remove('active');
    } else {
        selectedActivities.add(activityIndex);
        btn?.classList.add('active');
    }
}

// --- Select Mood (no auto-send) ---------------------------------
async function selectMood(moodIndex, fromSaveButton = false) {
    const moods = await getCustomMoods();
    const moodObj = moods[moodIndex];
    if (!moodObj) return;

    document.querySelectorAll('.mood-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.querySelector(`[data-mood="${moodIndex}"]`);
    if (btn) btn.classList.add('active');

    pendingMood = moodObj;

    // If called from the save button flow, the actual emit is handled there.
    if (fromSaveButton) {
        sendMoodEntry();
    }
}

async function sendMoodEntry() {
    console.log('=== sendMoodEntry START ===');
    console.log('pendingMood:', pendingMood);
    console.log('socket connected:', socket?.connected);

    if (pendingMood === null || !socket || !socket.connected) {
        console.error('Cannot send: pendingMood is null or socket not connected');
        return;
    }

    // pendingMood is now an object with emoji, label, color from quick selector
    const selectedMood = typeof pendingMood === 'object' ? pendingMood : null;

    if (!selectedMood) {
        showToast('Please select a mood', '??');
        return;
    }

    console.log('selectedMood:', selectedMood);

    // Ensure emoji exists, fallback to a default based on mood
    if (!selectedMood.emoji) {
        console.warn('Mood emoji is undefined, using fallback');
        const moodKey = selectedMood.label?.toLowerCase() || '';
        const fallbackEmojis = {
            'rad': '??',
            'good': '??',
            'meh': '??',
            'bad': '??',
            'awful': '??'
        };
        selectedMood.emoji = fallbackEmojis[moodKey] || '??';
    }

    console.log('Getting custom activities and emotions...');
    const activities = await window.getCustomActivities();
    const emotions = await getCustomEmotions();
    console.log('activities:', activities);
    console.log('emotions:', emotions);

    const activitiesList = Array.from(selectedActivities);
    const emotionsList = Array.from(selectedEmotions);
    const note = document.getElementById('mood-note')?.value.trim() || '';

    const activityStr = activitiesList.map(index => {
        const a = activities[index];
        return a ? a.label : '';
    }).filter(Boolean).join(', ');

    const emotionStr = emotionsList.map(index => {
        const e = emotions[index];
        return e ? e.label : '';
    }).filter(Boolean).join(', ');

    // Create a mood key from the label for backward compatibility
    const moodKey = selectedMood.label.toLowerCase().replace(/\s+/g, '_');

    // Check if we're editing an existing entry
    const isEditing = window.editingEntryId;

    if (isEditing) {
        // Update existing entry
        try {
            const token = await currentUser.getIdToken();
            const orgId = storageGet('psyc_orgId');

            const res = await fetch(SERVER_URL + '/api/mood/update', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    entryId: window.editingEntryId,
                    orgId: orgId,
                    mood: moodKey,
                    moodLabel: selectedMood.label,
                    moodEmoji: selectedMood.emoji,
                    moodColor: selectedMood.color,
                    activity: activityStr,
                    activities: activitiesList.map(index => {
                        const a = activities[index];
                        return a ? a.label.toLowerCase().replace(/\s+/g, '_') : '';
                    }).filter(Boolean),
                    emotions: emotionsList.map(index => {
                        const e = emotions[index];
                        return e ? e.label.toLowerCase().replace(/\s+/g, '_') : '';
                    }).filter(Boolean),
                    note: note,
                    timestamp: selectedPastDate
                })
            });

            if (!res.ok) {
                throw new Error('Failed to update entry');
            }

            // Update local entry
            const entryIndex = moodEntries.findIndex(e => e.id === window.editingEntryId);
            if (entryIndex !== -1) {
                moodEntries[entryIndex] = {
                    ...moodEntries[entryIndex],
                    mood: moodKey,
                    moodLabel: selectedMood.label,
                    moodEmoji: selectedMood.emoji,
                    moodColor: selectedMood.color,
                    activity: activityStr,
                    activities: activitiesList.map(index => {
                        const a = activities[index];
                        return a ? a.label.toLowerCase().replace(/\s+/g, '_') : '';
                    }).filter(Boolean),
                    emotions: emotionsList.map(index => {
                        const e = emotions[index];
                        return e ? e.label.toLowerCase().replace(/\s+/g, '_') : '';
                    }).filter(Boolean),
                    note: note,
                    timestamp: selectedPastDate
                };
            }

            // Update personal entries too
            const personalIndex = personalEntries.findIndex(e => e.id === window.editingEntryId);
            if (personalIndex !== -1) {
                personalEntries[personalIndex] = {
                    ...personalEntries[personalIndex],
                    mood: moodKey,
                    moodLabel: selectedMood.label,
                    moodEmoji: selectedMood.emoji,
                    moodColor: selectedMood.color,
                    activity: activityStr,
                    activities: activitiesList.map(index => {
                        const a = activities[index];
                        return a ? a.label.toLowerCase().replace(/\s+/g, '_') : '';
                    }).filter(Boolean),
                    emotions: emotionsList.map(index => {
                        const e = emotions[index];
                        return e ? e.label.toLowerCase().replace(/\s+/g, '_') : '';
                    }).filter(Boolean),
                    note: note,
                    timestamp: selectedPastDate
                };
            }

            // Re-render
            renderEntries();

            // Update month navigation buttons
            updateMonthNavButtons();

            // Update calendar if active
            if (document.getElementById('tab-calendar').classList.contains('active')) {
                renderCalendarGrid();
            }

            // Update stats if active
            if (document.getElementById('tab-stats').classList.contains('active')) {
                loadStatsCharts();
            }

            showToast('Entry updated successfully', '?');

            // Clear editing state
            window.editingEntryId = null;
        } catch (err) {
            console.error('Update error:', err);
            showToast('Failed to update entry', '?');
            return;
        }
    } else {
        // Create new entry via socket
        socket.emit('mood_update', {
            mood: moodKey,
            moodLabel: selectedMood.label,
            moodEmoji: selectedMood.emoji,
            moodColor: selectedMood.color,
            activity: activityStr,
            activities: activitiesList.map(index => {
                const a = activities[index];
                return a ? a.label.toLowerCase().replace(/\s+/g, '_') : '';
            }).filter(Boolean),
            emotions: emotionsList.map(index => {
                const e = emotions[index];
                return e ? e.label.toLowerCase().replace(/\s+/g, '_') : '';
            }).filter(Boolean),
            note: note,
            timestamp: selectedPastDate,
        });

        // Immediately refresh calendar and stats after submitting
        // Wait a bit for the server to process and broadcast
        setTimeout(async () => {
            // Refresh calendar data
            await renderCalendarGrid();

            // Refresh mood count summary
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(SERVER_URL + '/api/user/calendar-logs', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.logs) {
                renderMoodCountSummary(data.logs);
            }

            // Refresh stats if on stats tab
            if (document.getElementById('tab-stats').classList.contains('active')) {
                loadStatsCharts();
            }
        }, 500);
    }

    // Reset and close after send
    selectedActivities.clear();
    selectedEmotions.clear();
    pendingMood = null;

    if (document.getElementById('mood-note')) {
        document.getElementById('mood-note').value = '';
    }

    setTimeout(() => closeMoodModal(), 400);
}

// --- Feed Filtering ---------------------------------------------
function setFeedFilter(filter) {
    feedFilter = filter;

    // Update UI
    const pill = document.getElementById('feed-filter-pill');
    if (pill) {
        pill.classList.remove('filter-all', 'filter-me');
        pill.classList.add('filter-' + filter);
    }

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('filter-' + filter);
    if (activeBtn) activeBtn.classList.add('active');

    // Keep current selected day or reset to today when switching views
    if (!selectedFeedDay) selectedFeedDay = new Date();
    updateDayNavigator();

    renderEntries();
}



// --- Entry Card System (Daylio-style) ---------------------------

function addEntry(entry) {
    // Add to Organizational Feed
    moodEntries.unshift(entry);
    // Sort latest first
    moodEntries.sort((a, b) => b.timestamp - a.timestamp);
    renderEntries();

    // Update month navigation buttons
    updateMonthNavButtons();

    // If it's my entry, also add to Personal History for Calendar
    if (entry.uid === currentUser?.uid) {
        personalEntries.unshift(entry);
        // Sort personal entries to ensure calendar finds the latest per day
        personalEntries.sort((a, b) => b.timestamp - a.timestamp);

        // Update dashboard stats and calendar
        renderCalendarGrid();
    }
}

function renderImportantDaysBanner() {
    const banner = document.getElementById('important-days-banner');
    if (!banner) return;

    // Get today's date (YYYY-MM-DD)
    const today = new Date().toISOString().split('T')[0];

    // Filter important days for today
    const todayImportantDays = allImportantDays.filter(day => day.date === today);

    // If no important days today, hide banner
    if (todayImportantDays.length === 0) {
        banner.style.display = 'none';
        return;
    }

    // Show compact card
    banner.style.display = 'block';

    // Get first important day for preview
    const firstDay = todayImportantDays[0];
    const color = '#ff9500'; // Always orange for the banner
    const count = todayImportantDays.length;

    banner.innerHTML = `
        <div onclick="openTodaysEventsModal()" style="
            background: ${color}40;
            cursor: pointer;
            position: relative;
            margin-bottom: 16px;
            border-radius: 16px;
            border: 2px solid ${color}60;
            padding: 16px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
        ">
            <div style="
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: ${color};
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                flex-shrink: 0;
                color: white;
            ">
                <i class="bi bi-star-fill"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
                <div style="
                    font-size: 16px;
                    font-weight: 700;
                    color: ${color};
                    margin-bottom: 4px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                ">
                    ${count > 1 ? `${count} Important Events Today` : firstDay.title}
                </div>
                <div style="
                    font-size: 13px;
                    color: ${color}CC;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                ">
                    <i class="bi bi-hand-index"></i> ${count > 1 ? 'Tap to view all' : 'Tap to view details'}
                </div>
            </div>
            <i class="bi bi-chevron-right" style="color: ${color}; font-size: 20px; flex-shrink: 0;"></i>
        </div>
    `;
}

function openTodaysEventsModal() {
    const modal = document.getElementById('todays-events-modal');
    if (modal) {
        renderTodaysEventsList();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeTodaysEventsModal() {
    const modal = document.getElementById('todays-events-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function renderTodaysEventsList() {
    const container = document.getElementById('todays-events-list');
    if (!container) return;

    // Get today's date (YYYY-MM-DD)
    const today = new Date().toISOString().split('T')[0];

    // Filter important days for today
    const todayImportantDays = allImportantDays.filter(day => day.date === today);

    if (todayImportantDays.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
                <i class="bi bi-calendar-x" style="font-size: 48px; margin-bottom: 10px;"></i>
                <p>No important events today</p>
            </div>
        `;
        return;
    }

    container.innerHTML = todayImportantDays.map(day => {
        const emoji = day.emoji || '??';
        const color = day.color || '#ec4899';
        const time = day.time ? formatTime(day.time) : '';
        const isTeam = day.type === 'team';

        return `
            <div style="
                background: linear-gradient(135deg, ${color}15 0%, ${color}05 100%);
                border-left: 4px solid ${color};
                padding: 16px;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            ">
                <div style="display: flex; align-items: start; gap: 12px;">
                    <div style="font-size: 32px; min-width: 40px; text-align: center;">${emoji}</div>
                    <div style="flex: 1;">
                        <div style="
                            font-size: 18px;
                            font-weight: 700;
                            color: ${color};
                            margin-bottom: 8px;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            flex-wrap: wrap;
                        ">
                            ${day.title}
                            ${isTeam ? `<span style="font-size: 12px; background: ${color}20; color: ${color}; padding: 2px 8px; border-radius: 8px; font-weight: 600;"><i class="bi bi-people-fill"></i> Team</span>` : ''}
                        </div>
                        ${day.notes ? `<div style="font-size: 14px; color: #64748b; margin-bottom: 8px; line-height: 1.5;">${day.notes}</div>` : ''}
                        ${time ? `<div style="font-size: 13px; color: #94a3b8;"><i class="bi bi-clock"></i> ${time}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderEntries() {
    const container = document.getElementById('entries-list');
    const quickMoodCard = document.getElementById('quick-mood-card');
    if (!container) return;

    // Render important days banner for today
    renderImportantDaysBanner();

    // Render debriefing banner for today
    renderDebriefingBanner();

    // Hide quick mood card when rendering entries
    if (quickMoodCard) quickMoodCard.style.display = 'none';

    // 1. Filter entries
    let filteredEntries = feedFilter === 'me'
        ? moodEntries.filter(entry => entry.uid === currentUser?.uid)
        : moodEntries;

    // Important days are NO LONGER mixed with entries - they're in the banner now
    // So we remove the eventEntries merging code

    // Combine and re-sort (just mood entries now)
    let combinedEntries = [...filteredEntries];
    combinedEntries.sort((a, b) => b.timestamp - a.timestamp);

    // removed: daily filtering so we show all entries for the month

    // 2. Handle empty state
    if (combinedEntries.length === 0) {
        const locale = currentLang === 'fil' ? 'fil-PH' : 'en-US';
        let msg = selectedFeedDay
            ? `${t('no_entries_for')} ${selectedFeedDay.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}`
            : `${t('no_entries_for')} ${viewMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}`;

        const primaryMoodKeys = ['rad', 'good', 'meh', 'bad', 'awful'];
        const quickMoods = primaryMoodKeys.map(key => ({ ...getMoodByKey(key), label: t(key) }));
        const quickMoodsHtml = quickMoods.map(m => `
            <div class="how-mood-wrapper" onclick="openMoodPageWithMood('${m.key}')">
                ${getMoodAnimatedSVG(m.key, 52)}
                <span class="how-mood-label">${m.label.toLowerCase()}</span>
            </div>
        `).join('');

        container.innerHTML = `
        <div class="how-are-you-card">
            <div class="how-are-you-header">
                <span class="how-are-you-title">${t('how_are_you_short')}</span>
                <span class="how-are-you-subtitle">${msg}</span>
            </div>
            <div class="how-are-you-row">${quickMoodsHtml}</div>
        </div>`;
        return;
    }

    // 3. Group by day
    const groups = {};
    combinedEntries.forEach(entry => {
        const date = new Date(entry.timestamp);
        const dayLabel = getDayLabel(date);
        if (!groups[dayLabel]) groups[dayLabel] = [];
        groups[dayLabel].push(entry);
    });

    // 4. Render
    let html = '';
    const allKnownActivities = [...ACTIVITIES, ...customActivities];

    for (const [dayLabel, entries] of Object.entries(groups)) {
        const isToday = dayLabel.startsWith('TODAY');
        const isYesterday = dayLabel.startsWith('YESTERDAY');
        const dayId = dayLabel.replace(/[^a-zA-Z0-9]/g, '-');

        html += `
        <div class="day-group-card ${!isToday ? 'collapsed' : ''}" id="day-group-${dayId}">
            <div class="day-group-header ${isToday ? 'today' : ''} ${isYesterday ? 'yesterday' : ''}">
                <div class="day-group-header-left">
                    <i class="bi bi-circle"></i>
                    ${dayLabel}
                </div>
                <button class="day-collapse-btn" onclick="toggleDayGroup('${dayId}')">
                    <i class="bi ${isToday ? 'bi-chevron-up' : 'bi-chevron-down'}"></i>
                </button>
            </div>
            <div class="day-group-content" id="day-content-${dayId}" style="display: ${isToday ? 'block' : 'none'}">
        `;

        entries.forEach(entry => {
            if (entry.type === 'event') {
                // Render Important Day Card in Feed
                const eventTimeStr = entry.time ? formatTime(entry.time) : 'All Day';
                const emoji = entry.emoji || '?';
                const color = entry.color || '#6366f1';
                html += `
                <div class="entry-item entry-event-item" style="border-left: 3px solid ${color};">
                    <div class="entry-timeline-icon" style="--mood-color: ${color}; background: ${color}20;">
                        <span style="font-size: 1.3rem;">${emoji}</span>
                    </div>
                    <div class="entry-details">
                        <div class="entry-headline">
                            <span class="entry-mood-name" style="--mood-color: ${color}; color: ${color}; font-weight: 800;">
                                ${escapeHtml(entry.name)}
                            </span>
                            <span class="entry-time-stamp">
                                <i class="bi bi-clock" style="font-size: 0.65rem;"></i> ${eventTimeStr}
                            </span>
                        </div>
                        ${entry.notes ? `<div class="entry-note-text" style="margin-top: 4px; font-size: 0.8rem;">${escapeHtml(entry.notes)}</div>` : ''}
                        ${entry.isTeam ? `<div class="entry-activities-list" style="margin-top: 4px;"><div class="entry-activity-item"><span class="entry-activity-emoji">??</span><span class="entry-activity-label">Team</span></div></div>` : ''}
                    </div>
                </div>`;
                return;
            }

            if (entry.type === 'goal-reminder') {
                // Render Goal Reminder Card in Feed
                html += `
                <div class="entry-item entry-goal-item" style="border-left: 3px solid #8b5cf6;">
                    <div class="entry-timeline-icon" style="--mood-color: #8b5cf6; background: #8b5cf620;">
                        <span style="font-size: 1.3rem;">??</span>
                    </div>
                    <div class="entry-details">
                        <div class="entry-headline">
                            <span class="entry-mood-name" style="--mood-color: #8b5cf6; color: #8b5cf6; font-weight: 800;">
                                ${escapeHtml(entry.name)}
                            </span>
                            <span class="entry-time-stamp">
                                <i class="bi bi-clock" style="font-size: 0.65rem;"></i> ${entry.timeStr || ''}
                            </span>
                        </div>
                        ${entry.description ? `<div class="entry-note-text" style="margin-top: 4px; font-size: 0.8rem;">${escapeHtml(entry.description)}</div>` : ''}
                        <div class="entry-activities-list" style="margin-top: 4px;">
                            <div class="entry-activity-item" style="background: #8b5cf615; border-color: #8b5cf630;">
                                <span class="entry-activity-emoji"><i class="bi bi-bell-fill" style="color: #8b5cf6; font-size: 0.65rem;"></i></span>
                                <span class="entry-activity-label" style="color: #8b5cf6;">Goal Reminder</span>
                            </div>
                            ${entry.goalType === 'team' ? `<div class="entry-activity-item"><span class="entry-activity-emoji">??</span><span class="entry-activity-label">Team</span></div>` : ''}
                        </div>
                    </div>
                </div>`;
                return;
            }

            const date = new Date(entry.timestamp);
            const locale = currentLang === 'fil' ? 'fil-PH' : 'en-US';
            const timeStr = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

            const emojiDisplay = entry.moodEmoji && (entry.moodEmoji.length > 5 || entry.moodEmoji.includes('.png'))
                ? `<img src="/assets/openmoji-618x618-color/${entry.moodEmoji}.png" alt="${entry.moodLabel}">`
                : entry.moodEmoji;

            const activityItems = entry.activity ? entry.activity.split(', ').map(label => {
                const found = allKnownActivities.find(a => a.label.toLowerCase() === label.toLowerCase());
                const emoji = found ? found.emoji : '�';
                return `<div class="entry-activity-item">
                    <span class="entry-activity-emoji">${emoji}</span>
                    <span class="entry-activity-label">${label.toLowerCase()}</span>
                </div>`;
            }).join('') : '';

            // Render emotions if available
            const emotionItems = entry.emotions && entry.emotions.length > 0 ? entry.emotions.map(emotionKey => {
                // Convert emotion key back to display format (e.g., "happy" -> "Happy")
                const label = emotionKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                // Try to find emoji from custom emotions
                return `<div class="entry-emotion-item">
                    <span class="entry-emotion-label">${label}</span>
                </div>`;
            }).join('') : '';

            // Show menu button only for "Me" filter and if it's the current user's entry
            const showMenu = feedFilter === 'me' && entry.uid === currentUser?.uid;

            html += `
                <div class="entry-item">
                    <div class="entry-timeline-icon" style="--mood-color: ${entry.moodColor}">
                        ${emojiDisplay}
                    </div>
                    <div class="entry-details">
                        <div class="entry-headline">
                            <span class="entry-mood-name" style="--mood-color: ${entry.moodColor}">${entry.moodLabel}</span>
                            <span class="entry-user-name">@${entry.name || 'user'}</span>
                            <span class="entry-time-stamp">${timeStr}</span>
                        </div>
                        ${emotionItems ? `<div class="entry-emotions-list">${emotionItems}</div>` : ''}
                        <div class="entry-activities-list">
                            ${activityItems}
                        </div>
                        ${entry.note ? `<div class="entry-note-text">${escapeHtml(entry.note)}</div>` : ''}
                    </div>
                    ${showMenu ? `
                    <button class="entry-menu-btn" onclick="toggleEntryMenu(event, '${entry.id}')">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    ` : ''}
                </div>
            `;
        });

        html += `
            </div>
        </div>
        `;
    }

    container.innerHTML = html;
}

function toggleDayGroup(dayId) {
    const content = document.getElementById(`day-content-${dayId}`);
    const group = document.getElementById(`day-group-${dayId}`);
    const btn = group.querySelector('.day-collapse-btn i');

    if (!content || !btn) return;

    if (content.style.display === 'none') {
        content.style.display = 'block';
        btn.classList.remove('bi-chevron-down');
        btn.classList.add('bi-chevron-up');
        group.classList.remove('collapsed');
    } else {
        content.style.display = 'none';
        btn.classList.remove('bi-chevron-up');
        btn.classList.add('bi-chevron-down');
        group.classList.add('collapsed');
    }
}

function toggleEntryMenu(event, entryId) {
    event.stopPropagation();

    // Close any existing menu
    const existingMenu = document.querySelector('.entry-menu-dropdown');
    if (existingMenu) {
        existingMenu.remove();
    }

    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();

    // Create menu
    const menu = document.createElement('div');
    menu.className = 'entry-menu-dropdown';
    menu.innerHTML = `
        <div class="entry-menu-item" onclick="editEntry('${entryId}')">
            <i class="bi bi-pencil"></i>
            <span>Edit</span>
        </div>
        <div class="entry-menu-item delete" onclick="deleteEntry('${entryId}')">
            <i class="bi bi-trash"></i>
            <span>Delete</span>
        </div>
    `;

    // Position menu
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;

    document.body.appendChild(menu);

    // Close menu when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
}

function editEntry(entryId) {
    // Close menu
    const menu = document.querySelector('.entry-menu-dropdown');
    if (menu) menu.remove();

    // Find the entry
    const entry = moodEntries.find(e => e.id === entryId);
    if (!entry) {
        showToast('Entry not found', '?');
        return;
    }

    // Set the timestamp for editing
    selectedPastDate = entry.timestamp;

    // Set the pending mood
    pendingMood = {
        emoji: entry.moodEmoji,
        label: entry.moodLabel,
        color: entry.moodColor
    };

    // Parse and select activities
    selectedActivities.clear();
    if (entry.activity) {
        const activityLabels = entry.activity.split(', ');
        getCustomActivities().then(activities => {
            activityLabels.forEach(label => {
                const index = activities.findIndex(a => a.label.toLowerCase() === label.toLowerCase());
                if (index !== -1) {
                    selectedActivities.add(index);
                }
            });
            // Update UI
            renderActivityGrid();
        });
    }

    // Parse and select emotions
    selectedEmotions.clear();
    if (entry.emotions && Array.isArray(entry.emotions)) {
        getCustomEmotions().then(emotions => {
            entry.emotions.forEach(emotionKey => {
                const index = emotions.findIndex(e => e.label.toLowerCase().replace(/\s+/g, '_') === emotionKey);
                if (index !== -1) {
                    selectedEmotions.add(index);
                }
            });
            // Update UI
            renderEmotionGrid();
        });
    }

    // Store the entry ID for updating
    window.editingEntryId = entryId;

    // Open the mood modal
    openMoodModal();

    // Set the note
    setTimeout(() => {
        const noteField = document.getElementById('mood-note');
        if (noteField && entry.note) {
            noteField.value = entry.note;
        }
    }, 100);
}

async function deleteEntry(entryId) {
    // Close menu
    const menu = document.querySelector('.entry-menu-dropdown');
    if (menu) menu.remove();

    if (!confirm('Are you sure you want to delete this entry?')) {
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        const res = await fetch(SERVER_URL + '/api/mood/delete', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                entryId: entryId,
                orgId: orgId
            })
        });

        if (!res.ok) {
            throw new Error('Failed to delete entry');
        }

        // Remove from local arrays
        moodEntries = moodEntries.filter(e => e.id !== entryId);
        personalEntries = personalEntries.filter(e => e.id !== entryId);

        // Re-render
        renderEntries();

        // Update month navigation buttons
        updateMonthNavButtons();

        // Update calendar if active
        if (document.getElementById('tab-calendar').classList.contains('active')) {
            renderCalendarGrid();
        }

        // Update stats if active
        if (document.getElementById('tab-stats').classList.contains('active')) {
            loadStatsCharts();
        }

        showToast('Entry deleted successfully', '?');
    } catch (err) {
        console.error('Delete error:', err);
        showToast('Failed to delete entry', '?');
    }
}

function openEntryMenu(entryId) {
    console.log('Open menu for entry:', entryId);
    // Future: implement edit/delete menu
}

function getDayLabel(date) {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const isSameDay = (d1, d2) =>
        d1.getDate() === d2.getDate() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getFullYear() === d2.getFullYear();

    const locale = currentLang === 'fil' ? 'fil-PH' : 'en-US';

    if (isSameDay(date, today)) {
        return `${t('today')}, ${date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }).toUpperCase()}`;
    }
    if (isSameDay(date, yesterday)) {
        return `${t('yesterday')}, ${date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }).toUpperCase()}`;
    }

    return date.toLocaleDateString(locale, {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    }).toUpperCase();
}

// --- Render Team Grid -------------------------------------------
function renderTeamGrid() {
    const container = document.getElementById('team-grid');
    if (!container) return;

    const members = Array.from(membersMap.values());

    // No longer patching photoURL from Firebase - custom avatarUrl only

    console.log('👥 [Team] Members data:', members.map(m => ({ name: m.displayName, photoURL: m.photoURL || 'NONE' })));

    members.sort((a, b) => {
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (a.role !== 'admin' && b.role === 'admin') return 1;
        if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1;
        return (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '');
    });

    if (members.length === 0) {
        container.innerHTML = '<div class="empty-msg"><i class="bi bi-people-fill" style="font-size: 2rem; opacity: 0.3; margin-bottom: 8px;"></i><p>No team members yet.</p></div>';
        return;
    }

    container.innerHTML = members.map(member => {
        const moodObj = getMoodByKey(member.currentMood);
        const isMe = currentUser && member.uid === currentUser.uid;
        const initial = (member.displayName || member.email || '?').charAt(0).toUpperCase();

        // Handle icon/emoji display for mood
        let moodIconDisplay = '';
        if (moodObj) {
            moodIconDisplay = moodObj.icon
                ? `<i class="bi ${moodObj.icon}"></i>`
                : (moodObj.emoji && (moodObj.emoji.length > 5 || moodObj.emoji.includes('.png'))
                    ? `<img src="/assets/openmoji-618x618-color/${moodObj.emoji}.png" alt="${moodObj.label}" class="emoji-img" style="width: 24px; height: 24px; object-fit: contain;">`
                    : moodObj.emoji);
        }

        return `
      <div class="member-manage-card ${isMe ? 'is-me' : ''}"
           id="card-${member.uid}">
        <div class="member-manage-avatar">
          ${member.avatarUrl
                ? `<img src="${member.avatarUrl}" alt="">`
                : `<span style="position: relative; z-index: 1;">${initial}</span>`
            }
          <span class="status-dot ${member.isOnline ? 'dot-online' : 'dot-offline'}"></span>
        </div>
        <div class="member-manage-name">${(member.displayName || member.email || '').replace(/^\w/, c => c.toUpperCase())}</div>
        <div class="member-manage-role">${member.role === 'admin' ? t('admin') : t('member')}</div>
      </div>
    `;
    }).join('');

    // Update counters
    const onlineCount = members.filter(m => m.isOnline).length;
    const onlineCountEl = document.getElementById('online-count');
    const totalCountEl = document.getElementById('total-count');
    if (onlineCountEl) onlineCountEl.textContent = onlineCount;
    if (totalCountEl) totalCountEl.textContent = members.length;

    // Update team header counters
    const teamOnlineCount = document.getElementById('team-online-count');
    const teamTotalCount = document.getElementById('team-total-count');
    if (teamOnlineCount) teamOnlineCount.textContent = onlineCount;
    if (teamTotalCount) teamTotalCount.textContent = members.length;

    // Update right sidebar team widget
    renderTeamWidget();
}

// --- Render Team Widget (Right Sidebar) -------------------------
function renderTeamWidget() {
    const container = document.getElementById('team-status-widget');
    if (!container) return;

    const members = Array.from(membersMap.values());

    // No longer patching photoURL from Firebase - custom avatarUrl only

    members.sort((a, b) => {
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (a.role !== 'admin' && b.role === 'admin') return 1;
        if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1;
        return (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '');
    });

    if (members.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: #94a3b8; padding: 20px; font-size: 0.85rem;">
                <i class="bi bi-people" style="font-size: 1.8rem; display: block; margin-bottom: 8px; opacity: 0.3;"></i>
                No team members yet
            </div>
        `;
        return;
    }

    container.innerHTML = members.map(member => {
        const isMe = currentUser && member.uid === currentUser.uid;
        const initial = (member.displayName || member.email || '?').charAt(0).toUpperCase();

        return `
            <div class="rs-team-member ${isMe ? 'is-me' : ''}">
                <div class="rs-team-avatar">
                    ${member.avatarUrl
                ? `<img src="${member.avatarUrl}" alt="">`
                : `<span style="position: relative; z-index: 1;">${initial}</span>`
            }
                    <span class="status-dot ${member.isOnline ? 'dot-online' : 'dot-offline'}"></span>
                </div>
                <div class="rs-team-info">
                    <div class="rs-team-name">${(member.displayName || member.email || '').replace(/^\w/, c => c.toUpperCase())}</div>
                    <div class="rs-team-role">${member.role === 'admin' ? 'Admin' : 'Member'}</div>
                </div>
            </div>
        `;
    }).join('');
}

// --- Animate card on mood change --------------------------------
function animateCard(uid) {
    const card = document.getElementById(`card-${uid}`);
    if (card) {
        card.classList.add('pulse');
        setTimeout(() => card.classList.remove('pulse'), 500);
    }
}

// --- Connection Status ------------------------------------------
function updateConnectionStatus(connected) {
    const dotMore = document.getElementById('connection-dot-more');
    if (dotMore) dotMore.className = `conn-dot ${connected ? 'conn-online' : 'conn-offline'}`;
}

// --- Toast Notification -----------------------------------------
function showToast(message, icon = '??') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Utility ----------------------------------------------------
function getTimeAgo(timestamp) {
    if (!timestamp) return '...';

    let ts;
    if (typeof timestamp === 'object' && timestamp.seconds) {
        ts = timestamp.seconds * 1000;
    } else if (typeof timestamp === 'string') {
        ts = new Date(timestamp).getTime();
    } else {
        ts = timestamp;
    }

    const now = Date.now();
    const diff = now - ts;

    if (diff < 60000) return typeof t === 'function' ? t('just_now') : 'just now';
    if (diff < 3600000) {
        const m = Math.floor(diff / 60000);
        return typeof t === 'function' ? `${m}${t('m')} ${t('ago')}` : `${m}m ago`;
    }
    if (diff < 86400000) {
        const h = Math.floor(diff / 3600000);
        return typeof t === 'function' ? `${h}${t('h')} ${t('ago')}` : `${h}h ago`;
    }
    const d = Math.floor(diff / 86400000);
    return typeof t === 'function' ? `${d}${t('d')} ${t('ago')}` : `${d}d ago`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Daily Reminder (local notification, per device) -------------
const REMINDER_STORAGE_KEY = 'psyc_daily_reminder';
let reminderTimeoutId = null;

async function ensureNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
}

// Request notification permission on app load
async function requestNotificationPermission() {
    // Check if notifications are supported
    if (!('Notification' in window)) {
        console.log('?? Notifications not supported in this browser');
        return;
    }

    // Check permission status and update UI
    updateNotificationUI();
    updateBrowserNotificationToggle();
}

// Toggle browser notifications from settings
async function toggleBrowserNotifications() {
    console.log('?? toggleBrowserNotifications called');
    const toggle = document.getElementById('browser-notifications-enabled');
    console.log('Toggle element:', toggle);
    console.log('Toggle checked:', toggle?.checked);
    console.log('Notification permission:', Notification?.permission);

    if (!('Notification' in window)) {
        console.error('? Notifications not supported');
        showToast('Notifications not supported in this browser', '??');
        if (toggle) toggle.checked = false;
        return;
    }

    if (toggle && toggle.checked) {
        console.log('? User wants to enable notifications');
        // User wants to enable - request permission
        if (Notification.permission === 'granted') {
            console.log('? Already granted');
            showToast('Notifications already enabled!', '?');
            updateBrowserNotificationToggle();
            return;
        }

        try {
            console.log('?? Requesting permission...');
            const permission = await Notification.requestPermission();
            console.log('?? Permission result:', permission);

            if (permission === 'granted') {
                console.log('? Permission granted!');
                showToast('Notifications enabled! ??', '?');
                updateBrowserNotificationToggle();
                updateNotificationUI();

                // Show a test notification
                setTimeout(() => {
                    try {
                        console.log('?? Showing test notification...');
                        const notification = new Notification('Notifications Enabled! ??', {
                            body: 'You\'ll receive reminders for your goals and mood check-ins.',
                            icon: '/assets/logo/logo.jpg',
                            requireInteraction: false
                        });
                        setTimeout(() => notification.close(), 5000);
                    } catch (err) {
                        console.error('? Test notification error:', err);
                    }
                }, 500);
            } else {
                console.log('?? Permission denied');
                showToast('Permission denied. Check browser settings to enable.', '??');
                if (toggle) toggle.checked = false;
                updateBrowserNotificationToggle();
            }
        } catch (err) {
            console.error('? Error requesting permission:', err);
            showToast('Error requesting permission', '??');
            if (toggle) toggle.checked = false;
        }
    } else {
        console.log('?? User disabled toggle');
        // User wants to disable - just update UI
        showToast('Notifications disabled. Toggle on to re-enable.', '??');
        updateBrowserNotificationToggle();
    }
}

// Update the browser notification toggle based on permission
function updateBrowserNotificationToggle() {
    console.log('?? updateBrowserNotificationToggle called');
    const toggle = document.getElementById('browser-notifications-enabled');
    const statusDiv = document.getElementById('notification-status');

    console.log('Toggle element:', toggle);
    console.log('Status div:', statusDiv);
    console.log('Notification support:', 'Notification' in window);
    console.log('Permission:', Notification?.permission);

    if (!('Notification' in window)) {
        console.log('? Notifications not supported');
        if (toggle) {
            toggle.checked = false;
            toggle.disabled = true;
        }
        if (statusDiv) {
            statusDiv.innerHTML = '<i class="bi bi-x-circle"></i> Not supported in this browser';
            statusDiv.style.background = '#fee2e2';
            statusDiv.style.color = '#991b1b';
        }
        return;
    }

    if (Notification.permission === 'granted') {
        console.log('? Setting UI to GRANTED state');
        if (toggle) {
            toggle.checked = true;
            toggle.disabled = false;
        }
        if (statusDiv) {
            statusDiv.innerHTML = '<i class="bi bi-check-circle-fill"></i> Enabled - You\'ll receive notifications';
            statusDiv.style.background = '#d1fae5';
            statusDiv.style.color = '#065f46';
        }
    } else if (Notification.permission === 'denied') {
        console.log('? Setting UI to DENIED state');
        if (toggle) {
            toggle.checked = false;
            toggle.disabled = true;
        }
        if (statusDiv) {
            statusDiv.innerHTML = '<i class="bi bi-x-circle-fill"></i> Blocked - Enable in browser settings';
            statusDiv.style.background = '#fee2e2';
            statusDiv.style.color = '#991b1b';
        }
    } else {
        console.log('?? Setting UI to DEFAULT state');
        // default - not asked yet
        if (toggle) {
            toggle.checked = false;
            toggle.disabled = false;
        }
        if (statusDiv) {
            statusDiv.innerHTML = '<i class="bi bi-info-circle"></i> Toggle on to enable notifications';
            statusDiv.style.background = '#fef3c7';
            statusDiv.style.color = '#92400e';
        }
    }

    console.log('? UI updated successfully');
}

// Update UI based on notification permission
function updateNotificationUI() {
    if (!('Notification' in window)) return;

    const banner = document.getElementById('notification-permission-banner');
    const notifGrid = document.getElementById('notification-frequency-grid');
    const dailyTimeContainer = document.getElementById('daily-time-container');
    const threeTimesContainer = document.getElementById('three-times-container');
    const weeklyContainer = document.getElementById('weekly-container');
    const customTimesContainer = document.getElementById('custom-times-container');

    if (Notification.permission === 'granted') {
        // Hide banner, enable notification options
        if (banner) banner.style.display = 'none';
        if (notifGrid) notifGrid.style.opacity = '1';
        if (notifGrid) notifGrid.style.pointerEvents = 'auto';
        console.log('? Notifications enabled');
    } else {
        // Show banner, disable notification options
        if (banner) banner.style.display = 'block';
        if (notifGrid) notifGrid.style.opacity = '0.5';
        if (notifGrid) notifGrid.style.pointerEvents = 'none';
        if (dailyTimeContainer) dailyTimeContainer.style.opacity = '0.5';
        if (dailyTimeContainer) dailyTimeContainer.style.pointerEvents = 'none';
        if (threeTimesContainer) threeTimesContainer.style.opacity = '0.5';
        if (threeTimesContainer) threeTimesContainer.style.pointerEvents = 'none';
        if (weeklyContainer) weeklyContainer.style.opacity = '0.5';
        if (weeklyContainer) weeklyContainer.style.pointerEvents = 'none';
        if (customTimesContainer) customTimesContainer.style.opacity = '0.5';
        if (customTimesContainer) customTimesContainer.style.pointerEvents = 'none';
        console.log('?? Notifications disabled');
    }
}

// Request permission from banner button
async function requestNotificationPermissionFromBanner() {
    if (!('Notification' in window)) {
        showToast('Notifications not supported in this browser', '??');
        return;
    }

    if (Notification.permission === 'granted') {
        showToast('Notifications already enabled!', '?');
        updateNotificationUI();
        return;
    }

    try {
        console.log('?? Requesting notification permission...');
        const permission = await Notification.requestPermission();

        if (permission === 'granted') {
            console.log('? Notification permission granted');
            showToast('Notifications enabled! ??', '?');
            updateNotificationUI();

            // Show a test notification
            setTimeout(() => {
                try {
                    const notification = new Notification('Notifications Enabled! ??', {
                        body: 'You\'ll receive reminders for your goals.',
                        icon: '/assets/logo/logo.jpg',
                        requireInteraction: false
                    });
                    setTimeout(() => notification.close(), 5000);
                } catch (err) {
                    console.error('Test notification error:', err);
                }
            }, 500);
        } else {
            console.log('?? Notification permission denied');
            showToast('Permission denied. Check browser settings to enable.', '??');
            updateNotificationUI();
        }
    } catch (err) {
        console.error('? Error requesting notification permission:', err);
        showToast('Error requesting permission', '??');
    }
}

async function loadReminderSettings() {
    let settings = { enabled: false, time: '18:00' }; // Default to 6:00 PM

    // Try to load from verify-org response (already fetched on login)
    // This is more efficient than making a separate API call
    if (currentUser) {
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(SERVER_URL + `/api/user/verify-org?t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                if (data.reminderSettings) {
                    settings = { ...settings, ...data.reminderSettings };
                    // Sync to localStorage for offline access
                    localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(settings));
                }
            }
        } catch (err) {
            console.error('Failed to load reminder settings from API:', err);
        }
    }

    // Fallback to localStorage if API fails or user not logged in
    if (!settings.enabled) {
        try {
            const raw = localStorage.getItem(REMINDER_STORAGE_KEY);
            if (raw) settings = { ...settings, ...JSON.parse(raw) };
        } catch { /* ignore */ }
    }

    const enabledEl = document.getElementById('reminder-enabled');
    const timeEl = document.getElementById('reminder-time');
    if (enabledEl) enabledEl.checked = !!settings.enabled;
    if (timeEl && settings.time) timeEl.value = settings.time;

    scheduleDailyReminder(settings);
}

async function saveReminderSettings(partial) {
    let settings = { enabled: false, time: '18:00' }; // Default to 6:00 PM
    try {
        const raw = localStorage.getItem(REMINDER_STORAGE_KEY);
        if (raw) settings = { ...settings, ...JSON.parse(raw) };
    } catch { /* ignore */ }

    settings = { ...settings, ...partial };
    localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(settings));
    scheduleDailyReminder(settings);

    // Sync to Firestore via API
    if (currentUser) {
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(SERVER_URL + '/api/user/reminder-settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(settings)
            });

            if (!res.ok) {
                const error = await res.json();
                console.error('Failed to sync reminder settings:', error);
            } else {
                console.log('? Reminder settings synced to Firestore');
            }
        } catch (err) {
            console.error('Failed to sync reminder settings to Firestore:', err);
        }
    }
}

function scheduleDailyReminder(settings) {
    if (reminderTimeoutId) {
        clearTimeout(reminderTimeoutId);
        reminderTimeoutId = null;
    }

    if (!settings.enabled) {
        return;
    }

    const [hStr, mStr] = (settings.time || '18:00').split(':');
    const hours = parseInt(hStr, 10);
    const minutes = parseInt(mStr, 10);

    // Schedule into Native OS via Capacitor so it fires when app is closed
    if (window.notificationService && window.notificationService.isCapacitor) {
        const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;
        window.notificationService.scheduleNotification({
            id: 'daily-mood-checkin',
            title: isFilipino ? 'Pang-araw-araw na Check-in' : 'Daily Check-in',
            body: isFilipino ? 'Kamusta ang pakiramdam mo ngayon? I-log ang iyong mood sa Alwan.' : 'How are you feeling today? Log your mood in Alwan.',
            schedule: {
                on: {
                    hour: hours,
                    minute: minutes
                }
            },
            data: { type: 'mood-reminder' },
            sound: true
        });
        console.log(`? Native OS Daily Mood Reminder scheduled at ${settings.time}`);
    }

    // Schedule into Web Browser memory (only works while Tab/App is running in foreground)
    const now = new Date();
    const next = new Date();
    next.setHours(hours, minutes, 0, 0);

    // If time today has passed, schedule for tomorrow
    if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
    }

    const delay = next.getTime() - now.getTime();
    reminderTimeoutId = setTimeout(() => {
        // Check if user already logged mood for today
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

        const hasTodayEntry = moodCalendarEntries.some(entry => {
            const entryDate = entry.timestamp?.toDate?.() || new Date(entry.timestamp);
            const entryStr = entryDate.toISOString().split('T')[0];
            return entryStr === todayStr;
        });

        // Only fire notification if no mood entry for today
        if (!hasTodayEntry) {
            // Play notification sound
            playNotificationSound();

            const isFilipino = typeof currentLang !== 'undefined' ? currentLang === 'fil' : false;
            const title = isFilipino ? 'Pang-araw-araw na Check-in' : 'Daily Check-in';
            const body = isFilipino ? 'Kamusta ang pakiramdam mo ngayon?' : 'How are you feeling today?';

            // Fire browser notification (when tab or PWA is open)
            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    new Notification(title, {
                        body: body,
                        tag: 'Alwan-daily-reminder',
                        icon: '/assets/logo/logo.jpg'
                    });
                } catch {
                    showToast(body, '?');
                }
            } else {
                showToast(body, '?');
            }

            // Add to notification log
            addNotificationToLog(
                title,
                body,
                'reminder',
                'System',
                new Date()
            );
        } else {
            console.log('? User already logged mood today - skipping notification');
        }

        // Schedule the next one for the following day
        scheduleDailyReminder({ ...settings });
    }, delay);
}

// --- Goal Notifications (local notification, per device) --------
// Using real-time interval checker instead of timeouts
const GOAL_FIRED_KEY = 'psyc_goal_fired_today';
const IMP_DAY_FIRED_KEY = 'psyc_impday_fired';

function getFiredGoalsToday() {
    try {
        const data = JSON.parse(localStorage.getItem(GOAL_FIRED_KEY) || '{}');
        const today = new Date().toISOString().split('T')[0];
        if (data.date !== today) {
            localStorage.setItem(GOAL_FIRED_KEY, JSON.stringify({ date: today, ids: [] }));
            return [];
        }
        return data.ids || [];
    } catch { return []; }
}

function markGoalFiredToday(goalId) {
    const today = new Date().toISOString().split('T')[0];
    const firedIds = getFiredGoalsToday();
    if (!firedIds.includes(goalId)) {
        firedIds.push(goalId);
        localStorage.setItem(GOAL_FIRED_KEY, JSON.stringify({ date: today, ids: firedIds }));
    }
}

function getGoalFeedEntries() {
    try {
        const data = JSON.parse(localStorage.getItem('psyc_goal_feed_entries') || '{}');
        const today = new Date().toISOString().split('T')[0];
        if (data.date !== today) return [];
        return data.entries || [];
    } catch { return []; }
}

function saveGoalFeedEntry(entry) {
    const today = new Date().toISOString().split('T')[0];
    const entries = getGoalFeedEntries();
    if (!entries.find(e => e.id === entry.id)) {
        entries.push(entry);
        localStorage.setItem('psyc_goal_feed_entries', JSON.stringify({ date: today, entries }));
    }
}

// REAL-TIME NOTIFICATION ENGINE - Checks every second like the working example
let goalNotificationChecker = null;
let importantDayTimeouts = {};

function startGoalNotificationEngine() {
    // Stop existing checker if any
    if (goalNotificationChecker) {
        clearInterval(goalNotificationChecker);
    }

    console.log('?? Starting real-time notification engine...');

    // Load notified items from localStorage
    const notifiedGoals = JSON.parse(localStorage.getItem('psyc_notified_goals') || '{}');
    const notifiedDays = JSON.parse(localStorage.getItem('psyc_notified_important_days') || '{}');
    const today = new Date().toDateString();

    // Check every second
    goalNotificationChecker = setInterval(() => {
        const now = new Date();
        const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        let hasChanges = false;

        // Check GOALS
        if (goalsList && goalsList.length > 0 && currentUser) {
            goalsList.forEach(goal => {
                const userSettings = goal.userNotificationSettings?.[currentUser.uid] || {};
                const notifEnabled = userSettings.enabled !== false;

                // Handle new format (frequency + days + time)
                if (goal.reminderFrequency && goal.reminderTime) {
                    // Check if this goal should fire today
                    let shouldFireToday = false;
                    if (goal.reminderFrequency === 'daily') {
                        shouldFireToday = true;
                    } else if (goal.reminderFrequency === 'custom' && goal.reminderDays) {
                        shouldFireToday = goal.reminderDays.includes(currentDay);
                    }

                    if (!shouldFireToday) return;

                    // Check if already notified today (from localStorage)
                    const notifKey = `${goal.id}_${today}`;
                    const alreadyNotified = notifiedGoals[notifKey] === true;

                    // Check if time matches (HH:MM format)
                    const timeMatches = currentTime === goal.reminderTime;

                    // If time matches and not yet notified today and notifications enabled
                    if (timeMatches && !alreadyNotified && notifEnabled) {
                        console.log('?? Time reached for:', goal.title);
                        fireGoalNotification(goal);

                        // Mark as notified today in localStorage
                        notifiedGoals[notifKey] = true;
                        localStorage.setItem('psyc_notified_goals', JSON.stringify(notifiedGoals));

                        hasChanges = true;
                    }
                }
                // Handle old format (reminderDateTime) - for backward compatibility
                else if (goal.reminderDateTime) {
                    const notifKey = `${goal.id}_${goal.reminderDateTime}`;
                    const alreadyNotified = notifiedGoals[notifKey] === today;

                    const reminderTime = new Date(goal.reminderDateTime).getTime();
                    const nowMs = now.getTime();

                    // If time has arrived and not yet notified and notifications enabled
                    if (nowMs >= reminderTime && !alreadyNotified && notifEnabled) {
                        console.log('?? Time reached for:', goal.title);
                        fireGoalNotification(goal);

                        // Mark as notified in localStorage
                        notifiedGoals[notifKey] = today;
                        localStorage.setItem('psyc_notified_goals', JSON.stringify(notifiedGoals));

                        hasChanges = true;
                    }
                }
            });
        }

        // Check IMPORTANT DAYS
        if (allImportantDays && allImportantDays.length > 0) {
            allImportantDays.forEach(day => {
                if (!day.time) return; // Skip if no time set

                const dayDate = day.date; // YYYY-MM-DD
                const todayDate = now.toISOString().split('T')[0];

                // Only check if it's today
                if (dayDate !== todayDate) return;

                // Check if already notified
                const notifKey = `${day.id}_${dayDate}`;
                const alreadyNotified = notifiedDays[notifKey] === true;

                // Check if time matches
                const timeMatches = currentTime === day.time;

                if (timeMatches && !alreadyNotified) {
                    console.log('?? Time reached for important day:', day.title);
                    fireImportantDayNotification(day);

                    // Mark as notified
                    notifiedDays[notifKey] = true;
                    localStorage.setItem('psyc_notified_important_days', JSON.stringify(notifiedDays));

                    hasChanges = true;
                }
            });
        }

        if (hasChanges) {
            renderNotificationHistory();
        }
    }, 1000); // Check every second
}

// Test function - call this in console to test notification immediately
window.testGoalNotification = function () {
    console.log('?? Testing notification...');
    if (Notification.permission !== 'granted') {
        console.error('? Permission not granted. Current:', Notification.permission);
        Notification.requestPermission().then(p => {
            console.log('Permission result:', p);
            if (p === 'granted') {
                new Notification('Test', { body: 'Permission granted! Try again.' });
            }
        });
        return;
    }

    const testGoal = {
        id: 'test-123',
        title: 'Test Goal',
        description: 'This is a test notification'
    };

    fireGoalNotification(testGoal);
    console.log('? Test notification fired');
};

// Test function for important day notifications
window.testImportantDayNotification = function () {
    console.log('?? Testing important day notification...');

    const testDay = {
        id: 'test-day-123',
        title: 'Test Important Day',
        notes: 'This is a test important day notification',
        emoji: '??',
        color: '#ec4899',
        date: new Date().toISOString().split('T')[0]
    };

    showImportantDayNotification([testDay]);
    console.log('? Test important day notification fired');
};

function stopGoalNotificationEngine() {
    if (goalNotificationChecker) {
        clearInterval(goalNotificationChecker);
        goalNotificationChecker = null;
        console.log('?? Notification engine stopped');
    }
}

function fireGoalNotification(goal) {
    console.log('?? Firing notification for:', goal.title);

    // Show in-app notification modal
    showInAppGoalNotification(goal);

    // Save to notification history
    saveNotificationToHistory(goal);

    // Savet to persistent log via socket
    if (socket && socket.connected) {
        socket.emit('createNotification', {
            title: goal.title,
            body: goal.notes || 'Goal reminder reached!',
            type: 'goal',
            category: 'personal'
        });
    }

    // Send native device notification if available
    if (window.capacitorNotifications) {
        window.capacitorNotifications.sendGoalReminderNotification(goal);
    } else if (Notification.permission === "granted") {
        // Fallback for web
        try {
            new Notification("?? Goal Reminder", {
                body: `Hoy! Oras na para sa: ${goal.title}`,
                icon: "/assets/logo/logo.jpg",
                requireInteraction: true
            });
        } catch (e) {
            console.log('Browser notification blocked');
        }
    }
}

function showInAppGoalNotification(goal) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: fadeIn 0.3s;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        animation: slideUp 0.3s;
    `;

    const description = goal.description ? `<p style="font-size: 14px; color: #94a3b8; margin: 10px 0 20px 0;">${goal.description}</p>` : '';
    const goalType = goal.type === 'team' ? '?? Team Goal' : '?? Personal Goal';
    const typeColor = goal.type === 'team' ? '#8b5cf6' : '#6366f1';

    modal.innerHTML = `
        <div style="font-size: 60px; margin-bottom: 20px;">
            <i class="bi bi-bullseye" style="color: ${typeColor};"></i>
        </div>
        <div style="display: inline-block; background: ${typeColor}20; color: ${typeColor}; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-bottom: 10px;">
            ${goalType}
        </div>
        <h2 style="margin: 10px 0; color: #1e293b;">Goal Reminder!</h2>
        <p style="font-size: 18px; color: #64748b; margin: 0 0 10px 0;">
            It's time for:
        </p>
        <p style="font-size: 20px; font-weight: bold; color: ${typeColor}; margin: 0;">
            ${goal.title}
        </p>
        ${description}
        <button onclick="this.closest('div').parentElement.remove()" style="
            background: ${typeColor};
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            font-weight: bold;
        ">Got it!</button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Play sound
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGS57OihUBELTKXh8bllHAU2jdXvzn0pBSh+zPDajzsKElyx6OyrWBUIQ5zd8sFuJAUuhM/z24k2CBhku+zooVARC0yl4fG5ZRwFNo3V7859KQUofsz');
    audio.play().catch(() => { });

    // Auto-close after 10 seconds
    setTimeout(() => {
        if (overlay.parentElement) {
            overlay.remove();
        }
    }, 10000);

    console.log('? In-app notification shown');
}

function saveNotificationToHistory(goal) {
    const history = JSON.parse(localStorage.getItem('psyc_notification_history') || '[]');

    const notification = {
        id: Date.now(),
        goalId: goal.id,
        goalTitle: goal.title,
        goalDescription: goal.description || '',
        timestamp: Date.now(),
        type: 'goal',
        read: false
    };

    history.unshift(notification); // Add to beginning

    // Keep only last 50 notifications
    if (history.length > 50) {
        history.splice(50);
    }

    localStorage.setItem('psyc_notification_history', JSON.stringify(history));

    // Update notification bell badge
    updateNotificationBadge();

    console.log('? Notification saved to history');
}

function saveImportantDayToHistory(day) {
    const history = JSON.parse(localStorage.getItem('psyc_notification_history') || '[]');

    // Check if this day was already saved today (prevent duplicates)
    const today = new Date().toISOString().split('T')[0];
    const alreadySaved = history.some(n =>
        n.type === 'importantDay' &&
        n.dayId === day.id &&
        n.dayDate === today
    );

    if (alreadySaved) {
        console.log('?? Important day notification already in history, skipping');
        return;
    }

    // Generate unique ID using timestamp and counter
    const baseId = Date.now();
    let uniqueId = baseId;
    let counter = 1;
    while (history.some(n => n.id === uniqueId)) {
        uniqueId = baseId + counter;
        counter++;
    }

    const notification = {
        id: uniqueId,
        dayId: day.id,
        dayTitle: day.title,
        dayNotes: day.notes || '',
        dayEmoji: day.emoji || '??',
        dayColor: day.color || '#ec4899',
        dayDate: day.date,
        timestamp: Date.now(),
        type: 'importantDay',
        read: false
    };

    history.unshift(notification); // Add to beginning

    // Keep only last 50 notifications
    if (history.length > 50) {
        history.splice(50);
    }

    localStorage.setItem('psyc_notification_history', JSON.stringify(history));

    // Update notification bell badge
    updateNotificationBadge();

    console.log('? Important day notification saved to history');
}

function getNotificationHistory() {
    return JSON.parse(localStorage.getItem('psyc_notification_history') || '[]');
}

function markNotificationAsRead(notifId) {
    const history = getNotificationHistory();
    const notif = history.find(n => n.id === notifId);
    if (notif) {
        notif.read = true;
        localStorage.setItem('psyc_notification_history', JSON.stringify(history));
        updateNotificationBadge();
        renderNotificationHistory();
    }
}

function handleNotificationClick(notifId, goalId) {
    // Mark as read
    markNotificationAsRead(notifId);

    // Find the goal
    const goal = goalsList.find(g => g.id === goalId);
    if (goal) {
        // Open goals modal if not already open
        const goalsModal = document.getElementById('goals-modal');
        if (goalsModal && !goalsModal.classList.contains('open')) {
            openGoalsModal();
        }

        // Make sure we're on the list view (not edit form)
        if (document.getElementById('goal-form-view').style.display !== 'none') {
            hideGoalForm();
        }

        // Wait a bit for modal to open and render, then scroll to goal
        setTimeout(() => {
            // Find the goal element and scroll to it
            const goalElements = document.querySelectorAll('.goal-item');
            goalElements.forEach(el => {
                const goalTitle = el.querySelector('.goal-title');
                if (goalTitle && goalTitle.textContent.trim() === goal.title) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight the goal briefly
                    el.style.background = 'rgba(139, 92, 246, 0.15)';
                    el.style.transition = 'background 0.5s';
                    setTimeout(() => {
                        el.style.background = '';
                    }, 2000);
                }
            });
        }, 400);
    } else {
        showToast('Goal not found', '??');
    }
}

function handleImportantDayNotificationClick(notifId, dayId) {
    // Mark as read
    markNotificationAsRead(notifId);

    // Find the important day
    const day = allImportantDays.find(d => d.id === dayId);
    if (day) {
        // Open important days modal if not already open
        const importantDaysModal = document.getElementById('important-days-modal');
        if (importantDaysModal && !importantDaysModal.classList.contains('open')) {
            openImportantDaysModal();
        }

        // Wait a bit for modal to open and render, then scroll to day
        setTimeout(() => {
            // Find the day element and scroll to it
            const dayElements = document.querySelectorAll('.important-day-item');
            dayElements.forEach(el => {
                const dayTitle = el.querySelector('.important-day-title');
                if (dayTitle && dayTitle.textContent.trim() === day.title) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight the day briefly
                    el.style.background = 'rgba(236, 72, 153, 0.15)';
                    el.style.transition = 'background 0.5s';
                    setTimeout(() => {
                        el.style.background = '';
                    }, 2000);
                }
            });
        }, 400);
    } else {
        showToast('Important day not found', '??');
    }
}

function markAllNotificationsAsRead() {
    const history = getNotificationHistory();
    history.forEach(n => n.read = true);
    localStorage.setItem('psyc_notification_history', JSON.stringify(history));
    updateNotificationBadge();
}

function clearNotificationHistory() {
    localStorage.setItem('psyc_notification_history', '[]');
    updateNotificationBadge();
    renderNotificationHistory();
}

function updateNotificationBadge() {
    const history = getNotificationHistory();
    const unreadCount = history.filter(n => !n.read).length;

    const badge = document.getElementById('notification-badge');
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function renderNotificationHistory() {
    const container = document.getElementById('notification-history-list');
    if (!container) return;

    const history = getNotificationHistory();

    if (history.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 12px; color: #94a3b8;">
                <i class="bi bi-bell-slash" style="font-size: 28px; margin-bottom: 6px; opacity: 0.4;"></i>
                <p style="margin: 0; font-size: 13px;">No new notifications</p>
            </div>
        `;
        return;
    }

    // Sort: unread first, then by timestamp (newest first)
    const sortedHistory = [...history].sort((a, b) => {
        if (a.read !== b.read) {
            return a.read ? 1 : -1; // Unread first
        }
        return b.timestamp - a.timestamp; // Newest first within same read status
    });

    container.innerHTML = sortedHistory.map(notif => {
        const date = new Date(notif.timestamp);
        const timeAgo = getTimeAgo(notif.timestamp);

        if (notif.type === 'importantDay') {
            // Important Day notification
            const emoji = notif.dayEmoji || '??';
            const color = notif.dayColor || '#ec4899';
            return `
                <div class="notification-item ${notif.read ? 'read' : 'unread'}" onclick="handleImportantDayNotificationClick(${notif.id}, '${notif.dayId}')">
                    <div class="notification-icon">
                        <i class="bi bi-calendar-event" style="font-size: 24px; color: ${color};"></i>
                    </div>
                    <div class="notification-content">
                        <div class="notification-title">${notif.dayTitle}</div>
                        ${notif.dayNotes ? `<div class="notification-desc">${notif.dayNotes}</div>` : ''}
                        <div class="notification-time">${timeAgo}</div>
                    </div>
                    ${!notif.read ? '<div class="notification-unread-dot"></div>' : ''}
                </div>
            `;
        } else {
            // Goal notification
            return `
                <div class="notification-item ${notif.read ? 'read' : 'unread'}" onclick="handleNotificationClick(${notif.id}, '${notif.goalId}')">
                    <div class="notification-icon">
                        <i class="bi bi-bullseye" style="font-size: 24px; color: #8b5cf6;"></i>
                    </div>
                    <div class="notification-content">
                        <div class="notification-title">${notif.goalTitle}</div>
                        ${notif.goalDescription ? `<div class="notification-desc">${notif.goalDescription}</div>` : ''}
                        <div class="notification-time">${timeAgo}</div>
                    </div>
                    ${!notif.read ? '<div class="notification-unread-dot"></div>' : ''}
                </div>
            `;
        }
    }).join('');
}

function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return new Date(timestamp).toLocaleDateString();
}

function forceRescheduleGoalNotifications() {
    // Restart the engine
    startGoalNotificationEngine();
}

// --- Group Debriefing Functions ------------------------------------
let allDebriefings = [];
let currentDebriefingVisibility = 'all';
let selectedDebriefingMembers = [];
let editingDebriefingId = null;

function openDebriefingModal() {
    closeFabMenu();
    const modal = document.getElementById('debriefing-modal');
    if (modal) {
        document.getElementById('debriefing-list-view').style.display = 'block';
        document.getElementById('debriefing-form-view').style.display = 'none';

        // Show add button only for supervisors
        const addBtn = document.getElementById('debriefing-add-btn');
        if (addBtn) {
            addBtn.style.display = isSupervisor ? 'flex' : 'none';
        }

        // Load debriefings when modal opens (not on page load)
        loadDebriefings();

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function openDebriefingScheduleModal() {
    // Open modal directly to schedule form (for supervisors)
    const modal = document.getElementById('debriefing-modal');
    if (modal) {
        // Check if user is supervisor
        if (!isSupervisor) {
            showToast('Only supervisors can schedule debriefing sessions', '??');
            return;
        }

        // Show form view directly
        document.getElementById('debriefing-list-view').style.display = 'none';
        document.getElementById('debriefing-form-view').style.display = 'block';

        // Update header
        const sheetTitle = document.querySelector('#debriefing-modal .sheet-title');
        const addBtn = document.getElementById('debriefing-add-btn');

        if (sheetTitle) sheetTitle.textContent = 'Schedule Debriefing';
        if (addBtn) {
            addBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
            addBtn.onclick = saveDebriefing;
            addBtn.style.display = 'flex';
        }

        // Reset form
        document.getElementById('debriefing-title').value = '';
        document.getElementById('debriefing-date').value = '';
        document.getElementById('debriefing-time').value = '';
        document.getElementById('debriefing-description').value = '';

        currentDebriefingVisibility = 'all';
        selectedDebriefingMembers = [];
        editingDebriefingId = null;

        selectDebriefingVisibility('all');
        loadTeamMembersForDebriefing();

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeDebriefingModal() {
    const modal = document.getElementById('debriefing-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function openUpcomingDebriefingsModal() {
    const modal = document.getElementById('upcoming-debriefings-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadUpcomingDebriefings();
    }
}

function closeUpcomingDebriefingsModal() {
    const modal = document.getElementById('upcoming-debriefings-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

async function loadUpcomingDebriefings() {
    console.log('?? loadUpcomingDebriefings called');

    const orgId = storageGet('psyc_orgId');
    console.log('?? orgId:', orgId);
    if (!orgId) {
        console.log('? No orgId');
        return;
    }

    if (!currentUser) {
        console.log('? No currentUser');
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + `/api/debriefings/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log('?? Response status:', res.status);

        if (res.ok) {
            const debriefings = await res.json();
            console.log('?? All debriefings:', debriefings);
            const now = new Date();
            console.log('?? Current time:', now);

            // Filter upcoming sessions only
            const currentUserId = currentUser.uid;
            const upcoming = debriefings.filter(d => {
                console.log(`?? Checking debriefing: ${d.title}, date: ${d.date}, time: ${d.time}`);
                const sessionDate = new Date(`${d.date}T${d.time}`);
                console.log(`  Session date parsed: ${sessionDate}, isValid: ${!isNaN(sessionDate.getTime())}`);
                const isUpcoming = sessionDate >= now;
                const isVisible = d.visibility === 'all' ||
                    (d.visibility === 'specific' && d.members && d.members.includes(currentUserId)) ||
                    d.createdBy === currentUserId ||
                    window.isSupervisor;
                console.log(`  Is upcoming: ${isUpcoming}, Is visible: ${isVisible}`);
                return isUpcoming && isVisible;
            }).sort((a, b) => {
                const dateA = new Date(`${a.date}T${a.time}`);
                const dateB = new Date(`${b.date}T${b.time}`);
                return dateA - dateB;
            });

            console.log('? Upcoming sessions:', upcoming);
            window.upcomingDebriefingsList = upcoming; // Export for checkReminders to use

            // Update count in card
            const countEl = document.getElementById('upcoming-count');
            if (countEl) {
                countEl.textContent = upcoming.length;
                console.log('?? Updated count to:', upcoming.length);
            }

            // Show/hide card based on count
            const card = document.getElementById('upcoming-debriefing-card');
            if (card) {
                card.style.display = upcoming.length > 0 ? 'block' : 'none';
            }

            // Update modal content if container exists
            const container = document.getElementById('upcoming-debriefings-list');
            if (!container) {
                console.log('?? Modal container not found, skipping modal update');
                return;
            }

            if (upcoming.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center;padding:60px 20px;color:#94a3b8;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:64px;height:64px;margin:0 auto 16px;opacity:0.3;">
                            <path d="M12.75 12.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM7.5 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM8.25 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM9.75 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM10.5 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM12.75 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM14.25 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM15 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM16.5 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM15 12.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM16.5 13.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                            <path fill-rule="evenodd" d="M6.75 2.25A.75.75 0 017.5 3v1.5h9V3A.75.75 0 0118 3v1.5h.75a3 3 0 013 3v11.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V7.5a3 3 0 013-3H6V3a.75.75 0 01.75-.75zm13.5 9a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v7.5a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5v-7.5z" clip-rule="evenodd" />
                        </svg>
                        <p style="font-size:0.95rem;line-height:1.6;">No upcoming debriefing sessions scheduled</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = upcoming.map(d => {
                const sessionDate = new Date(`${d.date}T${d.time}`);
                const dateStr = sessionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = sessionDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

                // Check if session has started (current time >= session time)
                const now = new Date();
                const hasStarted = now >= sessionDate;

                // Detect meeting platform
                let meetingPlatform = null;
                let meetingIcon = '';
                let meetingBg = '#3b82f6';

                if (d.meetingLink) {
                    const link = d.meetingLink.toLowerCase();
                    if (link.includes('zoom.us')) {
                        meetingPlatform = 'Zoom';
                        meetingBg = '#2563eb';
                        // Zoom logo SVG
                        meetingIcon = `<svg viewBox="0 0 24 24" fill="white" style="width:20px;height:20px;">
                            <path d="M2 8.5C2 7.67 2.67 7 3.5 7h10c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-10C2.67 17 2 16.33 2 15.5v-7zm19.5 1.5l-4 3v-3l4-3v6z"/>
                        </svg>`;
                    } else if (link.includes('meet.google.com') || link.includes('meet.google')) {
                        meetingPlatform = 'Google Meet';
                        meetingBg = '#ea580c';
                        // Google Meet logo SVG
                        meetingIcon = `<svg viewBox="0 0 24 24" fill="white" style="width:20px;height:20px;">
                            <path d="M17 13h4v-2h-4m0-2h4V7h-4m0 10h4v-2h-4M3 19h14v-6.5l4 3.5V8l-4 3.5V5H3v14z"/>
                        </svg>`;
                    } else {
                        meetingPlatform = 'Join Meeting';
                        meetingBg = '#3b82f6';
                        meetingIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" style="width:20px;height:20px;">
                            <path fill-rule="evenodd" d="M19.902 4.098a3.75 3.75 0 00-5.304 0l-4.5 4.5a3.75 3.75 0 001.035 6.037.75.75 0 01-.646 1.353 5.25 5.25 0 01-1.449-8.45l4.5-4.5a5.25 5.25 0 117.424 7.424l-1.757 1.757a.75.75 0 11-1.06-1.06l1.757-1.757a3.75 3.75 0 000-5.304zm-7.389 4.267a.75.75 0 011-.353 5.25 5.25 0 011.449 8.45l-4.5 4.5a5.25 5.25 0 11-7.424-7.424l1.757-1.757a.75.75 0 111.06 1.06l-1.757 1.757a3.75 3.75 0 105.304 5.304l4.5-4.5a3.75 3.75 0 00-1.035-6.037.75.75 0 01-.354-1z" clip-rule="evenodd" />
                        </svg>`;
                    }
                }

                const isDark = document.body.classList.contains('dark-mode');
                return `
                    <div style="padding:12px 4px;margin-bottom:0;border-bottom:1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'};transition:background 0.15s;" 
                         onmouseover="this.style.background='${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}';"
                         onmouseout="this.style.background='transparent';">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
                            <div style="font-weight:700;font-size:0.95rem;color:${isDark ? '#f1f5f9' : '#1e293b'};">${escapeHtml(d.title)}</div>
                            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;font-size:0.8rem;">
                                <span style="color:${isDark ? '#94a3b8' : '#64748b'};font-size:0.78rem;">${dateStr}</span>
                                <span style="color:${isDark ? '#94a3b8' : '#64748b'};font-size:0.78rem;">${timeStr}</span>
                            </div>
                        </div>
                        <div style="display:none;"><!-- date/time moved to title row --></div>
                        ${d.description ? `<div style="font-size:0.82rem;color:${isDark ? '#94a3b8' : '#64748b'};line-height:1.4;margin-bottom:8px;">${escapeHtml(d.description)}</div>` : ''}
                        ${d.meetingLink ? `
                            <div style="display:flex;justify-content:flex-end;margin-top:6px;">
                                ${hasStarted ? `
                                    <a href="${escapeHtml(d.meetingLink)}" target="_blank" rel="noopener noreferrer" 
                                       style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;background:${meetingBg};color:white;border-radius:50px;font-size:0.8rem;font-weight:600;text-decoration:none;transition:opacity 0.2s;white-space:nowrap;"
                                       onmouseover="this.style.opacity='0.85';"
                                       onmouseout="this.style.opacity='1';">
                                        ${meetingIcon}
                                        <span>${meetingPlatform}</span>
                                    </a>
                                ` : `
                                    <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;background:#94a3b8;color:white;border-radius:50px;font-size:0.8rem;font-weight:600;opacity:0.4;cursor:not-allowed;white-space:nowrap;">
                                        ${meetingIcon.replace(/fill="white"/g, 'fill="#e2e8f0"')}
                                        <span>${meetingPlatform}</span>
                                    </div>
                                `}
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Error loading upcoming debriefings:', err);
    }
}

async function loadOngoingDebriefings() {
    console.log('?? loadOngoingDebriefings called');

    const orgId = storageGet('psyc_orgId');
    console.log('?? orgId:', orgId);
    if (!orgId) {
        console.log('? No orgId');
        return;
    }

    if (!currentUser) {
        console.log('? No currentUser');
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + `/api/debriefings/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log('?? Response status:', res.status);

        if (res.ok) {
            const debriefings = await res.json();
            console.log('?? All debriefings:', debriefings);
            const now = new Date();
            console.log('?? Current time:', now);

            // Filter ongoing sessions (reached scheduled time but not completed) 
            // AND completed sessions without evaluation form
            const currentUserId = currentUser.uid;
            const ongoing = debriefings.filter(d => {
                console.log(`?? Checking debriefing: ${d.title}, date: ${d.date}, time: ${d.time}, status: ${d.status}, hasEvaluation: ${d.hasEvaluationForm}`);
                const sessionDate = new Date(`${d.date}T${d.time}`);
                console.log(`  Session date parsed: ${sessionDate}, isValid: ${!isNaN(sessionDate.getTime())}`);

                // Show if: reached time AND (not completed OR completed but no evaluation form)
                const isOngoing = sessionDate <= now && (d.status !== 'completed' || (d.status === 'completed' && !d.hasEvaluationForm));
                const isVisible = d.visibility === 'all' ||
                    (d.visibility === 'specific' && d.members && d.members.includes(currentUserId)) ||
                    d.createdBy === currentUserId ||
                    window.isSupervisor;
                console.log(`  Is ongoing: ${isOngoing}, Is visible: ${isVisible}`);
                return isOngoing && isVisible;
            }).sort((a, b) => {
                const dateA = new Date(`${a.date}T${a.time}`);
                const dateB = new Date(`${b.date}T${b.time}`);
                return dateB - dateA; // Most recent first
            });

            console.log('? Ongoing sessions:', ongoing);

            // Update count in card
            const countEl = document.getElementById('ongoing-count');
            if (countEl) {
                countEl.textContent = ongoing.length;
                console.log('?? Updated count to:', ongoing.length);
            }

            // Show card only when there are ongoing sessions
            const card = document.getElementById('ongoing-debriefing-card');
            if (card) {
                card.style.display = ongoing.length > 0 ? 'block' : 'none';
            }

            // Update modal content if container exists
            const container = document.getElementById('ongoing-debriefings-list');
            if (!container) {
                console.log('?? Modal container not found, skipping modal update');
                return;
            }

            if (ongoing.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center;padding:60px 20px;color:#94a3b8;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:64px;height:64px;margin:0 auto 16px;opacity:0.3;">
                            <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z" clip-rule="evenodd" />
                        </svg>
                        <p style="font-size:0.95rem;line-height:1.6;">No ongoing debriefing sessions</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = ongoing.map(d => {
                const sessionDate = new Date(`${d.date}T${d.time}`);
                const dateStr = sessionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = sessionDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

                // Detect meeting platform
                let meetingIcon = '';
                let meetingBg = '#f97316';

                if (d.meetingLink) {
                    const link = d.meetingLink.toLowerCase();
                    if (link.includes('zoom.us')) {
                        meetingBg = '#2563eb';
                        meetingIcon = `<svg viewBox="0 0 24 24" fill="white" style="width:20px;height:20px;">
                            <path d="M2 8.5C2 7.67 2.67 7 3.5 7h10c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-10C2.67 17 2 16.33 2 15.5v-7zm19.5 1.5l-4 3v-3l4-3v6z"/>
                        </svg>`;
                    } else if (link.includes('meet.google.com') || link.includes('meet.google')) {
                        meetingBg = '#ea580c';
                        meetingIcon = `<svg viewBox="0 0 24 24" fill="white" style="width:20px;height:20px;">
                            <path d="M17 13h4v-2h-4m0-2h4V7h-4m0 10h4v-2h-4M3 19h14v-6.5l4 3.5V8l-4 3.5V5H3v14z"/>
                        </svg>`;
                    } else {
                        meetingBg = '#f97316';
                        meetingIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" style="width:20px;height:20px;">
                            <path fill-rule="evenodd" d="M19.902 4.098a3.75 3.75 0 00-5.304 0l-4.5 4.5a3.75 3.75 0 001.035 6.037.75.75 0 01-.646 1.353 5.25 5.25 0 01-1.449-8.45l4.5-4.5a5.25 5.25 0 117.424 7.424l-1.757 1.757a.75.75 0 11-1.06-1.06l1.757-1.757a3.75 3.75 0 000-5.304zm-7.389 4.267a.75.75 0 011-.353 5.25 5.25 0 011.449 8.45l-4.5 4.5a5.25 5.25 0 11-7.424-7.424l1.757-1.757a.75.75 0 111.06 1.06l-1.757 1.757a3.75 3.75 0 105.304 5.304l4.5-4.5a3.75 3.75 0 00-1.035-6.037.75.75 0 01-.354-1z" clip-rule="evenodd" />
                        </svg>`;
                    }
                }

                const isDark = document.body.classList.contains('dark-mode');
                return `
                    <div style="padding:12px 4px;margin-bottom:0;border-bottom:1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'};transition:background 0.15s;" 
                         onmouseover="this.style.background='${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}';"
                         onmouseout="this.style.background='transparent';">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
                            <div style="font-weight:700;font-size:0.95rem;color:${isDark ? '#f1f5f9' : '#1e293b'};word-wrap:break-word;">${escapeHtml(d.title)}</div>
                            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;font-size:0.8rem;">
                                <span style="color:${isDark ? '#94a3b8' : '#64748b'};font-size:0.78rem;">${dateStr}</span>
                                <span style="color:${isDark ? '#94a3b8' : '#64748b'};font-size:0.78rem;">${timeStr}</span>
                            </div>
                        </div>
                        ${d.description ? `<div style="font-size:0.82rem;color:${isDark ? '#94a3b8' : '#64748b'};line-height:1.4;margin-bottom:8px;word-wrap:break-word;">${escapeHtml(d.description)}</div>` : ''}
                        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
                            ${window.isSupervisor ? (d.status === 'completed' ? `
                                <button onclick='openEvaluationFormBuilder(${JSON.stringify(d).replace(/'/g, "&#39;")})' 
                                   style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;background:rgba(251,146,60,0.15);color:#fb923c;border:1px solid rgba(251,146,60,0.3);border-radius:50px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:opacity 0.15s;backdrop-filter:blur(4px);"
                                   onmouseover="this.style.opacity='0.8';"
                                   onmouseout="this.style.opacity='1';">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fb923c" style="width:14px;height:14px;flex-shrink:0;">
                                        <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a1.875 1.875 0 01-1.875-1.875V5.25A3.75 3.75 0 009 1.5H5.625z" />
                                        <path d="M12.971 1.816A5.23 5.23 0 0114.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 013.434 1.279 9.768 9.768 0 00-6.963-6.963z" />
                                    </svg>
                                    <span>Create Form</span>
                                </button>
                            ` : `
                                <button onclick="markDebriefingAsDone('${d.id}')" 
                                   style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);border-radius:50px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:opacity 0.15s;backdrop-filter:blur(4px);"
                                   onmouseover="this.style.opacity='0.85';"
                                   onmouseout="this.style.opacity='1';">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#10b981" style="width:14px;height:14px;flex-shrink:0;">
                                        <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" />
                                    </svg>
                                    <span>Mark as Done</span>
                                </button>
                            `) : ''}
                            ${d.meetingLink && d.status !== 'completed' ? `
                                <a href="${escapeHtml(d.meetingLink)}" target="_blank" rel="noopener noreferrer" 
                                   style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;background:${meetingBg};color:white;border-radius:50px;font-size:0.8rem;font-weight:600;text-decoration:none;transition:opacity 0.15s;white-space:nowrap;"
                                   onmouseover="this.style.opacity='0.85';"
                                   onmouseout="this.style.opacity='1';">
                                    ${meetingIcon}
                                    <span>Join</span>
                                </a>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Error loading ongoing debriefings:', err);
    }
}

// Mark debriefing as done (supervisor only)
async function markDebriefingAsDone(debriefingId) {
    if (!window.isSupervisor) {
        showToast('Only supervisors can mark sessions as done', '??');
        return;
    }

    if (!confirm('Mark this session as completed?')) {
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        const res = await fetch(SERVER_URL + '/api/debriefings/mark-done', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ debriefingId, orgId })
        });

        if (res.ok) {
            showToast('Session marked as completed!', '?');
            await loadOngoingDebriefings();
            await loadCompletedSessions();
            await loadDebriefings(); // Refresh supervisor list
        } else {
            const error = await res.json();
            showToast(error.error || 'Failed to mark session as done', '?');
        }
    } catch (err) {
        console.error('Error marking debriefing as done:', err);
        showToast('Failed to mark session as done', '?');
    }
}

// Load completed debriefing sessions for Discussion tab
async function loadCompletedSessions() {
    console.log('?? loadCompletedSessions called');
    const container = document.getElementById('completed-sessions-container');
    if (!container) {
        console.log('? Container not found');
        return;
    }

    const orgId = storageGet('psyc_orgId');
    if (!orgId) {
        console.log('? No orgId');
        return;
    }

    if (!currentUser) {
        console.log('? No currentUser');
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + `/api/debriefings/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const debriefings = await res.json();

            // Filter completed sessions with evaluation forms only AND not expired
            const completed = debriefings.filter(d => {
                if (d.status !== 'completed' || !d.hasEvaluationForm) return false;

                // Check if evaluation period is still open
                const baseDateVal = d.evaluationForm && d.evaluationForm.createdAt ? new Date(d.evaluationForm.createdAt) : (d.completedAt ? new Date(d.completedAt) : new Date(`${d.date}T${d.time}`));
                const evaluationDuration = d.evaluationDuration || 24;
                const evaluationDeadline = new Date(baseDateVal.getTime() + (evaluationDuration * 60 * 60 * 1000));
                const now = new Date();

                // Only show if NOT expired (still accepting responses)
                return now <= evaluationDeadline;
            })
                .sort((a, b) => {
                    const dateA = new Date(`${a.date}T${a.time}`);
                    const dateB = new Date(`${b.date}T${b.time}`);
                    return dateB - dateA; // Most recent first
                });

            console.log('? Completed sessions with evaluation:', completed);

            if (completed.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center;padding:30px 20px;color:#94a3b8;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:48px;height:48px;margin:0 auto 12px;opacity:0.3;">
                            <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" />
                        </svg>
                        <p style="font-size:0.9rem;line-height:1.6;margin:0;">No discussion yet</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = completed.map(d => {
                const sessionDate = new Date(`${d.date}T${d.time}`);
                const dateStr = sessionDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

                // Check if current user has already submitted evaluation
                const userEmail = currentUser.email;
                const emailKey = userEmail.replace(/\./g, '_');
                const hasSubmitted = d.evaluationResponses && d.evaluationResponses[emailKey];

                // Calculate time remaining for evaluation
                const baseDateVal = d.evaluationForm && d.evaluationForm.createdAt ? new Date(d.evaluationForm.createdAt) : (d.completedAt ? new Date(d.completedAt) : new Date(`${d.date}T${d.time}`));
                const evaluationDuration = d.evaluationDuration || 24;
                const evaluationDeadline = new Date(baseDateVal.getTime() + (evaluationDuration * 60 * 60 * 1000));
                const now = new Date();
                const isExpired = now > evaluationDeadline;
                const timeRemaining = evaluationDeadline - now;
                const hoursRemaining = Math.floor(timeRemaining / (1000 * 60 * 60));
                const daysRemaining = Math.floor(hoursRemaining / 24);

                let durationBadge = '';
                if (!hasSubmitted && !window.isSupervisor) {
                    if (isExpired) {
                        durationBadge = `<span style="background:transparent;color:#dc2626;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:600;">Expired</span>`;
                    } else if (hoursRemaining < 24) {
                        durationBadge = `<span style="background:transparent;color:#d97706;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:600;">${hoursRemaining}h left</span>`;
                    } else {
                        durationBadge = `<span style="background:transparent;color:#2563eb;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:600;">${daysRemaining}d left</span>`;
                    }
                }

                return `
                    <div style="background:rgba(255,255,255,0.7);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:18px;border:2px solid rgba(255,255,255,0.5);box-shadow:0 8px 32px rgba(14,165,233,0.12),0 2px 8px rgba(0,0,0,0.05),inset 0 1px 0 rgba(255,255,255,0.8);padding:20px;margin-bottom:16px;transition:all 0.3s ease;display:flex;align-items:center;gap:16px;" onmouseover="this.style.boxShadow='0 12px 40px rgba(14,165,233,0.18),0 4px 12px rgba(0,0,0,0.08),inset 0 1px 0 rgba(255,255,255,0.9)';this.style.transform='translateY(-2px)'" onmouseout="this.style.boxShadow='0 8px 32px rgba(14,165,233,0.12),0 2px 8px rgba(0,0,0,0.05),inset 0 1px 0 rgba(255,255,255,0.8)';this.style.transform='translateY(0)'">
                        <div style="width:56px;height:56px;background:linear-gradient(135deg,#3b82f6,#2563eb);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 12px rgba(59,130,246,0.3);">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" style="width:28px;height:28px;">
                                <path fill-rule="evenodd" d="M3 6a3 3 0 013-3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6zm4.5 7.5a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0v-2.25a.75.75 0 01.75-.75zm3.75-1.5a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0V12zm2.25-3a.75.75 0 01.75.75v6.75a.75.75 0 01-1.5 0V9.75A.75.75 0 0113.5 9zm3.75-1.5a.75.75 0 00-1.5 0v9a.75.75 0 001.5 0v-9z" clip-rule="evenodd" />
                            </svg>
                        </div>
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:8px;">
                                <h3 style="font-size:1.1rem;font-weight:700;color:#1e293b;margin:0;line-height:1.3;flex:1;">${escapeHtml(d.title)}</h3>
                                ${durationBadge ? `<div style="flex-shrink:0;">${durationBadge}</div>` : ''}
                            </div>
                            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                                <span style="font-size:0.85rem;color:#64748b;display:flex;align-items:center;gap:4px;">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;">
                                        <path fill-rule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clip-rule="evenodd" />
                                    </svg>
                                    ${dateStr}
                                </span>
                                <span style="background:#dcfce7;color:#16a34a;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:600;">
                                    Completed
                                </span>
                            </div>
                        </div>
                        
                        ${window.isSupervisor ? `
                            <div style="display:flex;gap:10px;align-items:center;">
                                <button onclick="openEvaluationResults('${d.id}', '${escapeHtml(d.title)}')" 
                                    style="width:40px;height:40px;background:rgba(139,92,246,0.15);border:none;border-radius:50%;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
                                    onmouseover="this.style.background='rgba(139,92,246,0.25)';this.style.transform='scale(1.05)';"
                                    onmouseout="this.style.background='rgba(139,92,246,0.15)';this.style.transform='scale(1)';">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#8b5cf6" style="width:20px;height:20px;">
                                        <path fill-rule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 013.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 013.75 3.75v7.875c0 1.035-.84 1.875-1.875 1.875H5.625a1.875 1.875 0 01-1.875-1.875V3.375c0-1.036.84-1.875 1.875-1.875zM9.75 17.25a.75.75 0 00-1.5 0V18a.75.75 0 001.5 0v-.75zm2.25-3a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3a.75.75 0 01.75-.75zm3.75-1.5a.75.75 0 00-1.5 0V18a.75.75 0 001.5 0v-5.25z" clip-rule="evenodd" />
                                        <path d="M14.25 5.25a5.23 5.23 0 00-1.279-3.434 9.768 9.768 0 016.963 6.963A5.23 5.23 0 0016.5 7.5h-1.875a.375.375 0 01-.375-.375V5.25z" />
                                    </svg>
                                </button>
                            </div>
                        ` : `
                            <div style="display:flex;gap:10px;align-items:center;">
                                ${hasSubmitted ? `
                                    <div style="width:40px;height:40px;background:rgba(34,197,94,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#22c55e" style="width:20px;height:20px;">
                                            <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" />
                                        </svg>
                                    </div>
                                ` : `
                                    <button onclick="openEvaluationFormViewer('${d.id}', '${escapeHtml(d.title)}')" 
                                        style="width:40px;height:40px;background:rgba(59,130,246,0.15);border:none;border-radius:50%;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
                                        onmouseover="this.style.background='rgba(59,130,246,0.25)';this.style.transform='scale(1.05)';"
                                        onmouseout="this.style.background='rgba(59,130,246,0.15)';this.style.transform='scale(1)';">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3b82f6" style="width:20px;height:20px;">
                                            <path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z" />
                                        </svg>
                                    </button>
                                `}
                            </div>
                        `}
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Error loading completed sessions:', err);
    }
}

// Open evaluation form builder (Phase 2 - to be implemented)
function openEvaluationFormBuilder(debriefing) {
    console.log('Opening evaluation form builder for:', debriefing);

    // Store current debriefing ID
    window.currentEvaluationDebriefingId = debriefing.id;

    // Reset questions array
    window.evaluationQuestions = [];

    // Show session info banner
    const infoBanner = document.getElementById('evaluation-form-session-info');
    const titleEl = document.getElementById('eval-form-session-title');
    const detailsEl = document.getElementById('eval-form-session-details');

    if (infoBanner && titleEl && detailsEl) {
        const sessionDate = new Date(`${debriefing.date}T${debriefing.time}`);
        const dateStr = sessionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = sessionDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        titleEl.textContent = debriefing.title;
        detailsEl.innerHTML = `${dateStr} at ${timeStr}`;
        infoBanner.style.display = 'block';
    }

    // Set duration input value (default to existing or 24)
    const durationInput = document.getElementById('evaluation-duration');
    if (durationInput) {
        durationInput.value = debriefing.evaluationDuration || 24;
    }

    // Open modal
    const modal = document.getElementById('evaluation-form-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        renderEvaluationQuestions();
    }
}

function closeEvaluationFormModal() {
    const modal = document.getElementById('evaluation-form-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function addEvaluationQuestion() {
    const question = {
        id: Date.now(),
        text: '',
        type: 'text' // 'text' or 'rating'
    };

    if (!window.evaluationQuestions) {
        window.evaluationQuestions = [];
    }

    window.evaluationQuestions.push(question);
    renderEvaluationQuestions();
}

function removeEvaluationQuestion(questionId) {
    window.evaluationQuestions = window.evaluationQuestions.filter(q => q.id !== questionId);
    renderEvaluationQuestions();
}

function updateQuestionText(questionId, text) {
    const question = window.evaluationQuestions.find(q => q.id === questionId);
    if (question) {
        question.text = text;
    }
}

function updateQuestionType(questionId, type) {
    const question = window.evaluationQuestions.find(q => q.id === questionId);
    if (question) {
        question.type = type;
        // Initialize options array for multiple choice
        if (type === 'multiple_choice' && !question.options) {
            question.options = ['Option 1', 'Option 2'];
        }
    }
}

function addMultipleChoiceOption(questionId) {
    const question = window.evaluationQuestions.find(q => q.id === questionId);
    if (question && question.type === 'multiple_choice') {
        if (!question.options) question.options = [];
        question.options.push(`Option ${question.options.length + 1}`);
        renderEvaluationQuestions();
    }
}

function removeMultipleChoiceOption(questionId, optionIndex) {
    const question = window.evaluationQuestions.find(q => q.id === questionId);
    if (question && question.type === 'multiple_choice' && question.options) {
        question.options.splice(optionIndex, 1);
        renderEvaluationQuestions();
    }
}

function updateMultipleChoiceOption(questionId, optionIndex, value) {
    const question = window.evaluationQuestions.find(q => q.id === questionId);
    if (question && question.type === 'multiple_choice' && question.options) {
        question.options[optionIndex] = value;
    }
}

function renderEvaluationQuestions() {
    const container = document.getElementById('evaluation-questions-list');
    if (!container) return;

    if (!window.evaluationQuestions || window.evaluationQuestions.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px 20px;color:#94a3b8;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:48px;height:48px;margin:0 auto 12px;opacity:0.3;">
                    <path fill-rule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 013.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 013.75 3.75v7.875c0 1.035-.84 1.875-1.875 1.875H5.625a1.875 1.875 0 01-1.875-1.875V3.375c0-1.036.84-1.875 1.875-1.875zm6.905 9.97a.75.75 0 00-1.06 0l-3 3a.75.75 0 101.06 1.06l1.72-1.72V18a.75.75 0 001.5 0v-4.19l1.72 1.72a.75.75 0 101.06-1.06l-3-3z" clip-rule="evenodd" />
                    <path d="M14.25 5.25a5.23 5.23 0 00-1.279-3.434 9.768 9.768 0 016.963 6.963A5.23 5.23 0 0016.5 7.5h-1.875a.375.375 0 01-.375-.375V5.25z" />
                </svg>
                <p style="font-size:0.9rem;">No questions yet. Click "Add Question" to start.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = window.evaluationQuestions.map((q, index) => `
        <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span style="font-weight:700;color:#64748b;font-size:0.85rem;">Question ${index + 1}</span>
                <button onclick="removeEvaluationQuestion(${q.id})" 
                    style="background:#fee2e2;color:#dc2626;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:0.8rem;font-weight:600;transition:all 0.2s;"
                    onmouseover="this.style.background='#fecaca';"
                    onmouseout="this.style.background='#fee2e2';">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;display:inline-block;vertical-align:middle;">
                        <path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 013.878.512.75.75 0 11-.256 1.478l-.209-.035-1.005 13.07a3 3 0 01-2.991 2.77H8.084a3 3 0 01-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 01-.256-1.478A48.567 48.567 0 017.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 013.369 0c1.603.051 2.815 1.387 2.815 2.951zm-6.136-1.452a51.196 51.196 0 013.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 00-6 0v-.113c0-.794.609-1.428 1.364-1.452zm-.355 5.945a.75.75 0 10-1.5.058l.347 9a.75.75 0 101.499-.058l-.346-9zm5.48.058a.75.75 0 10-1.498-.058l-.347 9a.75.75 0 001.5.058l.345-9z" clip-rule="evenodd" />
                    </svg>
                    Remove
                </button>
            </div>
            
            <input type="text" 
                placeholder="Enter your question..." 
                value="${escapeHtml(q.text)}"
                oninput="updateQuestionText(${q.id}, this.value)"
                style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.95rem;margin-bottom:12px;transition:all 0.2s;"
                onfocus="this.style.borderColor='#3b82f6';"
                onblur="this.style.borderColor='#e2e8f0';">
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
                <button onclick="updateQuestionType(${q.id}, 'text'); renderEvaluationQuestions();"
                    style="padding:10px;border:2px solid ${q.type === 'text' ? '#3b82f6' : '#e2e8f0'};background:${q.type === 'text' ? '#eff6ff' : 'white'};color:${q.type === 'text' ? '#3b82f6' : '#64748b'};border-radius:10px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;">
                        <path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32l8.4-8.4z" />
                        <path d="M5.25 5.25a3 3 0 00-3 3v10.5a3 3 0 003 3h10.5a3 3 0 003-3V13.5a.75.75 0 00-1.5 0v5.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5V8.25a1.5 1.5 0 011.5-1.5h5.25a.75.75 0 000-1.5H5.25z" />
                    </svg>
                    Text
                </button>
                <button onclick="updateQuestionType(${q.id}, 'rating'); renderEvaluationQuestions();"
                    style="padding:10px;border:2px solid ${q.type === 'rating' ? '#3b82f6' : '#e2e8f0'};background:${q.type === 'rating' ? '#eff6ff' : 'white'};color:${q.type === 'rating' ? '#3b82f6' : '#64748b'};border-radius:10px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;">
                        <path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clip-rule="evenodd" />
                    </svg>
                    Rating
                </button>
                <button onclick="updateQuestionType(${q.id}, 'satisfaction'); renderEvaluationQuestions();"
                    style="padding:10px;border:2px solid ${q.type === 'satisfaction' ? '#3b82f6' : '#e2e8f0'};background:${q.type === 'satisfaction' ? '#eff6ff' : 'white'};color:${q.type === 'satisfaction' ? '#3b82f6' : '#64748b'};border-radius:10px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;">
                        <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-2.625 6c-.54 0-.828.419-.936.634a1.96 1.96 0 00-.189.866c0 .298.059.605.189.866.108.215.395.634.936.634.54 0 .828-.419.936-.634.13-.26.189-.568.189-.866 0-.298-.059-.605-.189-.866-.108-.215-.395-.634-.936-.634zm4.314.634c.108-.215.395-.634.936-.634.54 0 .828.419.936.634.13.26.189.568.189.866 0 .298-.059.605-.189.866-.108.215-.395.634-.936.634-.54 0-.828-.419-.936-.634a1.96 1.96 0 01-.189-.866c0-.298.059-.605.189-.866zm2.023 6.828a.75.75 0 10-1.06-1.06 3.75 3.75 0 01-5.304 0 .75.75 0 00-1.06 1.06 5.25 5.25 0 007.424 0z" clip-rule="evenodd" />
                    </svg>
                    Satisfaction
                </button>
                <button onclick="updateQuestionType(${q.id}, 'multiple_choice'); renderEvaluationQuestions();"
                    style="padding:10px;border:2px solid ${q.type === 'multiple_choice' ? '#3b82f6' : '#e2e8f0'};background:${q.type === 'multiple_choice' ? '#eff6ff' : 'white'};color:${q.type === 'multiple_choice' ? '#3b82f6' : '#64748b'};border-radius:10px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;">
                        <path fill-rule="evenodd" d="M2.25 4.125c0-1.036.84-1.875 1.875-1.875h5.25c1.036 0 1.875.84 1.875 1.875V17.25a4.5 4.5 0 11-9 0V4.125zm4.5 14.25a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25z" clip-rule="evenodd" />
                        <path d="M10.719 21.75h9.156c1.036 0 1.875-.84 1.875-1.875v-5.25c0-1.036-.84-1.875-1.875-1.875h-.14l-8.742 8.743c-.09.089-.18.175-.274.257zM12.738 17.625l6.474-6.474a1.875 1.875 0 000-2.651L15.5 4.787a1.875 1.875 0 00-2.651 0l-.1.099V17.25c0 .126-.003.251-.01.375z" />
                    </svg>
                    Choice
                </button>
            </div>
            
            ${q.type === 'multiple_choice' ? `
                <div style="background:#f8fafc;border-radius:10px;padding:12px;margin-top:12px;">
                    <div style="font-size:0.85rem;font-weight:600;color:#64748b;margin-bottom:8px;">Options:</div>
                    ${(q.options || []).map((opt, optIndex) => `
                        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
                            <input type="text" 
                                value="${escapeHtml(opt)}"
                                oninput="updateMultipleChoiceOption(${q.id}, ${optIndex}, this.value)"
                                placeholder="Option ${optIndex + 1}"
                                style="flex:1;padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:0.85rem;">
                            <button onclick="removeMultipleChoiceOption(${q.id}, ${optIndex})"
                                style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:6px 8px;cursor:pointer;font-size:0.75rem;font-weight:600;">
                                ?
                            </button>
                        </div>
                    `).join('')}
                    <button onclick="addMultipleChoiceOption(${q.id})"
                        style="width:100%;padding:8px;background:#f1f5f9;border:2px dashed #cbd5e1;border-radius:8px;color:#64748b;font-size:0.8rem;font-weight:600;cursor:pointer;margin-top:4px;">
                        + Add Option
                    </button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

async function postEvaluationForm() {
    console.log('?? postEvaluationForm called');
    console.log('?? Questions:', window.evaluationQuestions);
    console.log('?? Debriefing ID:', window.currentEvaluationDebriefingId);

    if (!window.evaluationQuestions || window.evaluationQuestions.length === 0) {
        showToast('Please add at least one question', '??');
        return;
    }

    // Validate all questions have text
    const emptyQuestions = window.evaluationQuestions.filter(q => !q.text.trim());
    if (emptyQuestions.length > 0) {
        showToast('Please fill in all question texts', '??');
        return;
    }

    // Get duration from input
    const duration = parseInt(document.getElementById('evaluation-duration').value) || 24;

    // Get custom reflection/feedback labels
    const reflectionLabel = document.getElementById('custom-reflection-label')?.value.trim() || 'Reflection';
    const feedbackLabel = document.getElementById('custom-feedback-label')?.value.trim() || 'Additional Feedback';
    console.log('📝 Labels:', reflectionLabel, feedbackLabel);

    // Validate duration
    if (duration < 1 || duration > 168) {
        showToast('Duration must be between 1 and 168 hours', '??');
        document.getElementById('evaluation-duration').focus();
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        console.log('?? Posting to backend...');
        console.log('?? Payload:', { debriefingId: window.currentEvaluationDebriefingId, orgId, questions: window.evaluationQuestions, evaluationDuration: duration });

        const res = await fetch(SERVER_URL + '/api/debriefings/post-evaluation', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                debriefingId: window.currentEvaluationDebriefingId,
                orgId,
                questions: window.evaluationQuestions,
                evaluationDuration: duration,
                reflectionLabel,
                feedbackLabel
            })
        });

        console.log('?? Response status:', res.status);

        if (res.ok) {
            const result = await res.json();
            console.log('? Success:', result);
            showToast('Evaluation form posted successfully!', '?');
            closeEvaluationFormModal();
            await loadOngoingDebriefings();
            await loadCompletedSessions();
        } else {
            const error = await res.json();
            console.log('? Error response:', error);
            showToast(error.error || 'Failed to post evaluation form', '?');
        }
    } catch (err) {
        console.error('? Error posting evaluation form:', err);
        showToast('Failed to post evaluation form', '?');
    }
}

// -------------------------------------------------------------------------------
// EVALUATION FORM VIEWER (Phase 3 - Members fill out evaluation)
// -------------------------------------------------------------------------------

async function openEvaluationFormViewer(debriefingId, sessionTitle) {
    console.log('?? Opening evaluation viewer for:', debriefingId);

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        // Fetch debriefing details to get evaluation form
        const res = await fetch(SERVER_URL + `/api/debriefings/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const debriefings = await res.json();
            const debriefing = debriefings.find(d => d.id === debriefingId);

            if (!debriefing || !debriefing.evaluationForm) {
                showToast('Evaluation form not found', '?');
                return;
            }

            // Check if evaluation is still open
            const baseDateVal = debriefing.evaluationForm && debriefing.evaluationForm.createdAt ? new Date(debriefing.evaluationForm.createdAt) : (debriefing.completedAt ? new Date(debriefing.completedAt) : new Date(`${debriefing.date}T${debriefing.time}`));
            const evaluationDuration = debriefing.evaluationDuration || 24;
            const evaluationDeadline = new Date(baseDateVal.getTime() + (evaluationDuration * 60 * 60 * 1000));
            const now = new Date();
            const isExpired = now > evaluationDeadline;

            // Store current debriefing data
            console.log('📋 evaluationForm data:', debriefing.evaluationForm);
            window.currentEvaluationViewerData = {
                debriefingId,
                sessionTitle,
                questions: debriefing.evaluationForm.questions,
                reflectionLabel: debriefing.evaluationForm.reflectionLabel || 'Reflection',
                feedbackLabel: debriefing.evaluationForm.feedbackLabel || 'Additional Feedback',
                isExpired,
                evaluationDeadline
            };
            console.log('📋 viewer data set:', window.currentEvaluationViewerData.reflectionLabel, window.currentEvaluationViewerData.feedbackLabel);

            // Initialize responses object
            window.evaluationResponses = {};

            // Update modal title
            document.getElementById('evaluation-viewer-title').textContent = sessionTitle;

            // Render questions
            renderEvaluationViewerQuestions();

            // Open modal
            const modal = document.getElementById('evaluation-viewer-modal');
            if (modal) {
                modal.classList.add('open');
                document.body.style.overflow = 'hidden';
            }
        }
    } catch (err) {
        console.error('Error opening evaluation viewer:', err);
        showToast('Failed to load evaluation form', '?');
    }
}

function closeEvaluationViewerModal() {
    const modal = document.getElementById('evaluation-viewer-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function renderEvaluationViewerQuestions() {
    const container = document.getElementById('evaluation-viewer-questions');
    if (!container || !window.currentEvaluationViewerData) return;

    const questions = window.currentEvaluationViewerData.questions;
    const isExpired = window.currentEvaluationViewerData.isExpired;
    const deadline = window.currentEvaluationViewerData.evaluationDeadline;

    // Show expired message if evaluation period has ended
    if (isExpired) {
        container.innerHTML = `
            <div style="background:#fef2f2;border:2px solid #fecaca;border-radius:12px;padding:24px;text-align:center;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ef4444" style="width:48px;height:48px;margin:0 auto 16px;">
                    <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clip-rule="evenodd" />
                </svg>
                <h3 style="font-size:1.2rem;font-weight:700;color:#dc2626;margin-bottom:8px;">Evaluation Period Expired</h3>
                <p style="font-size:0.95rem;color:#991b1b;margin-bottom:4px;">This evaluation form is no longer accepting responses.</p>
                <p style="font-size:0.85rem;color:#b91c1c;">Deadline was: ${new Date(deadline).toLocaleString()}</p>
            </div>
        `;

        // Hide submit button
        const submitBtn = document.querySelector('#evaluation-viewer-modal button[onclick="submitEvaluationResponse()"]');
        if (submitBtn) {
            submitBtn.style.display = 'none';
        }
        return;
    }

    container.innerHTML = questions.map((q, index) => {
        if (q.type === 'text') {
            return `
                <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
                    <label style="display:block;font-weight:600;color:#1e293b;margin-bottom:12px;font-size:0.95rem;">
                        � ${escapeHtml(q.text)}
                    </label>
                    <textarea 
                        id="response-${q.id}"
                        placeholder="Type your answer here..."
                        style="width:100%;min-height:100px;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.9rem;font-family:inherit;resize:vertical;transition:all 0.2s;"
                        onfocus="this.style.borderColor='#3b82f6';"
                        onblur="this.style.borderColor='#e2e8f0';"
                        oninput="updateEvaluationResponse('${q.id}', this.value)"></textarea>
                </div>
            `;
        } else if (q.type === 'rating') {
            return `
                <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
                    <label style="display:block;font-weight:600;color:#1e293b;margin-bottom:12px;font-size:0.95rem;">
                        � ${escapeHtml(q.text)}
                    </label>
                    <div style="display:flex;gap:8px;justify-content:center;padding:10px 0;">
                        ${[1, 2, 3, 4, 5].map(star => `
                            <button 
                                onclick="setRating('${q.id}', ${star})"
                                class="rating-star"
                                data-question-id="${q.id}"
                                data-star="${star}"
                                style="background:none;border:none;cursor:pointer;padding:4px;transition:all 0.2s;">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#cbd5e1" style="width:36px;height:36px;">
                                    <path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (q.type === 'satisfaction') {
            const satisfactionLevels = [
                { value: 'very_helpful', label: 'Very Helpful', color: '#22c55e', bg: '#f0fdf4', border: '#86efac' },
                { value: 'helpful', label: 'Helpful', color: '#84cc16', bg: '#f7fee7', border: '#bef264' },
                { value: 'neutral', label: 'Neutral', color: '#eab308', bg: '#fefce8', border: '#fde047' },
                { value: 'slightly_helpful', label: 'Slightly Helpful', color: '#f97316', bg: '#fff7ed', border: '#fdba74' },
                { value: 'needs_support', label: 'Needs More Support', color: '#ef4444', bg: '#fef2f2', border: '#fca5a5' }
            ];
            return `
                <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
                    <label style="display:block;font-weight:600;color:#1e293b;margin-bottom:14px;font-size:0.95rem;">
                        • ${escapeHtml(q.text)}
                    </label>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        ${satisfactionLevels.map(level => `
                            <button 
                                onclick="setSatisfaction('${q.id}', '${level.value}')"
                                class="satisfaction-btn"
                                data-question-id="${q.id}"
                                data-value="${level.value}"
                                style="background:white;border:2px solid #e2e8f0;border-radius:999px;padding:10px 20px;cursor:pointer;transition:all 0.2s;text-align:center;font-size:0.88rem;font-weight:600;color:#64748b;width:100%;">
                                ${level.label}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (q.type === 'multiple_choice') {
            return `
                <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
                    <label style="display:block;font-weight:600;color:#1e293b;margin-bottom:12px;font-size:0.95rem;">
                        � ${escapeHtml(q.text)}
                    </label>
                    <div style="display:flex;flex-direction:column;gap:10px;">
                        ${(q.options || []).map((option, optIndex) => `
                            <label style="display:flex;align-items:center;padding:12px;border:2px solid #e2e8f0;border-radius:10px;cursor:pointer;transition:all 0.2s;"
                                onmouseover="this.style.borderColor='#3b82f6';this.style.background='#eff6ff';"
                                onmouseout="if(!this.querySelector('input').checked){this.style.borderColor='#e2e8f0';this.style.background='white';}">
                                <input type="radio" 
                                    name="question-${q.id}" 
                                    value="${escapeHtml(option)}"
                                    onchange="setMultipleChoice('${q.id}', '${escapeHtml(option)}')"
                                    style="width:20px;height:20px;margin-right:12px;cursor:pointer;accent-color:#3b82f6;">
                                <span style="font-size:0.9rem;color:#1e293b;">${escapeHtml(option)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }).join('') + `
        <!-- Automatic Reflection Field -->
        <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:#1e293b;margin-bottom:12px;font-size:0.95rem;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;display:inline-block;vertical-align:middle;margin-right:6px;color:#8b5cf6;">
                    <path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z" />
                </svg>
                ${window.currentEvaluationViewerData?.reflectionLabel || 'Reflection'}
            </label>
            <textarea 
                id="response-reflection"
                placeholder="Share your thoughts and insights about this session..."
                style="width:100%;min-height:120px;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.9rem;font-family:inherit;resize:vertical;transition:all 0.2s;"
                onfocus="this.style.borderColor='#8b5cf6';"
                onblur="this.style.borderColor='#e2e8f0';"
                oninput="updateEvaluationResponse('reflection', this.value)"></textarea>
        </div>

        <!-- Automatic Additional Feedback Field -->
        <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
            <label style="display:block;font-weight:600;color:#1e293b;margin-bottom:12px;font-size:0.95rem;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;display:inline-block;vertical-align:middle;margin-right:6px;color:#06b6d4;">
                    <path fill-rule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.678 3.348-3.97zM6.75 8.25a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H7.5z" clip-rule="evenodd" />
                </svg>
                ${window.currentEvaluationViewerData?.feedbackLabel || 'Additional Feedback'}
            </label>
            <textarea 
                id="response-additional-feedback"
                placeholder="Any other comments or suggestions?"
                style="width:100%;min-height:120px;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:0.9rem;font-family:inherit;resize:vertical;transition:all 0.2s;"
                onfocus="this.style.borderColor='#06b6d4';"
                onblur="this.style.borderColor='#e2e8f0';"
                oninput="updateEvaluationResponse('additional_feedback', this.value)"></textarea>
        </div>
    `;
}

function updateEvaluationResponse(questionId, value) {
    if (!window.evaluationResponses) {
        window.evaluationResponses = {};
    }
    window.evaluationResponses[questionId] = value;
}

function setRating(questionId, rating) {
    // Update response
    updateEvaluationResponse(questionId, rating);

    // Update UI - fill stars up to selected rating
    const stars = document.querySelectorAll(`[data-question-id="${questionId}"]`);
    stars.forEach(star => {
        const starValue = parseInt(star.getAttribute('data-star'));
        const svg = star.querySelector('svg');
        if (starValue <= rating) {
            svg.setAttribute('fill', '#fbbf24'); // Yellow for selected
        } else {
            svg.setAttribute('fill', '#cbd5e1'); // Gray for unselected
        }
    });
}

function setSatisfaction(questionId, value) {
    updateEvaluationResponse(questionId, value);

    const colorMap = {
        'very_helpful': { border: '#22c55e', bg: '#f0fdf4', color: '#16a34a' },
        'helpful': { border: '#84cc16', bg: '#f7fee7', color: '#65a30d' },
        'neutral': { border: '#eab308', bg: '#fefce8', color: '#ca8a04' },
        'slightly_helpful': { border: '#f97316', bg: '#fff7ed', color: '#ea580c' },
        'needs_support': { border: '#ef4444', bg: '#fef2f2', color: '#dc2626' }
    };

    const buttons = document.querySelectorAll(`[data-question-id="${questionId}"]`);
    buttons.forEach(btn => {
        const btnValue = btn.getAttribute('data-value');
        if (btnValue === value) {
            const c = colorMap[value] || { border: '#3b82f6', bg: '#eff6ff', color: '#2563eb' };
            btn.style.borderColor = c.border;
            btn.style.background = c.bg;
            btn.style.color = c.color;
        } else {
            btn.style.borderColor = '#e2e8f0';
            btn.style.background = 'white';
            btn.style.color = '#64748b';
        }
    });
}

function setMultipleChoice(questionId, value) {
    // Update response
    updateEvaluationResponse(questionId, value);
}

async function submitEvaluationResponse() {
    if (!window.currentEvaluationViewerData || !window.evaluationResponses) {
        showToast('Please answer the questions', '??');
        return;
    }

    const questions = window.currentEvaluationViewerData.questions;

    // Validate all questions are answered
    const unanswered = questions.filter(q => !window.evaluationResponses[q.id]);
    if (unanswered.length > 0) {
        showToast('Please answer all questions', '??');
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        const res = await fetch(SERVER_URL + '/api/debriefings/submit-evaluation', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                debriefingId: window.currentEvaluationViewerData.debriefingId,
                orgId,
                responses: window.evaluationResponses,
                username: storageGet('psyc_username') || currentUser.displayName || currentUser.email.split('@')[0]
            })
        });

        if (res.ok) {
            showToast('Evaluation submitted successfully!', '?');
            closeEvaluationViewerModal();
            await loadCompletedSessions();
        } else {
            const error = await res.json();
            if (res.status === 403 && error.error.includes('expired')) {
                showToast('Evaluation period has expired', '?');
                closeEvaluationViewerModal();
                await loadCompletedSessions();
            } else {
                showToast(error.error || 'Failed to submit evaluation', '?');
            }
        }
    } catch (err) {
        console.error('Error submitting evaluation:', err);
        showToast('Failed to submit evaluation', '?');
    }
}

// -------------------------------------------------------------------------------
// EVALUATION RESULTS VIEWER (Phase 4 - Supervisor views all responses)
// -------------------------------------------------------------------------------

async function openEvaluationResults(debriefingId, sessionTitle) {
    console.log('?? Opening evaluation results for:', debriefingId);

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        // Fetch debriefing details
        const res = await fetch(SERVER_URL + `/api/debriefings/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const debriefings = await res.json();
            const debriefing = debriefings.find(d => d.id === debriefingId);

            if (!debriefing || !debriefing.evaluationForm) {
                showToast('Evaluation form not found', '?');
                return;
            }

            // Update modal title
            document.getElementById('evaluation-results-title').textContent = `${sessionTitle} - Results`;

            // Track globally for live socket updates and exports
            window.currentResultsDebriefingId = debriefingId;
            window.currentResultsSessionTitle = sessionTitle;
            window.currentResultsDebriefingData = debriefing;

            // Render results
            renderEvaluationResults(debriefing);

            // Open modal
            const modal = document.getElementById('evaluation-results-modal');
            if (modal) {
                modal.classList.add('open');
                document.body.style.overflow = 'hidden';
            }
        }
    } catch (err) {
        console.error('Error opening evaluation results:', err);
        showToast('Failed to load evaluation results', '?');
    }
}

function closeEvaluationResultsModal() {
    // Clear global tracking
    window.currentResultsDebriefingId = null;
    window.currentResultsSessionTitle = null;

    const modal = document.getElementById('evaluation-results-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function renderEvaluationResults(debriefing) {
    const container = document.getElementById('evaluation-results-content');
    if (!container) return;

    const questions = debriefing.evaluationForm.questions;
    const responses = debriefing.evaluationResponses || {};
    const responseCount = Object.keys(responses).length;

    if (responseCount === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#94a3b8;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:64px;height:64px;margin:0 auto 16px;opacity:0.3;">
                    <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z" clip-rule="evenodd" />
                </svg>
                <p style="font-size:0.95rem;line-height:1.6;">No responses yet</p>
            </div>
        `;
        return;
    }

    let html = `
        <div style="background:white;border:2px solid #e2e8f0;color:#1e293b;padding:20px;border-radius:12px;margin-bottom:20px;text-align:center;">
            <div style="font-size:2.5rem;font-weight:700;margin-bottom:8px;">${responseCount}</div>
            <div style="font-size:0.95rem;color:#64748b;">Total Responses</div>
        </div>
    `;

    // Render each question with responses
    questions.forEach((q, index) => {
        html += renderQuestionResults(q, index, responses);
    });

    // Render reflection and feedback
    html += renderReflectionResults(responses, debriefing.evaluationForm.reflectionLabel);
    html += renderFeedbackResults(responses, debriefing.evaluationForm.feedbackLabel);

    container.innerHTML = html;
}

function renderQuestionResults(question, index, responses) {
    const questionResponses = [];

    // Collect all responses for this question
    for (const emailKey in responses) {
        const userResponse = responses[emailKey];
        if (userResponse.responses && userResponse.responses[question.id]) {
            questionResponses.push({
                username: userResponse.username || emailKey.replace(/_/g, '.').split('@')[0],
                value: userResponse.responses[question.id]
            });
        }
    }

    let html = `
        <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
            <div style="font-weight:700;color:#1e293b;margin-bottom:16px;font-size:1rem;">
                • ${escapeHtml(question.text)}
            </div>
    `;

    if (question.type === 'rating') {
        // Calculate average rating
        const ratings = questionResponses.map(r => parseInt(r.value));
        const average = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0;

        html += `
            <div style="background:#fef3c7;padding:16px;border-radius:10px;margin-bottom:16px;text-align:center;">
                <div style="font-size:2rem;font-weight:700;color:#f59e0b;margin-bottom:4px;">${average} / 5</div>
                <div style="font-size:0.85rem;color:#92400e;">Average Rating</div>
            </div>
            <div style="font-size:0.85rem;font-weight:600;color:#64748b;margin-bottom:12px;">Individual Ratings:</div>
        `;

        questionResponses.forEach(r => {
            const stars = '\u2605'.repeat(parseInt(r.value)) + '\u2606'.repeat(5 - parseInt(r.value));
            html += `
                <div style="padding:10px 14px;background:#f8fafc;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:0.8rem;font-weight:600;color:#64748b;">@${escapeHtml(r.username)}</span>
                    <span style="font-size:1.1rem;color:#f59e0b;">${stars}</span>
                </div>
            `;
        });

    } else if (question.type === 'satisfaction') {
        // Count satisfaction levels — support both old and new value keys
        const counts = { very_helpful: 0, helpful: 0, neutral: 0, slightly_helpful: 0, needs_support: 0 };
        questionResponses.forEach(r => {
            // Map old keys to new
            const keyMap = { very_good: 'very_helpful', good: 'helpful', bad: 'slightly_helpful', very_bad: 'needs_support' };
            const key = keyMap[r.value] || r.value;
            if (counts[key] !== undefined) counts[key]++;
        });

        const labels = {
            very_helpful: { label: 'Very Helpful', color: '#22c55e', bg: '#f0fdf4' },
            helpful: { label: 'Helpful', color: '#84cc16', bg: '#f7fee7' },
            neutral: { label: 'Neutral', color: '#eab308', bg: '#fefce8' },
            slightly_helpful: { label: 'Slightly Helpful', color: '#f97316', bg: '#fff7ed' },
            needs_support: { label: 'Needs More Support', color: '#ef4444', bg: '#fef2f2' }
        };

        html += `<div style="display:flex;flex-direction:column;gap:8px;padding:8px 0;">`;
        for (const key in labels) {
            const info = labels[key];
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:${info.bg};border-radius:999px;border:1.5px solid ${info.color}33;">
                    <span style="font-size:0.88rem;font-weight:600;color:${info.color};">${info.label}</span>
                    <span style="font-size:1rem;font-weight:700;color:${info.color};">${counts[key]}</span>
                </div>
            `;
        }
        html += `</div>`;

    } else if (question.type === 'multiple_choice') {
        // Count choices
        const choiceCounts = {};
        questionResponses.forEach(r => {
            choiceCounts[r.value] = (choiceCounts[r.value] || 0) + 1;
        });

        html += `<div style="margin-bottom:12px;">`;
        for (const choice in choiceCounts) {
            const percentage = ((choiceCounts[choice] / questionResponses.length) * 100).toFixed(0);
            html += `
                <div style="margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                        <span style="font-size:0.85rem;color:#1e293b;">${escapeHtml(choice)}</span>
                        <span style="font-size:0.85rem;font-weight:600;color:#3b82f6;">${choiceCounts[choice]} (${percentage}%)</span>
                    </div>
                    <div style="background:#e2e8f0;height:8px;border-radius:4px;overflow:hidden;">
                        <div style="background:#3b82f6;height:100%;width:${percentage}%;transition:width 0.3s;"></div>
                    </div>
                </div>
            `;
        }
        html += `</div>`;

    } else if (question.type === 'text') {
        // List all text responses with username
        html += `<div style="font-size:0.85rem;font-weight:600;color:#64748b;margin-bottom:12px;">Responses:</div>`;
        questionResponses.forEach(r => {
            html += `
                <div style="padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:10px;">
                    <div style="font-size:0.75rem;font-weight:600;color:#64748b;margin-bottom:6px;">@${escapeHtml(r.username)}</div>
                    <div style="font-size:0.9rem;color:#1e293b;line-height:1.5;">${escapeHtml(r.value)}</div>
                </div>
            `;
        });
    }

    html += `</div>`;
    return html;
}

function renderReflectionResults(responses, label) {
    const reflections = [];

    for (const emailKey in responses) {
        const userResponse = responses[emailKey];
        if (userResponse.responses && userResponse.responses.reflection) {
            reflections.push({
                username: userResponse.username || emailKey.replace(/_/g, '.').split('@')[0],
                value: userResponse.responses.reflection
            });
        }
    }

    if (reflections.length === 0) return '';

    let html = `
        <div style="font-weight:700;color:#1e293b;margin:20px 16px 12px;font-size:1rem;display:flex;align-items:center;gap:8px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;color:#8b5cf6;">
                <path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z" />
            </svg>
            ${escapeHtml(label || 'Reflections')}
        </div>
    `;

    reflections.forEach((r, idx) => {
        const isLast = idx === reflections.length - 1;
        html += `
            <div style="padding:14px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;margin:0;${isLast ? 'padding-bottom:24px;' : ''}">
                <div style="font-size:0.75rem;font-weight:600;color:#64748b;margin-bottom:6px;">@${escapeHtml(r.username)}</div>
                <div style="font-size:0.9rem;color:#1e293b;line-height:1.5;">${escapeHtml(r.value)}</div>
            </div>
        `;
    });

    return html;
}

function renderFeedbackResults(responses, label) {
    const feedbacks = [];

    for (const emailKey in responses) {
        const userResponse = responses[emailKey];
        if (userResponse.responses && userResponse.responses.additional_feedback) {
            feedbacks.push({
                username: userResponse.username || emailKey.replace(/_/g, '.').split('@')[0],
                value: userResponse.responses.additional_feedback
            });
        }
    }

    if (feedbacks.length === 0) return '';

    let html = `
        <div style="font-weight:700;color:#1e293b;margin:20px 16px 12px;font-size:1rem;display:flex;align-items:center;gap:8px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;color:#06b6d4;">
                <path fill-rule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.678 3.348-3.97zM6.75 8.25a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H7.5z" clip-rule="evenodd" />
            </svg>
            ${escapeHtml(label || 'Additional Feedback')}
        </div>
    `;

    feedbacks.forEach((r, idx) => {
        const isLast = idx === feedbacks.length - 1;
        html += `
            <div style="padding:14px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;margin:0;${isLast ? 'padding-bottom:24px;' : ''}">
                <div style="font-size:0.75rem;font-weight:600;color:#64748b;margin-bottom:6px;">@${escapeHtml(r.username)}</div>
                <div style="font-size:0.9rem;color:#1e293b;line-height:1.5;">${escapeHtml(r.value)}</div>
            </div>
        `;
    });

    return html;
}

// -------------------------------------------------------------------------------
// ANONYMOUS REFLECTIONS VIEWER (Members view reflections/feedback anonymously)
// -------------------------------------------------------------------------------

async function viewAnonymousReflections(debriefingId, sessionTitle) {
    console.log('?? Opening anonymous reflections for:', debriefingId);

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        // Fetch debriefing details
        const res = await fetch(SERVER_URL + `/api/debriefings/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const debriefings = await res.json();
            const debriefing = debriefings.find(d => d.id === debriefingId);

            if (!debriefing || !debriefing.evaluationForm) {
                showToast('Evaluation form not found', '?');
                return;
            }

            // Update modal title
            document.getElementById('anonymous-reflections-title').textContent = `${sessionTitle}`;

            // Render anonymous reflections
            renderAnonymousReflections(debriefing);

            // Open modal
            const modal = document.getElementById('anonymous-reflections-modal');
            if (modal) {
                modal.classList.add('open');
                document.body.style.overflow = 'hidden';
            }
        }
    } catch (err) {
        console.error('Error opening anonymous reflections:', err);
        showToast('Failed to load reflections', '?');
    }
}

function closeAnonymousReflectionsModal() {
    const modal = document.getElementById('anonymous-reflections-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function renderAnonymousReflections(debriefing) {
    const container = document.getElementById('anonymous-reflections-content');
    if (!container) return;

    const responses = debriefing.evaluationResponses || {};
    const responseCount = Object.keys(responses).length;

    if (responseCount === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#94a3b8;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:64px;height:64px;margin:0 auto 16px;opacity:0.3;">
                    <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z" clip-rule="evenodd" />
                </svg>
                <p style="font-size:0.95rem;line-height:1.6;">No reflections yet</p>
            </div>
        `;
        return;
    }

    // Collect all comments with type
    const allComments = [];

    for (const emailKey in responses) {
        const userResponse = responses[emailKey];
        if (userResponse.responses) {
            if (userResponse.responses.reflection) {
                allComments.push({
                    type: 'reflection',
                    text: userResponse.responses.reflection,
                    index: allComments.length + 1
                });
            }
            if (userResponse.responses.additional_feedback) {
                allComments.push({
                    type: 'feedback',
                    text: userResponse.responses.additional_feedback,
                    index: allComments.length + 1
                });
            }
        }
    }

    const reflectionCount = allComments.filter(c => c.type === 'reflection').length;
    const feedbackCount = allComments.filter(c => c.type === 'feedback').length;

    let html = `
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
            <button onclick="filterAnonymousComments('reflection')" id="filter-reflection" class="comment-filter-btn active" style="padding:8px 16px;border-radius:8px;border:1px solid #0ea5e9;background:#0ea5e9;color:white;font-size:0.85rem;font-weight:600;cursor:pointer;transition:all 0.2s;font-family:inherit;">
                Reflections (${reflectionCount})
            </button>
            <button onclick="filterAnonymousComments('feedback')" id="filter-feedback" class="comment-filter-btn" style="padding:8px 16px;border-radius:8px;border:1px solid #e2e8f0;background:white;color:#64748b;font-size:0.85rem;font-weight:600;cursor:pointer;transition:all 0.2s;font-family:inherit;">
                Feedback (${feedbackCount})
            </button>
        </div>
        <div id="comments-list">
    `;

    allComments.forEach((comment, index) => {
        const iconSvg = comment.type === 'reflection'
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;color:#8b5cf6;">
                <path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z" />
               </svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;color:#06b6d4;">
                <path fill-rule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.678 3.348-3.97zM6.75 8.25a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H7.5z" clip-rule="evenodd" />
               </svg>`;
        const label = comment.type === 'reflection' ? 'Reflection' : 'Feedback';
        html += `
            <div class="comment-item" data-type="${comment.type}" style="padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:10px;display:${comment.type === 'reflection' ? 'block' : 'none'};">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    ${iconSvg}
                    <div style="font-size:0.75rem;font-weight:600;color:#64748b;">${label} � Anonymous User</div>
                </div>
                <div style="font-size:0.9rem;color:#1e293b;line-height:1.5;">${escapeHtml(comment.text)}</div>
            </div>
        `;
    });

    html += `</div>`;

    container.innerHTML = html;
}

// Filter function for anonymous comments
window.filterAnonymousComments = function (type) {
    const reflectionBtn = document.getElementById('filter-reflection');
    const feedbackBtn = document.getElementById('filter-feedback');
    const comments = document.querySelectorAll('.comment-item');

    // Update button states
    [reflectionBtn, feedbackBtn].forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'white';
        btn.style.color = '#64748b';
        btn.style.borderColor = '#e2e8f0';
    });

    const activeBtn = document.getElementById(`filter-${type}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = '#0ea5e9';
        activeBtn.style.color = 'white';
        activeBtn.style.borderColor = '#0ea5e9';
    }

    // Filter comments
    comments.forEach(comment => {
        if (comment.dataset.type === type) {
            comment.style.display = 'block';
        } else {
            comment.style.display = 'none';
        }
    });
};


function showDebriefingForm(editDebriefing) {
    document.getElementById('debriefing-list-view').style.display = 'none';
    document.getElementById('debriefing-form-view').style.display = 'block';

    const sheetTitle = document.querySelector('#debriefing-modal .sheet-title');
    const addBtn = document.getElementById('debriefing-add-btn');

    if (editDebriefing) {
        editingDebriefingId = editDebriefing.id;
        if (sheetTitle) sheetTitle.textContent = 'Edit Debriefing';
        if (addBtn) {
            addBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
            addBtn.onclick = saveDebriefing;
        }

        document.getElementById('debriefing-title').value = editDebriefing.title || '';
        document.getElementById('debriefing-date').value = editDebriefing.date || '';
        document.getElementById('debriefing-time').value = editDebriefing.time || '';
        document.getElementById('debriefing-description').value = editDebriefing.description || '';
        document.getElementById('debriefing-meeting-link').value = editDebriefing.meetingLink || '';

        currentDebriefingVisibility = editDebriefing.visibility || 'all';
        selectedDebriefingMembers = editDebriefing.members || [];

        selectDebriefingVisibility(currentDebriefingVisibility);
    } else {
        editingDebriefingId = null;
        if (sheetTitle) sheetTitle.textContent = 'New Debriefing';
        if (addBtn) {
            addBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
            addBtn.onclick = saveDebriefing;
        }

        document.getElementById('debriefing-title').value = '';
        document.getElementById('debriefing-date').value = '';
        document.getElementById('debriefing-time').value = '';
        document.getElementById('debriefing-description').value = '';

        currentDebriefingVisibility = 'all';
        selectedDebriefingMembers = [];

        selectDebriefingVisibility('all');
    }

    loadTeamMembersForDebriefing();
}

function hideDebriefingForm() {
    editingDebriefingId = null;
    const sheetTitle = document.querySelector('#debriefing-modal .sheet-title');
    const addBtn = document.getElementById('debriefing-add-btn');

    if (sheetTitle) sheetTitle.textContent = 'Group Debriefing';
    if (addBtn) {
        addBtn.innerHTML = '<i class="bi bi-plus-lg"></i>';
        addBtn.onclick = showDebriefingForm;
        addBtn.style.display = isSupervisor ? 'flex' : 'none';
    }

    document.getElementById('debriefing-list-view').style.display = 'block';
    document.getElementById('debriefing-form-view').style.display = 'none';

    // Reload list to show updated data
    loadDebriefings();
}

function selectDebriefingVisibility(type) {
    currentDebriefingVisibility = type;
    document.querySelectorAll('.goal-type-btn[data-debriefing-type]').forEach(opt => {
        const isActive = opt.dataset.debriefingType === type;
        opt.classList.toggle('active', isActive);

        // Update inline styles
        if (isActive) {
            opt.style.borderColor = '#3b82f6';
            opt.style.background = '#eff6ff';
            const icon = opt.querySelector('svg');
            if (icon) icon.style.fill = '#3b82f6';
        } else {
            opt.style.borderColor = '#e2e8f0';
            opt.style.background = 'white';
            const icon = opt.querySelector('svg');
            if (icon) icon.style.fill = '#64748b';
        }
    });

    const memberSelection = document.getElementById('debriefing-member-selection');
    if (memberSelection) {
        memberSelection.style.display = type === 'specific' ? 'block' : 'none';
    }
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

async function loadTeamMembersForDebriefing() {
    const container = document.getElementById('debriefing-members-list');
    if (!container) return;

    const orgId = storageGet('psyc_orgId');
    if (!orgId) return;

    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + `/api/org/members?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            const members = data.members || []; // Extract members array from response
            const currentUserId = currentUser.uid;

            // Filter out supervisors and current user
            const regularMembers = members.filter(m => !m.isSupervisor && m.uid !== currentUserId);

            if (regularMembers.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:0.9rem;">No team members available</div>';
                return;
            }

            container.innerHTML = regularMembers.map(member => {
                const username = member.username || member.displayName || member.email.split('@')[0];
                const initial = username.charAt(0).toUpperCase();
                const isSelected = selectedDebriefingMembers.includes(member.uid);
                return `
                <div class="member-card ${isSelected ? 'selected' : ''}" data-user-id="${member.uid}" onclick="toggleDebriefingMember('${member.uid}')">
                    <div class="member-avatar">${initial}</div>
                    <div class="member-name">${escapeHtml(username)}</div>
                    <div class="member-check">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" style="width:16px;height:16px;">
                            <path fill-rule="evenodd" d="M19.916 4.626a.75.75 0 01.208 1.04l-9 13.5a.75.75 0 01-1.154.114l-6-6a.75.75 0 011.06-1.06l5.353 5.353 8.493-12.739a.75.75 0 011.04-.208z" clip-rule="evenodd" />
                        </svg>
                    </div>
                </div>
            `;
            }).join('');
        }
    } catch (err) {
        console.error('Error loading team members:', err);
    }
}

function toggleDebriefingMember(userId) {
    const index = selectedDebriefingMembers.indexOf(userId);
    if (index > -1) {
        selectedDebriefingMembers.splice(index, 1);
    } else {
        selectedDebriefingMembers.push(userId);
    }

    // Update the card's selected state
    const card = document.querySelector(`.member-card[data-user-id="${userId}"]`);
    if (card) {
        if (selectedDebriefingMembers.includes(userId)) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    }
}

async function saveDebriefing() {
    console.log('?? saveDebriefing called');
    const title = document.getElementById('debriefing-title').value.trim();
    const date = document.getElementById('debriefing-date').value;
    const time = document.getElementById('debriefing-time').value;
    const description = document.getElementById('debriefing-description').value.trim();
    const meetingLink = document.getElementById('debriefing-meeting-link').value.trim();

    console.log('?? Form values:', { title, date, time, description, meetingLink });

    if (!title) {
        console.log('? Validation failed: No title');
        showToast('Please enter a title', '??');
        document.getElementById('debriefing-title').focus();
        return;
    }
    if (!date) {
        console.log('? Validation failed: No date');
        showToast('Please select a date', '??');
        document.getElementById('debriefing-date').focus();
        return;
    }
    if (!time) {
        console.log('? Validation failed: No time');
        showToast('Please select a time', '??');
        document.getElementById('debriefing-time').focus();
        return;
    }

    // Check if date/time is in the future (only for new sessions, not edits)
    const sessionDateTime = new Date(`${date}T${time}`);
    const now = new Date();
    console.log('?? Session date/time:', sessionDateTime);
    console.log('?? Current date/time:', now);

    if (!editingDebriefingId && sessionDateTime < now) {
        console.log('? Validation failed: Date/time is in the past');
        showToast('Please select a future date and time', '??');
        return;
    }

    // Validate meeting link if provided
    if (meetingLink && !isValidUrl(meetingLink)) {
        showToast('Please enter a valid meeting link', '??');
        return;
    }

    if (currentDebriefingVisibility === 'specific' && selectedDebriefingMembers.length === 0) {
        showToast('Please select at least one member', '??');
        return;
    }

    try {
        console.log('?? Getting token...');
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId') || '';
        console.log('?? orgId:', orgId);

        const payload = {
            title,
            date,
            time,
            description,
            meetingLink,
            orgId,
            visibility: currentDebriefingVisibility,
            members: currentDebriefingVisibility === 'specific' ? selectedDebriefingMembers : []
        };

        console.log('?? Payload:', payload);

        let url = SERVER_URL + '/api/debriefings/create';
        if (editingDebriefingId) {
            url = SERVER_URL + '/api/debriefings/update';
            payload.debriefingId = editingDebriefingId;
        }

        console.log('?? Sending request to:', url);

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('?? Response status:', res.status);

        if (res.ok) {
            const data = await res.json();
            console.log('? Success:', data);
            showToast(editingDebriefingId ? 'Debriefing updated!' : 'Debriefing scheduled!', '?');

            // Emit socket event
            if (socket && socket.connected) {
                socket.emit('debriefing_updated', {
                    action: editingDebriefingId ? 'updated' : 'created',
                    orgId: orgId
                });
            }

            hideDebriefingForm();
            loadDebriefings();
            loadUpcomingDebriefings(); // Refresh upcoming sessions
        } else {
            const errorData = await res.json();
            console.error('? Error response:', errorData);
            showToast('Failed to save debriefing: ' + (errorData.error || 'Unknown error'), '??');
        }
    } catch (err) {
        console.error('? Save debriefing error:', err);
        showToast('Error saving debriefing', '??');
    }
}

async function loadDebriefings() {
    try {
        const orgId = storageGet('psyc_orgId');
        if (!orgId) {
            console.log('loadDebriefings: No orgId found');
            return;
        }

        // Make sure currentUser exists
        if (!currentUser) {
            console.warn('loadDebriefings: currentUser not available yet');
            return;
        }

        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + `/api/debriefings/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            allDebriefings = await res.json();

            // Safely render - wrap in try-catch
            try {
                renderDebriefingsList();
            } catch (err) {
                console.error('Error rendering debriefings list:', err);
            }

            try {
                renderDebriefingBanner();
            } catch (err) {
                console.error('Error rendering debriefings banner:', err);
            }
        } else {
            console.warn('Failed to load debriefings:', res.status);
        }
    } catch (err) {
        console.error('Error loading debriefings:', err);
        // Don't throw - just log and continue
    }
}

function renderDebriefingsList() {
    const container = document.getElementById('debriefing-list-container');
    if (!container) return;

    // Safety check
    if (!currentUser) {
        container.innerHTML = '<div class="empty-msg"><span>??</span><p>Loading...</p></div>';
        return;
    }

    const currentUserId = currentUser.uid;
    const now = new Date();

    // Filter upcoming debriefings visible to current user
    const upcomingDebriefings = allDebriefings.filter(d => {
        const debriefingDateTime = new Date(`${d.date}T${d.time}`);
        const isUpcoming = debriefingDateTime >= now;
        const isVisible = d.visibility === 'all' ||
            (d.visibility === 'specific' && d.members && d.members.includes(currentUserId)) ||
            d.createdBy === currentUserId;
        return isUpcoming && isVisible;
    }).sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.time}`);
        const dateB = new Date(`${b.date}T${b.time}`);
        return dateA - dateB;
    });

    if (upcomingDebriefings.length === 0) {
        container.innerHTML = `
            <div class="debriefing-empty-state">
                <i class="bi bi-calendar-x"></i>
                <p>No upcoming debriefing sessions</p>
            </div>
        `;
        return;
    }

    container.innerHTML = upcomingDebriefings.map((d, index) => {
        const debriefingDateTime = new Date(`${d.date}T${d.time}`);
        const dateStr = debriefingDateTime.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
        const timeStr = debriefingDateTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        const canEdit = isSupervisor && d.createdBy === currentUserId;

        return `
            <div style="background:white;border:none;${index === 0 ? 'border-top:1px solid #e2e8f0;' : ''}border-bottom:1px solid #e2e8f0;padding:20px;margin-bottom:0;transition:all 0.2s;" 
                 onmouseover="this.style.background='#f8fafc';"
                 onmouseout="this.style.background='white';">
                
                <!-- Header with Title and Actions -->
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:1.1rem;color:#0f172a;margin-bottom:8px;">
                            ${escapeHtml(d.title)}
                        </div>
                    </div>
                    ${canEdit ? `
                        <div style="display:flex;gap:6px;">
                            <button onclick="editDebriefing('${d.id}')" style="
                                width:36px;
                                height:36px;
                                border-radius:8px;
                                background:#f1f5f9;
                                border:none;
                                cursor:pointer;
                                display:flex;
                                align-items:center;
                                justify-content:center;
                                transition:all 0.2s;
                                color:#64748b;
                            " onmouseover="this.style.background='#e2e8f0';this.style.color='#3b82f6';" 
                               onmouseout="this.style.background='#f1f5f9';this.style.color='#64748b';" 
                               title="Edit">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;">
                                    <path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z" />
                                </svg>
                            </button>
                            <button onclick="deleteDebriefing('${d.id}')" style="
                                width:36px;
                                height:36px;
                                border-radius:8px;
                                background:#fef2f2;
                                border:none;
                                cursor:pointer;
                                display:flex;
                                align-items:center;
                                justify-content:center;
                                transition:all 0.2s;
                                color:#ef4444;
                            " onmouseover="this.style.background='#fee2e2';" 
                               onmouseout="this.style.background='#fef2f2';" 
                               title="Delete">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;">
                                    <path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 013.878.512.75.75 0 11-.256 1.478l-.209-.035-1.005 13.07a3 3 0 01-2.991 2.77H8.084a3 3 0 01-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 01-.256-1.478A48.567 48.567 0 017.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 013.369 0c1.603.051 2.815 1.387 2.815 2.951zm-6.136-1.452a51.196 51.196 0 013.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 00-6 0v-.113c0-.794.609-1.428 1.364-1.452zm-.355 5.945a.75.75 0 10-1.5.058l.347 9a.75.75 0 101.499-.058l-.346-9zm5.48.058a.75.75 0 10-1.498-.058l-.347 9a.75.75 0 001.5.058l.345-9z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Date & Time -->
                <div style="display:flex;align-items:center;gap:16px;margin-bottom:${d.description ? '12px' : '16px'};">
                    <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:#eff6ff;border-radius:8px;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3b82f6" style="width:16px;height:16px;">
                            <path d="M12.75 12.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM7.5 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM8.25 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM9.75 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM10.5 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM12.75 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM14.25 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM15 17.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM16.5 15.75a.75.75 0 100-1.5.75.75 0 000 1.5zM15 12.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM16.5 13.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                            <path fill-rule="evenodd" d="M6.75 2.25A.75.75 0 017.5 3v1.5h9V3A.75.75 0 0118 3v1.5h.75a3 3 0 013 3v11.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V7.5a3 3 0 013-3H6V3a.75.75 0 01.75-.75zm13.5 9a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v7.5a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5v-7.5z" clip-rule="evenodd" />
                        </svg>
                        <span style="font-size:0.9rem;font-weight:600;color:#1e40af;">${dateStr}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:#eff6ff;border-radius:8px;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3b82f6" style="width:16px;height:16px;">
                            <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clip-rule="evenodd" />
                        </svg>
                        <span style="font-size:0.9rem;font-weight:600;color:#1e40af;">${timeStr}</span>
                    </div>
                </div>
                
                <!-- Description -->
                ${d.description ? `
                    <div style="font-size:0.95rem;color:#64748b;line-height:1.6;margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;">
                        ${escapeHtml(d.description)}
                    </div>
                ` : ''}
                
                <!-- Visibility Badge -->
                ${(() => {
                if (d.visibility === 'all') {
                    return `<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#f0fdf4;border-radius:8px;font-size:0.85rem;font-weight:600;color:#15803d;">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;">
                                <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
                            </svg>
                            All Members
                        </div>`;
                } else {
                    const names = (d.members || []).map(uid => {
                        const m = membersMap.get(uid);
                        return m ? (m.username || m.displayName || m.email || uid) : uid;
                    });
                    return names.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;">
                            ${names.map(name => `<span style="padding:3px 10px;background:#fef3c7;border-radius:20px;font-size:0.78rem;color:#b45309;font-weight:500;">${escapeHtml(name)}</span>`).join('')}
                        </div>` : '';
                }
            })()}
            </div>
        `;
    }).join('');
}

function editDebriefing(debriefingId) {
    const debriefing = allDebriefings.find(d => d.id === debriefingId);
    if (debriefing) {
        showDebriefingForm(debriefing);
    }
}

async function deleteDebriefing(debriefingId) {
    if (!confirm('Delete this debriefing session?')) return;

    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/debriefings/delete', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ debriefingId })
        });

        if (res.ok) {
            showToast('Debriefing deleted!', '???');
            loadDebriefings();
        } else {
            showToast('Failed to delete debriefing', '??');
        }
    } catch (err) {
        console.error('Delete debriefing error:', err);
        showToast('Error deleting debriefing', '??');
    }
}

function renderDebriefingBanner() {
    // Support both entry.html and dashboard.html
    const banner = document.getElementById('debriefing-banner') || document.getElementById('debriefing-banner-dashboard');
    if (!banner) return;

    const today = new Date().toISOString().split('T')[0];
    const currentUserId = currentUser.uid;

    // Filter debriefings for today visible to current user
    const todayDebriefings = allDebriefings.filter(d => {
        const isToday = d.date === today;
        const isVisible = d.visibility === 'all' ||
            (d.visibility === 'specific' && d.members && d.members.includes(currentUserId)) ||
            d.createdBy === currentUserId;
        return isToday && isVisible;
    });

    if (todayDebriefings.length === 0) {
        banner.style.display = 'none';
        return;
    }

    banner.style.display = 'block';
    const color = '#3b82f6';
    const count = todayDebriefings.length;
    const firstDebriefing = todayDebriefings[0];

    banner.innerHTML = `
        <div onclick="openDebriefingModal()" style="
            background: ${color}20;
            cursor: pointer;
            position: relative;
            margin-bottom: 16px;
            border-radius: 16px;
            border: 2px solid ${color}60;
            padding: 16px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
        ">
            <div style="
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: ${color};
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                flex-shrink: 0;
                color: white;
            ">
                <i class="bi bi-chat-left-dots-fill"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
                <div style="
                    font-size: 16px;
                    font-weight: 700;
                    color: ${color};
                    margin-bottom: 4px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                ">
                    ${count > 1 ? `${count} Debriefing Sessions Today` : firstDebriefing.title}
                </div>
                <div style="
                    font-size: 13px;
                    color: ${color}CC;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                ">
                    <i class="bi bi-hand-index"></i> Tap to view your debriefing sessions
                </div>
            </div>
            <i class="bi bi-chevron-right" style="color: ${color}; font-size: 20px; flex-shrink: 0;"></i>
        </div>
    `;
}

// --- Real-Time Reminders Engine (1s Check) --------------------
let lastCheckedMinute = "";
let processedReminders = new Set(); // To avoid double firing within same minute

function startRemindersEngine() {
    console.log("?? Starting Reminders Engine (1s interval)");
    setInterval(checkReminders, 1000);
}

function checkReminders() {
    const now = new Date();
    // Use local time for comparison with what user input in datetime-local
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    const currentMinuteStr = `${year}-${month}-${day}T${hours}:${minutes}`;

    if (currentMinuteStr !== lastCheckedMinute) {
        lastCheckedMinute = currentMinuteStr;
        // Optional: clear processedReminders every hour to keep it small
        if (minutes === "00") processedReminders.clear();
    }

    // 1. Check Goals (Personal & Team)
    if (Array.isArray(goalsList)) {
        goalsList.forEach(goal => {
            if (goal.reminderDateTime === currentMinuteStr && !processedReminders.has(`goal-${goal.id}-${currentMinuteStr}`)) {
                processedReminders.add(`goal-${goal.id}-${currentMinuteStr}`);
                fireGoalNotification(goal);
            }
        });
    }

    // 2. Check Important Days
    if (Array.isArray(allImportantDays)) {
        allImportantDays.forEach(dayItem => {
            // Important days have date (YYYY-MM-DD) and optional time (HH:mm)
            if (dayItem.date && dayItem.time) {
                const eventDayMinute = `${dayItem.date}T${dayItem.time}`;
                if (eventDayMinute === currentMinuteStr && !processedReminders.has(`event-${dayItem.id}-${currentMinuteStr}`)) {
                    processedReminders.add(`event-${dayItem.id}-${currentMinuteStr}`);
                    fireImportantDayNotification(dayItem);
                }
            } else if (dayItem.date === `${year}-${month}-${day}` && hours === "09" && minutes === "00" && !processedReminders.has(`event-${dayItem.id}-daystart`)) {
                // If no time set, notify at 9:00 AM
                processedReminders.add(`event-${dayItem.id}-daystart`);
                fireImportantDayNotification(dayItem);
            }
        });
    }

    // 3. Check Upcoming Scheduled Sessions turning into Ongoing Sessions
    if (Array.isArray(window.upcomingDebriefingsList)) {
        window.upcomingDebriefingsList.forEach(session => {
            const sessionTimeStr = `${session.date}T${session.time}`;
            if (sessionTimeStr === currentMinuteStr && !processedReminders.has(`session-${session.id}-${currentMinuteStr}`)) {
                processedReminders.add(`session-${session.id}-${currentMinuteStr}`);

                // Trigger live updates and notification
                playNotificationSound();
                showOngoingSessionBadge();
                showToast(`Live session started: ${session.title}`, '??');

                // Refresh both cards
                if (typeof loadUpcomingDebriefings === 'function') loadUpcomingDebriefings();
                if (typeof loadOngoingDebriefings === 'function') loadOngoingDebriefings();

                // Persistent Log via socket
                if (socket && socket.connected) {
                    socket.emit('createNotification', {
                        title: `Live Session Started`,
                        body: session.title,
                        type: 'debriefing',
                        category: 'event',
                        linkId: session.id
                    });
                }

                // Native notification
                if (window.capacitorNotifications) {
                    window.capacitorNotifications.sendDebriefingNotification(session, 'started');
                }
            }
        });
    }

}

// ---------------------------------------------------------------
// TEST FUNCTION - Daily Check-in Notification (Every Minute)
// ---------------------------------------------------------------
let testDailyReminderInterval = null;

function startTestDailyReminder() {
    console.log("?? TEST MODE: Starting daily check-in notification test (every minute)");

    // Clear any existing test interval
    if (testDailyReminderInterval) {
        clearInterval(testDailyReminderInterval);
    }

    // Fire immediately first
    fireDailyCheckInNotification();

    // Then fire every minute
    testDailyReminderInterval = setInterval(() => {
        fireDailyCheckInNotification();
    }, 60000); // 60 seconds = 1 minute

    showToast('Test mode activated: Notification every minute', '??');
}

function stopTestDailyReminder() {
    if (testDailyReminderInterval) {
        clearInterval(testDailyReminderInterval);
        testDailyReminderInterval = null;
        console.log("?? TEST MODE: Stopped daily check-in notification test");
        showToast('Test mode deactivated', '?');
    }
}

function fireDailyCheckInNotification() {
    console.log("?? Firing Daily Check-in Notification");

    // DON'T show the banner - it only shows if no entry for today
    // The banner will automatically show tomorrow at 12 AM (new day)

    // Play notification sound
    playNotificationSound();

    // Send notification
    if (window.capacitorNotifications) {
        window.capacitorNotifications.sendMoodCheckInNotification();
    } else if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification('Daily Check-in', {
            body: 'How are you feeling today? Log your mood in Alwan.',
            tag: 'Alwan-daily-reminder',
            icon: '/assets/logo/logo.jpg'
        });

        n.onclick = () => {
            window.focus();
            openQuickMoodNew();
            n.close();
        };
    } else {
        showToast('How are you feeling? Time to log your mood.', '?');
    }

    // Add to notification log
    addNotificationToLog(
        'Daily Check-in',
        'How are you feeling today?',
        'reminder',
        'System',
        new Date()
    );
}

// Make test functions globally available
window.startTestDailyReminder = startTestDailyReminder;
window.stopTestDailyReminder = stopTestDailyReminder;
window.fireDailyCheckInNotification = fireDailyCheckInNotification;

// ---------------------------------------------------------------

// Test function for debugging
async function testGoalNotification() {
    console.log("? Firing Important Day Notification:", event.title);

    alarmSound.play().catch(e => console.warn("Audio play blocked", e));

    setTimeout(() => {
        alert("? IMPORTANT DAY!\n\n" + event.title + (event.notes ? "\n" + event.notes : ""));
    }, 100);

    if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification('? Important Day', {
            body: event.title,
            icon: '/assets/logo/logo.jpg'
        });
        n.onclick = () => { window.focus(); openImportantDaysModal(); n.close(); };
    }

    showToast(`? ${event.title}`, '??');

    if (socket && event.type === 'team') {
        socket.emit('createNotification', {
            title: event.title,
            body: 'Important Team Event Now!',
            type: 'event',
            category: 'team',
            linkId: event.id
        });
    }
}

function getFiredImpDayNotifications() {
    try {
        return JSON.parse(localStorage.getItem(IMP_DAY_FIRED_KEY) || '[]');
    } catch {
        return [];
    }
}

function markImpDayFired(notifId) {
    const fired = getFiredImpDayNotifications();
    if (!fired.includes(notifId)) {
        fired.push(notifId);
        if (fired.length > 100) fired.splice(0, fired.length - 100);
        localStorage.setItem(IMP_DAY_FIRED_KEY, JSON.stringify(fired));
    }
}

async function scheduleImportantDayNotifications() {
    // This function is now just a placeholder - we use real-time checking instead
    console.log('?? Important day notifications will be checked in real-time');
}

function fireImportantDayNotification(day, reminderType, isCatchUp = false) {
    console.log('?? Firing important day notification for:', day.title);

    // Show in-app notification popup (same as goals)
    showImportantDayNotification([day]);

    // Persistent Log via socket
    if (socket && socket.connected) {
        socket.emit('createNotification', {
            title: day.title,
            body: day.notes || (day.type === 'team' ? 'Important Team Event' : 'Important day event'),
            type: 'important_day',
            category: day.type === 'team' ? 'team' : 'personal',
            linkId: day.id,
            dayData: day // Attach full data for popup on other clients
        });
    }

    // Native notification
    if (window.capacitorNotifications) {
        window.capacitorNotifications.sendImportantDayNotification(day);
    }
}

// --- Logout -----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtnMore = document.getElementById('logout-btn-more');

    const handleLogout = () => {
        if (socket) socket.disconnect();
        storageRemove('psyc_orgId');
        storageRemove('psyc_username');
        storageRemove('psyc_orgName');
        auth.signOut().then(() => window.location.href = '/');
    };

    if (logoutBtnMore) {
        logoutBtnMore.addEventListener('click', handleLogout);
    }

    // Daily reminder settings
    const reminderToggle = document.getElementById('reminder-enabled');
    const reminderTime = document.getElementById('reminder-time');

    if (reminderToggle) {
        reminderToggle.addEventListener('change', async (e) => {
            if (e.target.checked) {
                const granted = await ensureNotificationPermission();
                if (!granted) {
                    e.target.checked = false;
                    showToast('Enable notifications in your browser to use reminders.', '??');
                    return;
                }
            }
            saveReminderSettings({ enabled: e.target.checked });
        });
    }

    if (reminderTime) {
        reminderTime.addEventListener('change', (e) => {
            const value = e.target.value || '18:00';
            saveReminderSettings({ time: value });
        });
    }

    loadReminderSettings();
});

// --- Copy Admin Invite Code -------------------------------------
function copyAdminCode() {
    const code = document.getElementById('admin-invite-code')?.textContent;
    if (code) {
        navigator.clipboard.writeText(code);
        showToast('Invite code copied!', '??');
    }
}

// --- Tab Switching ----------------------------------------------
function switchTab(tabName) {
    document.querySelectorAll('.tab-page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

    // Add active class to corresponding tab and nav item
    const tab = document.getElementById('tab-' + tabName);
    if (tab) tab.classList.add('active');

    const navItem = document.querySelector('.nav-item[data-tab="' + tabName + '"]');
    if (navItem) navItem.classList.add('active');

    // Hide/show topbar and org-bar based on tab
    const topbar = document.querySelector('.topbar');
    const orgBar = document.querySelector('.org-bar');

    if (tabName === 'more' || tabName === 'team') {
        if (topbar) topbar.style.display = 'none';
        if (orgBar) orgBar.style.display = 'none';
    } else {
        if (topbar) topbar.style.display = 'flex';
        if (orgBar) orgBar.style.display = 'flex';
    }

    // Feature actions based on tab
    if (tabName === 'stats' && currentUser && typeof loadStatsCharts === 'function') {
        loadStatsCharts();
    }

    if (tabName === 'calendar') {
        renderCalendarGrid();
    }

    if (tabName === 'team') {
        updateTeamHeader();
    }
}

// --- Year Stats Overlay Toggle ----------------------------------
function toggleYearStatsView() {
    const overlay = document.getElementById('year-stats-overlay');
    const bottomNav = document.querySelector('.bottom-nav');

    if (!overlay) return;

    if (overlay.classList.contains('open')) {
        overlay.classList.remove('open');
        document.body.style.overflow = '';

        // Show bottom nav
        if (bottomNav) {
            bottomNav.style.display = 'flex';
        }
    } else {
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';

        // Hide bottom nav
        if (bottomNav) {
            bottomNav.style.display = 'none';
        }

        // Reset to current year when opening
        currentYearView = new Date().getFullYear();

        // Load year stats when opening
        if (currentUser && typeof loadYearStats === 'function') {
            loadYearStats();
        }
    }
}

// --- Render Calendar Grid ------------------------------------------
async function renderCalendarGrid() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    // To make it simple, let's fetch from the API to sync up user's history
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/user/calendar-logs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.logs) {
            // merge logs to personalEntries
            data.logs.forEach(log => {
                const exists = personalEntries.find(e => e.id === log.id || (e.uid === currentUser.uid && e.timestamp === log.timestamp));
                if (!exists) {
                    const moodObj = getMoodByKey(log.mood);
                    personalEntries.push({
                        id: log.id,
                        uid: currentUser.uid,
                        mood: log.mood,
                        moodEmoji: moodObj?.emoji || '??',
                        moodLabel: moodObj?.label || log.mood,
                        moodColor: moodObj?.color || '#fff',
                        timestamp: new Date(log.timestamp).getTime(),
                    });
                }
            });
            personalEntries.sort((a, b) => b.timestamp - a.timestamp);
        }
    } catch (err) {
        console.error('Failed to load user logs', err);
    }

    const today = new Date();
    const currentYear = viewMonth.getFullYear();
    const currentMonth = viewMonth.getMonth();

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const startDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();

    let html = '';

    // Empty cells before start of month
    for (let i = 0; i < startDayOfWeek; i++) {
        html += '<div class="cal-cell empty"></div>';
    }

    // Ensure important days are loaded for markers
    if (typeof fetchImportantDaysForCalendar === 'function') {
        await fetchImportantDaysForCalendar();
    }

    // Stats variables
    const moodCounts = {};
    let totalEntries = 0;

    // Days in month
    for (let i = 1; i <= daysInMonth; i++) {
        let cellStyle = '';
        let dateStyle = '';
        let extraClassTop = '';
        let extraClassWrapper = '';
        let onClickAttr = '';

        let circleContent = '';
        let dateContent = i;

        // Important Day Marker
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayImpDays = typeof getImportantDaysForDate === 'function' ? getImportantDaysForDate(dateStr) : [];
        let markerHtml = '';
        if (dayImpDays.length > 0) {
            const firstColor = dayImpDays[0].color || 'var(--d-primary)';
            markerHtml = `<div class="cal-event-marker" style="background: ${firstColor};"></div>`;
        }

        // Check if there are entries for this day
        const dayStart = new Date(currentYear, currentMonth, i).getTime();
        const dayEnd = new Date(currentYear, currentMonth, i, 23, 59, 59, 999).getTime();

        // Find all entries for this day
        const dayEntries = personalEntries.filter(e => e.uid === currentUser?.uid && e.timestamp >= dayStart && e.timestamp <= dayEnd);

        if (dayEntries.length > 0) {
            extraClassTop += ' has-mood';
            onClickAttr = ` onclick="openDayDetails(${dayStart});"`;

            // Stats: count every entry
            totalEntries += dayEntries.length;
            dayEntries.forEach(entry => {
                const mk = entry.mood;
                if (!moodCounts[mk]) {
                    const mObj = getMoodByKey(mk);
                    moodCounts[mk] = { count: 0, label: mObj?.label || mk, color: entry.moodColor };
                }
                moodCounts[mk].count++;
            });

            if (dayEntries.length === 1) {
                const dayEntry = dayEntries[0];
                const mObj = getMoodByKey(dayEntry.mood);
                const svgStr = mObj?.svg
                    ? mObj.svg
                        .replace(/width="\d+"/, 'width="36"')
                        .replace(/height="\d+"/, 'height="36"')
                        .replace(/class="(joy|sadness|anger|disgust|fear)"/, 'class="cal-face $1"')
                    : `<span>${dayEntry.moodEmoji}</span>`;
                cellStyle = `background-color: ${dayEntry.moodColor};`;
                dateStyle = `color: ${dayEntry.moodColor};`;
                circleContent = svgStr;
            } else {
                // Stacked moods (Daylio style)
                dateStyle = `color: ${dayEntries[0].moodColor};`;
                extraClassTop += ' is-stacked';

                const stackLimit = 3;
                const visibleMoods = dayEntries.slice(0, stackLimit);
                circleContent = `<div class="mood-stack">
                    ${visibleMoods.reverse().map((e, idx) => {
                    const mObj = getMoodByKey(e.mood);
                    const svgStr = mObj?.svg
                        ? mObj.svg
                            .replace(/width="\d+"/, 'width="28"')
                            .replace(/height="\d+"/, 'height="28"')
                            .replace(/class="(joy|sadness|anger|disgust|fear)"/, 'class="cal-face $1"')
                        : e.moodEmoji;
                    return `<div class="stack-item" style="background: ${e.moodColor}; z-index: ${idx};">${svgStr}</div>`;
                }).join('')}
                    ${dayEntries.length > stackLimit ? `<div class="stack-more">+${dayEntries.length - stackLimit}</div>` : ''}
                </div>`;
            }
        } else {
            // Check if day is in past or today
            const isPastOrToday = dayEnd <= today.getTime() || (i === today.getDate() && currentMonth === today.getMonth());
            if (isPastOrToday) {
                const clickTime = new Date(currentYear, currentMonth, i, 12, 0, 0).getTime();
                circleContent = '<span style="font-size: 1.2rem; margin-bottom: 2px;">+</span>';
                onClickAttr = ` onclick="openQuickMoodSelector(${clickTime});"`;
                extraClassWrapper += ' clickable-cell';
            } else {
                circleContent = ''; // completely empty circle
            }
        }

        // Highlight today
        if (i === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear()) {
            extraClassWrapper += ' is-today';
        }

        html += `
        <div class="cal-day-cell ${extraClassWrapper}"${onClickAttr}>
            <div class="cal-cell-top${extraClassTop}" style="${cellStyle}">
                ${circleContent}
            </div>
            <div class="cal-cell-bottom" style="${dateStyle}">
                ${dateContent}
                ${markerHtml}
            </div>
        </div>
        `;
    }

    grid.innerHTML = html;

    // Render donut stats dummy
    const statsContainer = document.getElementById('mood-count-stats');
    if (statsContainer) {
        // Daylio-style mood faces with small count badges
        const primaryMoodKeys = ['rad', 'good', 'meh', 'bad', 'awful'];
        const chipsHtml = primaryMoodKeys.map(key => {
            const def = getMoodByKey(key);
            if (!def) return '';
            const info = moodCounts[key];
            const count = info ? info.count : 0;
            const isActive = count > 0;
            const bgStyle = isActive ? `background: ${def.color};` : '';
            return `
            <div class="mood-count-chip">
                <div class="mood-count-face" style="${bgStyle}">
                    <span>${def.emoji}</span>
                </div>
                ${isActive ? `<div class="mood-count-badge">${count}</div>` : ''}
            </div>
            `;
        }).join('');

        statsContainer.innerHTML = `
            <div class="mood-count-row">
                ${chipsHtml}
            </div>
        `;

        // Update dynamic donut arc
        const donutValue = document.querySelector('.mood-donut-value');
        if (donutValue) donutValue.innerHTML = `<span style="font-size: 2rem; font-weight: 800">${totalEntries}</span><br><span style="font-size:0.7rem; color:var(--text-sub)">entries</span>`;

        const donutArc = document.querySelector('.mood-donut-arc');
        if (donutArc) {
            if (totalEntries === 0) {
                // Return to static empty state
                donutArc.style.background = `conic-gradient(from 270deg, rgba(255,255,255,0.05) 0deg 180deg, transparent 180deg)`;
            } else {
                let currentDeg = 0;
                const segments = [];
                // Use the same order as segments: rad, good, meh, bad, awful
                const keys = ['rad', 'good', 'meh', 'bad', 'awful'];

                keys.forEach(key => {
                    const count = moodCounts[key] ? moodCounts[key].count : 0;
                    if (count > 0) {
                        const deg = (count / totalEntries) * 180;
                        const mood = getMoodByKey(key);
                        segments.push(`${mood.color} ${currentDeg}deg ${currentDeg + deg}deg`);
                        currentDeg += deg;
                    }
                });

                // Add background for remaining 180 if needed (though total should be 180)
                if (currentDeg < 180) {
                    segments.push(`rgba(255,255,255,0.05) ${currentDeg}deg 180deg`);
                }

                donutArc.style.background = `conic-gradient(from 270deg, ${segments.join(', ')}, transparent 180deg)`;
            }
        }
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export functions to window for onclick handlers
window.renderActivityGrid = renderActivityGrid;
window.renderEmotionGrid = renderEmotionGrid;
window.openQuickMoodSelector = openQuickMoodSelector;
window.closeQuickMoodModal = closeQuickMoodModal;
window.selectQuickMood = selectQuickMood;
window.toggleFabMenu = toggleFabMenu;
window.switchTab = switchTab;
window.openMonthPicker = openMonthPicker;
window.closeMonthPicker = closeMonthPicker;
window.setFeedFilter = setFeedFilter;
window.toggleYearStatsView = toggleYearStatsView;


window.openThemeSelector = openThemeSelector;
window.openDayDetails = openDayDetails;
window.closeDayDetails = closeDayDetails;
window.openMoodModal = openMoodModal;
window.closeMoodModal = closeMoodModal;
window.onDateInputChange = onDateInputChange;
window.resetDayFilter = resetDayFilter;
window.copyAdminCode = copyAdminCode;

// --- Auto-hide header on scroll ---------------------------------
let lastScrollY = 0;
let scrollDirection = 0; // -1 = up, 1 = down
let ticking = false;

function handleScroll() {
    const currentScrollY = window.scrollY;
    const topbar = document.querySelector('.topbar');
    const orgBar = document.querySelector('.org-bar');

    if (!topbar || !orgBar) return;

    const scrollDelta = currentScrollY - lastScrollY;
    const scrollThreshold = 5; // Minimum scroll to trigger

    // Determine scroll direction
    if (Math.abs(scrollDelta) > scrollThreshold) {
        scrollDirection = scrollDelta > 0 ? 1 : -1;
    }

    // Get actual heights
    const topbarHeight = topbar.offsetHeight;
    const orgBarHeight = orgBar.offsetHeight;
    const totalHeight = topbarHeight + orgBarHeight;

    // Calculate smooth transform based on scroll position
    if (currentScrollY < 10) {
        // At top - always show
        topbar.style.transform = 'translateY(0)';
        orgBar.style.transform = 'translateY(0)';
    } else if (scrollDirection === 1 && currentScrollY > 60) {
        // Scrolling down - hide completely
        topbar.style.transform = `translateY(-${topbarHeight}px)`;
        orgBar.style.transform = `translateY(-${totalHeight}px)`;
    } else if (scrollDirection === -1) {
        // Scrolling up - show
        topbar.style.transform = 'translateY(0)';
        orgBar.style.transform = 'translateY(0)';
    }

    lastScrollY = currentScrollY;
    ticking = false;
}

function requestScrollTick() {
    if (!ticking) {
        window.requestAnimationFrame(handleScroll);
        ticking = true;
    }
}

window.addEventListener('scroll', requestScrollTick, { passive: true });




// --- Year Stats Dropdown Handler --------------------------------
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('year-mood-dropdown');
    const btn = document.getElementById('year-mood-btn');

    if (dropdown && btn && dropdown.classList.contains('open')) {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.remove('open');
            btn.classList.remove('open');
        }
    }
});

// --- Handle Android Back Button for Year Stats Overlay ----------
window.addEventListener('popstate', () => {
    const overlay = document.getElementById('year-stats-overlay');
    if (overlay && overlay.classList.contains('open')) {
        toggleYearStatsView();
    }
});


// --- More Tab Modal Functions -----------------------------------
function openCustomizeEmotions() {
    openMoodEdit();
    // Switch to emotions tab
    setTimeout(() => {
        const emotionsTab = document.querySelector('[data-tab="moods"]');
        if (emotionsTab) emotionsTab.click();
    }, 100);
}

function openCustomizeActivities() {
    openMoodEdit();
    // Switch to activities tab
    setTimeout(() => {
        const activitiesTab = document.querySelector('[data-tab="activities"]');
        if (activitiesTab) activitiesTab.click();
    }, 100);
}

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        // Sync theme toggle state
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.checked = document.body.classList.contains('dark-mode');
        }

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function openAboutModal() {
    const modal = document.getElementById('about-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeAboutModal() {
    const modal = document.getElementById('about-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function openRemindersSettings() {
    const modal = document.getElementById('reminders-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeRemindersSettings() {
    const modal = document.getElementById('reminders-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}


// --- Update Team Header -----------------------------------------
function updateTeamHeader() {
    const orgNameEl = document.getElementById('team-org-name');
    const rsOrgNameEl = document.getElementById('rs-team-org-name');
    const tabOrgNameEl = document.getElementById('team-tab-org-name');
    const onlineCountEl = document.getElementById('team-online-count');
    const totalCountEl = document.getElementById('team-total-count');

    const cachedOrgName = storageGet('psyc_orgName');

    if (orgNameEl) orgNameEl.textContent = cachedOrgName || 'Organization';
    if (rsOrgNameEl) rsOrgNameEl.textContent = cachedOrgName ? `${cachedOrgName}` : '';
    if (tabOrgNameEl) tabOrgNameEl.textContent = cachedOrgName ? `${cachedOrgName}` : '';

    // Update sidebar sub-labels if they exist
    document.querySelectorAll('.sb-org-name-sub').forEach(el => {
        el.textContent = cachedOrgName || '';
    });

    if (onlineCountEl && totalCountEl) {
        const members = Array.from(membersMap.values());
        const onlineCount = members.filter(m => m.isOnline).length;
        onlineCountEl.textContent = onlineCount;
        totalCountEl.textContent = members.length;
    }
}


// --- Handle Removal from Organization -------------------------------
function handleRemovalConfirm() {
    console.log('?? Handling removal confirmation');

    // Close modal
    const modal = document.getElementById('removed-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }

    // Clear all local data
    localStorage.clear();

    // Disconnect socket
    if (socket) {
        socket.disconnect();
    }

    // Sign out from Firebase
    if (typeof auth !== 'undefined' && auth) {
        auth.signOut().then(() => {
            // Redirect to login page
            window.location.replace('/');
        }).catch((err) => {
            console.error('Sign out error:', err);
            // Force redirect even if signout fails
            window.location.replace('/');
        });
    } else {
        // If auth not available, just redirect
        window.location.replace('/');
    }
}

// --- Leave Organization Functions ----------------------------------
function confirmLeaveOrganization() {
    if (!confirm('Are you sure you want to leave this organization? You will lose access to all team data.')) {
        return;
    }
    leaveOrganization();
}

async function leaveOrganization() {
    try {
        if (!currentUser) {
            showToast('Please log in first', '??');
            return;
        }

        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        if (!orgId) {
            showToast('No organization found', '??');
            return;
        }

        const res = await fetch(SERVER_URL + '/api/org/leave', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ orgId })
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || 'Failed to leave organization');
        }

        showToast('Successfully left organization', '?');

        // Clear local storage and logout fully
        setTimeout(() => {
            if (typeof logout === 'function') {
                logout();
            } else {
                localStorage.clear();
                window.location.replace('/');
            }
        }, 1500);

    } catch (err) {
        console.error('Leave organization error:', err);
        showToast(err.message || 'Failed to leave organization', '?');
    }
}

// --- Notification Center logic --------------------------------------

async function fetchNotifications(user) {
    if (!user) return;
    try {
        const token = await user.getIdToken();
        const orgId = storageGet('psyc_orgId');
        if (!orgId) return;

        const res = await fetch(SERVER_URL + `/api/notifications/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            console.log('Notifications endpoint not available');
            return;
        }

        const data = await res.json();

        if (data.success) {
            notificationLogs = data.notifications || [];
            renderNotificationLogs();
        }
    } catch (err) {
        console.log('Notifications not configured:', err.message);
    }
}

function renderNotificationLogs() {
    const listEl = document.getElementById('reminders-widget');
    const mobileListEl = document.getElementById('mobile-reminders-content');

    // If neither exists, nothing to do
    if (!listEl && !mobileListEl) return;

    let html = '';

    // Filter notifications: hide SOS alerts from non-supervisors
    const filteredLogs = notificationLogs.filter(notif => {
        if (notif.type === 'sos' && !window.isSupervisor) {
            return false; // Hide SOS alerts for non-supervisors
        }
        return true;
    });

    if (filteredLogs.length === 0) {
        html = `
            <div style="text-align: center; color: #94a3b8; padding: 40px 20px; font-size: 0.85rem; background: rgba(0,0,0,0.02); border-radius: 16px; margin: 10px 0;">
                <div style="width: 50px; height: 50px; background: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                    <i class="bi bi-bell-slash" style="font-size: 1.5rem; color: #cbd5e1;"></i>
                </div>
                <p style="margin: 0; font-weight: 600; color: #64748b;">No updates yet</p>
                <p style="margin: 4px 0 0; font-size: 0.75rem; opacity: 0.7;">Important group updates will appear here.</p>
            </div>`;
    } else {
        html = filteredLogs.map(notif => {
            const timeStr = getTimeAgo(notif.timestamp);

            // Advanced Icon & Color mapping
            let icon = '<i class="bi bi-bell-fill"></i>';
            let bgColor = 'rgba(99, 102, 241, 0.08)';
            let iconColor = '#6366f1';
            let borderColor = 'rgba(99, 102, 241, 0.2)';

            if (notif.type === 'goal') {
                icon = '<i class="bi bi-trophy-fill"></i>';
                bgColor = 'rgba(139, 92, 246, 0.08)';
                iconColor = '#8b5cf6';
                borderColor = 'rgba(139, 92, 246, 0.2)';
            } else if (notif.type === 'important_day') {
                icon = '<i class="bi bi-star-fill"></i>';
                bgColor = 'rgba(245, 158, 11, 0.08)';
                iconColor = '#f59e0b';
                borderColor = 'rgba(245, 158, 11, 0.2)';
            } else if (notif.type === 'debriefing') {
                icon = '<i class="bi bi-chat-dots-fill"></i>';
                bgColor = 'rgba(16, 185, 129, 0.08)';
                iconColor = '#10b981';
                borderColor = 'rgba(16, 185, 129, 0.2)';
            } else if (notif.type === 'sos') {
                icon = '<i class="bi bi-exclamation-triangle-fill"></i>';
                bgColor = 'rgba(239, 68, 68, 0.08)';
                iconColor = '#ef4444';
                borderColor = 'rgba(239, 68, 68, 0.2)';
            }

            let pulseClass = '';
            if (notif.type === 'sos' || notif.category === 'urgent' || (notif.type === 'debriefing' && notif.title.includes('Started'))) {
                pulseClass = 'anim-pulse';
            }

            let itemOnclick = '';
            let itemCursor = 'default';
            if (notif.type === 'sos') {
                itemOnclick = `onclick="if(typeof openSOSDetailsModal === 'function') openSOSDetailsModal('${notif.linkId}')"`;
                itemCursor = 'pointer';
            } else if (notif.type === 'goal') {
                itemOnclick = `onclick="if(typeof openGoalsModal === 'function') openGoalsModal()"`;
                itemCursor = 'pointer';
            } else if (notif.type === 'important_day') {
                itemOnclick = `onclick="if(typeof openImportantDaysModal === 'function') openImportantDaysModal()"`;
                itemCursor = 'pointer';
            } else if (notif.type === 'debriefing') {
                itemOnclick = `onclick="if(typeof openDebriefingModal === 'function') openDebriefingModal()"`;
                itemCursor = 'pointer';
            }

            const isDark = document.body.classList.contains('dark-mode');
            const cardBg = isDark ? '#2a2d31' : '#fff';
            const cardBgHover = isDark ? bgColor : `${bgColor}11`;
            const titleColor = isDark ? '#f1f5f9' : '#1e293b';
            const bodyColor = isDark ? '#94a3b8' : '#4b5563';

            return `
                <style>
                    @keyframes notifPulse {
                        0% { box-shadow: 0 0 0 0 ${iconColor}66; }
                        70% { box-shadow: 0 0 0 8px ${iconColor}00; }
                        100% { box-shadow: 0 0 0 0 ${iconColor}00; }
                    }
                    .anim-pulse {
                        animation: notifPulse 2s infinite !important;
                        border-color: ${iconColor}44 !important;
                    }
                </style>
                <div class="notification-item ${pulseClass}" ${itemOnclick} style="
                    display: flex; 
                    gap: 10px; 
                    padding: 10px; 
                    background: ${cardBg}; 
                    border-radius: 12px; 
                    border: 1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'};
                    border-left: 3px solid ${iconColor};
                    margin-bottom: 8px;
                    transition: all 0.2s ease;
                    cursor: ${itemCursor};
                    position: relative;
                    text-align: left;
                " onmouseover="this.style.background='${cardBgHover}'; this.style.transform='translateY(-1px)';" 
                   onmouseout="this.style.background='${cardBg}'; this.style.transform='none';">
                    
                    <div style="
                        width: 34px; 
                        height: 34px; 
                        border-radius: 8px; 
                        background: ${bgColor}; 
                        color: ${iconColor};
                        display: flex; 
                        align-items: center; 
                        justify-content: center; 
                        font-size: 1.1rem;
                        flex-shrink: 0;
                    ">
                        ${icon}
                    </div>
                    
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1px;">
                            <span style="font-weight: 700; font-size: 0.85rem; color: ${titleColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${notif.title}</span>
                            <span style="font-size: 0.65rem; color: #94a3b8; font-weight: 500; flex-shrink: 0;">${timeStr}</span>
                        </div>
                        <div style="font-size: 0.78rem; color: ${bodyColor}; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 3px;">${notif.body}</div>
                        <div style="display: flex; align-items: center; gap: 4px; font-size: 0.68rem; font-weight: 700; color: ${iconColor}; opacity: 0.8;">
                             <div style="width: 4px; height: 4px; border-radius: 50%; background: ${iconColor};"></div>
                             ${notif.userName}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    if (listEl) listEl.innerHTML = html;
    if (mobileListEl) mobileListEl.innerHTML = html;
}

async function clearAllNotifications() {
    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');
        if (!orgId) return;

        const res = await fetch(SERVER_URL + `/api/notifications/clear?orgId=${orgId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            notificationLogs = [];
            renderNotificationLogs();
            showToast('All reminders cleared', '???');
        } else {
            console.error('Failed to clear notifications from server');
        }
    } catch (err) {
        console.error('Clear notifications error:', err);
    }
}

// --- Daily Motivational Quotes (Main Functions) --------------------------------------
// Note: Variables and toggleQuoteArchive are defined at the top of the file for early loading

// Load daily quote on page load
async function loadDailyQuote() {
    console.log('=== loadDailyQuote called ===');
    try {
        // Check if we have cached quotes
        const cachedQuotes = localStorage.getItem('psyc_quotes_cache');
        const cacheTimestamp = localStorage.getItem('psyc_quotes_timestamp');
        const now = Date.now();

        console.log('Cached quotes exist:', !!cachedQuotes);
        console.log('Cache timestamp:', cacheTimestamp);

        // Use cache if it's less than 24 hours old
        if (cachedQuotes && cacheTimestamp && (now - parseInt(cacheTimestamp)) < 86400000) {
            quotesCache = JSON.parse(cachedQuotes);
        } else {
            // Use LD_QUOTES from dashboard.html as the source
            if (typeof LD_QUOTES !== 'undefined' && LD_QUOTES.length > 0) {
                // Convert string array to quote objects
                quotesCache = LD_QUOTES.map(q => ({ q: q, a: "Daily Wisdom" }));
                console.log('Loaded quotes from LD_QUOTES:', quotesCache.length);
            } else {
                console.warn('LD_QUOTES not available, using fallback');
                quotesCache = [{
                    q: "Believe you can and you're halfway there.",
                    a: "Theodore Roosevelt"
                }];
            }

            // Shuffle quotes
            quotesCache = quotesCache.sort(() => Math.random() - 0.5);

            // Cache the quotes
            localStorage.setItem('psyc_quotes_cache', JSON.stringify(quotesCache));
            localStorage.setItem('psyc_quotes_timestamp', now.toString());
        }

        // Get or set daily quote (changes at 6am)
        dailyQuote = getDailyQuote();
        console.log('Daily quote set:', dailyQuote);
        displayQuote(dailyQuote);
        console.log('=== loadDailyQuote completed successfully ===');

    } catch (error) {
        console.error('Error loading quote:', error);
        displayQuote({
            q: "Believe you can and you're halfway there.",
            a: "Theodore Roosevelt"
        });
    }
}

// Get daily quote (changes at 6am every day)
function getDailyQuote() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // If it's before 6am, use yesterday's date
    if (now.getHours() < 6) {
        today.setDate(today.getDate() - 1);
    }

    const dateKey = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const storedDaily = localStorage.getItem('psyc_daily_quote');
    const storedDate = localStorage.getItem('psyc_daily_quote_date');

    // If we have a quote for today, use it
    if (storedDaily && storedDate === dateKey) {
        return JSON.parse(storedDaily);
    }

    // Otherwise, pick a new random quote
    if (quotesCache.length > 0) {
        const randomIndex = Math.floor(Math.random() * quotesCache.length);
        const newDailyQuote = quotesCache[randomIndex];

        // Save it
        localStorage.setItem('psyc_daily_quote', JSON.stringify(newDailyQuote));
        localStorage.setItem('psyc_daily_quote_date', dateKey);

        return newDailyQuote;
    }

    return {
        q: "Believe you can and you're halfway there.",
        a: "Theodore Roosevelt"
    };
}

// Display a quote
function displayQuote(quote) {
    const quoteElement = document.getElementById('ld-quote');
    if (quoteElement && quote) {
        // Update the global dailyQuote variable
        dailyQuote = quote;
        console.log('? dailyQuote set in displayQuote:', dailyQuote);

        quoteElement.innerHTML = `
            "${quote.q}"
            <br><br>
            <span style="font-size: 0.9rem; color: #64748b; font-weight: 600;">� ${quote.a}</span>
        `;
    }

    // Update archive button state
    if (typeof window.updateArchiveButton === 'function') {
        window.updateArchiveButton();
    }
}

// Get archived quotes (duplicate removed - using one defined earlier)

// Show next quote (for testing - remove later)
function getArchivedQuotes() {
    const stored = localStorage.getItem('psyc_archived_quotes');
    return stored ? JSON.parse(stored) : {};
}

// Show next quote (for testing - remove later)
function ldNextQuote() {
    if (quotesCache.length === 0) {
        if (typeof ldToast === 'function') {
            ldToast('Loading quotes...', 'info');
        }
        loadDailyQuote();
        return;
    }

    currentQuoteIndex = (currentQuoteIndex + 1) % quotesCache.length;
    displayQuote(quotesCache[currentQuoteIndex]);
    if (typeof ldToast === 'function') {
        ldToast('Quote updated!', 'success');
    }
}

// Toggle quote like/favorite - SIMPLIFIED
function toggleQuoteLike() {
    const heartBtn = document.getElementById('ld-quote-heart');
    if (!heartBtn) return;

    currentQuoteLiked = !currentQuoteLiked;

    if (currentQuoteLiked) {
        heartBtn.innerHTML = '<i class="bi bi-heart-fill"></i>';
        heartBtn.classList.add('liked');
        if (typeof ldToast === 'function') {
            ldToast('Added to favorites!', 'success');
        }
    } else {
        heartBtn.innerHTML = '<i class="bi bi-heart"></i>';
        heartBtn.classList.remove('liked');
        if (typeof ldToast === 'function') {
            ldToast('Removed from favorites', 'info');
        }
    }

    if (quotesCache[currentQuoteIndex]) {
        const likedQuotes = getLikedQuotes();
        const quoteId = `${quotesCache[currentQuoteIndex].q}_${quotesCache[currentQuoteIndex].a}`;

        if (currentQuoteLiked) {
            likedQuotes[quoteId] = {
                quote: quotesCache[currentQuoteIndex].q,
                author: quotesCache[currentQuoteIndex].a,
                timestamp: Date.now()
            };
        } else {
            delete likedQuotes[quoteId];
        }

        localStorage.setItem('psyc_liked_quotes', JSON.stringify(likedQuotes));
    }
}

// Get liked quotes from localStorage
function getLikedQuotes() {
    const stored = localStorage.getItem('psyc_liked_quotes');
    return stored ? JSON.parse(stored) : {};
}

// Update heart button state
function updateHeartButton() {
    if (quotesCache.length === 0 || !quotesCache[currentQuoteIndex]) return;

    const currentQuote = quotesCache[currentQuoteIndex];
    const likedQuotes = getLikedQuotes();
    const quoteId = `${currentQuote.q}_${currentQuote.a}`;

    const heartBtn = document.getElementById('ld-quote-heart');
    if (heartBtn) {
        if (likedQuotes[quoteId]) {
            currentQuoteLiked = true;
            heartBtn.classList.add('liked');
            heartBtn.innerHTML = '<i class="bi bi-heart-fill"></i>';
        } else {
            currentQuoteLiked = false;
            heartBtn.classList.remove('liked');
            heartBtn.innerHTML = '<i class="bi bi-heart"></i>';
        }
    }
}

// Initialize quotes when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDailyQuote);
} else {
    loadDailyQuote();
}

// --- Archives Tab (Firebase + localStorage) ----------------------------------------------

async function loadArchivesQuotes() {
    const listEl = document.getElementById('archives-quotes-list');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">Loading archives...</div>';

    const user = firebase.auth().currentUser;
    let archiveArray = [];

    // Load from MongoDB if user is logged in
    if (user) {
        try {
            const token = await user.getIdToken();
            const response = await fetch(SERVER_URL + '/api/archives/quotes', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                archiveArray = await response.json();
                console.log('Loaded from MongoDB:', archiveArray.length, 'quotes');
            }
        } catch (error) {
            console.error('Error loading archives:', error);
            const localArchives = getArchivedQuotes();
            archiveArray = Object.values(localArchives);
        }
    } else {
        // Load from localStorage if not logged in
        const localArchives = getArchivedQuotes();
        archiveArray = Object.values(localArchives);
    }

    if (archiveArray.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center;padding:40px 20px;">
                <i class="bi bi-archive" style="font-size:3rem;color:#cbd5e1;display:block;margin-bottom:16px;"></i>
                <p style="color:#94a3b8;font-size:0.9rem;">No archived quotes yet.</p>
                <p style="color:#cbd5e1;font-size:0.8rem;margin-top:8px;">Click the archive button on the daily quote to save it here!</p>
            </div>
        `;
        return;
    }

    // Sort by timestamp (newest first)
    archiveArray.sort((a, b) => {
        const timeA = a.timestamp || new Date(a.createdAt).getTime() || 0;
        const timeB = b.timestamp || new Date(b.createdAt).getTime() || 0;
        return timeB - timeA;
    });

    listEl.innerHTML = archiveArray.map((item) => {
        const timestamp = item.timestamp || (item.createdAt ? new Date(item.createdAt).getTime() : Date.now());
        const date = new Date(timestamp);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        return `
                    <div style="padding:16px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;position:relative;">
                        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
                            <span style="font-size:0.7rem;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${dateStr}</span>
                            <button onclick="removeFromArchiveFirebase('${item.id || (item.quote + '_' + item.author).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100)}', '${item.quote.replace(/'/g, "\\'")}', '${item.author.replace(/'/g, "\\'")}')"
                            style="background:transparent;border:none;color:#ef4444;cursor:pointer;padding:4px;font-size:1rem;"
                            title="Remove from archives">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                    <p style="font-size:0.95rem;color:#1e293b;font-style:italic;line-height:1.6;margin-bottom:8px;">
                        "${item.quote}"
                    </p>
                    <p style="font-size:0.8rem;color:#64748b;font-weight:600;">
                        � ${item.author}
                    </p>
                </div>
            `;
    }).join('');
}

async function removeFromArchiveFirebase(quoteId, quote, author) {
    console.log('Removing from archive:', quoteId);

    const user = firebase.auth().currentUser;
    if (user) {
        try {
            const token = await user.getIdToken();
            await fetch(SERVER_URL + `/api/archives/quotes/${quoteId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log('Removed from MongoDB');
        } catch (error) {
            console.error('Error removing from MongoDB:', error);
        }
    }

    // Also remove from localStorage
    const localArchives = getArchivedQuotes();
    const localQuoteId = `${quote}_${author} `;
    delete localArchives[localQuoteId];
    localStorage.setItem('psyc_archived_quotes', JSON.stringify(localArchives));

    // Reload the list
    loadArchivesQuotes();

    if (typeof ldToast === 'function') {
        ldToast('Removed from archives', 'info');
    }
}

// Make function globally accessible
window.removeFromArchiveFirebase = removeFromArchiveFirebase;

function selectArchiveQuote(index) {
    currentQuoteIndex = index;
    displayQuote(quotesCache[index]);
    ldTab('home');
    showToast('Quote selected!', '?');
}


// --- Notification Sound & Visual Indicators ---------------------
function playNotificationSound() {
    try {
        // Create audio context for notification sound
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Configure sound (pleasant notification tone)
        oscillator.frequency.value = 800; // Hz
        oscillator.type = 'sine';

        // Fade in and out
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    } catch (err) {
        console.warn('Could not play notification sound:', err);
    }
}

function showNewSessionBadge() {
    const badge = document.getElementById('new-session-badge');
    const dot = document.getElementById('new-session-dot');

    if (badge) {
        badge.style.display = 'inline-block';
    }

    if (dot) {
        dot.style.display = 'block';
    }
}

function showOngoingSessionBadge() {
    const badge = document.getElementById('ongoing-session-badge');
    const dot = document.getElementById('ongoing-session-dot');

    if (badge) {
        badge.style.display = 'inline-block';
    }

    if (dot) {
        dot.style.display = 'block';
    }
}

// Hide badge when modal is opened
function openUpcomingDebriefingsModal() {
    const modal = document.getElementById('upcoming-debriefings-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadUpcomingDebriefings();

        // Hide new session indicators
        const badge = document.getElementById('new-session-badge');
        const dot = document.getElementById('new-session-dot');
        if (badge) badge.style.display = 'none';
        if (dot) dot.style.display = 'none';
    }
}

// Open ongoing debriefings modal
function openOngoingDebriefingsModal() {
    const modal = document.getElementById('ongoing-debriefings-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadOngoingDebriefings();

        // Hide ongoing session indicators
        const badge = document.getElementById('ongoing-session-badge');
        const dot = document.getElementById('ongoing-session-dot');
        if (badge) badge.style.display = 'none';
        if (dot) dot.style.display = 'none';
    }
}


// Open debriefing list modal (shows all scheduled sessions for supervisor)
function openDebriefingListModal() {
    const modal = document.getElementById('debriefing-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadDebriefings();
    }
}

// Open ongoing debriefings modal
function openOngoingDebriefingsModal() {
    const modal = document.getElementById('ongoing-debriefings-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadOngoingDebriefings();
    }
}

// Close ongoing debriefings modal
function closeOngoingDebriefingsModal() {
    const modal = document.getElementById('ongoing-debriefings-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}


// -------------------------------------------------------------------------------
// PREVIOUS SESSIONS MODAL (History of completed debriefing sessions)
// -------------------------------------------------------------------------------

async function openPreviousSessionsModal() {
    console.log('?? Opening previous sessions modal');

    // Open modal
    const modal = document.getElementById('previous-sessions-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    // Load previous sessions (reuse the completed sessions data)
    await loadPreviousSessions();
}

function closePreviousSessionsModal() {
    const modal = document.getElementById('previous-sessions-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');
        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

async function loadPreviousSessions() {
    console.log('?? loadPreviousSessions called');
    const container = document.getElementById('previous-sessions-content');
    if (!container) {
        console.log('? Container not found');
        return;
    }

    const orgId = storageGet('psyc_orgId');
    if (!orgId) {
        console.log('? No orgId');
        return;
    }

    if (!currentUser) {
        console.log('? No currentUser');
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + `/api/debriefings/list?orgId=${orgId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const debriefings = await res.json();

            // Filter completed sessions with evaluation forms only
            let completed = debriefings.filter(d => d.status === 'completed' && d.hasEvaluationForm)
                .sort((a, b) => {
                    const dateA = new Date(`${a.date}T${a.time}`);
                    const dateB = new Date(`${b.date}T${b.time}`);
                    return dateB - dateA; // Most recent first
                });

            // Apply month filter if set
            if (window.previousSessionsFilterMonth !== undefined && window.previousSessionsFilterYear !== undefined) {
                completed = completed.filter(d => {
                    const sessionDate = new Date(`${d.date}T${d.time}`);
                    return sessionDate.getMonth() === window.previousSessionsFilterMonth &&
                        sessionDate.getFullYear() === window.previousSessionsFilterYear;
                });
            }

            console.log('? Previous sessions:', completed);

            if (completed.length === 0) {
                container.innerHTML = `
                <div style="text-align:center;padding:60px 20px;color:#94a3b8;">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:64px;height:64px;margin:0 auto 16px;opacity:0.3;">
                        <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clip-rule="evenodd" />
                    </svg>
                    <p style="font-size:0.95rem;line-height:1.6;">No previous sessions yet</p>
                </div>
            `;
                return;
            }

            container.innerHTML = completed.map(d => {
                const sessionDate = new Date(`${d.date}T${d.time}`);
                const dateStr = sessionDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                const timeStr = sessionDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

                // Check if current user has already submitted evaluation
                const userEmail = currentUser.email;
                const emailKey = userEmail.replace(/\./g, '_');
                const hasSubmitted = d.evaluationResponses && d.evaluationResponses[emailKey];

                // Calculate time remaining for evaluation
                const baseDateVal = d.evaluationForm && d.evaluationForm.createdAt ? new Date(d.evaluationForm.createdAt) : (d.completedAt ? new Date(d.completedAt) : new Date(`${d.date}T${d.time}`));
                const evaluationDuration = d.evaluationDuration || 24;
                const evaluationDeadline = new Date(baseDateVal.getTime() + (evaluationDuration * 60 * 60 * 1000));
                const now = new Date();
                const isExpired = now > evaluationDeadline;
                const timeRemaining = evaluationDeadline - now;
                const hoursRemaining = Math.floor(timeRemaining / (1000 * 60 * 60));
                const daysRemaining = Math.floor(hoursRemaining / 24);

                let durationBadge = '';
                if (!hasSubmitted && !window.isSupervisor) {
                    if (isExpired) {
                        durationBadge = `<span style="background:transparent;color:#dc2626;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:600;">Expired</span>`;
                    } else if (hoursRemaining < 24) {
                        durationBadge = `<span style="background:transparent;color:#d97706;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:600;">${hoursRemaining}h left</span>`;
                    } else {
                        durationBadge = `<span style="background:transparent;color:#2563eb;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:600;">${daysRemaining}d left</span>`;
                    }
                }

                return `
                    <div style="border-bottom:1px solid rgba(255,255,255,0.07);padding:12px 4px;transition:background 0.15s;cursor:pointer;"
                        onclick="${window.isSupervisor ? `openEvaluationResults('${d.id}', '${escapeHtml(d.title)}')` : (hasSubmitted ? `viewAnonymousReflections('${d.id}', '${escapeHtml(d.title)}')` : `openEvaluationFormViewer('${d.id}', '${escapeHtml(d.title)}')`)}; closePreviousSessionsModal();"
                        onmouseover="this.style.background='#f8fafc';"
                        onmouseout="this.style.background='white';">
                        <div style="display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:8px;">
                            <h3 style="font-size:1rem;font-weight:700;color:#1e293b;margin:0;line-height:1.3;flex:1;">${escapeHtml(d.title)}</h3>
                            ${durationBadge ? `<div style="flex-shrink:0;">${durationBadge}</div>` : ''}
                        </div>
                        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:0.85rem;color:#64748b;">
                            <span style="display:flex;align-items:center;gap:4px;">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;">
                                    <path fill-rule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clip-rule="evenodd" />
                                </svg>
                                ${dateStr}
                            </span>
                            <span>�</span>
                            <span>${timeStr}</span>
                            ${hasSubmitted ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:8px;font-size:0.75rem;font-weight:600;">Submitted</span>' : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Error loading previous sessions:', err);
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#ef4444;">
                <p style="font-size:0.95rem;">Failed to load previous sessions</p>
            </div>
        `;
    }
}


// End evaluation post manually (force expire)
async function endEvaluationPost(debriefingId, title) {
    if (!confirm(`Are you sure you want to end "${title}" ? This will move it to Previous Sessions and members can no longer submit evaluations.`)) {
        return;
    }

    try {
        const token = await currentUser.getIdToken();
        const orgId = storageGet('psyc_orgId');

        // Set evaluation duration to 0 to force expire
        const res = await fetch(SERVER_URL + '/api/debriefings/end-evaluation', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token} `,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                debriefingId,
                orgId
            })
        });

        if (res.ok) {
            showToast('Evaluation post ended successfully', '?');
            await loadCompletedSessions();
        } else {
            const error = await res.json();
            showToast(error.error || 'Failed to end evaluation post', '?');
        }
    } catch (err) {
        console.error('Error ending evaluation post:', err);
        showToast('Failed to end evaluation post', '?');
    }
}


// -------------------------------------------------------------------------------
// PREVIOUS SESSIONS MONTH PICKER (CAROUSEL)
// -------------------------------------------------------------------------------

function openPreviousSessionsMonthPicker() {
    const modal = document.getElementById('previous-sessions-month-picker-modal');
    if (!modal) return;

    try {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        // Wait for modal to render before calculating positions
        setTimeout(() => {
            renderPreviousSessionsCarousel3D();

            const carouselWrapper = modal.querySelector('.month-carousel-3d-wrapper');
            if (carouselWrapper) {
                carouselWrapper.addEventListener('touchstart', handlePreviousSessionsTouchStart, { passive: false });
                carouselWrapper.addEventListener('touchmove', handlePreviousSessionsTouchMove, { passive: false });
                carouselWrapper.addEventListener('touchend', handlePreviousSessionsTouchEnd);
                carouselWrapper.addEventListener('mousedown', handlePreviousSessionsMouseDown);
                carouselWrapper.addEventListener('mousemove', handlePreviousSessionsMouseMove);
                carouselWrapper.addEventListener('mouseup', handlePreviousSessionsMouseUp);
                carouselWrapper.addEventListener('mouseleave', handlePreviousSessionsMouseUp);
                carouselWrapper.addEventListener('wheel', handlePreviousSessionsWheel, { passive: false });
            }
        }, 50);
    } catch (err) {
        console.error('Error opening previous sessions month picker:', err);
    }
}

function closePreviousSessionsMonthPicker() {
    const modal = document.getElementById('previous-sessions-month-picker-modal');
    if (!modal) return;

    modal.classList.remove('open');
    document.body.style.overflow = '';

    if (previousSessionsAnimationFrame) {
        cancelAnimationFrame(previousSessionsAnimationFrame);
        previousSessionsAnimationFrame = null;
    }

    const carouselWrapper = modal.querySelector('.month-carousel-3d-wrapper');
    if (carouselWrapper) {
        carouselWrapper.removeEventListener('touchstart', handlePreviousSessionsTouchStart);
        carouselWrapper.removeEventListener('touchmove', handlePreviousSessionsTouchMove);
        carouselWrapper.removeEventListener('touchend', handlePreviousSessionsTouchEnd);
        carouselWrapper.removeEventListener('mousedown', handlePreviousSessionsMouseDown);
        carouselWrapper.removeEventListener('mousemove', handlePreviousSessionsMouseMove);
        carouselWrapper.removeEventListener('mouseup', handlePreviousSessionsMouseUp);
        carouselWrapper.removeEventListener('mouseleave', handlePreviousSessionsMouseUp);
        carouselWrapper.removeEventListener('wheel', handlePreviousSessionsWheel);
    }
}

function handlePreviousSessionsTouchStart(e) {
    previousSessionsTouchStartY = e.touches[0].clientY;
    previousSessionsLastY = previousSessionsTouchStartY;
    previousSessionsLastTime = Date.now();
    previousSessionsIsDragging = true;
    previousSessionsVelocity = 0;

    if (previousSessionsAnimationFrame) {
        cancelAnimationFrame(previousSessionsAnimationFrame);
        previousSessionsAnimationFrame = null;
    }
}

function handlePreviousSessionsTouchMove(e) {
    if (!previousSessionsIsDragging) return;
    e.preventDefault();

    const currentY = e.touches[0].clientY;
    const currentTime = Date.now();
    const deltaY = currentY - previousSessionsLastY;
    const deltaTime = currentTime - previousSessionsLastTime;

    if (deltaTime > 0) {
        previousSessionsVelocity = deltaY / deltaTime * 16;
    }

    const carouselWrapper = document.querySelector('#previous-sessions-month-picker-modal .month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const maxRotation = centerOffset;
    const minRotation = -previousSessionsMaxSelectableIndex * 80 + centerOffset;
    const newRotation = previousSessionsCarouselRotation + deltaY;

    if (newRotation > maxRotation) {
        previousSessionsCarouselRotation = maxRotation + (newRotation - maxRotation) * 0.3;
    } else if (newRotation < minRotation) {
        previousSessionsCarouselRotation = minRotation + (newRotation - minRotation) * 0.3;
    } else {
        previousSessionsCarouselRotation = newRotation;
    }

    previousSessionsLastY = currentY;
    previousSessionsLastTime = currentTime;

    updatePreviousSessionsCarouselTransform();
}

function handlePreviousSessionsTouchEnd() {
    previousSessionsIsDragging = false;
    applyPreviousSessionsMomentum();
}

function handlePreviousSessionsMouseDown(e) {
    previousSessionsTouchStartY = e.clientY;
    previousSessionsLastY = previousSessionsTouchStartY;
    previousSessionsLastTime = Date.now();
    previousSessionsIsDragging = true;
    previousSessionsVelocity = 0;

    if (previousSessionsAnimationFrame) {
        cancelAnimationFrame(previousSessionsAnimationFrame);
        previousSessionsAnimationFrame = null;
    }
}

function handlePreviousSessionsMouseMove(e) {
    if (!previousSessionsIsDragging) return;

    const currentY = e.clientY;
    const currentTime = Date.now();
    const deltaY = currentY - previousSessionsLastY;
    const deltaTime = currentTime - previousSessionsLastTime;

    if (deltaTime > 0) {
        previousSessionsVelocity = deltaY / deltaTime * 16;
    }

    const carouselWrapper = document.querySelector('#previous-sessions-month-picker-modal .month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const maxRotation = centerOffset;
    const minRotation = -previousSessionsMaxSelectableIndex * 80 + centerOffset;
    const newRotation = previousSessionsCarouselRotation + deltaY;

    if (newRotation > maxRotation) {
        previousSessionsCarouselRotation = maxRotation + (newRotation - maxRotation) * 0.3;
    } else if (newRotation < minRotation) {
        previousSessionsCarouselRotation = minRotation + (newRotation - minRotation) * 0.3;
    } else {
        previousSessionsCarouselRotation = newRotation;
    }

    previousSessionsLastY = currentY;
    previousSessionsLastTime = currentTime;

    updatePreviousSessionsCarouselTransform();
}

function handlePreviousSessionsMouseUp() {
    previousSessionsIsDragging = false;
    applyPreviousSessionsMomentum();
}

function handlePreviousSessionsWheel(e) {
    if (previousSessionsIsDragging) return;
    e.preventDefault();

    if (previousSessionsAnimationFrame) {
        cancelAnimationFrame(previousSessionsAnimationFrame);
        previousSessionsAnimationFrame = null;
    }

    previousSessionsVelocity = e.deltaY > 0 ? -25 : 25;

    const carouselWrapper = document.querySelector('#previous-sessions-month-picker-modal .month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const maxRotation = centerOffset;
    const minRotation = -previousSessionsMaxSelectableIndex * 80 + centerOffset;
    const newRotation = previousSessionsCarouselRotation + previousSessionsVelocity;

    if (newRotation > maxRotation) {
        previousSessionsCarouselRotation = maxRotation + (newRotation - maxRotation) * 0.3;
    } else if (newRotation < minRotation) {
        previousSessionsCarouselRotation = minRotation + (newRotation - minRotation) * 0.3;
    } else {
        previousSessionsCarouselRotation = newRotation;
    }

    updatePreviousSessionsCarouselTransform();

    clearTimeout(window.previousSessionsWheelTimeout);
    window.previousSessionsWheelTimeout = setTimeout(() => {
        applyPreviousSessionsMomentum();
    }, 50);
}

function applyPreviousSessionsMomentum() {
    const friction = 0.95;
    const minVelocity = 0.1;
    const carouselWrapper = document.querySelector('#previous-sessions-month-picker-modal .month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const maxRotation = centerOffset;
    const minRotation = -previousSessionsMaxSelectableIndex * 80 + centerOffset;

    function animate() {
        if (Math.abs(previousSessionsVelocity) < minVelocity) {
            previousSessionsVelocity = 0;
            snapPreviousSessionsToNearest();
            return;
        }

        previousSessionsVelocity *= friction;
        const newRotation = previousSessionsCarouselRotation + previousSessionsVelocity;

        if (newRotation > maxRotation) {
            previousSessionsCarouselRotation = maxRotation;
            previousSessionsVelocity = 0;
            snapPreviousSessionsToNearest();
            return;
        } else if (newRotation < minRotation) {
            previousSessionsCarouselRotation = minRotation;
            previousSessionsVelocity = 0;
            snapPreviousSessionsToNearest();
            return;
        }

        previousSessionsCarouselRotation = newRotation;
        updatePreviousSessionsCarouselTransform();

        previousSessionsAnimationFrame = requestAnimationFrame(animate);
    }

    if (Math.abs(previousSessionsVelocity) > minVelocity) {
        animate();
    } else {
        snapPreviousSessionsToNearest();
    }
}

function snapPreviousSessionsToNearest() {
    const itemHeight = 80;
    const carouselWrapper = document.querySelector('#previous-sessions-month-picker-modal .month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    const targetIndex = Math.round((-previousSessionsCarouselRotation + centerOffset) / itemHeight);
    const clampedIndex = Math.max(0, Math.min(previousSessionsMaxSelectableIndex, targetIndex));
    const targetRotation = -clampedIndex * itemHeight + centerOffset;

    animatePreviousSessionsToPosition(targetRotation, () => {
        previousSessionsCurrentIndex = clampedIndex;
    });
}

function animatePreviousSessionsToPosition(target, callback) {
    const start = previousSessionsCarouselRotation;
    const distance = target - start;
    const duration = 300;
    const startTime = Date.now();

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        previousSessionsCarouselRotation = start + distance * eased;
        updatePreviousSessionsCarouselTransform();

        if (progress < 1) {
            previousSessionsAnimationFrame = requestAnimationFrame(animate);
        } else {
            if (callback) callback();
        }
    }

    animate();
}

function updatePreviousSessionsCarouselTransform() {
    const carousel = document.getElementById('previous-sessions-month-carousel-3d');
    if (!carousel) return;

    carousel.style.transform = `translateY(${previousSessionsCarouselRotation}px)`;

    const items = carousel.querySelectorAll('.month-carousel-3d-item');
    items.forEach((item, index) => {
        const carouselWrapper = document.querySelector('#previous-sessions-month-picker-modal .month-carousel-3d-wrapper');
        const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;

        const itemY = index * 80;
        const offset = (itemY + previousSessionsCarouselRotation - centerOffset) / 80;
        const distance = Math.abs(offset);
        const scale = Math.max(0.7, 1 - distance * 0.15);
        const opacity = Math.max(0.3, 1 - distance * 0.3);
        const translateZ = -distance * 50;

        item.style.transform = `translateX(-50 %) scale(${scale}) translateZ(${translateZ}px)`;
        item.style.opacity = opacity;
        item.style.zIndex = Math.round(100 - distance * 10);

        if (distance < 0.5) {
            item.classList.add('center');
        } else {
            item.classList.remove('center');
        }
    });
}

function renderPreviousSessionsCarousel3D() {
    const container = document.getElementById('previous-sessions-month-carousel-3d');
    if (!container) return;

    const now = new Date();
    const currentMonth = window.previousSessionsFilterMonth !== undefined ? window.previousSessionsFilterMonth : now.getMonth();
    const currentYear = window.previousSessionsFilterYear !== undefined ? window.previousSessionsFilterYear : now.getFullYear();
    const currentMonthKey = `${currentYear} -${currentMonth} `;

    previousSessionsAllMonthsData = [];
    const startYear = now.getFullYear() - 2;
    const endDate = new Date(now);
    endDate.setMonth(now.getMonth() + 5);
    let year = startYear;
    let month = 0;

    previousSessionsMaxSelectableIndex = 0;

    while (year < endDate.getFullYear() || (year === endDate.getFullYear() && month <= endDate.getMonth())) {
        const isFuture = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());

        previousSessionsAllMonthsData.push({
            year: year,
            month: month,
            key: `${year} -${month} `,
            isFuture: isFuture
        });

        if (!isFuture) {
            previousSessionsMaxSelectableIndex = previousSessionsAllMonthsData.length - 1;
        }

        month++;
        if (month > 11) {
            month = 0;
            year++;
        }
    }

    // Center on selected month or current month
    previousSessionsCurrentIndex = previousSessionsAllMonthsData.findIndex(m => m.key === currentMonthKey);
    if (previousSessionsCurrentIndex === -1) {
        previousSessionsCurrentIndex = previousSessionsMaxSelectableIndex;
    }

    const carouselWrapper = document.querySelector('#previous-sessions-month-picker-modal .month-carousel-3d-wrapper');
    const centerOffset = carouselWrapper ? carouselWrapper.clientHeight / 2 : window.innerHeight / 2;
    previousSessionsCarouselRotation = -previousSessionsCurrentIndex * 80 + centerOffset;

    container.innerHTML = '';

    previousSessionsAllMonthsData.forEach((monthData, index) => {
        const date = new Date(monthData.year, monthData.month, 1);
        const locale = currentLang === 'fil' ? 'fil-PH' : 'en-US';
        const monthName = date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

        const item = document.createElement('div');
        item.className = 'month-carousel-3d-item';
        if (monthData.isFuture) {
            item.classList.add('future-month');
        } else {
            item.onclick = () => selectPreviousSessionsMonthFromCarousel(monthData.year, monthData.month);
        }
        item.innerHTML = `<div class="month-carousel-3d-item-name">${monthName}</div>`;
        item.style.top = `${index * 80}px`;

        container.appendChild(item);
    });

    updatePreviousSessionsCarouselTransform();
}

function selectPreviousSessionsMonthFromCarousel(year, month) {
    window.previousSessionsFilterMonth = month;
    window.previousSessionsFilterYear = year;

    closePreviousSessionsMonthPicker();
    loadPreviousSessions();
}

// Clear filter function
function clearPreviousSessionsFilter() {
    window.previousSessionsFilterMonth = undefined;
    window.previousSessionsFilterYear = undefined;
    loadPreviousSessions();
}
// End of app.js

// --- Right Sidebar Menu -----------------------------------------
function toggleRSMenu(menuId, event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById(menuId);
    if (!menu) return;

    const isVisible = menu.style.display === 'block';

    // Close other menus
    document.querySelectorAll('.ld-rs-dropdown').forEach(m => {
        m.style.display = 'none';
    });

    if (!isVisible) {
        menu.style.display = 'block';
        const closeHandler = (e) => {
            if (!e.target.closest('.ld-rs-menu-container')) {
                menu.style.display = 'none';
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }
}
window.toggleRSMenu = toggleRSMenu;

// --------------------------------------------------------------
// MOOD STATS MODAL
// --------------------------------------------------------------

var moodDistributionChart = null;
var moodTrendChart = null;
var currentMoodFilter = 'week'; // Default filter

function updateStatsPreview() {
    // Update the preview stats on the card
    const entries = moodCalendarEntries || [];

    const previewEntries = document.getElementById('stats-preview-entries');

    if (previewEntries) previewEntries.textContent = entries.length;
}

function openMoodStatsModal() {
    const modal = document.getElementById('mood-stats-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        // Reset to default filter
        currentMoodFilter = 'week';

        // Set active button state
        document.querySelectorAll('.mood-filter-btn').forEach(btn => {
            btn.style.background = '#eff6ff';
            btn.style.color = '#64748b';
        });
        const weekBtn = document.getElementById('filter-week');
        if (weekBtn) {
            weekBtn.style.background = '#93c5fd';
            weekBtn.style.color = 'white';
        }

        calculateMoodStats();
    }
}

function closeMoodStatsModal() {
    const modal = document.getElementById('mood-stats-modal');
    if (modal) {
        const overlay = modal.querySelector('.mood-modal-overlay');
        const sheet = modal.querySelector('.mood-modal-sheet');
        if (overlay) overlay.classList.add('closing');
        if (sheet) sheet.classList.add('closing');

        setTimeout(() => {
            modal.classList.remove('open');
            if (overlay) overlay.classList.remove('closing');
            if (sheet) sheet.classList.remove('closing');
            document.body.style.overflow = '';
        }, 300);
    }
}

function calculateMoodStats() {
    const entries = moodCalendarEntries || [];
    document.getElementById('stats-total-entries').textContent = entries.length;

    const filteredEntries = filterEntriesByPeriod(entries, currentMoodFilter);

    // Update section title based on filter
    const periodTitles = { 'week': 'this Week', 'month': 'this Month', 'year': 'this Year' };
    const titleElem = document.getElementById('stats-common-mood-title');
    if (titleElem) {
        titleElem.textContent = `Most Common Mood (${periodTitles[currentMoodFilter] || 'Overall'})`;
    }

    const moodMapping = {
        'joy': 'meh', 'happy': 'meh', 'excited': 'meh', 'chill': 'meh', 'meh': 'meh', 'smile': 'meh',
        'sadness': 'good', 'sad': 'good', 'depressed': 'good', 'lonely': 'good', 'good': 'good', 'cry': 'good',
        'anger': 'rad', 'angry': 'rad', 'frustrated': 'rad', 'stressed': 'rad', 'rad': 'rad',
        'disgust': 'bad', 'sick': 'bad', 'awful': 'bad', 'bad': 'bad', 'vomit': 'bad',
        'fear': 'awful', 'scared': 'awful', 'anxious': 'awful', 'tired': 'awful', 'worried': 'awful', 'awful': 'awful'
    };

    const moodCounts = { 'meh': 0, 'good': 0, 'rad': 0, 'bad': 0, 'awful': 0 };
    filteredEntries.forEach(entry => {
        let mood = entry.mood || 'meh';
        const mappedKey = moodMapping[mood] || 'meh';
        moodCounts[mappedKey] = (moodCounts[mappedKey] || 0) + 1;
    });

    let mostCommonMood = null;
    let maxCount = 0;
    Object.entries(moodCounts).forEach(([mood, count]) => {
        if (count > maxCount) {
            maxCount = count;
            mostCommonMood = mood;
        }
    });

    const moodIcon = document.getElementById('stats-common-mood-icon');
    const moodLabel = document.getElementById('stats-common-mood-name');
    const moodCount = document.getElementById('stats-common-mood-count');

    if (!mostCommonMood || maxCount === 0) {
        if (moodIcon) moodIcon.innerHTML = '<div style="width:100%; height:100%; background:#f1f5f9; border-radius:12px; display:flex; align-items:center; justify-content:center; color:#94a3b8;"><i class="bi bi-clock-history" style="font-size:24px;"></i></div>';
        if (moodLabel) moodLabel.textContent = 'No Data';
        if (moodCount) moodCount.textContent = 'Log your mood to see stats';
    } else {
        const moodData = getMoodByKey(mostCommonMood);
        if (moodIcon) moodIcon.innerHTML = getMoodSVG(mostCommonMood);
        if (moodLabel) moodLabel.textContent = moodData.label;
        if (moodCount) moodCount.textContent = `${maxCount} ${maxCount === 1 ? 'time' : 'times'}`;
    }

    renderMoodDistributionChart(moodCounts);
    renderMoodTrendChart(entries);
}

function filterEntriesByPeriod(entries, period) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let startDate;

    if (period === 'week') {
        // Start of this week (Sunday)
        const dayOfWeek = now.getDay();
        startDate = new Date(startOfToday);
        startDate.setDate(startDate.getDate() - dayOfWeek);
    } else if (period === 'month') {
        // Start of this month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'year') {
        // Start of this year
        startDate = new Date(now.getFullYear(), 0, 1);
    }

    return entries.filter(entry => {
        const entryDate = entry.timestamp?.toDate?.() || new Date(entry.timestamp);
        return entryDate >= startDate;
    });
}

function filterMoodDistribution(period) {
    currentMoodFilter = period;

    // Update button styles
    document.querySelectorAll('.mood-filter-btn').forEach(btn => {
        btn.style.background = '#eff6ff';
        btn.style.color = '#64748b';
    });

    const activeBtn = document.getElementById(`filter-${period}`);
    if (activeBtn) {
        activeBtn.style.background = '#93c5fd';
        activeBtn.style.color = 'white';
    }

    // Recalculate stats with new filter
    calculateMoodStats();
}

function renderMoodDistributionChart(moodCounts) {
    const ctx = document.getElementById('mood-distribution-chart');
    if (!ctx) return;

    if (moodDistributionChart) {
        moodDistributionChart.destroy();
    }

    const distributionConfig = [
        { key: 'rad', label: 'Anger', color: '#EF4444' },
        { key: 'good', label: 'Sadness', color: '#60A5FA' },
        { key: 'meh', label: 'Joy', color: '#FACC15' },
        { key: 'bad', label: 'Disgust', color: '#4ADE80' },
        { key: 'awful', label: 'Fear', color: '#A855F7' }
    ];

    const labels = [];
    const data = [];
    const colors = [];

    const totalCount = Object.values(moodCounts).reduce((a, b) => a + b, 0);

    distributionConfig.forEach(config => {
        labels.push(config.label);
        const count = moodCounts[config.key] || 0;
        if (totalCount === 0) {
            data.push(1);
            colors.push('#f1f5f9');
        } else {
            data.push(count);
            colors.push(config.color);
        }
    });

    moodDistributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: totalCount === 0 ? 0 : 3,
                borderColor: '#ffffff',
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        font: { size: 12, weight: '600' },
                        color: '#64748b'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#1e293b',
                    bodyColor: '#1e293b',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function (context) {
                            if (totalCount === 0) return ' No entries yet';
                            const value = context.raw;
                            const percentage = ((value / totalCount) * 100).toFixed(0);
                            return ` ${context.label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderMoodTrendChart(entries) {
    const ctx = document.getElementById('mood-trend-chart');
    if (!ctx) return;

    // Destroy existing chart
    if (moodTrendChart) {
        moodTrendChart.destroy();
    }

    // Get last 7 days
    const last7Days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        last7Days.push(date);
    }

    // Map mood to numeric value (updated to match 'bad' key)
    const moodValues = {
        awful: 1,
        bad: 2,    // Changed from 'sad' to 'bad'
        meh: 3,
        good: 4,
        rad: 5
    };

    const labels = last7Days.map(date => {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    });

    const data = last7Days.map(date => {
        const dayEntries = entries.filter(entry => {
            const entryDate = entry.timestamp?.toDate?.() || new Date(entry.timestamp);
            entryDate.setHours(0, 0, 0, 0);
            return entryDate.getTime() === date.getTime();
        });

        if (dayEntries.length === 0) return null;

        // Average mood for the day
        const avgMood = dayEntries.reduce((sum, entry) => {
            let mood = entry.mood || 'meh';
            // Handle both 'sad' and 'bad' keys
            if (mood === 'sad') mood = 'bad';
            return sum + (moodValues[mood] || 3);
        }, 0) / dayEntries.length;

        return avgMood;
    });

    moodTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Mood Level',
                data: data,
                borderColor: '#93c5fd',
                backgroundColor: 'rgba(147, 197, 253, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointBackgroundColor: '#93c5fd',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0,
                    max: 6,
                    ticks: {
                        stepSize: 1,
                        font: {
                            size: 11
                        },
                        callback: function (value) {
                            const moodLabels = ['', 'Fear', 'Disgust', 'Joy', 'Sadness', 'Anger'];
                            return moodLabels[value] || '';
                        }
                    }
                },
                x: {
                    ticks: {
                        font: {
                            size: 11
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}


// --- Top Bar Hide on Scroll Down -------------------------------
(function () {
    var lastScrollTop = 0;
    var topBar = document.querySelector('.ld-topbar');
    var scrollContainer = document.querySelector('.ld-scroll');
    var scrollThreshold = 10;

    if (!topBar || !scrollContainer) return;

    scrollContainer.addEventListener('scroll', function () {
        var scrollTop = scrollContainer.scrollTop;

        if (Math.abs(scrollTop - lastScrollTop) < scrollThreshold) {
            return;
        }

        if (scrollTop > lastScrollTop && scrollTop > 56) {
            // Scrolling down & past the top bar height
            topBar.style.transform = 'translateY(-100%)';
            topBar.style.transition = 'transform 0.3s ease';
        } else {
            // Scrolling up
            topBar.style.transform = 'translateY(0)';
            topBar.style.transition = 'transform 0.3s ease';
        }

        lastScrollTop = scrollTop;
    });
})();



// --- Show/Hide Previous Sessions Button ----------------------------
(function () {
    // Override or wrap the ldTab function to show/hide Previous Sessions button
    var originalLdTab = window.ldTab;

    window.ldTab = function (tabName) {
        // Call original function if it exists
        if (originalLdTab) {
            originalLdTab(tabName);
        }

        // Show Previous Sessions button only on Discussion tab
        var prevSessionsBtn = document.getElementById('previous-sessions-btn');
        if (prevSessionsBtn) {
            if (tabName === 'discussion') {
                prevSessionsBtn.style.display = 'flex';
            } else {
                prevSessionsBtn.style.display = 'none';
            }
        }

        // Update mobile title
        var titleEl = document.getElementById('ld-title-mobile');
        if (titleEl) {
            var titles = {
                'home': 'Dashboard',
                'sources': 'Sources',
                'discussion': 'Discussion',
                'journal': 'Journal',
                'archives': 'Archives',
                'team': 'Team'
            };
            titleEl.textContent = titles[tabName] || 'Dashboard';
        }

        // Handle tab switching
        var tabs = document.querySelectorAll('.ld-tab');
        tabs.forEach(function (tab) {
            tab.classList.remove('active');
        });

        var activeTab = document.getElementById('ld-' + tabName);
        if (activeTab) {
            activeTab.classList.add('active');
        }

        // Update navigation buttons
        var navBtns = document.querySelectorAll('.ld-nav-btn, .ld-sb-item');
        navBtns.forEach(function (btn) {
            btn.classList.remove('active', 'sb-active');
        });

        var activeNavBtn = document.getElementById('ldnav-' + tabName);
        if (activeNavBtn) {
            activeNavBtn.classList.add('active');
        }

        var activeSbBtn = document.getElementById('sb-' + tabName);
        if (activeSbBtn) {
            activeSbBtn.classList.add('sb-active');
        }
    };
})();


// --- Copy Group Code --------------------------------------------
function copyGroupCode() {
    const inviteCode = storageGet('psyc_inviteCode');
    const orgId = storageGet('psyc_orgId');
    const codeToCopy = inviteCode || orgId;

    if (!codeToCopy) {
        showToast('No group code available', '❌');
        return;
    }

    navigator.clipboard.writeText(inviteCode || orgId).then(() => {
        showToast('Group code copied!', '📋');
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = inviteCode || orgId;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast('Group code copied!', '📋');
        } catch (err) {
            showToast('Failed to copy group code', '❌');
        }
        document.body.removeChild(textArea);
    });

    // Close the dropdown menu
    const menu = document.getElementById('team-status-menu');
    if (menu) {
        menu.style.display = 'none';
    }
}

// ─── Supervisor Group Manager ────────────────────────────────────

let _newGroupInviteCode = '';

function openGroupManagerModal() {
    const modal = document.getElementById('group-manager-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadSupervisorGroups();
    }
}
function closeGroupManagerModal() {
    const modal = document.getElementById('group-manager-modal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

async function loadSupervisorGroups() {
    const container = document.getElementById('group-list-container');
    if (!container || !currentUser) return;
    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/supervisor/groups', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) { container.innerHTML = `<p style="color:#ef4444;">${data.error}</p>`; return; }

        const activeOrgId = storageGet('psyc_orgId');
        if (data.groups.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:20px;">No groups yet.</p>';
            return;
        }

        container.innerHTML = data.groups.map(g => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:${g.id === activeOrgId ? 'rgba(14,165,233,0.08)' : 'var(--bg-card,#f8fafc)'};border-radius:12px;margin-bottom:10px;border:1.5px solid ${g.id === activeOrgId ? '#0ea5e9' : 'var(--border-color,#e2e8f0)'};">
                <div>
                    <div style="font-weight:700;color:var(--text-main,#1e293b);font-size:0.95rem;">${g.name}</div>
                    <div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;">Code: ${g.inviteCode}</div>
                </div>
                ${g.id === activeOrgId
                ? '<span style="font-size:0.75rem;font-weight:700;color:#0ea5e9;background:rgba(14,165,233,0.1);padding:4px 10px;border-radius:20px;">Active</span>'
                : `<button onclick="switchToGroup('${g.id}','${g.name}')" style="padding:8px 16px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;">Switch</button>`
            }
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<p style="color:#ef4444;">Failed to load groups.</p>';
    }
}

async function switchToGroup(orgId, orgName) {
    if (!currentUser) return;
    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/supervisor/switch-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ orgId })
        });
        const data = await res.json();
        if (res.ok) {
            storageSet('psyc_orgId', orgId);
            storageSet('psyc_orgName', orgName);
            closeGroupManagerModal();
            showToast(`Switched to ${orgName}`, '✅');
            setTimeout(() => window.location.reload(), 800);
        } else {
            showToast(data.error || 'Failed to switch group', '❌');
        }
    } catch (err) {
        showToast('Server error', '❌');
    }
}

function openCreateGroupModal() {
    const modal = document.getElementById('create-group-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        document.getElementById('new-group-name-input').value = '';
        document.getElementById('create-group-result').style.display = 'none';
        document.getElementById('create-group-error').style.display = 'none';
        document.getElementById('create-group-btn').style.display = 'block';
    }
}
function closeCreateGroupModal() {
    const modal = document.getElementById('create-group-modal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

async function supervisorCreateGroup() {
    const name = document.getElementById('new-group-name-input').value.trim();
    const btn = document.getElementById('create-group-btn');
    const errorEl = document.getElementById('create-group-error');
    errorEl.style.display = 'none';

    if (!name) { errorEl.textContent = 'Please enter a group name.'; errorEl.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = 'Creating...';
    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/supervisor/create-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (res.ok) {
            _newGroupInviteCode = data.inviteCode;
            document.getElementById('new-group-invite-code').textContent = data.inviteCode;
            document.getElementById('create-group-result').style.display = 'block';
            btn.style.display = 'none';
            storageSet('psyc_orgId', data.orgId);
            storageSet('psyc_orgName', name);
        } else {
            errorEl.textContent = data.error || 'Failed to create group.';
            errorEl.style.display = 'block';
            btn.disabled = false; btn.textContent = 'Create Group';
        }
    } catch (err) {
        errorEl.textContent = 'Server error.';
        errorEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Create Group';
    }
}

function copyNewGroupCode() {
    navigator.clipboard.writeText(_newGroupInviteCode).then(() => showToast('Code copied!', '📋'));
}

function openJoinGroupModal() {
    const modal = document.getElementById('join-group-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        document.getElementById('join-group-code-input').value = '';
        document.getElementById('join-group-error').style.display = 'none';
    }
}
function closeJoinGroupModal() {
    const modal = document.getElementById('join-group-modal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

async function supervisorJoinGroup() {
    const code = document.getElementById('join-group-code-input').value.trim();
    const btn = document.getElementById('join-group-btn');
    const errorEl = document.getElementById('join-group-error');
    errorEl.style.display = 'none';

    if (!code || code.length !== 6) { errorEl.textContent = 'Enter a valid 6-digit code.'; errorEl.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = 'Joining...';
    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/supervisor/join-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ inviteCode: code })
        });
        const data = await res.json();
        if (res.ok) {
            storageSet('psyc_orgId', data.orgId);
            storageSet('psyc_orgName', data.name);
            closeJoinGroupModal();
            showToast(`Joined ${data.name}!`, '✅');
            setTimeout(() => window.location.reload(), 800);
        } else {
            errorEl.textContent = data.error || 'Failed to join group.';
            errorEl.style.display = 'block';
            btn.disabled = false; btn.textContent = 'Join Group';
        }
    } catch (err) {
        errorEl.textContent = 'Server error.';
        errorEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Join Group';
    }
}

// Expose group modal functions to global scope for inline onclick handlers
window.openGroupManagerModal = openGroupManagerModal;
window.closeGroupManagerModal = closeGroupManagerModal;
window.openCreateGroupModal = openCreateGroupModal;
window.closeCreateGroupModal = closeCreateGroupModal;
window.openJoinGroupModal = openJoinGroupModal;
window.closeJoinGroupModal = closeJoinGroupModal;
window.switchToGroup = switchToGroup;
window.supervisorJoinGroup = supervisorJoinGroup;
window.supervisorCreateGroup = supervisorCreateGroup;
