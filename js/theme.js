import { DB, escapeHtml } from './db.js';

// ─── Theme variable definitions ───────────────────────────────────────────────
export const THEME_VARS = [
  { key: '--bg',             label: '背景色' },
  { key: '--surface',        label: '卡片/面板背景' },
  { key: '--text',           label: '正文颜色' },
  { key: '--accent',         label: '主题色 (Accent)' },
  { key: '--income',         label: '收入色' },
  { key: '--expense',        label: '支出色' },
  { key: '--wishlist',       label: '种草色' },
  { key: '--tag-fg',         label: '# 标签文字色' },
  { key: '--tag-bg',         label: '# 标签背景色' },
  { key: '--place-color',    label: '@ 地点色' },
  { key: '--rating-color',   label: '* 评分色' },
  { key: '--progress-color', label: '% 进度色' },
];

export const PRESETS = [
  {
    name: '默认',
    vars: {
      '--bg': '#f7f5f0', '--surface': '#ffffff', '--text': '#1a1814', '--accent': '#2d6a4f',
      '--income': '#2d6a4f', '--expense': '#c0392b', '--wishlist': '#e05c7a',
      '--tag-fg': '#555047', '--tag-bg': '#eeece8',
      '--place-color': '#b05a00', '--rating-color': '#a07800', '--progress-color': '#2563a8',
    },
  },
  {
    name: '暗色',
    vars: {
      '--bg': '#1a1a1e', '--surface': '#26262c', '--text': '#e8e4de', '--accent': '#4ade80',
      '--income': '#4ade80', '--expense': '#f87171', '--wishlist': '#f472b6',
      '--tag-fg': '#aaa8a2', '--tag-bg': '#2e2e34',
      '--place-color': '#fb923c', '--rating-color': '#fbbf24', '--progress-color': '#60a5fa',
    },
  },
  {
    name: '暖米色',
    vars: {
      '--bg': '#fdf6ec', '--surface': '#fffbf4', '--text': '#2d2316', '--accent': '#9b6a2f',
      '--income': '#5a8a3c', '--expense': '#c04030', '--wishlist': '#c0507a',
      '--tag-fg': '#6b5940', '--tag-bg': '#f0e6d4',
      '--place-color': '#8a5a1a', '--rating-color': '#a06820', '--progress-color': '#4a7aaa',
    },
  },
  {
    name: '薄荷',
    vars: {
      '--bg': '#f0f7f4', '--surface': '#ffffff', '--text': '#1a2e26', '--accent': '#0d9488',
      '--income': '#0d9488', '--expense': '#e11d48', '--wishlist': '#db2777',
      '--tag-fg': '#3d6b5e', '--tag-bg': '#ddf0eb',
      '--place-color': '#0369a1', '--rating-color': '#d97706', '--progress-color': '#7c3aed',
    },
  },
];

// ─── Color math ───────────────────────────────────────────────────────────────
export function hexToRgb(hex) {
  hex = hex.trim().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function hexToLightBg(hex) {
  const [r, g, b] = hexToRgb(hex.trim());
  return `rgba(${r},${g},${b},0.12)`;
}

function mixHex(bg, fg, t) {
  try {
    const [br, bg2, bb] = hexToRgb(bg.trim());
    const [fr, fg2, fb] = hexToRgb(fg.trim());
    return rgbToHex(br + (fr-br)*t, bg2 + (fg2-bg2)*t, bb + (fb-bb)*t);
  } catch { return '#888'; }
}

export function applyThemeVars(vars) {
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));

  const get = key => vars[key] || getComputedStyle(root).getPropertyValue(key).trim();
  root.style.setProperty('--accent-light',   hexToLightBg(get('--accent')));
  root.style.setProperty('--expense-light',  hexToLightBg(get('--expense')));
  root.style.setProperty('--wishlist-light', hexToLightBg(get('--wishlist')));
  root.style.setProperty('--place-bg',       hexToLightBg(get('--place-color')));
  root.style.setProperty('--rating-bg',      hexToLightBg(get('--rating-color')));
  root.style.setProperty('--progress-bg',    hexToLightBg(get('--progress-color')));
  root.style.setProperty('--border',      mixHex(get('--bg'), get('--text'), 0.12));
  root.style.setProperty('--text-muted',  mixHex(get('--bg'), get('--text'), 0.50));
  root.style.setProperty('--text-light',  mixHex(get('--bg'), get('--text'), 0.28));
}

