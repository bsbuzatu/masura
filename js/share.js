// Măsura — legătura master → monitoare, prin brokere MQTT publice (internet mobil).
// Ne conectăm la mai multe brokere deodată: dacă unul cade, celălalt duce mesajele.
import { MiniMqtt } from './mqtt.js';

export const BROKERS = (typeof globalThis !== 'undefined' && globalThis.__MASURA_BROKERS) || [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];
const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 6 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');
export const topicFor = code => `masura/v1/${String(code).toUpperCase()}/state`;
// sincronizarea ceasului: monitorul trimite „ping”, masterul răspunde „pong” (ca NTP, prin același broker)
export const topicPing = code => `masura/v1/${String(code).toUpperCase()}/ping`;
export const topicPong = code => `masura/v1/${String(code).toUpperCase()}/pong`;

// ---------- master ----------
export class Broadcaster {
  constructor(code, onStatus) {
    this.topic = topicFor(code);
    this.pingTopic = topicPing(code);
    this.pongTopic = topicPong(code);
    this.seq = 0;
    this.last = null;
    this.onStatus = onStatus || (() => {});
    this.clients = BROKERS.map(url => new MiniMqtt(url, {
      onStatus: () => this._status(),
      onMessage: (t, payload) => { if (t === this.pingTopic) this._pong(payload, url); },
    }));
    this.clients.forEach(c => { c.subscribe(this.pingTopic); c.connect(); });
    // re-trimitem starea periodic: monitoarele care intră târziu sau pierd semnalul se resincronizează
    this.hb = setInterval(() => { if (this.last) this._send(this.last); }, 5000);
  }
  _status() { this.onStatus(this.clients.some(c => c.connected)); }
  // răspuns la ping: ora la care l-am primit (t2) și ora la care răspundem (t3), pe ceasul masterului.
  // Răspundem pe același broker pe care a venit ping-ul, ca drumul dus-întors să fie același.
  _pong(payload, url) {
    const t2 = Date.now();
    let p; try { p = JSON.parse(payload); } catch (e) { return; }
    if (!p || typeof p.t1 !== 'number' || !p.mid) return;
    const c = this.clients.find(x => x.url === url);
    if (c) c.publish(this.pongTopic, JSON.stringify({ mid: p.mid, id: p.id, t1: p.t1, t2, t3: Date.now() }), false);
  }
  get online() { return this.clients.some(c => c.connected); }
  send(state) {
    this.last = state;
    this._send(state);
  }
  _send(state) {
    const msg = JSON.stringify({ ...state, seq: ++this.seq, sentAt: Date.now() });
    this.clients.forEach(c => c.publish(this.topic, msg, true));
  }
  close(finalState) {
    if (finalState) this.send(finalState);
    clearInterval(this.hb);
    setTimeout(() => this.clients.forEach(c => c.close()), 400);
  }
}

// ---------- monitor ----------
export class Receiver {
  constructor(code, { onState, onStatus, onClock } = {}) {
    this.topic = topicFor(code);
    this.pingTopic = topicPing(code);
    this.pongTopic = topicPong(code);
    this.lastSeq = -1;
    this.lastSentAt = 0;
    this.onState = onState || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onClock = onClock || (() => {});
    // ceas: offset = (ceasul masterului) − (ceasul nostru), în ms; rtt = incertitudinea măsurătorii
    this.mid = 'm' + Math.random().toString(36).slice(2, 8);
    this.offset = 0; this.rtt = Infinity; this.synced = false;
    this.samples = []; this.pingN = 0;
    this.clients = BROKERS.map(url => new MiniMqtt(url, {
      onStatus: () => { const ok = this.clients.some(c => c.connected); this.onStatus(ok); if (ok) this._pingSoon(); },
      onMessage: (t, payload) => { if (t === this.pongTopic) this._pongIn(payload); else this._msg(payload); },
    }));
    this.clients.forEach(c => { c.subscribe(this.topic); c.subscribe(this.pongTopic); c.connect(); });
    // la început măsurăm des (ceasul se stabilizează în câteva secunde), apoi rar, ca să urmărim deriva
    this._pingSoon();
  }
  _pingSoon() { clearTimeout(this.pingT); this.pingT = setTimeout(() => this._ping(), 300); }
  _ping() {
    clearTimeout(this.pingT);
    if (this.clients.some(c => c.connected)) {
      this.pingN++;
      const msg = JSON.stringify({ mid: this.mid, id: this.pingN, t1: Date.now() });
      this.clients.forEach(c => { if (c.connected) c.publish(this.pingTopic, msg, false); });
    }
    this.pingT = setTimeout(() => this._ping(), this.samples.length < 6 ? 1000 : 15000);
  }
  _pongIn(payload) {
    const t4 = Date.now();
    let p; try { p = JSON.parse(payload); } catch (e) { return; }
    if (!p || p.mid !== this.mid) return; // răspuns pentru alt monitor
    const rtt = (t4 - p.t1) - (p.t3 - p.t2);
    if (!(rtt >= 0) || rtt > 4000) return;
    const offset = ((p.t2 - p.t1) + (p.t3 - t4)) / 2;
    this.samples.push({ offset, rtt, at: t4 });
    // păstrăm ultimele 10 măsurători și o folosim pe cea cu drumul cel mai scurt (cea mai precisă)
    this.samples = this.samples.filter(s => t4 - s.at < 120000).slice(-10);
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset; this.rtt = best.rtt; this.synced = true;
    this.onClock(this.offset, this.rtt);
  }
  // ora de acum pe ceasul masterului
  now() { return Date.now() + this.offset; }
  _msg(payload) {
    let s;
    try { s = JSON.parse(payload); } catch (e) { return; }
    // același mesaj vine de pe ambele brokere: îl păstrăm doar pe cel mai nou
    if (s.sentAt < this.lastSentAt || (s.sentAt === this.lastSentAt && s.seq <= this.lastSeq)) return;
    this.lastSentAt = s.sentAt; this.lastSeq = s.seq;
    this.onState(s);
  }
  close() { clearTimeout(this.pingT); this.clients.forEach(c => c.close()); }
}
