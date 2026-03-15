// ─── Storage ────────────────────────────────────────────────────────────────
const DB = {
  get entries() { return JSON.parse(localStorage.getItem('entries') || '[]'); },
  set entries(v) { localStorage.setItem('entries', JSON.stringify(v)); },
  get tags() { return JSON.parse(localStorage.getItem('tags') || '[]'); },
  set tags(v) { localStorage.setItem('tags', JSON.stringify(v)); },
  get places() { return JSON.parse(localStorage.getItem('places') || '[]'); },
  set places(v) { localStorage.setItem('places', JSON.stringify(v)); },
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Parse ──────────────────────────────────────────────────────────────────
const TAG_RE   = /#([\w\u4e00-\u9fa5/\-_.·]+)/g;
const PLACE_RE = /@([\w\u4e00-\u9fa5/\-_.·]+)/g;
const SIGIL_RE = /[#@]([\w\u4e00-\u9fa5/\-_.·]+)/g;

function parseEntry(raw) {
  const tags   = [...raw.matchAll(TAG_RE)].map(m => m[1]);
  const places = [...raw.matchAll(PLACE_RE)].map(m => m[1]);

  const stripped = raw.replace(SIGIL_RE, '');
  const priceMatch = stripped.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;

  const note = stripped.replace(/(?:^|\s)\d+(?:\.\d+)?(?=\s|$)/g, '').trim();

  return { price, tags, places, note };
}

// ─── Tag / Place Registries ──────────────────────────────────────────────────
function ensureItems(dbKey, paths) {
  const items = DB[dbKey];
  let changed = false;
  for (const path of paths) {
    if (!items.find(t => t.path === path)) {
      items.push({ id: genId(), path });
      changed = true;
    }
  }
  if (changed) DB[dbKey] = items;
}

function renameItem(dbKey, sigil, oldPath, newPath) {
  const items = DB[dbKey];
  const prefix = oldPath + '/';
  items.forEach(t => {
    if (t.path === oldPath) t.path = newPath;
    else if (t.path.startsWith(prefix)) t.path = newPath + '/' + t.path.slice(prefix.length);
  });
  DB[dbKey] = items;

  const fieldKey = dbKey === 'tags' ? 'tags' : 'places';
  const entries = DB.entries;
  entries.forEach(e => {
    e[fieldKey] = e[fieldKey].map(tp => {
      if (tp === oldPath) return newPath;
      if (tp.startsWith(prefix)) return newPath + '/' + tp.slice(prefix.length);
      return tp;
    });
    e.raw = e.raw.replace(
      new RegExp(escapeRegex(sigil) + escapeRegex(oldPath) + '(?=/|\\s|$)', 'g'),
      sigil + newPath
    );
  });
  DB.entries = entries;
}

// ─── Autocomplete ────────────────────────────────────────────────────────────
function getSuggestions(dbKey, query) {
  const paths = DB[dbKey].map(t => t.path);
  if (!query) return paths.slice(0, 8);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return paths.filter(path => {
    const lower = path.toLowerCase();
    let pos = 0;
    for (const t of tokens) {
      const idx = lower.indexOf(t, pos);
      if (idx === -1) return false;
      pos = idx + t.length;
    }
    return true;
  }).slice(0, 10);
}

function highlightMatch(path, query) {
  if (!query) return escapeHtml(path);
  let result = escapeHtml(path);
  query.toLowerCase().split(/\s+/).filter(Boolean).forEach(token => {
    result = result.replace(new RegExp('(' + escapeRegex(token) + ')', 'gi'), '<mark>$1</mark>');
  });
  return result;
}

// ─── Render tokens ──────────────────────────────────────────────────────────
function renderTokens(raw, type) {
  const parts = [];

  for (const m of raw.matchAll(/#([\w\u4e00-\u9fa5/\-_.·]+)/g))
    parts.push({ start: m.index, end: m.index + m[0].length, kind: 'tag', value: m[1] });

  for (const m of raw.matchAll(/@([\w\u4e00-\u9fa5/\-_.·]+)/g))
    parts.push({ start: m.index, end: m.index + m[0].length, kind: 'place', value: m[1] });

  const masked = raw.replace(/[#@][\w\u4e00-\u9fa5/\-_.·]+/g, s => ' '.repeat(s.length));
  for (const m of masked.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/g)) {
    const ns = m.index + m[0].length - m[1].length;
    const ne = ns + m[1].length;
    if (!parts.some(p => ns < p.end && ne > p.start))
      parts.push({ start: ns, end: ne, kind: 'price', value: m[1] });
  }

  parts.sort((a, b) => a.start - b.start);
  let out = '', last = 0;
  for (const p of parts) {
    out += escapeHtml(raw.slice(last, p.start));
    if (p.kind === 'tag')
      out += `<a class="token-tag" data-sigil="#" data-path="${escapeHtml(p.value)}">#${escapeHtml(p.value)}</a>`;
    else if (p.kind === 'place')
      out += `<a class="token-place" data-sigil="@" data-path="${escapeHtml(p.value)}">@${escapeHtml(p.value)}</a>`;
    else
      out += `<span class="token-price${type === 'income' ? ' income' : ''}">${escapeHtml(p.value)}</span>`;
    last = p.end;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}

// ─── Summary helpers ─────────────────────────────────────────────────────────
function summarize(entries) {
  let income = 0, expense = 0;
  entries.forEach(e => {
    if (e.isWishlist || e.price == null) return;
    if (e.type === 'income') income += e.price; else expense += e.price;
  });
  return { income, expense };
}

function fmtMoney(n) { return n.toFixed(2).replace(/\.00$/, ''); }

function summaryHTML({ income, expense }) {
  const parts = [];
  if (expense) parts.push(`<span class="expense">－${fmtMoney(expense)}</span>`);
  if (income)  parts.push(`<span class="income">＋${fmtMoney(income)}</span>`);
  if (income || expense) {
    const net = income - expense;
    parts.push(`<span class="net">净 ${net >= 0 ? '＋' : '－'}${fmtMoney(Math.abs(net))}</span>`);
  }
  return parts.join('');
}

// ─── App State ───────────────────────────────────────────────────────────────
let currentMonth = (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
let currentView = 'timeline';
// detail panel state
let detailSigil = '#';       // '#' or '@'
let detailPath  = null;
let detailReturnView = 'tags'; // which tree to return to

let composerType = 'expense';
let composerWishlist = false;
let composerOverrideDay = null;

// ─── Entry element ───────────────────────────────────────────────────────────
function buildEntryEl(entry, { showDate = false } = {}) {
  const div = document.createElement('div');
  div.className = 'entry';
  div.dataset.id = entry.id;

  const t = new Date(entry.timestamp);
  const hhmm = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
  const mmdd = `${t.getMonth()+1}/${t.getDate()}`;

  const badges = [];
  if (entry.isWishlist) badges.push(`<span class="entry-badge wishlist">种草</span>`);
  if (entry.type === 'income') badges.push(`<span class="entry-badge income-badge">收入</span>`);

  div.innerHTML = `
    <div class="entry-time-wrap">
      ${showDate ? `<span class="entry-date">${mmdd}</span>` : ''}
      <span class="entry-time">${hhmm}</span>
      <input class="entry-time-edit" type="time" value="${hhmm}">
    </div>
    <div class="entry-body">
      <div class="entry-rendered">${renderTokens(entry.raw, entry.type)}</div>
      <div class="entry-edit-wrap">
        <textarea class="entry-edit" rows="2"></textarea>
        <div class="entry-edit-meta">
          <button class="entry-edit-type ${entry.type}">
            ${entry.type === 'income' ? '＋ 收入' : '－ 支出'}
          </button>
          <span class="entry-edit-wishlist${entry.isWishlist ? ' active' : ''}">
            <i data-lucide="star"></i>${entry.isWishlist ? '已种草' : '种草'}
          </span>
          <span class="entry-edit-hint">Enter 保存 · Esc 取消</span>
        </div>
      </div>
    </div>
    <div class="entry-actions">
      ${badges.join('')}
      <button class="entry-delete-btn" title="删除">×</button>
    </div>
  `;

  lucide.createIcons({ nodes: [div] });

  const rendered   = div.querySelector('.entry-rendered');
  const editWrap   = div.querySelector('.entry-edit-wrap');
  const textarea   = div.querySelector('.entry-edit');
  const typeBtn    = div.querySelector('.entry-edit-type');
  const wishBtn    = div.querySelector('.entry-edit-wishlist');
  const timeSpan   = div.querySelector('.entry-time');
  const timeInput  = div.querySelector('.entry-time-edit');
  const dateSpan   = div.querySelector('.entry-date');
  const deleteBtn  = div.querySelector('.entry-delete-btn');

  // ── click tokens → navigate to detail
  rendered.addEventListener('click', e => {
    const tok = e.target.closest('[data-sigil]');
    if (tok) {
      e.stopPropagation();
      const sigil = tok.dataset.sigil;
      const path  = tok.dataset.path;
      const returnView = sigil === '#' ? 'tags' : 'places';
      openDetail(sigil, path, returnView);
      return;
    }
    enterEdit(div, entry, textarea, typeBtn, wishBtn, rendered);
  });

  // ── date click → go to timeline month
  if (dateSpan) {
    dateSpan.addEventListener('click', e => {
      e.stopPropagation();
      const d = new Date(entry.timestamp);
      currentMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      switchView('timeline');
    });
  }

  // ── time editing
  timeSpan.addEventListener('click', e => {
    e.stopPropagation();
    timeSpan.style.display = 'none';
    timeInput.style.display = 'inline-block';
    timeInput.focus();
  });
  timeInput.addEventListener('change', () => {
    const [h, m] = timeInput.value.split(':').map(Number);
    const d = new Date(entry.timestamp);
    d.setHours(h, m, 0, 0);
    entry.timestamp = d.toISOString();
    saveEntry(entry);
    timeSpan.textContent = timeInput.value;
    timeInput.style.display = 'none';
    timeSpan.style.display = '';
    if (currentView === 'timeline') renderTimeline();
  });
  timeInput.addEventListener('blur', () => {
    timeInput.style.display = 'none';
    timeSpan.style.display = '';
  });
  timeInput.addEventListener('keydown', e => { if (e.key === 'Escape') timeInput.blur(); });

  // ── inline meta toggles (only active while editing)
  typeBtn.setAttribute('tabindex', '0');
  wishBtn.setAttribute('tabindex', '0');

  typeBtn.addEventListener('click', () => {
    entry.type = entry.type === 'expense' ? 'income' : 'expense';
    typeBtn.className = `entry-edit-type ${entry.type}`;
    typeBtn.textContent = entry.type === 'income' ? '＋ 收入' : '－ 支出';
    textarea.focus();
  });
  wishBtn.addEventListener('click', () => {
    entry.isWishlist = !entry.isWishlist;
    wishBtn.classList.toggle('active', entry.isWishlist);
    wishBtn.innerHTML = `<i data-lucide="star"></i>${entry.isWishlist ? '已种草' : '种草'}`;
    lucide.createIcons({ nodes: [wishBtn] });
    textarea.focus();
  });

  // ── commit when focus leaves the entire .entry div
  div.addEventListener('focusout', e => {
    if (!div.contains(e.relatedTarget)) {
      commitEdit(div, entry, textarea, rendered);
    }
  });

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); div.blur(); commitEdit(div, entry, textarea, rendered); }
    if (e.key === 'Escape') { entry.type = entry._origType; entry.isWishlist = entry._origWishlist; textarea.value = entry.raw; div.blur(); commitEdit(div, entry, textarea, rendered); }
  });

  // ── delete
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!confirm('删除这条记录？')) return;
    DB.entries = DB.entries.filter(en => en.id !== entry.id);
    div.remove();
    if (currentView === 'timeline') renderTimeline();
    if (detailPath) renderDetailEntries();
  });

  return div;
}

