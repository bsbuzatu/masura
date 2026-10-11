// Măsura — interfață
import { Store, SECTION_TYPES, colorFor, baseName, uid, newSong, newSetlist, songStats, fmtDuration, clamp } from './store.js';
import { ClickEngine, Player } from './engine.js';
import { PlayView } from './play.js';

export const APP_VERSION = '1.4.0';
const store = new Store();
const S = store.data.settings;
const engine = new ClickEngine(S.vol);
const app = document.getElementById('app');
let current = null; // view activ (cu destroy opțional)

const DEFAULT_KEYS_A = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
const DEFAULT_KEYS_B = ['ArrowLeft', 'ArrowUp', 'PageUp'];
const keyName = k => k === ' ' ? 'Space' : k;

// ---------- utilitare ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const go = h => { location.hash = h; };
let toastTimer;
function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button>${esc(action.label)}</button>` : '');
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 9000 : 2600);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const ICON = {
  setlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M18 15v-9l3 1.5"/><circle cx="16.5" cy="17" r="2.5"/></svg>',
  songs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="4" height="14" rx="1"/><rect x="9" y="5" width="6" height="14" rx="1"/><rect x="17" y="5" width="4" height="14" rx="1"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};

function tabs(on) {
  const t = (h, k, label) => `<a href="#${h}" class="${on === k ? 'on' : ''}">${ICON[k]}${label}</a>`;
  return `<nav class="tabs">${t('/concerte', 'setlist', 'Concerte')}${t('/piese', 'songs', 'Piese')}${t('/setari', 'settings', 'Setări')}</nav>`;
}

function structChips(song) {
  const tot = song.sections.reduce((a, s) => a + (s.open ? 4 : s.bars), 0) || 1;
  return `<div class="chips">${song.sections.map(s => `<span style="flex:${(s.open ? 4 : s.bars) / tot};background:${colorFor(s.name)}"></span>`).join('')}</div>`;
}
function songSub(song) {
  const st = songStats(song);
  return `${song.bpm} BPM · ${song.num}/${song.den} · ${fmtDuration(st.secs)}${st.openCount ? ' + deschis' : ''}`;
}

// ---------- router ----------
function route() {
  if (current && current.destroy) current.destroy();
  current = null;
  window.scrollTo(0, 0);
  const parts = (location.hash.slice(1) || '/concerte').split('/').filter(Boolean);
  const [a, b, c] = parts;
  if (a === 'piese') current = SongsView();
  else if (a === 'piesa') current = SongEditView(b);
  else if (a === 'concert') current = SetlistEditView(b);
  else if (a === 'scena') current = PlayView(b, c, { app, store, S, engine, $, esc, toast, go, DEFAULT_KEYS_A, DEFAULT_KEYS_B });
  else if (a === 'setari') current = SettingsView();
  else current = SetlistsView();
}
window.addEventListener('hashchange', route);

// ================= CONCERTE =================
function SetlistsView() {
  const render = () => {
    const sls = [...store.data.setlists].sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.updatedAt - x.updatedAt);
    app.innerHTML = `<div class="shell"><div class="page">
      <div class="page-head"><h1>Concerte</h1><button class="btn primary" data-a="new">+ Concert nou</button></div>
      ${sls.length ? sls.map(sl => {
        const songs = sl.songIds.map(id => store.song(id)).filter(Boolean);
        const dur = songs.reduce((a, s) => a + songStats(s).secs, 0);
        return `<div class="card list-item">
          <div class="main" data-a="edit" data-id="${sl.id}">
            <div class="t">${esc(sl.name)}</div>
            <div class="s">${sl.date ? esc(fmtDate(sl.date)) + ' · ' : ''}${songs.length} piese · ~${fmtDuration(dur)}</div>
          </div>
          <button class="btn primary" data-a="play" data-id="${sl.id}" ${songs.length ? '' : 'disabled'}>▶ Scenă</button>
        </div>`;
      }).join('') : `<div class="empty">Niciun concert încă.<br>Adaugă întâi piesele, apoi creează un concert.</div>`}
    </div>${tabs('setlist')}</div>`;
  };
  render();
  app.onclick = e => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    if (a === 'new') { const sl = newSetlist(); store.upsertSetlist(sl); go('/concert/' + sl.id); }
    if (a === 'edit') go('/concert/' + el.dataset.id);
    if (a === 'play') { engine.unlock(); go('/scena/' + el.dataset.id); }
  };
  return {};
}
function fmtDate(d) {
  try { return new Date(d + 'T12:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; }
}

// ================= PIESE =================
function SongsView() {
  let q = '';
  const render = () => {
    const songs = store.data.songs
      .filter(s => !q || s.title.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title, 'ro'));
    $('#list').innerHTML = songs.length ? songs.map(s => `
      <div class="card list-item">
        <div class="main" data-a="edit" data-id="${s.id}">
          <div class="t">${esc(s.title)}</div>
          <div class="s num">${songSub(s)} · ${s.sections.length} secțiuni</div>
          ${structChips(s)}
        </div>
        <button class="icon-btn" data-a="test" data-id="${s.id}" title="Testează pe scenă">▶</button>
      </div>`).join('') : `<div class="empty">${q ? 'Nicio piesă găsită.' : 'Nicio piesă încă. Apasă „+ Piesă nouă”.'}</div>`;
  };
  app.innerHTML = `<div class="shell"><div class="page">
    <div class="page-head"><h1>Piese</h1><button class="btn primary" data-a="new">+ Piesă nouă</button></div>
    <input class="search" type="search" placeholder="Caută piesa…" id="q">
    <div id="list"></div>
  </div>${tabs('songs')}</div>`;
  $('#q').oninput = e => { q = e.target.value; render(); };
  render();
  app.onclick = e => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    if (a === 'new') { const s = newSong(); store.upsertSong(s); go('/piesa/' + s.id); }
    if (a === 'edit') go('/piesa/' + el.dataset.id);
    if (a === 'test') { engine.unlock(); go('/scena/piesa/' + el.dataset.id); }
  };
  return {};
}

// ================= EDITOR PIESĂ =================
function SongEditView(id) {
  const orig = store.song(id);
  if (!orig) { go('/piese'); return {}; }
  const song = structuredClone(orig);
  const save = debounce(() => { store.upsertSong(structuredClone(song)); }, 300);
  const saveNow = () => store.upsertSong(structuredClone(song));
  let preview = null;
  let taps = [];

  const secRow = (s, i) => `
    <div class="sec-row" data-i="${i}">
      <div class="c" style="background:${colorFor(s.name)}"></div>
      <div class="name"><input class="input" list="sectypes" value="${esc(s.name)}" data-f="name" placeholder="Nume secțiune" autocapitalize="characters"></div>
      <div class="bars"><div class="stepper ${s.open ? 'dis' : ''}">
        <button data-a="bars-" tabindex="-1">−</button>
        <input class="num" inputmode="numeric" value="${s.open ? '∞' : s.bars}" data-f="bars" aria-label="Măsuri">
        <button data-a="bars+" tabindex="-1">+</button>
      </div></div>
      <div class="open"><button class="toggle ${s.open ? 'on' : ''}" data-a="open">${s.open ? '↻ Deschisă' : 'Fixă'}</button></div>
      <div class="note"><input class="input" value="${esc(s.note)}" data-f="note" placeholder="Notă (opțional): ex. doar hi-hat"></div>
      <div class="tools">
        <button class="icon-btn" data-a="up" ${i === 0 ? 'disabled' : ''} title="Sus">↑</button>
        <button class="icon-btn" data-a="down" ${i === song.sections.length - 1 ? 'disabled' : ''} title="Jos">↓</button>
        <button class="icon-btn" data-a="dup" title="Duplică">⧉</button>
        <button class="icon-btn danger" data-a="del" title="Șterge">✕</button>
      </div>
    </div>`;

  const summary = () => {
    const st = songStats(song);
    return `<span>Total: <b class="num">${st.fixedBars}</b> măsuri · <b class="num">${st.beats}</b> bătăi</span>
            <span>Durată: <b class="num">${fmtDuration(st.secs)}</b>${st.openCount ? ` + ${st.openCount} secț. deschise` : ''}</span>
            <span>Count-in: <b class="num">${song.countPrep} + ${song.countSticks}</b></span>`;
  };

  const renderSections = () => {
    $('#secs').innerHTML = song.sections.length ? song.sections.map(secRow).join('') : `<div class="empty">Nicio secțiune. Adaugă din butoanele de mai jos.</div>`;
    $('#sum').innerHTML = summary();
  };

  app.innerHTML = `<div class="shell"><div class="page">
    <div class="page-head"><button class="back" data-a="back">‹ Piese</button><div class="spacer"></div>
      <button class="btn small" data-a="preview" id="pv">▶ Ascultă tempo</button>
      <button class="btn small primary" data-a="test">Testează pe scenă</button></div>
    <input class="input title-input" id="title" value="${esc(song.title)}" placeholder="Titlul piesei">
    <div class="grid">
      <div><label class="f">Tempo (BPM)</label>
        <div class="stepper"><button data-a="bpm-">−</button><input class="num" id="bpm" inputmode="decimal" value="${song.bpm}"><button data-a="bpm+">+</button></div>
        <div class="row" style="margin-top:8px"><button class="btn small" data-a="tap" style="flex:1">Tap tempo</button></div>
      </div>
      <div><label class="f">Măsura</label>
        <div class="sig">
          <select class="input" id="num">${Array.from({ length: 15 }, (_, k) => k + 2).map(n => `<option ${n === song.num ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <span class="muted" style="font-size:22px">/</span>
          <select class="input" id="den">${[2, 4, 8].map(n => `<option ${n === song.den ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        <div class="hint">BPM-ul se referă la unitatea de jos (pătrimi în x/4, optimi în x/8).</div>
      </div>
      <div><label class="f">Count-in · pregătire</label>
        <div class="stepper"><button data-a="prep-">−</button><input class="num" id="prep" inputmode="numeric" value="${song.countPrep}"><button data-a="prep+">+</button></div>
        <div class="hint">Timpi doar pentru tine.</div>
      </div>
      <div><label class="f">Count-in · bețe</label>
        <div class="stepper"><button data-a="sticks-">−</button><input class="num" id="sticks" inputmode="numeric" value="${song.countSticks}"><button data-a="sticks+">+</button></div>
        <div class="hint">Timpi bătuți pentru band.</div>
      </div>
    </div>
    <h2 class="sec-h">Structură</h2>
    <div id="secs"></div>
    <div class="add-chips">
      ${SECTION_TYPES.map(t => `<button data-a="add" data-t="${t.name}"><i style="background:${t.color}"></i>${t.name}</button>`).join('')}
      <button data-a="add" data-t=""><i style="background:#d0b48a"></i>ALTA…</button>
    </div>
    <div class="summary" id="sum"></div>
    <h2 class="sec-h">Note piesă</h2>
    <textarea class="input" id="notes" placeholder="Ex: tonalitate, cine începe, cue-uri…">${esc(song.notes)}</textarea>
    <div class="row" style="margin-top:28px"><button class="btn" data-a="dup-song">Duplică piesa</button><div class="spacer"></div><button class="btn danger" data-a="del-song">Șterge piesa</button></div>
    <datalist id="sectypes">${SECTION_TYPES.map(t => `<option value="${t.name}">`).join('')}</datalist>
  </div></div>`;
  renderSections();

  const setNum = (key, v, min, max, el) => {
    song[key] = clamp(v, min, max);
    if (el) el.value = song[key];
    save(); $('#sum').innerHTML = summary();
    if (key === 'bpm' && preview) { preview.stop(); startPreview(); }
  };

  $('#title').oninput = e => { song.title = e.target.value; save(); };
  $('#notes').oninput = e => { song.notes = e.target.value; save(); };
  $('#bpm').onchange = e => setNum('bpm', Math.round((parseFloat(e.target.value.replace(',', '.')) || 120) * 10) / 10, 20, 400, e.target);
  $('#num').onchange = e => { song.num = +e.target.value; if (song.countSticks === 4 && song.num !== 4) song.countSticks = song.num; $('#sticks').value = song.countSticks; save(); $('#sum').innerHTML = summary(); };
  $('#den').onchange = e => { song.den = +e.target.value; save(); };
  $('#prep').onchange = e => setNum('countPrep', parseInt(e.target.value) || 0, 0, 16, e.target);
  $('#sticks').onchange = e => setNum('countSticks', parseInt(e.target.value) || 0, 0, 16, e.target);

  // editări în rândurile de secțiuni (fără re-randare, ca să nu pierzi focusul)
  $('#secs').addEventListener('input', e => {
    const row = e.target.closest('.sec-row'); if (!row) return;
    const s = song.sections[+row.dataset.i];
    const f = e.target.dataset.f;
    if (f === 'name') { s.name = e.target.value.toUpperCase(); row.querySelector('.c').style.background = colorFor(s.name); }
    if (f === 'note') s.note = e.target.value;
    if (f === 'bars') { const v = parseInt(e.target.value); if (v > 0) { s.bars = clamp(v, 1, 999); $('#sum').innerHTML = summary(); } }
    save();
  });
  $('#secs').addEventListener('change', e => {
    if (e.target.dataset.f === 'bars') { const row = e.target.closest('.sec-row'); const s = song.sections[+row.dataset.i]; e.target.value = s.open ? '∞' : s.bars; }
    if (e.target.dataset.f === 'name') {
      const row = e.target.closest('.sec-row'); const s = song.sections[+row.dataset.i];
      // dacă ai ales JOC PUBLIC din listă, o facem deschisă automat
      const t = SECTION_TYPES.find(t => t.name === baseName(s.name));
      if (t && t.open && !s.open) { s.open = true; save(); renderSections(); }
    }
  });

  function startPreview() {
    const p = new Player(engine, {});
    p.load({ bpm: song.bpm, num: song.num, den: song.den, countPrep: 0, countSticks: 0, sections: [{ name: '', bars: 1, open: true }] });
    p.start();
    preview = p;
    $('#pv').textContent = '■ Stop tempo';
  }
  function stopPreview() { if (preview) preview.stop(); preview = null; const b = $('#pv'); if (b) b.textContent = '▶ Ascultă tempo'; }

  app.onclick = async e => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    const row = el.closest('.sec-row');
    const i = row ? +row.dataset.i : -1;
    const step = { 'bpm-': ['bpm', -1, 20, 400], 'bpm+': ['bpm', 1, 20, 400], 'prep-': ['countPrep', -1, 0, 16], 'prep+': ['countPrep', 1, 0, 16], 'sticks-': ['countSticks', -1, 0, 16], 'sticks+': ['countSticks', 1, 0, 16] }[a];
    if (step) {
      const [k, d, mn, mx] = step;
      const ids = { bpm: 'bpm', countPrep: 'prep', countSticks: 'sticks' };
      setNum(k, Math.round(song[k]) + d, mn, mx, $('#' + ids[k]));
      return;
    }
    switch (a) {
      case 'back': go('/piese'); break;
      case 'test': saveNow(); engine.unlock(); go('/scena/piesa/' + song.id); break;
      case 'preview': await engine.unlock(); if (preview) stopPreview(); else startPreview(); break;
      case 'tap': {
        await engine.unlock();
        const now = performance.now();
        taps = taps.filter(t => now - t < 2500); taps.push(now);
        if (taps.length >= 2) {
          const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
          setNum('bpm', Math.round(60000 / iv), 20, 400, $('#bpm'));
        }
        el.textContent = taps.length >= 2 ? `Tap (${taps.length}) → ${song.bpm}` : 'Tap…';
        break;
      }
      case 'bars-': case 'bars+': {
        const s = song.sections[i]; s.bars = clamp(s.bars + (a === 'bars+' ? 1 : -1), 1, 999);
        row.querySelector('[data-f=bars]').value = s.bars; save(); $('#sum').innerHTML = summary(); break;
      }
      case 'open': song.sections[i].open = !song.sections[i].open; save(); renderSections(); break;
      case 'up': if (i > 0) { const x = song.sections.splice(i, 1)[0]; song.sections.splice(i - 1, 0, x); save(); renderSections(); } break;
      case 'down': if (i < song.sections.length - 1) { const x = song.sections.splice(i, 1)[0]; song.sections.splice(i + 1, 0, x); save(); renderSections(); } break;
      case 'dup': song.sections.splice(i + 1, 0, { ...structuredClone(song.sections[i]), id: uid() }); save(); renderSections(); break;
      case 'del': song.sections.splice(i, 1); save(); renderSections(); break;
      case 'add': {
        const t = el.dataset.t;
        let name = t;
        if (t) {
          const n = song.sections.filter(s => baseName(s.name) === t).length;
          if (n > 0 && ['STROFA', 'SOLO', 'BRIDGE'].includes(t)) name = `${t} ${n + 1}`;
        }
        const type = SECTION_TYPES.find(x => x.name === t);
        const bars = { INTRO: 4, OUTRO: 4, BREAK: 2, 'PRE-REFREN': 4 }[t] || 8;
        song.sections.push({ id: uid(), name, bars, open: !!(type && type.open), note: '' });
        save(); renderSections();
        if (!t) { const inp = $('#secs').lastElementChild.querySelector('[data-f=name]'); inp && inp.focus(); }
        break;
      }
      case 'dup-song': { saveNow(); const c = { ...structuredClone(song), id: uid(), title: song.title + ' (copie)' }; c.sections.forEach(s => s.id = uid()); store.upsertSong(c); go('/piesa/' + c.id); break; }
      case 'del-song': {
        const used = store.data.setlists.filter(sl => sl.songIds.includes(song.id)).length;
        if (confirm(`Ștergi „${song.title}”?${used ? `\nApare în ${used} concert(e) și va fi scoasă din ele.` : ''}`)) { store.deleteSong(song.id); go('/piese'); }
        break;
      }
    }
  };
  return { destroy() { stopPreview(); saveNow.call(null); } };
}

// ================= EDITOR CONCERT =================
function SetlistEditView(id) {
  const sl = store.setlist(id);
  if (!sl) { go('/concerte'); return {}; }
  const save = () => store.upsertSetlist(sl);

  const renderSongs = () => {
    const songs = sl.songIds.map(sid => store.song(sid));
    const dur = songs.filter(Boolean).reduce((a, s) => a + songStats(s).secs, 0);
    $('#songs').innerHTML = songs.length ? songs.map((s, i) => !s ? '' : `
      <div class="card sl-song" data-i="${i}">
        <div class="n num">${i + 1}</div>
        <div class="main"><div class="t" style="font-weight:700">${esc(s.title)}</div><div class="s muted num" style="font-size:13px">${songSub(s)}</div></div>
        <button class="icon-btn" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-a="down" ${i === songs.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-btn danger" data-a="rm">✕</button>
      </div>`).join('') : `<div class="empty">Concertul nu are piese. Apasă „+ Adaugă piese”.</div>`;
    $('#dur').textContent = `${songs.length} piese · ~${fmtDuration(dur)}`;
    $('#play').disabled = !songs.length;
  };

  app.innerHTML = `<div class="shell"><div class="page">
    <div class="page-head"><button class="back" data-a="back">‹ Concerte</button><div class="spacer"></div>
      <button class="btn primary" data-a="play" id="play">▶ Scenă</button></div>
    <input class="input title-input" id="name" value="${esc(sl.name)}" placeholder="Numele concertului">
    <div class="grid"><div><label class="f">Data</label><input class="input" type="date" id="date" value="${esc(sl.date)}"></div></div>
    <h2 class="sec-h">Ordinea pieselor <span class="spacer"></span><span id="dur" class="num" style="text-transform:none;letter-spacing:0"></span></h2>
    <div id="songs"></div>
    <button class="btn" data-a="add" style="width:100%">+ Adaugă piese</button>
    <div class="row" style="margin-top:28px"><button class="btn" data-a="dup">Duplică concertul</button><div class="spacer"></div><button class="btn danger" data-a="del">Șterge concertul</button></div>
  </div></div>`;
  renderSongs();
  $('#name').oninput = e => { sl.name = e.target.value; save(); };
  $('#date').onchange = e => { sl.date = e.target.value; save(); };

  const picker = () => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    let q = '';
    const list = () => store.data.songs.filter(s => !q || s.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.title.localeCompare(b.title, 'ro'))
      .map(s => { const n = sl.songIds.filter(x => x === s.id).length; return `<div class="card list-item" style="cursor:pointer" data-pick="${s.id}"><div class="main"><div class="t">${esc(s.title)}</div><div class="s num">${songSub(s)}</div></div><span class="btn small ${n ? '' : 'primary'}">${n ? `✓ ×${n}` : '+ Adaugă'}</span></div>`; }).join('')
      || `<div class="empty">Nicio piesă în bibliotecă. Creează piese în tab-ul „Piese”.</div>`;
    bg.innerHTML = `<div class="modal"><div class="modal-h"><h3>Adaugă piese</h3><button class="btn small primary" data-close>Gata</button></div>
      <div class="modal-b"><input class="search" type="search" placeholder="Caută…"><div class="pl">${list()}</div></div></div>`;
    document.body.appendChild(bg);
    bg.querySelector('.search').oninput = e => { q = e.target.value; bg.querySelector('.pl').innerHTML = list(); };
    bg.onclick = e => {
      if (e.target === bg || e.target.closest('[data-close]')) { bg.remove(); renderSongs(); return; }
      const p = e.target.closest('[data-pick]');
      if (p) { sl.songIds.push(p.dataset.pick); save(); bg.querySelector('.pl').innerHTML = list(); }
    };
  };

  app.onclick = e => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    const row = el.closest('[data-i]'); const i = row ? +row.dataset.i : -1;
    if (a === 'back') go('/concerte');
    if (a === 'play') { engine.unlock(); go('/scena/' + sl.id); }
    if (a === 'add') picker();
    if (a === 'up' && i > 0) { const x = sl.songIds.splice(i, 1)[0]; sl.songIds.splice(i - 1, 0, x); save(); renderSongs(); }
    if (a === 'down' && i < sl.songIds.length - 1) { const x = sl.songIds.splice(i, 1)[0]; sl.songIds.splice(i + 1, 0, x); save(); renderSongs(); }
    if (a === 'rm') { sl.songIds.splice(i, 1); save(); renderSongs(); }
    if (a === 'dup') { const c = { ...structuredClone(sl), id: uid(), name: sl.name + ' (copie)' }; store.upsertSetlist(c); go('/concert/' + c.id); }
    if (a === 'del' && confirm(`Ștergi concertul „${sl.name}”? Piesele rămân în bibliotecă.`)) { store.deleteSetlist(sl.id); go('/concerte'); }
  };
  return {};
}

// ================= SETĂRI =================
function SettingsView() {
  let learn = null; // 'A' | 'B'
  const vol = (k, label) => `<div class="slider-row"><span>${label}</span><input type="range" min="0" max="100" value="${Math.round((k === 'flash' ? S.flash : S.vol[k]) * 100)}" data-v="${k}"><span class="num" data-vv="${k}">${Math.round((k === 'flash' ? S.flash : S.vol[k]) * 100)}</span></div>`;
  const keysHtml = w => {
    const def = w === 'A' ? DEFAULT_KEYS_A : DEFAULT_KEYS_B;
    const extra = w === 'A' ? S.keysA : S.keysB;
    return def.map(k => `<span class="keycap">${esc(keyName(k))}</span>`).join('') + extra.map(k => `<span class="keycap" style="border-color:var(--accent)">${esc(keyName(k))}</span>`).join('');
  };
  const render = () => {
    app.innerHTML = `<div class="shell"><div class="page">
      <div class="page-head"><h1>Setări</h1></div>

      <h2 class="sec-h">Click</h2>
      <div class="card">
        ${vol('master', 'Volum general')}
        ${vol('accent', 'Timpul 1')}
        ${vol('beat', 'Timpii 2, 3, 4…')}
        ${vol('sub', 'Optimi')}
        ${vol('flash', 'Flash vizual')}
        <div class="row"><button class="btn small" data-a="testclick" id="tc">▶ Probează (100 BPM)</button></div>
        <div class="hint">„Timpii 2, 3, 4” pe 0 = auzi doar timpul 1. „Optimi” pe 0 = doar pătrimi. Count-in-ul se aude mereu, indiferent de aceste setări. Le poți regla și pe scenă, din butonul 🔊.</div>
      </div>

      <h2 class="sec-h">Pedală / tastatură Bluetooth</h2>
      <div class="card">
        <div style="margin-bottom:10px"><b>Buton A</b> — Start piesă · în secțiunile deschise: măsura curentă devine ultima<br>${keysHtml('A')}</div>
        <div style="margin-bottom:12px"><b>Buton B</b> — Piesa anterioară (când e oprit) · <b>apăsat de 2 ori rapid = STOP</b><br>${keysHtml('B')}</div>
        <div class="row">
          <button class="btn small ${learn === 'A' ? 'primary' : ''}" data-a="learnA">${learn === 'A' ? 'Apasă pedala A…' : 'Învață tasta A'}</button>
          <button class="btn small ${learn === 'B' ? 'primary' : ''}" data-a="learnB">${learn === 'B' ? 'Apasă pedala B…' : 'Învață tasta B'}</button>
          <button class="btn small ghost" data-a="resetkeys">Resetează</button>
        </div>
        <div class="hint" id="lastkey">Apasă orice buton al pedalei ca să vezi ce tastă trimite.</div>
      </div>

      <h2 class="sec-h">Date</h2>
      <div class="card">
        <div class="muted" style="margin-bottom:12px">${store.data.songs.length} piese · ${store.data.setlists.length} concerte · salvate doar pe acest dispozitiv</div>
        <div class="row">
          <button class="btn primary" data-a="export">Exportă (backup)</button>
          <button class="btn" data-a="import-merge">Importă și combină</button>
          <button class="btn ghost" data-a="import-replace">Importă și înlocuiește tot</button>
        </div>
        <input type="file" id="file" accept=".json,application/json" hidden>
        <div class="hint">Ca să muți piesele între laptop și telefon: Exportă pe un dispozitiv, trimite-ți fișierul (AirDrop, WhatsApp, e-mail, Drive), apoi Importă pe celălalt. „Combină” păstrează ce ai și adaugă/actualizează după cea mai nouă versiune.</div>
      </div>

      <h2 class="sec-h">Despre</h2>
      <div class="card"><div class="hint" style="margin:0">Măsura v${APP_VERSION} · funcționează complet offline după instalare.<br>
        iPhone: deschide în Safari → Share → „Add to Home Screen”. Folosește apoi mereu iconița de pe ecran (datele aplicației instalate sunt separate de cele din Safari).<br>
        Înainte de concert: Setări iPhone → Display &amp; Brightness → Auto-Lock → Never, și căștile pe fir.</div></div>
    </div>${tabs('settings')}</div>`;
  };
  render();

  let tester = null;
  const stopTester = () => { if (tester) tester.stop(); tester = null; };

  app.oninput = e => {
    const k = e.target.dataset.v; if (!k) return;
    const v = e.target.value / 100;
    if (k === 'flash') S.flash = v; else if (k === 'master') engine.setMaster(v); else S.vol[k] = v;
    $(`[data-vv="${k}"]`).textContent = e.target.value;
    store.save();
  };
  app.onclick = async e => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    if (a === 'testclick') {
      await engine.unlock();
      if (tester) { stopTester(); el.textContent = '▶ Probează (100 BPM)'; return; }
      tester = new Player(engine, {});
      tester.load({ bpm: 100, num: 4, den: 4, countPrep: 0, countSticks: 0, sections: [{ name: '', bars: 1, open: true }] });
      tester.start(); el.textContent = '■ Stop';
    }
    if (a === 'learnA' || a === 'learnB') { learn = a.slice(-1); stopTester(); render(); }
    if (a === 'resetkeys') { S.keysA = []; S.keysB = []; store.save(); render(); toast('Tastele au revenit la implicit'); }
    if (a === 'export') exportData();
    if (a === 'import-merge' || a === 'import-replace') {
      const f = $('#file');
      f.onchange = async () => {
        const file = f.files[0]; if (!file) return;
        try {
          const text = await file.text();
          const mode = a === 'import-replace' ? 'replace' : 'merge';
          if (mode === 'replace' && !confirm('Înlocuiești TOATE piesele și concertele de pe acest dispozitiv cu cele din fișier?')) return;
          const r = store.importJSON(text, mode);
          toast(`Import reușit: ${r.songs.added} piese noi, ${r.songs.updated} actualizate · ${r.setlists.added} concerte noi`);
          render();
        } catch (err) { alert('Import eșuat: ' + err.message); }
        f.value = '';
      };
      f.click();
    }
  };
  const onKey = e => {
    const lk = $('#lastkey'); if (lk) lk.innerHTML = `Ultima tastă primită: <span class="keycap">${esc(keyName(e.key))}</span>`;
    if (!learn) return;
    e.preventDefault();
    const arr = learn === 'A' ? S.keysA : S.keysB;
    const other = learn === 'A' ? S.keysB : S.keysA;
    const def = learn === 'A' ? DEFAULT_KEYS_A : DEFAULT_KEYS_B;
    const idx = other.indexOf(e.key); if (idx >= 0) other.splice(idx, 1);
    if (!arr.includes(e.key) && !def.includes(e.key)) arr.push(e.key);
    store.save();
    toast(`Tasta ${keyName(e.key)} → buton ${learn}`);
    learn = null; render();
  };
  window.addEventListener('keydown', onKey);
  return { destroy() { stopTester(); window.removeEventListener('keydown', onKey); app.oninput = null; } };
}

async function exportData() {
  const json = store.exportJSON();
  const d = new Date();
  const name = `masura-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup Măsura' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Backup descărcat: ' + name);
}

// ---------- pornire ----------
route();
// deblocare audio la primul gest (iOS)
const unlockOnce = () => { engine.unlock(); };
window.addEventListener('pointerdown', unlockOnce, { once: true });
window.addEventListener('keydown', unlockOnce, { once: true });

// ---------- actualizări ----------
// Versiunea nouă se descarcă în fundal. Se aplică automat (reîncărcare), dar NICIODATĂ
// cât timp ești pe ecranul de scenă — atunci așteaptă până ieși din el.
let pendingReload = false;
function applyUpdateIfSafe() {
  if (!pendingReload) return;
  const onStage = location.hash.startsWith('#/scena');
  if (!onStage) location.reload();
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(e => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    pendingReload = true;
    applyUpdateIfSafe(); // pe ecranul de scenă nu face nimic (nici mesaje) — se aplică la ieșire
  });
  window.addEventListener('hashchange', applyUpdateIfSafe);
}
// iOS (aplicație instalată): uneori fereastra raportată e mai scurtă decât ecranul
// și rămâne o bandă goală jos. Fixăm înălțimea la înălțimea reală a ecranului.
function fixHeight() {
  const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  let h = window.innerHeight;
  if (standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const sh = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    h = Math.max(h, sh);
  }
  document.documentElement.style.setProperty('--app-h', h + 'px');
}
fixHeight();
window.addEventListener('resize', fixHeight);
window.addEventListener('orientationchange', () => setTimeout(fixHeight, 300));

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
