// Măsura — MONITOR: afișează ecranul de scenă al masterului, fără sunet și fără comenzi.
import { PlayView } from './play.js';
import { Receiver } from './share.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = document.getElementById('app');

// Ceasul monitorului = ceasul MASTERULUI: ceasul telefonului + decalajul măsurat prin ping/pong (vezi share.js).
// Așa un Android cu ceasul dat peste cap rămâne în pas cu toboșarul.
let rx = null;
const masterNow = () => rx ? rx.now() : Date.now();
const clock = { audibleNow: () => masterNow() / 1000, unlock: async () => true, ctx: null };

/*
  VirtualPlayer — aceeași logică de structură ca Player-ul masterului, dar fără sunet:
  din momentul de start (t0) și BPM calculează ce bătaie e acum.
  Secțiunile deschise se termină după măsura „armată” (trimisă de master).
*/
class VirtualPlayer {
  constructor({ onBeat, onEnd }) {
    this.onBeat = onBeat; this.onEnd = onEnd;
    this.playing = false; this.current = null; this.armed = null; this.lastBeatTime = -1; this.queue = [];
  }
  load(song) { this.stop(); this.song = song; }
  startAt(t0, armed) {
    this.t0 = t0; this.armed = armed || null; this.spb = 60000 / this.song.bpm;
    this._reset(); this.playing = true; this.current = null; this.lastBeatTime = -1;
  }
  stop() { this.playing = false; }
  arm() { return 'ignored'; }
  disarm() { return false; }
  setArmed(armed) {
    const a = armed || null;
    if (JSON.stringify(a) === JSON.stringify(this.armed)) return;
    this.armed = a;
    // recalculăm de la început cu noua informație (armarea poate sosi cu puțină întârziere)
    const n = this.n;
    this._reset();
    let ev = null;
    while (this.n < n) { ev = this._next(); if (ev.kind === 'end') break; }
    if (ev && ev.kind !== 'end') { this.current = ev; this.onBeat(ev); }
  }
  _reset() {
    const s = this.song;
    this.n = -1;
    this.pos = s.countPrep > 0 ? { phase: 'prep', i: 0 } : s.countSticks > 0 ? { phase: 'sticks', i: 0 } : { phase: 'song', sec: 0, bar: 0, beat: 0 };
  }
  _next() {
    this.n++;
    const s = this.song, p = this.pos;
    if (p.phase === 'prep') {
      const ev = { kind: 'prep', i: p.i, total: s.countPrep };
      if (++p.i >= s.countPrep) Object.assign(p, s.countSticks > 0 ? { phase: 'sticks', i: 0 } : { phase: s.sections.length ? 'song' : 'done', sec: 0, bar: 0, beat: 0 });
      return ev;
    }
    if (p.phase === 'sticks') {
      const ev = { kind: 'sticks', i: p.i, total: s.countSticks };
      if (++p.i >= s.countSticks) Object.assign(p, { phase: s.sections.length ? 'song' : 'done', sec: 0, bar: 0, beat: 0 });
      return ev;
    }
    if (p.phase === 'song') {
      const ev = { kind: 'beat', sec: p.sec, bar: p.bar, beat: p.beat, downbeat: p.beat === 0 };
      p.beat++;
      if (p.beat >= s.num) {
        p.beat = 0;
        const sec = s.sections[p.sec];
        const next = sec.open ? !!(this.armed && this.armed.sec === p.sec && p.bar >= this.armed.bar) : p.bar + 1 >= sec.bars;
        if (next) { p.sec++; p.bar = 0; if (p.sec >= s.sections.length) p.phase = 'done'; } else p.bar++;
      }
      return ev;
    }
    return { kind: 'end' };
  }
  update() {
    if (!this.playing) return;
    const k = Math.floor((masterNow() - this.t0) / this.spb);
    if (k < 0 || k <= this.n) return;
    let ev;
    // dacă am rămas în urmă (ecran stins etc.), sărim direct la bătaia curentă
    while (this.n < k) { ev = this._next(); if (ev.kind === 'end') break; }
    if (ev.kind === 'end') { this.playing = false; this.current = ev; this.onEnd(); return; }
    this.current = ev;
    this.lastBeatTime = (this.t0 + this.n * this.spb) / 1000;
    this.onBeat(ev);
  }
}

function askCode(err) {
  app.innerHTML = `<div class="shell"><div class="page" style="max-width:460px">
    <div class="page-head"><h1>Monitor</h1></div>
    <div class="card">
      <label class="f">Codul trupei</label>
      <input class="input title-input" id="code" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="ex. K7Q2MX" style="text-transform:uppercase;letter-spacing:0.15em;text-align:center">
      ${err ? `<div class="hint" style="color:var(--danger)">${esc(err)}</div>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="go" style="flex:1">Conectează</button></div>
      <div class="hint">Codul îl vezi pe telefonul toboșarului, în Setări → Monitor pentru colegi. Ecranul arată doar ce vede el, fără sunet.</div>
    </div>
  </div></div>`;
  const inp = $('#code');
  const goNow = () => {
    const c = inp.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 6) { askCode('Codul are 6 caractere.'); return; }
    location.hash = c;
  };
  $('#go').onclick = goNow;
  inp.onkeydown = e => { if (e.key === 'Enter') goNow(); };
}

let view = null, watchdog = null, lastMsgAt = 0, lastState = null;

function start(code) {
  if (rx) rx.close();
  if (view && view.destroy) view.destroy();
  clearInterval(watchdog);
  try { localStorage.setItem('masura.monitor.code', code); } catch (e) { /* ignore */ }
  view = PlayView(null, null, {
    app, store: null, S: { flash: 0.7 }, engine: clock, $, esc, toast: () => {}, go: () => {},
    monitor: true,
    makePlayer: h => new VirtualPlayer(h),
  });
  const dot = $('#linkdot');
  const setDot = (cls, text) => { dot.hidden = false; dot.className = 'link-dot ' + cls; dot.textContent = text; };
  setDot('wait', `${code} · conectare…`);
  let online = false;
  const label = () => {
    if (!online) return `${code} · fără internet`;
    if (!rx || !rx.synced) return `${code} · conectat · ceas…`;
    return `${code} · conectat · ceas ±${Math.max(1, Math.round(rx.rtt / 2))} ms`;
  };
  rx = new Receiver(code, {
    onStatus: ok => { online = ok; setDot(ok ? 'on' : 'off', label()); },
    onClock: () => { if (online) setDot('on', label()); },
    onState: s => {
      lastMsgAt = Date.now();
      lastState = s;
      if (s.type === 'idle' || s.type === 'state') view.apply(s);
    },
  });
  // dacă masterul tace mult (telefon închis / fără semnal), spunem asta, dar păstrăm ce rulează
  watchdog = setInterval(() => {
    if (lastState && Date.now() - lastMsgAt > 20000 && !(lastState.state === 'playing')) {
      setDot('off', `${code} · masterul nu transmite`);
    }
  }, 5000);
}

function route() {
  const code = location.hash.slice(1).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length === 6) start(code);
  else {
    let saved = '';
    try { saved = localStorage.getItem('masura.monitor.code') || ''; } catch (e) { /* ignore */ }
    askCode();
    if (saved) $('#code').value = saved;
  }
}
window.addEventListener('hashchange', route);
route();
