// ── Config ────────────────────────────────────────────────────────
const DECKS_DIR = 'decks';

const SESSION_KEY = 'flashcard_session';
const PROGRESS_PREFIX = 'flashcard_learned_';

let state = {
  view: 'home', // home | deck | study | editor
  decks: [],
  currentDeck: null,
  studySession: null,
  loading: true,
};

// ── Session persistence ──────────────────────────────────────────
function saveSession() {
  if (!state.studySession || !state.currentDeck) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    deckName: state.currentDeck.name,
    cardIndices: state.studySession.cardIndices,
    current: state.studySession.current,
    total: state.studySession.total,
  }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    const deck = state.decks.find(d => d.name === saved.deckName);
    if (!deck) { clearSession(); return false; }
    state.currentDeck = deck;
    state.studySession = {
      cardIndices: saved.cardIndices,
      current: saved.current,
      flipped: false,
      total: saved.total,
    };
    state.view = 'study';
    return true;
  } catch { clearSession(); return false; }
}

// ── Progress tracking ────────────────────────────────────────────
function loadLearned(deckName) {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + deckName);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function markLearned(deckName, cardIdx) {
  const learned = loadLearned(deckName);
  if (!learned.includes(cardIdx)) {
    learned.push(cardIdx);
    localStorage.setItem(PROGRESS_PREFIX + deckName, JSON.stringify(learned));
  }
}

function resetLearned(deckName) {
  localStorage.removeItem(PROGRESS_PREFIX + deckName);
}

// ── Fetch decks ──────────────────────────────────────────────────
async function fetchDecks() {
  const resp = await fetch(`${DECKS_DIR}/index.json`);
  if (!resp.ok) throw new Error(`Failed to load deck index: ${resp.status}`);
  const files = await resp.json();

  const decks = await Promise.all(files.map(async (filename) => {
    const raw = await fetch(`${DECKS_DIR}/${filename}`);
    const markdown = await raw.text();
    return parseDeckFromFile(filename, markdown);
  }));

  return decks.filter(d => d.cards.length > 0);
}

function parseDeckFromFile(filename, markdown) {
  let name = filename.replace(/\.md$/, '').replace(/[-_]/g, ' ');
  let content = markdown;

  // If file starts with # heading, use it as deck name
  const headingMatch = markdown.match(/^#\s+(.+)\n/);
  if (headingMatch) {
    name = headingMatch[1].trim();
    content = markdown.slice(headingMatch[0].length);
  }

  const cards = parseCards(content);
  return { name, filename, markdown: content, cards };
}

// ── Markdown Parsing ──────────────────────────────────────────────
function parseCards(markdown) {
  const cards = [];
  const parts = markdown.split(/^(?=Q:)/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith('Q:')) continue;
    const aIndex = trimmed.search(/^A:/m);
    if (aIndex === -1) continue;
    const question = trimmed.slice(2, aIndex).trim();
    const answer = trimmed.slice(aIndex + 2).trim();
    if (question && answer) {
      cards.push({ question, answer });
    }
  }
  return cards;
}

function renderMarkdown(text) {
  try {
    return marked.parse(text);
  } catch {
    return text.replace(/</g, '&lt;').replace(/\n/g, '<br>');
  }
}


function getAllCardIndices(deck) {
  const indices = deck.cards.map((_, idx) => idx);
  // Shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

// ── Rendering ─────────────────────────────────────────────────────
const app = document.getElementById('app');

function render() {
  switch (state.view) {
    case 'home': renderHome(); break;
    case 'deck': renderDeck(); break;
    case 'study': renderStudy(); break;
    case 'editor': renderEditor(); break;
  }
}

function renderHome() {
  if (state.loading) {
    app.innerHTML = `
      <div class="header"><h1>Flashcards</h1></div>
      <div class="empty-state">Loading decks...</div>
    `;
    return;
  }

  const decksHtml = state.decks.length === 0
    ? '<div class="empty-state">No decks found.<br>Add .md files to the <code>decks/</code> folder in the repo.</div>'
    : state.decks.map((d, i) => {
        const lc = loadLearned(d.name).length;
        return `<div class="deck-item" data-idx="${i}">
          <h3>${esc(d.name)}</h3>
          <div class="deck-meta">
            <span>${d.cards.length} cards</span>
            <span>${lc > 0 ? `${lc}/${d.cards.length} learned` : ''}</span>
          </div>
        </div>`;
      }).join('');

  app.innerHTML = `
    <div class="header">
      <h1>Flashcards</h1>
      <button class="btn btn-secondary" id="refresh-btn">Refresh</button>
    </div>
    <div class="deck-list">${decksHtml}</div>
  `;

  document.getElementById('refresh-btn').onclick = () => init();

  app.querySelectorAll('.deck-item').forEach(el => {
    el.onclick = () => {
      state.currentDeck = state.decks[parseInt(el.dataset.idx)];
      state.view = 'deck';
      render();
    };
  });
}

function renderDeck() {
  const d = state.currentDeck;
  const learned = loadLearned(d.name);
  const learnedCount = learned.length;
  app.innerHTML = `
    <div class="header">
      <button class="back-btn" id="back-btn">&larr; Back</button>
      <h1>${esc(d.name)}</h1>
    </div>
    <div class="deck-detail">
      <div class="deck-stats">
        <div><div class="stat-value">${d.cards.length}</div><div class="stat-label">Total</div></div>
        <div><div class="stat-value" style="color:var(--green)">${learnedCount}</div><div class="stat-label">Learned</div></div>
        <div><div class="stat-value" style="color:var(--accent)">${d.cards.length - learnedCount}</div><div class="stat-label">Remaining</div></div>
      </div>
      <div class="deck-actions">
        <button class="btn btn-primary btn-block" id="study-btn">
          Study (${d.cards.length} cards)
        </button>
        <button class="btn btn-secondary btn-block" id="edit-btn">Edit Deck</button>
        ${learnedCount > 0 ? '<button class="btn btn-danger btn-block" id="reset-btn">Reset Progress</button>' : ''}
      </div>
    </div>
    <div id="confirm-root"></div>
  `;

  document.getElementById('back-btn').onclick = () => { state.view = 'home'; render(); };

  document.getElementById('study-btn').onclick = () => {
    state.studySession = {
      cardIndices: getAllCardIndices(d),
      current: 0,
      flipped: false,
      total: d.cards.length,
    };
    state.view = 'study';
    saveSession();
    render();
  };

  document.getElementById('edit-btn').onclick = () => {
    state.view = 'editor';
    render();
  };

  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      showConfirm('Reset Progress', `Reset learned progress for "${d.name}"?`, () => {
        resetLearned(d.name);
        render();
      });
    };
  }
}

