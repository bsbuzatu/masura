// Măsura — ecranul de scenă
import { colorFor, songStats, fmtDuration } from './store.js';
import { Player } from './engine.js';

// ================= SCENĂ =================
export function PlayView(a, b, ctx) {
  const { app, store, S, engine, $, esc, toast, go, DEFAULT_KEYS_A, DEFAULT_KEYS_B } = ctx;
  const monitor = !!ctx.monitor;      // monitor = doar afișare, comandat de la distanță
  const broadcast = ctx.broadcast;    // master: transmite starea către monitoare (opțional)
  // /scena/<setlistId> sau /scena/piesa/<songId>
  let title = '', songs = [];
  if (monitor) { songs = []; }
  else if (a === 'piesa') { const s = store.song(b); songs = s ? [s] : []; title = 'Test piesă'; }
  else { const sl = store.setlist(a); songs = sl ? sl.songIds.map(id => store.song(id)).filter(Boolean) : []; title = sl ? sl.name : ''; }
  if (!monitor && !songs.length) { go('/concerte'); return {}; }

  let idx = 0;
  let state = 'ready'; // ready | playing | done
  let finishedAll = false;
  let raf = 0;
  let cells = [];   // cells[sec][bar] → element
  const CELL = 20;  // 18 + gap 2
  let lastShown = {};
  let bPressAt = 0;

  const handlers = { onBeat: ev => showBeat(ev), onEnd: () => songEnded() };
  const player = ctx.makePlayer ? ctx.makePlayer(handlers) : new Player(engine, handlers);

  app.innerHTML = `<div class="play ${monitor ? 'monitor' : ''}" id="play">
    <header class="p-top">
      <button class="x" data-a="exit" aria-label="Ieși">✕</button>
      <div class="where num" id="where"></div>
      <div class="title" id="ttl"></div>
      <div class="meta num" id="meta"></div>
      <button class="x" data-a="vol" aria-label="Volum">🔊</button>
      <div class="link-dot" id="linkdot" hidden></div>
    </header>
    <main class="p-main">
      <section class="p-now" id="now"><div class="flash" id="flash"></div><div class="bar-c" id="barc"></div><div id="nowc"></div></section>
      <aside class="p-side">
        <div class="p-box"><div class="p-bar num"><span class="cur" id="bcur">–</span><span class="tot" id="btot"></span></div></div>
        <div class="p-box"><div class="p-dots" id="dots"></div></div>
        <div class="p-box p-next" id="next"></div>
      </aside>
    </main>
    <div class="p-strip"><div class="p-strip-inner" id="strip"></div><div class="cursor"></div></div>
    <footer class="p-ctl">
      <button class="stop" data-a="stop" id="stop"><div class="fill"></div><span>■ STOP</span></button>
      <button data-a="prev" id="prev">◀</button>
      <button class="go" data-a="go" id="go">START</button>
      <button data-a="next" id="nextb">▶</button>
    </footer>
  </div>`;

  const els = {
    now: $('#now'), nowc: $('#nowc'), flash: $('#flash'), barc: $('#barc'), bcur: $('#bcur'), btot: $('#btot'),
    dots: $('#dots'), next: $('#next'), strip: $('#strip'), go: $('#go'), prev: $('#prev'), nextb: $('#nextb'), stop: $('#stop'),
  };

  // ---- wake lock: ecranul rămâne aprins cât ești pe ecranul de scenă ----
  let wake = null;
  const keepAwake = async () => {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); } } catch (e) { /* ignore */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') { keepAwake(); if (engine.ctx) engine.ctx.resume().catch(() => {}); } };
  document.addEventListener('visibilitychange', onVis);
  keepAwake();

  const song = () => songs[idx];

  function buildStrip() {
    const s = song();
    cells = [];
    els.strip.innerHTML = s.sections.map(sec => {
      const n = sec.open ? 4 : sec.bars;
      const col = colorFor(sec.name);
      return `<div class="s-blk ${sec.open ? 'open' : ''}"><div class="l">${esc(sec.name || '—')}${sec.open ? ' ↻' : ''}</div><div class="cells">${Array.from({ length: n }, () => `<b style="background:${col}"></b>`).join('')}</div></div>`;
    }).join('');
    els.strip.querySelectorAll('.s-blk').forEach((blk, si) => { cells[si] = [...blk.querySelectorAll('.cells b')]; });
    moveStrip(-1, 0);
  }
  // poziția se citește din DOM, ca etichetele lungi să nu decaleze cursorul
  const portrait = () => window.matchMedia('(orientation: portrait)').matches;
  let stripPos = [-1, 0];
  function moveStrip(sec, bar) {
    stripPos = [sec, bar];
    const box = els.strip.parentElement;
    if (portrait()) {
      // listă verticală: secțiunea curentă stă sus; la secțiunile lungi urmărim rândul măsurii curente
      const blk = sec >= 0 ? els.strip.children[sec] : null;
      const h = box.clientHeight;
      let off = 0;
      if (blk) {
        off = blk.offsetTop - h * 0.15;
        const cell = cells[sec] && cells[sec][bar];
        if (cell) {
          const cy = blk.offsetTop + cell.offsetTop;
          if (cy + cell.offsetHeight > off + h * 0.8) off = cy - h * 0.4;
        }
      }
      const max = Math.max(0, els.strip.scrollHeight - h);
      off = Math.min(max, Math.max(0, off));
      els.strip.style.transform = `translateY(${-Math.round(off)}px)`;
      return;
    }
    const w = box.clientWidth;
    const cell = sec >= 0 && cells[sec] ? cells[sec][bar] : null;
    const x = cell ? cell.offsetLeft + cell.parentElement.parentElement.offsetLeft : -CELL * 1.5;
    els.strip.style.transform = `translateX(${Math.round(w * 0.3 - x - 11)}px)`;
  }
  function markCells(sec, bar) {
    const s = song();
    [...els.strip.children].forEach((blk, si) => {
      blk.classList.toggle('on', si === sec);
      blk.classList.toggle('done', si < sec);
    });
    cells.forEach((arr, si) => arr.forEach((c, bi) => {
      const open = s.sections[si].open;
      const isCur = si === sec && bi === (open ? bar % 4 : bar);
      const past = si < sec || (si === sec && !open && bi < bar);
      c.className = isCur ? 'cur' : past ? 'past' : '';
    }));
  }

  function dots(n, cls = '') { els.dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i === 0 && !cls ? 'd' : ''} ${cls}"></i>`).join(''); }
  function lightDot(i) { [...els.dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); }

  function header() {
    const s = song();
    $('#where').textContent = songs.length > 1 ? `${idx + 1}/${songs.length}` : title;
    $('#ttl').textContent = s.title;
    $('#meta').innerHTML = `${s.bpm} BPM<small>${s.num}/${s.den}</small>`;
  }

  function setNext(label, name, bars, hot) {
    els.next.className = 'p-box p-next' + (hot ? ' hot' : '');
    els.next.innerHTML = `<div class="lbl">${esc(label)}</div><div class="nm">${esc(name)}</div>${bars ? `<div class="nb">${esc(bars)}</div>` : ''}`;
  }
  const secBarsLabel = sec => sec.open ? '↻ deschisă' : sec.bars === 1 ? '1 măsură' : `${sec.bars} măsuri`;

  function showWaiting(msg) {
    state = 'ready';
    player.stop(); player.lastBeatTime = -1; els.flash.style.opacity = 0;
    $('#where').textContent = 'MONITOR';
    $('#ttl').textContent = title || '';
    $('#meta').innerHTML = '';
    els.strip.innerHTML = ''; cells = [];
    els.now.className = 'p-now';
    els.barc.style.background = 'transparent';
    els.nowc.innerHTML = `<div class="p-ready"><div class="big">${esc(msg)}</div></div>`;
    els.bcur.textContent = '–'; els.btot.textContent = '';
    dots(4);
  }

  function showReady() {
    state = 'ready';
    const s = song();
    if (!s) { showWaiting('Aștept…'); return; }
    header();
    buildStrip();
    lastShown = {};
    els.now.className = 'p-now';
    els.barc.style.background = 'transparent';
    const st = songStats(s);
    els.nowc.innerHTML = `<div class="p-ready">
      ${finishedAll ? `<div class="sub" style="color:var(--ok);margin:0 0 8px">✓ Final de concert</div>` : ''}
      <div class="big">${esc(s.title)}</div>
      <div class="sub num">${s.bpm} BPM · ${s.num}/${s.den} · ${s.sections.length} secțiuni · ${fmtDuration(st.secs)}${st.openCount ? ' + deschis' : ''} · count-in ${s.countPrep}+${s.countSticks}</div>
      ${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ''}
    </div>`;
    els.bcur.textContent = '–'; els.btot.textContent = '';
    dots(s.num);
    const first = s.sections[0];
    setNext('ÎNCEPE CU', first ? first.name : '—', first ? secBarsLabel(first) : '', false);
    updateControls();
    emit();
  }

  // ---- transmisie către monitoare (doar pe master) ----
  let t0 = 0;
  function emit() {
    if (!broadcast) return;
    const s = song();
    broadcast.send({
      type: 'state', setlist: title, idx, total: songs.length, finishedAll,
      song: s && { title: s.title, bpm: s.bpm, num: s.num, den: s.den, countPrep: s.countPrep, countSticks: s.countSticks, notes: s.notes, sections: s.sections },
      state, t0: state === 'playing' ? t0 : 0, armed: state === 'playing' ? player.armed : null,
    });
  }

  function updateControls() {
    const g = els.go;
    els.prev.disabled = state === 'playing' || idx === 0;
    els.nextb.disabled = state === 'playing' || idx >= songs.length - 1;
    els.stop.disabled = state !== 'playing';
    g.className = 'go';
    if (state !== 'playing') { g.textContent = 'START'; g.disabled = false; return; }
    const c = player.current;
    const sec = c && c.kind === 'beat' ? song().sections[c.sec] : null;
    if (sec && sec.open) {
      if (player.armed) { g.className = 'go armed'; g.textContent = 'SE ÎNCHIDE…'; }
      else { g.className = 'go arm'; g.textContent = 'ULTIMA MĂSURĂ'; }
    } else { g.className = 'go idle'; g.textContent = c && c.kind !== 'beat' ? 'COUNT-IN…' : '♪'; }
  }

  function showBeat(ev) {
    const s = song();
    if (ev.kind === 'prep') {
      if (lastShown.kind !== 'prep') {
        els.now.className = 'p-now';
        els.barc.style.background = 'transparent';
        els.nowc.innerHTML = `<div class="sec-name" style="color:var(--muted)">PREGĂTIRE</div><div class="status muted">Count-in ${s.countPrep} + ${s.countSticks}</div>`;
        dots(ev.total, 'prep'); els.btot.textContent = '';
        const f = s.sections[0];
        setNext('URMEAZĂ', s.countSticks ? `BEȚE ${s.countSticks}` : f.name, '', false);
      }
      els.bcur.textContent = ev.i + 1;
      lightDot(ev.i);
    } else if (ev.kind === 'sticks') {
      if (lastShown.kind !== 'sticks') {
        els.now.className = 'p-now last-bar';
        dots(ev.total);
        const f = s.sections[0];
        setNext('INTRĂ', f.name, secBarsLabel(f), true);
        markCells(-1, 0);
        els.btot.textContent = '';
      }
      els.nowc.innerHTML = `<div class="sec-name num sticks-n">${ev.i + 1}</div><div class="status">Bețe pentru band</div>`;
      els.bcur.textContent = ev.i + 1;
      lightDot(ev.i);
    } else if (ev.kind === 'beat') {
      const sec = s.sections[ev.sec];
      const nxt = s.sections[ev.sec + 1];
      const armed = player.armed && player.armed.sec === ev.sec;
      const isLast = sec.open ? (armed && ev.bar >= player.armed.bar) : ev.bar === sec.bars - 1;
      const key = `${ev.sec}:${ev.bar}:${armed ? 1 : 0}`;
      if (lastShown.key !== key) {
        if (lastShown.sec !== ev.sec || lastShown.kind !== 'beat') {
          els.nowc.innerHTML = `<div class="sec-name" style="color:${colorFor(sec.name)}">${esc(sec.name || '—')}</div>${sec.note ? `<div class="sec-note">${esc(sec.note)}</div>` : ''}<div class="status" id="st"></div>`;
          els.barc.style.background = colorFor(sec.name);
          dots(s.num);
        }
        const st = $('#st');
        if (sec.open) {
          els.bcur.textContent = ev.bar + 1; els.btot.textContent = '↻';
          if (isLast) { els.now.className = 'p-now armed last-bar'; st.innerHTML = `<span style="color:var(--armed)">ULTIMA MĂSURĂ → ${esc(nxt ? nxt.name : 'FINAL')}</span>`; }
          else { els.now.className = 'p-now open-sec'; st.innerHTML = `<span style="color:var(--open)">↻ Deschisă · pedala A = ultima măsură</span>`; }
        } else {
          els.bcur.textContent = ev.bar + 1; els.btot.textContent = '/' + sec.bars;
          els.now.className = 'p-now' + (isLast ? ' last-bar' : '');
          st.innerHTML = isLast ? `<span style="color:var(--accent)">ULTIMA MĂSURĂ → ${esc(nxt ? nxt.name : 'FINAL')}</span>` : '';
        }
        if (nxt) setNext(isLast ? 'INTRĂ' : 'URMEAZĂ', nxt.name, secBarsLabel(nxt), isLast);
        else setNext(isLast ? 'FINAL' : 'URMEAZĂ', 'FINAL', '', isLast);
        moveStrip(ev.sec, sec.open ? ev.bar % 4 : ev.bar);
        markCells(ev.sec, ev.bar);
        lastShown.key = key;
      }
      lightDot(ev.beat);
    }
    lastShown.kind = ev.kind;
    if (ev.kind === 'beat') lastShown.sec = ev.sec;
    // flash
    const strong = (ev.kind === 'beat' && ev.downbeat) || (ev.kind === 'sticks' && ev.i === 0);
    els.flash.style.background = ev.kind === 'prep' ? '#8f8b85' : strong ? 'var(--down)' : (ev.kind === 'sticks' ? 'var(--accent)' : '#ffffff');
    flashPeak = ev.kind === 'prep' ? 0.35 : strong ? 1 : 0.5;
    updateControls();
  }

  let flashPeak = 1;
  function frame() {
    player.update();
    if (player.lastBeatTime >= 0) {
      const dt = engine.audibleNow() - player.lastBeatTime;
      const o = Math.max(0, 1 - dt / 0.16) * flashPeak * S.flash * 0.75;
      els.flash.style.opacity = o.toFixed(3);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function songEnded() {
    player.stop();
    player.lastBeatTime = -1; els.flash.style.opacity = 0;
    if (monitor) { runKey = ''; showWaiting(idx < songs.length - 1 ? 'Urmează piesa următoare…' : '✓ Final de concert'); return; }
    if (idx < songs.length - 1) { idx++; finishedAll = false; }
    else finishedAll = true;
    showReady();
    if (!finishedAll) toast(`Piesa s-a terminat · urmează: ${song().title}`);
  }

  let starting = false;
  async function start() {
    if (state === 'playing' || starting) return;
    starting = true;
    try {
      const audioOk = await engine.unlock();
      finishedAll = false;
      player.load(song());
      const ok = await player.start();
      if (!ok) { toast('Piesa nu are secțiuni'); return; }
      state = 'playing';
      const first = player.queue && player.queue[0];
      t0 = first ? Date.now() + (first.time - engine.audibleNow()) * 1000 : Date.now();
      keepAwake();
      updateControls();
      emit();
      if (!audioOk) toast('Sunetul nu a pornit — oprește și apasă din nou START');
    } finally { starting = false; }
  }
  function stop() {
    player.stop(); player.lastBeatTime = -1; els.flash.style.opacity = 0;
    showReady();
  }
  function actionA() {
    if (state !== 'playing') { start(); return; }
    const r = player.arm();
    if (r === 'armed') { lastShown.key = null; if (player.current) showBeat(player.current); emit(); }
    updateControls();
  }
  function actionB() {
    const now = performance.now();
    if (state === 'playing') {
      if (now - bPressAt < 600) { stop(); toast('Oprit'); bPressAt = 0; return; }
      bPressAt = now;
      toast('Apasă B încă o dată rapid pentru STOP');
      return;
    }
    if (idx > 0) { idx--; finishedAll = false; showReady(); }
  }

  const keyA = k => DEFAULT_KEYS_A.includes(k) || S.keysA.includes(k);
  const keyB = k => DEFAULT_KEYS_B.includes(k) || S.keysB.includes(k);
  const onKey = e => {
    if (monitor) return;
    if (e.repeat) { e.preventDefault(); return; }
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (keyA(e.key)) { e.preventDefault(); actionA(); }
    else if (keyB(e.key)) { e.preventDefault(); actionB(); }
  };
  window.addEventListener('keydown', onKey);

  // STOP pe ecran: ține apăsat ~0,8 s
  let holdT = null;
  const holdStart = e => {
    if (state !== 'playing') return;
    e.preventDefault();
    els.stop.classList.add('holding');
    holdT = setTimeout(() => { els.stop.classList.remove('holding'); stop(); }, 800);
  };
  const holdEnd = () => { clearTimeout(holdT); els.stop.classList.remove('holding'); };
  els.stop.addEventListener('pointerdown', holdStart);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => els.stop.addEventListener(t, holdEnd));

  let volOpen = null;
  function toggleVol() {
    if (volOpen) { volOpen.remove(); volOpen = null; return; }
    const p = document.createElement('div');
    p.className = 'vol-panel';
    const row = (k, l) => { const v = k === 'flash' ? S.flash : S.vol[k]; return `<div class="slider-row"><span>${l}</span><input type="range" min="0" max="100" value="${Math.round(v * 100)}" data-v="${k}"><span class="num">${Math.round(v * 100)}</span></div>`; };
    p.innerHTML = row('master', 'General') + row('accent', 'Timpul 1') + row('beat', 'Timpii 2-4') + row('sub', 'Optimi') + row('flash', 'Flash');
    p.oninput = e => {
      const k = e.target.dataset.v; const v = e.target.value / 100;
      if (k === 'flash') S.flash = v; else if (k === 'master') engine.setMaster(v); else S.vol[k] = v;
      e.target.nextElementSibling.textContent = e.target.value;
      store.save();
    };
    $('#play').appendChild(p);
    volOpen = p;
  }

  $('#play').onclick = e => {
    const el = e.target.closest('[data-a]');
    if (volOpen && !e.target.closest('.vol-panel') && (!el || el.dataset.a !== 'vol')) { volOpen.remove(); volOpen = null; }
    if (!el) return;
    el.blur();
    const a = el.dataset.a;
    if (a === 'exit') {
      if (state === 'playing' && !confirm('Piesa rulează. Ieși de pe ecranul de scenă?')) return;
      history.length > 1 ? history.back() : go('/concerte');
    }
    if (a === 'vol') toggleVol();
    if (a === 'go') actionA();
    if (a === 'prev' && state !== 'playing' && idx > 0) { idx--; finishedAll = false; showReady(); }
    if (a === 'next' && state !== 'playing' && idx < songs.length - 1) { idx++; finishedAll = false; showReady(); }
  };

  const onResize = () => { els.strip.style.transition = 'none'; moveStrip(stripPos[0], stripPos[1]); requestAnimationFrame(() => { els.strip.style.transition = ''; }); };
  window.addEventListener('resize', onResize);

  // ---- monitor: aplică starea primită de la master ----
  let runKey = '', readyKey = '';
  function apply(m) {
    if (!m || m.type !== 'state' || !m.song) { runKey = ''; readyKey = ''; title = (m && m.setlist) || title; showWaiting(m && m.type === 'idle' ? 'Aștept să intre pe scenă…' : 'Aștept…'); return; }
    title = m.setlist || '';
    songs = new Array(Math.max(1, m.total || 1));
    idx = Math.min(m.idx || 0, songs.length - 1);
    songs[idx] = m.song;
    finishedAll = !!m.finishedAll;
    if (m.state === 'playing' && m.t0) {
      const key = `${idx}:${m.t0}`;
      if (key !== runKey) {
        runKey = key; readyKey = '';
        lastShown = {};
        header(); buildStrip();
        player.load(m.song);
        player.startAt(m.t0, m.armed);
        state = 'playing';
      } else player.setArmed(m.armed);
    } else {
      // starea „pregătit” se re-trimite periodic: re-desenăm doar dacă s-a schimbat ceva
      const rk = JSON.stringify([idx, finishedAll, m.song]);
      if (!runKey && rk === readyKey && state === 'ready') return;
      readyKey = rk; runKey = '';
      player.stop(); player.lastBeatTime = -1; els.flash.style.opacity = 0;
      showReady();
    }
  }

  if (monitor) showWaiting('Mă conectez…');
  else { showReady(); engine.unlock(); }

  return {
    apply,
    showWaiting,
    destroy() {
      if (broadcast) broadcast.send({ type: 'idle', setlist: title });
      player.stop();
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      try { wake && wake.release(); } catch (e) { /* ignore */ }
    },
    get playing() { return state === 'playing'; },
  };
}
