// ─── Admin Panel Functions ──────────────────────────────────────

let membersCanInvite = false;
let memberInviteCode = '';

// ─── Change Group Name ───────────────────────────────────────────
async function changeGroupName() {
    const input = document.getElementById('change-group-name-input');
    const btn = document.getElementById('change-group-name-btn');
    const errorEl = document.getElementById('change-group-name-error');

    const name = input.value.trim();
    errorEl.style.display = 'none';

    if (name.length < 2) {
        errorEl.textContent = 'Group name must be at least 2 characters.';
        errorEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/org/update-name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name })
        });

        const data = await res.json();
        if (res.ok) {
            // Update UI everywhere
            storageSet('psyc_orgName', name);
            const orgNameEl = document.getElementById('org-name');
            if (orgNameEl) orgNameEl.textContent = name;
            if (typeof updateTeamHeader === 'function') updateTeamHeader();
            if (typeof showToast === 'function') showToast('Group name updated!', '✅');
            btn.textContent = 'Saved!';
            setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
        } else {
            errorEl.textContent = data.error || 'Failed to update group name.';
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
window.changeGroupName = changeGroupName;

// Toggle Consistency Intervals Section
function toggleConsistencyIntervals() {
    const content = document.getElementById('team-streak-pixels');
    const icon = document.getElementById('consistency-toggle-icon');

    if (content && icon) {
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.classList.remove('bi-chevron-right');
            icon.classList.add('bi-chevron-down');
            icon.style.transform = 'rotate(0deg)';
        } else {
            content.style.display = 'none';
            icon.classList.remove('bi-chevron-down');
            icon.classList.add('bi-chevron-right');
            icon.style.transform = 'rotate(0deg)';
        }
    }
}

// Toggle Member Breakdown Section
function toggleMemberBreakdown() {
    const content = document.getElementById('member-stats-list');
    const icon = document.getElementById('breakdown-toggle-icon');

    if (content && icon) {
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.classList.remove('bi-chevron-right');
            icon.classList.add('bi-chevron-down');
            icon.style.transform = 'rotate(0deg)';
        } else {
            content.style.display = 'none';
            icon.classList.remove('bi-chevron-down');
            icon.classList.add('bi-chevron-right');
            icon.style.transform = 'rotate(0deg)';
        }
    }
}

// Open Admin Panel
function openAdminPanel() {
    console.log('openAdminPanel called');
    const modal = document.getElementById('admin-panel-modal');
    console.log('Modal element:', modal);

    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        console.log('Modal opened, classes:', modal.className);

        // Load settings after modal is visible
        setTimeout(() => {
            loadAdminSettings();
        }, 100);
    } else {
        console.error('Admin panel modal not found!');
    }
}

// Close Admin Panel
function closeAdminPanel() {
    const modal = document.getElementById('admin-panel-modal');
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

// Load Admin Settings
async function loadAdminSettings() {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/org/settings', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();

            // Update org code display
            const orgCodeEl = document.getElementById('admin-org-code');
            if (orgCodeEl && data.orgCode) {
                orgCodeEl.textContent = data.orgCode;
            }

            // Pre-fill group name input
            const groupNameInput = document.getElementById('change-group-name-input');
            if (groupNameInput && data.orgName) {
                groupNameInput.value = data.orgName;
            }

            // Update members can invite toggle
            membersCanInvite = data.membersCanInvite || false;
            const toggle = document.getElementById('members-can-invite-toggle');
            if (toggle) {
                toggle.checked = membersCanInvite;
            }

            // Update member invite code
            memberInviteCode = data.memberInviteCode || '';
            updateMemberInviteSection();
        } else {
            console.error('Failed to load org settings, status:', res.status);
        }
    } catch (err) {
        console.error('Error loading admin settings:', err);
    }
}

// Copy Admin Code
function copyAdminCode() {
    const codeEl = document.getElementById('admin-org-code');
    console.log('Copy button clicked, element:', codeEl);

    if (!codeEl) {
        console.error('Code element not found');
        showToast('Error: Code element not found', '⚠️');
        return;
    }

    const code = codeEl.textContent.trim();
    console.log('Code to copy:', code);

    if (!code || code === '------') {
        console.warn('No valid code to copy');
        showToast('No code available to copy', '⚠️');
        return;
    }

    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code)
            .then(() => {
                console.log('Code copied successfully');
                showToast('Admin code copied!', '📋');
            })
            .catch(err => {
                console.error('Clipboard API failed:', err);
                // Fallback to old method
                fallbackCopy(code);
            });
    } else {
        // Fallback for older browsers
        fallbackCopy(code);
    }
}

// Fallback copy method
function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            console.log('Fallback copy successful');
            showToast('Admin code copied!', '📋');
        } else {
            console.error('Fallback copy failed');
            showToast('Failed to copy code', '⚠️');
        }
    } catch (err) {
        console.error('Fallback copy error:', err);
        showToast('Failed to copy code', '⚠️');
    } finally {
        document.body.removeChild(textarea);
    }
}

// Copy Member Invite Code
function copyMemberInviteCode() {
    const codeEl = document.getElementById('member-invite-code');
    console.log('Copy member code clicked, element:', codeEl);

    if (!codeEl) {
        console.error('Member code element not found');
        showToast('Error: Code element not found', '⚠️');
        return;
    }

    const code = codeEl.textContent.trim();
    console.log('Member code to copy:', code);

    if (!code || code === '------') {
        console.warn('No valid member code to copy');
        showToast('No code available to copy', '⚠️');
        return;
    }

    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code)
            .then(() => {
                console.log('Member code copied successfully');
                showToast('Group code copied!', '📋');
            })
            .catch(err => {
                console.error('Clipboard API failed:', err);
                fallbackCopy(code);
            });
    } else {
        fallbackCopy(code);
    }
}

// Toggle Members Can Invite
async function toggleMembersCanInvite(enabled) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/org/settings/members-can-invite', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled })
        });

        if (res.ok) {
            const data = await res.json();
            membersCanInvite = enabled;
            memberInviteCode = data.memberInviteCode || '';
            updateMemberInviteSection();
            showToast(enabled ? 'Members can now invite others' : 'Member invites disabled', '✓');
        } else {
            showToast('Failed to update setting', '⚠️');
            // Revert toggle
            const toggle = document.getElementById('members-can-invite-toggle');
            if (toggle) toggle.checked = !enabled;
        }
    } catch (err) {
        console.error('Error toggling members can invite:', err);
        showToast('Error updating setting', '⚠️');
    }
}

// Update Member Invite Section Visibility
function updateMemberInviteSection() {
    const section = document.getElementById('member-invite-section');
    const codeEl = document.getElementById('member-invite-code');

    if (section && codeEl) {
        if (membersCanInvite && memberInviteCode) {
            section.classList.remove('hidden');
            codeEl.textContent = memberInviteCode;
        } else {
            section.classList.add('hidden');
        }
    }

    // Broadcast to all members via socket if available
    if (socket && socket.connected) {
        socket.emit('org:settings-updated', {
            membersCanInvite: membersCanInvite,
            memberInviteCode: memberInviteCode
        });
    }
}

