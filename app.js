// ── State ──────────────────────────────────────────────────────────
const DECKS_KEY = 'flashcard_decks';
const PROGRESS_PREFIX = 'flashcard_progress_';
const NEW_CARDS_PER_SESSION = 10;

let state = {
  view: 'home', // home | deck | study | editor
  decks: [],
  currentDeck: null,
  studySession: null,
  confirmAction: null,
};

// ── Persistence ───────────────────────────────────────────────────
function loadDecks() {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    state.decks = raw ? JSON.parse(raw) : [];
  } catch { state.decks = []; }
  if (state.decks.length === 0) seedExampleDeck();
}

function saveDecks() {
  localStorage.setItem(DECKS_KEY, JSON.stringify(state.decks));
}

function loadProgress(deckName) {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + deckName);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveProgress(deckName, progress) {
  localStorage.setItem(PROGRESS_PREFIX + deckName, JSON.stringify(progress));
}

// ── Markdown Parsing ──────────────────────────────────────────────
function parseCards(markdown) {
  const cards = [];
  // Split on lines that start with Q: (keeping the Q: line)
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
  // quality: 0=Again, 1=Hard, 2=Good, 3=Easy
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

  // Adjust ease factor
  const q = quality + 1; // map 0-3 to 1-4, treat as 1-4 out of 5
  easeFactor = easeFactor + (0.1 - (4 - q) * (0.08 + (4 - q) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  // Bonus for easy
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

  // Shuffle due cards
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }

  // Add new cards up to limit
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
    case 'editor': renderEditor(); break;
  }
}

