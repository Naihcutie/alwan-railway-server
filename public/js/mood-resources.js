// ─── Mood-Based Resources System ────────────────────────────────

let moodResourcesData = null;
let currentMoodCategory = 'joy';
let articlesFilterMood = null; // null = show current mood
let copingFilterMood = null;

const MOOD_CONFIG = {
    joy: { label: 'Joy', color: '#FACC15', bg: '#FEF9C3', text: '#713F12' },
    sadness: { label: 'Sadness', color: '#60A5FA', bg: '#DBEAFE', text: '#1E3A5F' },
    fear: { label: 'Fear', color: '#A855F7', bg: '#F3E8FF', text: '#4C1D95' },
    anger: { label: 'Anger', color: '#EF4444', bg: '#FEE2E2', text: '#7F1D1D' },
    disgust: { label: 'Disgust', color: '#4ADE80', bg: '#DCFCE7', text: '#14532D' },
    neutral: { label: 'More', color: '#94a3b8', bg: '#f1f5f9', text: '#475569' },
};

const MOOD_SVG_SMALL = {
    joy: `<svg viewBox="0 0 100 100" width="22" height="22" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;flex-shrink:0;">
        <rect x="10" y="10" width="80" height="80" rx="20" fill="#FACC15"/>
        <path d="M28 42 Q34 32 40 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M60 42 Q66 32 72 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M30 60 Q50 78 70 60" stroke="#1F2937" stroke-width="5" stroke-linecap="round" fill="none"/>
    </svg>`,
    sadness: `<svg viewBox="0 0 100 100" width="22" height="22" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;flex-shrink:0;">
        <rect x="10" y="10" width="80" height="80" rx="20" fill="#60A5FA"/>
        <path d="M28 45 Q34 53 40 45" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M60 45 Q66 53 72 45" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M34 72 Q50 60 66 72" stroke="#1F2937" stroke-width="5" stroke-linecap="round" fill="none"/>
    </svg>`,
    neutral: `<svg viewBox="0 0 100 100" width="22" height="22" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;flex-shrink:0;">
        <rect x="10" y="10" width="80" height="80" rx="20" fill="#94a3b8"/>
        <circle cx="34" cy="45" r="4.5" fill="#1F2937"/>
        <circle cx="66" cy="45" r="4.5" fill="#1F2937"/>
        <line x1="34" y1="68" x2="66" y2="68" stroke="#1F2937" stroke-width="5" stroke-linecap="round"/>
    </svg>`,
    fear: `<svg viewBox="0 0 100 100" width="22" height="22" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;flex-shrink:0;">
        <rect x="10" y="10" width="80" height="80" rx="20" fill="#A855F7"/>
        <ellipse cx="34" cy="47" rx="10" ry="11" fill="white" stroke="#1F2937" stroke-width="1.5"/>
        <ellipse cx="66" cy="47" rx="10" ry="11" fill="white" stroke="#1F2937" stroke-width="1.5"/>
        <circle cx="34" cy="41" r="4" fill="#1F2937"/>
        <circle cx="66" cy="41" r="4" fill="#1F2937"/>
        <path d="M32 68 Q34 62 50 62 Q66 62 68 68 Q66 80 50 80 Q34 80 32 68Z" fill="#1F2937"/>
    </svg>`,
    anger: `<svg viewBox="0 0 100 100" width="22" height="22" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;flex-shrink:0;">
        <rect x="10" y="10" width="80" height="80" rx="20" fill="#EF4444"/>
        <path d="M26 36 L44 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round"/>
        <path d="M74 36 L56 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round"/>
        <circle cx="34" cy="48" r="4.5" fill="#1F2937"/>
        <circle cx="66" cy="48" r="4.5" fill="#1F2937"/>
        <rect x="32" y="64" width="36" height="12" rx="4" fill="white" stroke="#1F2937" stroke-width="2"/>
    </svg>`,
    disgust: `<svg viewBox="0 0 100 100" width="22" height="22" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;flex-shrink:0;">
        <rect x="10" y="10" width="80" height="80" rx="20" fill="#4ADE80"/>
        <path d="M25 38 Q34 34 40 39" stroke="#1F2937" stroke-width="3.5" stroke-linecap="round" fill="none"/>
        <path d="M75 38 Q66 34 60 39" stroke="#1F2937" stroke-width="3.5" stroke-linecap="round" fill="none"/>
        <path d="M26 50 Q34 55 42 50" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
        <path d="M58 50 Q66 55 74 50" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
        <path d="M34 64 Q34 58 50 58 Q66 58 66 64 Q66 76 50 76 Q34 76 34 64Z" fill="#14532D" stroke="#1F2937" stroke-width="1.5"/>
    </svg>`,
};