// Open Manage Members
function openManageMembers() {
    const modal = document.getElementById('manage-members-modal');
    if (modal) {
        renderManageMembers();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

// Close Manage Members
function closeManageMembers() {
    const modal = document.getElementById('manage-members-modal');
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

// Render Manage Members List
function renderManageMembers() {
    const container = document.getElementById('members-list');
    if (!container) return;

    const members = Array.from(membersMap.values());
    const currentUserUid = currentUser?.uid;

    if (members.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">No members found</p>';
        return;
    }

    container.innerHTML = members.map(member => {
        const isCurrentUser = member.uid === currentUserUid;
        const initial = (member.displayName || member.email || '?').charAt(0).toUpperCase();
        const isAdmin = member.role === 'admin' || member.role === 'owner';

        return `
            <div class="member-manage-card">
                <div class="member-manage-avatar"
                     ${member.avatarUrl ? '' : ''}>
                    ${member.avatarUrl
                        ? `<img src="${member.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" alt="">`
                        : initial}
                </div>
                <div class="member-manage-name">
                    ${member.displayName || member.email}
                    ${isCurrentUser ? ' <span style="font-size: 0.8rem; color: #3b82f6;">(You)</span>' : ''}
                </div>
                <div class="member-manage-role">${isAdmin ? 'ADMIN' : 'MEMBER'}</div>
                ${!isCurrentUser ? `
                    <div class="member-manage-actions" style="position: relative;">
                        <button class="btn-member-menu" onclick="toggleMemberMenu('${member.uid}')" style="width:40px;height:40px;background:rgba(100,116,139,0.1);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;"
                            onmouseover="this.style.background='rgba(100,116,139,0.2)'"
                            onmouseout="this.style.background='rgba(100,116,139,0.1)'">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#64748b" style="width:20px;height:20px;">
                                <path fill-rule="evenodd" d="M10.5 6a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm0 6a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm0 6a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" clip-rule="evenodd" />
                            </svg>
                        </button>
                        <div id="menu-${member.uid}" class="member-dropdown-menu" style="display:none;position:absolute;right:0;top:45px;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.15);min-width:180px;z-index:1000;overflow:hidden;">
                            ${!isAdmin ? `
                                <button onclick="makeAdmin('${member.uid}'); toggleMemberMenu('${member.uid}')" style="width:100%;padding:12px 16px;background:white;border:none;text-align:left;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:0.9rem;color:#1e293b;transition:background 0.2s;"
                                    onmouseover="this.style.background='#f1f5f9'"
                                    onmouseout="this.style.background='white'">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f59e0b" style="width:18px;height:18px;">
                                        <path fill-rule="evenodd" d="M12.516 2.17a.75.75 0 00-1.032 0 11.209 11.209 0 01-7.877 3.08.75.75 0 00-.722.515A12.74 12.74 0 002.25 9.75c0 5.942 4.064 10.933 9.563 12.348a.749.749 0 00.374 0c5.499-1.415 9.563-6.406 9.563-12.348 0-1.39-.223-2.73-.635-3.985a.75.75 0 00-.722-.516l-.143.001c-2.996 0-5.717-1.17-7.734-3.08zm3.094 8.016a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" />
                                    </svg>
                                    Make Admin
                                </button>
                            ` : ''}
                            <button onclick="removeMember('${member.uid}', '${(member.displayName || member.email).replace(/'/g, "\\'")}'); toggleMemberMenu('${member.uid}')" style="width:100%;padding:12px 16px;background:white;border:none;text-align:left;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:0.9rem;color:#ef4444;transition:background 0.2s;${isAdmin ? 'opacity:0.5;cursor:not-allowed;' : ''}"
                                ${isAdmin ? 'disabled' : ''}
                                onmouseover="${!isAdmin ? 'this.style.background=\'#fef2f2\'' : ''}"
                                onmouseout="${!isAdmin ? 'this.style.background=\'white\'' : ''}">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;">
                                    <path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 013.878.512.75.75 0 11-.256 1.478l-.209-.035-1.005 13.07a3 3 0 01-2.991 2.77H8.084a3 3 0 01-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 01-.256-1.478A48.567 48.567 0 017.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 013.369 0c1.603.051 2.815 1.387 2.815 2.951zm-6.136-1.452a51.196 51.196 0 013.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 00-6 0v-.113c0-.794.609-1.428 1.364-1.452zm-.355 5.945a.75.75 0 10-1.5.058l.347 9a.75.75 0 101.499-.058l-.346-9zm5.48.058a.75.75 0 10-1.498-.058l-.347 9a.75.75 0 001.5.058l.345-9z" clip-rule="evenodd" />
                                </svg>
                                Remove Member
                            </button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Make Member Admin
async function makeAdmin(uid) {
    if (!confirm('Make this member an admin?')) return;

    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/org/make-admin', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uid })
        });

        if (res.ok) {
            showToast('Member promoted to admin', '✓');
            // Update local member data
            const member = membersMap.get(uid);
            if (member) {
                member.role = 'admin';
                renderManageMembers();
                renderTeamGrid();
            }
        } else {
            showToast('Failed to make admin', '⚠️');
        }
    } catch (err) {
        console.error('Error making admin:', err);
        showToast('Error making admin', '⚠️');
    }
}

// Remove Member
async function removeMember(uid, name) {
    if (!confirm(`Remove ${name} from the organization?`)) return;

    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/org/remove-member', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uid })
        });

        if (res.ok) {
            showToast('Member removed', '✓');
            // Remove from local map
            membersMap.delete(uid);
            renderManageMembers();
            renderTeamGrid();
        } else {
            showToast('Failed to remove member', '⚠️');
        }
    } catch (err) {
        console.error('Error removing member:', err);
        showToast('Error removing member', '⚠️');
    }
}

// Toggle member dropdown menu
function toggleMemberMenu(uid) {
    const menu = document.getElementById(`menu-${uid}`);
    if (!menu) return;

    // Close all other menus
    document.querySelectorAll('.member-dropdown-menu').forEach(m => {
        if (m.id !== `menu-${uid}`) {
            m.style.display = 'none';
        }
    });

    // Toggle current menu
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.member-manage-actions')) {
        document.querySelectorAll('.member-dropdown-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    }
});

