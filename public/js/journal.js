/**
 * journal.js
 * Logic for the Simple White Diary in Alwan.
 */

// iOS-safe storage helpers
function _jStorageGet(key, fallback = null) {
    try { const v = localStorage.getItem(key); if (v !== null) return v; } catch (e) { }
    try { const v = sessionStorage.getItem(key); if (v !== null) return v; } catch (_) { }
    return fallback;
}
function _jStorageSet(key, val) {
    try { localStorage.setItem(key, val); return; } catch (e) { }
    try { sessionStorage.setItem(key, val); } catch (_) { }
}
function _jStorageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { }
    try { sessionStorage.removeItem(key); } catch (_) { }
}

// Global state for journals
let userJournals = [];
let currentJournalId = null; // Track if editing existing journal

/**
 * Open Journal List Modal
 */
function openJournalListModal() {
    const modal = document.getElementById('journal-list-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadUserJournals();
    }
}

/**
 * Close Journal List Modal
 */
function closeJournalListModal() {
    console.log('closeJournalListModal called');
    const modal = document.getElementById('journal-list-modal');
    if (modal) {
        console.log('Modal found, closing...');
        modal.classList.remove('open');
        modal.style.display = 'none';
        document.body.style.overflow = '';
    } else {
        console.error('Modal not found!');
    }
}

/**
 * Toggle Journal List Visibility (deprecated - keeping for compatibility)
 */
function toggleJournalList() {
    openJournalListModal();
}

/**
 * Open the Journal Modal
 */
function openJournalModal() {
    const modal = document.getElementById('journal-modal');
    if (modal) {
        currentJournalId = null; // New entry

        // Clear fields for new entry
        document.getElementById('journal-title').value = '';
        document.getElementById('journal-content-editor').innerHTML = '';
        const tsLabel = document.getElementById('journal-timestamp-label');
        if (tsLabel) tsLabel.textContent = '';

        // Load draft from storage if exists
        const draft = _jStorageGet('journal_draft');
        if (draft) {
            try {
                const draftData = JSON.parse(draft);
                if (draftData.title || draftData.content) {
                    document.getElementById('journal-title').value = draftData.title || '';
                    document.getElementById('journal-content-editor').innerHTML = draftData.content || '';
                }
            } catch (e) {
                console.error('Error loading draft:', e);
            }
        }

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        // Check for personal flag
        const privateCheck = document.getElementById('journal-private');
        if (privateCheck) privateCheck.checked = true;
    }
}

/**
 * Close the Journal Modal with Auto-Save
 */
