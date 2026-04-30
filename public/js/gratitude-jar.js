(function () {
    const STORAGE_KEY = 'psyc_gratitude_jar_notes_v1';
    const JARS_KEY = 'psyc_gratitude_jar_collection_v1';
    const JAR_CAPACITY = 50;
    const MAX_VISIBLE_NOTES = 50;
    const PROMPTS = [
        'What felt lighter today because of someone else?',
        'What ordinary thing made your day easier?',
        'What part of your routine are you quietly thankful for?',
        'Who showed care for you, even in a small way?',
        'What is something your body helped you do today?',
        'What memory would you like to keep from this week?',
        'What challenge are you grateful you survived?',
        'What place made you feel safe or calm today?',
        'What skill or strength helped you lately?',
        'What made you smile without warning?',
        'What are you thankful to have learned recently?',
        'What comfort do you often forget to appreciate?'
    ];

    const TYPE_META = {
        leaf: {
            label: 'Leaf note',
            icon: '/assets/logo/leaf.png',
            fill: '#dcfce7',
            stroke: '#16a34a',
            text: '#14532d',
            shadow: 'rgba(22, 163, 74, 0.18)'
        },
        heart: {
            label: 'Heart note',
            icon: '/assets/logo/heartjar.png',
            fill: '#fce7f3',
            stroke: '#db2777',
            text: '#831843',
            shadow: 'rgba(219, 39, 119, 0.18)'
        },
        fish: {
            label: 'Fish note',
            icon: '/assets/logo/jarfish.png',
            fill: '#dbeafe',
            stroke: '#2563eb',
            text: '#1e3a8a',
            shadow: 'rgba(37, 99, 235, 0.16)'
        }
    };

    const state = {
        notes: [],
        canvas: null,
        ctx: null,
        homePreviewCanvas: null,
        homePreviewCtx: null,
        hitBoxes: [],
        tick: 0,
        shake: 0,
        lastShakeX: 0,
        lastShakeY: 0,
        selectedType: 'leaf',
        activePrompt: '',
        promptVisible: false,
        hiddenNoteId: null,
        randomPreviewTimer: null,
        randomPreviewNoteId: null,
        shuffleUntil: 0,
        lidProgress: 0,
        lidTarget: 0,
        launchingNote: null,
        noteImages: {},
        elements: {}
    };

    function loadNoteImages() {
        Object.entries(TYPE_META).forEach(([type, meta]) => {
            const image = new Image();
            image.src = meta.icon;
            state.noteImages[type] = image;
        });
    }

    function safeParseNotes() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Failed to parse gratitude notes:', error);
            return [];
        }
    }

    function saveNotes() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes.map(note => ({
            id: note.id,
            text: note.text,
            type: note.type,
            createdAt: note.createdAt
        }))));
        renderHomePreview();
    }

    function loadJarCollection() {
        try {
            const raw = localStorage.getItem(JARS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    function sealCurrentJar() {
        if (state.notes.length === 0) return;
        const collection = loadJarCollection();
        collection.push({
            id: `jar_${Date.now()}`,
            sealedAt: Date.now(),
            notes: state.notes.map(n => ({ id: n.id, text: n.text, type: n.type, createdAt: n.createdAt }))
        });
        localStorage.setItem(JARS_KEY, JSON.stringify(collection));
        state.notes = [];
        saveNotes();
        computeTargets(true);
        formatCount();
        if (typeof window.ldToast === 'function') window.ldToast('Jar sealed and saved to your collection!', 'success');
    }

    function ensureNoteRuntime(note) {
        return {
            id: note.id || `gj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            text: note.text || '',
            type: TYPE_META[note.type] ? note.type : 'leaf',
            createdAt: note.createdAt || Date.now(),
            x: typeof note.x === 'number' ? note.x : 160,
            y: typeof note.y === 'number' ? note.y : 94,
            tx: typeof note.tx === 'number' ? note.tx : 160,
            ty: typeof note.ty === 'number' ? note.ty : 340,
            vx: 0,
            vy: 0,
            rot: typeof note.rot === 'number' ? note.rot : 0,
            trot: typeof note.trot === 'number' ? note.trot : 0,
            vr: typeof note.vr === 'number' ? note.vr : 0,
            settled: !!note.settled,
            alpha: typeof note.alpha === 'number' ? note.alpha : 1
        };
    }

    function formatCount() {
        const count = state.notes.length;
        const el = state.elements.count;
        const hint = state.elements.hint;
        const heroKicker = state.elements.heroKicker;
        const heroTitle = state.elements.heroTitle;
        const heroSubtitle = state.elements.heroSubtitle;
        const homeCount = state.elements.homePreviewCount;
        const sealBtn = document.getElementById('gj-seal-btn');
        const primaryBtn = state.elements.primaryLabel?.parentElement;
        const collection = loadJarCollection();
        const hasIncompleteJarInCollection = collection.some((jar) =>
            Array.isArray(jar?.notes) && jar.notes.length < JAR_CAPACITY
        );

        if (el) {
            if (count === 0) {
                el.textContent = '0 notes inside';
            } else if (count === 1) {
                el.textContent = '1 note inside';
            } else {
                el.textContent = `${count} notes inside`;
            }
        }

        if (homeCount) {
            homeCount.textContent = count === 1 ? '1 note' : `${count} notes`;
        }

        if (primaryBtn) {
            primaryBtn.disabled = false;
            primaryBtn.style.opacity = '';
            primaryBtn.style.display = count >= JAR_CAPACITY ? 'none' : 'inline-flex';
        }

        if (sealBtn) {
            const canCreateNew = count >= JAR_CAPACITY && !hasIncompleteJarInCollection;
            sealBtn.style.display = canCreateNew ? 'inline-flex' : 'none';
        }

        if (count === 0) {
            if (hint) hint.textContent = 'Choose leaf, heart, or fish before saving a note.';
            if (heroKicker) heroKicker.textContent = 'Daily Ritual';
            if (heroTitle) heroTitle.textContent = 'Gratitude Jar';
            if (heroSubtitle) heroSubtitle.textContent = 'One small grateful thought can grow into a joyful collection.';
            return;
        }

        if (hint) hint.textContent = 'Tap a note in the jar to read it again any time.';
        if (heroKicker) heroKicker.textContent = count >= JAR_CAPACITY ? 'Jar Full!' : (count > 3 ? 'Beautiful Progress' : 'Keep Going');
        if (heroTitle) heroTitle.textContent = count >= JAR_CAPACITY ? 'Jar is Full' : 'Great Job!';
        if (heroSubtitle) heroSubtitle.textContent = count >= JAR_CAPACITY
            ? (hasIncompleteJarInCollection
                ? 'This jar is full. Pick up your unfinished jar from collection.'
                : 'This jar is full. Tap + New to start another jar.')
            : 'Every entry is a step towards a more joyful mindset.';

        if (state.elements.primaryLabel) {
            state.elements.primaryLabel.textContent = 'Write Gratitude';
        }
    }

    function pickPrompt(excludeCurrent) {
        const pool = excludeCurrent && state.activePrompt && PROMPTS.length > 1
            ? PROMPTS.filter(prompt => prompt !== state.activePrompt)
            : [...PROMPTS];
        return pool[Math.floor(Math.random() * pool.length)] || PROMPTS[0] || '';
    }

    function renderPromptPanel() {
        const card = state.elements.promptCard;
        const promptText = state.elements.promptText;
        const toggle = state.elements.promptToggle;
        const toggleLabel = state.elements.promptToggleLabel;
        const toggleIcon = state.elements.promptToggleIcon;

        if (promptText) {
            promptText.textContent = state.activePrompt || 'What is one small thing you feel thankful for right now?';
        }

        if (card) {
            card.classList.toggle('is-hidden', !state.promptVisible);
        }

        if (toggle) {
            toggle.setAttribute('aria-expanded', state.promptVisible ? 'true' : 'false');
        }

        if (toggleLabel) {
            toggleLabel.textContent = state.promptVisible ? 'Close prompt' : 'Show prompt';
        }

        if (toggleIcon) {
            toggleIcon.textContent = state.promptVisible ? '×' : '+';
            toggleIcon.setAttribute('aria-hidden', state.promptVisible ? 'false' : 'true');
        }
    }

    function samplePrompts(forceRefresh) {
        state.activePrompt = pickPrompt(Boolean(forceRefresh));
        renderPromptPanel();
    }

    function togglePromptPanel(forceVisible) {
        state.promptVisible = typeof forceVisible === 'boolean' ? forceVisible : !state.promptVisible;
        renderPromptPanel();
    }

    function refreshPrompt() {
        samplePrompts(true);
    }

    function applyPrompt(prompt) {
        const input = state.elements.input;
        const promptText = prompt || state.activePrompt;
        if (!input || !promptText) return;
        input.value = input.value.trim() ? `${input.value.trim()} ${promptText}`.trim() : promptText;
        updateInputCount();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    function updateInputCount() {
        if (!state.elements.inputCount || !state.elements.input) return;
        state.elements.inputCount.textContent = state.elements.input.value.length;
    }

    function openModal(modal) {
        if (!modal) return;
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove('open');
        const anyOpen = document.querySelector('.mood-modal.open');
        document.body.style.overflow = anyOpen ? 'hidden' : '';
    }

    function setSelectedType(type) {
        state.selectedType = TYPE_META[type] ? type : 'leaf';
        state.elements.typeButtons.forEach(btn => {
            const active = btn.dataset.noteType === state.selectedType;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function openEditor() {
        setSelectedType(state.selectedType || 'leaf');
        if (state.elements.input) {
            state.elements.input.value = '';
            updateInputCount();
        }
        state.promptVisible = false;
        samplePrompts(true);
        openModal(state.elements.editorModal);
        setTimeout(() => state.elements.input?.focus(), 80);
    }

    function closeEditor() {
        closeModal(state.elements.editorModal);
    }

    function openListModal() {
        renderNotesList();
        openModal(state.elements.listModal);
    }

    function closeListModal() {
        closeModal(state.elements.listModal);
    }

    function openInfoModal() {
        openModal(state.elements.infoModal);
    }

    function closeInfoModal() {
        closeModal(state.elements.infoModal);
    }

    function closePreviewModal() {
        state.lidTarget = 0;
        restoreHiddenPreviewNote();
        closeModal(state.elements.previewModal);
    }

    function exitToHome() {
        closeFullscreen();
        closeEditor();
        closeListModal();
        closeInfoModal();
        closePreviewModal();
        if (typeof window.ldTab === 'function') {
            window.ldTab('home');
        }
    }

    function toggleFullscreen() {
        const tab = state.elements.tab;
        if (!tab || window.innerWidth < 641) return;
        tab.classList.toggle('gj-desktop-fullscreen');
        document.body.style.overflow = tab.classList.contains('gj-desktop-fullscreen') ? 'hidden' : '';
    }

    function closeFullscreen() {
        const tab = state.elements.tab;
        if (!tab) return;
        tab.classList.remove('gj-desktop-fullscreen');
        const anyOpen = document.querySelector('.mood-modal.open');
        document.body.style.overflow = anyOpen ? 'hidden' : '';
    }

    function handleViewportChange() {
        if (window.innerWidth < 641) {
            closeFullscreen();
        }
    }

    function handleGlobalKeydown(event) {
        if (event.key === 'Escape') {
            closeFullscreen();
        }
    }

    function showPreview(note, sourceLabel) {
        const meta = TYPE_META[note.type] || TYPE_META.leaf;
        if (state.elements.previewIcon) state.elements.previewIcon.src = meta.icon;
        if (state.elements.previewType) state.elements.previewType.textContent = meta.label;
        if (state.elements.previewText) state.elements.previewText.textContent = note.text;
        if (state.elements.previewMeta) {
            const date = new Date(note.createdAt);
            state.elements.previewMeta.textContent = `${sourceLabel || 'Saved note'} • ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }
        openModal(state.elements.previewModal);
    }

    function getRenderableNotes() {
        return state.notes.filter(note => note.id !== state.hiddenNoteId);
    }

    function startShuffle(selectedId) {
        const renderable = getRenderableNotes().slice(-MAX_VISIBLE_NOTES);
        state.shuffleUntil = performance.now() + 650;

        // Re-scatter to new random targets so notes don't return to same spots
        scatterNotes();

        renderable.forEach(note => {
            note.settled = false;
            note.vx = (Math.random() * 3.8) - 1.9 + (note.id === selectedId ? 0.4 : 0);
            note.vy = -(Math.random() * 2.4 + 0.4);
            note.vr = (Math.random() * 0.24) - 0.12;
            // shuffleTx/Ty now come from scatterNotes targets
            note.shuffleTx = note.tx;
            note.shuffleTy = note.ty;
            note.shuffleTrot = note.trot;
        });
    }

    function hideNoteForPreview(noteId) {
        state.hiddenNoteId = noteId;
        computeTargets(false);
    }

    function restoreHiddenPreviewNote() {
        if (!state.hiddenNoteId) return;
        const note = state.notes.find(entry => entry.id === state.hiddenNoteId);
        state.hiddenNoteId = null;
        state.randomPreviewNoteId = null;
        state.shuffleUntil = 0;
        state.launchingNote = null;
        if (!note) {
            computeTargets(false);
            return;
        }

        note.x = 160 + (Math.random() * 34 - 17);
        note.y = 92;
        note.vx = (Math.random() * 1.6) - 0.8;
        note.vy = 1.1;
        note.vr = (Math.random() * 0.16) - 0.08;
        note.alpha = 0;
        note.settled = false;
        computeTargets(false);
    }

    function beginRandomLaunch(note) {
        hideNoteForPreview(note.id);
        state.lidTarget = 1;
        state.shake = 28;
        state.launchingNote = {
            id: note.id,
            type: note.type,
            text: note.text,
            createdAt: note.createdAt,
            sourceLabel: 'Random note',
            x: 160,
            y: 148,
            vx: (Math.random() * 0.8) - 0.4,
            vy: -5.2,
            rot: note.rot,
            vr: (Math.random() * 0.18) - 0.09,
            shown: false
        };
    }

    function peekRandom() {
        if (!state.notes.length) {
            showPreview({
                text: 'Your jar is empty. Add one gratitude note to begin your collection.',
                type: 'leaf',
                createdAt: Date.now()
            }, 'Jar empty');
            return;
        }
        if (state.randomPreviewTimer) {
            clearTimeout(state.randomPreviewTimer);
            state.randomPreviewTimer = null;
        }

        const renderable = getRenderableNotes();
        if (!renderable.length) return;

        const note = renderable[Math.floor(Math.random() * renderable.length)];
        state.randomPreviewNoteId = note.id;
        startShuffle(note.id);
        state.shake = 22;

        state.randomPreviewTimer = setTimeout(() => {
            state.randomPreviewTimer = null;
            const picked = state.notes.find(entry => entry.id === state.randomPreviewNoteId);
            if (!picked) return;
            beginRandomLaunch(picked);
        }, 650);
    }

    function deleteNote(noteId) {
        const next = state.notes.filter(note => note.id !== noteId);
        if (next.length === state.notes.length) return;
        state.notes = next;
        computeTargets(true);
        saveNotes();
        formatCount();
        renderNotesList();
        if (typeof window.ldToast === 'function') {
            window.ldToast('Note removed from your gratitude jar', 'info');
        }
    }

    function renderNotesList() {
        const container = state.elements.listContainer;
        if (!container) return;

        if (!state.notes.length) {
            container.innerHTML = `
                <div class="gj-list-empty">
                    <div style="font-size:2rem;">🫙</div>
                    <div style="margin-top:10px;font-weight:700;">Your gratitude jar is still empty.</div>
                    <div style="margin-top:6px;font-size:0.85rem;">Add your first note and it will appear here.</div>
                </div>
            `;
            return;
        }

        const list = document.createElement('div');
        list.className = 'gj-list';

        [...state.notes].reverse().forEach(note => {
            const meta = TYPE_META[note.type] || TYPE_META.leaf;
            const card = document.createElement('div');
            card.className = 'gj-note-card';
            card.innerHTML = `
                <div class="gj-note-card-top">
                    <div class="gj-note-meta">
                        <div class="gj-note-badge"><img src="${meta.icon}" alt="${meta.label}"></div>
                        <div class="gj-note-date">${new Date(note.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                    </div>
                    <div class="gj-note-actions">
                        <button type="button" class="gj-note-action preview">Read</button>
                        <button type="button" class="gj-note-action delete">Delete</button>
                    </div>
                </div>
            `;
            card.querySelector('.gj-note-action.preview').addEventListener('click', () => {
                closeListModal();
                if (typeof window.ldTab === 'function') {
                    window.ldTab('gratitude');
                }
                showPreview(note, 'Saved note');
                state.shake = 10;
            });
            card.querySelector('.gj-note-action.delete').addEventListener('click', () => deleteNote(note.id));
            list.appendChild(card);
        });

        container.innerHTML = '';
        container.appendChild(list);
    }

    function saveFromEditor() {
        const input = state.elements.input;
        if (!input) return;
        const text = input.value.trim();
        if (!text) {
            if (typeof window.ldToast === 'function') window.ldToast('Write a gratitude note first', 'error');
            input.focus();
            return;
        }
        if (state.notes.length >= JAR_CAPACITY) {
            if (typeof window.ldToast === 'function') window.ldToast('This jar is full! Seal it to start a new one.', 'error');
            closeEditor();
            return;
        }

        const note = ensureNoteRuntime({
            id: `gj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            text,
            type: state.selectedType,
            createdAt: Date.now(),
            x: 160 + (Math.random() * 36 - 18),
            y: 90,
            vx: (Math.random() * 1.8) - 0.9,
            vy: 1.2,
            rot: (Math.random() * 0.7) - 0.35,
            vr: (Math.random() * 0.16) - 0.08,
            alpha: 0
        });

        state.notes.push(note);
        computeTargets(false);
        saveNotes();
        formatCount();
        closeEditor();
        state.shake = 20;

        if (typeof window.ldToast === 'function') {
            window.ldToast('Added to your gratitude jar', 'success');
        }
    }

    function computeTargets(repositionAll) {
        const visible = getRenderableNotes().slice(-MAX_VISIBLE_NOTES);
        // Just assign stable random X targets — gravity handles Y (notes fall to bottom)
        visible.forEach((note, i) => {
            const seed = (note.id ? note.id.charCodeAt(0) * 31 + note.id.charCodeAt(note.id.length - 1) * 17 : 0) + i * 137;
            const rng = (s) => {
                const v = Math.sin(seed * 127.1 + s * 311.7) * 43758.5453;
                return v - Math.floor(v);
            };
            const { radius } = getNoteDimensions(note);
            // Start near bottom, let gravity settle them
            const ty = 300 + rng(0) * 120;
            const jarHalf = getJarHalfWidth(ty);
            const usable = Math.max(radius, jarHalf - radius);
            const tx = 160 - usable + rng(1) * usable * 2;
            note.tx = tx;
            note.ty = ty;
            note.trot = (rng(2) - 0.5) * 0.6;
            if (repositionAll) {
                note.x = tx;
                note.y = ty;
                note.rot = note.trot;
                note.vx = 0; note.vy = 0; note.vr = 0;
                note.alpha = 1;
                note.settled = true;
            }
        });
    }

    function scatterNotes() {
        const visible = getRenderableNotes().slice(-MAX_VISIBLE_NOTES);
        visible.forEach((note) => {
            const { radius } = getNoteDimensions(note);
            const ty = 200 + Math.random() * 150;
            const jarHalf = getJarHalfWidth(ty);
            const usable = Math.max(radius, jarHalf - radius);
            note.tx = 160 - usable + Math.random() * usable * 2;
            note.ty = ty;
            note.trot = (Math.random() - 0.5) * 0.6;
            note.settled = false;
            note.vx = (Math.random() - 0.5) * 4;
            note.vy = -Math.random() * 3;
        });
    }

    function getNoteDimensions(note) {
        if (note.type === 'heart') {
            return { width: 46, height: 46, radius: 19 };
        }
        if (note.type === 'fish') {
            return { width: 52, height: 34, radius: 20 };
        }
        return { width: 42, height: 42, radius: 18 };
    }

    function drawNoteSpriteOn(ctx, type, x, y, rot, width, height) {
        const meta = TYPE_META[type] || TYPE_META.leaf;
        const img = state.noteImages[type];
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.shadowColor = meta.shadow;
        ctx.shadowBlur = 10;
        if (img && img.complete) {
            ctx.drawImage(img, -width / 2, -height / 2, width, height);
        }
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    function renderHomePreview() {
        const ctx = state.homePreviewCtx;
        const canvas = state.homePreviewCanvas;
        if (!ctx || !canvas) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(0.5, 0.44);
        ctx.translate(120, 26);

        const visible = getRenderableNotes().slice(-8);
        ctx.save();
        jarBodyPath(ctx, 160);
        ctx.clip();
        visible.forEach(note => {
            const x = note.x;
            const y = note.y;
            const rot = note.rot;
            const alpha = Math.max(0.45, note.alpha || 1);
            ctx.globalAlpha = alpha;
            if (note.type === 'heart') {
                drawNoteSpriteOn(ctx, 'heart', x, y, rot, 42, 42);
            } else if (note.type === 'fish') {
                drawNoteSpriteOn(ctx, 'fish', x, y, rot, 48, 31);
            } else {
                drawNoteSpriteOn(ctx, 'leaf', x, y, rot, 38, 38);
            }
            ctx.globalAlpha = 1;
        });
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(160, 426, 104, 20, 0, 0, Math.PI * 2);
        const bottomShadow = ctx.createLinearGradient(160, 406, 160, 446);
        bottomShadow.addColorStop(0, 'rgba(182, 140, 0, 0.12)');
        bottomShadow.addColorStop(1, 'rgba(150, 108, 0, 0.24)');
        ctx.fillStyle = bottomShadow;
        ctx.fill();
        ctx.restore();

        drawJarOn(ctx, 160, 0);
        ctx.restore();
    }

    function drawJarOn(ctx, cx, lidProgress) {
        const liftPhase = Math.min(1, lidProgress / 0.42);
        const rotatePhase = lidProgress <= 0.28 ? 0 : Math.min(1, (lidProgress - 0.28) / 0.72);
        const lidLift = liftPhase * 28;
        const lidRotate = rotatePhase * 0.72;
        const lidPivotX = cx - 34;
        const lidPivotY = 118;

        ctx.save();
        jarBodyPath(ctx, cx);
        ctx.clip();

        // Light glass base — fill the jar path shape (not a rectangle)
        ctx.save();
        jarBodyPath(ctx, cx);
        ctx.fillStyle = 'rgba(220, 238, 248, 0.22)';
        ctx.fill();
        ctx.restore();

        // Subtle edge darkening for glass depth — symmetric so no dark stripe
        const bodyFill = ctx.createLinearGradient(cx - 128, 0, cx + 128, 0);
        bodyFill.addColorStop(0,    'rgba(100, 150, 190, 0.12)');
        bodyFill.addColorStop(0.15, 'rgba(255, 255, 255, 0.06)');
        bodyFill.addColorStop(0.5,  'rgba(255, 255, 255, 0.0)');
        bodyFill.addColorStop(0.85, 'rgba(255, 255, 255, 0.06)');
        bodyFill.addColorStop(1,    'rgba(100, 150, 190, 0.12)');
        ctx.fillStyle = bodyFill;
        ctx.fillRect(18, 104, 284, 348);

        ctx.beginPath();
        ctx.ellipse(cx, 136, 58, 13, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(171, 197, 214, 0.12)';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cx + 24, 128);
        ctx.bezierCurveTo(cx + 64, 138, cx + 106, 172, cx + 124, 220);
        ctx.lineTo(cx + 128, 352);
        ctx.quadraticCurveTo(cx + 126, 404, cx + 94, 426);
        ctx.lineTo(cx + 34, 444);
        ctx.closePath();
        const sideGlow = ctx.createLinearGradient(cx + 30, 0, cx + 130, 0);
        sideGlow.addColorStop(0, 'rgba(255,255,255,0.0)');
        sideGlow.addColorStop(0.55, 'rgba(166,205,230,0.06)');
        sideGlow.addColorStop(1, 'rgba(120,164,196,0.10)');
        ctx.fillStyle = sideGlow;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cx - 82, 144);
        ctx.bezierCurveTo(cx - 96, 216, cx - 94, 336, cx - 80, 432);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx - 34, 138);
        ctx.bezierCurveTo(cx - 44, 210, cx - 42, 334, cx - 30, 430);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx + 82, 144);
        ctx.bezierCurveTo(cx + 94, 216, cx + 94, 336, cx + 80, 432);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(cx, 412, 90, 17, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120, 120, 120, 0.26)';
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(cx, 412, 90, 17, 0, Math.PI * 0.08, Math.PI * 0.92);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        jarBodyPath(ctx, cx);
        ctx.strokeStyle = '#1c1c1c';
        ctx.lineWidth = 5.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(lidPivotX, lidPivotY - lidLift);
        ctx.rotate(lidRotate);
        ctx.translate(-lidPivotX, -lidPivotY);

        ctx.beginPath();
        ctx.moveTo(cx - 78, 114);
        ctx.lineTo(cx + 78, 114);
        ctx.lineTo(cx + 78, 128);
        ctx.bezierCurveTo(cx + 78, 136, cx + 64, 140, cx + 44, 141);
        ctx.lineTo(cx - 44, 141);
        ctx.bezierCurveTo(cx - 64, 140, cx - 78, 136, cx - 78, 128);
        ctx.closePath();
        const rimWallFill = ctx.createLinearGradient(cx - 70, 114, cx + 70, 137);
        rimWallFill.addColorStop(0, '#c7d1da');
        rimWallFill.addColorStop(0.5, '#edf3f8');
        rimWallFill.addColorStop(1, '#b5c0cb');
        ctx.fillStyle = rimWallFill;
        ctx.fill();
        ctx.strokeStyle = '#1c1c1c';
        ctx.lineWidth = 2.4;
        ctx.lineJoin = 'round';
        ctx.stroke();

        jarNeckPath(ctx, cx);
        const rimOuter = ctx.createLinearGradient(cx - 74, 96, cx + 74, 128);
        rimOuter.addColorStop(0, '#dbe4ec');
        rimOuter.addColorStop(0.3, '#f8fbfd');
        rimOuter.addColorStop(0.7, '#cbd5de');
        rimOuter.addColorStop(1, '#aab4bf');
        ctx.fillStyle = rimOuter;
        ctx.fill();
        ctx.strokeStyle = '#1c1c1c';
        ctx.lineWidth = 3.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(cx, 114, 54, 9, 0, 0, Math.PI * 2);
        const mouthFill = ctx.createLinearGradient(cx - 52, 106, cx + 52, 122);
        mouthFill.addColorStop(0, '#aeb9c4');
        mouthFill.addColorStop(0.5, '#d9e2ea');
        mouthFill.addColorStop(1, '#9ea9b5');
        ctx.fillStyle = mouthFill;
        ctx.fill();
        ctx.strokeStyle = '#1c1c1c';
        ctx.lineWidth = 2.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(cx, 114, 42, 7, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(238,243,247,0.98)';
        ctx.fill();
        ctx.strokeStyle = '#1c1c1c';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
    }

    function getJarHalfWidth(y) {
        // Returns inner usable half-width matching the actual jarBodyPath geometry
        let outer;
        if (y <= 144) {
            outer = 52; // straight neck
        } else if (y <= 184) {
            // bezier widens 52→88
            const t = (y - 144) / 40;
            outer = 52 + (88 - 52) * t;
        } else if (y <= 254) {
            // bezier widens 88→128
            const t = (y - 184) / 70;
            outer = 88 + (128 - 88) * t;
        } else if (y <= 352) {
            outer = 128; // straight belly — full width
        } else if (y <= 424) {
            // quadratic taper 128→100: X(t) = 128 - 28t²
            const t = (y - 352) / 72;
            outer = 128 - 28 * t * t;
        } else {
            // taper 100→24 at bottom
            const t = Math.min(1, (y - 424) / 20);
            outer = 100 + (24 - 100) * t;
        }
        return outer - 3; // subtract stroke half-width for inner glass edge
    }

    function applyJarCollision(note, floorY) {
        const cx = 160;
        const { radius } = getNoteDimensions(note);
        const minY = 148 + radius;
        const maxFloor = Math.min(floorY, 420 - radius);

        if (note.y < minY) {
            note.y = minY;
            if (note.vy < 0) note.vy *= -0.3;
        }

        const jarHalf = getJarHalfWidth(note.y);
        const halfWidth = Math.max(radius, jarHalf - radius);
        const minX = cx - halfWidth;
        const maxX = cx + halfWidth;

        if (note.x < minX) {
            note.x = minX;
            note.vx = Math.abs(note.vx || 0) * 0.4;
        } else if (note.x > maxX) {
            note.x = maxX;
            note.vx = -Math.abs(note.vx || 0) * 0.4;
        }

        if (note.y > maxFloor) {
            note.y = maxFloor;
            // Bounce with energy loss — stops floating
            note.vy = -Math.abs(note.vy || 0) * 0.28;
            note.vx *= 0.85;
            note.vr = (note.vr || 0) * 0.6;
        }
    }

    function updateAnimation() {
        const isShuffling = performance.now() < state.shuffleUntil;
        const visibleNotes = getRenderableNotes().slice(-MAX_VISIBLE_NOTES);
        const visibleSet = new Set(visibleNotes.map(note => note.id));

        state.notes.forEach(note => {
            if (!visibleSet.has(note.id)) return;

            const activeTrot = isShuffling && typeof note.shuffleTrot === 'number' ? note.shuffleTrot : note.trot;

            // Apply gravity always — notes fall to bottom
            note.vy = (note.vy || 0) + 0.55;
            note.vy = Math.min(note.vy, 10); // cap fall speed

            // Slight X drift toward target X so notes spread out
            if (!note.settled) {
                note.vx = (note.vx || 0) + (note.tx - note.x) * 0.004;
            }
            note.vx = (note.vx || 0) * 0.92; // friction

            note.x += note.vx;
            note.y += note.vy;
            note.vr = (note.vr || 0) + (activeTrot - note.rot) * 0.015;
            note.vr *= 0.88;
            note.rot += note.vr;
            note.alpha = Math.min(1, (note.alpha || 0) + 0.15);

            applyJarCollision(note, 420);

            // Settle when nearly stopped
            if (Math.abs(note.vy) < 0.3 && Math.abs(note.vx) < 0.3) {
                note.vy *= 0.8;
                note.vx *= 0.8;
                note.settled = true;
            } else {
                note.settled = false;
            }

            // Hard-clamp to jar walls every frame
            const { radius } = getNoteDimensions(note);
            const jarHalf = getJarHalfWidth(note.y);
            const wallMargin = jarHalf - radius;
            if (wallMargin > 0) {
                note.x = Math.max(160 - wallMargin, Math.min(160 + wallMargin, note.x));
            }

            note.rot += (note.trot - note.rot) * 0.04;
        });

        state.lidProgress += (state.lidTarget - state.lidProgress) * 0.14;

        // Note-to-note stacking collision — notes pile on top of each other
        for (let i = 0; i < visibleNotes.length; i++) {
            for (let j = i + 1; j < visibleNotes.length; j++) {
                const a = visibleNotes[i];
                const b = visibleNotes[j];
                const ra = getNoteDimensions(a).radius * 0.85;
                const rb = getNoteDimensions(b).radius * 0.85;
                const minDist = ra + rb;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
                if (dist < minDist) {
                    const overlap = (minDist - dist) / dist;
                    // Push mostly vertically so notes stack, not spread sideways
                    const pushX = dx * overlap * 0.2;
                    const pushY = dy * overlap * 0.5;
                    a.x -= pushX; a.y -= pushY;
                    b.x += pushX; b.y += pushY;
                    // Transfer some velocity — bottom note pushes up on top note
                    if (dy < 0) {
                        // b is above a — push b up
                        b.vy = Math.min(b.vy, -Math.abs(a.vy) * 0.15);
                    } else {
                        // a is above b — push a up
                        a.vy = Math.min(a.vy, -Math.abs(b.vy) * 0.15);
                    }
                    // Re-clamp to jar walls
                    [a, b].forEach(n => {
                        const { radius: r } = getNoteDimensions(n);
                        const jh = getJarHalfWidth(n.y);
                        const wm = jh - r;
                        if (wm > 0) n.x = Math.max(160 - wm, Math.min(160 + wm, n.x));
                        if (n.y < 148 + r) n.y = 148 + r;
                        if (n.y > 420 - r) n.y = 420 - r;
                    });
                }
            }
        }

        if (state.launchingNote) {
            const note = state.launchingNote;
            note.vy += 0.14;
            note.x += note.vx;
            note.y += note.vy;
            note.rot += note.vr;
            note.vr *= 0.99;
            if (!note.shown && note.y <= 72) {
                note.shown = true;
                showPreview(note, note.sourceLabel);
                state.launchingNote = null;
            }
        }
    }

    function jarBodyPath(ctx, cx) {
        ctx.beginPath();
        ctx.moveTo(cx - 52, 128);
        ctx.lineTo(cx - 52, 144);
        ctx.bezierCurveTo(cx - 52, 158, cx - 68, 170, cx - 88, 184);
        ctx.bezierCurveTo(cx - 112, 202, cx - 128, 226, cx - 128, 254);
        ctx.lineTo(cx - 128, 352);
        ctx.quadraticCurveTo(cx - 128, 404, cx - 100, 424);
        ctx.quadraticCurveTo(cx - 72, 442, cx - 24, 444);
        ctx.lineTo(cx + 24, 444);
        ctx.quadraticCurveTo(cx + 72, 442, cx + 100, 424);
        ctx.quadraticCurveTo(cx + 128, 404, cx + 128, 352);
        ctx.lineTo(cx + 128, 254);
        ctx.bezierCurveTo(cx + 128, 226, cx + 112, 202, cx + 88, 184);
        ctx.bezierCurveTo(cx + 68, 170, cx + 52, 158, cx + 52, 144);
        ctx.lineTo(cx + 52, 128);
        ctx.closePath();
    }

    function jarNeckPath(ctx, cx) {
        ctx.beginPath();
        ctx.ellipse(cx, 114, 78, 16, 0, 0, Math.PI * 2);
        ctx.closePath();
    }

    function jarLidPath(ctx, cx) {
        ctx.beginPath();
        ctx.ellipse(cx, 114, 54, 9, 0, 0, Math.PI * 2);
        ctx.closePath();
    }

    function drawJar() {
        drawJarOn(state.ctx, 160, state.lidProgress);
    }

    function drawNoteSprite(type, x, y, rot, width, height) {
        drawNoteSpriteOn(state.ctx, type, x, y, rot, width, height);
    }
    function drawNotes() {
        const ctx = state.ctx;
        const visible = getRenderableNotes().slice(-MAX_VISIBLE_NOTES);
        const shakeX = state.shake > 0 ? Math.sin(state.shake * 0.7) * state.shake * 0.55 : 0;
        const shakeY = state.shake > 0 ? Math.abs(Math.cos(state.shake * 0.45)) * state.shake * 0.08 : 0;
        state.lastShakeX = shakeX;
        state.lastShakeY = shakeY;
        state.hitBoxes = [];

        ctx.save();
        // Use the same jarBodyPath for clipping — notes are drawn inside the jar outline
        // The jar glass/reflections are drawn AFTER notes (in drawJar) so they overlay on top
        jarBodyPath(ctx, 160);
        ctx.clip();

        visible.forEach((note, index) => {
            const x = note.x + shakeX + Math.sin((state.tick + index * 11) * 0.02) * (state.shake > 0 ? 3 : 0);
            const y = note.y + shakeY;
            const rot = note.rot + (state.shake > 0 ? Math.cos((state.tick + index * 7) * 0.03) * 0.08 : 0);

            ctx.globalAlpha = note.alpha || 1;
            if (note.type === 'heart') {
                drawNoteSprite('heart', x, y, rot, 46, 46);
                state.hitBoxes.push({ id: note.id, x: x - 32, y: y - 30, w: 64, h: 64 });
            } else if (note.type === 'fish') {
                drawNoteSprite('fish', x, y, rot, 52, 34);
                state.hitBoxes.push({ id: note.id, x: x - 32, y: y - 22, w: 68, h: 44 });
            } else {
                drawNoteSprite('leaf', x, y, rot, 42, 42);
                state.hitBoxes.push({ id: note.id, x: x - 28, y: y - 28, w: 56, h: 56 });
            }
            ctx.globalAlpha = 1;
        });

        ctx.restore();
    }

    function drawLaunchingNote() {
        if (!state.launchingNote) return;
        const note = state.launchingNote;
        if (note.type === 'heart') {
            drawNoteSprite('heart', note.x, note.y, note.rot, 46, 46);
        } else if (note.type === 'fish') {
            drawNoteSprite('fish', note.x, note.y, note.rot, 52, 34);
        } else {
            drawNoteSprite('leaf', note.x, note.y, note.rot, 42, 42);
        }
    }

    function drawScene() {
        if (!state.ctx) return;
        state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
        updateAnimation();
        drawNotes();
        drawJar();
        drawLaunchingNote();
        renderHomePreview();
        if (state.shake > 0) state.shake -= 1;
        state.tick += 1;
        requestAnimationFrame(drawScene);
    }

    function findNoteByPoint(clientX, clientY) {
        const rect = state.canvas.getBoundingClientRect();
        const scaleX = state.canvas.width / rect.width;
        const scaleY = state.canvas.height / rect.height;
        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;

        for (let i = state.hitBoxes.length - 1; i >= 0; i -= 1) {
            const box = state.hitBoxes[i];
            if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
                return state.notes.find(note => note.id === box.id) || null;
            }
        }
        return null;
    }

    function handleCanvasClick(event) {
        const note = findNoteByPoint(event.clientX, event.clientY);
        if (note) {
            showPreview(note, 'Tapped note');
            state.shake = 8;
        } else {
            state.shake = 24;
        }
    }

    function bindEvents() {
        state.elements.typeButtons.forEach(btn => {
            btn.addEventListener('click', () => setSelectedType(btn.dataset.noteType));
        });

        state.elements.promptApply?.addEventListener('click', () => applyPrompt());
        state.elements.promptRefresh?.addEventListener('click', refreshPrompt);
        state.elements.promptToggle?.addEventListener('click', () => togglePromptPanel());
        state.elements.input?.addEventListener('input', updateInputCount);
        state.elements.input?.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                saveFromEditor();
            }
        });

        state.canvas?.addEventListener('click', handleCanvasClick);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('keydown', handleGlobalKeydown);
    }

    function openJarCollection() {
        const modal = document.getElementById('gj-collection-modal');
        if (!modal) return;
        renderJarShelf();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeJarCollection() {
        const modal = document.getElementById('gj-collection-modal');
        if (!modal) return;
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }

    function renderJarShelf() {
        const shelf = document.getElementById('gj-collection-shelf');
        if (!shelf) return;
        const collection = loadJarCollection();
        const activeJarId = localStorage.getItem('psyc_gratitude_jar_active_id') || 'current';

        shelf.innerHTML = '';

        // ── Active jar card ──────────────────────────────────────
        const activeCard = document.createElement('div');
        activeCard.className = 'gj-jar-card gj-jar-card-active';
        const activeCounts = { leaf: 0, heart: 0, fish: 0 };
        state.notes.forEach(n => { if (activeCounts[n.type] !== undefined) activeCounts[n.type]++; });
        activeCard.innerHTML = `
            <div class="gj-jar-card-badge">Active</div>
            <div class="gj-jar-card-icon">🫙</div>
            <div class="gj-jar-card-label">Current Jar</div>
            <div class="gj-jar-card-counts">
                <span>🍃 ${activeCounts.leaf}</span>
                <span>❤️ ${activeCounts.heart}</span>
                <span>🐟 ${activeCounts.fish}</span>
            </div>
            <div class="gj-jar-card-total">${state.notes.length} / ${JAR_CAPACITY} notes</div>
            <button type="button" class="gj-jar-view-btn" onclick="event.stopPropagation(); window.closeJarCollection?.(); window.ldTab?.('gratitude');">Open</button>
        `;
        shelf.appendChild(activeCard);

        if (collection.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'gj-collection-empty-inline';
            empty.innerHTML = `<div style="font-size:0.8rem;color:#94a3b8;padding:16px 0;">Seal your jar to add it to the collection.</div>`;
            shelf.appendChild(empty);
            return;
        }

        // ── Collection jars ──────────────────────────────────────
        collection.slice().reverse().forEach((jar, i) => {
            const realIndex = collection.length - 1 - i; // actual index in array
            const date = new Date(jar.sealedAt);
            const label = date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
            const counts = { leaf: 0, heart: 0, fish: 0 };
            jar.notes.forEach(n => { if (counts[n.type] !== undefined) counts[n.type]++; });
            const isDisplayed = jar.id === activeJarId;

            const card = document.createElement('div');
            card.className = 'gj-jar-card' + (isDisplayed ? ' gj-jar-card-displayed' : '');
            card.innerHTML = `
                <div class="gj-jar-card-icon">🫙</div>
                <div class="gj-jar-card-label">Jar ${realIndex + 1}</div>
                <div class="gj-jar-card-date">${label}</div>
                <div class="gj-jar-card-counts">
                    <span>🍃 ${counts.leaf}</span>
                    <span>❤️ ${counts.heart}</span>
                    <span>🐟 ${counts.fish}</span>
                </div>
                <div class="gj-jar-card-total">${jar.notes.length} notes</div>
                <div class="gj-jar-card-actions">
                    <button type="button" class="gj-jar-view-btn" data-jar-id="${jar.id}">View</button>
                    <button type="button" class="gj-jar-swap-btn" data-jar-id="${jar.id}">Display</button>
                </div>
            `;
            card.querySelector('.gj-jar-view-btn').onclick = (e) => { e.stopPropagation(); openJarViewer(jar); };
            card.querySelector('.gj-jar-swap-btn').onclick = (e) => { e.stopPropagation(); swapJar(jar.id); };
            shelf.appendChild(card);
        });
    }

    function renderJarCountMarkup(counts) {
        return `
            <span><img src="/assets/logo/leaf.png" alt=""><strong>${counts.leaf}</strong></span>
            <span><img src="/assets/logo/heartjar.png" alt=""><strong>${counts.heart}</strong></span>
            <span><img src="/assets/logo/jarfish.png" alt=""><strong>${counts.fish}</strong></span>
        `;
    }

    function getJarPreviewNotes(notes) {
        const layout = [
            { x: 106, y: 388, rot: -0.32 },
            { x: 136, y: 384, rot: -0.12 },
            { x: 166, y: 386, rot: 0.05 },
            { x: 194, y: 384, rot: 0.18 },
            { x: 220, y: 388, rot: 0.3 },
            { x: 126, y: 356, rot: -0.22 },
            { x: 160, y: 352, rot: 0.02 },
            { x: 196, y: 356, rot: 0.24 }
        ];

        return notes.slice(-layout.length).map((note, index) => ({
            ...note,
            ...layout[index]
        }));
    }

    function renderJarCardPreview(canvas, notes) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(0.5, 0.44);
        ctx.translate(120, 26);

        const visible = getJarPreviewNotes(notes);
        ctx.save();
        jarBodyPath(ctx, 160);
        ctx.clip();
        visible.forEach(note => {
            const alpha = Math.max(0.55, note.alpha || 1);
            ctx.globalAlpha = alpha;
            if (note.type === 'heart') {
                drawNoteSpriteOn(ctx, 'heart', note.x, note.y, note.rot, 42, 42);
            } else if (note.type === 'fish') {
                drawNoteSpriteOn(ctx, 'fish', note.x, note.y, note.rot, 48, 31);
            } else {
                drawNoteSpriteOn(ctx, 'leaf', note.x, note.y, note.rot, 38, 38);
            }
            ctx.globalAlpha = 1;
        });
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(160, 426, 104, 20, 0, 0, Math.PI * 2);
        const bottomShadow = ctx.createLinearGradient(160, 406, 160, 446);
        bottomShadow.addColorStop(0, 'rgba(182, 140, 0, 0.12)');
        bottomShadow.addColorStop(1, 'rgba(150, 108, 0, 0.24)');
        ctx.fillStyle = bottomShadow;
        ctx.fill();
        ctx.restore();

        drawJarOn(ctx, 160, 0);
        ctx.restore();
    }

    function renderJarShelf() {
        const shelf = document.getElementById('gj-collection-shelf');
        if (!shelf) return;
        const collection = loadJarCollection();
        const activeJarId = localStorage.getItem('psyc_gratitude_jar_active_id') || 'current';

        shelf.innerHTML = '';

        const activeCard = document.createElement('div');
        activeCard.className = 'gj-jar-card gj-jar-card-active';
        const activeCounts = { leaf: 0, heart: 0, fish: 0 };
        state.notes.forEach(note => {
            if (activeCounts[note.type] !== undefined) activeCounts[note.type] += 1;
        });
        activeCard.innerHTML = `
            <div class="gj-jar-card-badge">Active</div>
            <div class="gj-jar-card-main">
                <div class="gj-jar-card-media">
                    <div class="gj-jar-card-icon-wrap">
                        <canvas class="gj-jar-card-preview" width="280" height="220" aria-hidden="true"></canvas>
                    </div>
                    <div class="gj-jar-card-total">${state.notes.length} / ${JAR_CAPACITY} notes</div>
                </div>
                <div class="gj-jar-card-body">
                    <div class="gj-jar-card-topline">
                        <div class="gj-jar-card-label">Current Jar</div>
                    </div>
                    <div class="gj-jar-card-counts">${renderJarCountMarkup(activeCounts)}</div>
                </div>
                <div class="gj-jar-card-actions gj-jar-card-actions-side">
                    <button type="button" class="gj-jar-view-btn gj-jar-view-btn-single" onclick="event.stopPropagation(); window.closeJarCollection?.(); window.ldTab?.('gratitude');">Open</button>
                </div>
            </div>
        `;
        shelf.appendChild(activeCard);
        renderJarCardPreview(activeCard.querySelector('.gj-jar-card-preview'), state.notes);

        if (collection.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'gj-collection-empty-inline';
            empty.innerHTML = `<div style="font-size:0.8rem;color:#94a3b8;padding:16px 0;">Seal your jar to add it to the collection.</div>`;
            shelf.appendChild(empty);
            return;
        }

        collection.slice().reverse().forEach((jar, i) => {
            const realIndex = collection.length - 1 - i;
            const date = new Date(jar.sealedAt);
            const label = date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
            const counts = { leaf: 0, heart: 0, fish: 0 };
            jar.notes.forEach(note => {
                if (counts[note.type] !== undefined) counts[note.type] += 1;
            });
            const isDisplayed = jar.id === activeJarId;

            const card = document.createElement('div');
            card.className = 'gj-jar-card' + (isDisplayed ? ' gj-jar-card-displayed' : '');
            card.innerHTML = `
                ${isDisplayed ? '<div class="gj-jar-card-badge gj-jar-card-badge-secondary">Displayed</div>' : ''}
                <div class="gj-jar-card-main">
                    <div class="gj-jar-card-media">
                        <div class="gj-jar-card-icon-wrap">
                            <canvas class="gj-jar-card-preview" width="280" height="220" aria-hidden="true"></canvas>
                        </div>
                        <div class="gj-jar-card-total">${jar.notes.length} notes</div>
                    </div>
                    <div class="gj-jar-card-body">
                        <div class="gj-jar-card-topline">
                            <div class="gj-jar-card-label">Jar ${realIndex + 1}</div>
                            <div class="gj-jar-card-date">${label}</div>
                        </div>
                        <div class="gj-jar-card-counts">${renderJarCountMarkup(counts)}</div>
                    </div>
                    <div class="gj-jar-card-actions gj-jar-card-actions-side">
                        <button type="button" class="gj-jar-view-btn" data-jar-id="${jar.id}">View</button>
                        <button type="button" class="gj-jar-swap-btn" data-jar-id="${jar.id}">Pick up</button>
                    </div>
                </div>
            `;
            card.querySelector('.gj-jar-view-btn').onclick = (event) => {
                event.stopPropagation();
                openJarViewer(jar);
            };
            card.querySelector('.gj-jar-swap-btn').onclick = (event) => {
                event.stopPropagation();
                swapJar(jar.id);
            };
            shelf.appendChild(card);
            renderJarCardPreview(card.querySelector('.gj-jar-card-preview'), jar.notes);
        });
    }

    function swapJar(jarId) {
        const collection = loadJarCollection();
        const jarIndex = collection.findIndex(j => j.id === jarId);
        if (jarIndex === -1) return;

        const targetJar = collection[jarIndex];

        // Park current active jar back into collection (including unfinished/empty draft jars).
        collection.push({
            id: `jar_${Date.now()}`,
            sealedAt: Date.now(),
            notes: state.notes.map(n => ({ id: n.id, text: n.text, type: n.type, createdAt: n.createdAt }))
        });

        // Remove the target jar from collection
        collection.splice(jarIndex, 1);
        localStorage.setItem(JARS_KEY, JSON.stringify(collection));

        // Load target jar as active
        state.notes = targetJar.notes.map(n => ensureNoteRuntime(n));
        saveNotes();
        computeTargets(true);
        formatCount();
        state.shake = 24;

        // Re-render shelf
        renderJarShelf();
        closeJarCollection();

        if (typeof window.ldToast === 'function') window.ldToast('Jar swapped! Now displaying the selected jar.', 'success');
    }

    function openJarViewer(jar) {
        const modal = document.getElementById('gj-jar-viewer-modal');
        const list = document.getElementById('gj-jar-viewer-list');
        const title = document.getElementById('gj-jar-viewer-title');
        if (!modal || !list) return;
        const date = new Date(jar.sealedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        if (title) title.textContent = `Jar — ${date}`;
        list.innerHTML = '';

        if (!jar?.notes?.length) {
            list.innerHTML = `
                <div class="gj-list-empty">
                    <div style="font-size:1.6rem;">🫙</div>
                    <div style="margin-top:8px;font-weight:700;">No notes in this jar.</div>
                </div>
            `;
        } else {
            const container = document.createElement('div');
            container.className = 'gj-list';

            jar.notes.slice().reverse().forEach(note => {
                const meta = TYPE_META[note.type] || TYPE_META.leaf;
                const card = document.createElement('div');
                card.className = 'gj-note-card';
                card.innerHTML = `
                    <div class="gj-note-card-top">
                        <div class="gj-note-meta">
                            <div class="gj-note-badge"><img src="${meta.icon}" alt="${meta.label}"></div>
                            <div class="gj-note-date">${new Date(note.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                        </div>
                        <div class="gj-note-actions">
                            <button type="button" class="gj-note-action preview">View</button>
                        </div>
                    </div>
                `;

                card.querySelector('.gj-note-action.preview')?.addEventListener('click', () => {
                    closeJarViewer();
                    closeJarCollection();
                    setTimeout(() => {
                        showPreview(note, 'Saved note');
                        state.shake = 10;
                    }, 10);
                });

                container.appendChild(card);
            });

            list.appendChild(container);
        }

        modal.classList.add('open');
    }

    function closeJarViewer() {
        const modal = document.getElementById('gj-jar-viewer-modal');
        if (modal) modal.classList.remove('open');
    }

    function wireGlobals() {
        window.openGratitudeEditor = openEditor;
        window.closeGratitudeEditor = closeEditor;
        window.saveGratitudeNote = saveFromEditor;
        window.openGratitudeListModal = openListModal;
        window.closeGratitudeListModal = closeListModal;
        window.openGratitudeInfoModal = openInfoModal;
        window.closeGratitudeInfoModal = closeInfoModal;
        window.closeGratitudePreviewModal = closePreviewModal;
        window.toggleGratitudeFullscreen = toggleFullscreen;
        window.closeGratitudeFullscreen = closeFullscreen;
        window.peekRandomGratitudeNote = peekRandom;
        window.deleteGratitudeNote = deleteNote;
        window.exitGratitudeToHome = exitToHome;
        window.sealGratitudeJar = sealCurrentJar;
        window.openJarCollection = openJarCollection;
        window.closeJarCollection = closeJarCollection;
        window.closeJarViewer = closeJarViewer;
        window.swapGratitudeJar = swapJar;
    }

    function initElements() {
        state.canvas = document.getElementById('gratitude-jar-canvas');
        state.ctx = state.canvas?.getContext('2d');
        state.homePreviewCanvas = document.getElementById('home-gratitude-preview-canvas');
        state.homePreviewCtx = state.homePreviewCanvas?.getContext('2d');
        state.elements = {
            tab: document.getElementById('ld-gratitude'),
            count: document.getElementById('gratitude-jar-count'),
            hint: document.getElementById('gratitude-jar-hint'),
            primaryLabel: document.getElementById('gratitude-primary-label'),
            heroKicker: document.getElementById('gratitude-hero-kicker'),
            heroTitle: document.getElementById('gratitude-hero-title'),
            heroSubtitle: document.getElementById('gratitude-hero-subtitle'),
            previewCard: document.getElementById('gratitude-preview-card'),
            previewIcon: document.getElementById('gratitude-preview-icon'),
            previewType: document.getElementById('gratitude-preview-type'),
            previewText: document.getElementById('gratitude-preview-text'),
            previewMeta: document.getElementById('gratitude-preview-meta'),
            infoModal: document.getElementById('gratitude-info-modal'),
            previewModal: document.getElementById('gratitude-preview-modal'),
            editorModal: document.getElementById('gratitude-editor-modal'),
            listModal: document.getElementById('gratitude-list-modal'),
            input: document.getElementById('gratitude-note-input'),
            inputCount: document.getElementById('gratitude-note-count'),
            promptCard: document.getElementById('gratitude-prompt-card'),
            promptText: document.getElementById('gratitude-active-prompt'),
            promptApply: document.getElementById('gratitude-prompt-apply'),
            promptRefresh: document.getElementById('gratitude-prompt-refresh'),
            promptToggle: document.getElementById('gratitude-prompt-toggle'),
            promptToggleLabel: document.getElementById('gratitude-prompt-toggle-label'),
            promptToggleIcon: document.getElementById('gratitude-prompt-toggle-icon'),
            listContainer: document.getElementById('gratitude-list-container'),
            homePreviewCount: document.getElementById('home-gratitude-preview-count'),
            typeButtons: [...document.querySelectorAll('.gj-type-btn')]
        };
    }

    function init() {
        loadNoteImages();
        initElements();
        if (!state.canvas || !state.ctx) return;

        state.notes = safeParseNotes().map(ensureNoteRuntime);
        computeTargets(true);
        formatCount();
        samplePrompts();
        updateInputCount();
        bindEvents();
        wireGlobals();
        drawScene();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
