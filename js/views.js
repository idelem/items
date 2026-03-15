import { DB, escapeHtml, genId }             from './db.js';
import { parseEntry, ensureItems, renameItem,
         getSuggestions, pathToRaw }           from './parse.js';
import { renderTokens, renderStars,
         summarize, summaryHTML, highlightMatch } from './render.js';
import { buildEntryEl }                        from './entries.js';
import { state }                               from './state.js';

// ─── Timeline ─────────────────────────────────────────────────────────────────
export function renderTimeline() {
  const y  = state.currentMonth.getFullYear();
  const mo = state.currentMonth.getMonth();
  document.getElementById('month-label').textContent = `${y}年${mo + 1}月`;

  const allEntries    = DB.entries;
  const monthEntries  = allEntries.filter(e => {
    const d = new Date(e.timestamp);
    return d.getFullYear() === y && d.getMonth() === mo;
  });

  document.getElementById('month-summary').innerHTML = summaryHTML(summarize(monthEntries));

  // Group by day key "YYYY-MM-DD"
  const groups = {};
  monthEntries.forEach(e => {
    const d   = new Date(e.timestamp);
    const key = `${y}-${String(mo + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    (groups[key] = groups[key] || []).push(e);
  });

  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const list        = document.getElementById('timeline-list');
  list.innerHTML    = '';

  for (let d = daysInMonth; d >= 1; d--) {
    const key        = `${y}-${String(mo + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEntries = (groups[key] || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const dateObj    = new Date(y, mo, d);
    const weekday    = '日一二三四五六'[dateObj.getDay()];
    const ds         = summarize(dayEntries);

    const group  = document.createElement('div');
    group.className = 'day-group';

    const header = document.createElement('div');
    header.className = 'day-header';
    header.innerHTML = `
      <span class="day-date">${d}日（${weekday}）</span>
      <span class="day-summary">${summaryHTML(ds)}</span>
    `;

    const addBtn = document.createElement('button');
    addBtn.className = 'day-add-btn';
    addBtn.title     = '补记';
    addBtn.innerHTML = '<i data-lucide="plus"></i>';
    addBtn.addEventListener('click', () => {
      state.composerOverrideDay = key;
      document.getElementById('entry-input').focus();
    });
    header.appendChild(addBtn);
    group.appendChild(header);

    dayEntries.forEach(e => group.appendChild(buildEntryEl(e)));
    list.appendChild(group);
  }

  lucide.createIcons({ nodes: [list, document.getElementById('month-header')] });
}

// ─── Tag / Place tree ─────────────────────────────────────────────────────────
function buildTree(items) {
  const root = {};
  items.forEach(({ path }) => {
    const parts = path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (!node[part]) node[part] = { _path: parts.slice(0, i + 1).join('/'), _children: {} };
      node = node[part]._children;
    });
  });
  return root;
}

export function getEntriesFor(sigil, path) {
  if (sigil === '*') return DB.entries.filter(e => (e.ratings   || []).some(r => r.str === path));
  if (sigil === '%') return DB.entries.filter(e => (e.progresses|| []).length > 0);
  const field = sigil === '#' ? 'tags' : 'places';
  return DB.entries.filter(e => (e[field] || []).some(p => p === path || p.startsWith(path + '/')));
}

export function renderTree(containerId, sigil, dbKey, nodeClass) {
  const tree      = buildTree(DB[dbKey]);
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  renderTreeLevel(container, tree, sigil, nodeClass);
  lucide.createIcons({ nodes: [container] });
}

function renderTreeLevel(container, node, sigil, nodeClass) {
  Object.keys(node).sort().forEach(key => {
    const child       = node[key];
    const path        = child._path;
    const hasChildren = Object.keys(child._children).length > 0;
    const s           = summarize(getEntriesFor(sigil, path));

    const nodeEl = document.createElement('div');
    nodeEl.className = `tree-node ${nodeClass}`;

    const header = document.createElement('div');
    header.className = 'tree-node-header';
    header.innerHTML = `
      <span class="tree-toggle">${hasChildren ? '▶' : ''}</span>
      <span class="tree-node-name">${escapeHtml(key)}</span>
      <span class="tree-node-summary">${summaryHTML(s)}</span>
      <button class="tree-open-btn"><i data-lucide="arrow-right"></i></button>
    `;

    header.querySelector('.tree-open-btn').addEventListener('click', e => {
      e.stopPropagation();
      openDetail(sigil, path, sigil === '#' ? 'tags' : 'places');
    });

    nodeEl.appendChild(header);

    if (hasChildren) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children';
      renderTreeLevel(childrenEl, child._children, sigil, nodeClass);
      nodeEl.appendChild(childrenEl);
      header.addEventListener('click', e => {
        if (!e.target.closest('.tree-open-btn')) nodeEl.classList.toggle('open');
      });
    } else {
      header.addEventListener('click', e => {
        if (!e.target.closest('.tree-open-btn'))
          openDetail(sigil, path, sigil === '#' ? 'tags' : 'places');
      });
    }

    container.appendChild(nodeEl);
  });
}

// ─── Wishlist ─────────────────────────────────────────────────────────────────
export function renderWishlist() {
  const entries = DB.entries
    .filter(e => e.isWishlist)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const list = document.getElementById('wishlist-list');
  list.innerHTML = '';

  if (!entries.length) {
    list.innerHTML = '<p class="wishlist-empty">还没有种草条目</p>';
    return;
  }

  entries.forEach(e => list.appendChild(buildEntryEl(e, { showDate: true })));
  lucide.createIcons({ nodes: [list] });
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
export function openDetail(sigil, path, returnView) {
  state.detailSigil      = sigil;
  state.detailPath       = path;
  state.detailReturnView = returnView;

  const isSpecial = sigil === '*' || sigil === '%';

  const sigilEl = document.getElementById('detail-sigil');
  sigilEl.textContent = sigil;
  sigilEl.className   = `detail-sigil ${{ '#':'tag-sigil','@':'place-sigil','*':'rating-sigil','%':'progress-sigil' }[sigil] || ''}`;

  const nameEl = document.getElementById('detail-name');
  nameEl.textContent      = sigil === '%' ? '进度记录' : path;
  nameEl.className        = `detail-name-${{ '#':'tag','@':'place','*':'rating','%':'progress' }[sigil] || 'tag'}`;
  nameEl.contentEditable  = isSpecial ? 'false' : 'true';

  document.getElementById('detail-composer').style.display = isSpecial ? 'none' : '';

  renderDetailEntries();
  document.getElementById('detail-panel').classList.remove('hidden');

  if (!isSpecial) {
    state.detailTypeVal    = 'expense';
    state.detailWishlistVal = false;
    const tb = document.querySelector('.detail-type-toggle');
    tb.textContent = '－';
    tb.className   = 'type-btn expense detail-type-toggle';
    document.querySelector('.detail-wishlist-toggle').checked = false;
    document.querySelector('.detail-entry-input').innerText   = '';
  }
}

export function renderDetailEntries() {
  const entries = getEntriesFor(state.detailSigil, state.detailPath)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  document.getElementById('detail-summary').innerHTML = summaryHTML(summarize(entries));

  const list = document.getElementById('detail-entries');
  list.innerHTML = '';

  if (state.detailSigil === '*') {
    const [rs, ss] = state.detailPath.split('/');
    const starDiv  = document.createElement('div');
    starDiv.className = 'rating-detail-stars';
    starDiv.innerHTML =
      renderStars(parseFloat(rs), parseFloat(ss)) +
      `<span class="rating-detail-label">${escapeHtml(state.detailPath)}</span>` +
      `<span class="rating-detail-count">${entries.length} 条</span>`;
    list.appendChild(starDiv);
  }

  if (state.detailSigil === '%') {
    const hdr = document.createElement('div');
    hdr.className = 'progress-detail-header';
    hdr.innerHTML = `<span class="progress-detail-count">${entries.length} 条进度记录</span>`;
    list.appendChild(hdr);
  }

  entries.forEach(e => list.appendChild(buildEntryEl(e, { showDate: true })));
  lucide.createIcons({ nodes: [list] });
}

// ─── Detail name rename ───────────────────────────────────────────────────────
export function initDetailRename() {
  const nameEl = document.getElementById('detail-name');
  let   _before = '';

  nameEl.addEventListener('focus', () => { _before = nameEl.textContent.trim(); });

  nameEl.addEventListener('blur', () => {
    if (state.detailSigil === '*' || state.detailSigil === '%') return;
    const newPath = nameEl.textContent.trim();
    if (newPath && newPath !== _before) {
      const dbKey = state.detailSigil === '#' ? 'tags' : 'places';
      renameItem(dbKey, state.detailSigil, _before, newPath);
      state.detailPath = newPath;
      renderDetailEntries();
      const [cid, dbk, nc] = state.detailSigil === '#'
        ? ['tag-tree',   'tags',   'tag-tree-node']
        : ['place-tree', 'places', 'place-tree-node'];
      renderTree(cid, state.detailSigil, dbk, nc);
    }
  });

  nameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { nameEl.textContent = _before; nameEl.blur(); }
  });
}

