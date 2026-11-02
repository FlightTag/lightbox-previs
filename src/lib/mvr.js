'use strict';
// MVR (My Virtual Rig) reader — https://gdtf-share.com / DIN SPEC 15800
// Extracts fixtures (with GDTF profile + mode + patch + 3D placement),
// trusses and scene objects. Coordinates are kept in MVR convention
// (millimetres, Z-up, right-handed); the renderer converts to Y-up metres.

const JSZip = require('jszip');
const { parseXML, child, children, attr, text } = require('./xml');
const { parseDescription } = require('./gdtf');
const { cieToRgb } = require('./color');

const IDENTITY = { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1], o: [0, 0, 0] };

function parseMatrix(s) {
  if (!s) return IDENTITY;
  const rows = [...String(s).matchAll(/\{([^}]*)\}/g)].map((m) => m[1].split(',').map((x) => parseFloat(x.trim())));
  if (rows.length < 4 || rows.some((r) => r.length < 3 || r.some((x) => !Number.isFinite(x)))) return IDENTITY;
  return { u: rows[0].slice(0, 3), v: rows[1].slice(0, 3), w: rows[2].slice(0, 3), o: rows[3].slice(0, 3) };
}

// Apply parent * child, where a matrix maps local → parent coordinates:
// world = o + x*u + y*v + z*w
function compose(parent, local) {
  const xf = (p) => [
    parent.o[0] + p[0] * parent.u[0] + p[1] * parent.v[0] + p[2] * parent.w[0],
    parent.o[1] + p[0] * parent.u[1] + p[1] * parent.v[1] + p[2] * parent.w[1],
    parent.o[2] + p[0] * parent.u[2] + p[1] * parent.v[2] + p[2] * parent.w[2],
  ];
  const rot = (d) => [
    d[0] * parent.u[0] + d[1] * parent.v[0] + d[2] * parent.w[0],
    d[0] * parent.u[1] + d[1] * parent.v[1] + d[2] * parent.w[1],
    d[0] * parent.u[2] + d[1] * parent.v[2] + d[2] * parent.w[2],
  ];
  return { u: rot(local.u), v: rot(local.v), w: rot(local.w), o: xf(local.o) };
}

function parseAddress(addrNode) {
  // MVR Address = absolute DMX address, universes starting at 0:
  // universe*512 + channel, so 1..512 → U1, 513..1024 → U2 ...
  const abs = parseInt(text(addrNode), 10);
  if (!Number.isFinite(abs) || abs < 1) return null;
  return { abs, universe: Math.floor((abs - 1) / 512) + 1, address: ((abs - 1) % 512) + 1, break: parseInt(attr(addrNode, 'break', '0'), 10) };
}

function parseSceneXML(xmlText) {
  const doc = parseXML(xmlText);
  const gsd = child(doc, 'GeneralSceneDescription');
  if (!gsd) throw new Error('MVR: no GeneralSceneDescription');
  const scene = child(gsd, 'Scene');
  const result = {
    version: `${attr(gsd, 'verMajor', '?')}.${attr(gsd, 'verMinor', '?')}`,
    provider: attr(gsd, 'provider', ''),
    layers: [],
    fixtures: [],
    trusses: [],
    sceneObjects: [],
    focusPoints: [],
    gdtfSpecs: new Set(),
  };

  function visit(node, parentMatrix, layerName) {
    for (const el of children(node)) {
      const m = compose(parentMatrix, parseMatrix(text(child(el, 'Matrix'))));
      const base = { name: attr(el, 'name', ''), uuid: attr(el, 'uuid', ''), layer: layerName, matrix: m };
      switch (el.name) {
        case 'Fixture': {
          const addrs = children(child(el, 'Addresses'), 'Address').map(parseAddress).filter(Boolean);
          const spec = text(child(el, 'GDTFSpec'));
          if (spec) result.gdtfSpecs.add(spec);
          result.fixtures.push({
            ...base,
            fixtureId: text(child(el, 'FixtureID')) || attr(el, 'fixtureId', ''),
            unitNumber: text(child(el, 'UnitNumber')),
            gdtfSpec: spec,
            gdtfMode: text(child(el, 'GDTFMode')),
            focus: text(child(el, 'Focus')),
            color: text(child(el, 'Color')) ? cieToRgb(text(child(el, 'Color'))) : null,
            addresses: addrs,
            universe: addrs[0] ? addrs[0].universe : null,
            address: addrs[0] ? addrs[0].address : null,
            classing: text(child(el, 'Classing')),
          });
          break;
        }
        case 'Truss':
          result.trusses.push({ ...base, geometries: geometriesOf(el) });
          break;
        case 'SceneObject':
        case 'Support':
        case 'VideoScreen':
        case 'Projector':
          result.sceneObjects.push({ ...base, type: el.name, geometries: geometriesOf(el) });
          break;
        case 'FocusPoint':
          result.focusPoints.push(base);
          break;
        default:
          break;
      }
      const cl = child(el, 'ChildList');
      if (cl) visit(cl, m, layerName);
    }
  }

  for (const layer of children(child(scene, 'Layers'), 'Layer')) {
    const name = attr(layer, 'name', '');
    result.layers.push({ name, uuid: attr(layer, 'uuid', '') });
    const m = parseMatrix(text(child(layer, 'Matrix')));
    const cl = child(layer, 'ChildList');
    if (cl) visit(cl, m, name);
  }
  result.gdtfSpecs = [...result.gdtfSpecs];
  return result;
}

function geometriesOf(el) {
  const out = [];
  const g = child(el, 'Geometries');
  for (const geo of children(g)) {
    out.push({
      type: geo.name,
      file: attr(geo, 'fileName', ''),
      matrix: parseMatrix(text(child(geo, 'Matrix'))),
    });
  }
  return out;
}

async function parseMvrBuffer(buf) {
  const zip = await JSZip.loadAsync(buf);
  const gsdEntry = zip.file('GeneralSceneDescription.xml') || zip.file(/GeneralSceneDescription\.xml$/i)[0];
  if (!gsdEntry) throw new Error('MVR archive has no GeneralSceneDescription.xml');
  const scene = parseSceneXML(await gsdEntry.async('string'));

  // Load every GDTF referenced by a fixture (they ship inside the MVR zip)
  const profiles = {};
  const missing = [];
  for (const spec of scene.gdtfSpecs) {
    const entry = zip.file(spec) || zip.file(new RegExp(escapeRe(spec) + '$', 'i'))[0];
    if (!entry) {
      missing.push(spec);
      continue;
    }
    try {
      const gdtfZip = await JSZip.loadAsync(await entry.async('nodebuffer'));
      const desc = gdtfZip.file('description.xml');
      if (desc) profiles[spec] = parseDescription(await desc.async('string'));
      else missing.push(spec);
    } catch (e) {
      missing.push(`${spec} (${e.message})`);
    }
  }
  return { scene, profiles, missing };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { parseMatrix, compose, parseSceneXML, parseMvrBuffer, parseAddress, IDENTITY };