// Open Team Stats
function openTeamStats() {
    const modal = document.getElementById('team-stats-modal');
    if (modal) {
        // Reset range to 30 days on open
        const rangeSelect = document.getElementById('stats-range-select');
        if (rangeSelect) rangeSelect.value = '30';

        loadTeamStats('30');
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

// Close Team Stats
function closeTeamStats() {
    const modal = document.getElementById('team-stats-modal');
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

// Update Team Stats Range
function updateTeamStatsRange(range) {
    console.log('Updating team stats range to:', range);
    loadTeamStats(range);
}

// Load Team Stats
async function loadTeamStats(range = '30') {
    console.log(`Loading team stats (Range: ${range})...`);

    // Update labels immediately for better UX
    const rangeLabel = document.getElementById('stats-date-range-label');
    const moodLabel = document.getElementById('mood-trend-label');

    let rangeText = `Last ${range} days performance`;
    let trendText = `Daily mood tracking over the past ${range === '7' ? 'week' : (range === 'all' ? 'year' : (range + ' days'))}`;

    if (range === 'all') rangeText = 'All-time performance summary';

    if (rangeLabel) rangeLabel.textContent = rangeText;
    if (moodLabel) moodLabel.textContent = trendText;

    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/api/org/team-stats?range=${range}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            console.log('Team stats data received:', data);

            // Update stat values
            const totalEntriesEl = document.getElementById('total-entries');
            const avgEntriesEl = document.getElementById('avg-entries-per-day');
            const activeMembersEl = document.getElementById('active-members');
            const streakEl = document.getElementById('team-streak');

            if (totalEntriesEl) totalEntriesEl.textContent = data.totalEntries || 0;
            if (avgEntriesEl) avgEntriesEl.textContent = (data.avgEntriesPerDay || 0).toFixed(1);
            if (activeMembersEl) activeMembersEl.textContent = `${data.activeMembers || 0}/${data.totalMembers || 0}`;
            if (streakEl) streakEl.textContent = data.teamStreak || 0;

            // Render member breakdown
            renderMemberStatsBreakdown(data.memberBreakdown || []);

            // Wait a bit for modal to be fully visible (if first load) before rendering charts
            setTimeout(() => {
                renderTeamMoodChart(data.moodData || {});
                renderTeamDistChart(data.moodDistribution || {});
                renderTeamActivityChart(data.topActivities || []);
                renderTeamStreakPixels(data.memberBreakdown || []);
            }, 50);
        } else {
            showToast('Failed to load statistics', '⚠️');
        }
    } catch (err) {
        console.error('Error loading team stats:', err);
        showToast('Error loading team stats', '⚠️');
    }
}

// Render Member Stats Breakdown
function renderMemberStatsBreakdown(memberStats) {
    const container = document.getElementById('member-stats-list');
    if (!container) return;

    if (!memberStats || memberStats.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 30px;">
                <i class="bi bi-inbox" style="font-size: 1.5rem; display: block; margin-bottom: 8px;"></i>
                No member activity found for this period
            </div>`;
        return;
    }

    container.innerHTML = memberStats.map(member => {
        const initial = (member.name || '?').charAt(0).toUpperCase();
        const entryCount = member.entryCount || 0;

        // Color based on mood label
        let moodColor = '#94a3b8'; // gray
        if (member.avgMood === 'Anger') moodColor = '#EF4444'; // red
        else if (member.avgMood === 'Sadness') moodColor = '#60A5FA'; // blue
        else if (member.avgMood === 'Joy') moodColor = '#FACC15'; // yellow
        else if (member.avgMood === 'Disgust') moodColor = '#4ADE80'; // green
        else if (member.avgMood === 'Fear') moodColor = '#A855F7'; // purple

        // Streak dots (last 7 days)
        const streakDots = (member.streak || [null, null, null, null, null, null, null]).map(moodKey => {
            const moodObj = moodKey ? getMoodByKey(moodKey) : null;
            const color = moodObj ? moodObj.color : 'rgba(0,0,0,0.05)';
            return `<div class="streak-dot" style="background: ${color}; width: 8px; height: 8px; border-radius: 2px;" title="${moodObj ? moodObj.label : 'No entry'}"></div>`;
        }).join('');

        return `
            <div class="member-stat-row" style="display: flex; align-items: center; gap: 12px; padding: 14px 4px; border-bottom: 1px solid rgba(0,0,0,0.06);">
                <div class="member-stat-avatar" style="width: 40px; height: 40px; border-radius: 12px; background: #f8fafc; display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--accent-primary); font-size: 1rem; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.05); overflow: hidden;">
                    ${member.avatarUrl ? `<img src="${member.avatarUrl}" style="width: 100%; height: 100%; object-fit: cover;">` : initial}
                </div>
                <div class="member-stat-info" style="flex: 1; min-width: 0;">
                    <div class="member-stat-name" style="font-weight: 700; font-size: 1rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">
                        ${member.name}
                    </div>
                    <div class="member-stat-mood" style="font-size: 0.82rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                        Avg Mood: <span style="font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${moodColor}15; color: ${moodColor}; font-size: 0.75rem; text-transform: uppercase;">${member.avgMood}</span>
                    </div>
                </div>
                <div class="member-stat-count" style="text-align: right; min-width: 60px;">
                    <div style="font-weight: 900; font-size: 1.2rem; color: var(--accent-primary); line-height: 1;">${entryCount}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-top: 2px;">Entries</div>
                </div>
            </div>
        `;
    }).join('');
}

// Render Team Streak Pixels
function renderTeamStreakPixels(memberStats) {
    const container = document.getElementById('team-streak-pixels');
    if (!container) return;

    if (!memberStats || memberStats.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">No activity data available</div>`;
        return;
    }

    let html = memberStats.map(member => {
        return `
            <div class="streak-live-card">
                <div class="streak-name">${member.name}</div>
                <div class="streak-count">${member.streakCount || 0}</div>
            </div>
        `;
    }).join('');

    container.innerHTML = `<div class="streak-live-list">${html}</div>`;
}

// Render Team Mood Chart (7 days)
function renderTeamMoodChart(moodData) {
    console.log('Rendering team mood chart with data:', moodData);

    const canvas = document.getElementById('team-overall-mood-chart');
    if (!canvas) {
        console.error('Canvas element not found: team-overall-mood-chart');
        return;
    }

    const ctx = canvas.getContext('2d');

    // Destroy existing chart if any
    if (window.teamMoodChart) {
        window.teamMoodChart.destroy();
    }

    // Handle empty data
    if (!moodData || Object.keys(moodData).length === 0) {
        console.log('No mood data available');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px Inter';
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'center';
        ctx.fillText('No mood data yet', canvas.width / 2, canvas.height / 2);
        return;
    }

    const dates = Object.keys(moodData).sort();
    console.log('Dates for chart:', dates);

    const datasets = [
        {
            label: 'Anger',
            data: dates.map(d => moodData[d].rad || 0),
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            borderColor: '#EF4444',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        },
        {
            label: 'Sadness',
            data: dates.map(d => moodData[d].good || 0),
            backgroundColor: 'rgba(96, 165, 250, 0.2)',
            borderColor: '#60A5FA',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        },
        {
            label: 'Joy',
            data: dates.map(d => moodData[d].meh || 0),
            backgroundColor: 'rgba(250, 204, 21, 0.2)',
            borderColor: '#FACC15',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        },
        {
            label: 'Disgust',
            data: dates.map(d => moodData[d].bad || 0),
            backgroundColor: 'rgba(74, 222, 128, 0.2)',
            borderColor: '#4ADE80',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        },
        {
            label: 'Fear',
            data: dates.map(d => moodData[d].awful || 0),
            backgroundColor: 'rgba(168, 85, 247, 0.2)',
            borderColor: '#A855F7',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        }
    ];

    window.teamMoodChart = new Chart(ctx, {
        type: 'line',
        data: { labels: dates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: window.innerWidth < 600 ? 'bottom' : 'bottom',
                    labels: {
                        boxWidth: window.innerWidth < 600 ? 10 : 12,
                        padding: window.innerWidth < 600 ? 8 : 12,
                        font: {
                            size: window.innerWidth < 600 ? 10 : 11,
                            family: 'Inter'
                        },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: {
                        size: 13,
                        weight: '600'
                    },
                    bodyFont: {
                        size: 12
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    ticks: {
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });

    console.log('Team mood chart rendered successfully');
}

// Render Team Mood Distribution
function renderTeamDistChart(moodDistribution) {
    console.log('Rendering team distribution chart with data:', moodDistribution);

    const canvas = document.getElementById('team-overall-dist-chart');
    if (!canvas) {
        console.error('Canvas element not found: team-overall-dist-chart');
        return;
    }

    const ctx = canvas.getContext('2d');

    if (window.teamDistChart) {
        window.teamDistChart.destroy();
    }

    const moods = ['rad', 'good', 'meh', 'bad', 'awful'];
    const colors = ['#EF4444', '#60A5FA', '#FACC15', '#4ADE80', '#A855F7'];
    const data = moods.map(m => moodDistribution[m] || 0);

    // Check if all data is zero
    const hasData = data.some(val => val > 0);

    if (!hasData) {
        console.log('No distribution data available');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px Inter';
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'center';
        ctx.fillText('No mood data yet', canvas.width / 2, canvas.height / 2);
        return;
    }

    window.teamDistChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: moods.map(m => m.charAt(0).toUpperCase() + m.slice(1)),
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#fff',
                hoverOffset: 8,
                hoverBorderWidth: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 12,
                        font: {
                            size: 11,
                            family: 'Inter',
                            weight: '500'
                        },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: {
                        size: 13,
                        weight: '600'
                    },
                    bodyFont: {
                        size: 12
                    },
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });

    console.log('Team distribution chart rendered successfully');
}

// Render Team Activity Chart
function renderTeamActivityChart(topActivities) {
    console.log('Rendering team activity chart with data:', topActivities);

    const container = document.getElementById('team-overall-activity-chart');
    if (!container) {
        console.error('Container element not found: team-overall-activity-chart');
        return;
    }

    // Destroy old chart if exists
    if (window.teamActivityChart) {
        window.teamActivityChart.destroy();
        window.teamActivityChart = null;
    }

    if (!topActivities || topActivities.length === 0) {
        console.log('No activity data available');
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #9ca3af;">
                <i class="bi bi-bar-chart" style="font-size: 32px; margin-bottom: 8px; opacity: 0.4;"></i>
                <p style="margin: 0; font-size: 13px;">No activity data yet</p>
            </div>
        `;
        return;
    }

    // Store all activities globally for modal
    window.allTeamActivitiesData = topActivities;

    // Limit to 6 activities
    const displayLimit = 6;
    const displayActivities = topActivities.slice(0, displayLimit);
    const hasMore = topActivities.length > displayLimit;

    // Always show "More >" link if there are activities
    const moreLink = document.getElementById('view-all-team-activities-link');
    if (moreLink) {
        moreLink.style.display = topActivities.length > 0 ? 'flex' : 'none';
    }

    // Also update the modal version if it exists
    const moreLinkModal = document.getElementById('view-all-team-activities-link-modal');
    if (moreLinkModal) {
        moreLinkModal.style.display = topActivities.length > 0 ? 'flex' : 'none';
    }

    // Render pills
    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.gap = '10px';
    container.style.padding = '10px 0';
    container.style.justifyContent = 'flex-start';

    container.innerHTML = displayActivities.map(item => {
        const activityLabel = item.activity;
        const count = item.count;

        return `
            <div style="
                position: relative;
                background: #f1f5f9;
                border: 2px solid #e2e8f0;
                border-radius: 32px;
                padding: 10px 20px;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
                font-weight: 500;
                color: #334155;
                transition: all 0.2s;
                cursor: default;
            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)';" 
               onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
                <span style="color: #64748b;">${activityLabel}</span>
                <span style="
                    background: white;
                    border-radius: 50%;
                    width: 22px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 11px;
                    font-weight: 700;
                    color: #8b5cf6;
                    border: 2px solid #8b5cf6;
                    margin-left: 2px;
                ">${count}</span>
            </div>
        `;
    }).join('');

    console.log('Team activity pills rendered successfully');
}


// Team Activities Modal Functions
function openAllTeamActivitiesModal() {
    const modal = document.getElementById('all-team-activities-modal');
    if (modal) {
        renderAllTeamActivitiesList();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeAllTeamActivitiesModal() {
    const modal = document.getElementById('all-team-activities-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function renderAllTeamActivitiesList() {
    const container = document.getElementById('all-team-activities-list');
    if (!container || !window.allTeamActivitiesData) return;

    const activities = window.allTeamActivitiesData;

    container.innerHTML = activities.map(item => {
        const activityLabel = item.activity;
        const count = item.count;

        return `
            <div style="
                background: #f1f5f9;
                border: 2px solid #e2e8f0;
                border-radius: 16px;
                padding: 16px 20px;
                display: flex;
                align-items: center;
                gap: 12px;
                transition: all 0.2s;
            " onmouseover="this.style.background='#e2e8f0';" 
               onmouseout="this.style.background='#f1f5f9';">
                <div style="flex: 1;">
                    <div style="font-size: 18px; font-weight: 600; color: #334155;">${activityLabel}</div>
                    <div style="font-size: 14px; color: #64748b; margin-top: 2px;">${count} ${count === 1 ? 'entry' : 'entries'}</div>
                </div>
                <span style="
                    background: white;
                    border-radius: 50%;
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    font-weight: 700;
                    color: #8b5cf6;
                    border: 2px solid #8b5cf6;
                ">${count}</span>
            </div>
        `;
    }).join('');
}

// Export modal functions to window
window.openAllTeamActivitiesModal = openAllTeamActivitiesModal;
window.closeAllTeamActivitiesModal = closeAllTeamActivitiesModal;

// ─── SOS Alert Logs (Supervisor Dashboard) ──────────────────────

let sosAlerts = [];

// Fetch SOS Alerts from API
async function loadSOSAlerts() {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(SERVER_URL + '/api/sos/alerts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            sosAlerts = data.alerts || [];
            renderSOSAlerts();

            // renderSOSAlerts handles the visibility of cards based on count
        } else if (res.status === 403) {
            // Not admin, keep home card hidden
            console.log('SOS alerts: Not admin, skipping.');
        }
    } catch (err) {
        console.error('Error loading SOS alerts:', err);
    }
}

// Render SOS Alert Cards (admin panel + home dashboard)
function resolveAlertAvatarUrl(alert) {
    const member = (alert?.userId && typeof membersMap !== 'undefined' && membersMap && membersMap.get)
        ? membersMap.get(alert.userId)
        : null;

    const preferredAvatar = alert?.avatarUrl
        || alert?.userAvatar
        || alert?.profileAvatarUrl
        || member?.avatarUrl
        || member?.profileAvatarUrl
        || member?.profilePic
        || member?.profilePhoto
        || '';

    if (preferredAvatar) return preferredAvatar;

    return alert?.userPhoto || member?.photoURL || alert?.photoURL || '';
}

function renderSOSAlerts() {
    const badge = document.getElementById('sos-alert-badge');
    const homeContainer = document.getElementById('sos-home-alerts');
    const homeBadge = document.getElementById('sos-home-badge');
    const historyContainer = document.getElementById('sos-history-container');
    const homeCard = document.getElementById('sos-home-card');
    const canSeeSOS = (typeof canViewSupervisorFeatures === 'function')
        ? canViewSupervisorFeatures()
        : !!window.isSupervisor;

    if (!canSeeSOS) {
        if (homeCard) {
            homeCard.classList.add('hidden');
            homeCard.style.display = 'none';
        }
        if (homeContainer) homeContainer.innerHTML = '';
        if (homeBadge) {
            homeBadge.style.display = 'none';
            homeBadge.textContent = '';
        }
        return;
    }

    const activeAlerts = sosAlerts.filter(a => a.status === 'active');
    const resolvedAlerts = sosAlerts.filter(a => a.status === 'resolved');
    const activeCount = activeAlerts.length;

    // Update badges
    if (badge) {
        if (activeCount > 0) {
            badge.style.display = 'inline';
            badge.textContent = activeCount;
        } else {
            badge.style.display = 'none';
        }
    }
    // Minimalist home card: keep count badge hidden.
    if (homeBadge) {
        homeBadge.style.display = 'none';
        homeBadge.textContent = '';
    }

    const emptyHtml = `<div style="text-align: center; color: #94a3b8; padding: 24px; font-size: 0.9rem;"><i class="bi bi-shield-check" style="font-size: 2rem; display: block; margin-bottom: 10px; opacity: 0.4;"></i>No active SOS alerts.</div>`;
    const emptyHomeHtml = `
        <style>
            @keyframes sosAlertPulse {
                0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.2); }
                70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
                100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
            }
        </style>
        <div style="text-align: center; color: #94a3b8; padding: 16px; font-size: 0.85rem;"><i class="bi bi-shield-check" style="font-size: 1.4rem; display: block; margin-bottom: 6px; opacity: 0.4;"></i>No active alerts.</div>`;

    function buildAlertCard(alert, compact) {
        const isActive = alert.status === 'active';
        const isDark = document.body.classList.contains('dark-mode');
        const time = new Date(alert.timestamp);
        const timeStr = time.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        const statusBadge = isActive
            ? `<span style="background:${isDark ? 'rgba(239,68,68,0.15)' : '#fef2f2'};color:#ef4444;font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:20px;border:1px solid ${isDark ? 'rgba(239,68,68,0.3)' : '#fecaca'};">ACTIVE</span>`
            : `<span style="background:${isDark ? 'rgba(34,197,94,0.15)' : '#f0fdf4'};color:#22c55e;font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:20px;border:1px solid ${isDark ? 'rgba(34,197,94,0.3)' : '#bbf7d0'};">RESOLVED</span>`;
        const initial = (alert.userName || '?').charAt(0).toUpperCase();
        const avatarUrl = resolveAlertAvatarUrl(alert);
        const sz = compact ? '32px' : '40px';
        const pad = compact ? '8px' : '14px';
        const cardBg = isDark
            ? (isActive ? 'rgba(239,68,68,0.08)' : '#2a2d31')
            : (isActive ? '#fef2f2' : '#fafafa');
        const cardBorder = isDark
            ? (isActive ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)')
            : (isActive ? '#fecaca' : 'rgba(0,0,0,0.06)');
        const nameColor = isDark ? '#f1f5f9' : '#1e293b';

        if (compact) {
            const compactStatusClass = isActive ? 'is-active' : 'is-resolved';
            const avatarMarkup = avatarUrl
                ? `<img src="${avatarUrl}" alt="${alert.userName || 'User'}" class="sos-home-alert-avatar-img">`
                : `<span class="sos-home-alert-avatar-fallback">${initial}</span>`;
            return `<div onclick="openSOSDetailsModal('${alert.id}')" class="sos-home-alert-row ${compactStatusClass}">
                <div class="sos-home-alert-left">
                    <div class="sos-home-alert-avatar">
                        ${avatarMarkup}
                    </div>
                    <div class="sos-home-alert-icon">
                        <i class="bi bi-exclamation-triangle-fill"></i>
                    </div>
                </div>
                <div class="sos-home-alert-content">
                    <div class="sos-home-alert-topline">
                        <span class="sos-home-alert-meta">
                            ${timeStr}
                        </span>
                        <span class="sos-home-alert-pill">${isActive ? 'ACTIVE' : 'RESOLVED'}</span>
                    </div>
                    <div class="sos-home-alert-inline">
                        <span class="sos-home-alert-name">SOS • ${alert.userName || 'Unknown User'}</span>
                        ${alert.message ? `<span class="sos-home-alert-message">"${alert.message}"</span>` : ''}
                    </div>
                </div>
                <button type="button" aria-label="Open SOS alert" class="sos-home-alert-action">
                    <i class="bi bi-chevron-right"></i>
                </button>
            </div>`;
        }

        return `<div onclick="openSOSDetailsModal('${alert.id}')" style="display:flex;align-items:center;gap:${compact ? '10px' : '12px'};padding:${pad};margin-bottom:${compact ? '8px' : '10px'};background:${cardBg};border:1px solid ${cardBorder};border-radius:12px;${isActive ? 'animation:sosAlertPulse 2s infinite;' : ''};cursor:pointer;transition:all 0.2s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(239, 68, 68, 0.1)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';">
            <div style="width:${sz};height:${sz};border-radius:999px;background:${isActive ? '#ef4444' : '#94a3b8'};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${compact ? '0.85rem' : '1rem'};flex-shrink:0;overflow:hidden;">${avatarUrl ? `<img src="${avatarUrl}" style="width:100%;height:100%;border-radius:999px;object-fit:cover;">` : initial}</div>
            <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;font-size:${compact ? '0.88rem' : '0.95rem'};color:${nameColor};">${alert.userName}</span>${statusBadge}</div>
                <div style="font-size:0.76rem;color:#64748b;"><i class="bi bi-clock" style="margin-right:3px;"></i>${timeStr}</div>
            </div>
            <i class="bi bi-chevron-right" style="color:#94a3b8;font-size:0.8rem;"></i>
        </div>`;
    }

    const container = document.getElementById('sos-alerts-container');

    // Admin panel — active alerts only
    if (container) {
        container.innerHTML = activeAlerts.length ? activeAlerts.map(a => buildAlertCard(a, false)).join('') : emptyHtml;
    }

    // Home dashboard — Show only ONE card (the most recent)
    if (homeContainer) {
        if (activeAlerts.length > 0) {
            // Get most recent alert
            const latest = activeAlerts[0];
            homeContainer.innerHTML = buildAlertCard(latest, true);

            // If there's more than one, add a small indicator
            if (activeAlerts.length > 1) {
                homeContainer.innerHTML += `<div onclick="openAdminPanel()" style="text-align:center; font-size:0.68rem; color:#ef4444; font-weight:700; padding:2px; cursor:pointer; opacity:0.8;">+ ${activeAlerts.length - 1} more active alert${activeAlerts.length > 2 ? 's' : ''}. View Manager.</div>`;
            }
            if (homeCard) {
                homeCard.classList.remove('hidden');
                homeCard.style.display = '';
            }
        } else {
            homeContainer.innerHTML = emptyHomeHtml;
            if (homeCard) {
                homeCard.classList.add('hidden');
                homeCard.style.display = 'none';
            }
        }
    }

    // Admin panel — history card toggle
    if (historyContainer) {
        const historyCard = document.getElementById('sos-history-card');
        if (resolvedAlerts.length > 0) {
            historyContainer.innerHTML = '';
            if (historyCard) historyCard.classList.remove('hidden');
        } else {
            if (historyCard) historyCard.classList.add('hidden');
        }
    }

    // Update full history modal if it's open
    const historyModal = document.getElementById('sos-history-modal');
    if (historyModal && historyModal.classList.contains('open')) {
        renderFullSOSHistory();
    }
}

// Resolve an SOS alert
let currentResolveAlertId = null;

async function resolveSOSAlert(alertId) {
    console.log('🔧 resolveSOSAlert called with alertId:', alertId);

    // Store the alert ID for later use
    currentResolveAlertId = alertId;

    // Show resolution modal instead of browser prompt
    const modal = document.getElementById('sos-resolve-modal');
    const textarea = document.getElementById('sos-resolution-note');

    console.log('📦 Modal element:', modal);
    console.log('📝 Textarea element:', textarea);

    if (modal && textarea) {
        console.log('✅ Modal and textarea found, opening modal...');
        textarea.value = ''; // Clear previous input
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        textarea.focus();
    } else {
        console.warn('⚠️ Modal or textarea not found, using fallback prompt');
        // Fallback to browser prompt if modal not found
        const note = prompt('Add a resolution note (optional):') || '';
        await performSOSResolve(alertId, note);
    }
}

function cancelSOSResolve() {
    console.log('❌ cancelSOSResolve called');
    const modal = document.getElementById('sos-resolve-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
    // Don't clear currentResolveAlertId here - only clear after successful resolve
    // This prevents accidental clearing if modal closes unexpectedly
}

async function confirmSOSResolve() {
    console.log('🎯 confirmSOSResolve called');
    console.log('📋 currentResolveAlertId:', currentResolveAlertId);

    const textarea = document.getElementById('sos-resolution-note');
    const note = textarea ? textarea.value.trim() : '';

    console.log('📝 Resolution note:', note);

    // Close modal
    cancelSOSResolve();

    // Perform the resolve action
    if (currentResolveAlertId) {
        console.log('✅ Calling performSOSResolve...');
        await performSOSResolve(currentResolveAlertId, note);
        currentResolveAlertId = null;
    } else {
        console.error('❌ No currentResolveAlertId found!');
    }
}

async function performSOSResolve(alertId, note) {
    console.log('🔧 Attempting to resolve SOS alert:', alertId, 'with note:', note);
    console.log('📋 Current sosAlerts array:', sosAlerts);

    try {
        // Check if auth is available
        if (typeof auth === 'undefined' || !auth || !auth.currentUser) {
            console.error('❌ Auth not available or user not logged in');
            if (typeof ldToast === 'function') ldToast('Please log in to resolve alerts.', 'error');
            else if (typeof showToast === 'function') showToast('Please log in to resolve alerts.', 'error');
            return;
        }

        const token = await auth.currentUser.getIdToken();
        console.log('✅ Got auth token, sending request...');

        const res = await fetch(SERVER_URL + '/api/sos/resolve', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ alertId, note })
        });

        console.log('📡 Response status:', res.status);

        if (res.ok) {
            console.log('✅ SOS alert resolved successfully');
            if (typeof ldToast === 'function') ldToast('SOS alert resolved.', 'success');
            else if (typeof showToast === 'function') showToast('SOS alert resolved.', 'success');

            // Find and update the alert in the local array
            const alert = sosAlerts.find(a => a.id === alertId);
            console.log('🔍 Found alert in local array:', alert);

            if (alert) {
                alert.status = 'resolved';
                alert.resolvedBy = 'You';
                alert.resolvedNote = note;
                console.log('✅ Updated alert status locally');
            } else {
                console.warn('⚠️ Alert not found in local sosAlerts array');
            }

            // Re-render to update the UI
            console.log('🎨 Calling renderSOSAlerts...');
            renderSOSAlerts();
        } else {
            const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
            console.error('❌ Failed to resolve alert:', errorData);
            if (typeof ldToast === 'function') ldToast(`Failed to resolve alert: ${errorData.error}`, 'error');
            else if (typeof showToast === 'function') showToast(`Failed to resolve alert: ${errorData.error}`, 'error');
        }
    } catch (err) {
        console.error('❌ Error resolving SOS alert:', err);
        if (typeof ldToast === 'function') ldToast('Error resolving alert: ' + err.message, 'error');
        else if (typeof showToast === 'function') showToast('Error resolving alert: ' + err.message, 'error');
    }
}

// Make functions globally available
window.resolveSOSAlert = resolveSOSAlert;
window.cancelSOSResolve = cancelSOSResolve;
window.confirmSOSResolve = confirmSOSResolve;
// Full SOS History Modal Functions
function openSOSHistoryModal() {
    const modal = document.getElementById('sos-history-modal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        renderFullSOSHistory();
    }
}

function closeSOSHistoryModal() {
    const modal = document.getElementById('sos-history-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function renderFullSOSHistory() {
    const container = document.getElementById('sos-full-history-list');
    if (!container) return;

    const resolved = sosAlerts.filter(a => a.status === 'resolved');
    const emptyHistoryHtml = `<div style="text-align: center; color: #94a3b8; padding: 40px 24px; font-size: 0.9rem;"><i class="bi bi-clock-history" style="font-size: 2.5rem; display: block; margin-bottom: 12px; opacity: 0.3;"></i>No SOS history found.</div>`;

    if (resolved.length === 0) {
        container.innerHTML = emptyHistoryHtml;
    } else {
        container.innerHTML = resolved.map(alert => {
            const time = new Date(alert.timestamp);
            const timeStr = time.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
            const initial = (alert.userName || '?').charAt(0).toUpperCase();
            const avatarUrl = resolveAlertAvatarUrl(alert);

            return `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px;margin-bottom:10px;background:#fafafa;border:1px solid rgba(0,0,0,0.06);border-radius:10px;">
                <div style="width:40px;height:40px;border-radius:999px;background:#94a3b8;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;overflow:hidden;">${avatarUrl ? `<img src="${avatarUrl}" style="width:100%;height:100%;border-radius:999px;object-fit:cover;">` : initial}</div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;"><span style="font-weight:700;font-size:0.95rem;color:#1e293b;">${alert.userName}</span><span style="background:#f0fdf4;color:#22c55e;font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:20px;border:1px solid #bbf7d0;">RESOLVED</span></div>
                    <div style="font-size:0.78rem;color:#64748b;margin-bottom:6px;"><i class="bi bi-clock" style="margin-right:3px;"></i>${timeStr}</div>
                    ${alert.message ? `<div style="font-size:0.85rem;color:#475569;background:rgba(0,0,0,0.03);padding:6px 10px;border-radius:8px;margin-bottom:8px;">${alert.message}</div>` : ''}
                    <div style="font-size:0.76rem;color:#22c55e;"><i class="bi bi-check-circle-fill" style="margin-right:3px;"></i>Resolved by ${alert.resolvedBy || 'Admin'}${alert.resolvedNote ? ` — "${alert.resolvedNote}"` : ''}</div>
                </div></div>`;
        }).join('');
    }
}


// Listen for real-time SOS alerts via Socket.IO
// SOS Details Modal
function openSOSDetailsModal(alertId) {
    console.log('🆘 Opening details for SOS alert:', alertId);
    const alert = sosAlerts.find(a => a.id === alertId);
    if (!alert) {
        console.error('Alert not found:', alertId);
        return;
    }

    const modal = document.getElementById('sos-details-modal');
    const content = document.getElementById('sos-details-content');

    if (modal && content) {
        const time = new Date(alert.timestamp);
        const timeStr = time.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        const initial = (alert.userName || '?').charAt(0).toUpperCase();
        const avatarUrl = resolveAlertAvatarUrl(alert);

        content.innerHTML = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="width: 80px; height: 80px; border-radius: 999px; background: #ef4444; color: white; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; font-weight: 800; margin: 0 auto 16px; box-shadow: 0 10px 25px rgba(239, 68, 68, 0.3); overflow: hidden;">
                    ${avatarUrl ? `<img src="${avatarUrl}" style="width: 100%; height: 100%; border-radius: 999px; object-fit: cover;">` : initial}
                </div>
                <h3 style="font-size: 1.5rem; font-weight: 800; color: #1e293b; margin: 0;">${alert.userName}</h3>
                <p style="font-size: 0.95rem; color: #64748b; margin: 6px 0 0;"><i class="bi bi-clock" style="margin-right: 4px;"></i>${timeStr}</p>
            </div>

            ${alert.message ? `
                <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 16px; padding: 20px; margin-bottom: 24px; position: relative; animation: sosAlertDetailsPulse 2s infinite;">
                    <style>
                        @keyframes sosAlertDetailsPulse {
                            0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.2); }
                            50% { transform: scale(1.01); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
                            100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                        }
                    </style>
                    <div style="font-size: 0.75rem; font-weight: 800; color: #ef4444; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                        <i class="bi bi-chat-left-dots-fill"></i> User Message
                    </div>
                    <div style="font-size: 1.1rem; color: #991b1b; font-weight: 600; line-height: 1.5;">"${alert.message}"</div>
                </div>
            ` : ''}

            <div style="background: #f8fafc; border-radius: 16px; padding: 20px; margin-bottom: 24px; border: 1px solid rgba(0,0,0,0.04);">
                <div style="font-size: 0.8rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 14px;">Contact Information</div>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${alert.contactPhone ? `
                        <a href="tel:${alert.contactPhone}" style="display: flex; align-items: center; gap: 12px; padding: 14px; background: white; border: 1px solid #e2e8f0; border-radius: 12px; text-decoration: none; color: #1e293b; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.borderColor='#22c55e'; this.style.background='#f0fdf4';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white';">
                            <i class="bi bi-telephone-fill" style="color: #22c55e; font-size: 1.2rem;"></i>
                            <span>${alert.contactPhone}</span>
                            <span style="margin-left: auto; font-size: 0.7rem; color: #22c55e; background: #f0fdf4; padding: 2px 8px; border-radius: 10px;">Call Now</span>
                        </a>
                    ` : ''}
                    ${alert.contactMessenger ? `
                        <a href="${alert.contactMessenger.startsWith('http') ? alert.contactMessenger : 'https://m.me/' + alert.contactMessenger.replace(/^@/, '')}" target="_blank" style="display: flex; align-items: center; gap: 12px; padding: 14px; background: white; border: 1px solid #e2e8f0; border-radius: 12px; text-decoration: none; color: #1e293b; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.borderColor='#0084ff'; this.style.background='#eff6ff';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='white';">
                            <i class="bi bi-messenger" style="color: #0084ff; font-size: 1.2rem;"></i>
                            <span>Message via Messenger</span>
                            <i class="bi bi-box-arrow-up-right" style="margin-left: auto; font-size: 0.9rem; color: #64748b;"></i>
                        </a>
                    ` : ''}
                </div>
            </div>

            <button onclick="resolveSOSAlert('${alert.id}'); closeSOSDetailsModal();" style="width: 100%; padding: 16px; background: #3b82f6; color: white; border: none; border-radius: 16px; font-size: 1rem; font-weight: 700; cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);">
                <i class="bi bi-check2-circle" style="font-size: 1.2rem;"></i>
                Mark as Resolved
            </button>
        `;

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeSOSDetailsModal() {
    const modal = document.getElementById('sos-details-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function initSOSListener() {
    if (typeof socket !== 'undefined' && socket) {
        socket.on('sos:new_alert', (alertData) => {
            console.log('🆘 New SOS alert received:', alertData);

            // Only process for supervisors
            const canSeeSOS = (typeof canViewSupervisorFeatures === 'function')
                ? canViewSupervisorFeatures()
                : !!window.isSupervisor;
            if (!canSeeSOS) return;

            sosAlerts.unshift(alertData);
            renderSOSAlerts();

            // Show home card if hidden
            const homeCard = document.getElementById('sos-home-card');
            if (homeCard) homeCard.classList.remove('hidden');

            // Show urgent toast
            if (typeof showToast === 'function') {
                showToast(`🆘 SOS Alert from ${alertData.userName}!`, 'error');
            }

            // Trigger native notification via Capacitor
            if (window.capacitorNotifications && typeof window.capacitorNotifications.sendSOSNotification === 'function') {
                window.capacitorNotifications.sendSOSNotification(alertData);
            }


            // Play alarm sound if available
            if (typeof alarmSound !== 'undefined') {
                try { alarmSound.play(); } catch (e) { /* ignore autoplay block */ }
            }
            if (typeof playRealtimeAlertSound === 'function') {
                playRealtimeAlertSound();
            } else if (typeof playNotificationSound === 'function') {
                playNotificationSound();
            }
        });

        socket.on('sos:alert_resolved', (data) => {
            const canSeeSOS = (typeof canViewSupervisorFeatures === 'function')
                ? canViewSupervisorFeatures()
                : !!window.isSupervisor;
            if (!canSeeSOS) return;
            const alert = sosAlerts.find(a => a.id === data.alertId);
            if (alert) {
                alert.status = 'resolved';
                alert.resolvedBy = data.resolvedBy || 'Admin';
                renderSOSAlerts();
            }
        });
    }
}

// Auto-load SOS alerts when admin panel opens
const originalOpenAdminPanel = window.openAdminPanel || openAdminPanel;
window.openAdminPanel = function () {
    originalOpenAdminPanel();
    loadSOSAlerts();
};

// Initialize SOS system: real-time listener + auto-load for admins
function initSOSSystem() {
    initSOSListener();

    // Only load SOS alerts for supervisors
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                // Wait briefly for window.isSupervisor to be set by app.js
                setTimeout(() => {
                    const canSeeSOS = (typeof canViewSupervisorFeatures === 'function')
                        ? canViewSupervisorFeatures()
                        : !!window.isSupervisor;
                    if (canSeeSOS) {
                        loadSOSAlerts();
                    }
                }, 2000);
            }
        });
    }
}

