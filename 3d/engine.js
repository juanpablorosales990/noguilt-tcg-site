// NoGuilt 3D engine v3 (shared by /3d/ repacks and /3d/imports/). Config comes from window.NG.
// Principles: one hero object per scene, sticky copy, scroll only moves the camera, the 3D stage sits
// right of the copy on desktop and under it on phones (camera view offset), cards always stay inside
// their pack until they are fully out, nothing moves fast.
import * as THREE from 'three';

const NG = window.NG;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const smooth = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x); };
let MOB = matchMedia('(max-width: 760px)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- renderer ----------
const canvas = $('#gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) throw new Error('webgl2');
} catch (e) { document.documentElement.classList.add('nogl'); throw e; }
const VW = () => canvas.clientWidth || innerWidth, VH = () => canvas.clientHeight || innerHeight;
let dpr = Math.min(devicePixelRatio, COARSE ? 1.5 : 1.75);
renderer.setPixelRatio(dpr);
renderer.setSize(VW(), VH(), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, VW() / VH(), 0.1, 400);

// ---------- sky ----------
const PAL = NG.palette.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, new THREE.Color(v)])));
const sky = { uZenith: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBelow: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(-0.45, 0.32, -1).normalize() }, uWhite: { value: 0 } };
const SKY_GLSL = `
uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uBelow; uniform vec3 uSunDir; uniform float uWhite;
vec3 skyColor(vec3 dir){ float h=dir.y;
  vec3 up=mix(uMid,uZenith,smoothstep(0.05,0.8,h)); vec3 c=mix(uHorizon,up,smoothstep(-0.05,0.35,h));
  c=mix(c,uBelow,1.0-smoothstep(-0.45,-0.02,h));
  float s=max(dot(dir,uSunDir),0.0); c+=vec3(1.0,0.93,0.78)*(pow(s,6.0)*0.22+pow(s,180.0)*0.9);
  return mix(c,vec3(1.0,0.97,0.95),uWhite*0.9); }`;
const skyMat = new THREE.ShaderMaterial({
  uniforms: sky, side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: false,
  vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `${SKY_GLSL}
varying vec3 vDir; float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){ gl_FragColor=vec4(skyColor(normalize(vDir)),1.0);
#include <colorspace_fragment>
gl_FragColor.rgb+=(hash(gl_FragCoord.xy)-0.5)/255.0; }`,
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), skyMat);
skyMesh.renderOrder = -2; skyMesh.frustumCulled = false; scene.add(skyMesh);
const cloudU = { uMap: { value: null }, uGrid: { value: new THREE.Vector2(3, 2) }, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uFog: { value: 0.007 }, uNearK: { value: new THREE.Vector2(0.25, 0.8) }, uFar: { value: new THREE.Vector2(150, 220) } };
function setPalette(t) {
  const i = Math.min(PAL.length - 2, Math.floor(t)), k = clamp(t - i), a = PAL[i], b = PAL[i + 1];
  sky.uZenith.value.lerpColors(a.z, b.z, k); sky.uMid.value.lerpColors(a.m, b.m, k); sky.uHorizon.value.lerpColors(a.h, b.h, k); sky.uBelow.value.lerpColors(a.b, b.b, k);
  cloudU.uLit.value.lerpColors(a.lit, b.lit, k); cloudU.uShade.value.lerpColors(a.sh, b.sh, k);
}
function buildEnv() {
  setPalette(0.5);
  const env = new THREE.Scene(); env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const box = (w, h, x, y, z, k, col = 0xffffff) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
  box(26, 12, -14, 26, 22, 5, 0xffe3c2); box(18, 8, 30, 8, -10, 2.2, 0xc9c2ff); box(20, 6, 10, -2, 30, 1.2);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: '#6a6290' })); floor.rotation.x = -Math.PI / 2; floor.position.y = -14; env.add(floor);
  const pm = new THREE.PMREMGenerator(renderer); const t = pm.fromScene(env, 0.02).texture; pm.dispose(); return t;
}
const key = new THREE.DirectionalLight(0xffe3c2, 1.6); scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xc9c2ff, 1.0); scene.add(rim, rim.target);
scene.add(new THREE.HemisphereLight(0xf2ecff, 0xd9c6e6, 0.5));

// ---------- clouds ----------
const cloudVS = `
attribute vec4 aData; uniform vec2 uGrid; uniform vec2 uNearK; uniform vec2 uFar;
varying vec2 vUv; varying vec2 vLocal; varying vec3 vWorld; varying float vAlpha; varying float vDist;
void main(){
  vec3 center=(modelMatrix*vec4(instanceMatrix[3].xyz,1.0)).xyz;
  vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]); vec3 up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  vWorld=center+right*position.x*aData.x+up*position.y*aData.y;
  vec4 mv=viewMatrix*vec4(vWorld,1.0); gl_Position=projectionMatrix*mv;
  float d=-(viewMatrix*vec4(center,1.0)).z; vDist=-mv.z;
  vAlpha=aData.w*smoothstep(uNearK.x*aData.y,uNearK.y*aData.y,d)*(1.0-smoothstep(uFar.x,uFar.y,d));
  if(vAlpha<0.001) gl_Position=vec4(2.0,2.0,2.0,1.0);
  float t=aData.z+0.5; vec2 cell=vec2(floor(mod(t,uGrid.x)),uGrid.y-1.0-floor(t/uGrid.x));
  vec2 uvv=uv; if(aData.x<0.0) uvv.x=1.0-uvv.x; vUv=(cell+uvv)/uGrid; vLocal=position.xy; }`;
