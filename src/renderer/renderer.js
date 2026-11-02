import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRuntime, findMode, applyDmx, tick } from './dmx.js';
import { FixtureModel, trussMesh } from './fixture.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#gl');
const viewport = $('#viewport');

// Scene ------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080c);
scene.fog = new THREE.FogExp2(0x07080c, 0.012);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
camera.position.set(9, 6, -22);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 3, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0x394152, 0x0a0b0f, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 0.25);
key.position.set(5, 12, -8);
scene.add(key);

const FLOOR_Y = 0;
const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.95, metalness: 0.0 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = FLOOR_Y;
scene.add(floor);
const stage = new THREE.Mesh(new THREE.BoxGeometry(16, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x33363f, roughness: 0.9 }));
stage.position.set(0, 0.01, 0.5);
scene.add(stage);
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 1 }));
backWall.position.set(0, 6, 9);
backWall.rotation.y = Math.PI;
scene.add(backWall);
const grid = new THREE.GridHelper(60, 60, 0x2c3140, 0x1b1f28);
grid.position.y = 0.002;
scene.add(grid);

const rigGroup = new THREE.Group();
scene.add(rigGroup);

// State ------------------------------------------------------------------
let rig = null;
let models = []; // FixtureModel[]
const universes = new Map(); // universe → Uint8Array(512)
let selected = null;
let floorLightOn = true;
let haze = 0.55;
let lastT = performance.now();
let frames = 0;
let fpsT = performance.now();
let fps = 0;

function log(msg) {
  const el = $('#log');
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  el.prepend(line);
  while (el.children.length > 60) el.lastChild.remove();
}

function clearRig() {
  for (const m of models) rigGroup.remove(m.root);
  while (rigGroup.children.length) rigGroup.remove(rigGroup.children[0]);
  models = [];
  selected = null;
}

function loadRig(r) {
  rig = r;
  clearRig();
  const missing = new Set();
  for (const f of r.scene.fixtures) {
    const profile = r.profiles[f.gdtfSpec] || null;
    if (!profile) missing.add(f.gdtfSpec || '(no GDTF)');
    const mode = findMode(profile, f.gdtfMode);
    const rt = buildRuntime(f, profile || genericProfile(), mode || (profile ? profile.modes[0] : genericProfile().modes[0]));
    const model = new FixtureModel(rt);
    model.beamMat.uniforms.uHaze.value = haze;
    rigGroup.add(model.root);
    models.push(model);
    if (!universes.has(rt.universe)) universes.set(rt.universe, new Uint8Array(512));
  }
  for (const t of r.scene.trusses) rigGroup.add(trussMesh(t));
  $('#rigName').textContent = `${r.name || 'rig'} · ${r.scene.fixtures.length} fixtures`;
  const warn = $('#rigWarn');
  const problems = [...(r.missing || []), ...missing];
  warn.hidden = problems.length === 0;
  warn.textContent = problems.length ? `No GDTF for: ${[...new Set(problems)].join(', ')} — shown as generic fixtures` : '';
  renderPatch();
  frameRig();
  log(`Loaded ${r.name || 'rig'}: ${r.scene.fixtures.length} fixtures, ${r.scene.trusses.length} trusses`);
}

function genericProfile() {
  return {
    name: 'Generic',
    beam: { beamAngle: 20, fieldAngle: 25, lumens: 10000, colorTemp: 5600, type: 'Spot' },
    pan: null,
    tilt: null,
    zoom: null,
    isMovingHead: false,
    wheels: {},
    modes: [{ name: '1ch', footprint: 1, channels: [{ offsets: [1], bytes: 1, max: 255, attribute: 'Dimmer', default: 0, functions: [{ attribute: 'Dimmer', dmxFrom: 0, dmxTo: 255, physFrom: 0, physTo: 1, sets: [] }] }] }],
  };
}

function frameRig() {
  if (!models.length) return;
  const box = new THREE.Box3();
  for (const m of models) box.expandByObject(m.root);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(c).setY(Math.max(1.5, c.y * 0.5));
  camera.position.set(c.x + size * 0.45, c.y * 0.8 + 3, c.z - Math.max(14, size * 0.9));
  controls.update();
}

