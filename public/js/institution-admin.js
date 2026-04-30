// institution-admin.js

const IA_SERVER = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? window.location.origin
  : 'https://alwan-railway-server-production.up.railway.app';

let iaCurrentUser = null;
let iaInstitutionId = null;
let iaInstitutionSlug = null;

function showScreen(screen) {
  document.getElementById('ia-auth-screen').style.display = screen === 'auth' ? 'flex' : 'none';
  document.getElementById('ia-panel').style.display = screen === 'panel' ? 'flex' : 'none';
}

function showAuthError(msg) {
  const el = document.getElementById('ia-auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function authTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('ia-login-form').style.display = isLogin ? 'block' : 'none';
  document.getElementById('ia-register-form').style.display = isLogin ? 'none' : 'block';
  document.getElementById('tab-login-btn').style.background = isLogin ? '#fff' : 'transparent';
  document.getElementById('tab-login-btn').style.color = isLogin ? '#0ea5e9' : '#94a3b8';
  document.getElementById('tab-register-btn').style.background = isLogin ? 'transparent' : '#fff';
  document.getElementById('tab-register-btn').style.color = isLogin ? '#94a3b8' : '#0ea5e9';
  document.getElementById('ia-auth-error').style.display = 'none';
}

async function iaLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  if (!email || !password) { showAuthError('Enter your email and password.'); return; }
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Sign In';
    const msgs = {
      'auth/user-not-found': 'No account found.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/invalid-credential': 'Invalid email or password.',
      'auth/too-many-requests': 'Too many attempts. Try again later.'
    };
    showAuthError(msgs[err.code] || err.message);
  }
}

async function iaRegister() {
  const institution = document.getElementById('reg-institution').value;
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;
  const btn = document.getElementById('register-btn');
  if (!institution) { showAuthError('Please select your institution.'); return; }
  if (!email || !email.includes('@')) { showAuthError('Please enter a valid email.'); return; }
  if (password.length < 8) { showAuthError('Password must be at least 8 characters.'); return; }
  if (password !== confirm) { showAuthError('Passwords do not match.'); return; }
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  try {
    const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    const token = await cred.user.getIdToken();
    const res = await fetch(IA_SERVER + '/api/institution-admin/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ email, institutionSlug: institution })
    });
    const data = await res.json();
    if (!res.ok) {
      await cred.user.delete();
      showAuthError(data.error || 'Registration failed.');
      btn.disabled = false;
      btn.textContent = 'Create Account';
      return;
    }
    await firebase.auth().signOut();
    document.getElementById('ia-register-form').innerHTML =
      '<div style="text-align:center;padding:20px 0;">' +
      '<div style="font-size:2.5rem;margin-bottom:12px;">✅</div>' +
      '<h3 style="font-size:1rem;font-weight:800;color:#0f172a;margin-bottom:8px;">Account Created</h3>' +
      '<p style="font-size:0.85rem;color:#64748b;line-height:1.6;">Your account has been submitted for review.<br>You will be notified once approved.</p>' +
      '</div>';
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    const msgs = {
      'auth/email-already-in-use': 'This email is already registered.',
      'auth/weak-password': 'Password is too weak.'
    };
    showAuthError(msgs[err.code] || err.message);
  }
}

function iaLogout() {
  firebase.auth().signOut().then(function() { window.location.reload(); });
}

function iaTab(name) {
  document.querySelectorAll('.ia-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.ia-nav-item').forEach(function(n) { n.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
}

function iaToast(msg, type) {
  var el = document.getElementById('ia-toast');
  el.textContent = msg;
  el.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#1e293b';
  el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); }, 3000);
}

var confirmCallback = null;
function showConfirm(text, onConfirm) {
  document.getElementById('ia-confirm-text').textContent = text;
  document.getElementById('ia-confirm-modal').classList.remove('hidden');
  confirmCallback = onConfirm;
  document.getElementById('ia-confirm-yes').onclick = function() {
    closeConfirm();
    if (confirmCallback) confirmCallback();
  };
}
function closeConfirm() {
  document.getElementById('ia-confirm-modal').classList.add('hidden');
  confirmCallback = null;
}