const cloudFS = `${SKY_GLSL}
uniform sampler2D uMap; uniform vec3 uLit; uniform vec3 uShade; uniform float uFog;
varying vec2 vUv; varying vec2 vLocal; varying vec3 vWorld; varying float vAlpha; varying float vDist;
void main(){ vec4 tex=texture2D(uMap,vUv); float a=tex.a*vAlpha; if(a<0.004) discard;
  float detail=clamp(tex.r/max(tex.a,1e-3),0.0,1.0);
  vec3 col=mix(uShade,uLit,smoothstep(-0.5,0.25,vLocal.y))*mix(0.8,1.0,detail);
  vec3 vd=normalize(vWorld-cameraPosition);
  col+=vec3(1.0,0.95,0.86)*pow(max(dot(vd,uSunDir),0.0),5.0)*(1.0-tex.a)*0.7;
  col=mix(col,skyColor(vd),1.0-exp(-uFog*vDist));
  gl_FragColor=vec4(col,a);
#include <colorspace_fragment>
}`;
function rng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const A = { hero: 0, line: -34, extra: -68, open: -102 };
const DECKS = [{ y: -6, n: 34 }, { y: -17, n: 30 }, { y: -40, n: 34 }, { y: -51, n: 30 }, { y: -74, n: 34 }, { y: -85, n: 30 }, { y: -108, n: 34 }];
const TRANSIT = [-17, -51, -85];
let cloudMesh, cloudData; const clouds = [];
async function buildClouds() {
  const map = await new Promise((r) => new THREE.TextureLoader().load(NG.shared + (COARSE ? 'clouds-256.webp' : 'clouds-512.webp'), r));
  map.colorSpace = THREE.NoColorSpace; cloudU.uMap.value = map;
  const scale = COARSE ? 0.75 : 1, total = DECKS.reduce((s, d) => s + Math.round(d.n * scale), 0);
  const geo = new THREE.PlaneGeometry(1, 1);
  cloudData = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4).setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aData', cloudData);
  cloudMesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ uniforms: { ...sky, ...cloudU }, vertexShader: cloudVS, fragmentShader: cloudFS, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), total);
  cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); cloudMesh.frustumCulled = false; cloudMesh.renderOrder = 1; scene.add(cloudMesh);
  const r = rng(11);
  for (const d of DECKS) {
    const n = Math.round(d.n * scale), transit = TRANSIT.includes(d.y);
    for (let i = 0; i < n; i++) {
      const h = (transit ? 7 : 6) + r() * 7; let x = (r() * 2 - 1) * 48, z = -70 + r() * 76;
      if (!transit && Math.abs(x) < 8 && z > -8) z -= 14;
      clouds.push({ x, y: d.y + (r() * 2 - 1) * (transit ? 2.5 : 1.6), z, h, w: h * (2.0 + r() * 0.5) * (r() < 0.5 ? -1 : 1), tile: Math.floor(r() * 6), op: 0.82 + r() * 0.18, vx: REDUCE ? 0 : 0.25 + r() * 0.35, ph: r() * 6.28, depth: 0 });
    }
  }
}
const fwd = new THREE.Vector3();
function updateClouds(dt, t) {
  if (!cloudMesh) return; camera.getWorldDirection(fwd); const cp = camera.position;
  for (const c of clouds) { c.x += c.vx * dt; if (c.x > 48) c.x -= 96; c.depth = (c.x - cp.x) * fwd.x + (c.y - cp.y) * fwd.y + (c.z - cp.z) * fwd.z; }
  clouds.sort((a, b) => b.depth - a.depth);
  const m = cloudMesh.instanceMatrix.array, d = cloudData.array;
  for (let i = 0; i < clouds.length; i++) { const c = clouds[i], o = i * 16, k = i * 4, br = 1 + 0.025 * Math.sin(t * 0.3 + c.ph);
    m[o] = 1; m[o + 5] = 1; m[o + 10] = 1; m[o + 15] = 1; m[o + 12] = c.x; m[o + 13] = c.y; m[o + 14] = c.z;
    d[k] = c.w * br; d[k + 1] = c.h * br; d[k + 2] = c.tile; d[k + 3] = c.op * (1 - smooth(36, 48, Math.abs(c.x))); }
  cloudMesh.instanceMatrix.needsUpdate = true; cloudData.needsUpdate = true;
}

// ---------- textures ----------
const loader = new THREE.TextureLoader(); const maxAniso = renderer.capabilities.getMaxAnisotropy(); const cache = new Map();
function tex(url) { if (!url) return Promise.resolve(null); if (cache.has(url)) return cache.get(url);
  const p = new Promise((res) => loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); res(t); }, undefined, () => res(null))); cache.set(url, p); return p; }