// Initialize: wait for socket to be ready, then start SOS system
function waitForSocketAndInit() {
    if (typeof socket !== 'undefined' && socket && socket.connected) {
        initSOSSystem();
    } else {
        // Retry with polling - socket may take time to connect
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if ((typeof socket !== 'undefined' && socket && socket.connected) || attempts > 20) {
                clearInterval(interval);
                initSOSSystem();
            }
        }, 500);
    }
}

// Start after a small delay to let other scripts initialize
setTimeout(waitForSocketAndInit, 1500);

window.loadSOSAlerts = loadSOSAlerts;
window.resolveSOSAlert = resolveSOSAlert;
window.openSOSHistoryModal = openSOSHistoryModal;
window.closeSOSHistoryModal = closeSOSHistoryModal;
window.openSOSDetailsModal = openSOSDetailsModal;
window.closeSOSDetailsModal = closeSOSDetailsModal;

// Export Team Data (PDF Only - Premium Client Side)
async function exportTeamData(format) {
    if (format !== 'pdf') {
        if (typeof ldToast === 'function') ldToast('Only PDF export is supported currently.', 'info');
        return;
    }

    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
        if (typeof ldToast === 'function') ldToast('PDF engine not ready. Please refresh.', 'error');
        return;
    }

    try {
        const debriefing = window.currentResultsDebriefingData;
        const sessionTitle = window.currentResultsSessionTitle || 'Evaluation';

        if (!debriefing || !debriefing.evaluationForm) {
            if (typeof ldToast === 'function') ldToast('Evaluation data not loaded.', 'error');
            return;
        }

        if (typeof ldToast === 'function') ldToast('Generating detailed PDF report...', 'info');

        const doc = new jsPDF();
        const primaryColor = [16, 185, 129]; // Alwan Green
        const secondaryColor = [30, 41, 59]; // Slate 800
        const accentColor = [239, 68, 68];   // Red 500

        // --- PAGE 1: SUMMARY ---
        // Header Banner
        doc.setFillColor(...primaryColor);
        doc.rect(0, 0, 210, 40, 'F');

        doc.setFontSize(24);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text('ALWAN TEAM REPORT', 14, 25);

        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text(`Session: ${sessionTitle}`, 14, 33);

        doc.setTextColor(...secondaryColor);
        doc.setFontSize(10);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 150, 50);
        doc.text(`Session Date: ${debriefing.date || 'N/A'}`, 150, 55);

        // Section Summary Title
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Evaluation Overview', 14, 65);
        doc.setDrawColor(200, 200, 200);
        doc.line(14, 68, 196, 68);

        const questions = debriefing.evaluationForm.questions || [];
        const responses = debriefing.evaluationResponses || {};
        const responseCount = Object.keys(responses).length;

        // Stats Table
        doc.autoTable({
            startY: 75,
            head: [['Metric', 'Summary']],
            body: [
                ['Total Team Responses', `${responseCount} / ${debriefing.assignedCount || '?'}`],
                ['Completion Rate', debriefing.assignedCount ? `${Math.round((responseCount / debriefing.assignedCount) * 100)}%` : 'N/A'],
                ['Total Questions Asked', questions.length],
                ['Session Status', 'Data Aggregated & Verified']
            ],
            theme: 'grid',
            headStyles: { fillColor: primaryColor, textColor: [255, 255, 255] },
            styles: { fontSize: 11, cellPadding: 5 }
        });

        // Question List Summary
        doc.setFontSize(14);
        doc.text('Evaluation Questions:', 14, doc.lastAutoTable.finalY + 15);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        questions.forEach((q, i) => {
            const text = `${i + 1}. ${q.text}`;
            const splitText = doc.splitTextToSize(text, 180);
            doc.text(splitText, 14, doc.lastAutoTable.finalY + 22 + (i * 12));
        });

        // --- PAGE 2+: DETAILED INDIVIDUAL RESPONSES ---
        doc.addPage();
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...secondaryColor);
        doc.text('Detailed Team Responses', 14, 20);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Each response is listed below with full text for reflections and feedback.', 14, 26);

        let currentY = 35;

        Object.entries(responses).forEach(([uid, r], index) => {
            const username = r.username || uid.replace(/_/g, '.').split('@')[0];

            // Check if we need a new page for the next user
            if (currentY > 230) {
                doc.addPage();
                currentY = 20;
            }

            // User Header Card
            doc.setFillColor(248, 250, 252); // Very light grey
            doc.rect(14, currentY, 182, 10, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(...primaryColor);
            doc.text(`MEMBER: @${username.toUpperCase()}`, 18, currentY + 7);
            currentY += 12;

            // Responses Table for this user
            const userData = questions.map(q => [
                { content: q.text, styles: { fontStyle: 'bold', textColor: [71, 85, 105] } },
                r.responses?.[q.id] || 'N/A'
            ]);

            doc.autoTable({
                startY: currentY,
                body: userData,
                theme: 'plain',
                styles: { fontSize: 10, cellPadding: 3 },
                columnStyles: {
                    0: { cellWidth: 80 },
                    1: { cellWidth: 100 }
                },
                margin: { left: 14 }
            });

            currentY = doc.lastAutoTable.finalY + 5;

            // Reflection Box (Correct path: r.responses.reflection)
            const userReflection = r.responses?.reflection || '';
            if (userReflection) {
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(30, 41, 59);
                const rLabel = (debriefing.evaluationForm.reflectionLabel || 'Reflection') + ':';
                doc.text(rLabel, 14, currentY + 4);

                const splitRef = doc.splitTextToSize(userReflection, 175);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(51, 65, 85);
                doc.text(splitRef, 20, currentY + 9);
                currentY += (splitRef.length * 5) + 10;
            }

            // Feedback Box (Correct path: r.responses.additional_feedback)
            const userFeedback = r.responses?.additional_feedback || '';
            if (userFeedback) {
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...accentColor);
                const fLabel = (debriefing.evaluationForm.feedbackLabel || 'Suggestions/Feedback') + ':';
                doc.text(fLabel, 14, currentY + 4);

                const splitFeed = doc.splitTextToSize(userFeedback, 175);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(153, 27, 27);
                doc.text(splitFeed, 20, currentY + 9);
                currentY += (splitFeed.length * 5) + 10;
            }

            currentY += 10; // Spacer between users
            doc.setDrawColor(226, 232, 240);
            doc.line(14, currentY - 5, 196, currentY - 5);
        });

        // Save FileName
        const timestamp = new Date().getTime();
        const filename = `Alwan_Detailed_Report_${sessionTitle.replace(/\s+/g, '_')}_${timestamp}.pdf`;
        doc.save(filename);

        if (typeof ldToast === 'function') ldToast('Export successful!', 'success');
    } catch (err) {
        console.error('PDF Export error:', err);
        if (typeof ldToast === 'function') ldToast('Error generating PDF', 'error');
    }
}

// Make globally available
window.exportTeamData = exportTeamData;

// Export admin modal functions
window.closeAdminPanel = closeAdminPanel;
window.openManageMembers = openManageMembers;
window.closeManageMembers = closeManageMembers;
window.openTeamStats = openTeamStats;
window.closeTeamStats = closeTeamStats;
