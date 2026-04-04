// ─── Daily Self-Care Module ─────────────────────────────────────

// Safe accessor for currentLang (defined in app.js)
function getSelfCareLang() {
    return typeof currentLang !== 'undefined' ? currentLang : 'en';
}

let selfCareActivities = [];
let userSelfCareProgress = {};
let selectedSelfCareActivities = [];
let reminderCheckInterval = null;


// Load self-care activities from JSON
async function loadSelfCareActivities() {
    try {
        console.log('📥 Loading self-care activities...');
        const response = await fetch('/assets/self-care-activities.json');
        const data = await response.json();
        selfCareActivities = data.activities;
        console.log(`✅ Loaded ${selfCareActivities.length} activities`);

        // Load user progress if authenticated
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
            await loadUserSelfCareProgress();
        } else if (typeof currentUser !== 'undefined' && currentUser) {
            await loadUserSelfCareProgress();
        } else {
            console.log('⚠️ User not authenticated, showing activities without progress');
        }

        // Render the self-care widget
        renderSelfCareWidget();
        console.log('✅ Self-care widget rendered');
    } catch (error) {
        console.error('❌ Error loading self-care activities:', error);
        // Show error in widget
        const container = document.getElementById('self-care-widget');
        if (container) {
            container.innerHTML = `
                <div style="text-align:center;color:#ef4444;padding:20px;">
                    <i class="bi bi-exclamation-triangle" style="font-size:2rem;display:block;margin-bottom:8px;"></i>
                    <p>Failed to load self-care activities</p>
                    <button onclick="loadSelfCareActivities()" style="margin-top:10px;padding:8px 16px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;">
                        Retry
                    </button>
                </div>
            `;
        }
    }
}

// Load user's self-care progress from MongoDB
async function loadUserSelfCareProgress() {
    try {
        // Get current user
        let user = null;
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
            user = firebase.auth().currentUser;
        } else if (typeof currentUser !== 'undefined' && currentUser) {
            user = currentUser;
        }

        if (!user) {
            console.log('⚠️ No user found, skipping progress load');
            return;
        }

        console.log('📥 Loading user progress...');
        const token = await user.getIdToken();
        const response = await fetch(SERVER_URL + '/api/self-care/progress', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            userSelfCareProgress = data.progress || {};
            console.log('✅ User progress loaded:', Object.keys(userSelfCareProgress).length, 'activities');
        } else {
            console.warn('⚠️ Failed to load progress:', response.status);
        }
    } catch (error) {
        console.error('❌ Error loading self-care progress:', error);
        // Continue without progress - activities will still show
    }
}

// Get localized activity data
function getLocalizedActivity(activity) {
    const isFilipino = getSelfCareLang() === 'fil';
    return {
        ...activity,
        title: isFilipino && activity.titleFil ? activity.titleFil : activity.title,
        description: isFilipino && activity.descriptionFil ? activity.descriptionFil : activity.description,
        streakMessage: isFilipino && activity.streak.messageFil ? activity.streak.messageFil : activity.streak.message
    };
}

// Render self-care widget on dashboard
function renderSelfCareWidget() {
    const container = document.getElementById('self-care-widget');
    if (!container) {
        console.warn('⚠️ Self-care widget container not found');
        return;
    }

    // Get 5 recommended activities
    const recommended = getRecommendedActivities(5);

    const isFilipino = getSelfCareLang() === 'fil';
    const widgetTitle = isFilipino ? 'Pang-araw-araw na Self-Care' : 'Daily Self-Care';
    const viewAllText = isFilipino ? 'Tingnan Pa' : 'View More';

    let html = `
        <div class="self-care-header">
            <div class="self-care-header-left">
                <div class="self-care-icon-wrapper">
                    <i class="bi bi-flower1"></i>
                </div>
                <h3 class="self-care-title">${widgetTitle}</h3>
            </div>
            <button class="view-all-btn" onclick="openSelfCareModal()" style="background:none;border:none;color:#3b82f6;font-weight:600;font-size:0.85rem;cursor:pointer;display:flex;align-items:center;gap:4px;padding:6px 12px;border-radius:8px;transition:all 0.2s;" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='none'">
                ${viewAllText}
            </button>
        </div>
        <div class="self-care-body">
            <div class="self-care-bubble-grid">
    `;

    if (recommended.length === 0) {
        html += `
            <div style="text-align:center;color:#94a3b8;padding:40px 20px;">
                <i class="bi bi-check-circle" style="font-size:3rem;display:block;margin-bottom:12px;opacity:0.3;"></i>
                <p style="font-size:0.95rem;margin:0;">${isFilipino ? 'Natapos mo na lahat!' : 'All completed!'}</p>
            </div>
        `;
    } else {
        // First row - 3 bubbles
        html += '<div class="bubble-row">';
        for (let i = 0; i < Math.min(3, recommended.length); i++) {
            const activity = recommended[i];
            const localized = getLocalizedActivity(activity);
            const progress = userSelfCareProgress[activity.id] || { completed: 0, streak: 0, lastCompleted: null };
            const isCompletedToday = isActivityCompletedToday(progress);

            html += `
                <div class="bubble-item ${isCompletedToday ? 'completed' : ''}" onclick="openActivityDetail('${activity.id}')">
                    <div class="bubble-circle">
                        <i class="${activity.icon}"></i>
                        ${isCompletedToday ? '<div class="bubble-check"><i class="bi bi-check-circle-fill"></i></div>' : ''}
                        ${progress.streak > 0 && !isCompletedToday ? `<div class="bubble-streak">${progress.streak}</div>` : ''}
                    </div>
                    <div class="bubble-label">${localized.title}</div>
                </div>
            `;
        }
        html += '</div>';

        // Second row - 2 bubbles (offset/staggered)
        if (recommended.length > 3) {
            html += '<div class="bubble-row offset">';
            for (let i = 3; i < Math.min(5, recommended.length); i++) {
                const activity = recommended[i];
                const localized = getLocalizedActivity(activity);
                const progress = userSelfCareProgress[activity.id] || { completed: 0, streak: 0, lastCompleted: null };
                const isCompletedToday = isActivityCompletedToday(progress);

                html += `
                    <div class="bubble-item ${isCompletedToday ? 'completed' : ''}" onclick="openActivityDetail('${activity.id}')">
                        <div class="bubble-circle">
                            <i class="${activity.icon}"></i>
                            ${isCompletedToday ? '<div class="bubble-check"><i class="bi bi-check-circle-fill"></i></div>' : ''}
                            ${progress.streak > 0 && !isCompletedToday ? `<div class="bubble-streak">${progress.streak}</div>` : ''}
                        </div>
                        <div class="bubble-label">${localized.title}</div>
                    </div>
                `;
            }
            html += '</div>';
        }
    }

    html += `
            </div>
        </div>
    `;
    container.innerHTML = html;
    console.log('✅ Widget rendered with', recommended.length, 'bubble activities');
}