// Load resources data
async function loadMoodResources() {
    try {
        const res = await fetch('/assets/mood-resources.json');
        moodResourcesData = await res.json();
        console.log('✅ Mood resources loaded');
    } catch (err) {
        console.error('❌ Error loading mood resources:', err);
    }
}

// Map old mood keys to new Inside Out keys
function normalizeToInsideOut(moodKey) {
    const map = { 'rad': 'anger', 'good': 'sadness', 'meh': 'joy', 'sad': 'disgust', 'bad': 'disgust', 'awful': 'fear' };
    return map[moodKey] || moodKey;
}

// Get latest mood from calendar entries
function getLatestMood() {
    const entries = window.moodCalendarEntries || [];
    if (!entries.length) return 'joy';
    const sorted = [...entries].sort((a, b) => {
        const tA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
        const tB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
        return tB - tA;
    });
    return normalizeToInsideOut(sorted[0].mood || 'joy');
}

// Get all articles/coping from all sections as flat arrays with mood tag
function getAllArticles() {
    if (!moodResourcesData) return [];
    const all = [];
    Object.keys(moodResourcesData).forEach(section => {
        (moodResourcesData[section]?.articles || []).forEach(a => all.push(a));
    });
    return all;
}

function getAllCoping() {
    if (!moodResourcesData) return [];
    const all = [];
    Object.keys(moodResourcesData).forEach(section => {
        (moodResourcesData[section]?.coping || []).forEach(c => all.push(c));
    });
    return all;
}

// Build mood filter pills HTML
function buildFilterPills(activeMood, onClickFn) {
    return `<div id="mood-filter-pills" style="display:flex;gap:0.5rem;padding:0.75rem 1rem;overflow-x:auto;border-bottom:1px solid #e2e8f0;flex-shrink:0;scrollbar-width:none;">
        ${Object.entries(MOOD_CONFIG).map(([key, cfg]) => {
        const isActive = activeMood === key;
        return `<button onclick="${onClickFn}('${key}')" style="
                display:flex;align-items:center;gap:0.35rem;
                padding:0.35rem 0.75rem;border-radius:999px;border:2px solid ${isActive ? cfg.color : '#e2e8f0'};
                background:${isActive ? cfg.bg : 'white'};color:${isActive ? cfg.text : '#64748b'};
                font-size:0.78rem;font-weight:${isActive ? '700' : '500'};
                cursor:pointer;white-space:nowrap;transition:all 0.15s;flex-shrink:0;">
                ${MOOD_SVG_SMALL[key]}${cfg.label}
            </button>`;
    }).join('')}
    </div>`;
}

// Render articles list for a given mood
function renderArticlesList(mood, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const articles = getAllArticles().filter(a => a.mood === mood);
    if (!articles.length) {
        container.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;">No articles for this mood yet.</div>`;
        return;
    }
    const cfg = MOOD_CONFIG[mood] || MOOD_CONFIG.joy;
    container.innerHTML = articles.map(article => `
        <div style="padding:1rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;cursor:pointer;display:flex;align-items:center;gap:0.75rem;" onclick="openArticleDetail('${article.id}')">
            <div style="flex:1;">
                <h3 style="font-size:0.95rem;font-weight:600;margin:0 0 0.35rem 0;color:#1e293b;">${article.title}</h3>
                <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
                    <span style="background:${cfg.bg};color:${cfg.text};padding:0.15rem 0.5rem;border-radius:6px;font-size:0.7rem;font-weight:600;">${cfg.label}</span>
                    <span style="background:#e0e7ff;color:#4338ca;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.7rem;font-weight:600;">${article.category}</span>
                    <span style="color:#94a3b8;font-size:0.72rem;">${article.readTime}</span>
                </div>
            </div>
            <i class="bi bi-chevron-right" style="color:#cbd5e1;flex-shrink:0;"></i>
        </div>
    `).join('');
}

