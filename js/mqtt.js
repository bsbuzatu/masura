// Măsura — client MQTT 3.1.1 minimal peste WebSocket (doar ce ne trebuie: QoS 0, retain).
// Fără dependențe externe. Se reconectează singur.

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s) {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}
function remLen(n) {
  const out = [];
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0);
  return out;
}
function packet(type, body) {
  return new Uint8Array([type, ...remLen(body.length), ...body]);
}

export class MiniMqtt {
  constructor(url, { clientId, onMessage, onStatus, keepalive = 30 } = {}) {
    this.url = url;
    this.clientId = clientId || 'masura-' + Math.random().toString(36).slice(2, 10);
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.keepalive = keepalive;
    this.subs = new Set();
    this.connected = false;
    this.closed = false;
    this.buf = new Uint8Array(0);
    this.pid = 1;
    this.retry = 1000;
    this.pending = []; // publicări cât timp nu suntem conectați (păstrăm doar ultima per topic)
  }

  connect() {
    this.closed = false;
    let ws;
    try { ws = new WebSocket(this.url, ['mqtt']); } catch (e) { this._scheduleReconnect(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      const body = [...str('MQTT'), 4, 0x02, this.keepalive >> 8, this.keepalive & 255, ...str(this.clientId)];
      ws.send(packet(0x10, body));
    };
    ws.onmessage = e => this._data(new Uint8Array(e.data));
    ws.onclose = () => this._down();
    ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
  }

  close() {
    this.closed = true;
    clearInterval(this.pinger); clearTimeout(this.reconnT);
    try { if (this.ws && this.ws.readyState === 1) this.ws.send(new Uint8Array([0xE0, 0])); } catch (e) { /* ignore */ }
    try { this.ws && this.ws.close(); } catch (e) { /* ignore */ }
    this.connected = false;
  }

  subscribe(topic) {
    this.subs.add(topic);
    if (this.connected) this._sub(topic);
  }

  publish(topic, payload, retain = false) {
    if (!this.connected) {
      this.pending = this.pending.filter(p => p.topic !== topic);
      this.pending.push({ topic, payload, retain });
      return false;
    }
    const body = [...str(topic), ...enc.encode(payload)];
    try { this.ws.send(packet(0x30 | (retain ? 1 : 0), body)); return true; } catch (e) { return false; }
  }

  _sub(topic) {
    const id = this.pid++ & 0xffff || 1;
    this.ws.send(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }

  _down() {
    const was = this.connected;
    this.connected = false;
    clearInterval(this.pinger);
    if (was) this.onStatus(false);
    if (!this.closed) this._scheduleReconnect();
  }

  _scheduleReconnect() {
    clearTimeout(this.reconnT);
    this.reconnT = setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 15000);
  }

  _data(chunk) {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf); b.set(chunk, this.buf.length);
    this.buf = b;
    // pot veni mai multe pachete într-un mesaj, sau un pachet în mai multe mesaje
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1, len = 0, i = 1, byte;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++]; len += (byte & 127) * mult; mult *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0];
      const body = this.buf.slice(i, i + len);
      this.buf = this.buf.slice(i + len);
      this._packet(type, body);
    }
  }

  _packet(type, body) {
    const t = type >> 4;
    if (t === 2) { // CONNACK
      if (body[1] !== 0) { try { this.ws.close(); } catch (e) { /* ignore */ } return; }
      this.connected = true;
      this.retry = 1000;
      this.subs.forEach(s => this._sub(s));
      const p = this.pending; this.pending = [];
      p.forEach(x => this.publish(x.topic, x.payload, x.retain));
      clearInterval(this.pinger);
      this.pinger = setInterval(() => { try { this.ws.send(new Uint8Array([0xC0, 0])); } catch (e) { /* ignore */ } }, this.keepalive * 1000 * 0.6);
      this.onStatus(true);
    } else if (t === 3) { // PUBLISH
      const qos = (type >> 1) & 3;
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.slice(2, 2 + tl));
      const start = 2 + tl + (qos > 0 ? 2 : 0);
      this.onMessage(topic, dec.decode(body.slice(start)));
    }
    // SUBACK (9), PINGRESP (13): nimic de făcut
  }
}