// Get recommended activities
function getRecommendedActivities(count) {
    // Prioritize activities not completed today
    const notCompletedToday = selfCareActivities.filter(activity => {
        const progress = userSelfCareProgress[activity.id] || {};
        return !isActivityCompletedToday(progress);
    });

    // Shuffle and take the requested count
    const shuffled = notCompletedToday.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

// Check if activity was completed today
function isActivityCompletedToday(progress) {
    if (!progress.lastCompleted) return false;

    const lastCompleted = new Date(progress.lastCompleted);
    const today = new Date();

    return lastCompleted.toDateString() === today.toDateString();
}

// Open self-care modal with all activities
function openSelfCareModal() {
    const modal = document.getElementById('self-care-modal');
    if (!modal) {
        createSelfCareModal();
    }

    renderAllActivities();
    const selfCareModal = document.getElementById('self-care-modal');
    selfCareModal.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Add ESC key listener
    document.addEventListener('keydown', handleEscapeKey);
}

// Close self-care modal
function closeSelfCareModal() {
    const modal = document.getElementById('self-care-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }

    // Remove ESC key listener
    document.removeEventListener('keydown', handleEscapeKey);
}

// Handle ESC key press
function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        // Close activity detail first if open
        const detailModal = document.getElementById('activity-detail-modal');
        if (detailModal) {
            closeActivityDetail();
        } else {
            closeSelfCareModal();
        }
    }
}

