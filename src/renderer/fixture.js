// Three.js fixture models: moving heads, static luminaires, beams.
import * as THREE from 'three';
import { outputLevel } from './dmx.js';

// MVR (mm, Z-up) → Three (m, Y-up) change of basis
const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const Cinv = C.clone().invert();

export function mvrMatrixToThree(m) {
  const u = new THREE.Vector3(...m.u);
  const v = new THREE.Vector3(...m.v);
  const w = new THREE.Vector3(...m.w);
  const M = new THREE.Matrix4().makeBasis(u, v, w);
  M.setPosition(m.o[0] / 1000, m.o[1] / 1000, m.o[2] / 1000);
  return new THREE.Matrix4().multiplyMatrices(C, M).multiply(Cinv);
}

// Shared geometry/material caches -----------------------------------------
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b1e25, roughness: 0.7, metalness: 0.3 });
const yokeMat = new THREE.MeshStandardMaterial({ color: 0x262a33, roughness: 0.6, metalness: 0.4 });
const geoCache = {};
function box(w, h, d) {
  const k = `b${w},${h},${d}`;
  return (geoCache[k] ||= new THREE.BoxGeometry(w, h, d));
}
function cyl(r, h, seg = 24) {
  const k = `c${r},${h},${seg}`;
  return (geoCache[k] ||= new THREE.CylinderGeometry(r, r, h, seg));
}

// Beam cone: apex at origin, extends along +Y to y=1, radius 1 at the base.
function beamGeometry() {
  if (geoCache.beam) return geoCache.beam;
  const g = new THREE.CylinderGeometry(0.02, 1, 1, 40, 1, true);
  g.translate(0, 0.5, 0); // y: 0..1, narrow end at origin
  geoCache.beam = g;
  return g;
}

const beamVert = /* glsl */ `
  varying float vT;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vT = position.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const beamFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uHaze;
  varying float vT;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float fall = pow(1.0 - vT, 1.6);
    float edge = abs(dot(normalize(vNormalW), normalize(vViewDir)));
    float rim = mix(0.35, 1.0, 1.0 - edge); // brighter when looking across the cone
    float a = uIntensity * uHaze * fall * rim;
    gl_FragColor = vec4(uColor * a, a);
  }`;

