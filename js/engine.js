// Măsura — motor audio (Web Audio) + secvențiator de piesă
// Click-urile sunt programate pe ceasul audio (precis la sample), nu pe timere JS.

const LOOKAHEAD_MS = 25;     // cât de des rulează programatorul
const SCHEDULE_AHEAD = 0.12; // cât de departe în viitor programăm (secunde)
const DRIVE = 3;             // cât de tare împingem clickul în limitator (1 = fără amplificare)

export class ClickEngine {
  constructor(vol) {
    this.vol = vol; // obiect partajat cu setările: {master, accent, beat, sub}
    this.ctx = null;
    this.stalled = false;  // contextul zice „running”, dar ceasul audio stă pe loc
    this._downAt = 0;      // de când nu mai avansează ceasul (0 = merge)
    this._advAt = 0;       // ultima dată când l-am văzut avansând
    this._lastT = -1;
    this._alive = false;
    this._ka = null;
    setInterval(() => this._watch(), 300);
  }

  // „gata” = contextul rulează ȘI ceasul audio chiar avansează
  get ready() { return !!this.ctx && this.ctx.state === 'running' && !this.stalled; }

  // Pe iOS (mai ales cu DAC pe USB, după o pauză de liniște) contextul poate rămâne „running”
  // cu ceasul înghețat, sau „interrupted”. Urmărim ceasul ca să știm asta ÎNAINTE de START.
  _watch() {
    const c = this.ctx, now = performance.now();
    if (!c || c.state === 'closed') { this.stalled = false; this._downAt = 0; return; }
    // în fundal nu numărăm: la revenire contextul are timp să pornească din nou
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') { this._downAt = 0; this._lastT = -1; return; }
    const t = c.currentTime;
    if (c.state === 'running' && t !== this._lastT) { this._advAt = now; this._downAt = 0; this.stalled = false; }
    else {
      if (!this._downAt) this._downAt = now;
      if (c.state === 'running' && now - this._downAt > 700) this.stalled = true;
    }
    this._lastT = t;
  }
  // sunetul e pierdut de peste 2 s (ceas blocat sau context întrerupt)
  get lost() { return !!this._downAt && performance.now() - this._downAt > 2000; }