// Create self-care modal structure
function createSelfCareModal() {
    const isFilipino = getSelfCareLang() === 'fil';
    const modalTitle = isFilipino ? 'Mga Self-Care Activity' : 'Self-Care Activities';

    const modalHTML = `
        <div id="self-care-modal" class="modal" onclick="handleModalBackdropClick(event, 'self-care-modal')">
            <div class="modal-content self-care-modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>${modalTitle}</h2>
                    <button class="close-btn" onclick="closeSelfCareModal()" aria-label="Close">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="modal-body" id="all-activities-container">
                    <!-- Activities will be rendered here -->
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// Handle backdrop click to close modal
function handleModalBackdropClick(event, modalId) {
    if (event.target.id === modalId) {
        closeSelfCareModal();
    }
}

// Render all activities in modal
function renderAllActivities() {
    const container = document.getElementById('all-activities-container');
    if (!container) return;

    const categories = {
        mindfulness: { icon: 'bi-flower1', label: getSelfCareLang() === 'fil' ? 'Mindfulness' : 'Mindfulness' },
        physical: { icon: 'bi-heart-pulse', label: getSelfCareLang() === 'fil' ? 'Pisikal' : 'Physical' },
        reflection: { icon: 'bi-journal-text', label: getSelfCareLang() === 'fil' ? 'Pagninilay' : 'Reflection' },
        creative: { icon: 'bi-palette', label: getSelfCareLang() === 'fil' ? 'Creative' : 'Creative' },
        social: { icon: 'bi-people', label: getSelfCareLang() === 'fil' ? 'Sosyal' : 'Social' }
    };

    let html = '';

    Object.keys(categories).forEach(category => {
        const categoryActivities = selfCareActivities.filter(a => a.category === category);
        if (categoryActivities.length === 0) return;

        html += `
            <div class="activity-category">
                <h3><i class="${categories[category].icon}"></i> ${categories[category].label}</h3>
                <div class="activity-grid">
        `;

        categoryActivities.forEach(activity => {
            const localized = getLocalizedActivity(activity);
            const progress = userSelfCareProgress[activity.id] || { completed: 0, streak: 0, lastCompleted: null };
            const isCompletedToday = isActivityCompletedToday(progress);

            html += `
                <div class="activity-item ${isCompletedToday ? 'completed' : ''}" onclick="openActivityDetail('${activity.id}')">
                    <div class="activity-icon">
                        <i class="${activity.icon}"></i>
                    </div>
                    <div class="activity-info">
                        <h4>${localized.title}</h4>
                        <p>${localized.description}</p>
                        <div class="activity-stats">
                            <span><i class="bi bi-clock"></i> ${activity.duration} min</span>
                            <span><i class="bi bi-fire"></i> ${progress.streak}/${activity.streak.target}</span>
                        </div>
                    </div>
                    ${isCompletedToday ? '<div class="check-badge"><i class="bi bi-check-circle-fill"></i></div>' : ''}
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Open activity detail modal
function openActivityDetail(activityId) {
    const activity = selfCareActivities.find(a => a.id === activityId);
    if (!activity) return;

    const localized = getLocalizedActivity(activity);
    const progress = userSelfCareProgress[activityId] || { completed: 0, streak: 0, lastCompleted: null };
    const isCompletedToday = isActivityCompletedToday(progress);

    const isFilipino = getSelfCareLang() === 'fil';
    const startText = isFilipino ? 'Simulan' : 'Start Activity';
    const completedText = isFilipino ? 'Tapos Na Ngayon' : 'Completed Today';
    const streakText = isFilipino ? 'Streak' : 'Streak';
    const totalText = isFilipino ? 'Kabuuan' : 'Total Completed';
    const guideText = isFilipino ? 'Gabay' : 'How to do it';

    // Get tutorial steps
    const tutorial = isFilipino && activity.tutorialFil ? activity.tutorialFil : activity.tutorial;
    const hasTutorial = tutorial && tutorial.length > 0;

    const tutorialHTML = hasTutorial ? `
        <div class="activity-tutorial">
            <h3><i class="bi bi-list-check"></i> ${guideText}</h3>
            <ol class="tutorial-steps">
                ${tutorial.map(step => `<li>${step}</li>`).join('')}
            </ol>
        </div>
    ` : '';

    const modalHTML = `
        <div id="activity-detail-modal" class="modal open" onclick="handleActivityDetailBackdropClick(event)">
            <div class="modal-content activity-detail-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <div></div>
                    <button class="close-btn" onclick="closeActivityDetail(); closeSelfCareModal();" aria-label="Close">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="activity-detail-header">
                        <div class="activity-detail-icon">
                            <i class="${activity.icon}"></i>
                        </div>
                        <h2>${localized.title}</h2>
                        <p>${localized.description}</p>
                    </div>
                    
                    <div class="activity-progress">
                        <div class="progress-item">
                            <i class="bi bi-fire"></i>
                            <div>
                                <span class="progress-label">${streakText}</span>
                                <span class="progress-value">${progress.streak}/${activity.streak.target}</span>
                            </div>
                        </div>
                        <div class="progress-item">
                            <i class="bi bi-check-circle"></i>
                            <div>
                                <span class="progress-label">${totalText}</span>
                                <span class="progress-value">${progress.completed || 0}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="streak-goal">
                        <p><i class="bi bi-trophy"></i> ${localized.streakMessage}</p>
                        <div class="streak-progress-bar">
                            <div class="streak-progress-fill" style="width: ${(progress.streak / activity.streak.target) * 100}%"></div>
                        </div>
                    </div>
                    
                    ${tutorialHTML}
                    
                    ${activity.hasTimer && !isCompletedToday ? `
                        <div id="activity-timer-container" style="display:none;">
                            <div class="activity-timer">
                                ${activity.id === 'breathing-exercise' ? `
                                    <div class="breathe-container">
                                        <svg viewBox="0 0 200 200" width="100%" height="100%">
                                            <defs>
                                                <linearGradient id="breathe-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                    <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
                                                    <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
                                                </linearGradient>
                                            </defs>
                                            <circle class="circle-guide" cx="100" cy="100" r="85" />
                                            <circle class="circle-animated" cx="100" cy="100" r="85" />
                                        </svg>
                                        <div class="breathe-text-overlay">
                                            <div class="breathe-instruction" id="breathe-instruction">${isFilipino ? 'Huminga' : 'Breathe In'}</div>
                                            <div class="breathe-count" id="breathe-count">4</div>
                                            <div class="breathe-timer" id="breathe-timer">5:00</div>
                                        </div>
                                    </div>
                                ` : activity.id === 'meditation' ? `
                                    <div class="meditation-container">
                                        <svg viewBox="0 0 300 300" width="100%" height="100%">
                                            <circle class="meditation-ring-bg" cx="150" cy="150" r="130" />
                                            <circle id="meditation-progress-ring" class="meditation-ring-progress" cx="150" cy="150" r="130" />
                                            <g class="zen-flower">
                                                <circle class="zen-petal zen-petal-1" cx="150" cy="130" r="45" />
                                                <circle class="zen-petal zen-petal-2" cx="135" cy="160" r="45" />
                                                <circle class="zen-petal zen-petal-3" cx="165" cy="160" r="45" />
                                                <circle class="zen-center" cx="150" cy="150" r="30" />
                                            </g>
                                        </svg>
                                        <div class="meditation-timer-text" id="meditation-timer">10:00</div>
                                    </div>
                                ` : activity.id === 'morning-stretch' ? `
                                    <div class="stretch-container">
                                        <svg class="stretch-figure" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                            <g class="upper-body">
                                                <circle cx="50" cy="12" r="8" />
                                                <line x1="50" y1="20" x2="50" y2="60" />
                                                <line class="arm-left" x1="50" y1="25" x2="30" y2="45" />
                                                <line class="arm-right" x1="50" y1="25" x2="70" y2="45" />
                                            </g>
                                            <line x1="50" y1="60" x2="35" y2="90" />
                                            <line x1="50" y1="60" x2="65" y2="90" />
                                        </svg>
                                        <div class="stretch-timer-display" id="stretch-timer">10:00</div>
                                    </div>
                                ` : activity.id === 'mindful-walk' ? `
                                    <div class="walk-container">
                                        <svg class="walk-figure" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                            <g class="walk-body">
                                                <circle cx="50" cy="12" r="8" />
                                                <line x1="50" y1="20" x2="50" y2="60" />
                                                <line class="walk-arm-left" x1="50" y1="25" x2="35" y2="45" />
                                                <line class="walk-arm-right" x1="50" y1="25" x2="65" y2="45" />
                                            </g>
                                            <line class="leg-left" x1="50" y1="60" x2="40" y2="90" />
                                            <line class="leg-right" x1="50" y1="60" x2="60" y2="90" />
                                        </svg>
                                        <div class="walk-timer-display" id="walk-timer">15:00</div>
                                    </div>
                                ` : `
                                    <div class="timer-progress-ring">
                                        <svg width="120" height="120">
                                            <circle cx="60" cy="60" r="54" stroke="#e2e8f0" stroke-width="8" fill="none"/>
                                            <circle id="timer-progress-circle" cx="60" cy="60" r="54" stroke="#3b82f6" stroke-width="8" fill="none"
                                                    stroke-dasharray="339.292" stroke-dashoffset="339.292" 
                                                    transform="rotate(-90 60 60)" stroke-linecap="round"/>
                                        </svg>
                                    </div>
                                    <div class="timer-display">
                                        <span id="timer-minutes">00</span>:<span id="timer-seconds">00</span>
                                    </div>
                                `}
                                <button class="timer-stop-btn" onclick="stopActivityTimer('${activityId}')">
                                    <i class="bi bi-stop-circle"></i> ${isFilipino ? 'Ihinto' : 'Stop'}
                                </button>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${activity.hasGlassTracker ? `
                        <div id="glass-tracker-container" style="margin-bottom:20px;">
                            <p style="font-weight:700;font-size:0.95rem;color:#1e293b;margin:0 0 12px;display:flex;align-items:center;gap:6px;">
                                <i class="bi bi-droplet-fill" style="color:#0ea5e9;"></i>
                                Daily Water Intake
                            </p>
                            <div id="glass-grid" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding:8px 0;">
                                ${Array.from({length:8}, (_,i) => `
                                    <button onclick="toggleGlass(${i})" id="glass-${i}"
                                        style="width:52px;height:64px;border-radius:12px;border:2px solid #e2e8f0;background:#f8fafc;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:all 0.2s;font-family:inherit;">
                                        <i class="bi bi-cup-straw" style="font-size:1.4rem;color:#cbd5e1;"></i>
                                        <span style="font-size:0.65rem;color:#94a3b8;font-weight:600;">${i+1}</span>
                                    </button>
                                `).join('')}
                            </div>
                            <p id="glass-count-label" style="text-align:center;font-size:0.82rem;color:#64748b;margin:8px 0 0;font-weight:600;">0 / 8 glasses</p>
                        </div>
                    ` : ''}

                    <button class="complete-activity-btn ${isCompletedToday ? 'completed' : ''}" 
                            id="start-activity-btn"
                            onclick="${activity.hasGlassTracker ? `completeHydration('${activityId}')` : activity.hasTimer && !isCompletedToday ? `startActivityTimer('${activityId}', ${activity.duration})` : activity.hasJournal && !isCompletedToday ? `openJournalEditor('${activityId}')` : `completeActivity('${activityId}')`}" 
                            ${isCompletedToday && !activity.hasGlassTracker ? 'disabled' : ''}>
                        <i class="bi bi-${isCompletedToday && !activity.hasGlassTracker ? 'check-circle-fill' : activity.hasGlassTracker ? 'droplet-fill' : activity.hasJournal ? 'pencil-square' : activity.hasTimer ? 'play-circle' : 'check-circle'}"></i>
                        ${isCompletedToday && !activity.hasGlassTracker ? completedText : activity.hasGlassTracker ? (isFilipino ? 'I-save ang Progress' : 'Save Progress') : activity.hasJournal ? (isFilipino ? 'Magsulat' : 'Write') : activity.hasTimer ? startText : (isFilipino ? 'Markahan bilang Tapos' : 'Mark as Complete')}
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove existing detail modal if any
    const existingModal = document.getElementById('activity-detail-modal');
    if (existingModal) existingModal.remove();

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Init glass tracker if this is hydration activity
    if (activity.hasGlassTracker) {
        setTimeout(() => initGlassTracker(), 50);
    }
}

// Close activity detail modal
// ─── Glass Tracker ───────────────────────────────────────────────
function _getGlassKey() {
    return 'hydration_' + new Date().toISOString().split('T')[0];
}

function _getGlassCount() {
    try {
        const data = JSON.parse(localStorage.getItem(_getGlassKey()) || '{"count":0}');
        return data.count || 0;
    } catch { return 0; }
}

function _saveGlassCount(count) {
    try { localStorage.setItem(_getGlassKey(), JSON.stringify({ count })); } catch {}
}

function initGlassTracker() {
    const count = _getGlassCount();
    updateGlassUI(count);
}

function updateGlassUI(count) {
    for (let i = 0; i < 8; i++) {
        const btn = document.getElementById(`glass-${i}`);
        if (!btn) continue;
        const filled = i < count;
        btn.style.background = filled ? '#e0f2fe' : '#f8fafc';
        btn.style.borderColor = filled ? '#0ea5e9' : '#e2e8f0';
        const icon = btn.querySelector('i');
        if (icon) icon.style.color = filled ? '#0ea5e9' : '#cbd5e1';
    }
    const label = document.getElementById('glass-count-label');
    if (label) {
        label.textContent = `${count} / 8 glasses`;
        label.style.color = count >= 8 ? '#22c55e' : '#64748b';
    }
}

function toggleGlass(index) {
    let count = _getGlassCount();
    // Click next glass to fill, or unfill last
    if (index === count) {
        count = count + 1;
    } else if (index === count - 1) {
        count = count - 1;
    } else if (index < count) {
        count = index;
    } else {
        count = index + 1;
    }
    count = Math.max(0, Math.min(8, count));
    _saveGlassCount(count);
    updateGlassUI(count);
}

async function completeHydration(activityId) {
    const count = _getGlassCount();
    if (count < 8) {
        if (typeof showToast === 'function') showToast(`${count}/8 glasses logged. Keep drinking! 💧`, '💧');
        return;
    }
    // All 8 glasses done — mark activity complete
    await completeActivity(activityId);
}

function closeActivityDetail() {
    const modal = document.getElementById('activity-detail-modal');
    if (modal) {
        modal.remove();
    }
}

// Handle backdrop click for activity detail
function handleActivityDetailBackdropClick(event) {
    if (event.target.id === 'activity-detail-modal') {
        closeActivityDetail();
    }
}

// Complete an activity
async function completeActivity(activityId) {
    if (!currentUser) return;

    const activity = selfCareActivities.find(a => a.id === activityId);
    if (!activity) return;

    try {
        const token = await currentUser.getIdToken();
        const response = await fetch(SERVER_URL + '/api/self-care/complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ activityId })
        });

        if (response.ok) {
            const data = await response.json();
            userSelfCareProgress[activityId] = data.progress;

            // Show success message
            const localized = getLocalizedActivity(activity);
            const isFilipino = getSelfCareLang() === 'fil';
            const message = isFilipino ? `Natapos mo ang ${localized.title}!` : `Completed ${localized.title}!`;

            if (typeof showToast === 'function') {
                showToast(message, '✅');
            }

            // Check for streak milestone
            if (data.progress.streak === activity.streak.target) {
                const milestoneMsg = isFilipino
                    ? `🎉 Natapos mo ang ${activity.streak.target}-day streak!`
                    : `🎉 You completed the ${activity.streak.target}-day streak!`;
                setTimeout(() => {
                    if (typeof showToast === 'function') {
                        showToast(milestoneMsg, '🏆');
                    }
                }, 1000);
            }

            // Refresh UI
            renderSelfCareWidget();
            closeActivityDetail();
            renderAllActivities();
        }
    } catch (error) {
        console.error('Error completing activity:', error);
        const errorMsg = getSelfCareLang() === 'fil' ? 'May error sa pag-save' : 'Error saving progress';
        if (typeof showToast === 'function') {
            showToast(errorMsg, '❌');
        }
    }
}

