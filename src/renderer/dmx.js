// DMX → fixture state mapping (renderer side, ES module).
// Works on the profile shape produced by src/lib/gdtf.js.

const COLOR_ADD = { ColorAdd_R: 0, ColorAdd_G: 1, ColorAdd_B: 2, ColorRGB_Red: 0, ColorRGB_Green: 1, ColorRGB_Blue: 2 };
const COLOR_SUB = { ColorSub_C: 0, ColorSub_M: 1, ColorSub_Y: 2 };

export function findMode(profile, modeName) {
  if (!profile || !profile.modes.length) return null;
  return profile.modes.find((m) => m.name === modeName) || profile.modes[0];
}

export function buildRuntime(fixture, profile, mode) {
  const rt = {
    fixture,
    profile,
    mode,
    universe: fixture.universe || 1,
    base: (fixture.address || 1) - 1,
    channels: mode ? mode.channels.filter((c) => c.offsets.length) : [],
    hasColor: false,
    hasDimmer: false,
    state: defaultState(profile),
    target: defaultState(profile),
  };
  for (const c of rt.channels) {
    const a = c.attribute;
    if (a in COLOR_ADD || a in COLOR_SUB || a === 'ColorAdd_W' || a === 'ColorAdd_WW' || a === 'ColorAdd_CW' || /^Color\d$/.test(a)) rt.hasColor = true;
    if (a === 'Dimmer') rt.hasDimmer = true;
  }
  // Apply defaults so an unpatched fixture looks sensible
  const defaults = new Uint8Array(512);
  for (const c of rt.channels) {
    let v = c.default;
    for (let i = c.offsets.length - 1; i >= 0; i--) {
      const idx = rt.base + c.offsets[i] - 1;
      if (idx >= 0 && idx < 512) defaults[idx] = v & 255;
      v = Math.floor(v / 256);
    }
  }
  applyDmx(rt, defaults, 0);
  rt.state = { ...rt.target, rgb: [...rt.target.rgb] };
  return rt;
}

function defaultState(profile) {
  return {
    dimmer: 0,
    pan: 0,
    tilt: 0,
    zoom: profile ? profile.beam.fieldAngle : 25,
    rgb: [1, 1, 1],
    shutter: 1, // 0 closed, 1 open, >1 strobe Hz
    strobeHz: 0,
    gobo: 0,
    iris: 1,
  };
}

function raw(channel, dmx, base) {
  let v = 0;
  for (const off of channel.offsets) {
    const idx = base + off - 1;
    v = v * 256 + (idx >= 0 && idx < 512 ? dmx[idx] : 0);
  }
  return v;
}
function fnFor(channel, r) {
  const fns = channel.functions;
  for (let i = fns.length - 1; i >= 0; i--) if (r >= fns[i].dmxFrom) return fns[i];
  return fns[0] || null;
}
function phys(fn, r) {
  const span = fn.dmxTo - fn.dmxFrom;
  const t = span > 0 ? (r - fn.dmxFrom) / span : 0;
  return fn.physFrom + (fn.physTo - fn.physFrom) * Math.min(1, Math.max(0, t));
}

