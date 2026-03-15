// ─── App State ────────────────────────────────────────────────────────────────
// Single source of truth for mutable UI state.
// Modules read/write these directly; no event bus needed at this scale.

export const state = {
  // Timeline
  currentMonth: (() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  })(),
  currentView: 'timeline',

  // Detail panel
  detailSigil:      '#',
  detailPath:       null,
  detailReturnView: 'tags',

  // Main composer
  composerType:        'expense',
  composerWishlist:    false,
  composerOverrideDay: null,

  // Detail composer
  detailTypeVal:    'expense',
  detailWishlistVal: false,
};