function enterEdit(div, entry, textarea, typeBtn, wishBtn, rendered) {
  entry._origType = entry.type;
  entry._origWishlist = entry.isWishlist;
  div.classList.add('editing');
  textarea.value = entry.raw;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function commitEdit(div, entry, textarea, rendered) {
  if (!div.classList.contains('editing')) return;
  div.classList.remove('editing');
  const newRaw = textarea.value.trim();
  if (newRaw && newRaw !== entry.raw) {
    const parsed = parseEntry(newRaw);
    entry.raw   = newRaw;
    entry.price = parsed.price;
    entry.tags  = parsed.tags;
    entry.places = parsed.places;
    entry.note  = parsed.note;
    ensureItems('tags', parsed.tags);
    ensureItems('places', parsed.places);
  }
  saveEntry(entry);
  rendered.innerHTML = renderTokens(entry.raw, entry.type);
  // update badges
  const actions = div.querySelector('.entry-actions');
  const badges = [];
  if (entry.isWishlist) badges.push(`<span class="entry-badge wishlist">种草</span>`);
  if (entry.type === 'income') badges.push(`<span class="entry-badge income-badge">收入</span>`);
  const del = actions.querySelector('.entry-delete-btn');
  actions.innerHTML = badges.join('');
  actions.appendChild(del);
}

function saveEntry(entry) {
  const entries = DB.entries;
  const idx = entries.findIndex(e => e.id === entry.id);
  if (idx !== -1) entries[idx] = entry;
  DB.entries = entries;
}

// ─── Timeline ────────────────────────────────────────────────────────────────
function renderTimeline() {
  const y = currentMonth.getFullYear(), mo = currentMonth.getMonth();
  document.getElementById('month-label').textContent = `${y}年${mo+1}月`;

  const allEntries = DB.entries;
  const monthEntries = allEntries.filter(e => {
    const d = new Date(e.timestamp);
    return d.getFullYear() === y && d.getMonth() === mo;
  });

  document.getElementById('month-summary').innerHTML = summaryHTML(summarize(monthEntries));

  // group by day
  const groups = {};
  monthEntries.forEach(e => {
    const d = new Date(e.timestamp);
    const key = `${y}-${String(mo+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    (groups[key] = groups[key] || []).push(e);
  });

  // all days in month
  const daysInMonth = new Date(y, mo+1, 0).getDate();
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';

  for (let d = daysInMonth; d >= 1; d--) {
    const key = `${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEntries = (groups[key] || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const dateObj = new Date(y, mo, d);
    const weekday = '日一二三四五六'[dateObj.getDay()];
    const ds = summarize(dayEntries);

    const group = document.createElement('div');
    group.className = 'day-group';

    const header = document.createElement('div');
    header.className = 'day-header';
    header.innerHTML = `
      <span class="day-date">${d}日（${weekday}）</span>
      <span class="day-summary">${summaryHTML(ds)}</span>
    `;

    const addBtn = document.createElement('button');
    addBtn.className = 'day-add-btn';
    addBtn.title = '补记';
    addBtn.innerHTML = '<i data-lucide="plus"></i>';
    addBtn.addEventListener('click', () => {
      composerOverrideDay = key;
      document.getElementById('entry-input').focus();
      document.getElementById('entry-composer').scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    header.appendChild(addBtn);
    group.appendChild(header);

    dayEntries.forEach(e => group.appendChild(buildEntryEl(e)));
    list.appendChild(group);
  }

  lucide.createIcons({ nodes: [list, document.getElementById('month-header')] });
}

// ─── Tree (generic for # and @) ──────────────────────────────────────────────
function buildTree(items) {
  const root = {};
  items.forEach(({ path }) => {
    const parts = path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (!node[part]) node[part] = { _path: parts.slice(0,i+1).join('/'), _children: {} };
      node = node[part]._children;
    });
  });
  return root;
}

function getEntriesFor(sigil, path) {
  const field = sigil === '#' ? 'tags' : 'places';
  return DB.entries.filter(e => (e[field] || []).some(p => p === path || p.startsWith(path + '/')));
}

function renderTree(containerId, sigil, dbKey, nodeClass) {
  const items = DB[dbKey];
  const tree  = buildTree(items);
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  renderTreeLevel(container, tree, sigil, nodeClass);
  lucide.createIcons({ nodes: [container] });
}

function renderTreeLevel(container, node, sigil, nodeClass) {
  Object.keys(node).sort().forEach(key => {
    const child = node[key];
    const path  = child._path;
    const hasChildren = Object.keys(child._children).length > 0;
    const s = summarize(getEntriesFor(sigil, path));

    const nodeEl = document.createElement('div');
    nodeEl.className = `tree-node ${nodeClass}`;

    const header = document.createElement('div');
    header.className = 'tree-node-header';
    header.innerHTML = `
      <span class="tree-toggle">${hasChildren ? '▶' : ''}</span>
      <span class="tree-node-name">${escapeHtml(key)}</span>
      <span class="tree-node-summary">${summaryHTML(s)}</span>
      <button class="tree-open-btn" title="详情"><i data-lucide="arrow-right"></i></button>
    `;

    header.querySelector('.tree-open-btn').addEventListener('click', e => {
      e.stopPropagation();
      const returnView = sigil === '#' ? 'tags' : 'places';
      openDetail(sigil, path, returnView);
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
        if (!e.target.closest('.tree-open-btn')) openDetail(sigil, path, sigil === '#' ? 'tags' : 'places');
      });
    }

    container.appendChild(nodeEl);
  });
}

// ─── Detail Panel ────────────────────────────────────────────────────────────
let detailTypeVal = 'expense';
let detailWishlistVal = false;

function openDetail(sigil, path, returnView) {
  detailSigil = sigil;
  detailPath  = path;
  detailReturnView = returnView;

  // sigil display
  const sigilEl = document.getElementById('detail-sigil');
  sigilEl.textContent = sigil;
  sigilEl.className = `detail-sigil ${sigil === '#' ? 'tag-sigil' : 'place-sigil'}`;

  const nameEl = document.getElementById('detail-name');
  nameEl.textContent = path;
  nameEl.className = sigil === '#' ? 'detail-name-tag' : 'detail-name-place';

  renderDetailEntries();
  document.getElementById('detail-panel').classList.remove('hidden');

  // reset detail composer
  detailTypeVal = 'expense';
  detailWishlistVal = false;
  const typeBtn = document.querySelector('.detail-type-toggle');
  typeBtn.textContent = '－';
  typeBtn.className = 'type-btn expense detail-type-toggle';
  document.querySelector('.detail-wishlist-toggle').checked = false;
  document.querySelector('.detail-entry-input').innerText = '';
}

function renderDetailEntries() {
  const entries = getEntriesFor(detailSigil, detailPath)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  document.getElementById('detail-summary').innerHTML = summaryHTML(summarize(entries));

  const list = document.getElementById('detail-entries');
  list.innerHTML = '';
  entries.forEach(e => list.appendChild(buildEntryEl(e, { showDate: true })));
  lucide.createIcons({ nodes: [list] });
}

// detail back
document.getElementById('detail-back').addEventListener('click', () => {
  document.getElementById('detail-panel').classList.add('hidden');
  detailPath = null;
  switchView(detailReturnView);
});

// detail name rename
let _nameBeforeFocus = '';
const detailNameEl = document.getElementById('detail-name');
detailNameEl.addEventListener('focus', () => { _nameBeforeFocus = detailNameEl.textContent.trim(); });
detailNameEl.addEventListener('blur', () => {
  const newPath = detailNameEl.textContent.trim();
  if (newPath && newPath !== _nameBeforeFocus) {
    const dbKey = detailSigil === '#' ? 'tags' : 'places';
    renameItem(dbKey, detailSigil, _nameBeforeFocus, newPath);
    detailPath = newPath;
    renderDetailEntries();
    if (detailSigil === '#') renderTree('tag-tree', '#', 'tags', 'tag-tree-node');
    else renderTree('place-tree', '@', 'places', 'place-tree-node');
  }
});
detailNameEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); detailNameEl.blur(); }
  if (e.key === 'Escape') { detailNameEl.textContent = _nameBeforeFocus; detailNameEl.blur(); }
});