export function loadTheme() {
  const saved = DB.theme;
  if (saved) applyThemeVars(saved);
}

// ─── HSV helpers ──────────────────────────────────────────────────────────────
export function hexToHsv(hex) {
  let [r, g, b] = hexToRgb(hex);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let hh = 0;
  const ss = max === 0 ? 0 : d / max;
  const vv = max;
  if (d !== 0) {
    if      (max === r) hh = ((g-b)/d + 6) % 6;
    else if (max === g) hh =  (b-r)/d + 2;
    else                hh =  (r-g)/d + 4;
    hh *= 60;
  }
  return [hh, ss, vv];
}

export function hsvToRgb(h, s, v) {
  const f = (n, k = (n + h/60) % 6) => v - v*s * Math.max(Math.min(k, 4-k, 1), 0);
  return [f(5)*255, f(3)*255, f(1)*255];
}

// ─── Settings modal ───────────────────────────────────────────────────────────
let _pendingTheme = {};

export function initTheme() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  document.getElementById('theme-save').addEventListener('click', () => {
    DB.theme = _pendingTheme;
    closeSettings();
  });

  document.getElementById('theme-reset').addEventListener('click', () => {
    _pendingTheme = { ...PRESETS[0].vars };
    applyThemeVars(_pendingTheme);
    refreshColorPickers();
    document.querySelectorAll('.preset-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  });

  // Single document-level listener to close popovers on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.color-popover').forEach(p => p.classList.add('hidden'));
  });
}

function openSettings() {
  const root = document.documentElement;
  _pendingTheme = {};
  THEME_VARS.forEach(({ key }) => {
    _pendingTheme[key] = getComputedStyle(root).getPropertyValue(key).trim();
  });

  renderPresets();
  renderColorPickers();

  document.getElementById('settings-overlay').classList.remove('hidden');
  document.getElementById('settings-modal').classList.remove('hidden');
  lucide.createIcons({ nodes: [document.getElementById('settings-modal')] });
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
  document.getElementById('settings-modal').classList.add('hidden');
  document.querySelectorAll('.color-popover').forEach(p => p.classList.add('hidden'));
  const saved = DB.theme;
  applyThemeVars(saved || PRESETS[0].vars);
}

function renderPresets() {
  const list = document.getElementById('preset-list');
  list.innerHTML = '';
  PRESETS.forEach((preset, i) => {
    const btn    = document.createElement('button');
    btn.className = 'preset-btn';
    const swatches = ['--accent', '--expense', '--wishlist'].map(k => preset.vars[k] || '#ccc');
    btn.innerHTML =
      `<span class="preset-swatch">${swatches.map(c => `<span class="preset-dot" style="background:${c}"></span>`).join('')}</span>` +
      escapeHtml(preset.name);
    btn.addEventListener('click', () => {
      _pendingTheme = { ..._pendingTheme, ...preset.vars };
      applyThemeVars(_pendingTheme);
      refreshColorPickers();
      list.querySelectorAll('.preset-btn').forEach((b, j) => b.classList.toggle('active', j === i));
    });
    list.appendChild(btn);
  });
}

function renderColorPickers() {
  const container = document.getElementById('color-pickers');
  container.innerHTML = '';
  THEME_VARS.forEach(({ key, label }) => {
    const row = document.createElement('div');
    row.className = 'color-row';
    row.innerHTML = `<div class="color-row-label">${escapeHtml(label)}</div>`;

    const wrap = document.createElement('div');
    wrap.className = 'color-picker-wrap';
    const hex = _pendingTheme[key] || '#888888';
    wrap.innerHTML = `
      <button class="color-swatch-btn" data-key="${escapeHtml(key)}">
        <span class="color-swatch" style="background:${hex}"></span>
        <span class="swatch-hex">${hex}</span>
      </button>
      <div class="color-popover hidden" data-key="${escapeHtml(key)}"></div>
    `;

    const swatchBtn = wrap.querySelector('.color-swatch-btn');
    const popover   = wrap.querySelector('.color-popover');

    // Stop clicks/mousedowns inside popover from closing it
    popover.addEventListener('click',     e => e.stopPropagation());
    popover.addEventListener('mousedown', e => e.stopPropagation());

    swatchBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !popover.classList.contains('hidden');
      document.querySelectorAll('.color-popover').forEach(p => p.classList.add('hidden'));
      if (!isOpen) {
        popover.classList.remove('hidden');
        buildColorPicker(popover, key, _pendingTheme[key] || hex);
      }
    });

    row.appendChild(wrap);
    container.appendChild(row);
  });
}