// Render coping list for a given mood
function renderCopingList(mood, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const coping = getAllCoping().filter(c => c.mood === mood);
    if (!coping.length) {
        container.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;">No coping guides for this mood yet.</div>`;
        return;
    }
    const cfg = MOOD_CONFIG[mood] || MOOD_CONFIG.joy;
    container.innerHTML = coping.map(guide => `
        <div style="padding:1rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;cursor:pointer;display:flex;align-items:center;gap:0.75rem;" onclick="openCopingDetail('${guide.id}')">
            <div style="flex:1;">
                <h3 style="font-size:0.95rem;font-weight:600;margin:0 0 0.25rem 0;color:#1e293b;">${guide.title}</h3>
                <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
                    <span style="background:${cfg.bg};color:${cfg.text};padding:0.15rem 0.5rem;border-radius:6px;font-size:0.7rem;font-weight:600;">${cfg.label}</span>
                    <span style="color:#64748b;font-size:0.75rem;">${guide.description}</span>
                </div>
            </div>
            <i class="bi bi-chevron-right" style="color:#cbd5e1;flex-shrink:0;"></i>
        </div>
    `).join('');
}

// Filter pills click handlers
function filterArticlesByMood(mood) {
    articlesFilterMood = mood;
    const pills = document.querySelector('#articles-modal #mood-filter-pills');
    if (pills) pills.outerHTML = buildFilterPills(mood, 'filterArticlesByMood');
    renderArticlesList(mood, 'articles-modal-content-list');
}

function filterCopingByMood(mood) {
    copingFilterMood = mood;
    const pills = document.querySelector('#coping-modal #mood-filter-pills');
    if (pills) pills.outerHTML = buildFilterPills(mood, 'filterCopingByMood');
    renderCopingList(mood, 'coping-modal-content-list');
}