  _create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.createdAt = performance.now();
    this.stalled = false; this._downAt = 0; this._advAt = 0; this._lastT = -1;
    this.out = this.ctx.createGain();
    this.out.gain.value = curve(this.vol.master);
    // Limitator moale: clickul e amplificat de DRIVE ori și rotunjit sub nivelul maxim,
    // așa că se aude mult mai tare fără să distorsioneze urât (un click scurt are puțină energie).
    this.shaper = this.ctx.createWaveShaper();
    this.shaper.curve = driveCurve();
    this.shaper.oversample = '4x';
    this.out.connect(this.shaper);
    this.merger = null;
    this._route();
    this.buffers = {
      accent: this._tone(1760, 0.038, 0.12, 0.35),
      beat: this._tone(1320, 0.030, 0.10, 0.28),
      sub: this._tone(990, 0.018, 0.06, 0.20),
      // count-in: tonuri moi, joase, fără transient — nu taie prin mix
      ciPrep: this._soft(494, 0.06, 0.18),
      ciStick: this._soft(392, 0.06, 0.18),
      ciStickAcc: this._soft(523, 0.07, 0.20),
    };
    this._applyAlive();
  }

  // Ține ieșirea audio trează cât ești pe scenă / în metronom: un zgomot la −80 dB (inaudibil).
  // Fără el, după o pauză de liniște telefonul sau DAC-ul pot adormi ieșirea, iar următorul START nu mai pornește.
  keepAlive(on) { this._alive = !!on; this._applyAlive(); }
  _applyAlive() {
    if (this._ka) { try { this._ka.stop(); } catch (e) { /* ignore */ } try { this._ka.disconnect(); } catch (e) { /* ignore */ } this._ka = null; }
    if (!this._alive || !this.ctx) return;
    try {
      const sr = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, sr, sr), d = buf.getChannelData(0);
      let seed = 777;
      for (let i = 0; i < sr; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 1073741823.5 - 1) * 0.0001; }
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true; src.connect(this.ctx.destination); src.start(0);
      this._ka = src;
    } catch (e) { /* ignore */ }
  }

  // Ton moale: sinus pur, atac lent (4 ms), fără armonici înalte
  _soft(freq, decay, dur) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const att = Math.min(1, t / 0.004);
      d[i] = Math.sin(2 * Math.PI * freq * t) * att * Math.exp(-t / decay) * 0.8;
    }
    const f = Math.min(n, Math.floor(sr * 0.01));
    for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
    return buf;
  }

  // Trebuie apelat dintr-un gest al utilizatorului (tap / tastă).
  // Pe iOS, după o pauză contextul audio poate rămâne „suspended”/„interrupted”
  // și resume() nu se mai rezolvă — atunci îl refacem, tot în gestul curent.
  async unlock() {
    // iOS 17+: ignoră comutatorul de silențios pentru sunetul aplicației
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    if (!this.ctx || this.ctx.state === 'closed') this._create();
    else if (this.stalled || (this.ctx.state !== 'running' && performance.now() - this.createdAt > 1500)) {
      // ceas înghețat sau context care nu mai pornește: îl refacem, tot în gestul curent
      const old = this.ctx;
      this._create();
      try { old.close(); } catch (e) { /* ignore */ }
    }
    if (this.ctx.state !== 'running') {
      try { this.ctx.resume(); } catch (e) { /* ignore */ }
    }
    // buffer mut — deblochează ieșirea audio pe iOS
    try {
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    } catch (e) { /* ignore */ }
    // așteptăm pornirea, dar niciodată la nesfârșit
    if (this.ctx.state !== 'running') {
      const ctx = this.ctx;
      await new Promise(res => {
        const t = setTimeout(res, 600);
        ctx.addEventListener('statechange', function h() { if (ctx.state === 'running') { clearTimeout(t); ctx.removeEventListener('statechange', h); res(); } });
      });
    }
    return this._ticking();
  }

  // Confirmă că ceasul audio chiar avansează (nu doar că starea e „running”).
  async _ticking() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return false;
    if (!this.stalled && performance.now() - this._advAt < 900) return true; // văzut mergând adineauri
    const t = c.currentTime;
    for (let i = 0; i < 8; i++) {
      await new Promise(res => setTimeout(res, 25));
      if (c !== this.ctx) return this.ready;
      if (c.currentTime > t) { this.stalled = false; this._downAt = 0; this._advAt = performance.now(); return true; }
    }
    this.stalled = true;
    return false;
  }

  // Pe ce canal iese clickul: 'both' (implicit), 'left' sau 'right'.
  // Un singur canal ajută când intri cu un cablu stereo într-o intrare balansată
  // (acolo semnalul identic pe stânga și dreapta se anulează).
  _route() {
    if (!this.ctx) return;
    try { this.shaper.disconnect(); } catch (e) { /* ignore */ }
    if (this.merger) { try { this.merger.disconnect(); } catch (e) { /* ignore */ } this.merger = null; }
    const ch = this.vol.ch;
    if (ch === 'left' || ch === 'right') {
      this.merger = this.ctx.createChannelMerger(2);
      this.shaper.connect(this.merger, 0, ch === 'left' ? 0 : 1);
      this.merger.connect(this.ctx.destination);
    } else this.shaper.connect(this.ctx.destination);
  }
  setChannel(ch) {
    this.vol.ch = ch === 'left' || ch === 'right' ? ch : 'both';
    this._route();
  }

  setMaster(v) {
    this.vol.master = v;
    if (this.out) this.out.gain.setTargetAtTime(curve(v), this.ctx.currentTime, 0.02);
  }

  // Ton scurt, curat (sinus + armonica 2 + un transient fin) — tip „tick” Ableton, nu agresiv
  _tone(freq, decay, dur, transient) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const att = Math.min(1, t / 0.0006);
      const env = att * Math.exp(-t / decay);
      const tone = Math.sin(2 * Math.PI * freq * t) * 0.82 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.18;
      const click = rnd() * Math.exp(-t / 0.0012) * transient;
      d[i] = tone * env + click * att;
    }
    // normalizăm la vârf: fiecare click pleacă de la nivelul maxim, volumele îl coboară de acolo
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < n; i++) d[i] *= 0.98 / peak;
    // fade-out final ca să nu pocnească
    const f = Math.min(n, Math.floor(sr * 0.005));
    for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
    return buf;
  }

  play(kind, time, level) {
    if (!this.ctx || level <= 0.0001) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[kind];
    const g = this.ctx.createGain();
    g.gain.value = curve(level);
    src.connect(g); g.connect(this.out);
    src.start(Math.max(time, this.ctx.currentTime));
    return src;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }
  // momentul care se AUDE acum (compensat cu latența ieșirii)
  audibleNow() {
    if (!this.ctx) return 0;
    const lat = (this.ctx.outputLatency || 0) || (this.ctx.baseLatency || 0);
    return this.ctx.currentTime - lat;
  }
}