function renderStudy() {
  const d = state.currentDeck;
  const s = state.studySession;

  if (!s || s.current >= s.cardIndices.length) {
    clearSession();
    renderSessionComplete();
    return;
  }

  const cardIdx = s.cardIndices[s.current];
  const card = d.cards[cardIdx];
  const pct = Math.round((s.current / s.total) * 100);

  const content = s.flipped
    ? renderMarkdown(card.answer)
    : renderMarkdown(card.question);

  const hint = s.flipped ? '' : '<div class="tap-hint">Tap to reveal answer</div>';

  app.innerHTML = `
    <div class="study-container">
      <div class="study-topbar">
        <button class="back-btn" id="back-btn">&larr;</button>
        <div class="progress-bar-container"><div class="progress-bar" style="width:${pct}%"></div></div>
        <div class="card-counter">${s.current + 1} / ${s.total}</div>
      </div>
      <div class="flashcard ${s.flipped ? 'flipped' : ''}" id="flashcard">
        <div class="flashcard-content">${content}</div>
        ${hint}
      </div>
      ${s.flipped ? `
        <div class="rating-buttons two-buttons">
          <button class="rating-btn again" data-q="0">Repeat</button>
          <button class="rating-btn good" data-q="1">OK</button>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('back-btn').onclick = () => {
    state.studySession = null;
    clearSession();
    state.view = 'deck';
    render();
  };

  const flashcard = document.getElementById('flashcard');
  if (!s.flipped) {
    flashcard.onclick = () => {
      s.flipped = true;
      render();
    };
  }

  app.querySelectorAll('.rating-btn').forEach(btn => {
    btn.onclick = () => {
      const quality = parseInt(btn.dataset.q);
      const cardIdx = s.cardIndices[s.current];

      // "OK" marks card as learned
      if (quality === 1) {
        markLearned(d.name, cardIdx);
      }

      // "Repeat" re-queues the card a few positions later
      if (quality === 0 && s.current + 1 < s.cardIndices.length) {
        const reinsertAt = Math.min(s.current + 3 + Math.floor(Math.random() * 3), s.cardIndices.length);
        s.cardIndices.splice(reinsertAt, 0, cardIdx);
        s.total = s.cardIndices.length;
      }

      s.current++;
      s.flipped = false;
      saveSession();
      render();
    };
  });
}

function renderEditor() {
  const d = state.currentDeck;

  app.innerHTML = `
    <div class="header">
      <button class="back-btn" id="cancel-btn">&larr; Cancel</button>
      <h1>Edit Deck</h1>
    </div>
    <div class="editor">
      <textarea id="deck-content">${esc(d.markdown)}</textarea>
      <button class="btn btn-primary btn-block" id="save-btn">Save</button>
    </div>
  `;

  document.getElementById('cancel-btn').onclick = () => {
    state.view = 'deck';
    render();
  };

  document.getElementById('save-btn').onclick = () => {
    const content = document.getElementById('deck-content').value;
    const cards = parseCards(content);
    if (cards.length === 0) {
      alert('No valid Q:/A: cards found.');
      return;
    }
    d.markdown = content;
    d.cards = cards;
    resetLearned(d.name);
    state.view = 'deck';
    render();
  };
}

function renderSessionComplete() {
  app.innerHTML = `
    <div class="header">
      <button class="back-btn" id="back-btn">&larr; Back</button>
      <h1>${esc(state.currentDeck.name)}</h1>
    </div>
    <div class="session-complete">
      <div class="big-check">&#10003;</div>
      <h2>Session Complete!</h2>
      <p>You've reviewed all due cards. Come back later for more.</p>
      <button class="btn btn-primary" id="done-btn">Back to Deck</button>
    </div>
  `;

  document.getElementById('back-btn').onclick =
  document.getElementById('done-btn').onclick = () => {
    state.studySession = null;
    clearSession();
    state.view = 'deck';
    render();
  };
}


// ── Confirm Dialog ────────────────────────────────────────────────
function showConfirm(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="btn-group">
        <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-ok">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirm-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#confirm-ok').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

// ── Utility ───────────────────────────────────────────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  state.loading = true;
  state.view = 'home';
  render();

  try {
    state.decks = await fetchDecks();
  } catch (err) {
    console.error('Failed to fetch decks:', err);
    state.decks = [];
  }

  state.loading = false;
  restoreSession();
  render();
}

init();