async function getToken() {
  if (!iaCurrentUser) return null;
  return await iaCurrentUser.getIdToken();
}

async function loadOverview() {
  if (!iaInstitutionId) return;
  try {
    var token = await getToken();
    var res = await fetch(IA_SERVER + '/api/institution-admin/overview?institutionId=' + iaInstitutionId, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('Failed');
    var data = await res.json();
    document.getElementById('stat-supervisors').textContent = data.supervisorCount != null ? data.supervisorCount : 0;
    document.getElementById('stat-groups').textContent = data.groupCount != null ? data.groupCount : 0;
    document.getElementById('stat-members').textContent = data.memberCount != null ? data.memberCount : 0;
    renderOverviewGroups(data.groups || []);
  } catch (err) {
    console.error('Overview error:', err);
  }
}

function renderOverviewGroups(groups) {
  var el = document.getElementById('overview-groups-list');
  if (!groups.length) { el.innerHTML = '<div class="ia-empty">No groups yet.</div>'; return; }
  el.innerHTML = groups.map(function(g) {
    return '<div class="ia-group-row">' +
      '<div class="ia-group-icon"><i class="bi bi-people-fill"></i></div>' +
      '<div class="ia-group-info">' +
        '<div class="ia-group-name">' + escHtml(g.name) + '</div>' +
        '<div class="ia-group-meta">Supervisor: ' + escHtml(g.supervisorName || 'Unknown') + '</div>' +
      '</div>' +
      '<div class="ia-group-count">' +
        '<div class="ia-group-count-num">' + (g.memberCount || 0) + '</div>' +
        '<div class="ia-group-count-label">Members</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function loadSupervisors() {
  if (!iaInstitutionId) return;
  try {
    var token = await getToken();
    var res = await fetch(IA_SERVER + '/api/institution-admin/supervisors?institutionId=' + iaInstitutionId, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('Failed');
    var data = await res.json();
    document.getElementById('sup-count-badge').textContent = data.supervisors ? data.supervisors.length : 0;
    renderSupervisors(data.supervisors || []);
  } catch (err) {
    console.error('Supervisors error:', err);
  }
}

function renderSupervisors(supervisors) {
  var el = document.getElementById('supervisors-list');
  if (!supervisors.length) { el.innerHTML = '<div class="ia-empty">No supervisors registered yet.</div>'; return; }
  el.innerHTML = supervisors.map(function(s) {
    var initial = (s.name || s.email || '?').charAt(0).toUpperCase();
    var isActive = s.isActive !== false;
    return '<div class="ia-sup-row">' +
      '<div class="ia-sup-avatar">' + initial + '</div>' +
      '<div class="ia-sup-info">' +
        '<div class="ia-sup-name">' + escHtml(s.name || '—') + '</div>' +
        '<div class="ia-sup-email">' + escHtml(s.email) + '</div>' +
      '</div>' +
      '<span class="ia-sup-status ' + (isActive ? 'active' : 'revoked') + '">' + (isActive ? 'Active' : 'Revoked') + '</span>' +
      '<div class="ia-sup-actions">' +
        (isActive
          ? '<button class="ia-icon-btn revoke" title="Revoke" onclick="revokeSupervisor(\'' + s._id + '\',\'' + escHtml(s.email) + '\')"><i class="bi bi-slash-circle-fill"></i></button>'
          : '<button class="ia-icon-btn restore" title="Restore" onclick="restoreSupervisor(\'' + s._id + '\')"><i class="bi bi-check-circle-fill"></i></button>'
        ) +
      '</div>' +
    '</div>';
  }).join('');
}

async function addSupervisor() {
  var name = document.getElementById('new-sup-name').value.trim();
  var email = document.getElementById('new-sup-email').value.trim().toLowerCase();
  var errorEl = document.getElementById('add-sup-error');
  errorEl.classList.add('hidden');
  if (!email || !email.includes('@')) {
    errorEl.textContent = 'Please enter a valid email address.';
    errorEl.classList.remove('hidden');
    return;
  }
  try {
    var token = await getToken();
    var res = await fetch(IA_SERVER + '/api/institution-admin/supervisors/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name: name, email: email, institutionId: iaInstitutionId })
    });
    var data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Failed to add supervisor.';
      errorEl.classList.remove('hidden');
      return;
    }
    document.getElementById('new-sup-name').value = '';
    document.getElementById('new-sup-email').value = '';
    iaToast('Supervisor added!', 'success');
    loadSupervisors();
    loadOverview();
  } catch (err) {
    errorEl.textContent = 'Server error. Please try again.';
    errorEl.classList.remove('hidden');
  }
}

function revokeSupervisor(id, email) {
  showConfirm('Revoke access for ' + email + '?', async function() {
    var token = await getToken();
    var res = await fetch(IA_SERVER + '/api/institution-admin/supervisors/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ supervisorId: id })
    });
    if (res.ok) { iaToast('Access revoked.', 'info'); loadSupervisors(); }
    else iaToast('Failed to revoke.', 'error');
  });
}

async function restoreSupervisor(id) {
  var token = await getToken();
  var res = await fetch(IA_SERVER + '/api/institution-admin/supervisors/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ supervisorId: id })
  });
  if (res.ok) { iaToast('Access restored!', 'success'); loadSupervisors(); }
  else iaToast('Failed to restore.', 'error');
}

