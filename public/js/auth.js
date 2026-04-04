// ─── Auth Module ────────────────────────────────────────────────

// DOM elements
const googleLoginBtn = document.getElementById('google-login-btn');
const facebookLoginBtn = document.getElementById('facebook-login-btn');
const authError = document.getElementById('auth-error');

// ─── iOS / Safari Detection ─────────────────────────────────────
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Detect if running inside a WebView (in-app browser) — Google blocks sign-in here
function isWebView() {
    const ua = navigator.userAgent;
    return /FBAN|FBAV|Instagram|Twitter|Line|MicroMessenger|GSA/.test(ua) ||
        (isIOS() && !/Safari\//.test(ua) && /AppleWebKit/.test(ua));
}

// Only use redirect for Capacitor native app — NOT for iOS Safari web
// (redirect causes Error 403 disallowed_useragent on iOS WebView)
function shouldUseRedirect() {
    return window.Capacitor !== undefined;
}

// ─── Storage helpers (iOS Private Mode safe) ────────────────────
function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {
        try { sessionStorage.setItem(key, value); } catch (_) { }
    }
}

function storageGet(key) {
    try {
        const v = localStorage.getItem(key);
        if (v !== null) return v;
    } catch (e) { }
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
}

function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { }
    try { sessionStorage.removeItem(key); } catch (_) { }
}

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
    // Google blocks sign-in inside in-app browsers (Instagram, Facebook, etc.)
    if (isWebView()) {
        showError(authError, 'Please open this app in Safari to sign in with Google.');
        return;
    }

    try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

        if (shouldUseRedirect()) {
            // Capacitor native app only
            storageSet('psyc_pending_redirect', '1');
            await auth.signInWithRedirect(provider);
        } else {
            // Web (including iOS Safari) — use popup
            const result = await auth.signInWithPopup(provider);
            // On iOS Safari, onAuthStateChanged may be slow to fire after popup.
            // Manually trigger the post-login flow if we have a user.
            if (result && result.user) {
                await handlePostLogin(result.user);
            }
        }
    } catch (err) {
        console.error('Login error:', err);
        storageRemove('psyc_pending_redirect');
        showError(authError, getErrorMessage(err.code));
    }
}

