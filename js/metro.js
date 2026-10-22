// Măsura — METRONOM liber: tempo, măsură, subdiviziuni, tap tempo.
// Rulează doar aici, pe telefonul tău: nu transmite nimic către monitoarele colegilor.
import { makeTicker } from './engine.js';
import { clamp } from './store.js';

const AHEAD = 0.12; // cât de departe în viitor programăm clickurile (secunde)
const BPM_MIN = 20, BPM_MAX = 400;
export const DEFAULT_METRO = { bpm: 120, num: 4, den: 4, sub: 1 };

// Timpul unei atingeri: cel al evenimentului (dat de sistem la atingere), nu momentul în care apucă să ruleze codul.
export function tapTime(e) {
  const now = performance.now();
  return e && Math.abs(e.timeStamp - now) < 500 ? e.timeStamp : now;
}

// Tap tempo: media ultimelor atingeri (cel mult 8); o pauză de peste 2 s începe o numărătoare nouă.
export function makeTapper() {
  let taps = [];
  return t => {
    if (taps.length && t - taps[taps.length - 1] > 2000) taps = [];
    taps.push(t);
    if (taps.length > 8) taps.shift();
    if (taps.length < 2) return { n: 1, bpm: null };
    return { n: taps.length, bpm: 60000 * (taps.length - 1) / (taps[taps.length - 1] - taps[0]) };
  };
}

const UNIT = { 2: 'Doimi', 4: 'Pătrimi', 8: 'Optimi', 16: '16-imi', 32: '32-imi' };
function subLabels(den) {
  return [[1, UNIT[den] || 'Timpi'], [2, UNIT[den * 2] || '÷2'], [3, 'Triolete'], [4, UNIT[den * 4] || '÷4']];
}
function tempoName(bpm) {
  const T = [[40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'], [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto']];
  for (const [max, name] of T) if (bpm < max) return name;
  return 'Prestissimo';
}

// Secvențiatorul: programează clickurile pe ceasul audio. Tempoul și măsura se pot schimba din mers.
class Metro {
  constructor(engine, cfg, onBeat) {
    this.engine = engine; this.cfg = cfg; this.onBeat = onBeat;
    this.ticker = makeTicker(() => this._schedule());
    this.playing = false; this.queue = []; this.beat = 0; this.nextTime = 0; this.lastBeatTime = -1;
  }
  start() {
    this.beat = 0; this.queue = []; this.lastBeatTime = -1;
    this.nextTime = this.engine.now() + 0.06;
    this.playing = true;
    this._schedule();
    this.ticker.start();
  }
  stop() {
    this.playing = false;
    this.ticker.stop();
    this._flush();
    this.lastBeatTime = -1;
  }
  _flush() {
    for (const ev of this.queue) ev.srcs.forEach(x => { try { x.stop(); } catch (e) { /* ignore */ } });
    this.queue = [];
  }
  // Tap în timpul rulării: bătaia cade ACUM, iar următoarea vine la un timp după ea.
  hit() {
    if (!this.playing) return;
    this._flush();
    this._emit(this.engine.now());
    this._schedule();
  }
  _emit(t) {
    const c = this.cfg, v = this.engine.vol, spb = 60 / c.bpm, srcs = [];
    const add = (k, tt, l) => { const x = this.engine.play(k, tt, l); if (x) srcs.push(x); };
    if (this.beat >= c.num) this.beat = 0;
    const down = c.num > 1 && this.beat === 0;
    add(down ? 'accent' : 'beat', t, down ? v.accent : v.beat);
    // subdiviziunile se aud mereu când sunt alese aici (independent de „Optimi” din Setări)
    const subL = v.sub > 0 ? v.sub : Math.max(0.3, v.beat * 0.7);
    for (let k = 1; k < c.sub; k++) add('sub', t + k * spb / c.sub, subL);
    this.queue.push({ time: t, beat: this.beat, down, srcs });
    this.beat = (this.beat + 1) % c.num;
    this.nextTime = t + spb;
  }
  _schedule() {
    if (!this.playing) return;
    const horizon = this.engine.now() + AHEAD;
    while (this.nextTime < horizon) this._emit(this.nextTime);
  }
  // din requestAnimationFrame: livrează bătăile care se aud acum
  update() {
    const now = this.engine.audibleNow();
    while (this.queue.length && this.queue[0].time <= now) {
      const ev = this.queue.shift();
      this.lastBeatTime = ev.time;
      this.onBeat(ev);
    }
  }
}