// ─── Detail composer ──────────────────────────────────────────────────────────
export function initDetailComposer() {
  const typeBtn    = document.querySelector('.detail-type-toggle');
  const wishToggle = document.querySelector('.detail-wishlist-toggle');
  const input      = document.querySelector('.detail-entry-input');
  const acMenu     = document.querySelector('.detail-autocomplete-menu');
  const submitBtn  = document.querySelector('.detail-submit-btn');
  const bracketBtn = document.querySelector('.detail-bracket-btn');

  typeBtn.addEventListener('click', () => {
    state.detailTypeVal = state.detailTypeVal === 'expense' ? 'income' : 'expense';
    typeBtn.textContent = state.detailTypeVal === 'expense' ? '－' : '＋';
    typeBtn.className   = `type-btn ${state.detailTypeVal} detail-type-toggle`;
  });

  wishToggle.addEventListener('change', () => {
    state.detailWishlistVal = wishToggle.checked;
  });

  input.addEventListener('input',   () => handleAC(input, acMenu));
  input.addEventListener('keydown', e  => {
    if (!acMenu.classList.contains('hidden')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1,  acMenu); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); moveAC(-1, acMenu); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && acMenu.querySelector('.selected')) {
        e.preventDefault();
        const sel = acMenu.querySelector('.selected');
        applyAC(sel.dataset.value, input, acMenu, sel.dataset.bracketed === 'true');
        return;
      }
      if (e.key === 'Escape') { hideAC(acMenu); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDetailEntry(); }
  });

  submitBtn.addEventListener('click', submitDetailEntry);

  bracketBtn?.addEventListener('click', () => insertBracketTemplate(input, '#'));

  function submitDetailEntry() {
    let raw = input.innerText.trim();
    if (!raw) return;
    // Build the marker in correct raw form (bracket if path has spaces)
    const isTagOrPlace = state.detailSigil === '#' || state.detailSigil === '@';
    const marker = isTagOrPlace
      ? pathToRaw(state.detailSigil, state.detailPath)
      : state.detailSigil + state.detailPath;
    if (!raw.includes(marker)) raw = marker + ' ' + raw;
    const p = parseEntry(raw);
    ensureItems('tags', p.tags);
    ensureItems('places', p.places);
    const entry = {
      id: genId(), timestamp: new Date().toISOString(), raw,
      price: p.price, tags: p.tags, places: p.places,
      ratings: p.ratings, progresses: p.progresses, note: p.note,
      type: state.detailTypeVal, isWishlist: state.detailWishlistVal,
    };
    DB.entries = [...DB.entries, entry];
    input.innerText = '';
    renderDetailEntries();
  }
}

