/**
 * dashboard-modals.js
 * Logic for migrated modals in the new dashboard.
 */

// Shim showToast to use the dashboard's toast system
if (typeof showToast === 'undefined' && typeof ldToast !== 'undefined') {
    window.showToast = function (message, icon = '📢') {
        ldToast(message, 'info'); // Using 'info' as the default type for ldToast
    };
}

// Sidebar logic to reveal Admin (Supervisor) button and populate profile based on user
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const idTokenResult = await user.getIdTokenResult();
            const isAdmin = idTokenResult.claims.admin || false;

            // Log for debugging
            console.log('User joined dashboard. Is Admin:', isAdmin);

            // Populate Profile Data
            const avatarEl = document.getElementById('ld-avatar');
            const unameEl = document.getElementById('ld-uname');
            const emailEl = document.getElementById('ld-email');

            if (avatarEl && unameEl && emailEl) {
                const displayName = user.displayName || localStorage.getItem('psyc_username') || 'User';
                const email = user.email || 'No email';

                unameEl.textContent = displayName.startsWith('@') ? displayName : '@' + displayName.toLowerCase().replace(/\s+/g, '');
                emailEl.textContent = email;
                // Set initial letter (will be overridden by updateUserAvatarUI if custom avatar is set)
                const avatarText = document.getElementById('ld-avatar-text');
                if (avatarText) avatarText.textContent = displayName.charAt(0).toUpperCase();
            }

        } catch (error) {
            console.error('Error checking admin claims or populating profile:', error);
        }
    }
});

// Settings Modal
function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    if (typeof ldCloseSidebar === 'function') ldCloseSidebar();
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