function refreshColorPickers() {
  THEME_VARS.forEach(({ key }) => {
    const hex = _pendingTheme[key] || '#888888';
    const btn = document.querySelector(`.color-swatch-btn[data-key="${key}"]`);
    if (!btn) return;
    btn.querySelector('.color-swatch').style.background = hex;
    btn.querySelector('.swatch-hex').textContent = hex;
  });
}

// ─── Color picker widget ──────────────────────────────────────────────────────
function buildColorPicker(container, varKey, initialHex) {
  container.innerHTML = '';
  let [h, s, v] = hexToHsv(initialHex);

  container.innerHTML = `
    <div class="cp-gradient-wrap">
      <canvas class="cp-gradient-canvas"></canvas>
      <div class="cp-gradient-cursor"></div>
    </div>
    <div class="cp-hue-wrap"><div class="cp-hue-thumb"></div></div>
    <div class="cp-hex-row">
      <input class="cp-hex-input" type="text" value="${initialHex}" maxlength="7" spellcheck="false">
      <div class="cp-preview" style="background:${initialHex}"></div>
    </div>
  `;

  const canvas   = container.querySelector('.cp-gradient-canvas');
  const cursor   = container.querySelector('.cp-gradient-cursor');
  const hueWrap  = container.querySelector('.cp-hue-wrap');
  const hueThumb = container.querySelector('.cp-hue-thumb');
  const hexInput = container.querySelector('.cp-hex-input');
  const preview  = container.querySelector('.cp-preview');

  function drawGradient() {
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    canvas.width = W; canvas.height = H;
    const gW = ctx.createLinearGradient(0, 0, W, 0);
    gW.addColorStop(0, '#fff');
    gW.addColorStop(1, `hsl(${h},100%,50%)`);
    ctx.fillStyle = gW; ctx.fillRect(0, 0, W, H);
    const gB = ctx.createLinearGradient(0, 0, 0, H);
    gB.addColorStop(0, 'transparent');
    gB.addColorStop(1, '#000');
    ctx.fillStyle = gB; ctx.fillRect(0, 0, W, H);
  }

  function updateCursor() {
    cursor.style.left = (s * canvas.offsetWidth)  + 'px';
    cursor.style.top  = ((1-v) * canvas.offsetHeight) + 'px';
  }

  function updateHueThumb() {
    hueThumb.style.left = (h / 360 * 100) + '%';
  }

  function updateOutput() {
    const hex = rgbToHex(...hsvToRgb(h, s, v));
    _pendingTheme[varKey] = hex;
    hexInput.value = hex;
    preview.style.background = hex;
    const wrap = container.closest('.color-picker-wrap');
    wrap.querySelector('.color-swatch').style.background = hex;
    wrap.querySelector('.swatch-hex').textContent = hex;
    applyThemeVars(_pendingTheme);
  }

  function makeDragHandler(onMove) {
    return function onDown(e) {
      e.stopPropagation();
      const move = ev => { ev.stopPropagation(); onMove(ev); };
      const up   = ev => {
        ev.stopPropagation();
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup',   up);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend',  up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup',   up);
      window.addEventListener('touchmove', move);
      window.addEventListener('touchend',  up);
      move(e);
    };
  }

  canvas.addEventListener('mousedown', makeDragHandler(ev => {
    const rect = canvas.getBoundingClientRect();
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    s = Math.max(0, Math.min(1, (cx - rect.left)  / rect.width));
    v = Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height));
    updateCursor(); updateOutput();
  }));

  hueWrap.addEventListener('mousedown', makeDragHandler(ev => {
    const rect = hueWrap.getBoundingClientRect();
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    h = Math.max(0, Math.min(360, ((cx - rect.left) / rect.width) * 360));
    updateHueThumb(); drawGradient(); updateOutput();
  }));

  hexInput.addEventListener('change', () => {
    const val = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      [h, s, v] = hexToHsv(val);
      drawGradient(); updateCursor(); updateHueThumb(); updateOutput();
    }
  });
  hexInput.addEventListener('click', e => e.stopPropagation());

  setTimeout(() => { drawGradient(); updateCursor(); updateHueThumb(); }, 0);
}