// ---------- pack + card geometry ----------
const PW = 1, T = 0.055, TEAR = 0.905;
function puff(u, v) { const g = smooth(0.025, 0.075, v) * (1 - smooth(0.885, 0.925, v)); return T * Math.pow(Math.sin(Math.PI * clamp(u)), 0.55) * g; }
function pillow(PH, u0, u1, v0, v1, side, nu = 40, nv = 60, lift = 0) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) { const v = v0 + (v1 - v0) * j / nv; for (let i = 0; i <= nu; i++) { const u = u0 + (u1 - u0) * i / nu; pos.push((u - 0.5) * PW, (v - 0.5) * PH, side * (puff(u, v) + lift)); uv.push(side > 0 ? u : 1 - u, v); } }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; if (side > 0) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
function rrShape(w, h, r) { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; }
const CW = 0.606, CH = CW * 88 / 63;
const cardShape = rrShape(CW, CH, CW * 0.048);
const cardGeo = (() => { const g = new THREE.ShapeGeometry(cardShape, 6), p = g.attributes.position, uv = []; for (let i = 0; i < p.count; i++) uv.push(p.getX(i) / CW + 0.5, p.getY(i) / CH + 0.5); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g; })();
const cardEdgeGeo = new THREE.ExtrudeGeometry(cardShape, { depth: 0.003, bevelEnabled: false, curveSegments: 6 }); cardEdgeGeo.translate(0, 0, -0.0015);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xece8dc, roughness: 0.6 });
const foilInB = new THREE.MeshStandardMaterial({ color: 0xb4b0c4, metalness: 0.9, roughness: 0.35, side: THREE.BackSide });
const plastic = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false });
function holeMask(r) { const c = document.createElement('canvas'); c.width = 126; c.height = 240; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 126, 240); x.fillStyle = '#000'; x.beginPath(); x.roundRect(r[0] / 5, r[1] / 5, (r[2] - r[0]) / 5, (r[3] - r[1]) / 5, 4); x.fill(); return new THREE.CanvasTexture(c); }
const GEO = {};
function geos(PH, lo, win) { const k = `${PH.toFixed(3)}${lo ? 'l' : 'h'}${win ? 'w' : ''}`; if (GEO[k]) return GEO[k]; const n = lo ? [24, 36, 6] : [44, 64, 10];
  const g = { bf: pillow(PH, 0, 1, 0, TEAR, 1, n[0], n[1]), bb: pillow(PH, 0, 1, 0, TEAR, -1, n[0], n[1]), tf: pillow(PH, 0, 1, TEAR, 1, 1, n[0], n[2]), tb: pillow(PH, 0, 1, TEAR, 1, -1, n[0], n[2]) };
  if (win) g.win = pillow(PH, win[0] / 630, win[2] / 630, 1 - win[3] / 1200, 1 - win[1] / 1200, 1, 18, 26, 0.0015);
  return (GEO[k] = g); }
function foil(map, cut) { return new THREE.MeshPhysicalMaterial({ map, alphaTest: cut ? 0.5 : 0.02, transparent: false, metalness: 0.32, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.2, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 420], envMapIntensity: 1.15 }); }
// pack: { front, back, aspect (h/w), window: [x0,y0,x1,y1] px on a 630x1200 sheet or null }
function makePack(front, back, aspect, { win = null, lo = false } = {}) {
  const PH = PW * aspect, g = geos(PH, lo, win), mf = foil(front, true), mb = foil(back, true);
  const root = new THREE.Group(), body = new THREE.Group(), top = new THREE.Group(), inner = new THREE.Group();
  body.add(new THREE.Mesh(g.bf, mf), new THREE.Mesh(g.bb, mb));
  if (!lo) {
    const inF = new THREE.MeshStandardMaterial({ color: 0xb4b0c4, metalness: 0.9, roughness: 0.35, side: THREE.BackSide, alphaMap: win ? holeMask(win) : null, alphaTest: 0.5 });
    body.add(new THREE.Mesh(g.bf, inF), new THREE.Mesh(g.bb, foilInB));
    if (win) body.add(new THREE.Mesh(g.win, plastic));
  }
  top.add(new THREE.Mesh(g.tf, mf), new THREE.Mesh(g.tb, mb));
  root.add(body, top, inner); return { root, body, top, inner, PH };
}
function makeCard(front, back, kind) {
  const g = new THREE.Group();
  const fm = new THREE.MeshPhysicalMaterial({ map: front, alphaTest: 0.5, roughness: kind ? 0.2 : 0.4, metalness: kind ? 0.3 : 0.04, clearcoat: 1, clearcoatRoughness: 0.1, iridescence: kind === 2 ? 1 : kind === 1 ? 0.75 : 0, iridescenceIOR: 1.7, iridescenceThicknessRange: [250, 950] });
  const bm = new THREE.MeshPhysicalMaterial({ map: back, alphaTest: 0.5, roughness: 0.45, clearcoat: 0.6 });
  const f = new THREE.Mesh(cardGeo, fm); f.position.z = 0.0017; const b = new THREE.Mesh(cardGeo, bm); b.rotation.y = Math.PI; b.position.z = -0.0017;
  g.add(new THREE.Mesh(cardEdgeGeo, edgeMat), f, b); return g;
}
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(142,134,196,0.5)'); gr.addColorStop(1, 'rgba(142,134,196,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
function blob(w, d) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false })); m.rotation.x = -Math.PI / 2; m.renderOrder = 2; return m; }

