import { DB, escapeRegex, genId } from './db.js';

// ─── Regexes ──────────────────────────────────────────────────────────────────
export const TAG_RE    = /#([\w\u4e00-\u9fa5/\-_.·]+)/g;
export const PLACE_RE  = /@([\w\u4e00-\u9fa5/\-_.·]+)/g;
export const SIGIL_RE  = /[#@]([\w\u4e00-\u9fa5/\-_.·]+)/g;
export const RATING_RE = /\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/g;

// Progress: %current  or  %current/total  or  %current/lo-hi
// _N  = any signed number (current position may be negative for clamp)
// _UN = unsigned number (lo, hi, total — never negative separators)
export const _N  = '-?\\d+(?:\\.\\d+)?';
export const _UN = '\\d+(?:\\.\\d+)?';

export function progressRe(flags = 'g') {
  return new RegExp(`%(${_N})(?:/(${_UN})(?:-(${_UN}))?)?`, flags);
}

// ─── parseProgress ────────────────────────────────────────────────────────────
// Returns { pct: 0–1, str: raw match } or null if invalid.
export function parseProgress(raw) {
  const m = raw.match(new RegExp(`^%(${_N})(?:/(${_UN})(?:-(${_UN}))?)?$`));
  if (!m) return null;
  const a = parseFloat(m[1]);

  if (m[2] === undefined) {
    // bare percentage: %68.5
    return { pct: Math.min(1, Math.max(0, a / 100)), str: raw };
  }

  const b = parseFloat(m[2]);
  const c = m[3] !== undefined ? parseFloat(m[3]) : null;

  if (c === null) {
    // fraction: %1/22
    if (b === 0) return null;
    return { pct: Math.min(1, Math.max(0, a / b)), str: raw };
  }

  // inclusive range: %20/2-32  →  (clamp(20,2,32) - 2 + 1) / (32 - 2 + 1)
  const lo = b, hi = c;
  if (hi === lo) return { pct: 1, str: raw };
  const clamped = Math.min(hi, Math.max(lo, a));
  return { pct: (clamped - lo + 1) / (hi - lo + 1), str: raw };
}

// ─── parseEntry ───────────────────────────────────────────────────────────────
export function parseEntry(raw) {
  const tags    = [...raw.matchAll(TAG_RE)].map(m => m[1]);
  const places  = [...raw.matchAll(PLACE_RE)].map(m => m[1]);
  const ratings = [...raw.matchAll(RATING_RE)].map(m => ({
    rating: parseFloat(m[1]), scale: parseFloat(m[2]), str: m[1] + '/' + m[2],
  }));
  const progresses = [...raw.matchAll(progressRe())]
    .map(m => parseProgress(m[0]))
    .filter(Boolean);

  const stripped = raw
    .replace(SIGIL_RE,    '')
    .replace(RATING_RE,   '')
    .replace(progressRe(), '');

  const priceMatch = stripped.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;
  const note  = stripped.replace(/(?:^|\s)\d+(?:\.\d+)?(?=\s|$)/g, '').trim();

  return { price, tags, places, ratings, progresses, note };
}

// ─── Tag / Place registries ───────────────────────────────────────────────────
export function ensureItems(dbKey, paths) {
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

export function renameItem(dbKey, sigil, oldPath, newPath) {
  const items  = DB[dbKey];
  const prefix = oldPath + '/';
  items.forEach(t => {
    if      (t.path === oldPath)           t.path = newPath;
    else if (t.path.startsWith(prefix))    t.path = newPath + '/' + t.path.slice(prefix.length);
  });
  DB[dbKey] = items;

  const field   = dbKey === 'tags' ? 'tags' : 'places';
  const entries = DB.entries;
  entries.forEach(e => {
    e[field] = e[field].map(tp =>
      tp === oldPath        ? newPath :
      tp.startsWith(prefix) ? newPath + '/' + tp.slice(prefix.length) : tp
    );
    e.raw = e.raw.replace(
      new RegExp(escapeRegex(sigil) + escapeRegex(oldPath) + '(?=/|\\s|$)', 'g'),
      sigil + newPath
    );
  });
  DB.entries = entries;
}

// ─── Autocomplete helpers ─────────────────────────────────────────────────────
export function getSuggestions(dbKey, query) {
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