// ─── Post-Login Handler ─────────────────────────────────────────
// Called directly after popup resolves (iOS Safari fix) and also by onAuthStateChanged
async function handlePostLogin(user) {
    if (isCheckingAuth) return;
    isCheckingAuth = true;
    const isIndexPage = _isIndexPage();

    try {
        const token = await user.getIdToken();
        const res = await fetch(SERVER_URL + `/api/user/verify-org?t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            console.warn('verify-org failed with status', res.status);
            if (res.status === 401) {
                await auth.signOut();
                window.location.href = '/';
                return;
            }
            if (isIndexPage) {
                showSection('org-setup');
                if (typeof window._hideLoader === 'function') window._hideLoader();
            }
            return;
        }

        const data = await res.json();

        console.log(`🔑 [AUTH] uid: ${user.uid} | hasUser: ${data.hasUsername} | orgId: ${data.orgId}`);

        const cachedUsername = storageGet('psyc_username');
        const effectiveHasUsername = data && (data.hasUsername || !!cachedUsername);

        // 1. Username Check
        if (data && !effectiveHasUsername) {
            if (!isIndexPage) {
                window.location.href = '/';
                return;
            }
            showSection('username-setup');
            if (typeof window._hideLoader === 'function') window._hideLoader();
            setupUsernameForm(token, data.orgId);
            return;
        }

        // 2. Organization Check
        if (data && data.orgId) {
            storageSet('psyc_orgId', data.orgId);
            if (isIndexPage) {
                console.log('🚀 Everything ready. Going to dashboard...');
                window.location.href = '/dashboard.html';
            }
            return;
        }

        // 3. Fallback: Org Setup
        if (isIndexPage) {
            // Store supervisor status from verify-org (optimized)
            storageSet('psyc_is_supervisor', data.isSupervisor ? '1' : '0');
            if (data.isSupervisor) {
                storageSet('psyc_sup_email', data.user?.email || '');
                storageSet('psyc_institution_id', data.institutionId || '');
            }

            // Trigger UI update immediately
            if (typeof window.gateOrgSetup === 'function') {
                window.gateOrgSetup();
            }

            showSection('org-setup');
            if (typeof window._hideLoader === 'function') window._hideLoader();
        }
    } catch (err) {
        console.error('❌ Auth Verification Error:', err);
        if (_isIndexPage()) showSection('org-setup');
    } finally {
        isCheckingAuth = false;
        if (typeof window._hideLoader === 'function') window._hideLoader();
    }
}

function _isIndexPage() {
    return window.location.pathname === '/' ||
        window.location.pathname.endsWith('/') ||
        window.location.pathname.includes('index.html');
}

// ─── Handle Redirect Result (iOS / Safari / Capacitor) ──────────
// Must run before onAuthStateChanged fires
(async function handleRedirectResult() {
    const pending = storageGet('psyc_pending_redirect');
    if (!pending && !shouldUseRedirect()) return;

    try {
        const result = await auth.getRedirectResult();
        if (result && result.user) {
            console.log('✅ Redirect sign-in successful:', result.user.uid);
        }
    } catch (err) {
        console.error('Redirect result error:', err);
        showError(authError, getErrorMessage(err.code));
    } finally {
        storageRemove('psyc_pending_redirect');
    }
})();

// ─── Username / Password Auth ────────────────────────────────────
async function loginWithEmail() {
    const usernameInput = document.getElementById('login-email');
    const username = usernameInput?.value.trim().toLowerCase();
    const password = document.getElementById('login-password')?.value;
    const btn = document.getElementById('email-login-btn');

    if (!username || !password) {
        showError(authError, 'Please enter your username and password.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
        // Step 1: Look up username → get synthetic email
        const res = await fetch(SERVER_URL + '/api/auth/lookup-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        const data = await res.json();
        if (!res.ok) {
            showError(authError, data.error || 'Username not found.');
            btn.disabled = false;
            btn.textContent = 'Sign In';
            return;
        }

        // Step 2: Sign in with Firebase using synthetic email
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        await auth.signInWithEmailAndPassword(data.email, password);
        // onAuthStateChanged handles the rest

    } catch (err) {
        console.error('Login error:', err);
        showError(authError, getErrorMessage(err.code));
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}

async function registerWithEmail() {
    const usernameInput = document.getElementById('register-email');
    const username = usernameInput?.value.trim().toLowerCase();
    const password = document.getElementById('register-password')?.value;
    const confirm = document.getElementById('register-confirm')?.value;
    const btn = document.getElementById('email-register-btn');

    if (!username || !password || !confirm) {
        showError(authError, 'Please fill in all fields.');
        return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        showError(authError, 'Username: 3-20 chars, letters/numbers/underscores only.');
        return;
    }
    if (password !== confirm) {
        showError(authError, 'Passwords do not match.');
        return;
    }
    if (password.length < 6) {
        showError(authError, 'Password must be at least 6 characters.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
        // Get reCAPTCHA v3 token
        let recaptchaToken = '';
        try {
            recaptchaToken = await grecaptcha.execute('6LcDPJ0sAAAAAKDfME28LPgk87GB-bczlQ2tTXD7', { action: 'register' });
        } catch (e) {
            console.warn('reCAPTCHA failed, proceeding without it:', e);
        }

        // Register via server (creates Firebase user + MongoDB record)
        const res = await fetch(SERVER_URL + '/api/auth/register-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, recaptchaToken })
        });

        const data = await res.json();
        if (!res.ok) {
            showError(authError, data.error || 'Registration failed.');
            btn.disabled = false;
            btn.textContent = 'Create Account';
            return;
        }

        // Sign in immediately after registration
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        await auth.signInWithEmailAndPassword(data.email, password);
        // onAuthStateChanged handles the rest

    } catch (err) {
        console.error('Register error:', err);
        showError(authError, getErrorMessage(err.code));
        btn.disabled = false;
        btn.textContent = 'Create Account';
    }
}

// ─── Button Listeners ───────────────────────────────────────────
if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');
        loginWithProvider(provider);
    });
}

if (facebookLoginBtn) {
    facebookLoginBtn.addEventListener('click', () => {
        const provider = new firebase.auth.FacebookAuthProvider();
        loginWithProvider(provider);
    });
}

// ─── Auth State Listener ────────────────────────────────────────
let isCheckingAuth = false;
auth.onAuthStateChanged(async (user) => {
    if (user) {
        await handlePostLogin(user);
    } else {
        if (typeof window._hideLoader === 'function') window._hideLoader();
        storageRemove('psyc_orgId');
        storageRemove('psyc_is_supervisor');
        const isProtectedPage = window.location.pathname.includes('dashboard.html') ||
            window.location.pathname.includes('entry.html');
        if (isProtectedPage || (!window.location.pathname.includes('index.html') && window.location.pathname !== '/')) {
            window.location.href = '/';
        } else {
            showSection('auth-section');
            if (typeof window._hideLoader === 'function') window._hideLoader();
        }
    }
});

// ─── Section Switcher ───────────────────────────────────────────
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

// ─── Username Form ──────────────────────────────────────────────
function setupUsernameForm(token, existingOrgId = null) {
    const form = document.getElementById('username-form');
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
                storageSet('psyc_username', username);
                if (existingOrgId) {
                    storageSet('psyc_orgId', existingOrgId);
                    window.location.href = '/dashboard.html?v=' + Date.now();
                } else {
                    window.location.href = '/?username=success&v=' + Date.now();
                }
            } else {
                showError(newErrorEl, result.error || 'Failed to set username');
            }
        } catch (err) {
            console.error('❌ Set Username Error:', err);
            showError(newErrorEl, 'Server error. Please try again.');
        } finally {
            newBtn.disabled = false;
            newBtn.textContent = 'Continue';
        }
    };
}

// ─── Logout ─────────────────────────────────────────────────────
async function logout() {
    storageRemove('psyc_orgId');
    storageRemove('psyc_username');
    storageRemove('psyc_orgName');
    storageRemove('psyc_pending_redirect');

    try {
        if (typeof socket !== 'undefined' && socket) socket.disconnect();
    } catch (e) { }

    try {
        await auth.signOut();
    } catch (e) { }

    window.location.replace('/?v=' + Date.now());
}

// ─── Error Messages ─────────────────────────────────────────────
function getErrorMessage(code) {
    const map = {
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/invalid-credential': 'Incorrect email or password.',
        'auth/email-already-in-use': 'This email is already registered.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/too-many-requests': 'Too many attempts. Please try again later.',
        'auth/popup-closed-by-user': 'Sign-in was cancelled.',
        'auth/cancelled-popup-request': 'Sign-in was cancelled.',
        'auth/popup-blocked': 'Popup was blocked. Please allow popups or try again.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
        'auth/web-storage-unsupported': 'Please enable cookies/storage in your browser settings.',
        'auth/operation-not-supported-in-this-environment': 'Auth not supported in this browser. Try opening in Safari.',
    };
    return map[code] || 'An unexpected error occurred. Please try again.';
}

// ─── Back to Login ───────────────────────────────────────────────
const backToLoginCreate = document.getElementById('back-to-login-create');
const backToLoginJoin = document.getElementById('back-to-login-join');

const goBackToLogin = () => logout();

if (backToLoginCreate) backToLoginCreate.addEventListener('click', goBackToLogin);
if (backToLoginJoin) backToLoginJoin.addEventListener('click', goBackToLogin);