// ---------- tweens + pointer ----------
let now = performance.now() / 1000; const tweens = [];
function tween(dur, fn, ez = ease) { return new Promise((r) => tweens.push({ t0: now, dur, fn, ez, r })); }
function runTweens() { for (let i = tweens.length - 1; i >= 0; i--) { const w = tweens[i], k = clamp((now - w.t0) / w.dur); w.fn(w.ez(k)); if (k >= 1) { tweens.splice(i, 1); w.r(); } } }
const ptr = { x: 0, y: 0, sx: 0, sy: 0, cx: -1, cy: -1 };
addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; ptr.x = (e.clientX / innerWidth) * 2 - 1; ptr.y = (e.clientY / innerHeight) * 2 - 1; ptr.cx = e.clientX; ptr.cy = e.clientY; }, { passive: true });

// ---------- a pack with its cards (used by the tear scene and by open-a-pack) ----------
// cards are children of the pack root: they follow every sway; they leave the pack only after the top is gone.
async function packWithCards(P) {
  const [f, b, back, ...fr] = await Promise.all([tex(P.front), tex(P.back), tex(P.cardBack), ...P.cards.map((c) => tex(c.t))]);
  const pk = makePack(f, b, P.aspect, { win: P.window });
  const cs = P.cardScale, n = P.cards.length;
  const cy = P.cardY != null ? P.cardY : 0; // card centre inside the pack (pack units)
  const cards = P.cards.map((c, i) => { const m = makeCard(fr[i], back, c.k); m.scale.setScalar(cs); m.userData.z0 = (P.stackZ ? P.stackZ[i] : (i - (n - 1) / 2) * -0.006); m.position.set(0, cy, m.userData.z0); pk.inner.add(m); return m; });
  const topY = (TEAR - 0.5) * pk.PH, rise = topY - (cy - (CH * cs) / 2) + 0.06; // distance for the card bottom to clear the tear line
  return { pk, cards, cy, rise };
}

// ---------- scene 1: hero + tear ----------
const heroRoot = new THREE.Group(); heroRoot.position.y = A.hero; scene.add(heroRoot);
let H = null; const heroBlob = blob(1.5, 0.8); heroRoot.add(heroBlob);
async function buildHero() { H = await packWithCards(NG.hero); heroRoot.add(H.pk.root); heroBlob.position.set(0, -H.pk.PH * 0.5 - 0.8, 0); }
function updateHero(s, time) {
  if (!H) return; heroRoot.visible = s < 2.2; if (!heroRoot.visible) return;
  const e = clamp(s - 1), P = H.pk.root, idle = 1 - seg(e, 0, 0.12);
  P.rotation.set(idle * ptr.sy * 0.06, idle * (Math.sin(time * 0.5) * 0.1 + ptr.sx * 0.12), idle * Math.sin(time * 0.37) * 0.025);
  P.position.y = idle * Math.sin(time * 1.05) * 0.04;
  const tf = easeOut(seg(e, 0.05, 0.18)); // top strip leaves
  H.pk.top.position.set(1.4 * tf, 2.0 * tf, 0.35 * tf); H.pk.top.rotation.set(0.5 * tf, -0.4 * tf, -1.0 * tf); H.pk.top.visible = tf < 0.999;
  const n = H.cards.length, allOut = 0.2 + 0.025 * (n - 1) + 0.18;
  const back = ease(seg(e, allOut + 0.02, allOut + 0.16)); // body only moves after every card is out
  H.pk.body.position.set(0, -back * 2.4, -back * 1.2); H.pk.body.rotation.x = -back * 0.35;
  heroBlob.material.opacity = 0.85 * (1 - back);
  const fan = ease(seg(e, allOut + 0.02, allOut + 0.2)), hit = ease(seg(e, allOut + 0.24, allOut + 0.38));
  const cs = NG.hero.cardScale, R = (MOB ? 0.82 : 1.15) * cs;
  H.cards.forEach((c, k) => {
    const r = ease(seg(e, 0.2 + k * 0.025, 0.38 + k * 0.025)), out = seg(r, 0.92, 1);
    const a = lerp(-0.6, 0.6, k / (n - 1));
    let x = 0, y = H.cy + r * H.rise, z = c.userData.z0 * (1 - out) + out * 0.03 * (k - (n - 1) / 2);
    const fx = Math.sin(a) * R * 1.25, fy = 0.15 + Math.cos(a) * 0.3 - 0.3, fz = 0.45 - Math.abs(a) * 0.4;
    x = lerp(x, fx, fan); y = lerp(y, fy, fan); z = lerp(z, fz, fan);
    let ry = -a * 0.5 * fan, rz = -a * 0.3 * fan, sc = cs * lerp(1, 1.04, fan);
    if (k === n - 1) { x = lerp(x, 0, hit); y = lerp(y, 0.05, hit); z = lerp(z, 1.1, hit); sc = lerp(sc, cs * 1.12, hit); ry = lerp(ry, ptr.sx * 0.4 + Math.sin(time * 0.7) * 0.18, hit); rz = lerp(rz, 0, hit); }
    else { z -= hit * 0.45; }
    c.position.set(x, y, z); c.rotation.set(0, ry, rz); c.scale.setScalar(sc);
  });
  const ex = ease(seg(s, 1.9, 2.05)); heroRoot.position.set(0, A.hero + ex * 5, -ex * 2);
  const cnt = $('#count'); if (cnt) cnt.textContent = String(Math.round(n * seg(e, 0.2, 0.4)));
}

