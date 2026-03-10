// ─── Storage ───────────────────────────────────────────────────────────────
const DB = {
  get entries() { return JSON.parse(localStorage.getItem('entries') || '[]'); },
  set entries(v) { localStorage.setItem('entries', JSON.stringify(v)); },
  get tags() { return JSON.parse(localStorage.getItem('tags') || '[]'); },
  set tags(v) { localStorage.setItem('tags', JSON.stringify(v)); },
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Parse ─────────────────────────────────────────────────────────────────
function parseEntry(raw) {
  const priceRe = /(?:^|\s)([+-]?\d+(?:\.\d+)?)(?=\s|$)/g;
  const tagRe = /#([\w\u4e00-\u9fa5/\-_.·]+)/g;

  let price = null;
  let tags = [];
  let match;

  // Extract tags
  const tagMatches = [...raw.matchAll(tagRe)].map(m => m[1]);
  tags = tagMatches;

  // Extract price (first standalone number not inside a tag)
  const rawNoTags = raw.replace(tagRe, '');
  const priceMatch = rawNoTags.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/);
  if (priceMatch) price = parseFloat(priceMatch[1]);

  // Extract note (remaining text minus tags and price)
  let note = raw
    .replace(tagRe, '')
    .replace(/(?:^|\s)\d+(?:\.\d+)?(?=\s|$)/g, '')
    .trim();

  return { price, tags, note };
}

// ─── Tag Registry ──────────────────────────────────────────────────────────
function ensureTags(paths) {
  const tags = DB.tags;
  let changed = false;
  for (const path of paths) {
    if (!tags.find(t => t.path === path)) {
      tags.push({ id: genId(), path });
      changed = true;
    }
  }
  if (changed) DB.tags = tags;
}