// Patch table ------------------------------------------------------------
function renderPatch() {
  const tb = $('#patch tbody');
  tb.innerHTML = '';
  models.forEach((m, i) => {
    const f = m.rt.fixture;
    const tr = document.createElement('tr');
    tr.dataset.i = i;
    tr.innerHTML = `<td class="mono">${esc(f.fixtureId || '')}</td><td title="${esc(m.rt.profile.name)}">${esc(f.name || m.rt.profile.name)}</td><td class="muted">${esc(m.rt.mode ? m.rt.mode.name : '')}</td><td class="mono">${f.universe || '?'}.${f.address || '?'}</td><td><span class="bar"><i></i></span></td>`;
    tr.addEventListener('click', () => select(i));
    tr.addEventListener('dblclick', () => flyTo(i));
    tb.appendChild(tr);
  });
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function select(i) {
  if (selected !== null && models[selected]) models[selected].setSelected(false);
  selected = i;
  if (models[i]) models[i].setSelected(true);
  document.querySelectorAll('#patch tbody tr').forEach((tr) => tr.classList.toggle('sel', Number(tr.dataset.i) === i));
}
function flyTo(i) {
  const m = models[i];
  if (!m) return;
  const p = new THREE.Vector3().setFromMatrixPosition(m.root.matrixWorld);
  controls.target.copy(p);
  camera.position.copy(p).add(new THREE.Vector3(3, -1, -4));
}
let patchTimer = 0;
function refreshPatchLevels() {
  const rows = $('#patch tbody').children;
  for (let i = 0; i < rows.length && i < models.length; i++) {
    const bar = rows[i].querySelector('.bar i');
    if (bar) bar.style.width = `${Math.round(models[i].rt.state.dimmer * 100)}%`;
  }
}

// Picking ----------------------------------------------------------------
const ray = new THREE.Raycaster();
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const down = { x: e.clientX, y: e.clientY };
  const up = (ev) => {
    canvas.removeEventListener('pointerup', up);
    if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(models.map((m) => m.root), true).filter((h) => h.object.type === 'Mesh' && !(h.object.material && h.object.material.isShaderMaterial));
    if (!hits.length) return;
    let o = hits[0].object;
    while (o && !o.userData.fixture) o = o.parent;
    if (!o) return;
    select(models.findIndex((m) => m.root === o));
  };
  canvas.addEventListener('pointerup', up);
});

// DMX in -----------------------------------------------------------------
window.previs.onDmx((frames) => {
  for (const fr of frames) {
    let buf = universes.get(fr.universe);
    if (!buf) universes.set(fr.universe, (buf = new Uint8Array(512)));
    buf.set(fr.data.subarray ? fr.data.subarray(0, 512) : new Uint8Array(fr.data).subarray(0, 512));
    universes.set(fr.universe, buf);
  }
  const now = performance.now() / 1000;
  for (const m of models) {
    const buf = universes.get(m.rt.universe);
    if (buf) applyDmx(m.rt, buf, now);
  }
});
window.previs.onRig((r) => loadRig(r));
window.previs.onProfile((p) => {
  if (!rig) rig = { scene: { fixtures: [], trusses: [], sceneObjects: [], layers: [] }, profiles: {}, missing: [], name: 'Manual rig' };
  rig.profiles[p.spec] = p;
  log(`GDTF loaded: ${p.name} (${p.modes.map((m) => m.name).join(', ')})`);
  manualPatchPrompt(p);
});
window.previs.onLog(log);
window.previs.onMenu((cmd) => {
  if (cmd === 'open-mvr') $('#btnOpenMvr').click();
  if (cmd === 'open-gdtf') $('#btnOpenGdtf').click();
  if (cmd === 'demo-rig') $('#btnDemo').click();
});

