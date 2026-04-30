// Offline Storage Helper using IndexedDB
const DB_NAME = 'AlwanOfflineDB';
const DB_VERSION = 1;
const STORES = {
    MOODS: 'moods',
    JOURNALS: 'journals',
    SELF_CARE: 'self_care',
    PENDING_SYNC: 'pending_sync'
};

let db = null;

// Initialize IndexedDB
function initOfflineDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            console.log('✅ Offline DB initialized');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Moods store
            if (!db.objectStoreNames.contains(STORES.MOODS)) {
                const moodStore = db.createObjectStore(STORES.MOODS, { keyPath: 'id', autoIncrement: true });
                moodStore.createIndex('timestamp', 'timestamp', { unique: false });
                moodStore.createIndex('uid', 'uid', { unique: false });
            }

            // Journals store
            if (!db.objectStoreNames.contains(STORES.JOURNALS)) {
                const journalStore = db.createObjectStore(STORES.JOURNALS, { keyPath: 'id', autoIncrement: true });
                journalStore.createIndex('timestamp', 'timestamp', { unique: false });
                journalStore.createIndex('uid', 'uid', { unique: false });
            }

            // Pending sync store (for offline entries)
            if (!db.objectStoreNames.contains(STORES.PENDING_SYNC)) {
                const syncStore = db.createObjectStore(STORES.PENDING_SYNC, { keyPath: 'id', autoIncrement: true });
                syncStore.createIndex('type', 'type', { unique: false });
                syncStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // Self-care activities store
            if (!db.objectStoreNames.contains(STORES.SELF_CARE)) {
                const selfCareStore = db.createObjectStore(STORES.SELF_CARE, { keyPath: 'id', autoIncrement: true });
                selfCareStore.createIndex('activityId', 'activityId', { unique: false });
                selfCareStore.createIndex('uid', 'uid', { unique: false });
                selfCareStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            console.log('✅ Offline DB stores created');
        };
    });
}

// Save mood entry offline
async function saveMoodOffline(moodData) {
    if (!db) await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.MOODS, STORES.PENDING_SYNC], 'readwrite');
        const moodStore = transaction.objectStore(STORES.MOODS);
        const syncStore = transaction.objectStore(STORES.PENDING_SYNC);

        // Save to moods store
        const moodRequest = moodStore.add({
            ...moodData,
            synced: false,
            offline: true
        });

        // Add to pending sync queue
        const syncRequest = syncStore.add({
            type: 'mood',
            data: moodData,
            timestamp: Date.now()
        });

        transaction.oncomplete = () => {
            console.log('✅ Mood saved offline');
            resolve(moodRequest.result);
        };
        transaction.onerror = () => reject(transaction.error);
    });
}

// Save journal entry offline
async function saveJournalOffline(journalData) {
    if (!db) await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.JOURNALS, STORES.PENDING_SYNC], 'readwrite');
        const journalStore = transaction.objectStore(STORES.JOURNALS);
        const syncStore = transaction.objectStore(STORES.PENDING_SYNC);

        // Save to journals store
        const journalRequest = journalStore.add({
            ...journalData,
            synced: false,
            offline: true
        });

        // Add to pending sync queue
        const syncRequest = syncStore.add({
            type: 'journal',
            data: journalData,
            timestamp: Date.now()
        });

        transaction.oncomplete = () => {
            console.log('✅ Journal saved offline');
            resolve(journalRequest.result);
        };
        transaction.onerror = () => reject(transaction.error);
    });
}

// Get all offline moods
async function getOfflineMoods(uid) {
    if (!db) await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.MOODS], 'readonly');
        const store = transaction.objectStore(STORES.MOODS);
        const index = store.index('uid');
        const request = index.getAll(uid);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get all offline journals
async function getOfflineJournals(uid) {
    if (!db) await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.JOURNALS], 'readonly');
        const store = transaction.objectStore(STORES.JOURNALS);
        const index = store.index('uid');
        const request = index.getAll(uid);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Sync pending entries when online
async function syncPendingEntries() {
    if (!db) await initOfflineDB();
    if (!navigator.onLine) {
        console.log('⚠️ Still offline, skipping sync');
        return;
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.PENDING_SYNC], 'readonly');
        const store = transaction.objectStore(STORES.PENDING_SYNC);
        const request = store.getAll();

        request.onsuccess = async () => {
            const pending = request.result;
            console.log(`🔄 Syncing ${pending.length} pending entries...`);

            for (const entry of pending) {
                try {
                    if (entry.type === 'mood') {
                        // Call your existing mood save function
                        await window.sendMoodToServer?.(entry.data);
                    } else if (entry.type === 'journal') {
                        // Call your existing journal save function
                        await window.saveJournalToServer?.(entry.data);
                    }

                    // Remove from pending sync after successful upload
                    await removePendingSync(entry.id);
                    console.log(`✅ Synced ${entry.type} entry`);
                } catch (error) {
                    console.error(`❌ Failed to sync ${entry.type}:`, error);
                }
            }

            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// Remove synced entry from pending queue
async function removePendingSync(id) {
    if (!db) await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.PENDING_SYNC], 'readwrite');
        const store = transaction.objectStore(STORES.PENDING_SYNC);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Check online status and sync
window.addEventListener('online', () => {
    console.log('🌐 Back online! Syncing pending entries...');
    syncPendingEntries();
});

window.addEventListener('offline', () => {
    console.log('📴 Offline mode activated');
});

// Save self-care activity completion offline
async function saveSelfCareOffline(activityData) {
    if (!db) await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SELF_CARE, STORES.PENDING_SYNC], 'readwrite');
        const selfCareStore = transaction.objectStore(STORES.SELF_CARE);
        const syncStore = transaction.objectStore(STORES.PENDING_SYNC);

        // Save to self-care store
        const selfCareRequest = selfCareStore.add({
            ...activityData,
            synced: false,
            offline: true,
            timestamp: Date.now()
        });

        // Add to pending sync queue
        const syncRequest = syncStore.add({
            type: 'self-care',
            data: activityData,
            timestamp: Date.now()
        });

        transaction.oncomplete = () => {
            console.log('✅ Self-care activity saved offline');
            resolve(selfCareRequest.result);
        };
        transaction.onerror = () => reject(transaction.error);
    });
}

// Get all offline self-care activities
async function getOfflineSelfCare(uid) {
    if (!db) await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SELF_CARE], 'readonly');
        const store = transaction.objectStore(STORES.SELF_CARE);
        const index = store.index('uid');
        const request = index.getAll(uid);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOfflineDB);
} else {
    initOfflineDB();
}

// Export functions
window.offlineStorage = {
    saveMoodOffline,
    saveJournalOffline,
    saveSelfCareOffline,
    getOfflineMoods,
    getOfflineJournals,
    getOfflineSelfCare,
    syncPendingEntries
};