async function loadGroups() {
  if (!iaInstitutionId) return;
  try {
    var token = await getToken();
    var res = await fetch(IA_SERVER + '/api/institution-admin/groups?institutionId=' + iaInstitutionId, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('Failed');
    var data = await res.json();
    document.getElementById('groups-count-badge').textContent = data.groups ? data.groups.length : 0;
    renderGroups(data.groups || []);
  } catch (err) {
    console.error('Groups error:', err);
  }
}

function renderGroups(groups) {
  var el = document.getElementById('groups-list');
  if (!groups.length) { el.innerHTML = '<div class="ia-empty">No groups found.</div>'; return; }
  el.innerHTML = groups.map(function(g) {
    return '<div class="ia-group-row">' +
      '<div class="ia-group-icon"><i class="bi bi-people-fill"></i></div>' +
      '<div class="ia-group-info">' +
        '<div class="ia-group-name">' + escHtml(g.name) + '</div>' +
        '<div class="ia-group-meta">Supervisor: ' + escHtml(g.supervisorName || 'Unknown') + '</div>' +
      '</div>' +
      '<div class="ia-group-count">' +
        '<div class="ia-group-count-num">' + (g.memberCount || 0) + '</div>' +
        '<div class="ia-group-count-label">Members</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Auth state listener — runs last
firebase.auth().onAuthStateChanged(async function(user) {
  if (!user) {
    showScreen('auth');
    return;
  }
  iaCurrentUser = user;
  var tokenResult = await user.getIdTokenResult(true);
  var claims = tokenResult.claims;
  if (claims.role !== 'institution_admin') {
    showScreen('auth');
    showAuthError('Access denied. Not an institution admin.');
    await firebase.auth().signOut();
    return;
  }
  iaInstitutionId = claims.institutionId;
  iaInstitutionSlug = claims.institutionSlug;
  showScreen('panel');
  document.getElementById('ia-admin-email').textContent = user.email;
  document.getElementById('ia-inst-name').textContent =
    iaInstitutionSlug === 'bulsu' ? 'BulSU Guidance' :
    iaInstitutionSlug === 'tpycr' ? 'TPYCR' :
    (iaInstitutionSlug || 'Institution').toUpperCase();
  loadOverview();
  loadSupervisors();
  loadGroups();
});