// detail composer
const detailTypeBtn = document.querySelector('.detail-type-toggle');
const detailWishlistToggle = document.querySelector('.detail-wishlist-toggle');
const detailInput = document.querySelector('.detail-entry-input');
const detailACMenu = document.querySelector('.detail-autocomplete-menu');
const detailSubmitBtn = document.querySelector('.detail-submit-btn');

detailTypeBtn.addEventListener('click', () => {
  detailTypeVal = detailTypeVal === 'expense' ? 'income' : 'expense';
  detailTypeBtn.textContent = detailTypeVal === 'expense' ? '－' : '＋';
  detailTypeBtn.className = `type-btn ${detailTypeVal} detail-type-toggle`;
});
detailWishlistToggle.addEventListener('change', () => { detailWishlistVal = detailWishlistToggle.checked; });

detailInput.addEventListener('input', () => handleAC(detailInput, detailACMenu));
detailInput.addEventListener('keydown', e => {
  if (!detailACMenu.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1, detailACMenu); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveAC(-1, detailACMenu); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && detailACMenu.querySelector('.selected')) {
      e.preventDefault(); applyAC(detailACMenu.querySelector('.selected').dataset.value, detailInput, detailACMenu); return;
    }
    if (e.key === 'Escape') { hideAC(detailACMenu); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDetailEntry(); }
});
detailSubmitBtn.addEventListener('click', submitDetailEntry);