// Timer variables
let activityTimerInterval = null;
let activityTimerSeconds = 0;
let activityTimerDuration = 0;
let breathingCycleInterval = null;
let breathingPhase = 'inhale'; // inhale, hold, exhale
let breathingPhaseSeconds = 0;
let meditationCircumference = 816.8; // 2 * PI * 130

// Start activity timer
function startActivityTimer(activityId, durationMinutes) {
    const startBtn = document.getElementById('start-activity-btn');
    const timerContainer = document.getElementById('activity-timer-container');

    if (!startBtn || !timerContainer) return;

    // Hide start button, show timer
    startBtn.style.display = 'none';
    timerContainer.style.display = 'block';

    // Initialize timer
    activityTimerSeconds = 0;
    activityTimerDuration = durationMinutes * 60;

    // Update timer display
    updateTimerDisplay();

    // Start breathing cycle animation if it's breathing exercise
    if (activityId === 'breathing-exercise') {
        startBreathing478Cycle();
    }

    // Start meditation progress ring if it's meditation
    if (activityId === 'meditation') {
        updateMeditationProgress();
    }

    // Update stretch timer if it's morning stretch
    if (activityId === 'morning-stretch') {
        updateStretchTimer();
    }

    // Update walk timer if it's mindful walk
    if (activityId === 'mindful-walk') {
        updateWalkTimer();
    }

    // Start interval
    activityTimerInterval = setInterval(() => {
        activityTimerSeconds++;
        updateTimerDisplay();

        // Update meditation progress
        if (activityId === 'meditation') {
            updateMeditationProgress();
        }

        // Update stretch timer
        if (activityId === 'morning-stretch') {
            updateStretchTimer();
        }

        // Update walk timer
        if (activityId === 'mindful-walk') {
            updateWalkTimer();
        }

        // Auto-complete when duration is reached
        if (activityTimerSeconds >= activityTimerDuration) {
            stopActivityTimer(activityId, true);
        }
    }, 1000);
}