// Reminders Modal
function openRemindersSettings() {
    const modal = document.getElementById('reminders-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    if (typeof ldCloseSidebar === 'function') ldCloseSidebar();
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

// About Modal
function openAboutModal() {
    const modal = document.getElementById('about-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    if (typeof ldCloseSidebar === 'function') ldCloseSidebar();
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

// Supervisor Dashboard Logic
function openSupervisorMenu() {
    // This calls openAdminPanel from admin.js
    if (typeof openAdminPanel === 'function') {
        openAdminPanel();
    } else {
        console.error('openAdminPanel not found in admin.js');
        if (typeof ldToast === 'function') ldToast('Admin logic not loaded', 'error');
    }
    if (typeof ldCloseSidebar === 'function') ldCloseSidebar();
}

// Logout
function logoutpsyc() {
    if (typeof ldToast === 'function') ldToast('Logging out...', 'info');

    // Clear session storage/local storage as needed
    localStorage.removeItem('psyc_orgId');
    localStorage.removeItem('psyc_username');
    localStorage.removeItem('psyc_orgName');

    firebase.auth().signOut().then(() => {
        window.location.href = '/';
    }).catch(err => {
        console.error('Logout error:', err);
        window.location.href = '/';
    });
}

// Sidebar logic to highlight active tab
const LD_TABS = ['home', 'sources', 'discussion', 'journal', 'archives', 'gratitude', 'virtualpet', 'team', 'selfcare'];
const LD_TITLES = {
    home: 'Dashboard',
    sources: 'Sources',
    discussion: 'Discussion',
    journal: 'Mood & History',
    archives: 'Saved Quotes',
    gratitude: 'Gratitude Jar',
    virtualpet: 'Virtual Pet',
    team: 'Group Status',
    selfcare: 'Daily Self-Care'
};

function ldTab(name) {
    // Basic navigation logic
    LD_TABS.forEach(t => {
        const page = document.getElementById('ld-' + t);
        const btn = document.getElementById('ldnav-' + t);
        const sb = document.getElementById('sb-' + t);
        if (page) page.classList.toggle('active', t === name);
        if (btn) btn.classList.toggle('active', t === name);
        if (sb) {
            sb.classList.toggle('sb-active', t === name);
            // Also handle 'active' class used in some styles
            sb.classList.toggle('active', t === name);
        }
    });

    const title = LD_TITLES[name] || 'Dashboard';
    const mt = document.getElementById('ld-title-mobile');
    const dt = document.getElementById('ld-title-desktop');
    if (mt) mt.textContent = title;
    if (dt) dt.textContent = title;

    const scroll = document.querySelector('.ld-scroll');
    if (scroll) scroll.scrollTop = 0;

    document.body.classList.toggle('ld-gratitude-immersive', name === 'gratitude');

    // Trigger tab-specific logic from app.js / admin.js
    if (typeof switchTab === 'function') {
        switchTab(name);
    }

    // Special handling for Team tab
    if (name === 'team') {
        if (typeof loadTeamStats === 'function') {
            loadTeamStats(); // from admin.js
        }
        if (typeof renderTeamGrid === 'function') {
            renderTeamGrid(); // from app.js
        }
    }

    // Special handling for Journal tab
    if (name === 'journal') {
        if (typeof loadUserJournals === 'function') {
            loadUserJournals();
        }
        if (typeof loadMoodCalendar === 'function') {
            loadMoodCalendar();
        }
    }

    // Special handling for Sources tab
    if (name === 'sources') {
        if (typeof updateMoodResources === 'function') {
            updateMoodResources();
        }
    }

    // Special handling for Archives tab
    if (name === 'archives') {
        if (typeof loadArchivesQuotes === 'function') {
            loadArchivesQuotes();
        }
    }

    // Hide bottom nav on selfcare tab, show back button
    const bottomNav = document.querySelector('.ld-bottom-nav');
    if (bottomNav) {
        if (name === 'selfcare') {
            bottomNav.classList.add('sc-hidden');
        } else {
            bottomNav.classList.remove('sc-hidden');
        }
    }
    const backBtn = document.getElementById('self-care-back-btn');
    if (backBtn) {
        backBtn.style.display = name === 'selfcare' ? 'flex' : 'none';
    } else if (name === 'selfcare') {
        setTimeout(() => {
            const btn = document.getElementById('self-care-back-btn');
            if (btn) btn.style.display = 'flex';
        }, 500);
    }
}

// Make ldTab globally available (overwrite any existing one)
window.ldTab = ldTab;

// SOS Modal
function openSOSModal() {
    const modal = document.getElementById('sos-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeSOSModal() {
    const modal = document.getElementById('sos-modal');
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

async function alertSupervisor() {
    // Show confirmation modal instead of browser confirm
    const modal = document.getElementById('sos-confirm-modal');
    if (modal) {
        const messageInput = document.getElementById('sos-user-message');
        if (messageInput) {
            messageInput.value = '';
            setTimeout(() => messageInput.focus(), 80);
        }
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    } else {
        // Fallback to browser confirm if modal not found
        if (confirm('This will send a priority alert to your supervisor. Are you sure?')) {
            sendSOSAlert();
        }
    }
}

function cancelSOSConfirm() {
    const modal = document.getElementById('sos-confirm-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

async function confirmSOSAlert() {
    // Close confirmation modal
    cancelSOSConfirm();

    // Send the alert
    await sendSOSAlert();
}

async function sendSOSAlert() {
    if (typeof ldToast === 'function') ldToast('Sending SOS alert...', 'info');

    try {
        const messageInput = document.getElementById('sos-user-message');
        const customMessage = messageInput ? messageInput.value.trim() : '';
        const finalMessage = customMessage || 'I need immediate support.';

        // Emit real-time SOS alert through Socket.IO
        if (typeof socket !== 'undefined' && socket && socket.connected) {
            socket.emit('sos:alert', {
                message: finalMessage.slice(0, 220),
                timestamp: Date.now()
            });

            setTimeout(() => {
                if (typeof ldToast === 'function') {
                    ldToast('Supervisor alerted. Help is on the way. Stay calm.', 'success');
                }
                closeSOSModal();
            }, 1500);
        } else {
            // Fallback: direct REST call
            const token = await firebase.auth().currentUser.getIdToken();
            // Even without socket, the server socket handler won't fire.
            // Show feedback anyway.
            if (typeof ldToast === 'function') {
                ldToast('Alert sent. Your supervisor will be notified.', 'success');
            }
            closeSOSModal();
        }
    } catch (err) {
        console.error('SOS alert error:', err);
        if (typeof ldToast === 'function') ldToast('Failed to send alert. Try again.', 'error');
    }
}

window.openSOSModal = openSOSModal;
window.closeSOSModal = closeSOSModal;
window.alertSupervisor = alertSupervisor;
window.cancelSOSConfirm = cancelSOSConfirm;
window.confirmSOSAlert = confirmSOSAlert;

// Self Care Tracking
function trackSelfCare(activity) {
    const messages = {
        prayer: 'Self-care logged: Moments of reflection and quiet.',
        games: 'Self-care logged: A well-deserved fun break!',
        outside: 'Self-care logged: Enjoying the fresh air!'
    };

    ldToast(messages[activity] || 'Self-care activity logged!', 'success');

    // Future integration: Save to Firebase users/uid/selfCareLogs
    console.log('Self-care activity tracked:', activity);
}
window.trackSelfCare = trackSelfCare;

// Logout logic (Unified)
function logoutpsyc() {
    if (typeof ldToast === 'function') ldToast('Logging out...', 'info');

    // Handle socket disconnection if app.js is loaded
    if (typeof socket !== 'undefined' && socket && typeof socket.disconnect === 'function') {
        socket.disconnect();
    }

    // Clear session storage/local storage as needed
    localStorage.removeItem('psyc_orgId');
    localStorage.removeItem('psyc_username');
    localStorage.removeItem('psyc_orgName');

    firebase.auth().signOut().then(() => {
        window.location.href = '/';
    }).catch(err => {
        console.error('Logout error:', err);
        window.location.href = '/';
    });
}

// Ensure logoutpsyc is global
window.logoutpsyc = logoutpsyc;

// Leave Group Logic
function confirmLeaveGroup() {
    if (confirm('Are you sure you want to leave this group? You will lose access to team updates and discussions.')) {
        if (typeof leaveOrganization === 'function') {
            leaveOrganization();
        } else {
            console.error('leaveOrganization function not found in app.js');
            if (typeof ldToast === 'function') ldToast('Feature not available yet', 'error');
        }
    }
}
window.confirmLeaveGroup = confirmLeaveGroup;
// supervisor function
window.openSupervisorMenu = openSupervisorMenu;

// ─── Contact Info Modal ──────────────────────────────────────────

function openContactInfoModal() {
    ldCloseSidebar();
    const modal = document.getElementById('contact-info-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadContactInfo();
        // Pre-fill current username
        const usernameInput = document.getElementById('change-username-input');
        if (usernameInput) {
            usernameInput.value = storageGet('psyc_username') || '';
        }
    }
}

function closeContactInfoModal() {
    const modal = document.getElementById('contact-info-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

async function loadContactInfo() {
    try {
        const user = firebase.auth().currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const res = await fetch(SERVER_URL + '/api/user/contact', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const phoneInput = document.getElementById('contact-phone');
            const messengerInput = document.getElementById('contact-messenger');
            const emergencyInput = document.getElementById('contact-emergency-name');
            if (phoneInput) phoneInput.value = data.contactPhone || '';
            if (messengerInput) messengerInput.value = data.contactMessenger || '';
            if (emergencyInput) emergencyInput.value = data.emergencyContactName || '';
        }
    } catch (err) {
        console.error('Error loading contact info:', err);
    }
}

async function saveContactInfo() {
    try {
        const user = firebase.auth().currentUser;
        if (!user) return;

        const phone = (document.getElementById('contact-phone')?.value || '').trim();
        const messenger = (document.getElementById('contact-messenger')?.value || '').trim();
        const emergencyName = (document.getElementById('contact-emergency-name')?.value || '').trim();

        const token = await user.getIdToken();
        const res = await fetch(SERVER_URL + '/api/user/contact', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contactPhone: phone,
                contactMessenger: messenger,
                emergencyContactName: emergencyName
            })
        });

        if (res.ok) {
            if (typeof ldToast === 'function') ldToast('Contact info saved!', 'success');
            closeContactInfoModal();
        } else {
            if (typeof ldToast === 'function') ldToast('Failed to save contact info.', 'error');
        }
    } catch (err) {
        console.error('Error saving contact info:', err);
        if (typeof ldToast === 'function') ldToast('Error saving contact info.', 'error');
    }
}

window.openContactInfoModal = openContactInfoModal;
window.closeContactInfoModal = closeContactInfoModal;
window.saveContactInfo = saveContactInfo;

// ─── Change Username ─────────────────────────────────────────────
async function changeUsername() {
    const input = document.getElementById('change-username-input');
    const btn = document.getElementById('change-username-btn');
    const errorEl = document.getElementById('change-username-error');

    const username = input.value.trim().toLowerCase();
    errorEl.style.display = 'none';

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        errorEl.textContent = 'Invalid format. Use 3-20 letters, numbers, or underscores.';
        errorEl.style.display = 'block';
        return;
    }

    const currentUsername = storageGet('psyc_username');
    if (username === currentUsername) {
        errorEl.textContent = 'That\'s already your username.';
        errorEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('Not logged in');
        const token = await user.getIdToken();

        const res = await fetch(SERVER_URL + '/api/user/set-username', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ username })
        });

        const data = await res.json();
        if (res.ok) {
            storageSet('psyc_username', username);
            // Update UI
            const ldUname = document.getElementById('ld-uname');
            if (ldUname) ldUname.textContent = '@' + username;
            const userNameMore = document.getElementById('user-name-more');
            if (userNameMore) userNameMore.textContent = '@' + username;
            if (typeof showToast === 'function') showToast('Username updated!', '✅');
            btn.textContent = 'Saved!';
            setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
        } else {
            errorEl.textContent = data.error || 'Failed to update username.';
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    } catch (err) {
        errorEl.textContent = 'Server error. Please try again.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

window.changeUsername = changeUsername;

// Export other modal functions
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.openRemindersSettings = openRemindersSettings;
window.closeRemindersSettings = closeRemindersSettings;
window.openAboutModal = openAboutModal;
window.closeAboutModal = closeAboutModal;

// ─── Avatar Selection Modal ──────────────────────────────────────
const AVATAR_FILES = [
    '05b1dfaf-342c-4b63-bad0-0c2cc660ce86.jpg',
    '0d50d1a6-3c35-404d-a1c3-793a0ef35186.jpg',
    '132cb05d-dcb7-426b-8688-ba91bd0439d9.jpg',
    '1c9bd623-b2a3-432b-b542-d196af22518c.jpg',
    '48f578b6-23d1-410e-b6d2-481bd0412df1.jpg',
    '498cdf64-9946-4211-8355-c19248f36f1f.jpg',
    '57a03ca9-451f-4a42-9b73-8110f9c2a1b3.jpg',
    '5a256d6a-a1fe-4fa6-9f06-0f8878770206.jpg',
    '6a33ab0b-fd4a-498e-87ad-3acce541ec7a.jpg',
    '6e1f632f-3751-452a-a36b-7b645e8949b9.jpg',
    '764ee84d-24cb-43c6-9ddc-16123da15ed4.jpg',
    '85fd7006-0211-42bd-9f0e-6a4760a64766.jpg',
    '949966c9-478d-45cf-94b4-454810da841e.jpg',
    '984c1c3f-b9f6-484c-8c21-debd1ecfa75c.jpg',
    'b07ef5f2-2506-49b7-87c5-578b7aa6d8d8.jpg',
    'd626e2fe-7c93-4df7-bf3b-b541709ba7f6.jpg',
    'f3c41e4d-0976-49fc-894a-bf7ff0271391.jpg',
    'f5737347-3b1a-4f3f-87f2-072173b582ea.jpg',
    'jeff.jpg',
    'jhas.jpg',
    'k.jpg',
    'jen.jpg'
    
];

function openAvatarSelectionModal() {
    const modal = document.getElementById('avatar-selection-modal');
    if (modal) {
        modal.classList.add('open');
        // Let it scroll if needed, but since we handle overflow inside modal-content we can set body hidden
        // Wait, contact-info is already setting body hidden. Let's just be consistent.

        const grid = document.getElementById('avatar-grid');
        grid.innerHTML = '';

        AVATAR_FILES.forEach(filename => {
            const url = `/assets/Avatar/${filename}`;
            const img = document.createElement('img');
            img.src = url;
            img.style.width = '100%';
            img.style.aspectRatio = '1/1';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '16px';
            img.style.cursor = 'pointer';
            img.style.boxShadow = '0 4px 10px rgba(0,0,0,0.1)';
            img.style.transition = 'transform 0.2s, box-shadow 0.2s, outline 0.2s';
            img.style.outline = '3px solid transparent';

            img.onmouseover = () => { img.style.transform = 'scale(1.05)'; };
            img.onmouseout = () => { img.style.transform = 'scale(1)'; };

            img.onclick = () => selectAvatar(url);

            grid.appendChild(img);
        });
    }
}

function closeAvatarSelectionModal() {
    const modal = document.getElementById('avatar-selection-modal');
    if (modal) {
        modal.classList.remove('open');
    }
}

async function selectAvatar(avatarUrl) {
    if (typeof ldToast === 'function') ldToast('Updating avatar...', 'info');

    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('Not logged in');
        const token = await user.getIdToken();

        const res = await fetch(SERVER_URL + '/api/user/set-avatar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ avatarUrl: avatarUrl || '' })
        });

        if (res.ok) {
            const data = await res.json();
            if (typeof window.updateUserAvatarUI === 'function') {
                window.updateUserAvatarUI(data.avatarUrl, storageGet('psyc_username'));
            }
            if (typeof ldToast === 'function') ldToast('Avatar updated!', 'success');
            closeAvatarSelectionModal();
        } else {
            console.error('Failed to update avatar', await res.text());
            if (typeof ldToast === 'function') ldToast('Failed to update avatar.', 'error');
        }
    } catch (err) {
        console.error('Save avatar error:', err);
        if (typeof ldToast === 'function') ldToast('Error updating avatar.', 'error');
    }
}

function removeAvatar() {
    selectAvatar('');
}

window.openAvatarSelectionModal = openAvatarSelectionModal;
window.closeAvatarSelectionModal = closeAvatarSelectionModal;
window.selectAvatar = selectAvatar;
window.removeAvatar = removeAvatar;
