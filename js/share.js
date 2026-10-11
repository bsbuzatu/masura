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

// ---------- master ----------
export class Broadcaster {
  constructor(code, onStatus) {
    this.topic = topicFor(code);
    this.seq = 0;
    this.last = null;
    this.onStatus = onStatus || (() => {});
    this.clients = BROKERS.map(url => new MiniMqtt(url, { onStatus: () => this._status() }));
    this.clients.forEach(c => c.connect());
    // re-trimitem starea periodic: monitoarele care intră târziu sau pierd semnalul se resincronizează
    this.hb = setInterval(() => { if (this.last) this._send(this.last); }, 5000);
  }
  _status() { this.onStatus(this.clients.some(c => c.connected)); }
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
  constructor(code, { onState, onStatus } = {}) {
    this.topic = topicFor(code);
    this.lastSeq = -1;
    this.lastSentAt = 0;
    this.onState = onState || (() => {});
    this.onStatus = onStatus || (() => {});
    this.clients = BROKERS.map(url => new MiniMqtt(url, {
      onStatus: () => this.onStatus(this.clients.some(c => c.connected)),
      onMessage: (t, payload) => this._msg(payload),
    }));
    this.clients.forEach(c => { c.subscribe(this.topic); c.connect(); });
  }
  _msg(payload) {
    let s;
    try { s = JSON.parse(payload); } catch (e) { return; }
    // același mesaj vine de pe ambele brokere: îl păstrăm doar pe cel mai nou
    if (s.sentAt < this.lastSentAt || (s.sentAt === this.lastSentAt && s.seq <= this.lastSeq)) return;
    this.lastSentAt = s.sentAt; this.lastSeq = s.seq;
    this.onState(s);
  }
  close() { this.clients.forEach(c => c.close()); }
}