// Start 4-7-8 breathing cycle
function startBreathing478Cycle() {
    const isFilipino = getSelfCareLang() === 'fil';

    // Phase durations in seconds
    const INHALE_DURATION = 4;
    const HOLD_DURATION = 7;
    const EXHALE_DURATION = 8;

    // Initialize
    breathingPhase = 'inhale';
    breathingPhaseSeconds = 0;

    // Update display immediately
    updateBreathingDisplay(isFilipino);

    // Start cycle
    breathingCycleInterval = setInterval(() => {
        breathingPhaseSeconds++;

        // Check phase transitions
        if (breathingPhase === 'inhale' && breathingPhaseSeconds >= INHALE_DURATION) {
            breathingPhase = 'hold';
            breathingPhaseSeconds = 0;
        } else if (breathingPhase === 'hold' && breathingPhaseSeconds >= HOLD_DURATION) {
            breathingPhase = 'exhale';
            breathingPhaseSeconds = 0;
        } else if (breathingPhase === 'exhale' && breathingPhaseSeconds >= EXHALE_DURATION) {
            breathingPhase = 'inhale';
            breathingPhaseSeconds = 0;
        }

        updateBreathingDisplay(isFilipino);
    }, 1000);
}

// Update breathing display
function updateBreathingDisplay(isFilipino) {
    const instructionEl = document.getElementById('breathe-instruction');
    const countEl = document.getElementById('breathe-count');

    if (!instructionEl || !countEl) return;

    const PHASE_DURATIONS = {
        'inhale': 4,
        'hold': 7,
        'exhale': 8
    };

    const PHASE_TEXTS = {
        'inhale': isFilipino ? 'Huminga' : 'Breathe In',
        'hold': isFilipino ? 'Pigilan' : 'Hold',
        'exhale': isFilipino ? 'Palabas' : 'Breathe Out'
    };

    const remainingSeconds = PHASE_DURATIONS[breathingPhase] - breathingPhaseSeconds;

    instructionEl.textContent = PHASE_TEXTS[breathingPhase];
    countEl.textContent = remainingSeconds;
}

// Stop breathing animation
function stopBreathingAnimation() {
    if (breathingCycleInterval) {
        clearInterval(breathingCycleInterval);
        breathingCycleInterval = null;
    }
}