function renameTag(oldPath, newPath) {
  // Update tag record
  const tags = DB.tags;
  const tag = tags.find(t => t.path === oldPath);
  if (tag) {
    // Also rename children
    const prefix = oldPath + '/';
    tags.forEach(t => {
      if (t.path === oldPath) t.path = newPath;
      else if (t.path.startsWith(prefix)) {
        t.path = newPath + '/' + t.path.slice(prefix.length);
      }
    });
    DB.tags = tags;
  }

  // Update all entries
  const entries = DB.entries;
  const prefix = oldPath + '/';
  entries.forEach(e => {
    // Update tags array
    e.tags = e.tags.map(tp => {
      if (tp === oldPath) return newPath;
      if (tp.startsWith(prefix)) return newPath + '/' + tp.slice(prefix.length);
      return tp;
    });
    // Update raw text
    e.raw = e.raw.replace(
      new RegExp('#' + escapeRegex(oldPath) + '(?=/|\\s|$)', 'g'),
      '#' + newPath
    );
  });
  DB.entries = entries;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Autocomplete ──────────────────────────────────────────────────────────
function getTagSuggestions(query) {
  const tags = DB.tags.map(t => t.path);
  if (!query) return tags.slice(0, 8);

  // Tokenize query by spaces
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  return tags
    .filter(path => {
      const lower = path.toLowerCase();
      // Each token must appear in order (not strict sequential position, just presence)
      let pos = 0;
      for (const token of tokens) {
        const idx = lower.indexOf(token, pos);
        if (idx === -1) return false;
        pos = idx + token.length;
      }
      return true;
    })
    .slice(0, 10);
}

function highlightMatch(path, query) {
  if (!query) return escapeHtml(path);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  let result = path;
  // Simple highlight: bold matched tokens
  tokens.forEach(token => {
    const re = new RegExp('(' + escapeRegex(token) + ')', 'gi');
    result = result.replace(re, '<mark>$1</mark>');
  });
  return result;
}

// ─── Render entry tokens ───────────────────────────────────────────────────
function renderTokens(raw, type) {
  const tagRe = /#([\w\u4e00-\u9fa5/\-_.·]+)/g;
  const priceRe = /(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/g;

  // Replace tags first
  let html = escapeHtml(raw);
  html = html.replace(/&amp;/g, '&'); // undo double escape

  // Re-do properly: work on raw, build html
  let out = '';
  let last = 0;
  const parts = [];

  // Collect all token spans
  let m;
  const tagRe2 = /#([\w\u4e00-\u9fa5/\-_.·]+)/g;
  while ((m = tagRe2.exec(raw)) !== null) {
    parts.push({ start: m.index, end: m.index + m[0].length, type: 'tag', value: m[1] });
  }

  // Price tokens (excluding inside tags)
  const rawNoTags = raw.replace(/#[\w\u4e00-\u9fa5/\-_.·]+/g, s => ' '.repeat(s.length));
  const priceRe2 = /(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/g;
  while ((m = priceRe2.exec(rawNoTags)) !== null) {
    const numStart = m.index + m[0].length - m[1].length;
    const numEnd = numStart + m[1].length;
    // Check not overlapping tag
    const overlaps = parts.some(p => numStart < p.end && numEnd > p.start);
    if (!overlaps) {
      parts.push({ start: numStart, end: numEnd, type: 'price', value: m[1] });
    }
  }

  parts.sort((a, b) => a.start - b.start);

  for (const p of parts) {
    out += escapeHtml(raw.slice(last, p.start));
    if (p.type === 'tag') {
      out += `<a class="token-tag" data-tag="${escapeHtml(p.value)}">#${escapeHtml(p.value)}</a>`;
    } else {
      const cls = type === 'income' ? 'token-price income' : 'token-price';
      out += `<span class="${cls}">${escapeHtml(p.value)}</span>`;
    }
    last = p.end;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Summary helpers ────────────────────────────────────────────────────────
function summarize(entries) {
  let income = 0, expense = 0;
  entries.forEach(e => {
    if (e.isWishlist || e.price == null) return;
    if (e.type === 'income') income += e.price;
    else expense += e.price;
  });
  return { income, expense, net: income - expense };
}

function fmtMoney(n) {
  return n === 0 ? '0' : n.toFixed(2).replace(/\.00$/, '');
}

function summaryHTML(s) {
  const parts = [];
  if (s.expense) parts.push(`<span class="expense">－${fmtMoney(s.expense)}</span>`);
  if (s.income) parts.push(`<span class="income">＋${fmtMoney(s.income)}</span>`);
  if (s.expense || s.income) {
    const net = s.income - s.expense;
    const sign = net >= 0 ? '＋' : '－';
    parts.push(`<span class="net">净 ${sign}${fmtMoney(Math.abs(net))}</span>`);
  }
  return parts.join('');
}

// ─── App State ─────────────────────────────────────────────────────────────
let currentMonth = new Date();
currentMonth.setDate(1);
currentMonth.setHours(0,0,0,0);

let currentView = 'timeline';
let currentTagPath = null;
let autocompleteIndex = -1;
let tagTypeBtnType = 'expense';
let tagWishlist = false;

// ─── Timeline Render ────────────────────────────────────────────────────────
function renderTimeline() {
  const y = currentMonth.getFullYear();
  const mo = currentMonth.getMonth();
  document.getElementById('month-label').textContent =
    `${y}年${mo + 1}月`;

  const entries = DB.entries.filter(e => {
    const d = new Date(e.timestamp);
    return d.getFullYear() === y && d.getMonth() === mo;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Month summary
  const ms = summarize(entries);
  document.getElementById('month-summary').innerHTML = summaryHTML(ms);

  // Group by day
  const groups = {};
  entries.forEach(e => {
    const d = new Date(e.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  const list = document.getElementById('timeline-list');
  list.innerHTML = '';

  const sortedDays = Object.keys(groups).sort((a,b) => b.localeCompare(a));
  for (const day of sortedDays) {
    const dayEntries = groups[day];
    const ds = summarize(dayEntries);
    const [, , dd] = day.split('-');
    const dateObj = new Date(day);
    const weekday = '日一二三四五六'[dateObj.getDay()];

    const group = document.createElement('div');
    group.className = 'day-group';
    group.innerHTML = `
      <div class="day-header">
        <span class="day-date">${parseInt(dd)}日（${weekday}）</span>
        <span class="day-summary">${summaryHTML(ds)}</span>
        <button class="day-add-btn" data-day="${day}" title="补记">＋</button>
      </div>
    `;

    // Day add button: pre-fill composer and set override date
    group.querySelector('.day-add-btn').addEventListener('click', () => {
      entryInput.focus();
      composerOverrideDay = day;
      entryInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });

    dayEntries.forEach(e => {
      group.appendChild(buildEntryEl(e));
    });

    list.appendChild(group);
  }
}

function buildEntryEl(entry) {
  const div = document.createElement('div');
  div.className = 'entry';
  div.dataset.id = entry.id;

  const t = new Date(entry.timestamp);
  const hhmm = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;

  const badges = [];
  if (entry.isWishlist) badges.push(`<span class="entry-badge wishlist">种草</span>`);
  if (entry.type === 'income') badges.push(`<span class="entry-badge income-badge">收入</span>`);

  div.innerHTML = `
    <span class="entry-time" title="点击修改时间">${hhmm}</span>
    <input class="entry-time-edit" type="time" value="${hhmm}">
    <div class="entry-body">
      <div class="entry-rendered">${renderTokens(entry.raw, entry.type)}</div>
      <textarea class="entry-edit" rows="2"></textarea>
    </div>
    <div class="entry-actions">
      ${badges.join('')}
      <button class="entry-delete-btn" title="删除">×</button>
    </div>
  `;

  const rendered = div.querySelector('.entry-rendered');
  const edit = div.querySelector('.entry-edit');
  const timeSpan = div.querySelector('.entry-time');
  const timeInput = div.querySelector('.entry-time-edit');
  const deleteBtn = div.querySelector('.entry-delete-btn');

  // Clickable timestamp → time input
  timeSpan.addEventListener('click', e => {
    e.stopPropagation();
    timeSpan.style.display = 'none';
    timeInput.style.display = 'inline-block';
    timeInput.focus();
  });

  timeInput.addEventListener('change', () => {
    const [h, m] = timeInput.value.split(':').map(Number);
    const newTs = new Date(entry.timestamp);
    newTs.setHours(h, m, 0, 0);
    entry.timestamp = newTs.toISOString();
    const newHhmm = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    timeSpan.textContent = newHhmm;
    timeInput.style.display = 'none';
    timeSpan.style.display = '';
    const entries = DB.entries;
    const idx = entries.findIndex(en => en.id === entry.id);
    if (idx !== -1) entries[idx] = entry;
    DB.entries = entries;
    renderTimeline();
  });

  timeInput.addEventListener('blur', () => {
    timeInput.style.display = 'none';
    timeSpan.style.display = '';
  });

  timeInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { timeInput.blur(); }
  });

  // Delete
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!confirm('删除这条记录？')) return;
    DB.entries = DB.entries.filter(en => en.id !== entry.id);
    div.remove();
    renderTimeline();
    if (currentView === 'tags') renderTagTree();
    if (currentTagPath) renderTagDetail(currentTagPath);
  });

  // Click tag links / edit body
  rendered.addEventListener('click', e => {
    const tagEl = e.target.closest('.token-tag');
    if (tagEl) {
      e.stopPropagation();
      openTagDetail(tagEl.dataset.tag);
      return;
    }
    enterEdit(div, entry, edit, rendered);
  });

  edit.addEventListener('blur', () => {
    commitEdit(div, entry, edit, rendered);
  });

  edit.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); edit.blur(); }
    if (e.key === 'Escape') { edit.value = entry.raw; edit.blur(); }
  });

  return div;
}


function enterEdit(div, entry, edit, rendered) {
  div.classList.add('editing');
  edit.value = entry.raw;
  edit.focus();
  edit.setSelectionRange(edit.value.length, edit.value.length);
}

function commitEdit(div, entry, edit, rendered) {
  const newRaw = edit.value.trim();
  div.classList.remove('editing');
  if (!newRaw || newRaw === entry.raw) {
    rendered.innerHTML = renderTokens(entry.raw, entry.type);
    return;
  }
  const parsed = parseEntry(newRaw);
  entry.raw = newRaw;
  entry.price = parsed.price;
  entry.tags = parsed.tags;
  entry.note = parsed.note;

  // Ensure new tags exist
  ensureTags(parsed.tags);

  const entries = DB.entries;
  const idx = entries.findIndex(e => e.id === entry.id);
  if (idx !== -1) entries[idx] = entry;
  DB.entries = entries;

  rendered.innerHTML = renderTokens(entry.raw, entry.type);

  // Re-render tag tree if visible
  if (currentView === 'tags') renderTagTree();
}

// ─── Composer ───────────────────────────────────────────────────────────────
let composerType = 'expense';
let composerWishlist = false;
let composerOverrideDay = null; // 'YYYY-MM-DD' when backfilling a specific day

const typeToggle = document.getElementById('type-toggle');
const wishlistToggle = document.getElementById('wishlist-toggle');
const entryInput = document.getElementById('entry-input');
const autocompleteMenu = document.getElementById('autocomplete-menu');
const submitBtn = document.getElementById('submit-btn');

typeToggle.addEventListener('click', () => {
  composerType = composerType === 'expense' ? 'income' : 'expense';
  typeToggle.textContent = composerType === 'expense' ? '－' : '＋';
  typeToggle.className = `type-btn ${composerType}`;
});

wishlistToggle.addEventListener('change', () => {
  composerWishlist = wishlistToggle.checked;
});

// Autocomplete logic
let acQuery = '';
let acSuggestions = [];

entryInput.addEventListener('input', () => {
  handleAutocomplete(entryInput, autocompleteMenu, false);
});

entryInput.addEventListener('keydown', e => {
  if (!autocompleteMenu.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1, autocompleteMenu); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveAC(-1, autocompleteMenu); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const sel = autocompleteMenu.querySelector('.selected');
      if (sel) { e.preventDefault(); applyAC(sel.dataset.value, entryInput, autocompleteMenu); return; }
    }
    if (e.key === 'Escape') { hideAC(autocompleteMenu); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitEntry();
  }
});

submitBtn.addEventListener('click', submitEntry);

function submitEntry(inputEl, typeVal, wishlistVal, injectedTag) {
  inputEl = inputEl || entryInput;
  typeVal = typeVal !== undefined ? typeVal : composerType;
  wishlistVal = wishlistVal !== undefined ? wishlistVal : composerWishlist;

  let raw = inputEl.innerText.trim();
  if (!raw) return;

  if (injectedTag && !raw.includes('#' + injectedTag)) {
    raw = '#' + injectedTag + ' ' + raw;
  }

  const parsed = parseEntry(raw);
  ensureTags(parsed.tags);

  let ts;
  if (inputEl === entryInput && composerOverrideDay) {
    const [oy, om, od] = composerOverrideDay.split('-').map(Number);
    const now = new Date();
    ts = new Date(oy, om - 1, od, now.getHours(), now.getMinutes(), 0).toISOString();
    composerOverrideDay = null;
  } else {
    ts = new Date().toISOString();
  }

  const entry = {
    id: genId(),
    timestamp: ts,
    raw,
    price: parsed.price,
    tags: parsed.tags,
    note: parsed.note,
    type: typeVal,
    isWishlist: wishlistVal,
  };

  const entries = DB.entries;
  entries.push(entry);
  DB.entries = entries;

  inputEl.innerText = '';
  hideAC(autocompleteMenu);

  // Reset
  if (inputEl === entryInput) {
    composerType = 'expense';
    composerWishlist = false;
    typeToggle.textContent = '－';
    typeToggle.className = 'type-btn expense';
    wishlistToggle.checked = false;
    renderTimeline();
  } else {
    renderTagDetail(currentTagPath);
  }

  if (currentView === 'tags') renderTagTree();
}

// ─── Autocomplete core ──────────────────────────────────────────────────────
function getCaretTagQuery(el) {
  const text = el.innerText || '';
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  const pre = preRange.toString();

  const hashIdx = pre.lastIndexOf('#');
  if (hashIdx === -1) return null;
  // Make sure there's no space after the last #
  const afterHash = pre.slice(hashIdx + 1);
  if (/\s/.test(afterHash)) return null;
  return afterHash;
}

function handleAutocomplete(inputEl, menuEl, isTagComposer) {
  const query = getCaretTagQuery(inputEl);
  if (query === null) { hideAC(menuEl); return; }
  acQuery = query;
  acSuggestions = getTagSuggestions(query);
  if (!acSuggestions.length) { hideAC(menuEl); return; }
  renderAC(menuEl, acSuggestions, query, inputEl);
}

function renderAC(menuEl, suggestions, query, inputEl) {
  menuEl.innerHTML = '';
  menuEl.classList.remove('hidden');
  autocompleteIndex = -1;
  suggestions.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.value = s;
    item.innerHTML = highlightMatch(s, query);
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      applyAC(s, inputEl, menuEl);
    });
    menuEl.appendChild(item);
  });
}