function submitDetailEntry() {
  let raw = detailInput.innerText.trim();
  if (!raw) return;
  // inject the current detail tag/place if not present
  const sigil = detailSigil, path = detailPath;
  const marker = sigil + path;
  if (!raw.includes(marker)) raw = marker + ' ' + raw;

  const parsed = parseEntry(raw);
  ensureItems('tags', parsed.tags);
  ensureItems('places', parsed.places);

  const entry = {
    id: genId(), timestamp: new Date().toISOString(),
    raw, price: parsed.price, tags: parsed.tags,
    places: parsed.places, note: parsed.note,
    type: detailTypeVal, isWishlist: detailWishlistVal,
  };
  DB.entries = [...DB.entries, entry];
  detailInput.innerText = '';
  renderDetailEntries();
}

// ─── Main Composer ───────────────────────────────────────────────────────────
const typeToggleBtn = document.getElementById('type-toggle');
const wishlistToggle = document.getElementById('wishlist-toggle');
const entryInput = document.getElementById('entry-input');
const acMenu = document.getElementById('autocomplete-menu');
const submitBtn = document.getElementById('submit-btn');

typeToggleBtn.addEventListener('click', () => {
  composerType = composerType === 'expense' ? 'income' : 'expense';
  typeToggleBtn.textContent = composerType === 'expense' ? '－' : '＋';
  typeToggleBtn.className = `type-btn ${composerType}`;
});
wishlistToggle.addEventListener('change', () => { composerWishlist = wishlistToggle.checked; });