// ================= ECRANUL METRONOM =================
export function MetroView(ctx) {
  const { app, store, S, engine, $, toast, tabs } = ctx;
  S.metro = { ...DEFAULT_METRO, ...(S.metro || {}) };
  const M = S.metro;
  M.bpm = clamp(Math.round(Number(M.bpm)) || 120, BPM_MIN, BPM_MAX);
  M.num = clamp(parseInt(M.num) || 4, 1, 16);
  M.den = [2, 4, 8].includes(Number(M.den)) ? Number(M.den) : 4;
  M.sub = [1, 2, 3, 4].includes(Number(M.sub)) ? Number(M.sub) : 1;

  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => store.save(), 400); };
  const tapper = makeTapper();
  const metro = new Metro(engine, M, ev => showBeat(ev));
  let raf = 0, flashPeak = 1, destroyed = false;

  const volRow = (k, l) => `<div class="slider-row"><span>${l}</span><input type="range" min="0" max="100" value="${Math.round(S.vol[k] * 100)}" data-v="${k}"><span class="num">${Math.round(S.vol[k] * 100)}</span></div>`;

  app.innerHTML = `<div class="shell"><div class="page metro" id="metro">
    <div class="page-head"><h1>Metronom</h1><button class="btn small" id="mvolbtn">🔊 Volum</button></div>
    <div class="card" id="mvol" hidden>${volRow('master', 'General')}${volRow('accent', 'Timpul 1')}${volRow('beat', 'Ceilalți timpi')}</div>
    <div class="m-grid">
      <div class="m-disp"><div class="flash" id="mflash"></div>
        <input class="m-bpm num" id="mbpm" inputmode="numeric" maxlength="3" aria-label="Tempo în BPM" autocomplete="off">
        <div class="m-unit"><b>BPM</b> · <span id="mname"></span></div>
        <div class="p-dots m-dots" id="mdots"></div>
      </div>
      <div class="m-ctl">
        <div class="m-steps"><button data-s="-5">−5</button><button data-s="-1">−1</button><button data-s="1">+1</button><button data-s="5">+5</button></div>
        <input type="range" id="mrange" min="30" max="260" step="1" aria-label="Tempo">
        <div class="m-row">
          <div><label class="f">Măsura</label>
            <div class="sig">
              <select class="input" id="mnum" aria-label="Timpi pe măsură">${Array.from({ length: 16 }, (_, k) => k + 1).map(n => `<option ${n === M.num ? 'selected' : ''}>${n}</option>`).join('')}</select>
              <span class="muted" style="font-size:22px">/</span>
              <select class="input" id="mden" aria-label="Unitatea de timp">${[2, 4, 8].map(n => `<option ${n === M.den ? 'selected' : ''}>${n}</option>`).join('')}</select>
            </div>
          </div>
          <div><label class="f">Subdiviziuni</label><div class="seg4" id="msub"></div></div>
        </div>
      </div>
      <div class="m-go">
        <button class="m-tap" id="mtap">TAP<small id="mtapn">tempo</small></button>
        <button class="m-start" id="mstart">START</button>
      </div>
    </div>
    <div class="hint">Merge doar pe acest telefon; colegii nu îl văd în Monitor.</div>
  </div>${tabs('metro')}</div>`;

  const els = { bpm: $('#mbpm'), name: $('#mname'), dots: $('#mdots'), flash: $('#mflash'), range: $('#mrange'), sub: $('#msub'), tap: $('#mtap'), tapn: $('#mtapn'), start: $('#mstart'), vol: $('#mvol') };

  function drawDots() {
    els.dots.innerHTML = Array.from({ length: M.num }, (_, i) => `<i class="${i === 0 && M.num > 1 ? 'd' : ''}"></i>`).join('');
  }
  function drawSub() {
    els.sub.innerHTML = subLabels(M.den).map(([n, l]) => `<button data-sub="${n}" class="${n === M.sub ? 'on' : ''}">${l}</button>`).join('');
  }
  function drawBpm(fromInput) {
    if (!fromInput) els.bpm.value = M.bpm;
    els.range.value = clamp(M.bpm, 30, 260);
    els.name.textContent = tempoName(M.bpm);
  }
  function setBpm(v, fromInput) {
    M.bpm = clamp(Math.round(v) || M.bpm, BPM_MIN, BPM_MAX);
    drawBpm(fromInput);
    save();
  }
  function showBeat(ev) {
    [...els.dots.children].forEach((d, k) => d.classList.toggle('on', k === ev.beat));
    els.flash.style.background = ev.down ? 'var(--down)' : '#ffffff';
    flashPeak = ev.down ? 1 : 0.5;
  }
  function drawStart() {
    els.start.textContent = metro.playing ? '■ STOP' : 'START';
    els.start.classList.toggle('on', metro.playing);
  }

  // ---- ecranul rămâne aprins cât merge metronomul ----
  let wake = null;
  const wakeOn = async () => {
    if (destroyed || !metro.playing || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wake && !wake.released) return;
    try { wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
  };
  const wakeOff = () => { try { wake && wake.release(); } catch (e) { /* ignore */ } wake = null; };
  const onVis = () => { if (document.visibilityState === 'visible') { wakeOn(); if (engine.ctx) engine.ctx.resume().catch(() => {}); } };
  document.addEventListener('visibilitychange', onVis);

  function stop() {
    metro.stop();
    els.flash.style.opacity = 0;
    [...els.dots.children].forEach(d => d.classList.remove('on'));
    wakeOff();
    drawStart();
  }
  let starting = false;
  async function toggle() {
    if (metro.playing) { stop(); return; }
    if (starting) return;
    starting = true;
    try {
      const ok = await engine.unlock();
      if (destroyed) return;
      if (!ok) { toast('Sunetul nu a pornit — apasă din nou START'); return; }
      metro.start();
      wakeOn();
      drawStart();
    } finally { starting = false; }
  }

  // ---- tap tempo: totul se întâmplă în aceeași clipă cu atingerea ----
  let tapOffT = null;
  function tap(t) {
    const r = tapper(t);
    if (!engine.ready) engine.unlock(); // nu așteptăm după el
    if (r.bpm) setBpm(r.bpm);
    if (metro.playing) metro.hit();                               // bătaia se mută pe atingere
    else engine.play('beat', 0, Math.max(S.vol.beat, 0.5));       // altfel, un click de confirmare, imediat
    els.tapn.textContent = r.bpm ? `${r.n} atingeri` : 'încă o dată…';
    els.tap.classList.add('hit');
    clearTimeout(tapOffT);
    tapOffT = setTimeout(() => els.tap.classList.remove('hit'), 90);
  }
  els.tap.addEventListener('pointerdown', e => { e.preventDefault(); tap(tapTime(e)); });
  els.tap.addEventListener('click', e => { if (e.detail === 0) tap(performance.now()); }); // activare de la tastatură

  // ---- pași de tempo: o atingere = un pas; ținut apăsat = repetă ----
  let holdT = null, holdI = null;
  const holdEnd = () => { clearTimeout(holdT); clearInterval(holdI); holdT = holdI = null; };
  $('.m-steps').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    e.preventDefault();
    const d = Number(b.dataset.s);
    holdEnd();
    setBpm(M.bpm + d);
    holdT = setTimeout(() => { holdI = setInterval(() => setBpm(M.bpm + d), 80); }, 420);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => $('.m-steps').addEventListener(t, holdEnd));

  els.bpm.addEventListener('focus', () => els.bpm.select());
  els.bpm.addEventListener('input', () => { const v = parseInt(els.bpm.value); if (v >= BPM_MIN && v <= BPM_MAX) setBpm(v, true); });
  els.bpm.addEventListener('change', () => drawBpm());
  els.bpm.addEventListener('keydown', e => { if (e.key === 'Enter') els.bpm.blur(); });
  els.range.addEventListener('input', () => setBpm(Number(els.range.value)));
  $('#mnum').addEventListener('change', e => { M.num = clamp(parseInt(e.target.value) || 4, 1, 16); drawDots(); save(); });
  $('#mden').addEventListener('change', e => { M.den = Number(e.target.value); drawSub(); save(); });
  els.sub.addEventListener('click', e => {
    const b = e.target.closest('[data-sub]'); if (!b) return;
    M.sub = Number(b.dataset.sub); drawSub(); save();
  });
  els.start.addEventListener('click', toggle);
  $('#mvolbtn').addEventListener('click', () => { els.vol.hidden = !els.vol.hidden; });
  els.vol.addEventListener('input', e => {
    const k = e.target.dataset.v; if (!k) return;
    const v = e.target.value / 100;
    if (k === 'master') engine.setMaster(v); else S.vol[k] = v;
    e.target.nextElementSibling.textContent = e.target.value;
    save();
  });

  function frame() {
    if (metro.playing && engine.lost) { stop(); toast('Sunetul s-a întrerupt — apasă START'); }
    metro.update();
    if (metro.lastBeatTime >= 0) {
      const dt = engine.audibleNow() - metro.lastBeatTime;
      els.flash.style.opacity = (Math.max(0, 1 - dt / 0.16) * flashPeak * S.flash * 0.75).toFixed(3);
    }
    raf = requestAnimationFrame(frame);
  }

  drawBpm(); drawDots(); drawSub(); drawStart();
  engine.keepAlive(true);
  raf = requestAnimationFrame(frame);

  return {
    get busy() { return metro.playing; },
    destroy() {
      destroyed = true;
      metro.stop();
      holdEnd();
      cancelAnimationFrame(raf);
      clearTimeout(saveT); clearTimeout(tapOffT);
      document.removeEventListener('visibilitychange', onVis);
      wakeOff();
      engine.keepAlive(false);
      store.save();
    },
  };
}
