'use strict';
// GDTF (General Device Type Format) reader — https://gdtf-share.com
// Produces a compact "profile" the renderer can drive from DMX.

const JSZip = require('jszip');
const { parseXML, child, children, attr, walk } = require('./xml');
const { cieToRgb } = require('./color');

function parseDmxValue(s, bytes) {
  // "1234/2" → value expressed at `bytes` resolution
  if (s === undefined || s === null || s === '' || s === 'None') return null;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*(s?)\s*$/.exec(String(s));
  if (!m) return null;
  const v = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (m[3] === 's') {
    // "shifting" semantic: value is for `b` bytes; scale by shifting
    return bytes >= b ? v * Math.pow(256, bytes - b) : Math.floor(v / Math.pow(256, b - bytes));
  }
  if (bytes === b) return v;
  // GDTF default is to scale proportionally (max maps to max)
  const maxFrom = Math.pow(256, b) - 1;
  const maxTo = Math.pow(256, bytes) - 1;
  return Math.round((v / maxFrom) * maxTo);
}

function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function parseOffsets(s) {
  if (!s || s === 'None') return [];
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => Number.isFinite(x) && x > 0);
}

function parseDescription(xmlText) {
  const doc = parseXML(xmlText);
  const gdtf = child(doc, 'GDTF');
  const ft = child(gdtf, 'FixtureType');
  if (!ft) throw new Error('GDTF: no FixtureType element');

  const profile = {
    name: attr(ft, 'Name', attr(ft, 'LongName', 'Unknown')),
    shortName: attr(ft, 'ShortName', ''),
    manufacturer: attr(ft, 'Manufacturer', ''),
    fixtureTypeId: attr(ft, 'FixtureTypeID', ''),
    beam: { beamAngle: 25, fieldAngle: 30, lumens: 10000, colorTemp: 6500, type: 'Spot' },
    pan: null,
    tilt: null,
    zoom: null,
    isMovingHead: false,
    wheels: {},
    modes: [],
  };

  // Beam geometry ---------------------------------------------------------
  const geometries = child(ft, 'Geometries');
  let beam = null;
  if (geometries) {
    walk(geometries, (n) => {
      if (!beam && n.name === 'Beam') beam = n;
    });
  }
  if (beam) {
    profile.beam = {
      beamAngle: num(attr(beam, 'BeamAngle'), 25),
      fieldAngle: num(attr(beam, 'FieldAngle'), num(attr(beam, 'BeamAngle'), 25) * 1.2),
      lumens: num(attr(beam, 'LuminousFlux'), 10000),
      colorTemp: num(attr(beam, 'ColorTemperature'), 6500),
      type: attr(beam, 'BeamType', 'Spot'),
      radius: num(attr(beam, 'BeamRadius'), 0.05),
    };
  }

  // Wheels ----------------------------------------------------------------
  for (const wheel of children(child(ft, 'Wheels'), 'Wheel')) {
    const slots = children(wheel, 'Slot').map((slot) => ({
      name: attr(slot, 'Name', ''),
      rgb: attr(slot, 'Color') ? cieToRgb(attr(slot, 'Color')) : null,
    }));
    profile.wheels[attr(wheel, 'Name', '')] = slots;
  }

  // DMX modes -------------------------------------------------------------
  for (const mode of children(child(ft, 'DMXModes'), 'DMXMode')) {
    const m = { name: attr(mode, 'Name', 'Default'), geometry: attr(mode, 'Geometry', ''), channels: [], footprint: 0 };
    for (const ch of children(child(mode, 'DMXChannels'), 'DMXChannel')) {
      const offsets = parseOffsets(attr(ch, 'Offset'));
      const bytes = Math.max(1, offsets.length);
      const max = Math.pow(256, bytes) - 1;
      const logical = children(ch, 'LogicalChannel');
      const channel = {
        offsets,
        bytes,
        max,
        geometry: attr(ch, 'Geometry', ''),
        attribute: logical.length ? attr(logical[0], 'Attribute', '') : '',
        default: 0,
        functions: [],
      };
      for (const lc of logical) {
        const lcAttr = attr(lc, 'Attribute', '');
        for (const fn of children(lc, 'ChannelFunction')) {
          const f = {
            name: attr(fn, 'Name', ''),
            attribute: attr(fn, 'Attribute', lcAttr),
            dmxFrom: parseDmxValue(attr(fn, 'DMXFrom', '0/1'), bytes) ?? 0,
            dmxTo: max,
            physFrom: num(attr(fn, 'PhysicalFrom'), 0),
            physTo: num(attr(fn, 'PhysicalTo'), 1),
            wheel: attr(fn, 'Wheel', null),
            sets: [],
          };
          const def = parseDmxValue(attr(fn, 'Default'), bytes);
          if (def !== null && channel.functions.length === 0) channel.default = def;
          for (const cs of children(fn, 'ChannelSet')) {
            f.sets.push({
              name: attr(cs, 'Name', ''),
              dmxFrom: parseDmxValue(attr(cs, 'DMXFrom', '0/1'), bytes) ?? 0,
              dmxTo: max,
              physFrom: attr(cs, 'PhysicalFrom') !== undefined ? num(attr(cs, 'PhysicalFrom')) : null,
              physTo: attr(cs, 'PhysicalTo') !== undefined ? num(attr(cs, 'PhysicalTo')) : null,
              wheelSlot: attr(cs, 'WheelSlotIndex') !== undefined ? parseInt(attr(cs, 'WheelSlotIndex'), 10) : null,
            });
          }
          f.sets.sort((a, b) => a.dmxFrom - b.dmxFrom);
          for (let i = 0; i < f.sets.length - 1; i++) f.sets[i].dmxTo = f.sets[i + 1].dmxFrom - 1;
          channel.functions.push(f);
        }
      }
      channel.functions.sort((a, b) => a.dmxFrom - b.dmxFrom);
      for (let i = 0; i < channel.functions.length - 1; i++) channel.functions[i].dmxTo = channel.functions[i + 1].dmxFrom - 1;
      const chDefault = parseDmxValue(attr(ch, 'Default'), bytes);
      if (chDefault !== null) channel.default = chDefault;

      // Capture physical ranges for the attributes the renderer cares about
      for (const f of channel.functions) {
        if (f.attribute === 'Pan' && !profile.pan) profile.pan = { from: f.physFrom, to: f.physTo };
        if (f.attribute === 'Tilt' && !profile.tilt) profile.tilt = { from: f.physFrom, to: f.physTo };
        if (f.attribute === 'Zoom' && !profile.zoom) profile.zoom = { from: f.physFrom, to: f.physTo };
      }
      if (offsets.length) m.footprint = Math.max(m.footprint, ...offsets);
      m.channels.push(channel);
    }
    profile.modes.push(m);
  }
  profile.isMovingHead = !!(profile.pan && profile.tilt);
  if (profile.zoom && profile.zoom.from === profile.zoom.to) profile.zoom = null;
  return profile;
}

async function parseGdtfBuffer(buf) {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('description.xml') || zip.file(/description\.xml$/i)[0];
  if (!entry) throw new Error('GDTF archive has no description.xml');
  const xml = await entry.async('string');
  return parseDescription(xml);
}

// Runtime helpers --------------------------------------------------------
function readChannelRaw(channel, dmx, base) {
  // dmx: Uint8Array(512) for the fixture's universe; base: 0-based start index
  let v = 0;
  for (const off of channel.offsets) {
    const idx = base + off - 1;
    v = v * 256 + (idx >= 0 && idx < 512 ? dmx[idx] : 0);
  }
  return v;
}

function functionFor(channel, raw) {
  const fns = channel.functions;
  for (let i = fns.length - 1; i >= 0; i--) if (raw >= fns[i].dmxFrom) return fns[i];
  return fns[0] || null;
}

function physical(fn, raw) {
  const span = fn.dmxTo - fn.dmxFrom;
  const t = span > 0 ? (raw - fn.dmxFrom) / span : 0;
  return fn.physFrom + (fn.physTo - fn.physFrom) * Math.min(1, Math.max(0, t));
}

module.exports = { parseDescription, parseGdtfBuffer, parseDmxValue, readChannelRaw, functionFor, physical };