entryInput.addEventListener('input', () => handleAC(entryInput, acMenu));
entryInput.addEventListener('keydown', e => {
  if (!acMenu.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1, acMenu); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveAC(-1, acMenu); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && acMenu.querySelector('.selected')) {
      e.preventDefault(); applyAC(acMenu.querySelector('.selected').dataset.value, entryInput, acMenu); return;
    }
    if (e.key === 'Escape') { hideAC(acMenu); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitMainEntry(); }
});
submitBtn.addEventListener('click', submitMainEntry);

function submitMainEntry() {
  const raw = entryInput.innerText.trim();
  if (!raw) return;

  const parsed = parseEntry(raw);
  ensureItems('tags', parsed.tags);
  ensureItems('places', parsed.places);

  let ts;
  if (composerOverrideDay) {
    const [oy, om, od] = composerOverrideDay.split('-').map(Number);
    const now = new Date();
    ts = new Date(oy, om-1, od, now.getHours(), now.getMinutes()).toISOString();
    composerOverrideDay = null;
  } else {
    ts = new Date().toISOString();
  }

  const entry = {
    id: genId(), timestamp: ts, raw,
    price: parsed.price, tags: parsed.tags,
    places: parsed.places, note: parsed.note,
    type: composerType, isWishlist: composerWishlist,
  };
  DB.entries = [...DB.entries, entry];

  entryInput.innerText = '';
  composerType = 'expense'; composerWishlist = false;
  typeToggleBtn.textContent = '－';
  typeToggleBtn.className = 'type-btn expense';
  wishlistToggle.checked = false;

  renderTimeline();
}