function hideAC(menuEl) {
  menuEl.classList.add('hidden');
  autocompleteIndex = -1;
}

function moveAC(dir, menuEl) {
  const items = menuEl.querySelectorAll('.autocomplete-item');
  if (!items.length) return;
  items[autocompleteIndex]?.classList.remove('selected');
  autocompleteIndex = Math.max(-1, Math.min(items.length - 1, autocompleteIndex + dir));
  items[autocompleteIndex]?.classList.add('selected');
}

function applyAC(value, inputEl, menuEl) {
  // Replace the current #query with #value
  const text = inputEl.innerText;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(inputEl);
  preRange.setEnd(range.startContainer, range.startOffset);
  const pre = preRange.toString();
  const hashIdx = pre.lastIndexOf('#');
  if (hashIdx === -1) return;

  // Reconstruct: everything before #, then #value, then rest
  const post = text.slice(pre.length);
  const newText = text.slice(0, hashIdx) + '#' + value + (post.startsWith(' ') ? '' : ' ') + post;
  inputEl.innerText = newText;

  // Move caret to after inserted tag
  const newPos = hashIdx + 1 + value.length + 1;
  moveCaret(inputEl, Math.min(newPos, newText.length));

  hideAC(menuEl);
}

function moveCaret(el, pos) {
  const range = document.createRange();
  const sel = window.getSelection();
  let node = el.firstChild;
  if (!node) return;
  // If text node
  if (node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.min(pos, node.length));
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ─── Tag Tree ───────────────────────────────────────────────────────────────
function buildTagTree(tags, entries) {
  // Build nested structure
  const root = {};
  tags.forEach(t => {
    const parts = t.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (!node[part]) node[part] = { _children: {}, _path: parts.slice(0, i+1).join('/') };
      node = node[part]._children;
    });
  });
  return root;
}