// When a GDTF is loaded on its own, offer to patch a line of them
async function manualPatchPrompt(p) {
  const dlg = $('#patchDlg');
  $('#patchDlgTitle').textContent = `${p.name} — ${p.modes[0].name} (${p.modes[0].footprint} ch)`;
  dlg.returnValue = '';
  dlg.showModal();
  const n = await new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok' ? parseInt($('#patchCount').value, 10) : 0), { once: true }));
  if (!n) return;
  const fp = p.modes[0].footprint || 1;
  for (let i = 0; i < n; i++) {
    const x = -((n - 1) * 1500) / 2 + i * 1500;
    await window.previs.addFixture({
      name: `${p.shortName || p.name} ${i + 1}`,
      uuid: `manual-${Date.now()}-${i}`,
      fixtureId: String(i + 1),
      layer: 'Manual',
      gdtfSpec: p.spec,
      gdtfMode: p.modes[0].name,
      universe: 1,
      address: 1 + i * fp,
      addresses: [{ universe: 1, address: 1 + i * fp, abs: 1 + i * fp, break: 0 }],
      color: null,
      matrix: { u: [1, 0, 0], v: [0, -1, 0], w: [0, 0, -1], o: [x, 0, 7000] },
    });
  }
}

// UI ---------------------------------------------------------------------
$('#btnOpenMvr').addEventListener('click', async () => {
  const r = await window.previs.openMvrDialog();
  if (r && r.error) log(`MVR error: ${r.error}`);
});
$('#btnOpenGdtf').addEventListener('click', async () => {
  const r = await window.previs.openGdtfDialog();
  if (r && r.error) log(`GDTF error: ${r.error}`);
});
$('#btnDemo').addEventListener('click', async () => {
  await window.previs.loadDemo();
  if (!$('#demoDmx').checked) {
    $('#demoDmx').checked = true;
    await window.previs.setDemoDmx(true);
  }
});
$('#demoDmx').addEventListener('change', async (e) => {
  await window.previs.setDemoDmx(e.target.checked);
});
$('#btnListen').addEventListener('click', async () => {
  const u = parseInt($('#uniInput').value, 10);
  if (u >= 1) await window.previs.sacnListen(u);
  refreshStatus();
});
$('#floorLight').addEventListener('change', (e) => (floorLightOn = e.target.checked));
$('#showGrid').addEventListener('change', (e) => (grid.visible = e.target.checked));
$('#haze').addEventListener('input', (e) => {
  haze = parseFloat(e.target.value);
  for (const m of models) m.beamMat.uniforms.uHaze.value = haze;
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') frameRig();
});

// Drag & drop
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('drop');
});
window.addEventListener('dragleave', () => document.body.classList.remove('drop'));
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('drop');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const p = window.previs.pathForFile(f);
  if (!p) return log('Could not read dropped file path');
  const r = await window.previs.openPath(p);
  if (r && r.error) log(`Error: ${r.error}`);
});

async function refreshStatus() {
  const st = await window.previs.sacnStatus();
  const el = $('#universes');
  el.innerHTML = '';
  for (const u of st.universes) {
    const d = document.createElement('span');
    d.className = `uni${u.active ? ' active' : ''}${st.demo && u.universe === 1 ? ' demo' : ''}`;
    d.innerHTML = `<span class="dot"></span>U${u.universe}${u.sources.length ? ` <span class="muted">${esc(u.sources.map((s) => s.name).join(', '))}</span>` : ''}`;
    el.appendChild(d);
  }
  $('#sacnPkts').textContent = `${st.packets} pkt`;
}
setInterval(refreshStatus, 1000);
refreshStatus();

// Render loop ------------------------------------------------------------
function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  const t = performance.now();
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  const now = t / 1000;
  for (const m of models) {
    tick(m.rt, dt);
    m.update(now, FLOOR_Y, floorLightOn);
  }
  controls.update();
  renderer.render(scene, camera);
  frames++;
  if (t - fpsT > 500) {
    fps = Math.round((frames * 1000) / (t - fpsT));
    frames = 0;
    fpsT = t;
    $('#hud').textContent = `${fps} fps · ${models.length} fixtures`;
  }
  if (++patchTimer % 6 === 0) refreshPatchLevels();
}
animate();

// Start with the demo rig so the window isn't empty
window.previs.getRig().then((r) => {
  if (r) loadRig(r);
  else $('#btnDemo').click();
});