// Stop activity timer
function stopActivityTimer(activityId, autoComplete = false) {
    if (activityTimerInterval) {
        clearInterval(activityTimerInterval);
        activityTimerInterval = null;
    }

    // Stop breathing animation if active
    stopBreathingAnimation();

    const isFilipino = getSelfCareLang() === 'fil';

    if (autoComplete) {
        // Timer completed - mark activity as done
        completeActivity(activityId);
    } else {
        // User stopped early - ask if they want to mark as complete
        const message = isFilipino
            ? 'Gusto mo bang markahan bilang tapos?'
            : 'Do you want to mark this as complete?';

        if (confirm(message)) {
            completeActivity(activityId);
        } else {
            // Reset UI
            const startBtn = document.getElementById('start-activity-btn');
            const timerContainer = document.getElementById('activity-timer-container');
            if (startBtn) startBtn.style.display = 'block';
            if (timerContainer) timerContainer.style.display = 'none';
        }
    }
}

// Update timer display
function updateTimerDisplay() {
    const minutes = Math.floor(activityTimerSeconds / 60);
    const seconds = activityTimerSeconds % 60;

    const minutesEl = document.getElementById('timer-minutes');
    const secondsEl = document.getElementById('timer-seconds');
    const progressCircle = document.getElementById('timer-progress-circle');

    // Update regular timer display
    if (minutesEl) minutesEl.textContent = String(minutes).padStart(2, '0');
    if (secondsEl) secondsEl.textContent = String(seconds).padStart(2, '0');

    // Update breathing exercise countdown timer
    const breatheTimerEl = document.getElementById('breathe-timer');
    if (breatheTimerEl && activityTimerDuration > 0) {
        const remainingSeconds = activityTimerDuration - activityTimerSeconds;
        const remainingMinutes = Math.floor(remainingSeconds / 60);
        const remainingSecs = remainingSeconds % 60;
        breatheTimerEl.textContent = `${remainingMinutes}:${String(remainingSecs).padStart(2, '0')}`;
    }

    // Update meditation timer display
    const meditationTimerEl = document.getElementById('meditation-timer');
    if (meditationTimerEl && activityTimerDuration > 0) {
        const remainingSeconds = activityTimerDuration - activityTimerSeconds;
        const remainingMinutes = Math.floor(remainingSeconds / 60);
        const remainingSecs = remainingSeconds % 60;
        meditationTimerEl.textContent = `${remainingMinutes}:${String(remainingSecs).padStart(2, '0')}`;
    }

    // Update progress circle
    if (progressCircle && activityTimerDuration > 0) {
        const progress = activityTimerSeconds / activityTimerDuration;
        const circumference = 339.292; // 2 * PI * 54
        const offset = circumference * (1 - progress);
        progressCircle.style.strokeDashoffset = offset;
    }
}

// Update meditation progress ring
function updateMeditationProgress() {
    const progressRing = document.getElementById('meditation-progress-ring');
    if (!progressRing || activityTimerDuration === 0) return;

    const progressOffset = meditationCircumference - (activityTimerSeconds / activityTimerDuration) * meditationCircumference;
    progressRing.style.strokeDashoffset = progressOffset;
}

// Update stretch timer display
function updateStretchTimer() {
    const stretchTimerEl = document.getElementById('stretch-timer');
    if (!stretchTimerEl || activityTimerDuration === 0) return;

    const remainingSeconds = activityTimerDuration - activityTimerSeconds;
    const remainingMinutes = Math.floor(remainingSeconds / 60);
    const remainingSecs = remainingSeconds % 60;
    stretchTimerEl.textContent = `${remainingMinutes}:${String(remainingSecs).padStart(2, '0')}`;
}

// Update walk timer display
function updateWalkTimer() {
    const walkTimerEl = document.getElementById('walk-timer');
    if (!walkTimerEl || activityTimerDuration === 0) return;

    const remainingSeconds = activityTimerDuration - activityTimerSeconds;
    const remainingMinutes = Math.floor(remainingSeconds / 60);
    const remainingSecs = remainingSeconds % 60;
    walkTimerEl.textContent = `${remainingMinutes}:${String(remainingSecs).padStart(2, '0')}`;
}

// Initialize self-care on dashboard load
if (typeof document !== 'undefined') {
    // Try to load immediately if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSelfCare);
    } else {
        initSelfCare();
    }
}

function initSelfCare() {
    console.log('🌸 Initializing Self-Care Feature...');

    // Check if we're on the dashboard page
    const widget = document.getElementById('self-care-widget');
    if (!widget) {
        console.log('Self-care widget not found on this page');
        return;
    }

    // Setup offline status indicator
    setupOfflineIndicator();

    // Wait for Firebase auth to be ready
    const checkAuth = setInterval(() => {
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
            clearInterval(checkAuth);
            console.log('✅ Auth ready, loading self-care activities');
            loadSelfCareActivities();
            startReminderSystem();
        } else if (typeof currentUser !== 'undefined' && currentUser) {
            clearInterval(checkAuth);
            console.log('✅ Current user found, loading self-care activities');
            loadSelfCareActivities();
            startReminderSystem();
        }
    }, 500);

    // Timeout after 10 seconds
    setTimeout(() => {
        clearInterval(checkAuth);
        if (!selfCareActivities || selfCareActivities.length === 0) {
            console.log('⚠️ Loading self-care without auth (will show activities but not progress)');
            loadSelfCareActivities();
        }
    }, 10000);
}

// Setup offline status indicator
function setupOfflineIndicator() {
    // Create offline banner if not exists
    if (!document.getElementById('offline-status-banner')) {
        const banner = document.createElement('div');
        banner.id = 'offline-status-banner';
        banner.className = 'offline-status-banner';
        banner.innerHTML = `
            <div class="offline-status-content">
                <i class="bi bi-wifi-off"></i>
                <span id="offline-status-text">You are currently offline - Limited features available</span>
            </div>
        `;
        document.body.insertAdjacentElement('afterbegin', banner);
    }

    // Update status on load
    updateOfflineStatus();

    // Listen for online/offline events
    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);
}