// ─── Autocomplete (shared) ────────────────────────────────────────────────────
let _acIndex = -1;

// Returns { sigil, query, bracketed } where:
//   bracketed=true  means caret is inside #(...)  → query is text after '('
//   bracketed=false means caret is after plain #   → query is text after '#'
function getCaretSigilQuery(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const pre   = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const text = pre.toString();

  // Check for bracketed form: #( or @(  with no closing ) yet
  const bracketM = text.match(/([#@])\(([^)]*)$/);
  if (bracketM) return { sigil: bracketM[1], query: bracketM[2], bracketed: true };

  // Plain form: #word  or  @word
  const plainM = text.match(/([#@])([\w\u4e00-\u9fa5/\-_.·]*)$/);
  if (plainM) return { sigil: plainM[1], query: plainM[2], bracketed: false };

  return null;
}

export function handleAC(inputEl, menuEl) {
  const hit = getCaretSigilQuery(inputEl);
  if (!hit) { hideAC(menuEl); return; }
  const dbKey       = hit.sigil === '#' ? 'tags' : 'places';
  const suggestions = getSuggestions(dbKey, hit.query);
  if (!suggestions.length) { hideAC(menuEl); return; }

  menuEl.innerHTML = '';
  menuEl.classList.remove('hidden');
  _acIndex = -1;
  const cls = hit.sigil === '#' ? 'tag-ac' : 'place-ac';

  suggestions.forEach(s => {
    const item = document.createElement('div');
    item.className     = `autocomplete-item ${cls}`;
    item.dataset.value    = hit.sigil + s;
    item.dataset.bracketed = String(hit.bracketed);
    item.innerHTML     = escapeHtml(hit.sigil) + highlightMatch(s, hit.query);
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      applyAC(hit.sigil + s, inputEl, menuEl, hit.bracketed);
    });
    menuEl.appendChild(item);
  });
}

export function hideAC(menuEl) {
  menuEl.classList.add('hidden');
  _acIndex = -1;
}

export function moveAC(dir, menuEl) {
  const items = [...menuEl.querySelectorAll('.autocomplete-item')];
  if (!items.length) return;
  items[_acIndex]?.classList.remove('selected');
  _acIndex = Math.max(-1, Math.min(items.length - 1, _acIndex + dir));
  items[_acIndex]?.classList.add('selected');
}

// fullValue: '#my fav/item' or '#plainpath'
// bracketed: whether caret was inside #(...)
export function applyAC(fullValue, inputEl, menuEl, bracketed) {
  const sigil = fullValue[0];
  const path  = fullValue.slice(1);
  // Choose raw form: if path has spaces it MUST be bracketed
  const rawToken = path.includes(' ') ? `${sigil}(${path})` : `${sigil}${path}`;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const pre   = range.cloneRange();
  pre.selectNodeContents(inputEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const preText = pre.toString();

  // Find where the current #... or #(... token starts
  const m = bracketed
    ? preText.match(/[#@]\([^)]*$/)
    : preText.match(/[#@][\w\u4e00-\u9fa5/\-_.·]*$/);
  if (!m) return;

  const fullText  = inputEl.innerText;
  const insertPos = preText.length - m[0].length;
  let   postText  = fullText.slice(preText.length);

  // If we were inside a bracket form, consume the closing ')' if present
  if (bracketed && postText.startsWith(')')) postText = postText.slice(1);

  const newText = fullText.slice(0, insertPos) + rawToken + (postText.startsWith(' ') ? '' : ' ') + postText;
  inputEl.innerText = newText;

  const newPos = insertPos + rawToken.length + 1;
  try {
    const tn = inputEl.firstChild;
    if (tn) {
      const r = document.createRange();
      r.setStart(tn, Math.min(newPos, tn.length));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } catch (_) {}

  hideAC(menuEl);
}
// ─── Bracket template insertion ───────────────────────────────────────────────
// Inserts sigil+() at the caret and places the cursor between the brackets,
// then triggers autocomplete. Used by both main and detail composers.
export function insertBracketTemplate(inputEl, sigil) {
  inputEl.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const text  = inputEl.innerText;
  const range = sel.getRangeAt(0);
  const pre   = range.cloneRange();
  pre.selectNodeContents(inputEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const preLen = pre.toString().length;

  const insert  = sigil + '()';
  inputEl.innerText = text.slice(0, preLen) + insert + text.slice(preLen);

  // Place caret between the brackets: after sigil and '('
  const caretPos = preLen + sigil.length + 1;
  try {
    const tn = inputEl.firstChild;
    if (tn) {
      const r = document.createRange();
      r.setStart(tn, Math.min(caretPos, tn.length));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } catch (_) {}

  // Trigger autocomplete immediately
  inputEl.dispatchEvent(new Event('input'));
}
