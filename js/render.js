import { escapeHtml } from './db.js';
import { _N, _UN, progressRe, parseProgress } from './parse.js';

// ─── Stars ────────────────────────────────────────────────────────────────────
export function renderStars(rating, scale) {
  const total = Math.round(scale);
  let out = '<span class="token-stars">';
  for (let i = 1; i <= total; i++) {
    const fill = rating - (i - 1);
    out += `<span class="star ${fill >= 1 ? 'full' : fill >= 0.5 ? 'half' : 'empty'}">★</span>`;
  }
  return out + '</span>';
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
export function renderProgressToken(p) {
  const pct = Math.round(p.pct * 100);
  return (
    `<a class="token-progress" data-sigil="%" data-path="${escapeHtml(p.str)}">` +
    `<span class="progress-bar-wrap">` +
    `<span class="progress-bar-fill" style="width:${p.pct * 100}%"></span></span>` +
    `<span class="progress-label">${escapeHtml(p.str.replace(/^%/, ''))} ` +
    `<span style="opacity:.6">${pct}%</span></span></a>`
  );
}

// ─── Full token rendering ─────────────────────────────────────────────────────
export function renderTokens(raw, type) {
  const parts = [];

  for (const m of raw.matchAll(/#([\w\u4e00-\u9fa5/\-_.·]+)/g))
    parts.push({ start: m.index, end: m.index + m[0].length, kind: 'tag', value: m[1] });

  for (const m of raw.matchAll(/@([\w\u4e00-\u9fa5/\-_.·]+)/g))
    parts.push({ start: m.index, end: m.index + m[0].length, kind: 'place', value: m[1] });

  for (const m of raw.matchAll(/\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/g))
    parts.push({
      start: m.index, end: m.index + m[0].length, kind: 'rating',
      rating: parseFloat(m[1]), scale: parseFloat(m[2]), str: m[1] + '/' + m[2],
    });

  for (const m of raw.matchAll(progressRe())) {
    const p = parseProgress(m[0]);
    if (p) parts.push({ start: m.index, end: m.index + m[0].length, kind: 'progress', p });
  }

  // Mask all special tokens before scanning for bare prices
  const masked = raw
    .replace(/[#@][\w\u4e00-\u9fa5/\-_.·]+/g, s => ' '.repeat(s.length))
    .replace(/\*\d+(?:\.\d+)?\/\d+(?:\.\d+)?/g, s => ' '.repeat(s.length))
    .replace(progressRe(), s => ' '.repeat(s.length));

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
    switch (p.kind) {
      case 'tag':
        out += `<a class="token-tag" data-sigil="#" data-path="${escapeHtml(p.value)}">#${escapeHtml(p.value)}</a>`;
        break;
      case 'place':
        out += `<a class="token-place" data-sigil="@" data-path="${escapeHtml(p.value)}">@${escapeHtml(p.value)}</a>`;
        break;
      case 'rating':
        out += `<a class="token-rating" data-sigil="*" data-path="${escapeHtml(p.str)}">` +
               `${renderStars(p.rating, p.scale)}<span class="rating-label">${escapeHtml(p.str)}</span></a>`;
        break;
      case 'progress':
        out += renderProgressToken(p.p);
        break;
      default:
        out += `<span class="token-price${type === 'income' ? ' income' : ''}">${escapeHtml(p.value)}</span>`;
    }
    last = p.end;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}

// ─── Summary ──────────────────────────────────────────────────────────────────
export function summarize(entries) {
  let income = 0, expense = 0;
  entries.forEach(e => {
    if (e.isWishlist || e.price == null) return;
    if (e.type === 'income') income += e.price; else expense += e.price;
  });
  return { income, expense };
}

export function fmtMoney(n) {
  return n.toFixed(2).replace(/\.00$/, '');
}

export function summaryHTML({ income, expense }) {
  const p = [];
  if (expense) p.push(`<span class="expense">－${fmtMoney(expense)}</span>`);
  if (income)  p.push(`<span class="income">＋${fmtMoney(income)}</span>`);
  if (income || expense) {
    const net = income - expense;
    p.push(`<span class="net">净 ${net >= 0 ? '＋' : '－'}${fmtMoney(Math.abs(net))}</span>`);
  }
  return p.join('');
}

// ─── Autocomplete highlight ───────────────────────────────────────────────────
export function highlightMatch(path, query) {
  if (!query) return escapeHtml(path);
  let r = escapeHtml(path);
  query.toLowerCase().split(/\s+/).filter(Boolean).forEach(t => {
    r = r.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
  });
  return r;
}
