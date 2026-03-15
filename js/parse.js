import { DB, escapeRegex, genId } from './db.js';

// ─── Sigil token regex ────────────────────────────────────────────────────────
// Matches both:
//   #word/path          → plain form
//   #(path with spaces) → bracketed form (allows spaces and any char except ")
//
// Capture group 1 = the path string, WITHOUT brackets.
// The full match includes the opening sigil and any brackets.

const SIGIL_CHARS   = '[\\w\\u4e00-\\u9fa5/\\-_.· ]'; // chars allowed inside brackets
const PLAIN_CHARS   = '[\\w\\u4e00-\\u9fa5/\\-_.·]';   // chars allowed in plain form

// Build a single regex for one sigil character
function sigilRe(sigil, flags = 'g') {
  const esc = sigil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // bracketed: #(content)  — capture group 1 = content (trimmed)
  // plain:     #content    — capture group 2 = content
  return new RegExp(
    `${esc}(?:\\(([^)]+)\\)|(${PLAIN_CHARS}+))`,
    flags
  );
}

export const TAG_RE_B   = sigilRe('#');
export const PLACE_RE_B = sigilRe('@');
export const RATING_RE  = /\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/g;

// Legacy plain-only regex used for stripping (no bracket support needed there
// because we strip the full bracketed form separately)
export const SIGIL_STRIP_RE = /[#@](?:\([^)]+\)|[\w\u4e00-\u9fa5/\-_.·]+)/g;

// Extract all paths from a raw string for a given sigil regex.
// Returns array of path strings (no brackets, trimmed).
function extractPaths(raw, re) {
  return [...raw.matchAll(re)].map(m => (m[1] !== undefined ? m[1].trim() : m[2]));
}

// Given a path, return the raw-text form: bracket if it contains spaces.
export function pathToRaw(sigil, path) {
  return path.includes(' ') ? `${sigil}(${path})` : `${sigil}${path}`;
}

// ─── Progress regex ───────────────────────────────────────────────────────────
export const _N  = '-?\\d+(?:\\.\\d+)?';
export const _UN = '\\d+(?:\\.\\d+)?';

export function progressRe(flags = 'g') {
  return new RegExp(`%(${_N})(?:/(${_UN})(?:-(${_UN}))?)?`, flags);
}

// ─── parseProgress ────────────────────────────────────────────────────────────
export function parseProgress(raw) {
  const m = raw.match(new RegExp(`^%(${_N})(?:/(${_UN})(?:-(${_UN}))?)?$`));
  if (!m) return null;
  const a = parseFloat(m[1]);
  if (m[2] === undefined) return { pct: Math.min(1, Math.max(0, a / 100)), str: raw };
  const b = parseFloat(m[2]);
  const c = m[3] !== undefined ? parseFloat(m[3]) : null;
  if (c === null) {
    if (b === 0) return null;
    return { pct: Math.min(1, Math.max(0, a / b)), str: raw };
  }
  const lo = b, hi = c;
  if (hi === lo) return { pct: 1, str: raw };
  const clamped = Math.min(hi, Math.max(lo, a));
  return { pct: (clamped - lo + 1) / (hi - lo + 1), str: raw };
}

// ─── parseEntry ───────────────────────────────────────────────────────────────
export function parseEntry(raw) {
  const tags    = extractPaths(raw, sigilRe('#'));
  const places  = extractPaths(raw, sigilRe('@'));
  const ratings = [...raw.matchAll(RATING_RE)].map(m => ({
    rating: parseFloat(m[1]), scale: parseFloat(m[2]), str: m[1] + '/' + m[2],
  }));
  const progresses = [...raw.matchAll(progressRe())]
    .map(m => parseProgress(m[0]))
    .filter(Boolean);

  const stripped = raw
    .replace(SIGIL_STRIP_RE, '')
    .replace(RATING_RE,      '')
    .replace(progressRe(),   '');

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
    if      (t.path === oldPath)        t.path = newPath;
    else if (t.path.startsWith(prefix)) t.path = newPath + '/' + t.path.slice(prefix.length);
  });
  DB[dbKey] = items;

  const field   = dbKey === 'tags' ? 'tags' : 'places';
  const entries = DB.entries;
  entries.forEach(e => {
    // Update the paths array
    e[field] = e[field].map(tp =>
      tp === oldPath        ? newPath :
      tp.startsWith(prefix) ? newPath + '/' + tp.slice(prefix.length) : tp
    );
    // Update raw text: replace both plain and bracketed forms
    // oldPath plain:     #oldPath  or  #oldPath/suffix
    // oldPath bracketed: #(oldPath) or #(oldPath/suffix)
    e.raw = rewriteRawPaths(e.raw, sigil, oldPath, newPath);
  });
  DB.entries = entries;
}

// Replace all occurrences of sigil+oldPath (and child paths) in raw text,
// choosing plain vs bracket form based on whether newPath contains spaces.
function rewriteRawPaths(raw, sigil, oldPath, newPath) {
  const re = sigilRe(sigil);
  return raw.replace(re, (fullMatch, bracketedPath, plainPath) => {
    const path = bracketedPath !== undefined ? bracketedPath.trim() : plainPath;
    const prefix = oldPath + '/';
    let updatedPath;
    if      (path === oldPath)        updatedPath = newPath;
    else if (path.startsWith(prefix)) updatedPath = newPath + '/' + path.slice(prefix.length);
    else                              return fullMatch; // unrelated tag, keep as-is
    return pathToRaw(sigil, updatedPath);
  });
}

// ─── Autocomplete helpers ─────────────────────────────────────────────────────
export function getSuggestions(dbKey, query) {
  const paths = DB[dbKey].map(t => t.path);
  if (!query) return paths.slice(0, 8);
  // Strip brackets from query before matching
  const cleanQuery = query.replace(/^\(/, '').replace(/\)$/, '').trim();
  const tokens = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
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
