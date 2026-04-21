// ─── Organization Module ────────────────────────────────────────

// Hide Create Group for non-supervisors — show only Join Group
window.gateOrgSetup = function gateOrgSetup() {
    function storageGet(key) {
        try { const v = localStorage.getItem(key); if (v !== null) return v; } catch (e) { }
        try { return sessionStorage.getItem(key); } catch (_) { return null; }
    }

    const isSupValue = storageGet('psyc_is_supervisor');

    // If we don't know yet (still loading), don't hide anything to avoid flicker
    if (isSupValue === null) return;

    const isSupervisor = isSupValue === '1';
    const createCard = document.getElementById('create-org-card');
    const joinCard = document.getElementById('join-org-card');
    const showCreateBtn = document.getElementById('show-create');
    const showJoinBtn = document.getElementById('show-join');

    if (!isSupervisor) {
        // Non-supervisors: only join
        if (createCard) createCard.classList.add('hidden');
        if (joinCard) joinCard.classList.remove('hidden');
        if (showCreateBtn) showCreateBtn.style.display = 'none';
    } else {
        // Supervisors: can switch between both
        if (showCreateBtn) showCreateBtn.style.display = 'block';
        if (showJoinBtn) showJoinBtn.style.display = 'block';

        // If not in a group, default to the Create card
        if (!storageGet('psyc_orgId') && createCard && joinCard) {
            createCard.classList.remove('hidden');
            joinCard.classList.add('hidden');
        }
    }
};

// Initial run
window.gateOrgSetup();

const createOrgForm = document.getElementById('create-org-form');
const joinOrgForm = document.getElementById('join-org-form');
const showJoinLink = document.getElementById('show-join');
const showCreateLink = document.getElementById('show-create');
const createOrgCard = document.getElementById('create-org-card');
const joinOrgCard = document.getElementById('join-org-card');
const orgError = document.getElementById('org-error');
const inviteResult = document.getElementById('invite-result');
const inviteCodeDisplay = document.getElementById('invite-code-display');

// Toggle create / join views
if (showJoinLink) {
    showJoinLink.addEventListener('click', (e) => {
        e.preventDefault();
        createOrgCard.classList.add('hidden');
        joinOrgCard.classList.remove('hidden');
    });
}

if (showCreateLink) {
    showCreateLink.addEventListener('click', (e) => {
        e.preventDefault();
        joinOrgCard.classList.add('hidden');
        createOrgCard.classList.remove('hidden');
    });
}

// Helper: get auth token
async function getToken() {
    const user = auth.currentUser;
    if (!user) throw new Error('Not logged in');
    return user.getIdToken();
}

// ─── Create Organization ────────────────────────────────────────
if (createOrgForm) {
    createOrgForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('org-name').value.trim();
        if (!name) return;

        const submitBtn = createOrgForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Creating...';
        submitBtn.disabled = true;

        try {
            const token = await getToken();
            const res = await fetch(SERVER_URL + '/api/org/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ name }),
            });

            let data;
            try {
                data = await res.json();
            } catch (err) {
                throw new Error('Server returned an invalid response.');
            }

            if (!res.ok) throw new Error(data.error || 'Failed to create organization');

            if (data.orgId) {
                localStorage.setItem('psyc_orgId', data.orgId);
                // Cache org name so it stays visible on dashboard instantly
                localStorage.setItem('psyc_orgName', name);
            }

            // Show invite code
            if (inviteResult && inviteCodeDisplay) {
                inviteCodeDisplay.textContent = data.inviteCode;
                inviteResult.classList.remove('hidden');
                createOrgForm.classList.add('hidden');
            }

            // Redirect after showing code
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 3000);
        } catch (err) {
            console.error('Create org error:', err);
            showOrgError(err.message);
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
}

// ─── Join Organization ──────────────────────────────────────────
if (joinOrgForm) {
    joinOrgForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('invite-code').value.trim().toUpperCase();
        if (!code) return;

        const submitBtn = joinOrgForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Joining...';
        submitBtn.disabled = true;

        try {
            const token = await getToken();
            const res = await fetch(SERVER_URL + '/api/org/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ inviteCode: code }),
            });

            let data;
            try {
                data = await res.json();
            } catch (err) {
                throw new Error('Server returned an invalid response.');
            }

            if (!res.ok) throw new Error(data.error || 'Failed to join organization');

            if (data.orgId) localStorage.setItem('psyc_orgId', data.orgId);

            window.location.href = '/dashboard.html';
        } catch (err) {
            console.error('Join org error:', err);
            showOrgError(err.message);
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
}

// Copy invite code
function copyInviteCode() {
    const code = document.getElementById('invite-code-display')?.textContent;
    if (code) {
        navigator.clipboard.writeText(code);
        const btn = document.getElementById('copy-code-btn');
        if (btn) {
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy', 2000);
        }
    }
}

function showOrgError(msg) {
    if (orgError) {
        orgError.textContent = msg;
        orgError.classList.remove('hidden');
        setTimeout(() => orgError.classList.add('hidden'), 5000);
    }
}