// ─── Autocomplete core ───────────────────────────────────────────────────────
let _acIndex = -1;

function getCaretSigilQuery(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const text = pre.toString();
  const m = text.match(/[#@]([\w\u4e00-\u9fa5/\-_.·]*)$/);
  if (!m) return null;
  return { sigil: text[m.index], query: m[1] };
}

function handleAC(inputEl, menuEl) {
  const hit = getCaretSigilQuery(inputEl);
  if (!hit) { hideAC(menuEl); return; }
  const dbKey = hit.sigil === '#' ? 'tags' : 'places';
  const suggestions = getSuggestions(dbKey, hit.query);
  if (!suggestions.length) { hideAC(menuEl); return; }
  menuEl.innerHTML = '';
  menuEl.classList.remove('hidden');
  _acIndex = -1;
  const cls = hit.sigil === '#' ? 'tag-ac' : 'place-ac';
  suggestions.forEach(s => {
    const item = document.createElement('div');
    item.className = `autocomplete-item ${cls}`;
    item.dataset.value = hit.sigil + s;
    item.innerHTML = escapeHtml(hit.sigil) + highlightMatch(s, hit.query);
    item.addEventListener('mousedown', e => { e.preventDefault(); applyAC(hit.sigil + s, inputEl, menuEl); });
    menuEl.appendChild(item);
  });
}

function hideAC(menuEl) { menuEl.classList.add('hidden'); _acIndex = -1; }

function moveAC(dir, menuEl) {
  const items = [...menuEl.querySelectorAll('.autocomplete-item')];
  if (!items.length) return;
  items[_acIndex]?.classList.remove('selected');
  _acIndex = Math.max(-1, Math.min(items.length-1, _acIndex + dir));
  items[_acIndex]?.classList.add('selected');
}

function applyAC(fullValue, inputEl, menuEl) {
  // fullValue is like '#star巴克' or '@淘宝'
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(inputEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const preText = pre.toString();
  const m = preText.match(/[#@][\w\u4e00-\u9fa5/\-_.·]*$/);
  if (!m) return;
  const fullText = inputEl.innerText;
  const insertPos = preText.length - m[0].length;
  const postText = fullText.slice(preText.length);
  const newText = fullText.slice(0, insertPos) + fullValue + (postText.startsWith(' ') ? '' : ' ') + postText;
  inputEl.innerText = newText;
  const newPos = insertPos + fullValue.length + 1;
  try {
    const textNode = inputEl.firstChild;
    if (textNode) {
      const r = document.createRange();
      r.setStart(textNode, Math.min(newPos, textNode.length));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } catch(_) {}
  hideAC(menuEl);
}

// ─── Wishlist ────────────────────────────────────────────────────────────────
function renderWishlist() {
  const entries = DB.entries.filter(e => e.isWishlist)
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

// ─── Nav ─────────────────────────────────────────────────────────────────────
function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + viewName));
  if (viewName === 'timeline') renderTimeline();
  if (viewName === 'tags')     renderTree('tag-tree',   '#', 'tags',   'tag-tree-node');
  if (viewName === 'places')   renderTree('place-tree', '@', 'places', 'place-tree-node');
  if (viewName === 'wishlist') renderWishlist();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

document.getElementById('prev-month').addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() - 1); renderTimeline();
});
document.getElementById('next-month').addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() + 1); renderTimeline();
});