function curve(v) { v = Math.max(0, Math.min(1, v)); return v * v; }

// tanh(DRIVE·x), scalat sub 0 dBFS (cu rezervă pentru filtrul de supraeșantionare)
function driveCurve() {
  const n = 2049, c = new Float32Array(n), top = Math.tanh(DRIVE);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(DRIVE * x) / top * 0.92; }
  return c;
}

// ---------- Timer în Worker (nu e frânat de randare) ----------
// Un singur Worker pentru toată aplicația, oricâte playere apar (scenă, probă de tempo, metronom).
const tickSubs = new Set();
let tickSrc = null;
function tickAll() { tickSubs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
function tickSource() {
  if (tickSrc) return tickSrc;
  try {
    const code = `let t=null;onmessage=e=>{if(e.data==='start'){clearInterval(t);t=setInterval(()=>postMessage(0),${LOOKAHEAD_MS});}else{clearInterval(t);t=null;}}`;
    const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    w.onmessage = tickAll;
    tickSrc = { start: () => w.postMessage('start'), stop: () => w.postMessage('stop') };
  } catch (e) {
    let t = null;
    tickSrc = { start: () => { clearInterval(t); t = setInterval(tickAll, LOOKAHEAD_MS); }, stop: () => { clearInterval(t); t = null; } };
  }
  return tickSrc;
}
export function makeTicker(cb) {
  return {
    start() { const was = tickSubs.size; tickSubs.add(cb); if (!was) tickSource().start(); },
    stop() { if (tickSubs.delete(cb) && !tickSubs.size) tickSource().stop(); },
  };
}

/*
  Player — rulează o piesă:
    count-in: `countPrep` timpi de pregătire + `countSticks` timpi bătuți cu bețele
    apoi secțiunile; secțiunile „deschise” se repetă măsură cu măsură până la armare.
  Armare: la apăsare în măsura k a unei secțiuni deschise, măsura k devine ultima
    (se termină măsura curentă, apoi intră secțiunea următoare).

  Evenimente către UI (sincronizate cu ce se aude):
    {kind:'prep', i, total} | {kind:'sticks', i, total} |
    {kind:'beat', sec, bar, beat, downbeat} | {kind:'end'}
*/
export class Player {
  constructor(engine, { onBeat, onEnd } = {}) {
    this.engine = engine;
    this.onBeat = onBeat || (() => {});
    this.onEnd = onEnd || (() => {});
    this.ticker = makeTicker(() => this._schedule());
    this.playing = false;
    this.queue = [];
    this.current = null;     // ultimul eveniment auzit
    this.lastBeatTime = -1;
    this.armed = null;       // {sec, bar}
  }

  load(song) {
    this.stop();
    this.song = song;
  }

  async start() {
    if (!this.song) return false;
    if (!this.engine.ready) await this.engine.unlock();
    const s = this.song;
    this.spb = 60 / s.bpm;
    this.pos = s.countPrep > 0 ? { phase: 'prep', i: 0 }
      : s.countSticks > 0 ? { phase: 'sticks', i: 0 }
      : { phase: 'song', sec: 0, bar: 0, beat: 0 };
    if (this.pos.phase === 'song' && !s.sections.length) return false;
    this.armed = null;
    this.queue = [];
    this.current = null;
    this.lastBeatTime = -1;
    this.nextTime = this.engine.now() + 0.08;
    this.playing = true;
    this._schedule();
    this.ticker.start();
    return true;
  }

  stop() {
    this.playing = false;
    this.ticker.stop();
    // clickurile deja programate (până la ~0,1 s înainte) nu mai trebuie să se audă după STOP
    for (const ev of this.queue) (ev.srcs || []).forEach(x => { try { x.stop(); } catch (e) { /* ignore */ } });
    this.queue = [];
    this.armed = null;
  }

  // Apelat de pedală / buton. Returnează: 'armed' | 'already' | 'ignored'
  arm() {
    if (!this.playing) return 'ignored';
    const c = this.current;
    if (!c || c.kind !== 'beat') return 'ignored';
    const sec = this.song.sections[c.sec];
    if (!sec || !sec.open) return 'ignored';
    if (this.armed && this.armed.sec === c.sec) return 'already';
    this.armed = { sec: c.sec, bar: c.bar };
    // Dacă programatorul a trecut deja (cu ~0,1 s înainte) în măsura următoare a secțiunii,
    // retragem bătăile acelea încă neauzite și sărim direct la secțiunea următoare.
    const p = this.pos;
    if (this.playing && p.phase === 'song' && p.sec === c.sec && p.bar > c.bar) {
      const keep = [];
      let firstTime = null;
      for (const ev of this.queue) {
        if (ev.kind === 'beat' && ev.sec === c.sec && ev.bar > c.bar) {
          if (firstTime === null) firstTime = ev.time;
          (ev.srcs || []).forEach(x => { try { x.stop(); } catch (e) { /* ignore */ } });
        } else keep.push(ev);
      }
      this.queue = keep;
      if (firstTime !== null) this.nextTime = firstTime;
      p.sec = c.sec + 1; p.bar = 0; p.beat = 0;
      if (p.sec >= this.song.sections.length) p.phase = 'done';
      this._schedule();
    }
    return 'armed';
  }
  disarm() {
    if (!this.armed) return false;
    // nu mai putem anula dacă ultima măsură a început deja
    const c = this.current;
    if (c && c.kind === 'beat' && c.sec === this.armed.sec && c.bar >= this.armed.bar) return false;
    this.armed = null;
    return true;
  }

  _schedule() {
    if (!this.playing) return;
    const horizon = this.engine.now() + SCHEDULE_AHEAD;
    while (this.playing && this.nextTime < horizon) {
      const ev = this._step();
      ev.time = this.nextTime;
      this.queue.push(ev);
      if (ev.kind === 'end') { this.playing = false; this.ticker.stop(); break; }
      ev.srcs = this._sound(ev);
      this.nextTime += this.spb;
    }
  }

  _sound(ev) {
    const v = this.engine.vol;
    const t = ev.time;
    const out = [];
    const play = (k, tt, l) => { const x = this.engine.play(k, tt, l); if (x) out.push(x); };
    // count-in: mereu la volumul accentului, ca să se audă chiar dacă timpii 2-4 sunt pe 0
    const ci = Math.max(v.accent, v.beat, 0.5);
    if (ev.kind === 'prep') play('ciPrep', t, ci);
    else if (ev.kind === 'sticks') play(ev.i === 0 ? 'ciStickAcc' : 'ciStick', t, ci);
    else if (ev.kind === 'beat') {
      if (ev.downbeat) play('accent', t, v.accent);
      else play('beat', t, v.beat);
    }
    if (ev.kind === 'beat' && v.sub > 0) {
      play('sub', t + this.spb / 2, v.sub);
    }
    return out;
  }

  _step() {
    const s = this.song, p = this.pos;
    if (p.phase === 'prep') {
      const ev = { kind: 'prep', i: p.i, total: s.countPrep };
      if (++p.i >= s.countPrep) Object.assign(this.pos, s.countSticks > 0 ? { phase: 'sticks', i: 0 } : { phase: 'song', sec: 0, bar: 0, beat: 0 });
      if (this.pos.phase === 'song' && !s.sections.length) this.pos.phase = 'done';
      return ev;
    }
    if (p.phase === 'sticks') {
      const ev = { kind: 'sticks', i: p.i, total: s.countSticks };
      if (++p.i >= s.countSticks) Object.assign(this.pos, { phase: s.sections.length ? 'song' : 'done', sec: 0, bar: 0, beat: 0 });
      return ev;
    }
    if (p.phase === 'song') {
      const ev = { kind: 'beat', sec: p.sec, bar: p.bar, beat: p.beat, downbeat: p.beat === 0 };
      p.beat++;
      if (p.beat >= s.num) {
        p.beat = 0;
        const sec = s.sections[p.sec];
        let next;
        if (sec.open) next = !!(this.armed && this.armed.sec === p.sec && p.bar >= this.armed.bar);
        else next = p.bar + 1 >= sec.bars;
        if (next) {
          p.sec++; p.bar = 0;
          if (p.sec >= s.sections.length) p.phase = 'done';
        } else p.bar++;
      }
      return ev;
    }
    return { kind: 'end' };
  }

  // Apelat din requestAnimationFrame: livrează evenimentele care se aud acum
  update() {
    const now = this.engine.audibleNow();
    while (this.queue.length && this.queue[0].time <= now) {
      const ev = this.queue.shift();
      if (ev.kind === 'end') {
        this.current = ev;
        this.onEnd();
        return;
      }
      this.current = ev;
      this.lastBeatTime = ev.time;
      this.onBeat(ev);
    }
  }

  get active() { return this.playing || this.queue.length > 0; }
}
