// ─── Storage ─────────────────────────────────────────────────────────────────
export const DB = {
  get entries() { return JSON.parse(localStorage.getItem('entries') || '[]'); },
  set entries(v) { localStorage.setItem('entries', JSON.stringify(v)); },
  get tags()    { return JSON.parse(localStorage.getItem('tags')    || '[]'); },
  set tags(v)   { localStorage.setItem('tags',    JSON.stringify(v)); },
  get places()  { return JSON.parse(localStorage.getItem('places')  || '[]'); },
  set places(v) { localStorage.setItem('places',  JSON.stringify(v)); },
  get theme()   { return JSON.parse(localStorage.getItem('theme')   || 'null'); },
  set theme(v)  { localStorage.setItem('theme',   JSON.stringify(v)); },
};

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Util ─────────────────────────────────────────────────────────────────────
export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