export class FixtureModel {
  constructor(rt) {
    this.rt = rt;
    const p = rt.profile;
    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(mvrMatrixToThree(rt.fixture.matrix));
    this.root.name = rt.fixture.name;
    this.root.userData.fixture = rt.fixture;

    this.isMover = !!(p && p.isMovingHead);
    this.beamLen = 1;
    this.selected = false;

    if (this.isMover) this._buildMovingHead();
    else this._buildStatic();

    // Beam
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 0 }, uHaze: { value: 0.55 } },
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(beamGeometry(), this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 10;
    this.beam.position.y = this.lensY;
    this.head.add(this.beam);

    // Lens glow (small disc that lights up with the dimmer)
    this.lensMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const lens = new THREE.Mesh(cyl(this.lensR, 0.01, 24), this.lensMat);
    lens.position.y = this.lensY + 0.005;
    this.head.add(lens);

    // Spot light onto the floor/scenery
    this.light = new THREE.SpotLight(0xffffff, 0, 40, 0.3, 0.6, 1.2);
    this.light.position.y = this.lensY;
    this.lightTarget = new THREE.Object3D();
    this.lightTarget.position.y = this.lensY + 1;
    this.head.add(this.lightTarget);
    this.light.target = this.lightTarget;
    this.head.add(this.light);

    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.02, 8, 32), new THREE.MeshBasicMaterial({ color: 0x3fa9f5 }));
    this.selRing.rotation.x = Math.PI / 2;
    this.selRing.visible = false;
    this.root.add(this.selRing);
  }

  _buildMovingHead() {
    const base = new THREE.Mesh(box(0.34, 0.12, 0.34), bodyMat);
    base.position.y = 0.06;
    this.root.add(base);
    this.yoke = new THREE.Group();
    this.yoke.position.y = 0.12;
    this.root.add(this.yoke);
    const armL = new THREE.Mesh(box(0.04, 0.42, 0.14), yokeMat);
    armL.position.set(-0.17, 0.21, 0);
    const armR = armL.clone();
    armR.position.x = 0.17;
    const bridge = new THREE.Mesh(box(0.38, 0.05, 0.14), yokeMat);
    bridge.position.y = 0.025;
    this.yoke.add(armL, armR, bridge);
    this.head = new THREE.Group();
    this.head.position.y = 0.3;
    this.yoke.add(this.head);
    const headBody = new THREE.Mesh(box(0.22, 0.4, 0.26), bodyMat);
    this.head.add(headBody);
    const bezel = new THREE.Mesh(cyl(0.1, 0.03), yokeMat);
    bezel.position.y = 0.2;
    this.head.add(bezel);
    this.lensY = 0.215;
    this.lensR = 0.08;
  }

  _buildStatic() {
    const body = new THREE.Mesh(cyl(0.12, 0.3, 20), bodyMat);
    body.position.y = 0.15;
    this.root.add(body);
    const bracket = new THREE.Mesh(box(0.3, 0.03, 0.05), yokeMat);
    bracket.position.y = 0.02;
    this.root.add(bracket);
    this.head = new THREE.Group();
    this.root.add(this.head);
    this.lensY = 0.3;
    this.lensR = 0.1;
  }

  setSelected(on) {
    this.selected = on;
    this.selRing.visible = on;
  }

  // Called every frame after dmx.tick()
  update(now, floorY, floorLightOn) {
    const s = this.rt.state;
    const p = this.rt.profile;
    if (this.isMover) {
      this.yoke.rotation.y = THREE.MathUtils.degToRad(-s.pan);
      this.head.rotation.x = THREE.MathUtils.degToRad(s.tilt);
    }
    const level = outputLevel(this.rt, now);
    const angle = Math.max(2, s.zoom || (p ? p.beam.fieldAngle : 25)) * s.iris;
    const half = THREE.MathUtils.degToRad(angle / 2);

    // Beam length: stop a little past the floor (or 30 m)
    this.head.updateWorldMatrix(true, false);
    const origin = new THREE.Vector3(0, this.lensY, 0).applyMatrix4(this.head.matrixWorld);
    const dir = new THREE.Vector3(0, 1, 0).transformDirection(this.head.matrixWorld);
    let len = 30;
    if (dir.y < -0.02) len = Math.min(30, (origin.y - floorY) / -dir.y + 1.5);
    this.beamLen = len;
    const r = Math.tan(half) * len;
    this.beam.scale.set(r, len, r);

    const col = this.beamMat.uniforms.uColor.value;
    col.setRGB(s.rgb[0], s.rgb[1], s.rgb[2]);
    // wider beams are dimmer per unit volume
    const widthComp = Math.min(1, 12 / Math.max(6, angle));
    this.beamMat.uniforms.uIntensity.value = level * widthComp * 0.9;
    this.beam.visible = level > 0.003;

    this.lensMat.color.setRGB(s.rgb[0] * level, s.rgb[1] * level, s.rgb[2] * level);

    if (floorLightOn) {
      this.light.visible = level > 0.003;
      this.light.color.setRGB(s.rgb[0], s.rgb[1], s.rgb[2]);
      this.light.angle = half;
      this.light.intensity = level * (p ? Math.min(2000, p.beam.lumens / 10) : 800);
      this.light.distance = len + 2;
    } else {
      this.light.visible = false;
    }
  }
}

// Truss: simple box section along local X
export function trussMesh(truss) {
  const len = (truss.length || 2000) / 1000;
  const size = (truss.size || 290) / 1000;
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.copy(mvrMatrixToThree(truss.matrix));
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.5, metalness: 0.6 });
  const chord = new THREE.CylinderGeometry(0.025, 0.025, len, 10);
  chord.rotateZ(Math.PI / 2);
  const offs = [
    [size / 2, size / 2],
    [-size / 2, size / 2],
    [size / 2, -size / 2],
    [-size / 2, -size / 2],
  ];
  for (const [y, z] of offs) {
    const m = new THREE.Mesh(chord, mat);
    m.position.set(0, y, z);
    g.add(m);
  }
  // Square frames every 0.5 m
  const n = Math.max(1, Math.round(len / 0.5)) + 1;
  const tieV = new THREE.CylinderGeometry(0.012, 0.012, size, 6); // along Y
  const tieH = tieV.clone().rotateX(Math.PI / 2); // along Z
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + i * (len / (n - 1 || 1));
    for (const side of [1, -1]) {
      const v = new THREE.Mesh(tieV, mat);
      v.position.set(x, 0, (side * size) / 2);
      const h = new THREE.Mesh(tieH, mat);
      h.position.set(x, (side * size) / 2, 0);
      g.add(v, h);
    }
  }
  return g;
}