function getEntriesForTag(path, entries) {
  return entries.filter(e => e.tags.some(tp => tp === path || tp.startsWith(path + '/')));
}

function renderTagTree() {
  const tags = DB.tags;
  const entries = DB.entries;
  const tree = buildTagTree(tags, entries);
  const container = document.getElementById('tag-tree');
  container.innerHTML = '';
  renderTreeLevel(tree, container, entries);
}

function renderTreeLevel(node, container, entries) {
  Object.keys(node).sort().forEach(key => {
    const child = node[key];
    const path = child._path;
    const hasChildren = Object.keys(child._children).length > 0;
    const nodeEntries = getEntriesForTag(path, entries);
    const s = summarize(nodeEntries);

    const nodeEl = document.createElement('div');
    nodeEl.className = 'tree-node';

    const header = document.createElement('div');
    header.className = 'tree-node-header';

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = hasChildren ? '▶' : ' ';

    const name = document.createElement('span');
    name.className = 'tree-node-name';
    name.textContent = key;

    const summary = document.createElement('span');
    summary.className = 'tree-node-summary';
    summary.innerHTML = summaryHTML(s);

    const openBtn = document.createElement('button');
    openBtn.className = 'tree-open-btn';
    openBtn.textContent = '→';
    openBtn.title = '查看详情';
    openBtn.addEventListener('click', e => {
      e.stopPropagation();
      openTagDetail(path);
    });

    header.appendChild(toggle);
    header.appendChild(name);
    header.appendChild(summary);
    header.appendChild(openBtn);
    nodeEl.appendChild(header);

    if (hasChildren) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children';
      renderTreeLevel(child._children, childrenEl, entries);
      nodeEl.appendChild(childrenEl);

      header.addEventListener('click', () => {
        nodeEl.classList.toggle('open');
      });
    } else {
      header.addEventListener('click', () => openTagDetail(path));
    }

    container.appendChild(nodeEl);
  });
}