// ─── Seed ─────────────────────────────────────────────────────────────────────
function seedIfEmpty() {
  if (DB.entries.length) return;
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  const seeds = [
    { raw: '#星巴克/馥芮白 @星巴克/西湖文化广场 32', tags:['星巴克/馥芮白'], places:['星巴克/西湖文化广场'], price:32, type:'expense' },
    { raw: '#星巴克/馥芮白 38 换了大杯', tags:['星巴克/馥芮白'], places:[], price:38, type:'expense' },
    { raw: '#davinci/personal/奶油内页50张 @淘宝', tags:['davinci/personal/奶油内页50张'], places:['淘宝'], price:null, type:'expense', isWishlist:true },
    { raw: '工资 8000', tags:[], places:[], price:8000, type:'income' },
    { raw: '午饭 28 @公司楼下', tags:[], places:['公司楼下'], price:28, type:'expense' },
  ];
  DB.entries = seeds.map((s, i) => ({
    id: genId(),
    timestamp: new Date(y, mo, 3 + i*3, 10+i, 0).toISOString(),
    raw: s.raw, price: s.price, tags: s.tags, places: s.places,
    note: parseEntry(s.raw).note, type: s.type, isWishlist: s.isWishlist || false,
  }));
  const allTags   = [...new Set(seeds.flatMap(s => s.tags))];
  const allPlaces = [...new Set(seeds.flatMap(s => s.places))];
  DB.tags   = allTags.map(path => ({ id: genId(), path }));
  DB.places = allPlaces.map(path => ({ id: genId(), path }));
}

// ─── Init ─────────────────────────────────────────────────────────────────────
seedIfEmpty();
renderTimeline();
// init lucide for static elements
window.addEventListener('load', () => lucide.createIcons());
