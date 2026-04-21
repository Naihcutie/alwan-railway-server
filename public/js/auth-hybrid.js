// Hybrid Auth - Works for both Web and Native
// Uses redirect flow which works in Capacitor WebView

// Check if running in Capacitor
const isCapacitor = window.Capacitor !== undefined;

// DOM elements
const googleLoginBtn = document.getElementById('google-login-btn');
const facebookLoginBtn = document.getElementById('facebook-login-btn');
const authError = document.getElementById('auth-error');

// Show error message
function showError(el, msg) {
    if (el) {
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }
}

// ─── Social Login Function ──────────────────────────────────────
async function loginWithProvider(provider) {
    try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        
        if (isCapacitor) {
            // Use redirect for native app (works in WebView)
            console.log('Using redirect flow for native app');
            await auth.signInWithRedirect(provider);
        } else {
            // Use popup for web
            console.log('Using popup flow for web');
            const result = await auth.signInWithPopup(provider);
            // Auth state listener handles redirect
        }
    } catch (err) {
        console.error('Login error:', err);
        showError(authError, getErrorMessage(err.code));
    }
}

// Handle redirect result (for native app)
if (isCapacitor) {
    auth.getRedirectResult().then((result) => {
        if (result.user) {
            console.log('Redirect sign-in successful:', result.user);
            // Auth state listener will handle the rest
        }
    }).catch((error) => {
        console.error('Redirect result error:', error);
        showError(authError, getErrorMessage(error.code));
    });
}

if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        loginWithProvider(provider);
    });
}

if (facebookLoginBtn) {
    facebookLoginBtn.addEventListener('click', () => {
        const provider = new firebase.auth.FacebookAuthProvider();
        loginWithProvider(provider);
    });
}

let isCheckingAuth = false;
auth.onAuthStateChanged(async (user) => {
    if (isCheckingAuth) return;

    if (user) {
        isCheckingAuth = true;
        try {
            const token = await user.getIdToken();
            const res = await fetch(SERVER_URL + `/api/user/verify-org?t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                console.warn('verify-org failed on auth page with status', res.status);
                if (res.status === 401) {
                    await auth.signOut();
                    window.location.href = '/';
                    return;
                }
                const isIndexPage = window.location.pathname === '/' ||
                    window.location.pathname.endsWith('/') ||
                    window.location.pathname.includes('index.html');
                if (isIndexPage) {
                    showSection('org-setup');
                }
                return;
            }

            const data = await res.json();

            const isIndexPage = window.location.pathname === '/' ||
                window.location.pathname.endsWith('/') ||
                window.location.pathname.includes('index.html');
            const isDashboardPage = window.location.pathname.includes('dashboard.html') || window.location.pathname.includes('entry.html');

            console.log(`🔑 [AUTH] uid: ${user.uid} | hasUser: ${data.hasUsername} | orgId: ${data.orgId} | page: ${window.location.pathname}`);

            const cachedUsername = localStorage.getItem('psyc_username');
            const effectiveHasUsername = data && (data.hasUsername || !!cachedUsername);

            // 1. Username Check
            if (data && !effectiveHasUsername) {
                if (!isIndexPage) {
                    console.log("🚫 Username missing. Redirecting to setup...");
                    window.location.href = '/';
                    return;
                }
                showSection('username-setup');
                setupUsernameForm(token, data.orgId);
                return;
            }

            // 2. Organization Check
            if (data && data.orgId) {
                localStorage.setItem('psyc_orgId', data.orgId);
                if (isIndexPage) {
                    console.log("🚀 Everything ready. Going to dashboard...");
                    window.location.href = '/dashboard.html';
                }
                return;
            }

            // 3. Fallback: Org Setup
            if (isIndexPage) {
                showSection('org-setup');
            }
        } catch (err) {
            console.error('❌ Auth Verification Error:', err);
            if (window.location.pathname.includes('index.html')) {
                showSection('org-setup');
            }
        } finally {
            isCheckingAuth = false;
        }

    } else {
        localStorage.removeItem('psyc_orgId');
        const isProtectedPage = window.location.pathname.includes('dashboard.html') || window.location.pathname.includes('entry.html');
        if (isProtectedPage || (!window.location.pathname.includes('index.html') && window.location.pathname !== '/')) {
            window.location.href = '/';
        } else {
            showSection('auth-section');
        }
    }
});


function showSection(id) {
    const sections = ['auth-section', 'username-setup', 'org-setup'];
    sections.forEach(s => {
        const el = document.getElementById(s);
        if (el) {
            if (s === id) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });
}

function setupUsernameForm(token, existingOrgId = null) {
    const form = document.getElementById('username-form');
    const input = document.getElementById('username-input');
    const errorEl = document.getElementById('username-error');
    const btn = document.getElementById('save-username-btn');

    if (!form) return;

    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    const newInput = newForm.querySelector('#username-input');
    const newBtn = newForm.querySelector('#save-username-btn');
    const newErrorEl = newForm.querySelector('#username-error');

    newForm.onsubmit = async (e) => {
        e.preventDefault();
        const username = newInput.value.trim().toLowerCase();

        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
            showError(newErrorEl, 'Invalid format. Use 3-20 letters, numbers, or underscores.');
            return;
        }

        newBtn.disabled = true;
        newBtn.textContent = 'Saving...';

        try {
            const res = await fetch(SERVER_URL + '/api/user/set-username', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ username })
            });

            const result = await res.json();
            if (res.ok) {
                console.log("✅ Username saved successfully. Redirecting...");
                localStorage.setItem('psyc_username', username);
                if (existingOrgId) {
                    localStorage.setItem('psyc_orgId', existingOrgId);
                    window.location.href = '/dashboard.html?v=' + Date.now();
                } else {
                    window.location.href = '/?username=success&v=' + Date.now();
                }
            } else {
                showError(newErrorEl, result.error || 'Failed to set username');
            }
        } catch (err) {
            console.error("❌ Set Username Error:", err);
            showError(newErrorEl, 'Server error. Please try again.');
        } finally {
            newBtn.disabled = false;
            newBtn.textContent = 'Continue';
        }
    };
}

// ─── Logout ─────────────────────────────────────────────────────
async function logout() {
    console.log('🚪 Logging out...');

    localStorage.removeItem('psyc_orgId');
    localStorage.removeItem('psyc_username');
    localStorage.removeItem('psyc_orgName');

    try {
        if (typeof socket !== 'undefined' && socket) {
            socket.disconnect();
        }
    } catch (e) {
        console.warn('Socket disconnect failed:', e);
    }

    try {
        await auth.signOut();
    } catch (e) {
        console.warn('Firebase signout failed:', e);
    }

    window.location.replace('/');
}

// ─── Error Messages ─────────────────────────────────────────────
function getErrorMessage(code) {
    const map = {
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/email-already-in-use': 'This email is already registered.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/popup-closed-by-user': 'Sign-in popup was closed.',
        'auth/cancelled-popup-request': 'Sign-in was cancelled.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
    };
    return map[code] || 'An unexpected error occurred. Please try again.';
}

// ─── Back to Login (Logout) ─────────────────────────────────────
const backToLoginCreate = document.getElementById('back-to-login-create');
const backToLoginJoin = document.getElementById('back-to-login-join');

const goBackToLogin = () => {
    logout();
};

if (backToLoginCreate) backToLoginCreate.addEventListener('click', goBackToLogin);
if (backToLoginJoin) backToLoginJoin.addEventListener('click', goBackToLogin);