// ---------- scene 2: the line (rails for repacks, floating row for imports) ----------
const lineRoot = new THREE.Group(); lineRoot.position.y = A.line; scene.add(lineRoot);
const items = []; let picked = null;
async function buildLine() {
  const L = NG.line, rows = MOB ? L.rowsMobile : L.rows, sc = (MOB ? L.scaleMobile : L.scale), gap = MOB ? L.gapMobile : L.gap, rowGap = MOB ? L.rowGapMobile : L.rowGap;
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xf2f0f7, metalness: 1, roughness: 0.16, clearcoat: 1 });
  let idx = 0; const total = rows.length;
  for (let r = 0; r < total; r++) {
    const row = rows[r], n = row.length, y = ((total - 1) / 2 - r) * rowGap;
    if (L.rails) {
      const len = (n - 1) * gap + 0.9;
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, len, 16), chrome); rail.rotation.z = Math.PI / 2; rail.position.set(0, y + 0.95 * sc * 1.0, 0); lineRoot.add(rail);
      for (const e of [-1, 1]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), chrome); cap.position.set((e * len) / 2, rail.position.y, 0); lineRoot.add(cap); }
    }
    await Promise.all(row.map(async (id, k) => {
      const it = L.items[id]; const [f, b] = await Promise.all([tex(it.front), tex(it.back)]);
      const p = makePack(f, b, it.aspect, { lo: true }); p.root.scale.setScalar(sc * (it.scale || 1));
      const px = (k - (n - 1) / 2) * gap, pivot = new THREE.Group();
      if (L.rails) { pivot.position.set(px, y + 0.95 * sc, 0); p.root.position.set(0, -(p.PH / 2 - 0.035 * p.PH) * sc * (it.scale || 1), 0); }
      else pivot.position.set(px, y, (k % 2) * -0.25);
      pivot.add(p.root); lineRoot.add(pivot);
      pivot.userData = { i: idx++, base: pivot.position.clone(), it, lift: 0 }; items.push(pivot);
    }));
  }
}
function updateLine(s, time, dt) {
  lineRoot.visible = s > 1.92 && s < 3.2; if (!lineRoot.visible) return;
  const w = s - 2;
  items.forEach((p) => {
    const u = p.userData, k = easeOut(seg(w, 0.04 + u.i * 0.03, 0.22 + u.i * 0.03));
    u.lift = lerp(u.lift, picked === p ? 1 : 0, 1 - Math.pow(0.002, dt));
    p.visible = k > 0.001;
    p.position.set(u.base.x, u.base.y + (1 - k) * 1.2 + (NG.line.rails ? 0 : Math.sin(time * 0.9 + u.i) * 0.04) + u.lift * 0.12, u.base.z + u.lift * 0.35);
    p.rotation.set(0, Math.sin(time * 0.6 + u.i * 2) * 0.06 + ptr.sx * 0.06 + u.lift * 0.1, (NG.line.rails ? Math.sin(time * 1.0 + u.i) * 0.02 : 0) + (1 - k) * 0.3 * Math.sin(u.i * 3));
  });
}
function showDetail(p) {
  picked = p; const d = $('#det'); if (!d) return;
  if (!p) { d.classList.remove('on'); return; }
  const it = p.userData.it; d.querySelector('b').textContent = it.name; d.querySelector('.g').textContent = it.guarantee || ''; d.querySelector('.i').innerHTML = it.inside || ''; d.classList.add('on');
}

