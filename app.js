// ─── Storage ────────────────────────────────────────────────────────────────
const DB = {
  get entries() { return JSON.parse(localStorage.getItem('entries') || '[]'); },
  set entries(v) { localStorage.setItem('entries', JSON.stringify(v)); },
  get tags()    { return JSON.parse(localStorage.getItem('tags')    || '[]'); },
  set tags(v)   { localStorage.setItem('tags',    JSON.stringify(v)); },
  get places()  { return JSON.parse(localStorage.getItem('places')  || '[]'); },
  set places(v) { localStorage.setItem('places',  JSON.stringify(v)); },
  get theme()   { return JSON.parse(localStorage.getItem('theme')   || 'null'); },
  set theme(v)  { localStorage.setItem('theme',   JSON.stringify(v)); },
};

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Parse ───────────────────────────────────────────────────────────────────
const TAG_RE      = /#([\w\u4e00-\u9fa5/\-_.·]+)/g;
const PLACE_RE    = /@([\w\u4e00-\u9fa5/\-_.·]+)/g;
const SIGIL_RE    = /[#@]([\w\u4e00-\u9fa5/\-_.·]+)/g;
const RATING_RE   = /\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/g;
// %68.5  or  %1/22  or  %-1/2-32
const PROGRESS_RE = /%([-\d.]+)(?:\/([-\d.]+)(?:-([-\d.]+))?)?/g;

function parseProgress(raw) {
  // returns { pct: 0-1, str: original match string } or null if invalid
  const m = raw.match(/^%([-\d.]+)(?:\/([-\d.]+)(?:-([-\d.]+))?)?$/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  if (m[2] === undefined) {
    // bare percentage
    return { pct: Math.min(1, Math.max(0, a / 100)), str: m[0] };
  }
  const b = parseFloat(m[2]);
  const c = m[3] !== undefined ? parseFloat(m[3]) : null;
  if (c === null) {
    // fraction a/b
    if (b === 0) return null;
    return { pct: Math.min(1, Math.max(0, a / b)), str: m[0] };
  }
  // range: current=a, lo=b, hi=c
  const lo = b, hi = c;
  if (hi === lo) return { pct: 1, str: m[0] };
  const clamped = Math.min(hi, Math.max(lo, a));
  return { pct: (clamped - lo) / (hi - lo), str: m[0] };
}

function parseEntry(raw) {
  const tags    = [...raw.matchAll(TAG_RE)].map(m => m[1]);
  const places  = [...raw.matchAll(PLACE_RE)].map(m => m[1]);
  const ratings = [...raw.matchAll(RATING_RE)].map(m => ({
    rating: parseFloat(m[1]), scale: parseFloat(m[2]), str: m[1]+'/'+m[2]
  }));
  const progMatches = [...raw.matchAll(PROGRESS_RE)];
  const progresses  = progMatches.map(m => parseProgress(m[0])).filter(Boolean);

  const stripped = raw
    .replace(SIGIL_RE, '')
    .replace(RATING_RE, '')
    .replace(PROGRESS_RE, '');
  const priceMatch = stripped.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;
  const note  = stripped.replace(/(?:^|\s)\d+(?:\.\d+)?(?=\s|$)/g,'').trim();

  return { price, tags, places, ratings, progresses, note };
}

// ─── Registries ──────────────────────────────────────────────────────────────
function ensureItems(dbKey, paths) {
  const items = DB[dbKey]; let changed = false;
  for (const path of paths) {
    if (!items.find(t => t.path === path)) { items.push({ id: genId(), path }); changed = true; }
  }
  if (changed) DB[dbKey] = items;
}

function renameItem(dbKey, sigil, oldPath, newPath) {
  const items = DB[dbKey], prefix = oldPath+'/';
  items.forEach(t => {
    if (t.path === oldPath) t.path = newPath;
    else if (t.path.startsWith(prefix)) t.path = newPath+'/'+t.path.slice(prefix.length);
  });
  DB[dbKey] = items;
  const field = dbKey === 'tags' ? 'tags' : 'places';
  const entries = DB.entries;
  entries.forEach(e => {
    e[field] = e[field].map(tp => tp === oldPath ? newPath : tp.startsWith(prefix) ? newPath+'/'+tp.slice(prefix.length) : tp);
    e.raw = e.raw.replace(new RegExp(escapeRegex(sigil)+escapeRegex(oldPath)+'(?=/|\\s|$)','g'), sigil+newPath);
  });
  DB.entries = entries;
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────
function getSuggestions(dbKey, query) {
  const paths = DB[dbKey].map(t => t.path);
  if (!query) return paths.slice(0,8);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return paths.filter(path => {
    const lower = path.toLowerCase(); let pos = 0;
    for (const t of tokens) { const idx = lower.indexOf(t,pos); if (idx===-1) return false; pos = idx+t.length; }
    return true;
  }).slice(0,10);
}

function highlightMatch(path, query) {
  if (!query) return escapeHtml(path);
  let r = escapeHtml(path);
  query.toLowerCase().split(/\s+/).filter(Boolean).forEach(t => {
    r = r.replace(new RegExp('('+escapeRegex(t)+')','gi'), '<mark>$1</mark>');
  });
  return r;
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderStars(rating, scale) {
  const total = Math.round(scale);
  let out = '<span class="token-stars">';
  for (let i = 1; i <= total; i++) {
    const fill = rating-(i-1);
    out += `<span class="star ${fill>=1?'full':fill>=0.5?'half':'empty'}">★</span>`;
  }
  return out + '</span>';
}

function renderProgressToken(p) {
  const pct = Math.round(p.pct * 100);
  return `<a class="token-progress" data-sigil="%" data-path="${escapeHtml(p.str)}">` +
    `<span class="progress-bar-wrap"><span class="progress-bar-fill" style="width:${p.pct*100}%"></span></span>` +
    `<span class="progress-label">${escapeHtml(p.str.replace(/^%/,''))} <span style="opacity:.6">${pct}%</span></span>` +
    `</a>`;
}

function renderTokens(raw, type) {
  const parts = [];

  for (const m of raw.matchAll(/#([\w\u4e00-\u9fa5/\-_.·]+)/g))
    parts.push({ start:m.index, end:m.index+m[0].length, kind:'tag', value:m[1] });
  for (const m of raw.matchAll(/@([\w\u4e00-\u9fa5/\-_.·]+)/g))
    parts.push({ start:m.index, end:m.index+m[0].length, kind:'place', value:m[1] });
  for (const m of raw.matchAll(/\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/g))
    parts.push({ start:m.index, end:m.index+m[0].length, kind:'rating',
      rating:parseFloat(m[1]), scale:parseFloat(m[2]), str:m[1]+'/'+m[2] });
  for (const m of raw.matchAll(/%([-\d.]+)(?:\/([-\d.]+)(?:-([-\d.]+))?)?/g)) {
    const p = parseProgress(m[0]);
    if (p) parts.push({ start:m.index, end:m.index+m[0].length, kind:'progress', p });
  }

  const masked = raw
    .replace(/[#@][\w\u4e00-\u9fa5/\-_.·]+/g, s=>' '.repeat(s.length))
    .replace(/\*\d+(?:\.\d+)?\/\d+(?:\.\d+)?/g, s=>' '.repeat(s.length))
    .replace(/%([-\d.]+)(?:\/([-\d.]+)(?:-([-\d.]+))?)?/g, s=>' '.repeat(s.length));
  for (const m of masked.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/g)) {
    const ns = m.index+m[0].length-m[1].length, ne = ns+m[1].length;
    if (!parts.some(p => ns<p.end && ne>p.start))
      parts.push({ start:ns, end:ne, kind:'price', value:m[1] });
  }

  parts.sort((a,b) => a.start-b.start);
  let out='', last=0;
  for (const p of parts) {
    out += escapeHtml(raw.slice(last, p.start));
    if (p.kind==='tag')
      out += `<a class="token-tag" data-sigil="#" data-path="${escapeHtml(p.value)}">#${escapeHtml(p.value)}</a>`;
    else if (p.kind==='place')
      out += `<a class="token-place" data-sigil="@" data-path="${escapeHtml(p.value)}">@${escapeHtml(p.value)}</a>`;
    else if (p.kind==='rating')
      out += `<a class="token-rating" data-sigil="*" data-path="${escapeHtml(p.str)}">${renderStars(p.rating,p.scale)}<span class="rating-label">${escapeHtml(p.str)}</span></a>`;
    else if (p.kind==='progress')
      out += renderProgressToken(p.p);
    else
      out += `<span class="token-price${type==='income'?' income':''}">${escapeHtml(p.value)}</span>`;
    last = p.end;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function summarize(entries) {
  let income=0, expense=0;
  entries.forEach(e => {
    if (e.isWishlist || e.price==null) return;
    if (e.type==='income') income+=e.price; else expense+=e.price;
  });
  return { income, expense };
}
function fmtMoney(n) { return n.toFixed(2).replace(/\.00$/,''); }
function summaryHTML({income,expense}) {
  const p=[];
  if (expense) p.push(`<span class="expense">－${fmtMoney(expense)}</span>`);
  if (income)  p.push(`<span class="income">＋${fmtMoney(income)}</span>`);
  if (income||expense) {
    const net=income-expense;
    p.push(`<span class="net">净 ${net>=0?'＋':'－'}${fmtMoney(Math.abs(net))}</span>`);
  }
  return p.join('');
}

// ─── App State ────────────────────────────────────────────────────────────────
let currentMonth = (() => { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
let currentView = 'timeline';
let detailSigil = '#', detailPath = null, detailReturnView = 'tags';
let composerType = 'expense', composerWishlist = false, composerOverrideDay = null;
let detailTypeVal = 'expense', detailWishlistVal = false;

// ─── Entry element ────────────────────────────────────────────────────────────
function buildEntryEl(entry, { showDate=false }={}) {
  const div = document.createElement('div');
  div.className = 'entry';
  div.dataset.id = entry.id;

  const t = new Date(entry.timestamp);
  const hhmm = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
  const mmdd = `${t.getMonth()+1}/${t.getDate()}`;

  const badges = [];
  if (entry.isWishlist) badges.push(`<span class="entry-badge wishlist">种草</span>`);
  if (entry.type==='income') badges.push(`<span class="entry-badge income-badge">收入</span>`);

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
          <button class="entry-edit-type ${entry.type}">${entry.type==='income'?'＋ 收入':'－ 支出'}</button>
          <span class="entry-edit-wishlist${entry.isWishlist?' active':''}">
            <i data-lucide="heart"></i>${entry.isWishlist?'已种草':'种草'}
          </span>
          <span class="entry-edit-hint">Enter 保存 · Esc 取消</span>
        </div>
      </div>
    </div>
    <div class="entry-actions">${badges.join('')}<button class="entry-delete-btn" title="删除">×</button></div>
  `;
  lucide.createIcons({ nodes:[div] });

  const rendered  = div.querySelector('.entry-rendered');
  const textarea  = div.querySelector('.entry-edit');
  const typeBtn   = div.querySelector('.entry-edit-type');
  const wishBtn   = div.querySelector('.entry-edit-wishlist');
  const timeSpan  = div.querySelector('.entry-time');
  const timeInput = div.querySelector('.entry-time-edit');
  const dateSpan  = div.querySelector('.entry-date');
  const deleteBtn = div.querySelector('.entry-delete-btn');

  rendered.addEventListener('click', e => {
    const tok = e.target.closest('[data-sigil]');
    if (tok) {
      e.stopPropagation();
      const s = tok.dataset.sigil, p = tok.dataset.path;
      if      (s==='#') openDetail('#', p, 'tags');
      else if (s==='@') openDetail('@', p, 'places');
      else if (s==='*') openDetail('*', p, 'timeline');
      else if (s==='%') openDetail('%', p, 'timeline');
      return;
    }
    enterEdit(div, entry, textarea, typeBtn, wishBtn, rendered);
  });

  if (dateSpan) {
    dateSpan.addEventListener('click', e => {
      e.stopPropagation();
      const d = new Date(entry.timestamp);
      currentMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      switchView('timeline');
    });
  }

  timeSpan.addEventListener('click', e => {
    e.stopPropagation();
    timeSpan.style.display='none'; timeInput.style.display='inline-block'; timeInput.focus();
  });
  timeInput.addEventListener('change', () => {
    const [h,m] = timeInput.value.split(':').map(Number);
    const d = new Date(entry.timestamp); d.setHours(h,m,0,0);
    entry.timestamp = d.toISOString(); saveEntry(entry);
    timeSpan.textContent = timeInput.value;
    timeInput.style.display='none'; timeSpan.style.display='';
    if (currentView==='timeline') renderTimeline();
  });
  timeInput.addEventListener('blur', () => { timeInput.style.display='none'; timeSpan.style.display=''; });
  timeInput.addEventListener('keydown', e => { if(e.key==='Escape') timeInput.blur(); });

  typeBtn.setAttribute('tabindex','0');
  wishBtn.setAttribute('tabindex','0');
  typeBtn.addEventListener('click', () => {
    entry.type = entry.type==='expense'?'income':'expense';
    typeBtn.className=`entry-edit-type ${entry.type}`;
    typeBtn.textContent = entry.type==='income'?'＋ 收入':'－ 支出';
    textarea.focus();
  });
  wishBtn.addEventListener('click', () => {
    entry.isWishlist = !entry.isWishlist;
    wishBtn.classList.toggle('active', entry.isWishlist);
    wishBtn.innerHTML=`<i data-lucide="heart"></i>${entry.isWishlist?'已种草':'种草'}`;
    lucide.createIcons({ nodes:[wishBtn] });
    textarea.focus();
  });

  div.addEventListener('focusout', e => {
    if (!div.contains(e.relatedTarget)) commitEdit(div, entry, textarea, rendered);
  });
  textarea.addEventListener('keydown', e => {
    if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); commitEdit(div,entry,textarea,rendered); }
    if (e.key==='Escape') { entry.type=entry._origType; entry.isWishlist=entry._origWishlist; textarea.value=entry.raw; commitEdit(div,entry,textarea,rendered); }
  });

  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!confirm('删除这条记录？')) return;
    DB.entries = DB.entries.filter(en => en.id!==entry.id);
    div.remove();
    if (currentView==='timeline') renderTimeline();
    if (detailPath) renderDetailEntries();
  });

  return div;
}

function enterEdit(div, entry, textarea, typeBtn, wishBtn, rendered) {
  entry._origType = entry.type; entry._origWishlist = entry.isWishlist;
  div.classList.add('editing');
  textarea.value = entry.raw; textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function commitEdit(div, entry, textarea, rendered) {
  if (!div.classList.contains('editing')) return;
  div.classList.remove('editing');
  const newRaw = textarea.value.trim();
  if (newRaw && newRaw!==entry.raw) {
    const p = parseEntry(newRaw);
    Object.assign(entry, { raw:newRaw, price:p.price, tags:p.tags, places:p.places,
      ratings:p.ratings, progresses:p.progresses, note:p.note });
    ensureItems('tags', p.tags); ensureItems('places', p.places);
  }
  saveEntry(entry);
  rendered.innerHTML = renderTokens(entry.raw, entry.type);
  const actions = div.querySelector('.entry-actions');
  const del = actions.querySelector('.entry-delete-btn');
  const badges = [];
  if (entry.isWishlist) badges.push(`<span class="entry-badge wishlist">种草</span>`);
  if (entry.type==='income') badges.push(`<span class="entry-badge income-badge">收入</span>`);
  actions.innerHTML = badges.join('');
  actions.appendChild(del);
}

function saveEntry(entry) {
  const entries = DB.entries;
  const idx = entries.findIndex(e => e.id===entry.id);
  if (idx!==-1) entries[idx]=entry;
  DB.entries = entries;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────
function renderTimeline() {
  const y=currentMonth.getFullYear(), mo=currentMonth.getMonth();
  document.getElementById('month-label').textContent = `${y}年${mo+1}月`;
  const allEntries = DB.entries;
  const monthEntries = allEntries.filter(e => {
    const d=new Date(e.timestamp); return d.getFullYear()===y && d.getMonth()===mo;
  });
  document.getElementById('month-summary').innerHTML = summaryHTML(summarize(monthEntries));

  const groups = {};
  monthEntries.forEach(e => {
    const d=new Date(e.timestamp);
    const key=`${y}-${String(mo+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    (groups[key]=groups[key]||[]).push(e);
  });

  const daysInMonth = new Date(y,mo+1,0).getDate();
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';

  for (let d=daysInMonth; d>=1; d--) {
    const key=`${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEntries=(groups[key]||[]).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
    const dateObj=new Date(y,mo,d);
    const weekday='日一二三四五六'[dateObj.getDay()];
    const ds=summarize(dayEntries);

    const group=document.createElement('div');
    group.className='day-group';
    const header=document.createElement('div');
    header.className='day-header';
    header.innerHTML=`<span class="day-date">${d}日（${weekday}）</span><span class="day-summary">${summaryHTML(ds)}</span>`;
    const addBtn=document.createElement('button');
    addBtn.className='day-add-btn'; addBtn.title='补记';
    addBtn.innerHTML='<i data-lucide="plus"></i>';
    addBtn.addEventListener('click', () => {
      composerOverrideDay=key;
      document.getElementById('entry-input').focus();
    });
    header.appendChild(addBtn);
    group.appendChild(header);
    dayEntries.forEach(e => group.appendChild(buildEntryEl(e)));
    list.appendChild(group);
  }
  lucide.createIcons({ nodes:[list, document.getElementById('month-header')] });
}

// ─── Tree ─────────────────────────────────────────────────────────────────────
function buildTree(items) {
  const root={};
  items.forEach(({path}) => {
    const parts=path.split('/'); let node=root;
    parts.forEach((part,i) => {
      if (!node[part]) node[part]={_path:parts.slice(0,i+1).join('/'),_children:{}};
      node=node[part]._children;
    });
  });
  return root;
}

function getEntriesFor(sigil, path) {
  if (sigil==='*') return DB.entries.filter(e=>(e.ratings||[]).some(r=>r.str===path));
  if (sigil==='%') return DB.entries.filter(e=>(e.progresses||[]).length>0);
  const field=sigil==='#'?'tags':'places';
  return DB.entries.filter(e=>(e[field]||[]).some(p=>p===path||p.startsWith(path+'/')));
}

function renderTree(containerId, sigil, dbKey, nodeClass) {
  const tree=buildTree(DB[dbKey]);
  const container=document.getElementById(containerId);
  container.innerHTML='';
  renderTreeLevel(container, tree, sigil, nodeClass);
  lucide.createIcons({ nodes:[container] });
}

function renderTreeLevel(container, node, sigil, nodeClass) {
  Object.keys(node).sort().forEach(key => {
    const child=node[key], path=child._path;
    const hasChildren=Object.keys(child._children).length>0;
    const s=summarize(getEntriesFor(sigil, path));

    const nodeEl=document.createElement('div');
    nodeEl.className=`tree-node ${nodeClass}`;
    const header=document.createElement('div');
    header.className='tree-node-header';
    header.innerHTML=`
      <span class="tree-toggle">${hasChildren?'▶':''}</span>
      <span class="tree-node-name">${escapeHtml(key)}</span>
      <span class="tree-node-summary">${summaryHTML(s)}</span>
      <button class="tree-open-btn"><i data-lucide="arrow-right"></i></button>
    `;
    header.querySelector('.tree-open-btn').addEventListener('click', e => {
      e.stopPropagation();
      openDetail(sigil, path, sigil==='#'?'tags':'places');
    });
    nodeEl.appendChild(header);
    if (hasChildren) {
      const childrenEl=document.createElement('div');
      childrenEl.className='tree-children';
      renderTreeLevel(childrenEl, child._children, sigil, nodeClass);
      nodeEl.appendChild(childrenEl);
      header.addEventListener('click', e => { if (!e.target.closest('.tree-open-btn')) nodeEl.classList.toggle('open'); });
    } else {
      header.addEventListener('click', e => { if (!e.target.closest('.tree-open-btn')) openDetail(sigil,path,sigil==='#'?'tags':'places'); });
    }
    container.appendChild(nodeEl);
  });
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function openDetail(sigil, path, returnView) {
  detailSigil=sigil; detailPath=path; detailReturnView=returnView;
  const isSpecial = sigil==='*'||sigil==='%';

  const sigilEl=document.getElementById('detail-sigil');
  sigilEl.textContent=sigil;
  sigilEl.className=`detail-sigil ${{
    '#':'tag-sigil','@':'place-sigil','*':'rating-sigil','%':'progress-sigil'
  }[sigil]||''}`;

  const nameEl=document.getElementById('detail-name');
  nameEl.textContent = sigil==='%' ? '进度记录' : path;
  nameEl.className=`detail-name-${{
    '#':'tag','@':'place','*':'rating','%':'progress'
  }[sigil]||'tag'}`;
  nameEl.contentEditable = isSpecial ? 'false' : 'true';

  document.getElementById('detail-composer').style.display = isSpecial ? 'none' : '';

  renderDetailEntries();
  document.getElementById('detail-panel').classList.remove('hidden');

  if (!isSpecial) {
    detailTypeVal='expense'; detailWishlistVal=false;
    const tb=document.querySelector('.detail-type-toggle');
    tb.textContent='－'; tb.className='type-btn expense detail-type-toggle';
    document.querySelector('.detail-wishlist-toggle').checked=false;
    document.querySelector('.detail-entry-input').innerText='';
  }
}

function renderDetailEntries() {
  const entries=getEntriesFor(detailSigil, detailPath)
    .sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));

  document.getElementById('detail-summary').innerHTML=summaryHTML(summarize(entries));
  const list=document.getElementById('detail-entries');
  list.innerHTML='';

  if (detailSigil==='*') {
    const [rs,ss]=detailPath.split('/');
    const starDiv=document.createElement('div');
    starDiv.className='rating-detail-stars';
    starDiv.innerHTML=renderStars(parseFloat(rs),parseFloat(ss))+
      `<span class="rating-detail-label">${escapeHtml(detailPath)}</span>`+
      `<span class="rating-detail-count">${entries.length} 条</span>`;
    list.appendChild(starDiv);
  }

  if (detailSigil==='%') {
    const hdr=document.createElement('div');
    hdr.className='progress-detail-header';
    hdr.innerHTML=`<span class="progress-detail-count">${entries.length} 条进度记录</span>`;
    list.appendChild(hdr);
  }

  entries.forEach(e => list.appendChild(buildEntryEl(e, { showDate:true })));
  lucide.createIcons({ nodes:[list] });
}

document.getElementById('detail-back').addEventListener('click', () => {
  document.getElementById('detail-panel').classList.add('hidden');
  detailPath=null; switchView(detailReturnView);
});

let _nameBeforeFocus='';
const detailNameEl=document.getElementById('detail-name');
detailNameEl.addEventListener('focus', ()=>{ _nameBeforeFocus=detailNameEl.textContent.trim(); });
detailNameEl.addEventListener('blur', ()=>{
  if (detailSigil==='*'||detailSigil==='%') return;
  const newPath=detailNameEl.textContent.trim();
  if (newPath&&newPath!==_nameBeforeFocus) {
    const dbKey=detailSigil==='#'?'tags':'places';
    renameItem(dbKey,detailSigil,_nameBeforeFocus,newPath);
    detailPath=newPath; renderDetailEntries();
    renderTree(detailSigil==='#'?'tag-tree':'place-tree', detailSigil,
               detailSigil==='#'?'tags':'places',
               detailSigil==='#'?'tag-tree-node':'place-tree-node');
  }
});
detailNameEl.addEventListener('keydown', e=>{
  if (e.key==='Enter'){e.preventDefault();detailNameEl.blur();}
  if (e.key==='Escape'){detailNameEl.textContent=_nameBeforeFocus;detailNameEl.blur();}
});

// Detail composer
const detailTypeBtn=document.querySelector('.detail-type-toggle');
const detailWishlistToggle=document.querySelector('.detail-wishlist-toggle');
const detailInput=document.querySelector('.detail-entry-input');
const detailACMenu=document.querySelector('.detail-autocomplete-menu');
const detailSubmitBtn=document.querySelector('.detail-submit-btn');

detailTypeBtn.addEventListener('click',()=>{
  detailTypeVal=detailTypeVal==='expense'?'income':'expense';
  detailTypeBtn.textContent=detailTypeVal==='expense'?'－':'＋';
  detailTypeBtn.className=`type-btn ${detailTypeVal} detail-type-toggle`;
});
detailWishlistToggle.addEventListener('change',()=>{ detailWishlistVal=detailWishlistToggle.checked; });
detailInput.addEventListener('input',()=>handleAC(detailInput,detailACMenu));
detailInput.addEventListener('keydown',e=>{
  if (!detailACMenu.classList.contains('hidden')) {
    if (e.key==='ArrowDown'){e.preventDefault();moveAC(1,detailACMenu);return;}
    if (e.key==='ArrowUp'){e.preventDefault();moveAC(-1,detailACMenu);return;}
    if ((e.key==='Enter'||e.key==='Tab')&&detailACMenu.querySelector('.selected')){
      e.preventDefault();applyAC(detailACMenu.querySelector('.selected').dataset.value,detailInput,detailACMenu);return;
    }
    if (e.key==='Escape'){hideAC(detailACMenu);return;}
  }
  if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitDetailEntry();}
});
detailSubmitBtn.addEventListener('click',submitDetailEntry);

function submitDetailEntry() {
  let raw=detailInput.innerText.trim(); if (!raw) return;
  const marker=detailSigil+detailPath;
  if (!raw.includes(marker)) raw=marker+' '+raw;
  const p=parseEntry(raw);
  ensureItems('tags',p.tags); ensureItems('places',p.places);
  const entry={ id:genId(), timestamp:new Date().toISOString(), raw,
    price:p.price, tags:p.tags, places:p.places, ratings:p.ratings,
    progresses:p.progresses, note:p.note, type:detailTypeVal, isWishlist:detailWishlistVal };
  DB.entries=[...DB.entries,entry];
  detailInput.innerText='';
  renderDetailEntries();
}

// ─── Main Composer ────────────────────────────────────────────────────────────
const typeToggleBtn=document.getElementById('type-toggle');
const wishlistToggle=document.getElementById('wishlist-toggle');
const entryInput=document.getElementById('entry-input');
const acMenu=document.getElementById('autocomplete-menu');
const submitBtn=document.getElementById('submit-btn');

typeToggleBtn.addEventListener('click',()=>{
  composerType=composerType==='expense'?'income':'expense';
  typeToggleBtn.textContent=composerType==='expense'?'－':'＋';
  typeToggleBtn.className=`type-btn ${composerType}`;
});
wishlistToggle.addEventListener('change',()=>{ composerWishlist=wishlistToggle.checked; });
entryInput.addEventListener('input',()=>handleAC(entryInput,acMenu));
entryInput.addEventListener('keydown',e=>{
  if (!acMenu.classList.contains('hidden')) {
    if (e.key==='ArrowDown'){e.preventDefault();moveAC(1,acMenu);return;}
    if (e.key==='ArrowUp'){e.preventDefault();moveAC(-1,acMenu);return;}
    if ((e.key==='Enter'||e.key==='Tab')&&acMenu.querySelector('.selected')){
      e.preventDefault();applyAC(acMenu.querySelector('.selected').dataset.value,entryInput,acMenu);return;
    }
    if (e.key==='Escape'){hideAC(acMenu);return;}
  }
  if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitMainEntry();}
});
submitBtn.addEventListener('click',submitMainEntry);

function submitMainEntry() {
  const raw=entryInput.innerText.trim(); if (!raw) return;
  const p=parseEntry(raw);
  ensureItems('tags',p.tags); ensureItems('places',p.places);
  let ts;
  if (composerOverrideDay) {
    const [oy,om,od]=composerOverrideDay.split('-').map(Number);
    const now=new Date();
    ts=new Date(oy,om-1,od,now.getHours(),now.getMinutes()).toISOString();
    composerOverrideDay=null;
  } else { ts=new Date().toISOString(); }
  const entry={ id:genId(), timestamp:ts, raw, price:p.price, tags:p.tags,
    places:p.places, ratings:p.ratings, progresses:p.progresses,
    note:p.note, type:composerType, isWishlist:composerWishlist };
  DB.entries=[...DB.entries,entry];
  entryInput.innerText='';
  composerType='expense'; composerWishlist=false;
  typeToggleBtn.textContent='－'; typeToggleBtn.className='type-btn expense';
  wishlistToggle.checked=false;
  renderTimeline();
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────
let _acIndex=-1;

function getCaretSigilQuery(el) {
  const sel=window.getSelection(); if (!sel.rangeCount) return null;
  const range=sel.getRangeAt(0);
  const pre=range.cloneRange();
  pre.selectNodeContents(el); pre.setEnd(range.startContainer,range.startOffset);
  const text=pre.toString();
  const m=text.match(/[#@]([\w\u4e00-\u9fa5/\-_.·]*)$/);
  if (!m) return null;
  return { sigil:text[m.index], query:m[1] };
}

function handleAC(inputEl,menuEl) {
  const hit=getCaretSigilQuery(inputEl);
  if (!hit){hideAC(menuEl);return;}
  const dbKey=hit.sigil==='#'?'tags':'places';
  const suggestions=getSuggestions(dbKey,hit.query);
  if (!suggestions.length){hideAC(menuEl);return;}
  menuEl.innerHTML=''; menuEl.classList.remove('hidden'); _acIndex=-1;
  const cls=hit.sigil==='#'?'tag-ac':'place-ac';
  suggestions.forEach(s=>{
    const item=document.createElement('div');
    item.className=`autocomplete-item ${cls}`;
    item.dataset.value=hit.sigil+s;
    item.innerHTML=escapeHtml(hit.sigil)+highlightMatch(s,hit.query);
    item.addEventListener('mousedown',e=>{e.preventDefault();applyAC(hit.sigil+s,inputEl,menuEl);});
    menuEl.appendChild(item);
  });
}
function hideAC(menuEl){menuEl.classList.add('hidden');_acIndex=-1;}
function moveAC(dir,menuEl){
  const items=[...menuEl.querySelectorAll('.autocomplete-item')]; if(!items.length)return;
  items[_acIndex]?.classList.remove('selected');
  _acIndex=Math.max(-1,Math.min(items.length-1,_acIndex+dir));
  items[_acIndex]?.classList.add('selected');
}
function applyAC(fullValue,inputEl,menuEl){
  const sel=window.getSelection(); if(!sel.rangeCount)return;
  const range=sel.getRangeAt(0);
  const pre=range.cloneRange();
  pre.selectNodeContents(inputEl); pre.setEnd(range.startContainer,range.startOffset);
  const preText=pre.toString();
  const m=preText.match(/[#@][\w\u4e00-\u9fa5/\-_.·]*$/); if(!m)return;
  const fullText=inputEl.innerText;
  const insertPos=preText.length-m[0].length;
  const postText=fullText.slice(preText.length);
  const newText=fullText.slice(0,insertPos)+fullValue+(postText.startsWith(' ')?'':' ')+postText;
  inputEl.innerText=newText;
  const newPos=insertPos+fullValue.length+1;
  try {
    const tn=inputEl.firstChild;
    if(tn){ const r=document.createRange(); r.setStart(tn,Math.min(newPos,tn.length)); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
  } catch(_){}
  hideAC(menuEl);
}

// ─── Wishlist ──────────────────────────────────────────────────────────────────
function renderWishlist() {
  const entries=DB.entries.filter(e=>e.isWishlist).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  const list=document.getElementById('wishlist-list');
  list.innerHTML='';
  if (!entries.length){list.innerHTML='<p class="wishlist-empty">还没有种草条目</p>';return;}
  entries.forEach(e=>list.appendChild(buildEntryEl(e,{showDate:true})));
  lucide.createIcons({nodes:[list]});
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function switchView(viewName) {
  currentView=viewName;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===viewName));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+viewName));
  if (viewName==='timeline') renderTimeline();
  if (viewName==='tags')     renderTree('tag-tree',  '#','tags',  'tag-tree-node');
  if (viewName==='places')   renderTree('place-tree','@','places','place-tree-node');
  if (viewName==='wishlist') renderWishlist();
}
document.querySelectorAll('.nav-btn:not(#settings-btn)').forEach(btn=>{
  btn.addEventListener('click',()=>switchView(btn.dataset.view));
});
document.getElementById('prev-month').addEventListener('click',()=>{currentMonth.setMonth(currentMonth.getMonth()-1);renderTimeline();});
document.getElementById('next-month').addEventListener('click',()=>{currentMonth.setMonth(currentMonth.getMonth()+1);renderTimeline();});

// ─── Theme System ──────────────────────────────────────────────────────────────
const THEME_VARS = [
  { key:'--bg',             label:'背景色' },
  { key:'--surface',        label:'卡片/面板背景' },
  { key:'--text',           label:'正文颜色' },
  { key:'--accent',         label:'主题色 (Accent)' },
  { key:'--income',         label:'收入色' },
  { key:'--expense',        label:'支出色' },
  { key:'--wishlist',       label:'种草色' },
  { key:'--tag-fg',         label:'# 标签文字色' },
  { key:'--tag-bg',         label:'# 标签背景色' },
  { key:'--place-color',    label:'@ 地点色' },
  { key:'--rating-color',   label:'* 评分色' },
  { key:'--progress-color', label:'% 进度色' },
];

const PRESETS = [
  {
    name:'默认',
    vars:{ '--bg':'#f7f5f0','--surface':'#ffffff','--text':'#1a1814','--accent':'#2d6a4f',
           '--income':'#2d6a4f','--expense':'#c0392b','--wishlist':'#e05c7a',
           '--tag-fg':'#555047','--tag-bg':'#eeece8',
           '--place-color':'#b05a00','--rating-color':'#a07800','--progress-color':'#2563a8' }
  },
  {
    name:'暗色',
    vars:{ '--bg':'#1a1a1e','--surface':'#26262c','--text':'#e8e4de','--accent':'#4ade80',
           '--income':'#4ade80','--expense':'#f87171','--wishlist':'#f472b6',
           '--tag-fg':'#aaa8a2','--tag-bg':'#2e2e34',
           '--place-color':'#fb923c','--rating-color':'#fbbf24','--progress-color':'#60a5fa' }
  },
  {
    name:'暖米色',
    vars:{ '--bg':'#fdf6ec','--surface':'#fffbf4','--text':'#2d2316','--accent':'#9b6a2f',
           '--income':'#5a8a3c','--expense':'#c04030','--wishlist':'#c0507a',
           '--tag-fg':'#6b5940','--tag-bg':'#f0e6d4',
           '--place-color':'#8a5a1a','--rating-color':'#a06820','--progress-color':'#4a7aaa' }
  },
  {
    name:'薄荷',
    vars:{ '--bg':'#f0f7f4','--surface':'#ffffff','--text':'#1a2e26','--accent':'#0d9488',
           '--income':'#0d9488','--expense':'#e11d48','--wishlist':'#db2777',
           '--tag-fg':'#3d6b5e','--tag-bg':'#ddf0eb',
           '--place-color':'#0369a1','--rating-color':'#d97706','--progress-color':'#7c3aed' }
  },
];

let _pendingTheme = {};   // edits not yet saved
let _activePreset = null;

function applyThemeVars(vars) {
  const root = document.documentElement;
  Object.entries(vars).forEach(([k,v]) => root.style.setProperty(k,v));
  // derive dependent vars
  root.style.setProperty('--accent-light', hexToLightBg(vars['--accent']||getComputedStyle(root).getPropertyValue('--accent')));
  root.style.setProperty('--expense-light', hexToLightBg(vars['--expense']||getComputedStyle(root).getPropertyValue('--expense')));
  root.style.setProperty('--wishlist-light', hexToLightBg(vars['--wishlist']||getComputedStyle(root).getPropertyValue('--wishlist')));
  root.style.setProperty('--place-bg', hexToLightBg(vars['--place-color']||getComputedStyle(root).getPropertyValue('--place-color')));
  root.style.setProperty('--rating-bg', hexToLightBg(vars['--rating-color']||getComputedStyle(root).getPropertyValue('--rating-color')));
  root.style.setProperty('--progress-bg', hexToLightBg(vars['--progress-color']||getComputedStyle(root).getPropertyValue('--progress-color')));
  root.style.setProperty('--border', mixHex(vars['--bg']||getComputedStyle(root).getPropertyValue('--bg').trim(), vars['--text']||getComputedStyle(root).getPropertyValue('--text').trim(), 0.12));
  root.style.setProperty('--text-muted', mixHex(vars['--bg']||getComputedStyle(root).getPropertyValue('--bg').trim(), vars['--text']||getComputedStyle(root).getPropertyValue('--text').trim(), 0.5));
  root.style.setProperty('--text-light', mixHex(vars['--bg']||getComputedStyle(root).getPropertyValue('--bg').trim(), vars['--text']||getComputedStyle(root).getPropertyValue('--text').trim(), 0.28));
}

function hexToLightBg(hex) {
  hex = hex.trim();
  const [r,g,b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},0.12)`;
}

function hexToRgb(hex) {
  hex = hex.replace('#','');
  if (hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)];
}

function mixHex(bg, fg, t) {
  try {
    const [br,bg2,bb]=hexToRgb(bg.trim()), [fr,fg2,fb]=hexToRgb(fg.trim());
    const r=Math.round(br+(fr-br)*t), g=Math.round(bg2+(fg2-bg2)*t), b=Math.round(bb+(fb-bb)*t);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  } catch { return '#888'; }
}

function rgbToHex(r,g,b) {
  return '#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
}

function loadTheme() {
  const saved = DB.theme;
  if (saved) applyThemeVars(saved);
}

// ─── Settings Modal ────────────────────────────────────────────────────────────
function openSettings() {
  // Read current CSS var values into _pendingTheme
  const root = document.documentElement;
  _pendingTheme = {};
  THEME_VARS.forEach(({key}) => {
    _pendingTheme[key] = getComputedStyle(root).getPropertyValue(key).trim();
  });

  // Render preset buttons
  const presetList = document.getElementById('preset-list');
  presetList.innerHTML = '';
  PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    const swatchColors = ['--accent','--expense','--wishlist'].map(k=>preset.vars[k]||'#ccc');
    btn.innerHTML = `<span class="preset-swatch">${swatchColors.map(c=>`<span class="preset-dot" style="background:${c}"></span>`).join('')}</span>${escapeHtml(preset.name)}`;
    btn.addEventListener('click', () => {
      _pendingTheme = { ..._pendingTheme, ...preset.vars };
      _activePreset = i;
      presetList.querySelectorAll('.preset-btn').forEach((b,j)=>b.classList.toggle('active',j===i));
      applyThemeVars(_pendingTheme);
      refreshColorPickers();
    });
    presetList.appendChild(btn);
  });

  // Render color pickers
  renderColorPickers();

  document.getElementById('settings-overlay').classList.remove('hidden');
  document.getElementById('settings-modal').classList.remove('hidden');
  lucide.createIcons({ nodes:[document.getElementById('settings-modal')] });
}

function renderColorPickers() {
  const container = document.getElementById('color-pickers');
  container.innerHTML = '';
  THEME_VARS.forEach(({key, label}) => {
    const row = document.createElement('div');
    row.className = 'color-row';
    row.innerHTML = `<div class="color-row-label">${escapeHtml(label)}</div>`;
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'color-picker-wrap';
    const hex = _pendingTheme[key] || '#888888';
    pickerWrap.innerHTML = `
      <button class="color-swatch-btn" data-key="${escapeHtml(key)}">
        <span class="color-swatch" style="background:${hex}"></span>
        <span class="swatch-hex">${hex}</span>
      </button>
      <div class="color-popover hidden" data-key="${escapeHtml(key)}"></div>
    `;
    const swatchBtn = pickerWrap.querySelector('.color-swatch-btn');
    const popover   = pickerWrap.querySelector('.color-popover');

    // Stop clicks inside the popover from bubbling to document
    popover.addEventListener('click', e => e.stopPropagation());
    popover.addEventListener('mousedown', e => e.stopPropagation());

    swatchBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !popover.classList.contains('hidden');
      // close all popovers
      document.querySelectorAll('.color-popover').forEach(p => p.classList.add('hidden'));
      if (!isOpen) {
        popover.classList.remove('hidden');
        // always use current pending value when opening
        buildColorPicker(popover, key, _pendingTheme[key] || hex);
      }
    });
    row.appendChild(pickerWrap);
    container.appendChild(row);
  });
}

function refreshColorPickers() {
  THEME_VARS.forEach(({key}) => {
    const hex = _pendingTheme[key]||'#888888';
    const btn = document.querySelector(`.color-swatch-btn[data-key="${key}"]`);
    if (!btn) return;
    btn.querySelector('.color-swatch').style.background = hex;
    btn.querySelector('.swatch-hex').textContent = hex;
  });
}

// ── Custom color picker ──
function buildColorPicker(container, varKey, initialHex) {
  container.innerHTML = '';
  let h,s,v,a=1;
  [h,s,v] = hexToHsv(initialHex);

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
    const W=canvas.offsetWidth, H=canvas.offsetHeight;
    canvas.width=W; canvas.height=H;
    const hueColor = `hsl(${h},100%,50%)`;
    const gW = ctx.createLinearGradient(0,0,W,0);
    gW.addColorStop(0,'#fff'); gW.addColorStop(1,hueColor);
    ctx.fillStyle=gW; ctx.fillRect(0,0,W,H);
    const gB = ctx.createLinearGradient(0,0,0,H);
    gB.addColorStop(0,'transparent'); gB.addColorStop(1,'#000');
    ctx.fillStyle=gB; ctx.fillRect(0,0,W,H);
  }

  function updateCursor() {
    const W=canvas.offsetWidth, H=canvas.offsetHeight;
    cursor.style.left = (s*W)+'px';
    cursor.style.top  = ((1-v)*H)+'px';
  }

  function updateHueThumb() {
    hueThumb.style.left = (h/360*100)+'%';
  }

  function updateOutput() {
    const rgb = hsvToRgb(h,s,v);
    const hex = rgbToHex(...rgb);
    _pendingTheme[varKey] = hex;
    hexInput.value = hex;
    preview.style.background = hex;
    container.closest('.color-picker-wrap').querySelector('.color-swatch').style.background = hex;
    container.closest('.color-picker-wrap').querySelector('.swatch-hex').textContent = hex;
    applyThemeVars(_pendingTheme);
  }

  function initCanvas() {
    drawGradient(); updateCursor(); updateHueThumb();
  }

  // Gradient drag
  function onGradientDown(e) {
    e.stopPropagation();
    const move = ev => {
      ev.stopPropagation();
      const rect=canvas.getBoundingClientRect();
      const cx=ev.touches?ev.touches[0].clientX:ev.clientX;
      const cy=ev.touches?ev.touches[0].clientY:ev.clientY;
      s=Math.max(0,Math.min(1,(cx-rect.left)/rect.width));
      v=Math.max(0,Math.min(1,1-(cy-rect.top)/rect.height));
      updateCursor(); updateOutput();
    };
    const up=(ev)=>{
      ev.stopPropagation();
      window.removeEventListener('mousemove',move); window.removeEventListener('mouseup',up);
      window.removeEventListener('touchmove',move); window.removeEventListener('touchend',up);
    };
    window.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
    window.addEventListener('touchmove',move); window.addEventListener('touchend',up);
    move(e);
  }
  canvas.addEventListener('mousedown',onGradientDown);
  canvas.addEventListener('touchstart',onGradientDown,{passive:true});

  // Hue drag
  function onHueDown(e) {
    e.stopPropagation();
    const move = ev => {
      ev.stopPropagation();
      const rect=hueWrap.getBoundingClientRect();
      const cx=ev.touches?ev.touches[0].clientX:ev.clientX;
      h=Math.max(0,Math.min(360,((cx-rect.left)/rect.width)*360));
      updateHueThumb(); drawGradient(); updateOutput();
    };
    const up=(ev)=>{
      ev.stopPropagation();
      window.removeEventListener('mousemove',move); window.removeEventListener('mouseup',up);
      window.removeEventListener('touchmove',move); window.removeEventListener('touchend',up);
    };
    window.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
    window.addEventListener('touchmove',move); window.addEventListener('touchend',up);
    move(e);
  }
  hueWrap.addEventListener('mousedown',onHueDown);
  hueWrap.addEventListener('touchstart',onHueDown,{passive:true});

  // Hex input
  hexInput.addEventListener('change', () => {
    const val=hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      [h,s,v]=hexToHsv(val); drawGradient(); updateCursor(); updateHueThumb(); updateOutput();
    }
  });
  hexInput.addEventListener('click', e=>e.stopPropagation());

  setTimeout(initCanvas, 0);
}

// HSV ↔ RGB
function hexToHsv(hex) {
  let [r,g,b]=hexToRgb(hex); r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let hh=0, ss=max===0?0:d/max, vv=max;
  if (d!==0) {
    if      (max===r) hh=((g-b)/d+6)%6;
    else if (max===g) hh=(b-r)/d+2;
    else              hh=(r-g)/d+4;
    hh*=60;
  }
  return [hh, ss, vv];
}

function hsvToRgb(h,s,v) {
  const f=(n,k=(n+h/60)%6)=>v-v*s*Math.max(Math.min(k,4-k,1),0);
  return [f(5)*255, f(3)*255, f(1)*255];
}

// Settings event wiring
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
  document.querySelectorAll('.preset-btn').forEach((b,i)=>b.classList.toggle('active',i===0));
});

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
  document.getElementById('settings-modal').classList.add('hidden');
  document.querySelectorAll('.color-popover').forEach(p=>p.classList.add('hidden'));
  const saved=DB.theme;
  if (saved) applyThemeVars(saved); else applyThemeVars(PRESETS[0].vars);
}

// Close popovers when clicking outside — single listener
document.addEventListener('click', () => {
  document.querySelectorAll('.color-popover').forEach(p=>p.classList.add('hidden'));
});

// ─── Seed ──────────────────────────────────────────────────────────────────────
function seedIfEmpty() {
  if (DB.entries.length) return;
  const now=new Date(), y=now.getFullYear(), mo=now.getMonth();

  // Helper to make timestamps spread across current month
  const ts = (day, hour=10, min=0) => new Date(y, mo, day, hour, min).toISOString();

  const seeds = [
    // 收入
    { raw:'工资 12000', tags:[], places:[], price:12000, type:'income', day:1, hour:9 },

    // 普通支出 + @地点
    { raw:'午饭 32 @公司楼下/快餐', tags:[], places:['公司楼下/快餐'], price:32, type:'expense', day:2, hour:12 },

    // # 商品 + @ 地点 + 评分
    { raw:'#咖啡/拿铁 @星巴克/国贸店 38 *8/10', tags:['咖啡/拿铁'], places:['星巴克/国贸店'], price:38, type:'expense', day:3, hour:10 },
    { raw:'#咖啡/拿铁 @瑞幸/朝阳门 18 *6/10 太酸了', tags:['咖啡/拿铁'], places:['瑞幸/朝阳门'], price:18, type:'expense', day:5, hour:9 },
    { raw:'#咖啡/拿铁 @星巴克/国贸店 38 *9/10 今天做得好', tags:['咖啡/拿铁'], places:['星巴克/国贸店'], price:38, type:'expense', day:8, hour:11 },

    // 进度 %N/lo-hi（读书）
    { raw:'#书/原子习惯 %1/1-200 开始读', tags:['书/原子习惯'], places:[], price:null, type:'expense', day:4, hour:21 },
    { raw:'#书/原子习惯 %68/1-200', tags:['书/原子习惯'], places:[], price:null, type:'expense', day:7, hour:22 },
    { raw:'#书/原子习惯 %200/1-200 读完了 *9/10', tags:['书/原子习惯'], places:[], price:null, type:'expense', day:10, hour:20 },

    // 进度 %N/total（追剧）
    { raw:'#剧/黑镜 %3/6 @Netflix', tags:['剧/黑镜'], places:['Netflix'], price:null, type:'expense', day:6, hour:22 },
    { raw:'#剧/黑镜 %6/6 @Netflix 结局一般 *6.5/10', tags:['剧/黑镜'], places:['Netflix'], price:null, type:'expense', day:9, hour:23 },

    // 进度 %百分比（健身目标）
    { raw:'#健身/深蹲 %65 今天65%完成量', tags:['健身/深蹲'], places:[], price:null, type:'expense', day:11, hour:19 },

    // 种草（无价格）
    { raw:'#耳机/索尼WH1000XM5 @京东 种草已久', tags:['耳机/索尼WH1000XM5'], places:['京东'], price:null, type:'expense', isWishlist:true, day:5, hour:14 },
    // 种草（有参考价格）
    { raw:'#机械键盘/HHKB @淘宝 1500', tags:['机械键盘/HHKB'], places:['淘宝'], price:1500, type:'expense', isWishlist:true, day:8, hour:16 },

    // 已购种草商品
    { raw:'#耳机/索尼WH1000XM5 @京东 2299 到手了！*9/10', tags:['耳机/索尼WH1000XM5'], places:['京东'], price:2299, type:'expense', day:12, hour:15 },

    // 收入 + @地点
    { raw:'freelance收入 3000 @微信转账', tags:[], places:['微信转账'], price:3000, type:'income', day:15, hour:11 },

    // 纯备注型条目（无价格无标签）
    { raw:'今天把订阅都整理了一遍', tags:[], places:[], price:null, type:'expense', day:16, hour:10 },

    // 多标签多地点
    { raw:'#零食/薯片 #零食/坚果 @超市/盒马 45', tags:['零食/薯片','零食/坚果'], places:['超市/盒马'], price:45, type:'expense', day:18, hour:18 },
  ];

  DB.entries = seeds.map(s => {
    const p = parseEntry(s.raw);
    return {
      id: genId(),
      timestamp: ts(s.day, s.hour),
      raw: s.raw, price: s.price,
      tags: s.tags, places: s.places,
      ratings: p.ratings, progresses: p.progresses,
      note: p.note, type: s.type, isWishlist: s.isWishlist||false,
    };
  });

  DB.tags   = [...new Set(seeds.flatMap(s=>s.tags))].map(path=>({id:genId(),path}));
  DB.places = [...new Set(seeds.flatMap(s=>s.places))].map(path=>({id:genId(),path}));
}

// ─── Init ──────────────────────────────────────────────────────────────────────
loadTheme();
seedIfEmpty();
renderTimeline();
window.addEventListener('load', ()=>lucide.createIcons());