// Open articles modal
function openArticlesModal() {
    if (!moodResourcesData) return;
    const modal = document.getElementById('articles-modal');
    const content = document.getElementById('articles-modal-content');
    if (!modal || !content) return;

    const latestMood = getLatestMood();
    articlesFilterMood = latestMood;

    content.innerHTML = `
        ${buildFilterPills(latestMood, 'filterArticlesByMood')}
        <div id="articles-modal-content-list" style="overflow-y:auto;flex:1;"></div>
    `;
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.height = '100%';

    renderArticlesList(latestMood, 'articles-modal-content-list');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeArticlesModal() {
    const modal = document.getElementById('articles-modal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

// Open coping modal
function openCopingModal() {
    if (!moodResourcesData) return;
    const modal = document.getElementById('coping-modal');
    const content = document.getElementById('coping-modal-content');
    if (!modal || !content) return;

    const latestMood = getLatestMood();
    copingFilterMood = latestMood;

    content.innerHTML = `
        ${buildFilterPills(latestMood, 'filterCopingByMood')}
        <div id="coping-modal-content-list" style="overflow-y:auto;flex:1;"></div>
    `;
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.height = '100%';

    renderCopingList(latestMood, 'coping-modal-content-list');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeCopingModal() {
    const modal = document.getElementById('coping-modal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

// Get mood SVG icon (full size for banner)
function getMoodSVGForResources(mood) {
    const normalized = normalizeToInsideOut(mood);
    const svgs = {
        joy: `<svg class="joy" viewBox="0 0 100 120" width="56" height="56" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#A16207"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#FACC15"/>
            <path d="M20 25 Q50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <text x="18" y="62" font-size="10" opacity="0.7">✦</text><text x="72" y="62" font-size="10" opacity="0.7">✦</text>
            <path d="M28 45 Q34 35 40 45" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M60 45 Q66 35 72 45" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <circle cx="24" cy="54" r="5" fill="#F59E0B" opacity="0.5"/>
            <circle cx="76" cy="54" r="5" fill="#F59E0B" opacity="0.5"/>
            <path d="M30 62 Q50 80 70 62" stroke="#1F2937" stroke-width="5" stroke-linecap="round" fill="none"/>
        </svg>`,
        sadness: `<svg class="sadness" viewBox="0 0 100 120" width="56" height="56" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#1D4ED8"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#60A5FA"/>
            <path d="M20 25 Q50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M28 42 Q34 50 40 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M60 42 Q66 50 72 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M26 36 L42 40" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>
            <path d="M74 36 L58 40" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>
            <path class="tears" d="M34 52 L34 72" stroke="#93C5FD" stroke-width="4" stroke-linecap="round" stroke-dasharray="4 8"/>
            <path class="tears" d="M66 52 L66 72" stroke="#93C5FD" stroke-width="4" stroke-linecap="round" stroke-dasharray="4 8"/>
            <path d="M34 76 Q50 64 66 76" stroke="#1F2937" stroke-width="5" stroke-linecap="round" fill="none"/>
        </svg>`,
        anger: `<svg class="anger" viewBox="0 0 100 120" width="56" height="56" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#B91C1C"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#EF4444"/>
            <path d="M20 25 Q50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M26 36 L44 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round"/>
            <path d="M74 36 L56 42" stroke="#1F2937" stroke-width="4" stroke-linecap="round"/>
            <circle cx="34" cy="48" r="4.5" fill="#1F2937"/>
            <circle cx="66" cy="48" r="4.5" fill="#1F2937"/>
            <line x1="40" y1="8" x2="40" y2="1" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="50" y1="6" x2="50" y2="0" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="60" y1="8" x2="60" y2="1" stroke="#FCA5A5" stroke-width="2.5" stroke-linecap="round"/>
            <rect x="32" y="64" width="36" height="12" rx="4" fill="white" stroke="#1F2937" stroke-width="2"/>
        </svg>`,
        disgust: `<svg class="disgust" viewBox="0 0 100 120" width="56" height="56" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#166534"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#4ADE80"/>
            <path d="M20 25 Q50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M25 38 Q34 34 40 39" stroke="#1F2937" stroke-width="3.5" stroke-linecap="round" fill="none"/>
            <path d="M75 38 Q66 34 60 39" stroke="#1F2937" stroke-width="3.5" stroke-linecap="round" fill="none"/>
            <path d="M26 50 Q34 55 42 50" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
            <path d="M58 50 Q66 55 74 50" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
            <path d="M34 64 Q34 58 50 58 Q66 58 66 64 Q66 76 50 76 Q34 76 34 64Z" fill="#14532D" stroke="#1F2937" stroke-width="1.5"/>
        </svg>`,
        fear: `<svg class="fear" viewBox="0 0 100 120" width="56" height="56" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <rect x="10" y="20" width="80" height="80" rx="20" fill="#6B21A8"/>
            <rect x="10" y="10" width="80" height="80" rx="20" fill="#A855F7"/>
            <path d="M20 25 Q50 15 80 25" stroke="white" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.4"/>
            <path d="M22 28 Q33 20 42 27" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <path d="M58 27 Q67 20 78 28" stroke="#1F2937" stroke-width="4" stroke-linecap="round" fill="none"/>
            <ellipse cx="34" cy="47" rx="10" ry="11" fill="white" stroke="#1F2937" stroke-width="1.5"/>
            <ellipse cx="66" cy="47" rx="10" ry="11" fill="white" stroke="#1F2937" stroke-width="1.5"/>
            <circle cx="34" cy="41" r="4" fill="#1F2937"/>
            <circle cx="66" cy="41" r="4" fill="#1F2937"/>
            <path d="M32 68 Q34 62 50 62 Q66 62 68 68 Q66 82 50 82 Q34 82 32 68Z" fill="#1F2937"/>
            <rect x="35" y="62" width="8" height="5" rx="1" fill="white"/>
            <rect x="45" y="61" width="10" height="6" rx="1" fill="white"/>
            <rect x="57" y="62" width="8" height="5" rx="1" fill="white"/>
        </svg>`,
    };
    return svgs[normalized] || svgs['joy'];
}

// Update mood status banner
function updateMoodStatusBanner(moodKey) {
    const normalized = normalizeToInsideOut(moodKey);
    const cfg = MOOD_CONFIG[normalized] || MOOD_CONFIG.joy;
    const banner = document.getElementById('sources-hero');
    const icon = document.getElementById('mood-status-icon');
    const text = document.getElementById('mood-status-text');
    if (!banner || !icon || !text) return;

    const messages = {
        joy: "Feeling good? Check out these resources to keep thriving!",
        neutral: "Maintaining balance? Here are some resources for mindful living.",
        sadness: "Going through a tough time? Here are some supportive resources for you.",
        fear: "Feeling anxious or scared? These resources can help you find calm.",
        anger: "Feeling frustrated? Here are tools to help you process and release.",
        disgust: "Feeling off or overwhelmed? These resources can help you reset.",
    };

    banner.style.background = `radial-gradient(circle at top left, ${cfg.bg} 0%, rgba(255,255,255,0.6) 100%)`;
    icon.innerHTML = getMoodSVGForResources(normalized);
    icon.style.cssText = 'width:64px;height:64px;display:flex;align-items:center;justify-content:center;flex-shrink:0;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.15));';
    text.textContent = messages[normalized] || messages.joy;

    // Apply gradient to entire sources tab background
    const sourcesTab = document.getElementById('ld-sources');
    if (sourcesTab) {
        sourcesTab.style.background = `linear-gradient(160deg, ${cfg.bg} 0%, rgba(255,255,255,0.3) 40%, transparent 100%)`;
        sourcesTab.style.minHeight = '100%';
    }
}

// Render preview lists (dashboard cards)
function shuffleArray(array) {
    const s = [...array];
    for (let i = s.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [s[i], s[j]] = [s[j], s[i]];
    }
    return s;
}

function renderArticlesPreview() {
    if (!moodResourcesData) return;
    const mood = getLatestMood();
    currentMoodCategory = mood;
    const articles = shuffleArray(getAllArticles().filter(a => a.mood === mood)).slice(0, 3);
    const container = document.getElementById('articles-list');
    if (!container) return;
    container.innerHTML = articles.map(a => `
        <button class="ld-link" onclick="openArticleDetail('${a.id}')">
            <i class="bi bi-chevron-right" style="font-size:0.65rem;opacity:0.5;flex-shrink:0;"></i>
            <div style="flex:1;text-align:left;">
                <div style="font-weight:600;">${a.title}</div>
                <div style="font-size:0.75rem;opacity:0.7;margin-top:0.25rem;">${a.category} • ${a.readTime}</div>
            </div>
        </button>
    `).join('');
}

function renderCopingPreview() {
    if (!moodResourcesData) return;
    const mood = getLatestMood();
    const coping = shuffleArray(getAllCoping().filter(c => c.mood === mood)).slice(0, 3);
    const container = document.getElementById('coping-list');
    if (!container) return;
    container.innerHTML = coping.map(g => `
        <button class="ld-link teal" onclick="openCopingDetail('${g.id}')">
            <i class="bi bi-chevron-right" style="font-size:0.65rem;opacity:0.5;flex-shrink:0;"></i>
            <div style="flex:1;text-align:left;">
                <div style="font-weight:600;">${g.title}</div>
                <div style="font-size:0.75rem;opacity:0.7;margin-top:0.25rem;">${g.description}</div>
            </div>
        </button>
    `).join('');
}

// Open article detail
function openArticleDetail(articleId) {
    const article = getAllArticles().find(a => a.id === articleId);
    if (!article) return;
    const modal = document.getElementById('article-detail-modal');
    const content = document.getElementById('article-detail-content');
    const title = document.getElementById('article-detail-title');
    if (!modal || !content) return;

    title.textContent = article.title;
    const fc = article.fullContent;
    const cfg = MOOD_CONFIG[article.mood] || MOOD_CONFIG.joy;

    content.innerHTML = `
        <div style="margin-bottom:1rem;">
            <span style="background:${cfg.bg};color:${cfg.text};padding:0.2rem 0.6rem;border-radius:6px;font-size:0.75rem;font-weight:600;">${cfg.label}</span>
            <span style="background:#e0e7ff;color:#4338ca;padding:0.2rem 0.6rem;border-radius:6px;font-size:0.75rem;font-weight:600;margin-left:0.4rem;">${article.category}</span>
            <span style="color:#94a3b8;font-size:0.8rem;margin-left:0.4rem;">${article.readTime}</span>
        </div>
        ${fc.subtitle ? `<h3 style="font-size:1rem;font-weight:700;color:#1e293b;margin-bottom:1rem;">${fc.subtitle}</h3>` : ''}
        ${fc.image ? `<img src="${fc.image}" alt="" style="width:100%;border-radius:12px;margin-bottom:1rem;object-fit:cover;max-height:200px;">` : ''}
        <p style="font-size:0.9rem;line-height:1.7;color:#374151;margin-bottom:1rem;">${fc.mainText}</p>
        ${fc.mainText2 ? `<p style="font-size:0.9rem;line-height:1.7;color:#374151;margin-bottom:1rem;">${fc.mainText2}</p>` : ''}
        ${fc.tips?.length ? `
            <h4 style="font-size:0.95rem;font-weight:700;color:#1e293b;margin:1.25rem 0 0.75rem;">Key Takeaways</h4>
            ${fc.tips.map(tip => `
                <div style="background:#f8fafc;border-left:3px solid ${cfg.color};padding:0.75rem 1rem;border-radius:0 8px 8px 0;margin-bottom:0.75rem;">
                    <div style="font-weight:600;font-size:0.88rem;color:#1e293b;margin-bottom:0.25rem;">${tip.title}</div>
                    <div style="font-size:0.83rem;color:#64748b;line-height:1.6;">${tip.description}</div>
                </div>
            `).join('')}
        ` : ''}
        ${fc.sources?.length ? `
            <h4 style="font-size:0.9rem;font-weight:700;color:#1e293b;margin:1.25rem 0 0.5rem;">Sources</h4>
            ${fc.sources.map(s => `
                <a href="${s.url}" target="_blank" rel="noopener" style="display:block;font-size:0.8rem;color:#3b82f6;margin-bottom:0.35rem;text-decoration:none;">${s.title}</a>
            `).join('')}
        ` : ''}
    `;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeArticleDetail() {
    const modal = document.getElementById('article-detail-modal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

// Open coping detail
function openCopingDetail(copingId) {
    const guide = getAllCoping().find(c => c.id === copingId);
    if (!guide) return;
    const modal = document.getElementById('coping-detail-modal');
    const content = document.getElementById('coping-detail-content');
    const title = document.getElementById('coping-detail-title');
    if (!modal || !content) return;

    title.textContent = guide.title;
    const fc = guide.fullContent;
    const cfg = MOOD_CONFIG[guide.mood] || MOOD_CONFIG.joy;

    content.innerHTML = `
        <div style="margin-bottom:1rem;">
            <span style="background:${cfg.bg};color:${cfg.text};padding:0.2rem 0.6rem;border-radius:6px;font-size:0.75rem;font-weight:600;">${cfg.label}</span>
            <span style="background:#ccfbf1;color:#0f766e;padding:0.2rem 0.6rem;border-radius:6px;font-size:0.75rem;font-weight:600;margin-left:0.4rem;">${guide.category}</span>
            <span style="color:#94a3b8;font-size:0.8rem;margin-left:0.4rem;">${guide.duration}</span>
        </div>
        ${fc.objective ? `<div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:0.75rem 1rem;border-radius:0 8px 8px 0;margin-bottom:1.25rem;font-size:0.88rem;color:#374151;line-height:1.6;">${fc.objective}</div>` : ''}
        ${fc.steps?.length ? `
            <h4 style="font-size:0.95rem;font-weight:700;color:#1e293b;margin-bottom:0.75rem;">Steps</h4>
            ${fc.steps.map(step => `
                <div style="display:flex;gap:0.75rem;margin-bottom:1rem;align-items:flex-start;">
                    <div style="background:${cfg.color};color:${cfg.text};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;flex-shrink:0;">${step.number}</div>
                    <div>
                        <div style="font-weight:600;font-size:0.88rem;color:#1e293b;margin-bottom:0.2rem;">${step.title}</div>
                        <div style="font-size:0.83rem;color:#64748b;line-height:1.6;">${step.instruction}</div>
                    </div>
                </div>
            `).join('')}
        ` : ''}
    `;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeCopingDetail() {
    const modal = document.getElementById('coping-detail-modal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

// Main update function
async function updateMoodResources() {
    const latestMood = normalizeToInsideOut(getLatestMood());
    updateMoodStatusBanner(latestMood);
    renderArticlesPreview();
    renderCopingPreview();
}

// Initialize
window.addEventListener('DOMContentLoaded', async () => {
    await loadMoodResources();
    updateMoodResources();
});

// Expose globals
window.openArticlesModal = openArticlesModal;
window.closeArticlesModal = closeArticlesModal;
window.openCopingModal = openCopingModal;
window.closeCopingModal = closeCopingModal;
window.openArticleDetail = openArticleDetail;
window.closeArticleDetail = closeArticleDetail;
window.openCopingDetail = openCopingDetail;
window.closeCopingDetail = closeCopingDetail;
window.filterArticlesByMood = filterArticlesByMood;
window.filterCopingByMood = filterCopingByMood;
window.updateMoodResources = updateMoodResources;