// ---------- scene 3: extra (repacks: private label pouch, imports: contrail route) ----------
const extraRoot = new THREE.Group(); extraRoot.position.y = A.extra; scene.add(extraRoot);
let PL = null, plFaces = [], trailMat = null, curve = null; const travellers = [];
async function buildExtra() {
  const X = NG.extra;
  if (X.type === 'private') {
    plFaces = X.faces.map((f) => privateFace(f));
    const back = await tex(X.back);
    PL = makePack(plFaces[0], back, X.aspect); PL.root.scale.setScalar(1.05); extraRoot.add(PL.root);
    const bl = blob(1.5, 0.8); bl.position.set(0, -1.9, 0); extraRoot.add(bl);
  } else {
    const W = MOB ? 2.7 : 6.5; const pts = [new THREE.Vector3(-W, -1.2, -6), new THREE.Vector3(-W * 0.45, 1.2, -4), new THREE.Vector3(W * 0.1, 1.8, -3.5), new THREE.Vector3(W * 0.6, 0.9, -4), new THREE.Vector3(W, -1.1, -6)];
    curve = new THREE.CatmullRomCurve3(pts);
    trailMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, uniforms: { uP: { value: 0 }, uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uP; uniform float uT; varying vec2 vUv;
void main(){ float a=smoothstep(uP,uP-0.02,vUv.x)*smoothstep(0.0,0.06,vUv.x); vec3 c=mix(vec3(1.0,0.55,0.85),vec3(1.0,0.86,0.45),vUv.x);
gl_FragColor=vec4(mix(c,vec3(1.0),0.15)*(0.9+0.1*sin(vUv.x*60.0-uT*3.0))*1.1,a);
#include <colorspace_fragment>
}` });
    extraRoot.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.045, 10, false), trailMat));
    const ts = await Promise.all(X.travellers.map((id) => Promise.all([tex(NG.line.items[id].front), tex(NG.line.items[id].back)])));
    ts.forEach(([f, b], i) => { const p = makePack(f, b, NG.line.items[X.travellers[i]].aspect, { lo: true }); p.root.scale.setScalar(0.42); p.root.userData.off = i / ts.length; extraRoot.add(p.root); travellers.push(p.root); });
  }
}
function privateFace(f) { // generated "your brand" pouch art
  const c = document.createElement('canvas'); c.width = 630; c.height = 1200; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 630, 1200); g.addColorStop(0, f.a); g.addColorStop(1, f.b); x.fillStyle = g; x.fillRect(0, 0, 630, 1200);
  x.fillStyle = 'rgba(255,255,255,.18)'; for (let i = 0; i < 1200; i += 14) x.fillRect(0, i, 630, 3); // crimp texture top/bottom
  x.fillStyle = g; x.fillRect(0, 70, 630, 1040);
  x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.roundRect(255, 26, 120, 40, 20); x.fill(); x.globalCompositeOperation = 'source-over';
  x.fillStyle = 'rgba(255,255,255,.9)'; x.font = 'italic 400 118px "Instrument Serif", Georgia, serif'; x.textAlign = 'center'; x.fillText(f.name, 315, 330);
  x.font = '600 34px "Inter Tight", Arial, sans-serif'; x.fillText(f.tag, 315, 400);
  x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 6; x.beginPath(); x.roundRect(124, 520, 382, 531, 22); x.stroke();
  x.font = '500 26px "JetBrains Mono", monospace'; x.fillText('YOUR ART · YOUR TIERS', 315, 800);
  x.font = '500 22px "JetBrains Mono", monospace'; x.fillText('GENUINE CARDS · AGES 6+', 315, 1110);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function updateExtra(s, time) {
  extraRoot.visible = s > 2.92 && s < 4.2; if (!extraRoot.visible) return;
  const r = s - 3;
  if (PL) {
    PL.root.rotation.set(ptr.sy * 0.05, Math.sin(time * 0.5) * 0.18 + ptr.sx * 0.15, Math.sin(time * 0.37) * 0.02); PL.root.position.y = Math.sin(time * 1.05) * 0.04;
    const i = Math.floor(clamp(r * 1.25 - 0.05, 0, 0.999) * plFaces.length), m = PL.body.children[0].material;
    if (m.map !== plFaces[i]) { m.map = plFaces[i]; PL.top.children[0].material.map = plFaces[i]; m.needsUpdate = true; }
  }
  if (trailMat) {
    const p = ease(seg(r, 0.06, 0.5)); trailMat.uniforms.uP.value = p * 1.02; trailMat.uniforms.uT.value = time;
    travellers.forEach((m) => { const u = (m.userData.off + time * 0.045) % 1, v = u < p - 0.02; m.visible = v; if (!v) return;
      m.position.copy(curve.getPointAt(u)); m.position.y += 0.2; const tg = curve.getTangentAt(u); m.rotation.set(0, Math.atan2(tg.x, tg.z) - Math.PI / 2 + 0.35, Math.atan2(tg.y, Math.hypot(tg.x, tg.z)) * 0.6); });
    $$('.city').forEach((el) => { const at = +el.dataset.at; el.classList.toggle('on', p > at);
      const v = curve.getPointAt(at).clone().add(extraRoot.position); v.project(camera); const hw = el.offsetWidth / 2 + 10;
      el.style.transform = `translate(${clamp((v.x * 0.5 + 0.5) * VW(), hw, VW() - hw)}px, ${(-v.y * 0.5 + 0.5) * VH()}px) translate(-50%, -150%)`; });
  }
}

// ---------- scene 4: open a pack ----------
const openRoot = new THREE.Group(); openRoot.position.y = A.open; scene.add(openRoot);
let O = null, opState = 0, opBusy = false; const opBlob = blob(1.5, 0.8); openRoot.add(opBlob);
async function buildOpen() { O = await packWithCards(NG.hero); openRoot.add(O.pk.root); opBlob.position.set(0, -O.pk.PH * 0.5 - 0.8, 0); resetOpen(); }
function resetOpen() {
  opState = 0; const k = O.pk; k.top.position.set(0, 0, 0); k.top.rotation.set(0, 0, 0); k.top.visible = true; k.body.position.set(0, 0, 0); k.body.rotation.set(0, 0, 0);
  O.cards.forEach((m) => { m.position.set(0, O.cy, m.userData.z0); m.rotation.set(0, 0, 0); m.scale.setScalar(NG.hero.cardScale); });
  $('#openhint').textContent = 'Tap the pack'; $('#again').hidden = true; $('#openbtn').hidden = false; $('#hitmsg').classList.remove('on');
}
async function tapOpen() {
  if (!O || opBusy || opState === 99) return; opBusy = true; const k = O.pk, n = O.cards.length, cs = NG.hero.cardScale;
  if (opState === 0) {
    await tween(0.14, (t) => { k.top.position.x = Math.sin(t * 30) * 0.008; });
    await tween(0.45, (t) => { k.top.position.set(1.2 * t, 1.8 * t, 0.3 * t); k.top.rotation.set(0.5 * t, -0.4 * t, -1.0 * t); }, easeOut);
    k.top.visible = false;
    await Promise.all(O.cards.map((m, i) => tween(0.55, (t) => { m.position.y = O.cy + t * O.rise; const o = seg(t, 0.9, 1); m.position.z = m.userData.z0 * (1 - o) + o * (0.05 + (n - 1 - i) * 0.006); })));
    tween(0.5, (t) => { k.body.position.set(0, -0.7 * t, -0.5 * t); });
    opState = 1; $('#openhint').textContent = 'Tap to reveal';
  } else {
    const i = opState - 1, m = O.cards[i], y0 = m.position.y, z0 = m.position.z;
    if (i === n - 1) {
      await tween(0.7, (t) => { m.position.set(0, lerp(y0, 0.1, t), lerp(z0, 1.0, t)); m.rotation.y = Math.sin(t * Math.PI) * 0.5; m.scale.setScalar(cs * lerp(1, 1.12, t)); });
      $('#hitmsg').classList.add('on'); setTimeout(() => $('#hitmsg').classList.remove('on'), 2200); burst();
      $('#openhint').textContent = NG.hitHint; $('#again').hidden = false; $('#openbtn').hidden = true; opState = 99;
    } else {
      const x = (MOB ? -0.55 : 0.85) * cs + i * (MOB ? 0.2 : 0.3) * cs;
      await tween(0.42, (t) => { m.position.set(lerp(0, x, t), lerp(y0, (MOB ? 1.25 : 0.25) * cs, t) + Math.sin(t * Math.PI) * 0.2, lerp(z0, 0.3 + i * 0.02, t)); m.rotation.z = lerp(0, 0.06 - i * 0.03, t); m.scale.setScalar(cs * lerp(1, MOB ? 0.45 : 0.6, t)); });
      opState++; if (opState === n) $('#openhint').textContent = 'The last card';
    }
  }
  opBusy = false;
}
const sparks = (() => { const n = 160, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ size: 0.04, color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }); openRoot.add(new THREE.Points(g, m)); return { g, p, v, m, n, t: 9 }; })();
function burst() { for (let i = 0; i < sparks.n; i++) { sparks.p.set([0, 0.1, 1.0], i * 3); const d = new THREE.Vector3().randomDirection().multiplyScalar(1.0 + Math.random() * 1.6); sparks.v.set([d.x, d.y, d.z * 0.5], i * 3); } sparks.t = 0; sparks.m.opacity = 1; }
function updateOpen(s, time, dt) {
  openRoot.visible = s > 3.92; if (!O || !openRoot.visible) return;
  const R = O.pk.root;
  if (opState === 0) { R.rotation.set(0, Math.sin(time * 0.6) * 0.1 + ptr.sx * 0.15, Math.sin(time * 0.4) * 0.02); R.position.y = Math.sin(time * 1.05) * 0.04; }
  else { R.rotation.y *= 0.9; R.rotation.z *= 0.9; R.position.y *= 0.9; }
  opBlob.material.opacity = opState === 0 ? 0.85 : 0.35;
  if (opState === 99) O.cards[O.cards.length - 1].rotation.y = Math.sin(time * 0.8) * 0.28 + ptr.sx * 0.35;
  if (sparks.t < 1.8) { sparks.t += dt; for (let i = 0; i < sparks.n; i++) { sparks.v[i * 3 + 1] -= 2.2 * dt; for (let a = 0; a < 3; a++) sparks.p[i * 3 + a] += sparks.v[i * 3 + a] * dt; } sparks.g.attributes.position.needsUpdate = true; sparks.m.opacity = clamp(1 - sparks.t / 1.6); }
}

// ---------- camera ----------
// objects are framed at their own centre; a view offset moves the whole stage right (desktop) or down (phone)
let K = [];
function buildPath() {
  const M = MOB, d = (desk, mob) => (M ? mob : desk);
  const X = NG.extra.cam;
  K = [
    { s: 0, p: [0, 0.1, d(5.0, 6.6)], l: [0, 0, 0] },
    { s: 1.0, p: [0, 0.1, d(5.0, 6.6)], l: [0, 0, 0] },
    { s: 1.2, p: [0.15, 0.2, d(4.5, 6.0)], l: [0, 0.2, 0] },
    { s: 1.55, p: [0, 0.35, d(5.3, 7.2)], l: [0, 0.35, 0.3] },
    { s: 1.92, p: [0, 0.3, d(5.0, 6.8)], l: [0, 0.2, 0.4] },
    { s: 2.1, p: [0, A.line + 0.2, d(NG.line.cam, NG.line.camMobile)], l: [0, A.line + d(0.35, 0.25), 0] },
    { s: 2.95, p: [0.25, A.line + 0.05, d(NG.line.cam - 0.8, NG.line.camMobile - 0.6)], l: [0, A.line + d(0.35, 0.25), 0] },
    { s: 3.1, p: [0, A.extra + X.y, d(X.z, X.zMobile)], l: [0, A.extra + X.ly, X.lz] },
    { s: 3.92, p: [0.25, A.extra + X.y, d(X.z - 0.4, X.zMobile - 0.4)], l: [0, A.extra + X.ly, X.lz] },
    { s: 4.1, p: [0, A.open + 0.1, d(5.0, 6.8)], l: [0, A.open + (M ? 0.3 : 0.1), 0] },
    { s: 9, p: [0, A.open + 0.1, d(5.0, 6.8)], l: [0, A.open + (M ? 0.3 : 0.1), 0] },
  ];
}
const camP = new THREE.Vector3(), camL = new THREE.Vector3();
function camAt(s) { let i = 0; while (i < K.length - 2 && s > K[i + 1].s) i++; const a = K[i], b = K[i + 1], t = ease(seg(s, a.s, b.s));
  camP.set(lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)); camL.set(lerp(a.l[0], b.l[0], t), lerp(a.l[1], b.l[1], t), lerp(a.l[2], b.l[2], t)); }

// ---------- scroll -> story, sticky copy steps ----------
const secs = $$('[data-s]'); let tops = [];
function measure() { tops = secs.map((e) => ({ top: e.offsetTop, h: e.offsetHeight })); }
function storyTarget() { const y = scrollY + innerHeight * 0.5; for (let k = secs.length - 1; k >= 0; k--) if (y >= tops[k].top) return k + clamp((y - tops[k].top) / Math.max(1, tops[k].h)); return 0; }
function steps(s) { const act = Math.floor(s); secs.forEach((sec, k) => { const sk = sec.querySelector('.stick'); if (sk) sk.classList.toggle('act', k === act); const st = sec.querySelectorAll('.step'); if (st.length < 2) return; const p = clamp(s - k), i = Math.min(st.length - 1, Math.floor(p * st.length * 0.999)); st.forEach((e, j) => e.classList.toggle('on', j === i)); }); }
let sNow = 0;

// ---------- input ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
function hitTest(x, y, objs) { const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / VW()) * 2 - 1, -((y - r.top) / VH()) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.intersectObjects(objs, true)[0]; }
function owner(o) { while (o && !items.includes(o)) o = o.parent; return o; }
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', (e) => {
  if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10; down = null; if (moved) return;
  if (lineRoot.visible && sNow > 2.08 && sNow < 3.0) { const h = hitTest(e.clientX, e.clientY, items); showDetail(h ? owner(h.object) : null); }
  if (openRoot.visible && sNow > 4.05 && O) { const h = hitTest(e.clientX, e.clientY, [openRoot]); if (h) tapOpen(); }
});
$('#again').addEventListener('click', resetOpen); $('#openbtn').addEventListener('click', tapOpen);
const detX = $('#det .x'); if (detX) detX.addEventListener('click', () => showDetail(null));

// ---------- loop ----------
let last = performance.now(), running = true, acc = 0, frames = 0, lastW = 0, lastH = 0;
function resize() {
  const w = VW(), h = VH(); MOB = matchMedia('(max-width: 760px)').matches; measure(); buildPath();
  if (w === lastW && h === lastH) return; lastW = w; lastH = h;
  camera.aspect = w / h; camera.fov = MOB ? 40 : 35;
  if (MOB) camera.setViewOffset(w, h, 0, -h * 0.2, w, h); else camera.setViewOffset(w, h, -w * 0.17, 0, w, h);
  camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
}
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 120); });
document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { last = performance.now(); requestAnimationFrame(frame); } });
function adapt(dt) { acc += dt; frames++; if (acc < 1.5) return; const ms = (1000 * acc) / frames; acc = frames = 0; if (ms > 22 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); renderer.setSize(VW(), VH(), false); } }
function frame(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - last) / 1000); last = t; now = t / 1000;
  const target = storyTarget(); sNow += (target - sNow) * (1 - Math.exp(-dt * (REDUCE ? 30 : 9))); if (Math.abs(target - sNow) < 1e-4) sNow = target;
  ptr.sx += (ptr.x - ptr.sx) * (1 - Math.exp(-dt * 3)); ptr.sy += (ptr.y - ptr.sy) * (1 - Math.exp(-dt * 3));
  runTweens(); steps(target);
  const time = REDUCE ? 0 : now;
  setPalette(clamp((sNow - 0.5) / 2.5, 0, 1) * (PAL.length - 1) * 0.5 + clamp((sNow - 3.2) / 0.9, 0, 1) * (PAL.length - 1) * 0.5);
  updateHero(sNow, time); updateLine(sNow, time, dt); updateExtra(sNow, time); updateOpen(sNow, time, dt);
  camAt(sNow); camera.position.copy(camP); camera.lookAt(camL); camera.updateMatrixWorld();
  skyMesh.position.copy(camera.position);
  key.position.set(camP.x - 4, camP.y + 6, camP.z + 5); key.target.position.copy(camL); rim.position.set(camL.x + 5, camL.y + 2, camL.z - 4); rim.target.position.copy(camL);
  let white = 0; for (const y of TRANSIT) white = Math.max(white, 1 - smooth(2.5, 9, Math.abs(camera.position.y - y)));
  sky.uWhite.value = white; cloudU.uFog.value = 0.007 + white * 0.06;
  if (!COARSE && lineRoot.visible && sNow > 2.08 && sNow < 3.0 && ptr.cx >= 0 && !down) { const h = hitTest(ptr.cx, ptr.cy, items); const o = h ? owner(h.object) : null; if (o && o !== picked) showDetail(o); canvas.style.cursor = o ? 'pointer' : ''; }
  if ((sNow < 2.02 || sNow > 3.05) && picked) showDetail(null);
  updateClouds(dt, time); renderer.render(scene, camera); adapt(dt); requestAnimationFrame(frame);
}

// ---------- boot ----------
resize(); setPalette(0); scene.environment = buildEnv();
Promise.all([buildHero(), buildClouds()]).then(() => {
  document.documentElement.classList.add('ready'); requestAnimationFrame(frame);
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 250)); idle(() => { buildLine(); buildExtra(); buildOpen(); });
});
addEventListener('load', measure);
window.__ng3d = { get s() { return sNow; }, renderer, get opState() { return opState; } };
