'use strict';
// Built-in demo rig and demo DMX generator so the visualiser can be seen
// working before a console is connected. Profiles use the same shape as the
// GDTF parser's output.

function fn(attribute, physFrom, physTo, max, extra = {}) {
  return { name: attribute, attribute, dmxFrom: 0, dmxTo: max, physFrom, physTo, wheel: null, sets: [], ...extra };
}
function ch(offsets, attribute, physFrom, physTo, def = 0, functions = null) {
  const bytes = offsets.length;
  const max = Math.pow(256, bytes) - 1;
  return {
    offsets,
    bytes,
    max,
    geometry: 'Head',
    attribute,
    default: def,
    functions: functions || [fn(attribute, physFrom, physTo, max)],
  };
}

const SPOT = {
  name: 'LightBox Demo Spot',
  shortName: 'DemoSpot',
  manufacturer: 'LightBox',
  beam: { beamAngle: 15, fieldAngle: 20, lumens: 20000, colorTemp: 6500, type: 'Spot', radius: 0.08 },
  pan: { from: -270, to: 270 },
  tilt: { from: -135, to: 135 },
  zoom: { from: 8, to: 45 },
  isMovingHead: true,
  wheels: {},
  modes: [
    {
      name: '12ch',
      geometry: 'Base',
      footprint: 12,
      channels: [
        ch([1, 2], 'Pan', -270, 270, 32768),
        ch([3, 4], 'Tilt', -135, 135, 32768),
        ch([5], 'Dimmer', 0, 1, 0),
        ch([6], 'ColorAdd_R', 0, 1, 255),
        ch([7], 'ColorAdd_G', 0, 1, 255),
        ch([8], 'ColorAdd_B', 0, 1, 255),
        ch([9], 'Zoom', 8, 45, 100),
        ch([10], 'Shutter1', 0, 1, 12, [
          { ...fn('Shutter1', 0, 0, 255), name: 'Closed', dmxFrom: 0, dmxTo: 7 },
          { ...fn('Shutter1', 1, 1, 255), name: 'Open', dmxFrom: 8, dmxTo: 15 },
          { ...fn('Shutter1Strobe', 1, 25, 255), name: 'Strobe', dmxFrom: 16, dmxTo: 255 },
        ]),
        ch([11], 'Gobo1', 0, 1, 0),
        ch([12], 'Focus1', 0, 1, 128),
      ],
    },
  ],
};

const WASH = {
  name: 'LightBox Demo Wash',
  shortName: 'DemoWash',
  manufacturer: 'LightBox',
  beam: { beamAngle: 30, fieldAngle: 45, lumens: 12000, colorTemp: 5600, type: 'Wash', radius: 0.12 },
  pan: null,
  tilt: null,
  zoom: { from: 15, to: 60 },
  isMovingHead: false,
  wheels: {},
  modes: [
    {
      name: '5ch',
      geometry: 'Body',
      footprint: 5,
      channels: [
        ch([1], 'Dimmer', 0, 1, 0),
        ch([2], 'ColorAdd_R', 0, 1, 255),
        ch([3], 'ColorAdd_G', 0, 1, 255),
        ch([4], 'ColorAdd_B', 0, 1, 255),
        ch([5], 'Zoom', 15, 60, 128),
      ],
    },
  ],
};

const BLINDER = {
  name: 'LightBox Demo Blinder',
  shortName: 'Blinder',
  manufacturer: 'LightBox',
  beam: { beamAngle: 60, fieldAngle: 80, lumens: 8000, colorTemp: 3200, type: 'Wash', radius: 0.1 },
  pan: null,
  tilt: null,
  zoom: null,
  isMovingHead: false,
  wheels: {},
  modes: [{ name: '1ch', geometry: 'Body', footprint: 1, channels: [ch([1], 'Dimmer', 0, 1, 0)] }],
};

// Matrices in MVR convention (mm, Z-up). Hanging = rotated 180° about X.
const HANG = { u: [1, 0, 0], v: [0, -1, 0], w: [0, 0, -1] };
const UPRIGHT = { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };

function demoRig() {
  const fixtures = [];
  const trusses = [];
  let id = 1;
  let addr = 1;
  const trussY = [-6000, -1000, 4500]; // upstage → downstage
  const trussZ = [7500, 7000, 6500];
  trussY.forEach((y, t) => {
    trusses.push({ name: `Truss ${t + 1}`, uuid: `truss-${t}`, layer: 'Rig', matrix: { ...UPRIGHT, o: [0, y, trussZ[t]] }, length: 12000, size: 290 });
    for (let i = 0; i < 8; i++) {
      const x = -5250 + i * 1500;
      fixtures.push({
        name: `Spot ${id}`,
        uuid: `spot-${id}`,
        fixtureId: String(id),
        layer: 'Rig',
        gdtfSpec: 'demo-spot',
        gdtfMode: '12ch',
        universe: 1,
        address: addr,
        addresses: [{ universe: 1, address: addr, abs: addr, break: 0 }],
        color: null,
        matrix: { ...HANG, o: [x, y, trussZ[t] - 250] },
      });
      id++;
      addr += 12;
    }
  });
  // Upstage floor washes, pointing up at the back wall
  for (let i = 0; i < 8; i++) {
    const x = -5250 + i * 1500;
    fixtures.push({
      name: `Wash ${id}`,
      uuid: `wash-${id}`,
      fixtureId: String(id),
      layer: 'Floor',
      gdtfSpec: 'demo-wash',
      gdtfMode: '5ch',
      universe: 1,
      address: addr,
      addresses: [{ universe: 1, address: addr, abs: addr, break: 0 }],
      color: null,
      matrix: { u: [1, 0, 0], v: [0, 0.94, -0.342], w: [0, 0.342, 0.94], o: [x, -7500, 300] }, // beam (+Z) tilted ~20° downstage
    });
    id++;
    addr += 5;
  }
  // Blinders on the downstage truss, aimed at the audience
  for (let i = 0; i < 4; i++) {
    const x = -4500 + i * 3000;
    fixtures.push({
      name: `Blinder ${id}`,
      uuid: `blinder-${id}`,
      fixtureId: String(id),
      layer: 'Rig',
      gdtfSpec: 'demo-blinder',
      gdtfMode: '1ch',
      universe: 1,
      address: addr,
      addresses: [{ universe: 1, address: addr, abs: addr, break: 0 }],
      color: null,
      matrix: { u: [1, 0, 0], v: [0, 0.5, 0.866], w: [0, 0.866, -0.5], o: [x, 4500, 6200] },
    });
    id++;
    addr += 1;
  }
  return {
    scene: { version: 'demo', provider: 'LightBox Previs', layers: [{ name: 'Rig' }, { name: 'Floor' }], fixtures, trusses, sceneObjects: [], focusPoints: [] },
    profiles: { 'demo-spot': SPOT, 'demo-wash': WASH, 'demo-blinder': BLINDER },
    missing: [],
    name: 'Demo rig (24 spots, 8 washes, 4 blinders)',
  };
}

// Generate universe 1 for the demo rig at time t (seconds)
function demoFrame(t) {
  const d = new Uint8Array(512);
  const w16 = (i, v) => {
    const x = Math.max(0, Math.min(65535, Math.round(v)));
    d[i] = x >> 8;
    d[i + 1] = x & 255;
  };
  const w8 = (i, v) => (d[i] = Math.max(0, Math.min(255, Math.round(v))));
  let a = 0;
  for (let n = 0; n < 24; n++) {
    const truss = Math.floor(n / 8);
    const i = n % 8;
    const phase = t * 0.6 + n * 0.35;
    w16(a + 0, 32768 + Math.sin(phase) * 7000);
    w16(a + 2, 32768 + Math.cos(t * 0.45 + i * 0.5 + truss) * 9000);
    w8(a + 4, 255 * (0.55 + 0.45 * Math.sin(t * 1.3 + n * 0.5)));
    const hue = (t * 0.08 + truss * 0.33 + i * 0.02) % 1;
    const [r, g, b] = hsv(hue, 0.85, 1);
    w8(a + 5, r * 255);
    w8(a + 6, g * 255);
    w8(a + 7, b * 255);
    w8(a + 8, 70 + 50 * Math.sin(t * 0.25 + n));
    w8(a + 9, 12); // open
    w8(a + 10, 0);
    w8(a + 11, 128);
    a += 12;
  }
  for (let n = 0; n < 8; n++) {
    const [r, g, b] = hsv((t * 0.05 + n * 0.1) % 1, 0.9, 1);
    w8(a + 0, 200);
    w8(a + 1, r * 255);
    w8(a + 2, g * 255);
    w8(a + 3, b * 255);
    w8(a + 4, 160);
    a += 5;
  }
  for (let n = 0; n < 4; n++) {
    const beat = (t * 0.5) % 8;
    w8(a, beat > 7 ? 255 : 0);
    a += 1;
  }
  return d;
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const u = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, u, p];
    case 1: return [q, v, p];
    case 2: return [p, v, u];
    case 3: return [p, q, v];
    case 4: return [u, p, v];
    default: return [v, p, q];
  }
}

module.exports = { demoRig, demoFrame, SPOT, WASH, BLINDER };
