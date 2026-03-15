import { DB, escapeHtml }          from './db.js';
import { parseEntry, ensureItems }  from './parse.js';
import { renderTokens }             from './render.js';
import { state }                    from './state.js';
// Views are imported lazily via callbacks to avoid circular deps
let _openDetail, _switchView, _renderTimeline, _renderDetailEntries;

export function initEntries({ openDetail, switchView, renderTimeline, renderDetailEntries }) {
  _openDetail          = openDetail;
  _switchView          = switchView;
  _renderTimeline      = renderTimeline;
  _renderDetailEntries = renderDetailEntries;
}

// ─── Build entry DOM element ──────────────────────────────────────────────────
export function buildEntryEl(entry, { showDate = false } = {}) {
  const div = document.createElement('div');
  div.className = 'entry';
  div.dataset.id = entry.id;

  const t    = new Date(entry.timestamp);
  const hhmm = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
  const mmdd = `${t.getMonth() + 1}/${t.getDate()}`;

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
            <i data-lucide="heart"></i>${entry.isWishlist ? '已种草' : '种草'}
          </span>
          <span class="entry-edit-hint">Enter 保存 · Esc 取消</span>
        </div>
      </div>
    </div>
    <div class="entry-actions">
      ${badgesHTML(entry)}
      <button class="entry-delete-btn" title="删除">×</button>
    </div>
  `;

  lucide.createIcons({ nodes: [div] });

  const rendered  = div.querySelector('.entry-rendered');
  const textarea  = div.querySelector('.entry-edit');
  const typeBtn   = div.querySelector('.entry-edit-type');
  const wishBtn   = div.querySelector('.entry-edit-wishlist');
  const timeSpan  = div.querySelector('.entry-time');
  const timeInput = div.querySelector('.entry-time-edit');
  const dateSpan  = div.querySelector('.entry-date');
  const deleteBtn = div.querySelector('.entry-delete-btn');

  // ── Token navigation
  rendered.addEventListener('click', e => {
    const tok = e.target.closest('[data-sigil]');
    if (tok) {
      e.stopPropagation();
      const s = tok.dataset.sigil, p = tok.dataset.path;
      const returnView = s === '#' ? 'tags' : s === '@' ? 'places' : 'timeline';
      _openDetail(s, p, returnView);
      return;
    }
    enterEdit(div, entry, textarea, typeBtn, wishBtn, rendered);
  });

  // ── Date click → jump to that month in timeline
  dateSpan?.addEventListener('click', e => {
    e.stopPropagation();
    const d = new Date(entry.timestamp);
    state.currentMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    _switchView('timeline');
  });

  // ── Time editing
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
    if (state.currentView === 'timeline') _renderTimeline();
  });
  timeInput.addEventListener('blur',    () => { timeInput.style.display = 'none'; timeSpan.style.display = ''; });
  timeInput.addEventListener('keydown', e => { if (e.key === 'Escape') timeInput.blur(); });

  // ── Type / wishlist toggles (only active while editing)
  typeBtn.setAttribute('tabindex', '0');
  wishBtn.setAttribute('tabindex', '0');

  typeBtn.addEventListener('click', () => {
    entry.type = entry.type === 'expense' ? 'income' : 'expense';
    typeBtn.className   = `entry-edit-type ${entry.type}`;
    typeBtn.textContent = entry.type === 'income' ? '＋ 收入' : '－ 支出';
    textarea.focus();
  });

  wishBtn.addEventListener('click', () => {
    entry.isWishlist = !entry.isWishlist;
    wishBtn.classList.toggle('active', entry.isWishlist);
    wishBtn.innerHTML = `<i data-lucide="heart"></i>${entry.isWishlist ? '已种草' : '种草'}`;
    lucide.createIcons({ nodes: [wishBtn] });
    textarea.focus();
  });

  // ── Commit on focusout (handles click-away while editing)
  div.addEventListener('focusout', e => {
    if (!div.contains(e.relatedTarget)) commitEdit(div, entry, textarea, rendered);
  });

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit(div, entry, textarea, rendered);
    }
    if (e.key === 'Escape') {
      entry.type       = entry._origType;
      entry.isWishlist = entry._origWishlist;
      textarea.value   = entry.raw;
      commitEdit(div, entry, textarea, rendered);
    }
  });

  // ── Delete
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!confirm('删除这条记录？')) return;
    DB.entries = DB.entries.filter(en => en.id !== entry.id);
    div.remove();
    if (state.currentView === 'timeline') _renderTimeline();
    if (state.detailPath)                 _renderDetailEntries();
  });

  return div;
}

function badgesHTML(entry) {
  const b = [];
  if (entry.isWishlist)      b.push(`<span class="entry-badge wishlist">种草</span>`);
  if (entry.type === 'income') b.push(`<span class="entry-badge income-badge">收入</span>`);
  return b.join('');
}

// ─── Edit lifecycle ───────────────────────────────────────────────────────────
function enterEdit(div, entry, textarea, typeBtn, wishBtn, rendered) {
  entry._origType     = entry.type;
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
    const p = parseEntry(newRaw);
    Object.assign(entry, {
      raw: newRaw, price: p.price, tags: p.tags, places: p.places,
      ratings: p.ratings, progresses: p.progresses, note: p.note,
    });
    ensureItems('tags',   p.tags);
    ensureItems('places', p.places);
  }
  saveEntry(entry);

  rendered.innerHTML = renderTokens(entry.raw, entry.type);

  // Refresh badges in-place (keep delete button)
  const actions = div.querySelector('.entry-actions');
  const del     = actions.querySelector('.entry-delete-btn');
  actions.innerHTML = badgesHTML(entry);
  actions.appendChild(del);
}

export function saveEntry(entry) {
  const entries = DB.entries;
  const idx     = entries.findIndex(e => e.id === entry.id);
  if (idx !== -1) entries[idx] = entry;
  DB.entries = entries;
}
