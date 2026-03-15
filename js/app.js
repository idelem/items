import { state }                              from './state.js';
import { DB, genId }                          from './db.js';
import { parseEntry, ensureItems }            from './parse.js';
import { loadTheme, initTheme }               from './theme.js';
import { initEntries }                        from './entries.js';
import { renderTimeline, renderTree,
         renderWishlist, openDetail,
         renderDetailEntries,
         initDetailRename, initDetailComposer,
         handleAC, hideAC, moveAC, applyAC }  from './views.js';
import { seedIfEmpty }                        from './seed.js';

// ─── switchView (defined here so entries.js can call it via callback) ─────────
function switchView(viewName) {
  state.currentView = viewName;
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === viewName)
  );
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === 'view-' + viewName)
  );
  if (viewName === 'timeline') renderTimeline();
  if (viewName === 'tags')     renderTree('tag-tree',   '#', 'tags',   'tag-tree-node');
  if (viewName === 'places')   renderTree('place-tree', '@', 'places', 'place-tree-node');
  if (viewName === 'wishlist') renderWishlist();
}

// Wire up callbacks before any rendering
initEntries({ openDetail, switchView, renderTimeline, renderDetailEntries });

// ─── Nav ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn:not(#settings-btn)').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

document.getElementById('prev-month').addEventListener('click', () => {
  state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
  renderTimeline();
});
document.getElementById('next-month').addEventListener('click', () => {
  state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
  renderTimeline();
});

document.getElementById('detail-back').addEventListener('click', () => {
  document.getElementById('detail-panel').classList.add('hidden');
  state.detailPath = null;
  switchView(state.detailReturnView);
});

// ─── Main composer ────────────────────────────────────────────────────────────
const typeToggleBtn  = document.getElementById('type-toggle');
const wishlistToggle = document.getElementById('wishlist-toggle');
const entryInput     = document.getElementById('entry-input');
const acMenu         = document.getElementById('autocomplete-menu');
const submitBtn      = document.getElementById('submit-btn');

typeToggleBtn.addEventListener('click', () => {
  state.composerType    = state.composerType === 'expense' ? 'income' : 'expense';
  typeToggleBtn.textContent = state.composerType === 'expense' ? '－' : '＋';
  typeToggleBtn.className   = `type-btn ${state.composerType}`;
});

wishlistToggle.addEventListener('change', () => {
  state.composerWishlist = wishlistToggle.checked;
});

entryInput.addEventListener('input', () => handleAC(entryInput, acMenu));
entryInput.addEventListener('keydown', e => {
  if (!acMenu.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1,  acMenu); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveAC(-1, acMenu); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && acMenu.querySelector('.selected')) {
      e.preventDefault();
      applyAC(acMenu.querySelector('.selected').dataset.value, entryInput, acMenu);
      return;
    }
    if (e.key === 'Escape') { hideAC(acMenu); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitMainEntry(); }
});
submitBtn.addEventListener('click', submitMainEntry);

function submitMainEntry() {
  const raw = entryInput.innerText.trim();
  if (!raw) return;

  const p = parseEntry(raw);
  ensureItems('tags',   p.tags);
  ensureItems('places', p.places);

  let ts;
  if (state.composerOverrideDay) {
    const [oy, om, od] = state.composerOverrideDay.split('-').map(Number);
    const now = new Date();
    ts = new Date(oy, om - 1, od, now.getHours(), now.getMinutes()).toISOString();
    state.composerOverrideDay = null;
  } else {
    ts = new Date().toISOString();
  }

  DB.entries = [...DB.entries, {
    id: genId(), timestamp: ts, raw,
    price: p.price, tags: p.tags, places: p.places,
    ratings: p.ratings, progresses: p.progresses, note: p.note,
    type: state.composerType, isWishlist: state.composerWishlist,
  }];

  entryInput.innerText      = '';
  state.composerType        = 'expense';
  state.composerWishlist    = false;
  typeToggleBtn.textContent = '－';
  typeToggleBtn.className   = 'type-btn expense';
  wishlistToggle.checked    = false;

  renderTimeline();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadTheme();
seedIfEmpty();
initDetailRename();
initDetailComposer();
initTheme();
renderTimeline();
window.addEventListener('load', () => lucide.createIcons());
