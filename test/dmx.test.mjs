import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildRuntime, findMode, applyDmx, tick, outputLevel } from '../src/renderer/dmx.js';

const require = createRequire(import.meta.url);
const { demoRig, demoFrame } = require('../src/lib/demo');

test('dmx runtime: demo spot follows the demo frame', () => {
  const rig = demoRig();
  const f = rig.scene.fixtures[0];
  const p = rig.profiles[f.gdtfSpec];
  const rt = buildRuntime(f, p, findMode(p, f.gdtfMode));
  assert.equal(rt.channels.length, 10);
  assert.equal(rt.hasColor, true);
  // defaults applied: pan/tilt centred, shutter open
  assert.ok(Math.abs(rt.state.pan) < 0.1);
  assert.equal(rt.target.shutter, 1);

  const frame = demoFrame(2);
  applyDmx(rt, frame, 2);
  const panRaw = frame[0] * 256 + frame[1];
  const expectedPan = -270 + (540 * panRaw) / 65535;
  assert.ok(Math.abs(rt.target.pan - expectedPan) < 0.01);
  assert.ok(rt.target.dimmer > 0 && rt.target.dimmer <= 1);
  assert.ok(rt.target.zoom >= 8 && rt.target.zoom <= 45);
  assert.equal(rt.target.shutter, 1);

  // smoothing: state approaches target without overshoot
  for (let i = 0; i < 200; i++) tick(rt, 1 / 60);
  assert.ok(Math.abs(rt.state.pan - rt.target.pan) < 0.01);
  assert.ok(Math.abs(rt.state.dimmer - rt.target.dimmer) < 0.01);
  assert.equal(outputLevel(rt, 0), rt.state.dimmer);
});

test('dmx runtime: shutter closed and strobe', () => {
  const rig = demoRig();
  const f = rig.scene.fixtures[0];
  const p = rig.profiles[f.gdtfSpec];
  const rt = buildRuntime(f, p, findMode(p, f.gdtfMode));
  const d = new Uint8Array(512);
  d[4] = 255; // dimmer full
  d[9] = 0; // shutter closed
  applyDmx(rt, d, 0);
  tick(rt, 1);
  assert.equal(outputLevel(rt, 0), 0);
  d[9] = 200; // strobe
  applyDmx(rt, d, 0);
  tick(rt, 1);
  assert.equal(rt.state.shutter, 2);
  assert.ok(rt.state.strobeHz > 1);
});

test('dmx runtime: second-universe fixture reads its own universe', () => {
  const rig = demoRig();
  const f = { ...rig.scene.fixtures[0], universe: 3, address: 100 };
  const p = rig.profiles[f.gdtfSpec];
  const rt = buildRuntime(f, p, findMode(p, f.gdtfMode));
  assert.equal(rt.universe, 3);
  assert.equal(rt.base, 99);
  const d = new Uint8Array(512);
  d[99 + 4] = 128;
  applyDmx(rt, d, 0);
  assert.ok(Math.abs(rt.target.dimmer - 128 / 255) < 1e-6);
});

test('dmx runtime: subtractive CMY and colour wheel', () => {
  const profile = {
    name: 'CMY',
    beam: { beamAngle: 20, fieldAngle: 25, lumens: 1, colorTemp: 6500 },
    pan: null, tilt: null, zoom: null, isMovingHead: false,
    wheels: { Color1: [{ name: 'Open', rgb: [1, 1, 1] }, { name: 'Red', rgb: [1, 0, 0] }] },
    modes: [{ name: 'm', footprint: 5, channels: [
      ch(1, 'Dimmer', 0, 1),
      ch(2, 'ColorSub_C', 0, 1), ch(3, 'ColorSub_M', 0, 1), ch(4, 'ColorSub_Y', 0, 1),
      { offsets: [5], bytes: 1, max: 255, attribute: 'Color1', default: 0, functions: [{ attribute: 'Color1', dmxFrom: 0, dmxTo: 255, physFrom: 0, physTo: 1, wheel: 'Color1', sets: [
        { name: 'Open', dmxFrom: 0, dmxTo: 9, wheelSlot: 1 }, { name: 'Red', dmxFrom: 10, dmxTo: 255, wheelSlot: 2 } ] }] },
    ] }],
  };
  const rt = buildRuntime({ universe: 1, address: 1, matrix: {} }, profile, profile.modes[0]);
  const d = new Uint8Array(512);
  d[0] = 255; d[1] = 255; // full cyan → no red
  applyDmx(rt, d, 0);
  assert.deepEqual(rt.target.rgb.map((v) => +v.toFixed(2)), [0, 1, 1]);
  d[1] = 0; d[4] = 20; // wheel red
  applyDmx(rt, d, 0);
  assert.deepEqual(rt.target.rgb.map((v) => +v.toFixed(2)), [1, 0, 0]);
});

function ch(off, attribute, from, to) {
  return { offsets: [off], bytes: 1, max: 255, attribute, default: 0, functions: [{ attribute, dmxFrom: 0, dmxTo: 255, physFrom: from, physTo: to, sets: [] }] };
}