// Update offline status display
function updateOfflineStatus() {
    const banner = document.getElementById('offline-status-banner');
    const statusText = document.getElementById('offline-status-text');

    if (!banner) return;

    const isOnline = navigator.onLine;
    const isFilipino = typeof getSelfCareLang() !== 'undefined' ? getSelfCareLang() === 'fil' : false;

    if (isOnline) {
        banner.classList.remove('show');
        console.log('🌐 Online');
    } else {
        banner.classList.add('show');
        if (statusText) {
            statusText.textContent = isFilipino
                ? 'Offline ka ngayon - Limited features lang available'
                : 'You are currently offline - Limited features available';
        }
        console.log('📴 Offline');
    }
}

// Export functions for global access
window.openSelfCareModal = openSelfCareModal;
window.closeSelfCareModal = closeSelfCareModal;
window.openActivityDetail = openActivityDetail;
window.closeActivityDetail = closeActivityDetail;
window.completeActivity = completeActivity;
window.loadSelfCareActivities = loadSelfCareActivities;
window.handleModalBackdropClick = handleModalBackdropClick;
window.handleActivityDetailBackdropClick = handleActivityDetailBackdropClick;
window.openJournalEditor = openJournalEditor;
window.closeJournalEditor = closeJournalEditor;
window.saveJournalEntry = saveJournalEntry;

// Start reminder system
// Start reminder system
function startReminderSystem() {
    console.log('⏰ Starting reminder system...');

    // Check reminders every minute
    reminderCheckInterval = setInterval(checkReminders, 60000);

    // Also check immediately
    checkReminders();

    // Schedule native OS repeating reminders if on Capacitor
    if (typeof window.capacitorNotifications !== 'undefined' &&
        typeof window.capacitorNotifications.scheduleDailySelfCareReminders === 'function') {
        window.capacitorNotifications.scheduleDailySelfCareReminders();
    } else if (typeof scheduleDailySelfCareReminders === 'function') {
        scheduleDailySelfCareReminders();
    }
}

// Check if any activities need reminders
function checkReminders() {
    if (!selfCareActivities || !userSelfCareProgress) return;

    const now = new Date();
    const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    selfCareActivities.forEach(activity => {
        if (!activity.reminderTime) return;

        // Only notify if activity has progress (has been started before)
        const progress = userSelfCareProgress[activity.id];
        if (!progress || (progress.completed === 0 && !progress.lastCompleted)) {
            return; // Skip if no progress yet
        }

        // Check if it's time for reminder and not completed today
        if (activity.reminderTime === currentTime) {
            const isCompletedToday = isActivityCompletedToday(progress);

            if (!isCompletedToday) {
                sendReminderNotification(activity);
            }
        }
    });
}

// Send reminder notification
function sendReminderNotification(activity) {
    const isFilipino = getSelfCareLang() === 'fil';
    const localized = getLocalizedActivity(activity);

    const title = isFilipino ? `⏰ Oras na para sa ${localized.title}` : `⏰ Time for ${localized.title}`;
    const message = isFilipino ? `Simulan ang iyong ${localized.title} ngayon!` : `Start your ${localized.title} now!`;

    // Save to notification history directly via localStorage
    try {
        const notificationId = `reminder-${activity.id}-${Date.now()}`;
        const notification = {
            id: notificationId,
            type: 'self-care-reminder',
            title: title,
            message: message,
            activityId: activity.id,
            activityTitle: localized.title,
            timestamp: new Date().toISOString(),
            read: false,
            icon: activity.icon
        };

        // Get existing history
        const history = JSON.parse(localStorage.getItem('psyc_notification_history') || '[]');
        history.unshift(notification);

        // Keep only last 50 notifications
        if (history.length > 50) {
            history.pop();
        }

        localStorage.setItem('psyc_notification_history', JSON.stringify(history));

        // Trigger update if functions exist
        if (typeof updateNotificationBadge === 'function') {
            updateNotificationBadge();
        }
        if (typeof renderNotificationHistory === 'function') {
            renderNotificationHistory();
        }
    } catch (error) {
        console.error('Error saving notification:', error);
    }

    // Send notification
    if (window.capacitorNotifications) {
        window.capacitorNotifications.sendSelfCareReminder(activity);
    } else if ('Notification' in window && Notification.permission === 'granted') {
        // Use browser notification if available
        new Notification(title, {
            body: message,
            icon: '/assets/icon.png',
            tag: `reminder-${activity.id}`,
            requireInteraction: false
        });
    }

    // Also show in-app toast notification
    if (typeof showToast === 'function') {
        showToast(message, '⏰');
    }

    console.log(`📢 Reminder sent for ${activity.id}`);
}

// Request notification permission
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('✅ Notification permission granted');
            }
        });
    }
}

