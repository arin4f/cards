// ── Config ────────────────────────────────────────────────────────
const REPO_OWNER = 'arin4f';
const REPO_NAME = 'cards';
const DECKS_DIR = 'decks';
const PROGRESS_PREFIX = 'flashcard_progress_';
const NEW_CARDS_PER_SESSION = 10;

let state = {
  view: 'home', // home | deck | study
  decks: [],
  currentDeck: null,
  studySession: null,
  loading: true,
};

// ── Persistence (progress only) ──────────────────────────────────
function loadProgress(deckName) {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + deckName);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveProgress(deckName, progress) {
  localStorage.setItem(PROGRESS_PREFIX + deckName, JSON.stringify(progress));
}

// ── Fetch decks from GitHub ──────────────────────────────────────
async function fetchDecksFromRepo() {
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DECKS_DIR}`;
  const resp = await fetch(apiUrl);
  if (!resp.ok) throw new Error(`GitHub API error: ${resp.status}`);
  const files = await resp.json();
  const mdFiles = files.filter(f => f.name.endsWith('.md'));

  const decks = await Promise.all(mdFiles.map(async (f) => {
    const raw = await fetch(f.download_url);
    const markdown = await raw.text();
    return parseDeckFromFile(f.name, markdown);
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
  return { name, markdown: content, cards };
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

// ── SM-2 Algorithm ────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getCardProgress(progress, idx) {
  return progress[idx] || {
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    nextReview: todayStr(),
  };
}

function sm2(card, quality) {
  let { interval, repetitions, easeFactor } = card;

  if (quality === 0) {
    repetitions = 0;
    interval = 0;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 3;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions++;
  }

  const q = quality + 1;
  easeFactor = easeFactor + (0.1 - (4 - q) * (0.08 + (4 - q) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  if (quality === 3 && interval > 0) {
    interval = Math.round(interval * 1.3);
  }

  const next = new Date();
  next.setDate(next.getDate() + (interval || 0));

  return {
    interval,
    repetitions,
    easeFactor,
    nextReview: interval === 0 ? todayStr() : next.toISOString().slice(0, 10),
  };
}

function getDueCards(deck) {
  const progress = loadProgress(deck.name);
  const today = todayStr();
  const due = [];
  const newCards = [];

  deck.cards.forEach((card, idx) => {
    const p = progress[idx];
    if (!p) {
      newCards.push(idx);
    } else if (p.nextReview <= today) {
      due.push(idx);
    }
  });

  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }

  const slotsForNew = Math.max(0, NEW_CARDS_PER_SESSION - due.length);
  const addNew = newCards.slice(0, Math.max(slotsForNew, Math.min(NEW_CARDS_PER_SESSION, newCards.length)));

  return [...due, ...addNew];
}

// ── Rendering ─────────────────────────────────────────────────────
const app = document.getElementById('app');

function render() {
  switch (state.view) {
    case 'home': renderHome(); break;
    case 'deck': renderDeck(); break;
    case 'study': renderStudy(); break;
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
        const dueCount = getDueCards(d).length;
        return `<div class="deck-item" data-idx="${i}">
          <h3>${esc(d.name)}</h3>
          <div class="deck-meta">
            <span>${d.cards.length} card${d.cards.length !== 1 ? 's' : ''}</span>
            ${dueCount > 0 ? `<span class="due">${dueCount} due</span>` : '<span>All caught up</span>'}
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
  const dueCards = getDueCards(d);
  const progress = loadProgress(d.name);
  const reviewed = Object.keys(progress).length;

  app.innerHTML = `
    <div class="header">
      <button class="back-btn" id="back-btn">&larr; Back</button>
      <h1>${esc(d.name)}</h1>
    </div>
    <div class="deck-detail">
      <div class="deck-stats">
        <div><div class="stat-value">${d.cards.length}</div><div class="stat-label">Total</div></div>
        <div><div class="stat-value">${reviewed}</div><div class="stat-label">Seen</div></div>
        <div><div class="stat-value" style="color:var(--accent)">${dueCards.length}</div><div class="stat-label">Due</div></div>
      </div>
      <div class="deck-actions">
        <button class="btn btn-primary btn-block" id="study-btn" ${dueCards.length === 0 ? 'disabled style="opacity:0.5"' : ''}>
          Study ${dueCards.length > 0 ? `(${dueCards.length} cards)` : '— All caught up!'}
        </button>
        <button class="btn btn-secondary btn-block" id="reset-btn">Reset Progress</button>
      </div>
    </div>
    <div id="confirm-root"></div>
  `;

  document.getElementById('back-btn').onclick = () => { state.view = 'home'; render(); };

  document.getElementById('study-btn').onclick = () => {
    if (dueCards.length === 0) return;
    state.studySession = {
      cardIndices: dueCards,
      current: 0,
      flipped: false,
      total: dueCards.length,
    };
    state.view = 'study';
    render();
  };

  document.getElementById('reset-btn').onclick = () => {
    showConfirm('Reset Progress', `Reset all study progress for "${d.name}"?`, () => {
      localStorage.removeItem(PROGRESS_PREFIX + d.name);
      state.view = 'deck';
      render();
    });
  };
}

function renderStudy() {
  const d = state.currentDeck;
  const s = state.studySession;

  if (!s || s.current >= s.cardIndices.length) {
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
    <div class="header">
      <button class="back-btn" id="back-btn">&larr; Quit</button>
      <h1>${esc(d.name)}</h1>
    </div>
    <div class="study-container">
      <div class="progress-bar-container"><div class="progress-bar" style="width:${pct}%"></div></div>
      <div class="card-counter">${s.current + 1} of ${s.total}</div>
      <div class="flashcard ${s.flipped ? 'flipped' : ''}" id="flashcard">
        <div class="flashcard-content">${content}</div>
        ${hint}
      </div>
      ${s.flipped ? `
        <div class="rating-buttons">
          <button class="rating-btn again" data-q="0">Again</button>
          <button class="rating-btn hard" data-q="1">Hard</button>
          <button class="rating-btn good" data-q="2">Good</button>
          <button class="rating-btn easy" data-q="3">Easy</button>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('back-btn').onclick = () => {
    state.studySession = null;
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
      const progress = loadProgress(d.name);
      const cardP = getCardProgress(progress, cardIdx);
      const updated = sm2(cardP, quality);
      progress[cardIdx] = updated;
      saveProgress(d.name, progress);

      if (quality === 0 && s.current + 2 < s.cardIndices.length) {
        const reinsertAt = Math.min(s.current + 3 + Math.floor(Math.random() * 3), s.cardIndices.length);
        s.cardIndices.splice(reinsertAt, 0, cardIdx);
        s.total = s.cardIndices.length;
      }

      s.current++;
      s.flipped = false;
      render();
    };
  });
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
  overlay.querySelector('#confirm-ok').onclick = () => {
    overlay.remove();
    onConfirm();
  };
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
    state.decks = await fetchDecksFromRepo();
  } catch (err) {
    console.error('Failed to fetch decks:', err);
    state.decks = [];
  }

  state.loading = false;
  render();
}

init();
