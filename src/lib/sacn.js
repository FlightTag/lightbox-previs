'use strict';
// sACN / ANSI E1.31 receiver. Joins the multicast group for each universe,
// decodes DMX data packets, keeps the highest-priority active source per
// universe and emits merged 512-byte buffers.

const dgram = require('dgram');
const os = require('os');
const EventEmitter = require('events');

const SACN_PORT = 5568;
const ACN_ID = Buffer.from('ASC-E1.17\0\0\0', 'ascii');
const VECTOR_ROOT_DATA = 0x00000004;
const VECTOR_FRAMING_DATA = 0x00000002;
const SOURCE_TIMEOUT_MS = 2500;

function multicastAddress(universe) {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

function decodePacket(buf) {
  if (buf.length < 126) return null;
  if (buf.readUInt16BE(0) !== 0x0010) return null; // preamble size
  if (!buf.subarray(4, 16).equals(ACN_ID)) return null;
  if (buf.readUInt32BE(18) !== VECTOR_ROOT_DATA) return null;
  const cid = buf.subarray(22, 38).toString('hex');
  if (buf.readUInt32BE(40) !== VECTOR_FRAMING_DATA) return null; // E1.31 data
  const sourceName = buf.subarray(44, 108).toString('utf8').replace(/\0.*$/, '');
  const priority = buf[108];
  const sequence = buf[111];
  const options = buf[112];
  const universe = buf.readUInt16BE(113);
  // DMP layer
  if (buf[117] !== 0x02 || buf[118] !== 0xa1) return null;
  const propCount = buf.readUInt16BE(123);
  const startCode = buf[125];
  const data = buf.subarray(126, 126 + Math.min(512, Math.max(0, propCount - 1)));
  return {
    cid,
    sourceName,
    priority,
    sequence,
    universe,
    startCode,
    preview: !!(options & 0x80),
    terminated: !!(options & 0x40),
    data,
  };
}

class SacnReceiver extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.universes = new Map(); // universe → { sources: Map(cid→{priority,last,data}), merged: Uint8Array }
    this.iface = opts.iface || null;
    this.socket = null;
    this.packetCount = 0;
    this.lastPacketAt = 0;
    this._pruneTimer = null;
  }

  start() {
    if (this.socket) return;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (err) => this.emit('error', err));
    sock.on('message', (msg, rinfo) => this._onMessage(msg, rinfo));
    sock.bind(SACN_PORT, () => {
      try {
        sock.setMulticastTTL(1);
        sock.setBroadcast(true);
      } catch (_) {}
      for (const u of this.universes.keys()) this._join(u);
      this.emit('listening', { port: SACN_PORT, iface: this.iface });
    });
    this.socket = sock;
    this._pruneTimer = setInterval(() => this._prune(), 500);
  }

  stop() {
    if (!this.socket) return;
    clearInterval(this._pruneTimer);
    try {
      this.socket.close();
    } catch (_) {}
    this.socket = null;
  }

  listen(universe) {
    if (!this.universes.has(universe)) {
      this.universes.set(universe, { sources: new Map(), merged: new Uint8Array(512), active: false });
      if (this.socket) this._join(universe);
    }
  }

  unlisten(universe) {
    if (!this.universes.has(universe)) return;
    this.universes.delete(universe);
    if (this.socket) {
      try {
        this.socket.dropMembership(multicastAddress(universe), this.iface || undefined);
      } catch (_) {}
    }
  }

  _join(universe) {
    const group = multicastAddress(universe);
    const addrs = this.iface ? [this.iface] : interfaceAddresses();
    let joined = false;
    for (const a of addrs) {
      try {
        this.socket.addMembership(group, a);
        joined = true;
      } catch (_) {}
    }
    if (!joined) {
      try {
        this.socket.addMembership(group);
      } catch (e) {
        this.emit('error', new Error(`Could not join ${group}: ${e.message}`));
      }
    }
  }

  _onMessage(msg) {
    const pkt = decodePacket(msg);
    if (!pkt || pkt.startCode !== 0) return;
    const u = this.universes.get(pkt.universe);
    if (!u) return;
    this.packetCount++;
    this.lastPacketAt = Date.now();
    if (pkt.terminated) {
      u.sources.delete(pkt.cid);
    } else {
      let src = u.sources.get(pkt.cid);
      if (!src) {
        src = { data: new Uint8Array(512), priority: pkt.priority, name: pkt.sourceName, last: 0 };
        u.sources.set(pkt.cid, src);
        this.emit('source', { universe: pkt.universe, name: pkt.sourceName, priority: pkt.priority });
      }
      src.priority = pkt.priority;
      src.name = pkt.sourceName;
      src.last = this.lastPacketAt;
      src.data.fill(0);
      src.data.set(pkt.data.subarray(0, 512));
    }
    this._merge(pkt.universe, u);
  }

  _merge(universe, u) {
    // Highest priority wins; equal priorities are HTP merged.
    let top = -1;
    for (const s of u.sources.values()) if (s.priority > top) top = s.priority;
    const merged = u.merged;
    merged.fill(0);
    let any = false;
    for (const s of u.sources.values()) {
      if (s.priority !== top) continue;
      any = true;
      for (let i = 0; i < 512; i++) if (s.data[i] > merged[i]) merged[i] = s.data[i];
    }
    u.active = any;
    this.emit('dmx', { universe, data: merged, sources: u.sources.size });
  }

  _prune() {
    const now = Date.now();
    for (const [universe, u] of this.universes) {
      let changed = false;
      for (const [cid, s] of u.sources) {
        if (now - s.last > SOURCE_TIMEOUT_MS) {
          u.sources.delete(cid);
          changed = true;
        }
      }
      if (changed) this._merge(universe, u);
    }
  }

  status() {
    const out = [];
    for (const [universe, u] of this.universes) {
      out.push({
        universe,
        active: u.active,
        sources: [...u.sources.values()].map((s) => ({ name: s.name, priority: s.priority })),
      });
    }
    return { universes: out, packets: this.packetCount, lastPacketAt: this.lastPacketAt };
  }
}

function interfaceAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

// Build an E1.31 data packet (used by tests and the demo sender)
function encodePacket({ universe, data, priority = 100, sequence = 0, sourceName = 'LightBox Previs', cid }) {
  const buf = Buffer.alloc(638);
  buf.writeUInt16BE(0x0010, 0);
  buf.writeUInt16BE(0x0000, 2);
  ACN_ID.copy(buf, 4);
  buf.writeUInt16BE(0x7000 | 638 - 16, 16); // root flags+length
  buf.writeUInt32BE(VECTOR_ROOT_DATA, 18);
  (cid || Buffer.alloc(16, 0x42)).copy(buf, 22);
  buf.writeUInt16BE(0x7000 | 638 - 38, 38); // framing flags+length
  buf.writeUInt32BE(VECTOR_FRAMING_DATA, 40);
  buf.write(sourceName, 44, 63, 'utf8');
  buf[108] = priority;
  buf.writeUInt16BE(0, 109); // sync address
  buf[111] = sequence & 0xff;
  buf[112] = 0; // options
  buf.writeUInt16BE(universe, 113);
  buf.writeUInt16BE(0x7000 | 638 - 115, 115); // DMP flags+length
  buf[117] = 0x02;
  buf[118] = 0xa1;
  buf.writeUInt16BE(0, 119);
  buf.writeUInt16BE(1, 121);
  buf.writeUInt16BE(513, 123);
  buf[125] = 0; // start code
  Buffer.from(data).copy(buf, 126, 0, 512);
  return buf;
}

module.exports = { SacnReceiver, decodePacket, encodePacket, multicastAddress, SACN_PORT };
