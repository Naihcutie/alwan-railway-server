// ═══════════════════════════════════════════════════════════════
// Alwan — Theme Customization
// ═══════════════════════════════════════════════════════════════

// Available color themes
const THEMES = {
  'light-blue': { name: 'Light Blue', color: '#2563eb' },
  'green': { name: 'Green', color: '#059669' },
  'orange': { name: 'Orange', color: '#ea580c' },
  'red': { name: 'Red', color: '#dc2626' },
  'purple': { name: 'Purple', color: '#7c3aed' },
  'pink': { name: 'Pink', color: '#db2777' },
  'teal': { name: 'Teal', color: '#0d9488' }
};

// iOS-safe storage helpers
function _themeStorageGet(key) {
  try { const v = localStorage.getItem(key); if (v !== null) return v; } catch(e) {}
  try { return sessionStorage.getItem(key); } catch(_) { return null; }
}
function _themeStorageSet(key, val) {
  try { localStorage.setItem(key, val); } catch(e) {
    try { sessionStorage.setItem(key, val); } catch(_) {}
  }
}

// Get current theme from localStorage or default
function getCurrentTheme() {
  return _themeStorageGet('Alwan-theme') || 'light-blue';
}

// Set theme
function setTheme(themeName) {
  if (!THEMES[themeName]) {
    console.warn(`Theme "${themeName}" not found, using default`);
    themeName = 'light-blue';
  }
  
  document.body.setAttribute('data-theme', themeName);
  _themeStorageSet('Alwan-theme', themeName);
  
  // Update theme selector if it exists
  updateThemeSelector(themeName);
}

// Update theme selector UI
function updateThemeSelector(currentTheme) {
  const buttons = document.querySelectorAll('.theme-option');
  buttons.forEach(btn => {
    if (btn.dataset.theme === currentTheme) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Initialize theme on page load
function initTheme() {
  const savedTheme = getCurrentTheme();
  setTheme(savedTheme);
}

// Create theme selector modal HTML
function createThemeSelector() {
  const modal = document.createElement('div');
  modal.id = 'theme-selector-modal';
  modal.className = 'mood-modal';
  modal.innerHTML = `
    <div class="mood-modal-overlay" onclick="closeThemeSelector()"></div>
    <div class="mood-modal-sheet">
      <div class="modal-header">
        <button type="button" class="modal-back-btn" onclick="closeThemeSelector()">
          <i class="bi bi-arrow-left"></i>
        </button>
        <h2 class="sheet-title">Choose Theme Color</h2>
        <div style="width: 40px;"></div>
      </div>
      <div class="modal-content" style="padding: 1.5rem;">
        <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">
          Select your preferred color theme
        </p>
        <div class="theme-options-grid">
          ${Object.entries(THEMES).map(([key, theme]) => `
            <button class="theme-option" data-theme="${key}" onclick="selectTheme('${key}')">
              <div class="theme-color-preview" style="background: ${theme.color};"></div>
              <span class="theme-name">${theme.name}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Open theme selector
function openThemeSelector() {
  let modal = document.getElementById('theme-selector-modal');
  if (!modal) {
    createThemeSelector();
    modal = document.getElementById('theme-selector-modal');
  }
  modal.classList.add('active');
  updateThemeSelector(getCurrentTheme());
}

// Close theme selector
function closeThemeSelector() {
  const modal = document.getElementById('theme-selector-modal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// Select theme from modal
function selectTheme(themeName) {
  setTheme(themeName);
  setTimeout(() => closeThemeSelector(), 300);
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme);
} else {
  initTheme();
}