// Fill rt.target from a 512-byte universe buffer
export function applyDmx(rt, dmx, time) {
  const t = rt.target;
  const p = rt.profile;
  let add = null;
  let sub = null;
  let white = 0;
  let wheelRgb = null;
  let dimmerSeen = false;
  for (const c of rt.channels) {
    const r = raw(c, dmx, rt.base);
    const fn = fnFor(c, r);
    if (!fn) continue;
    const a = fn.attribute || c.attribute;
    const norm = r / c.max;
    switch (a) {
      case 'Dimmer':
        t.dimmer = c.functions.length > 1 ? Math.min(1, Math.max(0, phys(fn, r))) : norm;
        dimmerSeen = true;
        break;
      case 'Pan':
        t.pan = phys(fn, r);
        break;
      case 'Tilt':
        t.tilt = phys(fn, r);
        break;
      case 'Zoom':
        t.zoom = phys(fn, r) || t.zoom;
        break;
      case 'Iris':
        t.iris = Math.min(1, Math.max(0.05, phys(fn, r) || norm));
        break;
      case 'Shutter1':
      case 'Shutter1Strobe':
      case 'Shutter1StrobePulse':
      case 'Shutter1StrobeRandom':
      case 'StrobeModeShutter':
      case 'StrobeFrequency': {
        const n = (fn.name || '').toLowerCase();
        if (a === 'Shutter1' && (n.includes('closed') || n.includes('close') || fn.physTo === 0)) t.shutter = 0;
        else if (a === 'Shutter1' || n.includes('open')) t.shutter = 1;
        else {
          const hz = phys(fn, r);
          t.shutter = 2;
          t.strobeHz = hz > 0 ? Math.min(30, hz) : 1 + 24 * norm;
        }
        break;
      }
      case 'Gobo1':
        t.gobo = norm;
        break;
      default:
        break;
    }
    if (a in COLOR_ADD) {
      add ||= [0, 0, 0];
      add[COLOR_ADD[a]] = Math.max(add[COLOR_ADD[a]], norm);
    } else if (a in COLOR_SUB) {
      sub ||= [0, 0, 0];
      sub[COLOR_SUB[a]] = norm;
    } else if (a === 'ColorAdd_W' || a === 'ColorAdd_WW' || a === 'ColorAdd_CW') white = Math.max(white, norm);
    else if (/^Color\d$/.test(a) && fn.wheel && p.wheels[fn.wheel]) {
      const set = fn.sets.length ? fn.sets.find((s) => r >= s.dmxFrom && r <= s.dmxTo) : null;
      const slotIdx = set && set.wheelSlot ? set.wheelSlot - 1 : 0;
      const slot = p.wheels[fn.wheel][slotIdx];
      if (slot && slot.rgb) wheelRgb = slot.rgb;
    }
  }
  if (!dimmerSeen) t.dimmer = rt.hasDimmer ? t.dimmer : 1;
  let rgb;
  if (add) {
    rgb = [add[0] + white, add[1] + white, add[2] + white].map((v) => Math.min(1, v));
    if (!add.some((v) => v > 0) && white === 0) rgb = [0, 0, 0];
  } else if (sub) {
    rgb = [1 - sub[0], 1 - sub[1], 1 - sub[2]];
  } else {
    rgb = [1, 1, 1];
  }
  if (wheelRgb) rgb = [rgb[0] * wheelRgb[0], rgb[1] * wheelRgb[1], rgb[2] * wheelRgb[2]];
  // additive mixers at zero output nothing (black)
  t.rgb = rgb;
  t.time = time;
}

// Advance smoothed state toward target (mechanical speed limits)
export function tick(rt, dt) {
  const s = rt.state;
  const t = rt.target;
  const PAN_SPEED = 270; // deg/s
  const TILT_SPEED = 220;
  s.pan = approach(s.pan, t.pan, PAN_SPEED * dt);
  s.tilt = approach(s.tilt, t.tilt, TILT_SPEED * dt);
  s.zoom = approach(s.zoom, t.zoom, 60 * dt);
  s.iris = approach(s.iris, t.iris, 3 * dt);
  const k = 1 - Math.exp(-dt * 18);
  s.dimmer += (t.dimmer - s.dimmer) * k;
  for (let i = 0; i < 3; i++) s.rgb[i] += (t.rgb[i] - s.rgb[i]) * k;
  s.shutter = t.shutter;
  s.strobeHz = t.strobeHz;
  s.gobo = t.gobo;
}

function approach(cur, target, maxStep) {
  const d = target - cur;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

// Effective output intensity including shutter/strobe at time `now` (s)
export function outputLevel(rt, now) {
  const s = rt.state;
  if (s.shutter === 0) return 0;
  if (s.shutter === 2) return (now * s.strobeHz) % 1 < 0.15 ? s.dimmer : 0;
  return s.dimmer;
}