function closeJournalModal() {
    const modal = document.getElementById('journal-modal');
    if (modal) {
        const titleInput = document.getElementById('journal-title');
        const editor = document.getElementById('journal-content-editor');

        const title = titleInput.value.trim();
        const content = editor.innerHTML.trim();

        // Auto-save if there's content
        if ((title || content)) {
            // If editing existing entry
            if (currentJournalId) {
                autoSaveJournalEntry(title, content, currentJournalId);
            }
            // If new entry
            else {
                // Save as draft to localStorage
                saveDraft(title, content);

                // Auto-save to Firebase
                autoSaveJournalEntry(title, content);
            }
        }

        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

/**
 * Save Draft to localStorage
 */
function saveDraft(title, content) {
    try {
        _jStorageSet('journal_draft', JSON.stringify({
            title: title,
            content: content,
            timestamp: new Date().toISOString()
        }));
    } catch (e) {
        console.error('Error saving draft:', e);
    }
}

/**
 * Clear Draft from storage
 */
function clearDraft() {
    try {
        _jStorageRemove('journal_draft');
    } catch (e) {
        console.error('Error clearing draft:', e);
    }
}

/**
 * Auto-save Journal Entry (silent save on close)
 */
async function autoSaveJournalEntry(title, content, entryId = null) {
    const user = firebase.auth().currentUser;
    if (!user) return;

    try {
        const token = await user.getIdToken();

        // If updating existing entry
        if (entryId) {
            const response = await fetch(SERVER_URL + `/api/journals/${entryId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: title || 'Untitled Entry',
                    content: content,
                    isPrivate: true
                })
            });

            if (response.ok) {
                console.log('Journal updated successfully');
                loadUserJournals();
            }
        }
        // If creating new entry
        else {
            const response = await fetch(SERVER_URL + '/api/journals', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: title || 'Untitled Entry',
                    content: content,
                    isPrivate: true
                })
            });

            if (response.ok) {
                const data = await response.json();
                clearDraft();
                console.log('Journal auto-saved successfully');
                loadUserJournals();
            }
        }
    } catch (error) {
        console.error('Error auto-saving journal:', error);
    }
}

/**
 * Rich Text Editing Function
 */
function formatDoc(cmd, value = null) {
    if (value) {
        document.execCommand(cmd, false, value);
    } else {
        document.execCommand(cmd, false, null);
    }
    // Maintain focus
    document.getElementById('journal-content-editor').focus();
}

/**
 * Toolbar Dropdown Toggle
 */
function toggleDropdown(id) {
    // Close others first
    document.querySelectorAll('.journal-dropdown-menu').forEach(menu => {
        if (menu.id !== id) menu.style.display = 'none';
    });

    // Toggle requested
    const dropdown = document.getElementById(id);
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    }
}

// Close dropdowns if clicked outside
document.addEventListener('click', function (event) {
    if (!event.target.closest('.j-tool-btn') && !event.target.closest('.journal-dropdown-menu')) {
        document.querySelectorAll('.journal-dropdown-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    }
});

/**
 * Save Journal Entry (Manual Save)
 */
async function saveJournalEntry() {
    const titleInput = document.getElementById('journal-title');
    const editor = document.getElementById('journal-content-editor');
    const saveBtn = document.getElementById('journal-save-btn');

    const title = titleInput.value.trim();
    const content = editor.innerHTML.trim();

    if (!title && !content) {
        ldToast('Entry is empty!', 'error');
        return;
    }

    const user = firebase.auth().currentUser;
    if (!user) {
        ldToast('Session expired. Please log in again.', 'error');
        return;
    }

    try {
        saveBtn.disabled = true;
        saveBtn.innerHTML = 'SAVED';

        const token = await user.getIdToken();
        const response = await fetch(SERVER_URL + '/api/journals', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                id: currentJournalId, // Send if editing
                title: title || 'Untitled Entry',
                content: content,
                isPrivate: true
            })
        });

        if (!response.ok) throw new Error('API save failed');

        const data = await response.json();

        saveToLocalStorage(data.id, { title, content, id: data.id, createdAt: new Date().toISOString() });
        clearDraft();

        ldToast('Saved to your journal.', 'success');

        // Force close the modal
        const modal = document.getElementById('journal-modal');
        if (modal) {
            modal.classList.remove('open');
            document.body.style.overflow = '';
        }

        // Reset state
        currentJournalId = null;
        const titleInput = document.getElementById('journal-title');
        const editor = document.getElementById('journal-content-editor');
        if (titleInput) titleInput.value = '';
        if (editor) editor.innerHTML = '';

        loadUserJournals();

    } catch (error) {
        console.error('Error saving journal:', error);
        ldToast('Failed to save journal.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'SAVE';
    }
}

/**
 * Save to localStorage for offline access
 */
function saveToLocalStorage(id, journalData) {
    try {
        let localJournals = JSON.parse(_jStorageGet('journals_local', '[]'));
        localJournals = localJournals.filter(j => j.id !== id);
        localJournals.unshift({ id, ...journalData });
        if (localJournals.length > 50) localJournals = localJournals.slice(0, 50);
        _jStorageSet('journals_local', JSON.stringify(localJournals));
    } catch (e) {
        console.error('Error saving to storage:', e);
    }
}

/**
 * Load from storage
 */
function loadFromLocalStorage() {
    try {
        return JSON.parse(_jStorageGet('journals_local', '[]'));
    } catch (e) {
        console.error('Error loading from storage:', e);
        return [];
    }
}

/**
 * Load User Journal Entries (MongoDB + localStorage)
 */
async function loadUserJournals() {
    const user = firebase.auth().currentUser;
    const listContainer = document.getElementById('journal-recent-list');
    if (!listContainer) return;

    try {
        let serverJournals = [];
        if (user) {
            const token = await user.getIdToken();
            const response = await fetch(SERVER_URL + '/api/journals', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                serverJournals = await response.json();
            }
        }

        // Load from localStorage
        const localJournals = loadFromLocalStorage();

        // Merge and remove duplicates
        const allJournals = [...serverJournals];
        localJournals.forEach(localJournal => {
            if (!allJournals.find(j => j.id === localJournal.id)) {
                allJournals.push(localJournal);
            }
        });

        // Sort by date (client-side)
        allJournals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        userJournals = allJournals;
        renderJournalList();
    } catch (error) {
        console.error('Error loading journals:', error);
        userJournals = loadFromLocalStorage();
        renderJournalList();
    }
}

/**
 * Render List
 */
function renderJournalList() {
    const listContainer = document.getElementById('journal-recent-list');
    if (!listContainer) return;

    if (userJournals.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:#94a3b8;">
                <i class="bi bi-journal-text" style="font-size: 2.5rem; opacity:0.3; display:block; margin-bottom:12px;"></i>
                <p style="font-size:0.9rem;">Your journal is empty.<br>Tap 'Create Journal' to start.</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
            ${userJournals.map(journal => {
        const date = journal.createdAt ? new Date(journal.createdAt) : new Date();
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        // Strip HTML for preview
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = journal.content;
        const textPreview = tempDiv.textContent || tempDiv.innerText || '';

        // Show sync status
        const syncBadge = journal.synced === false ?
            '<span style="font-size: 0.7rem; color: #f59e0b; margin-left: 6px;">● Offline</span>' : '';

        // Escape ID for onclick
        const escapedId = journal.id.replace(/'/g, "\\'");

        return `
                    <div class="journal-card" onclick="viewJournalEntry('${escapedId}')" 
                         style="background: #ffffff; border-radius: 12px; padding: 20px; cursor: pointer; 
                                border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); 
                                transition: all 0.2s ease;">
                        <div style="margin-bottom: 12px;">
                            <h3 style="font-size: 1.1rem; font-weight: 800; color: #0f172a; margin: 0 0 6px 0; 
                                       display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; 
                                       overflow: hidden; line-height: 1.3;">
                                ${journal.title}
                            </h3>
                            <div style="display: flex; align-items: center;">
                                <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 600; 
                                             text-transform: uppercase; letter-spacing: 0.5px;">
                                    ${dateStr}
                                </span>
                                ${syncBadge}
                            </div>
                        </div>
                        <p style="font-size: 0.9rem; color: #64748b; margin: 0; line-height: 1.6; 
                                  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; 
                                  overflow: hidden;">
                            ${textPreview || 'No content'}
                        </p>
                    </div>
                `;
    }).join('')}
        </div>
        <style>
            .journal-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 16px rgba(0,0,0,0.08) !important;
                border-color: #cbd5e1 !important;
            }
        </style>
    `;
}

/**
 * View Entry
 */
function viewJournalEntry(id) {
    console.log('viewJournalEntry called with id:', id);
    const journal = userJournals.find(j => j.id === id);
    if (!journal) {
        console.error('Journal not found:', id);
        return;
    }

    console.log('Journal found:', journal);

    // Close the list modal first
    closeJournalListModal();

    currentJournalId = id; // Mark as viewing existing entry

    const modal = document.getElementById('journal-modal');
    if (modal) {
        const titleInput = document.getElementById('journal-title');
        const editor = document.getElementById('journal-content-editor');
        const tsLabel = document.getElementById('journal-timestamp-label');

        titleInput.value = journal.title;
        titleInput.disabled = true; // Make read-only
        editor.innerHTML = journal.content;
        editor.contentEditable = false; // Make read-only

        const date = journal.createdAt ? new Date(journal.createdAt) : new Date();
        if (tsLabel) {
            tsLabel.textContent = "Created " + date.toLocaleString();
        }

        // Get or create button group in the header (right side)
        const modalHeader = modal.querySelector('.modal-header');
        let btnGroup = modalHeader.querySelector('.journal-action-buttons');

        if (!btnGroup) {
            btnGroup = document.createElement('div');
            btnGroup.className = 'journal-action-buttons';
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '8px';
            btnGroup.style.alignItems = 'center';
            btnGroup.style.marginLeft = 'auto';

            // Insert at the end of header (right side)
            modalHeader.appendChild(btnGroup);
        }
        btnGroup.style.display = 'flex';

        // Edit button
        let editBtn = btnGroup.querySelector('.journal-edit-btn');
        if (!editBtn) {
            editBtn = document.createElement('button');
            editBtn.className = 'journal-edit-btn modal-back-btn';
            editBtn.style.background = 'transparent';
            editBtn.style.color = '#3b82f6';
            editBtn.style.width = '44px';
            editBtn.style.height = '44px';
            editBtn.style.flexShrink = '0';
            editBtn.innerHTML = '<i class="bi bi-pencil-fill"></i>';
            btnGroup.appendChild(editBtn);
        }
        editBtn.style.display = 'flex';
        editBtn.onclick = () => {
            // Enable editing
            titleInput.disabled = false;
            editor.contentEditable = true;
            btnGroup.style.display = 'none';
            currentJournalId = null; // Treat as new entry when saving
        };

        // Delete button (icon only)
        let delBtn = btnGroup.querySelector('.journal-delete-btn');
        if (!delBtn) {
            delBtn = document.createElement('button');
            delBtn.className = 'journal-delete-btn modal-back-btn';
            delBtn.style.background = 'transparent';
            delBtn.style.color = '#ef4444';
            delBtn.style.width = '44px';
            delBtn.style.height = '44px';
            delBtn.style.flexShrink = '0';
            delBtn.innerHTML = '<i class="bi bi-trash3-fill"></i>';
            btnGroup.appendChild(delBtn);
        }
        delBtn.style.display = 'flex';
        delBtn.onclick = async () => {
            if (confirm('Delete this diary entry forever?')) {
                const user = firebase.auth().currentUser;
                if (!user) return;

                if (!id.startsWith('local_')) {
                    try {
                        const token = await user.getIdToken();
                        const response = await fetch(SERVER_URL + `/api/journals/${id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (!response.ok) throw new Error('Delete failed');
                    } catch (error) {
                        console.error('Error deleting from Server:', error);
                    }
                }

                // Delete from storage
                try {
                    let localJournals = loadFromLocalStorage();
                    localJournals = localJournals.filter(j => j.id !== id);
                    _jStorageSet('journals_local', JSON.stringify(localJournals));
                } catch (error) {
                    console.error('Error deleting from storage:', error);
                }

                ldToast('Deleted.', 'info');
                closeJournalModal();
                loadUserJournals();
            }
        };

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        // Reset on close
        const origClose = closeJournalModal;
        window.closeJournalModal = () => {
            currentJournalId = null;
            titleInput.disabled = false;
            editor.contentEditable = true;
            modal.classList.remove('open');
            document.body.style.overflow = '';
            setTimeout(() => {
                if (btnGroup) btnGroup.style.display = 'none';
                window.closeJournalModal = origClose;
            }, 300);
        };
    }
}

/**
 * Delete Entry
 */
async function deleteJournalEntry(id) {
    // Handled inside viewJournalEntry for easier context
}

// Global Auth check
firebase.auth().onAuthStateChanged((user) => {
    if (user) loadUserJournals();
});

// Exports
window.openJournalModal = openJournalModal;
window.closeJournalModal = closeJournalModal;
window.openJournalListModal = openJournalListModal;
window.closeJournalListModal = closeJournalListModal;
window.saveJournalEntry = saveJournalEntry;
window.viewJournalEntry = viewJournalEntry;
window.formatDoc = formatDoc;
window.toggleDropdown = toggleDropdown;
window.toggleJournalList = toggleJournalList;