// ─── Tag Detail ─────────────────────────────────────────────────────────────
function openTagDetail(path) {
  currentTagPath = path;
  renderTagDetail(path);
  document.getElementById('tag-detail').classList.remove('hidden');
}

function renderTagDetail(path) {
  const entries = getEntriesForTag(path, DB.entries)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const s = summarize(entries);

  document.getElementById('tag-detail-name').textContent = path;
  document.getElementById('tag-detail-summary').innerHTML = summaryHTML(s);

  const list = document.getElementById('tag-detail-entries');
  list.innerHTML = '';
  entries.forEach(e => list.appendChild(buildEntryEl(e)));
}

// Tag rename
const tagDetailName = document.getElementById('tag-detail-name');
let nameBeforeFocus = '';

tagDetailName.addEventListener('focus', () => {
  nameBeforeFocus = tagDetailName.textContent.trim();
});

tagDetailName.addEventListener('blur', () => {
  const newPath = tagDetailName.textContent.trim();
  if (newPath && newPath !== nameBeforeFocus) {
    renameTag(nameBeforeFocus, newPath);
    currentTagPath = newPath;
    renderTagDetail(newPath);
    renderTagTree();
  }
});

tagDetailName.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); tagDetailName.blur(); }
  if (e.key === 'Escape') { tagDetailName.textContent = nameBeforeFocus; tagDetailName.blur(); }
});