function renderHome() {
  const decksHtml = state.decks.length === 0
    ? '<div class="empty-state">No decks yet.<br>Tap "New Deck" to get started.</div>'
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
      <button class="btn btn-primary" id="new-deck-btn">+ New Deck</button>
    </div>
    <div class="deck-list">${decksHtml}</div>
  `;

  document.getElementById('new-deck-btn').onclick = () => {
    state.currentDeck = null;
    state.view = 'editor';
    render();
  };

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
        <button class="btn btn-secondary btn-block" id="edit-btn">Edit Deck</button>
        <button class="btn btn-danger btn-block" id="delete-btn">Delete Deck</button>
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

  document.getElementById('edit-btn').onclick = () => {
    state.view = 'editor';
    render();
  };

  document.getElementById('delete-btn').onclick = () => {
    showConfirm('Delete Deck', `Delete "${d.name}" and all progress?`, () => {
      state.decks = state.decks.filter(x => x !== d);
      localStorage.removeItem(PROGRESS_PREFIX + d.name);
      saveDecks();
      state.currentDeck = null;
      state.view = 'home';
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

      // If "Again", re-queue the card near the end
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

function renderEditor() {
  const editing = state.currentDeck;
  const name = editing ? editing.name : '';
  const md = editing ? editing.markdown : '';

  app.innerHTML = `
    <div class="header">
      <button class="back-btn" id="cancel-btn">&larr; Cancel</button>
      <h1>${editing ? 'Edit Deck' : 'New Deck'}</h1>
    </div>
    <div class="editor">
      <input type="text" id="deck-name" placeholder="Deck name" value="${esc(name)}">
      <textarea id="deck-content" placeholder="Paste your Q:/A: formatted markdown here...">${esc(md)}</textarea>
      <div class="editor-hint">
        Format: Start each question with <strong>Q:</strong> on its own line,
        and each answer with <strong>A:</strong> on its own line. Markdown supported.
      </div>
      <button class="btn btn-primary btn-block" id="save-btn">Save Deck</button>
    </div>
  `;

  document.getElementById('cancel-btn').onclick = () => {
    state.view = editing ? 'deck' : 'home';
    render();
  };

  document.getElementById('save-btn').onclick = () => {
    const deckName = document.getElementById('deck-name').value.trim();
    const content = document.getElementById('deck-content').value;

    if (!deckName) {
      alert('Please enter a deck name.');
      return;
    }

    const cards = parseCards(content);
    if (cards.length === 0) {
      alert('No valid Q:/A: cards found. Check your formatting.');
      return;
    }

    if (editing) {
      // If name changed, migrate progress
      if (editing.name !== deckName) {
        const prog = loadProgress(editing.name);
        localStorage.removeItem(PROGRESS_PREFIX + editing.name);
        saveProgress(deckName, prog);
      }
      editing.name = deckName;
      editing.markdown = content;
      editing.cards = cards;
    } else {
      // Check for duplicate name
      if (state.decks.some(d => d.name === deckName)) {
        alert('A deck with this name already exists.');
        return;
      }
      const newDeck = { name: deckName, markdown: content, cards };
      state.decks.push(newDeck);
      state.currentDeck = newDeck;
    }

    saveDecks();
    state.view = 'deck';
    render();
  };
}

// ── Confirm Dialog ────────────────────────────────────────────────
function showConfirm(title, message, onConfirm) {
  const root = document.getElementById('confirm-root') || document.body;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="btn-group">
        <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-ok">Delete</button>
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

// ── Example Deck ──────────────────────────────────────────────────
function seedExampleDeck() {
  const md = `Q: What are the German definite articles for each gender and plural?

A: | Gender | Article |
|--------|---------|
| Masculine (der) | **der** Mann |
| Feminine (die) | **die** Frau |
| Neuter (das) | **das** Kind |
| Plural (die) | **die** Leute |

Q: How do you form the present tense of regular verbs in German?

A: Remove the **-en** ending and add:

- **ich** → -e (ich spiele)
- **du** → -st (du spielst)
- **er/sie/es** → -t (er spielt)
- **wir** → -en (wir spielen)
- **ihr** → -t (ihr spielt)
- **sie/Sie** → -en (sie spielen)

Q: What is the difference between Akkusativ and Dativ cases?

A: **Akkusativ** (direct object) — answers "wen/was?" (whom/what?)
- Only changes masculine: der → **den**, ein → **einen**

**Dativ** (indirect object) — answers "wem?" (to whom?)
- der → **dem**, die → **der**, das → **dem**
- Plural: die → **den** (+ noun gets -n)

Q: How do separable prefix verbs work?

A: The prefix goes to the **end** of the sentence in present tense:

- **aufstehen** → Ich **stehe** um 7 Uhr **auf**.
- **einkaufen** → Wir **kaufen** im Supermarkt **ein**.
- **anfangen** → Der Film **fängt** um 8 **an**.

In subordinate clauses, the verb stays together:
- ..., weil der Film um 8 **anfängt**.

Q: When do you use "sein" vs "haben" as the auxiliary in Perfekt?

A: Use **sein** with:
- Verbs of **movement** (gehen, fahren, laufen, fliegen)
- Verbs of **change of state** (werden, sterben, aufwachen)
- **sein**, **bleiben**, **passieren**

Use **haben** with everything else:
- Ich **habe** gegessen.
- Ich **bin** gegangen.

Q: What are the most common German prepositions that take Akkusativ?

A: Remember **FUDGE BOP**:

- **f**ür (for)
- **u**m (around/at)
- **d**urch (through)
- **ge**gen (against)
- **b**is (until)
- **o**hne (without)
- (entlang — along, comes after noun)

Example: Ich gehe **durch den** Park.

Q: What are the most common Dativ prepositions?

A: Remember **aus bei mit nach seit von zu**:

- **aus** (from/out of)
- **bei** (at/near)
- **mit** (with)
- **nach** (after/to)
- **seit** (since)
- **von** (from/of)
- **zu** (to)

Example: Ich fahre **mit dem** Bus.

Q: How do Wechselpräpositionen (two-way prepositions) work?

A: These 9 prepositions take **Akkusativ** (movement to) or **Dativ** (location at):

**an, auf, hinter, in, neben, über, unter, vor, zwischen**

- **Wohin?** (where to?) → Akkusativ: Ich gehe **in den** Park.
- **Wo?** (where at?) → Dativ: Ich bin **im** (in dem) Park.

Q: How do you form the comparative and superlative in German?

A: **Comparative**: add **-er** (+ often umlaut on a/o/u)
**Superlative**: add **-(e)sten** (use am ___sten or der/die/das ___ste)

| Base | Comparative | Superlative |
|------|------------|-------------|
| klein | klein**er** | am klein**sten** |
| alt | **ä**lt**er** | am **ä**lt**esten** |
| gut | **besser** | am **besten** |
| viel | **mehr** | am **meisten** |

Q: What word order rules apply in German main clauses vs subordinate clauses?

A: **Main clause**: Verb in **position 2** (V2)
- *Ich **gehe** heute ins Kino.*
- *Heute **gehe** ich ins Kino.* (inversion after fronted element)

**Subordinate clause** (weil, dass, wenn, ob...): Verb goes to the **end**
- *..., weil ich heute ins Kino **gehe**.*

**Question**: Verb in **position 1**
- ***Gehst** du heute ins Kino?*`;

  const cards = parseCards(md);
  const deck = { name: '', markdown: md, cards };
  state.decks.push(deck);
  saveDecks();
}

// ── Utility ───────────────────────────────────────────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ──────────────────────────────────────────────────────────
loadDecks();
render();