// Open journal editor
function openJournalEditor(activityId) {
    const activity = selfCareActivities.find(a => a.id === activityId);
    if (!activity) return;

    const localized = getLocalizedActivity(activity);
    const isFilipino = getSelfCareLang() === 'fil';

    const prompt = isFilipino && activity.journalPromptFil ? activity.journalPromptFil : activity.journalPrompt;
    const contentPlaceholder = isFilipino ? 'Magsulat ng 3 bagay na iyong pinasasalamatan...' : 'Write 3 things you\'re grateful for...';

    const editorHTML = `
        <div id="journal-editor-modal" class="modal open" onclick="handleJournalBackdropClick(event)">
            <div class="modal-content activity-detail-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <div></div>
                    <h2>${localized.title}</h2>
                    <button class="close-btn" onclick="closeJournalEditor('${activityId}'); closeActivityDetail();" aria-label="Close">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="journal-editor-container">
                        <p style="font-size:1.05rem;color:#475569;margin:0 0 16px 0;font-weight:500;">${prompt}</p>
                        
                        <textarea 
                            id="journal-textarea" 
                            class="journal-textarea" 
                            placeholder="${contentPlaceholder}"
                            maxlength="2000"
                        ></textarea>
                        
                        <div class="journal-char-count">
                            <span id="char-count">0</span> / 2000
                        </div>

                        <button 
                            id="journal-save-btn"
                            onclick="saveJournalEntry('${activityId}')"
                            style="width:100%;margin-top:16px;padding:14px;background:#3b82f6;color:#fff;border:none;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer;transition:background 0.2s;"
                            onmouseover="this.style.background='#2563eb'"
                            onmouseout="this.style.background='#3b82f6'">
                            ${isFilipino ? 'I-save' : 'Save Entry'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', editorHTML);

    // Add character counter
    const textarea = document.getElementById('journal-textarea');
    const charCount = document.getElementById('char-count');

    textarea.addEventListener('input', () => {
        const length = textarea.value.length;
        charCount.textContent = length;
    });

    // Focus on textarea
    setTimeout(() => textarea.focus(), 100);
}

// Close journal editor
function closeJournalEditor(activityId) {
    const modal = document.getElementById('journal-editor-modal');
    if (modal) {
        modal.classList.remove('open');
        setTimeout(() => {
            if (modal && modal.parentNode) {
                modal.remove();
            }
        }, 300);
    }
}

// Handle backdrop click for journal editor
function handleJournalBackdropClick(event) {
    if (event.target.id === 'journal-editor-modal') {
        const textarea = document.getElementById('journal-textarea');
        const activityId = event.target.querySelector('.close-btn')?.onclick?.toString().match(/'([^']+)'/)?.[1];

        if (textarea && textarea.value.trim().length >= 10) {
            // Auto-save the entry
            saveJournalEntry(activityId);
        } else if (textarea && textarea.value.length > 0) {
            const isFilipino = getSelfCareLang() === 'fil';
            const confirmMsg = isFilipino
                ? 'May nakasulat ka pa. Sigurado ka bang gusto mong lumabas?'
                : 'You have unsaved content. Are you sure you want to close?';

            if (confirm(confirmMsg)) {
                closeJournalEditor(activityId);
            }
        } else {
            closeJournalEditor(activityId);
        }
    }
}

// Save journal entry
async function saveJournalEntry(activityId) {
    const textarea = document.getElementById('journal-textarea');
    const content = textarea ? textarea.value.trim() : '';

    if (!content || content.length < 10) {
        const isFilipino = getSelfCareLang() === 'fil';
        const errorMsg = isFilipino ? 'Magsulat ng kahit 10 characters' : 'Please write at least 10 characters';
        if (typeof showToast === 'function') {
            showToast(errorMsg, '⚠️');
        }
        return;
    }

    if (!currentUser) return;

    try {
        const saveBtn = document.getElementById('journal-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Saving...';
        }

        const token = await currentUser.getIdToken();
        const isFilipino = getSelfCareLang() === 'fil';

        // Auto-generate title with date
        const today = new Date();
        const dateStr = today.toLocaleDateString(isFilipino ? 'fil-PH' : 'en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const title = isFilipino ? `Pasasalamat Journal - ${dateStr}` : `Gratitude Journal - ${dateStr}`;

        // Save to My Journals using existing saveJournal function
        const journalEntry = {
            title: title,
            content: content,
            timestamp: new Date().toISOString(),
            mood: 'grateful',
            tags: ['gratitude', 'self-care']
        };

        // Use the existing journal save endpoint
        const journalResponse = await fetch(SERVER_URL + '/api/journals', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(journalEntry)
        });

        if (!journalResponse.ok) {
            throw new Error('Failed to save journal');
        }

        // Complete the activity
        const completeResponse = await fetch(SERVER_URL + '/api/self-care/complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ activityId })
        });

        if (completeResponse.ok) {
            const data = await completeResponse.json();
            userSelfCareProgress[activityId] = data.progress;

            // Show success message
            const message = isFilipino ? `Na-save sa My Journals! ✅` : `Saved to My Journals! ✅`;

            if (typeof showToast === 'function') {
                showToast(message, '📝');
            }

            // Check for streak milestone
            const activity = selfCareActivities.find(a => a.id === activityId);
            if (data.progress.streak === activity.streak.target) {
                const milestoneMsg = isFilipino
                    ? `🎉 Natapos mo ang ${activity.streak.target}-day streak!`
                    : `🎉 You completed the ${activity.streak.target}-day streak!`;
                setTimeout(() => {
                    if (typeof showToast === 'function') {
                        showToast(milestoneMsg, '🏆');
                    }
                }, 1000);
            }

            // Close modals and refresh UI
            closeJournalEditor(activityId);
            closeActivityDetail();
            renderSelfCareWidget();

            // Reopen all activities modal if it was open
            const allActivitiesModal = document.getElementById('self-care-modal');
            if (allActivitiesModal && allActivitiesModal.classList.contains('open')) {
                renderAllActivities();
            }

            // Refresh journals if on journals page
            if (typeof loadJournals === 'function') {
                loadJournals();
            }
        }
    } catch (error) {
        console.error('Error saving journal:', error);
        const errorMsg = getSelfCareLang() === 'fil' ? 'May error sa pag-save' : 'Error saving entry';
        if (typeof showToast === 'function') {
            showToast(errorMsg, '❌');
        }

        // Re-enable button
        const saveBtn = document.getElementById('journal-save-btn');
        if (saveBtn) {
            saveBtn.disabled = false;
            const isFilipino = getSelfCareLang() === 'fil';
            saveBtn.innerHTML = `<i class="bi bi-check-circle"></i> ${isFilipino ? 'I-save' : 'Save'}`;
        }
    }
}