document.getElementById('tag-detail-back').addEventListener('click', () => {
  document.getElementById('tag-detail').classList.add('hidden');
  currentTagPath = null;
});

// Tag composer
const tagTypeBtn = document.querySelector('.tag-type-toggle');
const tagWishlistToggle = document.querySelector('.tag-wishlist-toggle');
const tagInput = document.querySelector('.tag-entry-input');
const tagACMenu = document.querySelector('.tag-autocomplete-menu');
const tagSubmitBtn = document.querySelector('.tag-submit-btn');

tagTypeBtn.addEventListener('click', () => {
  tagTypeBtnType = tagTypeBtnType === 'expense' ? 'income' : 'expense';
  tagTypeBtn.textContent = tagTypeBtnType === 'expense' ? '－' : '＋';
  tagTypeBtn.className = `type-btn ${tagTypeBtnType} tag-type-toggle`;
});

tagWishlistToggle.addEventListener('change', () => {
  tagWishlist = tagWishlistToggle.checked;
});

tagInput.addEventListener('input', () => {
  handleAutocomplete(tagInput, tagACMenu, true);
});

tagInput.addEventListener('keydown', e => {
  if (!tagACMenu.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1, tagACMenu); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveAC(-1, tagACMenu); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const sel = tagACMenu.querySelector('.selected');
      if (sel) { e.preventDefault(); applyAC(sel.dataset.value, tagInput, tagACMenu); return; }
    }
    if (e.key === 'Escape') { hideAC(tagACMenu); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitEntry(tagInput, tagTypeBtnType, tagWishlist, currentTagPath);
  }
});

tagSubmitBtn.addEventListener('click', () => {
  submitEntry(tagInput, tagTypeBtnType, tagWishlist, currentTagPath);
});

// ─── Wishlist Render ─────────────────────────────────────────────────────────
function renderWishlist() {
  const entries = DB.entries
    .filter(e => e.isWishlist)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const list = document.getElementById('wishlist-list');
  list.innerHTML = '';

  if (!entries.length) {
    list.innerHTML = '<p style="color:var(--text-light);padding:24px 0;text-align:center;font-size:14px;">还没有种草条目</p>';
    return;
  }

  entries.forEach(e => {
    const el = buildEntryEl(e);
    // Prepend date instead of time
    const d = new Date(e.timestamp);
    const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
    el.querySelector('.entry-time').textContent = dateStr;
    list.appendChild(el);
  });
}


document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + currentView).classList.add('active');
    if (currentView === 'tags') renderTagTree();
    if (currentView === 'timeline') renderTimeline();
    if (currentView === 'wishlist') renderWishlist();
  });
});

// Month nav
document.getElementById('prev-month').addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() - 1);
  renderTimeline();
});
document.getElementById('next-month').addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() + 1);
  renderTimeline();
});

// ─── Seed data (first run) ──────────────────────────────────────────────────
function seedIfEmpty() {
  if (DB.entries.length) return;
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();

  const seeds = [
    { raw: '#星巴克/馥芮白 32', type: 'expense', tags: ['星巴克/馥芮白'], price: 32 },
    { raw: '#星巴克/馥芮白 38 换了大杯', type: 'expense', tags: ['星巴克/馥芮白'], price: 38 },
    { raw: '#davinci/personal/奶油内页50张 种草备用', type: 'expense', tags: ['davinci/personal/奶油内页50张'], price: null, isWishlist: true },
    { raw: '工资 8000', type: 'income', tags: [], price: 8000 },
    { raw: '午饭 28', type: 'expense', tags: [], price: 28 },
  ];

  const entries = seeds.map((s, i) => ({
    id: genId(),
    timestamp: new Date(y, mo, 5 + i * 3, 10 + i, 0).toISOString(),
    raw: s.raw,
    price: s.price !== undefined ? s.price : parseEntry(s.raw).price,
    tags: s.tags,
    note: parseEntry(s.raw).note,
    type: s.type || 'expense',
    isWishlist: s.isWishlist || false,
  }));

  DB.entries = entries;

  const allTags = [...new Set(seeds.flatMap(s => s.tags))];
  DB.tags = allTags.map(path => ({ id: genId(), path }));
}

// ─── Init ────────────────────────────────────────────────────────────────────
seedIfEmpty();
renderTimeline();
