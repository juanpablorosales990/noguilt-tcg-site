// NoGuilt 3D v2: "Golden hour above the clouds".
// One WebGL scene behind a normally scrolling page. Scroll drives the camera along a path that
// descends through cloud decks between scenes. Only NoGuilt's own products are 3D.
import * as THREE from 'three';

const $ = (s) => document.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const smooth = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x); };
const TEX = 'tex/';
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
let dpr = Math.min(devicePixelRatio, COARSE ? 1.5 : 1.75);
renderer.setPixelRatio(dpr);
const VW = () => canvas.clientWidth || innerWidth, VH = () => canvas.clientHeight || innerHeight;
renderer.setSize(VW(), VH(), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, VW() / VH(), 0.1, 400);

// ---------- sky (palette shifts with the story) ----------
const PAL = [ // afternoon -> golden -> dusk
  { z: '#4A4FA6', m: '#A7A3E6', h: '#F7D9C9', b: '#EFE6F4', lit: '#FFF8F1', sh: '#B6AEDD' },
  { z: '#5A4FA0', m: '#C8A3D8', h: '#FFD9B8', b: '#F4E2E6', lit: '#FFF4E6', sh: '#BFA6D6' },
  { z: '#2E2A6E', m: '#7E6BB8', h: '#F2B9A6', b: '#C9B7DA', lit: '#FBE8E2', sh: '#8E7FBF' },
].map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, new THREE.Color(v)])));
const sky = {
  uZenith: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uBelow: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(-0.45, 0.32, -1).normalize() }, uWhite: { value: 0 },
};
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
  fragmentShader: `${SKY_GLSL} varying vec3 vDir; float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){ gl_FragColor=vec4(skyColor(normalize(vDir)),1.0);
#include <colorspace_fragment>
gl_FragColor.rgb+=(hash(gl_FragCoord.xy)-0.5)/255.0; }`,
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), skyMat);
skyMesh.renderOrder = -2; skyMesh.frustumCulled = false; scene.add(skyMesh);
function setPalette(t) { // t 0..2
  const i = Math.min(1, Math.floor(t)), k = clamp(t - i), a = PAL[i], b = PAL[i + 1];
  sky.uZenith.value.lerpColors(a.z, b.z, k); sky.uMid.value.lerpColors(a.m, b.m, k);
  sky.uHorizon.value.lerpColors(a.h, b.h, k); sky.uBelow.value.lerpColors(a.b, b.b, k);
  cloudU.uLit.value.lerpColors(a.lit, b.lit, k); cloudU.uShade.value.lerpColors(a.sh, b.sh, k);
}

// ---------- environment for foil: soft sky + softboxes, baked once ----------
function buildEnv() {
  setPalette(0.6);
  const env = new THREE.Scene();
  const s = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat); s.renderOrder = -1; env.add(s);
  const box = (w, h, x, y, z, k, col = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  box(26, 12, -14, 26, 22, 5, 0xffe3c2);  // warm key, upper left front
  box(18, 8, 30, 8, -10, 2.2, 0xc9c2ff);  // cool rim, back right
  box(20, 6, 10, -2, 30, 1.2);            // soft front fill
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: '#6a6290' }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -14; env.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const t = pmrem.fromScene(env, 0.02).texture; pmrem.dispose(); return t;
}

const key = new THREE.DirectionalLight(0xffe3c2, 1.6); key.position.set(-4, 6, 5); scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xc9c2ff, 1.0); rim.position.set(5, 2, -4); scene.add(rim, rim.target);
const hemi = new THREE.HemisphereLight(0xf2ecff, 0xd9c6e6, 0.5); scene.add(hemi);

// ---------- clouds: instanced view-aligned billboards, sorted back-to-front ----------
const cloudU = {
  uMap: { value: null }, uGrid: { value: new THREE.Vector2(3, 2) },
  uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() },
  uFog: { value: 0.007 }, uNearK: { value: new THREE.Vector2(0.25, 0.8) }, uFar: { value: new THREE.Vector2(150, 220) },
};
const cloudVS = `
  attribute vec4 aData; uniform vec2 uGrid; uniform vec2 uNearK; uniform vec2 uFar;
  varying vec2 vUv; varying vec2 vLocal; varying vec3 vWorld; varying float vAlpha; varying float vDist;
  void main(){
    vec3 center=(modelMatrix*vec4(instanceMatrix[3].xyz,1.0)).xyz;
    vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
    vec3 up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
    vWorld=center+right*position.x*aData.x+up*position.y*aData.y;
    vec4 mv=viewMatrix*vec4(vWorld,1.0); gl_Position=projectionMatrix*mv;
    float d=-(viewMatrix*vec4(center,1.0)).z; vDist=-mv.z;
    vAlpha=aData.w*smoothstep(uNearK.x*aData.y,uNearK.y*aData.y,d)*(1.0-smoothstep(uFar.x,uFar.y,d));
    if(vAlpha<0.001) gl_Position=vec4(2.0,2.0,2.0,1.0);
    float t=aData.z+0.5; vec2 cell=vec2(floor(mod(t,uGrid.x)),uGrid.y-1.0-floor(t/uGrid.x));
    vec2 uvv=uv; if(aData.x<0.0) uvv.x=1.0-uvv.x;
    vUv=(cell+uvv)/uGrid; vLocal=position.xy; }`;
const cloudFS = `
  ${SKY_GLSL}
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
// world layout: scenes stacked by altitude, cloud decks below each scene and between them
const A = { hero: 0, lineup: -34, route: -68, open: -102 };
const DECKS = [
  { y: -6, n: 34 }, { y: -17, n: 30 }, // under hero, transit
  { y: -40, n: 34 }, { y: -51, n: 30 }, // under lineup, transit
  { y: -74, n: 34 }, { y: -85, n: 30 }, // under route, transit
  { y: -108, n: 34 },                   // under open
];
const TRANSIT = [-17, -51, -85];
let cloudMesh, cloudData; const clouds = [];
async function buildClouds() {
  const map = await new Promise((r) => new THREE.TextureLoader().load(TEX + (COARSE ? 'clouds-256.webp' : 'clouds-512.webp'), r));
  map.colorSpace = THREE.NoColorSpace; map.premultiplyAlpha = false;
  cloudU.uMap.value = map;
  const scale = COARSE ? 0.75 : 1, total = DECKS.reduce((s, d) => s + Math.round(d.n * scale), 0);
  const geo = new THREE.PlaneGeometry(1, 1);
  cloudData = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aData', cloudData);
  const mat = new THREE.ShaderMaterial({ uniforms: { ...sky, ...cloudU }, vertexShader: cloudVS, fragmentShader: cloudFS, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  cloudMesh = new THREE.InstancedMesh(geo, mat, total);
  cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); cloudMesh.frustumCulled = false; cloudMesh.renderOrder = 1;
  scene.add(cloudMesh);
  const r = rng(11);
  for (const d of DECKS) {
    const n = Math.round(d.n * scale), transit = TRANSIT.includes(d.y);
    for (let i = 0; i < n; i++) {
      const h = (transit ? 7 : 6) + r() * 7;
      let x = (r() * 2 - 1) * 48, z = -70 + r() * 76;
      if (!transit && Math.abs(x) < 7 && z > -6) z -= 12; // keep the product's own column clear
      clouds.push({ x, y: d.y + (r() * 2 - 1) * (transit ? 2.5 : 1.6), z, h, w: h * (2.0 + r() * 0.5) * (r() < 0.5 ? -1 : 1), tile: Math.floor(r() * 6), op: 0.82 + r() * 0.18, vx: REDUCE ? 0 : 0.25 + r() * 0.35, ph: r() * 6.28, depth: 0 });
    }
  }
}
const fwd = new THREE.Vector3();
function updateClouds(dt, t) {
  if (!cloudMesh) return;
  camera.getWorldDirection(fwd); const cp = camera.position;
  for (const c of clouds) { c.x += c.vx * dt; if (c.x > 48) c.x -= 96; c.depth = (c.x - cp.x) * fwd.x + (c.y - cp.y) * fwd.y + (c.z - cp.z) * fwd.z; }
  clouds.sort((a, b) => b.depth - a.depth);
  const m = cloudMesh.instanceMatrix.array, d = cloudData.array;
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i], o = i * 16, k = i * 4, br = 1 + 0.025 * Math.sin(t * 0.3 + c.ph);
    m[o] = 1; m[o + 5] = 1; m[o + 10] = 1; m[o + 15] = 1; m[o + 12] = c.x; m[o + 13] = c.y; m[o + 14] = c.z;
    d[k] = c.w * br; d[k + 1] = c.h * br; d[k + 2] = c.tile; d[k + 3] = c.op * (1 - smooth(36, 48, Math.abs(c.x)));
  }
  cloudMesh.instanceMatrix.needsUpdate = true; cloudData.needsUpdate = true;
}

// ---------- texture loading ----------
const loader = new THREE.TextureLoader(); const maxAniso = renderer.capabilities.getMaxAnisotropy(); const cache = new Map();
function tex(url) {
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((res) => loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); res(t); }, undefined, () => res(null)));
  cache.set(url, p); return p;
}

// ---------- pouch + card geometry ----------
const PW = 1, PH = PW * 1200 / 630, T = 0.055, TEAR = 0.905, CW = (382 / 630) * PW, CH = CW * 88 / 63;
const CARD_Y0 = (1 - 812.5 / 1200 - 0.5) * PH;
function puff(u, v) { const g = smooth(0.025, 0.075, v) * (1 - smooth(0.885, 0.925, v)); return T * Math.pow(Math.sin(Math.PI * clamp(u)), 0.55) * g; }
function pillow(u0, u1, v0, v1, side, nu = 40, nv = 60, lift = 0) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) { const v = v0 + (v1 - v0) * j / nv; for (let i = 0; i <= nu; i++) { const u = u0 + (u1 - u0) * i / nu; pos.push((u - 0.5) * PW, (v - 0.5) * PH, side * (puff(u, v) + lift)); uv.push(side > 0 ? u : 1 - u, v); } }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; if (side > 0) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
function rrShape(w, h, r) { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; }
const cardShape = rrShape(CW, CH, CW * 0.048);
const cardGeo = (() => { const g = new THREE.ShapeGeometry(cardShape, 6), p = g.attributes.position, uv = []; for (let i = 0; i < p.count; i++) uv.push(p.getX(i) / CW + 0.5, p.getY(i) / CH + 0.5); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g; })();
const cardEdgeGeo = new THREE.ExtrudeGeometry(cardShape, { depth: 0.003, bevelEnabled: false, curveSegments: 6 }); cardEdgeGeo.translate(0, 0, -0.0015);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xece8dc, roughness: 0.6 });
function holeMask() { const c = document.createElement('canvas'); c.width = 126; c.height = 240; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 126, 240); x.fillStyle = '#000'; x.beginPath(); x.roundRect(124 / 5, 547 / 5, 382 / 5, 531 / 5, 4); x.fill(); return new THREE.CanvasTexture(c); }
const foilIn = new THREE.MeshStandardMaterial({ color: 0xb4b0c4, metalness: 0.9, roughness: 0.35, side: THREE.BackSide, alphaMap: holeMask(), alphaTest: 0.5 });
const foilInB = new THREE.MeshStandardMaterial({ color: 0xb4b0c4, metalness: 0.9, roughness: 0.35, side: THREE.BackSide });
const plastic = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false });
const GEO = {};
function geos(lo) { const k = lo ? 'lo' : 'hi'; if (GEO[k]) return GEO[k]; const n = lo ? [24, 36, 6] : [44, 64, 10];
  return (GEO[k] = { bf: pillow(0, 1, 0, TEAR, 1, n[0], n[1]), bb: pillow(0, 1, 0, TEAR, -1, n[0], n[1]), tf: pillow(0, 1, TEAR, 1, 1, n[0], n[2]), tb: pillow(0, 1, TEAR, 1, -1, n[0], n[2]), win: pillow(124 / 630, 506 / 630, 1 - 1078 / 1200, 1 - 547 / 1200, 1, 18, 26, 0.0015) }); }
function foil(map, holed) { return new THREE.MeshPhysicalMaterial({ map, alphaTest: holed ? 0.5 : 0, metalness: 0.32, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.2, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 420], envMapIntensity: 1.15 }); }
function makePouch(front, back, { window: win = false, lo = false } = {}) {
  const g = geos(lo), mf = foil(front, win), mb = foil(back, false);
  const root = new THREE.Group(), body = new THREE.Group(), top = new THREE.Group();
  body.add(new THREE.Mesh(g.bf, mf), new THREE.Mesh(g.bb, mb));
  if (win) body.add(new THREE.Mesh(g.bf, foilIn), new THREE.Mesh(g.bb, foilInB), new THREE.Mesh(g.win, plastic));
  top.add(new THREE.Mesh(g.tf, mf), new THREE.Mesh(g.tb, mb));
  root.add(body, top); return { root, body, top };
}
function makeCard(front, back, kind) {
  const g = new THREE.Group();
  const fm = new THREE.MeshPhysicalMaterial({ map: front, alphaTest: 0.5, roughness: kind ? 0.2 : 0.4, metalness: kind ? 0.3 : 0.04, clearcoat: 1, clearcoatRoughness: 0.1, iridescence: kind === 2 ? 1 : kind === 1 ? 0.75 : 0, iridescenceIOR: 1.7, iridescenceThicknessRange: [250, 950] });
  const bm = new THREE.MeshPhysicalMaterial({ map: back, alphaTest: 0.5, roughness: 0.45, clearcoat: 0.6 });
  const f = new THREE.Mesh(cardGeo, fm); f.position.z = 0.0017; const b = new THREE.Mesh(cardGeo, bm); b.rotation.y = Math.PI; b.position.z = -0.0017;
  g.add(new THREE.Mesh(cardEdgeGeo, edgeMat), f, b); return g;
}
// soft shadow blob that sits on the clouds under a floating object
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(142,134,196,0.55)'); gr.addColorStop(1, 'rgba(142,134,196,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
function blob(w = 1.6, d = 0.9) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false })); m.rotation.x = -Math.PI / 2; m.renderOrder = 2; return m; }

// ---------- tweens ----------
let now = performance.now() / 1000; const tweens = [];
function tween(dur, fn, ez = ease) { return new Promise((r) => tweens.push({ t0: now, dur, fn, ez, r })); }
function runTweens() { for (let i = tweens.length - 1; i >= 0; i--) { const w = tweens[i], k = clamp((now - w.t0) / w.dur); w.fn(w.ez(k)); if (k >= 1) { tweens.splice(i, 1); w.r(); } } }

const ptr = { x: 0, y: 0, sx: 0, sy: 0, cx: -1, cy: -1 };
addEventListener('pointermove', (e) => { ptr.x = (e.clientX / innerWidth) * 2 - 1; ptr.y = (e.clientY / innerHeight) * 2 - 1; ptr.cx = e.clientX; ptr.cy = e.clientY; }, { passive: true });

// ---------- scene 1+2: hero pouch, tear, fan, the hit ----------
const CARDS = [{ t: 'c-charmander', k: 0 }, { t: 'c-squirtle', k: 0 }, { t: 'c-bulbasaur', k: 0 }, { t: 'c-charizard-ex', k: 1 }, { t: 'c-charizard-sir', k: 2 }];
const STACKZ = [0.006, 0.0, -0.006, 0.012, -0.012];
const heroRoot = new THREE.Group(); heroRoot.position.y = A.hero; scene.add(heroRoot);
let hero = null; const heroCards = []; const heroBlob = blob(1.5, 0.8); heroBlob.position.set(0, -1.75, 0); heroRoot.add(heroBlob);
async function buildHero() {
  const [f, b, back, ...fr] = await Promise.all([tex(TEX + 'dh-front.webp'), tex(TEX + 'dh-back.webp'), tex(TEX + 'c-back.webp'), ...CARDS.map((c) => tex(TEX + c.t + '.webp'))]);
  hero = makePouch(f, b, { window: true }); heroRoot.add(hero.root);
  CARDS.forEach((c, i) => { const m = makeCard(fr[i], back, c.k); m.position.set(0, CARD_Y0, STACKZ[i]); heroRoot.add(m); heroCards.push(m); });
}
function updateHero(s, time) {
  if (!hero) return;
  heroRoot.visible = s < 2.25; if (!heroRoot.visible) return;
  const e = clamp(s - 1), idle = 1 - seg(e, 0, 0.18);
  const P = hero.root;
  P.rotation.y = idle * (Math.sin(time * 0.5) * 0.12 + ptr.sx * 0.14) + (1 - idle) * ptr.sx * 0.08;
  P.rotation.x = idle * ptr.sy * 0.08; P.rotation.z = Math.sin(time * 0.37) * 0.03 * idle;
  P.position.y = Math.sin(time * 1.05) * 0.045;
  heroBlob.material.opacity = 0.9 - seg(e, 0.4, 0.6) * 0.9; heroBlob.scale.setScalar(1 - P.position.y * 0.6);
  const shake = seg(e, 0.04, 0.1) * (1 - seg(e, 0.1, 0.11)), tf = easeOut(seg(e, 0.1, 0.26));
  hero.top.position.set(lerp(0, 1.5, tf), lerp(0, 2.3, tf) + Math.sin(time * 50) * 0.006 * shake, lerp(0, 0.4, tf));
  hero.top.rotation.set(tf * 0.5, -tf * 0.4, -tf * 1.0 + Math.sin(time * 45) * 0.02 * shake); hero.top.visible = tf < 0.999;
  const fan = ease(seg(e, 0.44, 0.62)), hit = ease(seg(e, 0.64, 0.8));
  hero.body.position.set(0, -fan * 2.4, -fan * 1.4); hero.body.rotation.x = -fan * 0.4;
  const R = MOB ? 0.95 : 1.35;
  heroCards.forEach((c, k) => {
    const rise = ease(seg(e, 0.22 + k * 0.03, 0.4 + k * 0.03)), a = lerp(-0.62, 0.62, k / 4);
    const fx = Math.sin(a) * R * 1.25, fy = 0.3 + Math.cos(a) * 0.32 - 0.32, fz = 0.55 - Math.abs(a) * 0.5 + k * 0.002;
    let x = lerp(0, fx, fan), y = lerp(CARD_Y0 + rise * PH * 0.82, fy, fan), z = lerp(STACKZ[k] * (1 - rise) + rise * 0.02 * k, fz, fan);
    let ry = lerp(0, -a * 0.55, fan), rz = lerp(0, -a * 0.32, fan), sc = lerp(1, 1.06, fan);
    if (k === 4) { x = lerp(x, 0, hit); y = lerp(y, 0.12, hit); z = lerp(z, MOB ? 1.0 : 1.3, hit); sc = lerp(sc, 1.16, hit); ry = lerp(ry, ptr.sx * 0.45 + Math.sin(time * 0.7) * 0.2, hit); rz = lerp(rz, 0, hit); }
    else { z -= hit * 0.5; y -= hit * 0.05; }
    c.position.set(x, y, z); c.rotation.set(-fan * 0.04, ry, rz); c.scale.setScalar(sc);
  });
  const ex = ease(seg(s, 1.9, 2.06)); heroRoot.position.set(0, A.hero + ex * 5, -ex * 2);
  $('#count').textContent = String(Math.round(5 * seg(e, 0.22, 0.4)));
}

// ---------- scene 3: the lineup of 9 pouches ----------
const LINE = [
  { d: 'double-hit', n: 'Double Hit', c: '5 cards · 1 ultra rare + 1 holo' }, { d: 'holo', n: 'Holo', c: '12 cards · 1 holo or better' },
  { d: 'ultra-rare', n: 'Ultra Rare', c: '12 cards · 1 ultra rare' }, { d: 'mini', n: 'Mini', c: 'Starter pack' },
  { d: 'value', n: 'Value', c: '30 cards' }, { d: 'baseball', n: 'Baseball', c: 'Sports pack' },
  { d: 'basketball', n: 'Basketball', c: 'Sports pack' }, { d: 'football', n: 'Football', c: 'Sports pack' }, { d: 'soccer', n: 'Soccer', c: 'Sports pack' },
];
const lineRoot = new THREE.Group(); lineRoot.position.y = A.lineup; scene.add(lineRoot);
const pouches = []; let hovered = null;
function slots() { // loose constellation, same scale, staggered depth
  return MOB
    ? [[-1.1, 0.2, 0], [0.05, 0.55, -0.4], [1.15, 0.1, 0.1], [-0.55, -1.45, 0.4], [0.6, -1.3, -0.2], [-1.6, -3.0, -0.6], [-0.5, -3.2, 0.3], [0.6, -3.05, -0.3], [1.65, -2.9, -0.8]]
    : [[-2.9, 0.7, -0.6], [-1.55, -0.5, 0.4], [-0.25, 0.6, -0.2], [1.05, -0.6, 0.5], [2.35, 0.5, -0.4], [3.4, -0.5, -1.4], [-3.9, -0.8, -2.0], [4.3, 0.8, -2.6], [0.4, 1.9, -2.8]];
}
async function buildLineup() {
  const S = slots();
  await Promise.all(LINE.map(async (L, i) => {
    const [f, b] = await Promise.all([tex(`${TEX}p-${L.d}-front.webp`), tex(`${TEX}p-${L.d}-back.webp`)]);
    const p = makePouch(f, b, { lo: true }); p.root.userData = { i, L, base: new THREE.Vector3(...S[i]), lift: 0, ph: i * 1.3 };
    p.root.scale.setScalar(0.92); lineRoot.add(p.root);
    const bl = blob(1.2, 0.6); bl.position.set(S[i][0], -3.0, S[i][2]); lineRoot.add(bl); p.root.userData.blob = bl;
    pouches.push(p.root);
  }));
}
function updateLineup(s, time, dt) {
  lineRoot.visible = s > 1.95 && s < 3.25; if (!lineRoot.visible) return;
  const w = s - 2;
  pouches.forEach((p) => {
    const u = p.userData, k = expoOut(seg(w, 0.05 + u.i * 0.025, 0.4 + u.i * 0.025));
    u.lift = lerp(u.lift, hovered === p ? 1 : 0, 1 - Math.pow(0.0005, dt));
    p.position.set(u.base.x, u.base.y + Math.sin(time * 0.9 + u.ph) * 0.06 + u.lift * 0.25 - (1 - k) * 2.5, u.base.z + u.lift * 0.5);
    p.rotation.set(Math.sin(time * 0.5 + u.ph) * 0.03, lerp(Math.sin(time * 0.35 + u.ph) * 0.18 - u.base.x * 0.05, ptr.sx * 0.15, u.lift), Math.sin(time * 0.6 + u.ph) * 0.05 * (1 - u.lift));
    p.visible = k > 0.001; u.blob.material.opacity = k * 0.6;
  });
  const lab = $('#plabel');
  if (hovered) {
    const v = hovered.getWorldPosition(new THREE.Vector3()); v.y -= 1.15; v.project(camera);
    lab.style.transform = `translate(${(v.x * 0.5 + 0.5) * VW()}px, ${(-v.y * 0.5 + 0.5) * VH()}px) translate(-50%, 0)`;
  }
}
function setHover(p) {
  if (hovered === p) return; hovered = p; const lab = $('#plabel');
  if (p) { $('#plabel b').textContent = p.userData.L.n; $('#plabel span').textContent = p.userData.L.c; lab.classList.add('on'); canvas.style.cursor = 'pointer'; }
  else { lab.classList.remove('on'); canvas.style.cursor = ''; }
}

// ---------- scene 4: the route (contrail) ----------
const routeRoot = new THREE.Group(); routeRoot.position.y = A.route; scene.add(routeRoot);
let trail = null, trailMat = null;
function buildRoute() {
  const W = MOB ? 3.0 : 7.5; const pts = [new THREE.Vector3(-W, -1.4, -9), new THREE.Vector3(-W * 0.45, 1.3, -6), new THREE.Vector3(W * 0.1, 2.0, -5), new THREE.Vector3(W * 0.6, 1.0, -6), new THREE.Vector3(W, -1.2, -9)];
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 240, 0.045, 10, false);
  trailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, uniforms: { uP: { value: 0 }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uP; uniform float uT; varying vec2 vUv;
      void main(){ float head=smoothstep(uP,uP-0.02,vUv.x); float tail=smoothstep(0.0,0.08,vUv.x);
        float shimmer=0.85+0.15*sin(vUv.x*60.0-uT*3.0);
        vec3 c=mix(vec3(1.0,0.55,0.85),vec3(1.0,0.86,0.45),vUv.x);
        gl_FragColor=vec4(mix(c,vec3(1.0),0.15)*shimmer*1.15,head*tail);
#include <colorspace_fragment>
}`,
  });
  trail = new THREE.Mesh(geo, trailMat); routeRoot.add(trail);
  const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.22, 12, false), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, uniforms: trailMat.uniforms,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uP; varying vec2 vUv; varying vec3 vN; void main(){ float head=smoothstep(uP,uP-0.03,vUv.x)*smoothstep(0.0,0.08,vUv.x);
      float f=pow(abs(vN.z),2.0); gl_FragColor=vec4(1.0,0.86,0.92,head*f*0.45);
#include <colorspace_fragment>
}`,
  }));
  routeRoot.add(glow);
  routeRoot.userData.curve = curve;
  Promise.all(['double-hit', 'holo', 'soccer', 'ultra-rare', 'basketball'].map((d) => Promise.all([tex(`${TEX}p-${d}-front.webp`), tex(`${TEX}p-${d}-back.webp`)]))).then((ts) => {
    ts.forEach(([f, b], i) => { const p = makePouch(f, b, { lo: true }); p.root.scale.setScalar(0.5); p.root.userData.off = i / ts.length; routeRoot.add(p.root); travellers.push(p.root); });
  });
}
const travellers = [];
function updateRoute(s, time) {
  routeRoot.visible = s > 2.95 && s < 4.25; if (!routeRoot.visible || !trailMat) return;
  const r = s - 3, p = ease(seg(r, 0.08, 0.6));
  trailMat.uniforms.uP.value = p * 1.02; trailMat.uniforms.uT.value = time;
  const labs = document.querySelectorAll('.city');
  labs.forEach((el) => {
    const at = +el.dataset.at, on = p > at;
    el.classList.toggle('on', on);
    const v = routeRoot.userData.curve.getPointAt(at).clone().add(routeRoot.position); v.project(camera);
    const hw = el.offsetWidth / 2 + 10; el.style.transform = `translate(${clamp((v.x * 0.5 + 0.5) * VW(), hw, VW() - hw)}px, ${(-v.y * 0.5 + 0.5) * VH()}px) translate(-50%, -140%)`;
  });
  travellers.forEach((m) => {
    const u = (m.userData.off + time * 0.045) % 1, vis = u < p - 0.02;
    m.visible = vis; if (!vis) return;
    const c = routeRoot.userData.curve; m.position.copy(c.getPointAt(u)); m.position.y += 0.22;
    const tg = c.getTangentAt(u); m.rotation.set(0, Math.atan2(tg.x, tg.z) - Math.PI / 2 + 0.35, Math.atan2(tg.y, Math.hypot(tg.x, tg.z)) * 0.6 + Math.sin(time * 1.3 + u * 9) * 0.06);
  });
  const n = Math.round(10000 * ease(seg(r, 0.22, 0.5)));
  $('#stores').textContent = n.toLocaleString('en-US') + (n >= 10000 ? '+' : '');
}

// ---------- scene 5: open a pack ----------
const openRoot = new THREE.Group(); openRoot.position.y = A.open; scene.add(openRoot);
let op = null; const opCards = []; let opState = 0, opBusy = false; const opBlob = blob(1.5, 0.8); opBlob.position.set(0, -1.75, 0); openRoot.add(opBlob);
async function buildOpen() {
  if (op) return;
  const [f, b, back, ...fr] = await Promise.all([tex(TEX + 'dh-front.webp'), tex(TEX + 'dh-back.webp'), tex(TEX + 'c-back.webp'), ...CARDS.map((c) => tex(TEX + c.t + '.webp'))]);
  op = makePouch(f, b, { window: true }); openRoot.add(op.root);
  CARDS.forEach((c, i) => { const m = makeCard(fr[i], back, c.k); openRoot.add(m); opCards.push(m); });
  resetOpen();
}
function resetOpen() {
  opState = 0; op.top.position.set(0, 0, 0); op.top.rotation.set(0, 0, 0); op.top.visible = true; op.body.position.set(0, 0, 0); op.body.rotation.set(0, 0, 0);
  opCards.forEach((m, i) => { m.position.set(0, CARD_Y0, STACKZ[i]); m.rotation.set(0, 0, 0); m.scale.setScalar(1); });
  $('#openhint').textContent = 'Tap the pack'; $('#again').hidden = true; $('#openbtn').hidden = false; $('#hitmsg').classList.remove('on');
}
async function tapOpen() {
  if (!op || opBusy || opState === 6) return; opBusy = true;
  if (opState === 0) {
    await tween(0.18, (k) => { op.top.position.x = Math.sin(k * 40) * 0.01; });
    await tween(0.6, (k) => { op.top.position.set(1.3 * k, 2.0 * k, 0.4 * k); op.top.rotation.set(0.5 * k, -0.4 * k, -1.1 * k); }, easeOut);
    op.top.visible = false;
    tween(0.7, (k) => { op.body.position.set(0, -0.6 * k, -0.6 * k); });
    await Promise.all(opCards.map((m, i) => tween(0.75, (k) => { m.position.y = CARD_Y0 + k * 1.05; m.position.z = 0.3 * k + (4 - i) * 0.004; })));
    opState = 1; $('#openhint').textContent = 'Tap to reveal';
  } else {
    const i = opState - 1, m = opCards[i], slot = i, y0 = m.position.y, z0 = m.position.z;
    if (i === 4) {
      await tween(0.9, (k) => { m.position.set(0, lerp(y0, 0.15, k), lerp(z0, 1.3, k)); m.rotation.y = Math.sin(k * Math.PI) * 0.6; m.scale.setScalar(lerp(1, 1.15, k)); });
      $('#hitmsg').classList.add('on'); burst(); $('#openhint').textContent = 'Double Hit.'; $('#again').hidden = false; $('#openbtn').hidden = true; opState = 6;
    } else {
      const x = (MOB ? -0.32 : -1.45) + slot * (MOB ? 0.16 : 0.34);
      await tween(0.55, (k) => { m.position.set(lerp(0, x, k), lerp(y0, MOB ? -0.35 : 0.55, k) + Math.sin(k * Math.PI) * 0.3, lerp(z0, 0.4 + slot * 0.02, k)); m.rotation.z = lerp(0, MOB ? 0 : 0.08 - slot * 0.04, k); m.scale.setScalar(lerp(1, MOB ? 0.42 : 0.62, k)); });
      opState++; if (opState === 5) $('#openhint').textContent = 'The last card';
    }
  }
  opBusy = false;
}
const sparks = (() => { const n = 200, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ size: 0.05, color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }); openRoot.add(new THREE.Points(g, m)); return { g, p, v, m, n, t: 9 }; })();
function burst() { for (let i = 0; i < sparks.n; i++) { sparks.p.set([0, 0.15, 1.3], i * 3); const d = new THREE.Vector3().randomDirection().multiplyScalar(1.2 + Math.random() * 2); sparks.v.set([d.x, d.y, d.z * 0.5], i * 3); } sparks.t = 0; sparks.m.opacity = 1; }
function updateOpen(s, time, dt) {
  openRoot.visible = s > 3.95; if (!op || !openRoot.visible) return;
  if (opState === 0) { op.root.rotation.y = Math.sin(time * 0.6) * 0.12 + ptr.sx * 0.2; op.root.position.y = Math.sin(time * 1.05) * 0.045; } else op.root.rotation.y *= 0.92;
  opBlob.material.opacity = opState === 0 ? 0.9 : 0.4;
  if (opState === 6) opCards[4].rotation.y = Math.sin(time * 0.8) * 0.3 + ptr.sx * 0.4;
  if (sparks.t < 2) { sparks.t += dt; for (let i = 0; i < sparks.n; i++) { sparks.v[i * 3 + 1] -= 2.4 * dt; for (let a = 0; a < 3; a++) sparks.p[i * 3 + a] += sparks.v[i * 3 + a] * dt; } sparks.g.attributes.position.needsUpdate = true; sparks.m.opacity = clamp(1 - sparks.t / 1.8); }
}

// ---------- camera path ----------
let K = [];
function buildPath() {
  const M = MOB, hx = M ? 0 : -0.95, hy = M ? 1.5 : 0;
  K = [
    { s: 0.0, p: [0, 0.35, M ? 7.2 : 5.0], l: [hx, hy, 0] },
    { s: 1.0, p: [0, 0.2, M ? 6.8 : 4.7], l: [hx, hy, 0] },
    { s: 1.25, p: [0.2, 0.15, M ? 6.2 : 4.2], l: [hx * 0.85, hy * 0.75 + 0.1, 0] },
    { s: 1.6, p: [0, 0.35, M ? 6.6 : 5.0], l: [hx * 0.65, hy * 0.6 + 0.25, 0.3] },
    { s: 1.9, p: [0, 0.3, M ? 6.2 : 4.6], l: [hx * 0.6, hy * 0.55 + 0.2, 0.4] },
    { s: 2.12, p: [0, A.lineup + 1.2, M ? 13 : 11.5], l: [M ? 0 : -1.6, A.lineup + (M ? 1.9 : 0.1), 0] },
    { s: 2.95, p: [0, A.lineup + 0.4, M ? 12.2 : 10.2], l: [M ? 0 : -1.6, A.lineup + (M ? 1.9 : 0.1), 0] },
    { s: 3.12, p: [0, A.route + 0.4, M ? 15 : 12], l: [0, A.route + (M ? 1.6 : 0.6), -6] },
    { s: 3.95, p: [0.5, A.route + 0.2, M ? 13.5 : 10.8], l: [0, A.route + (M ? 1.6 : 0.6), -6] },
    { s: 4.12, p: [0, A.open + 0.15, M ? 7.0 : 4.8], l: [M ? 0 : -0.75, A.open + (M ? 1.1 : 0.2), 0] },
    { s: 9.0, p: [0, A.open + 0.15, M ? 7.0 : 4.8], l: [M ? 0 : -0.75, A.open + (M ? 1.1 : 0.2), 0] },
  ];
}
const camP = new THREE.Vector3(), camL = new THREE.Vector3();
function camAt(s) { let i = 0; while (i < K.length - 2 && s > K[i + 1].s) i++; const a = K[i], b = K[i + 1], t = ease(seg(s, a.s, b.s));
  camP.set(lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)); camL.set(lerp(a.l[0], b.l[0], t), lerp(a.l[1], b.l[1], t), lerp(a.l[2], b.l[2], t)); }

// ---------- scroll -> story ----------
const secs = [...document.querySelectorAll('[data-s]')]; let tops = [];
function measure() { tops = secs.map((e) => ({ top: e.offsetTop, h: e.offsetHeight })); }
function storyTarget() { const y = scrollY + innerHeight * 0.5; for (let k = secs.length - 1; k >= 0; k--) if (y >= tops[k].top) return k + clamp((y - tops[k].top) / Math.max(1, tops[k].h)); return 0; }
let sNow = 0;

// ---------- input ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
function hitTest(x, y, objs) { ndc.set((x / VW()) * 2 - 1, -(y / VH()) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.intersectObjects(objs, true)[0]; }
function ownerPouch(o) { while (o && !pouches.includes(o)) o = o.parent; return o; }
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', (e) => {
  if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10; down = null; if (moved) return;
  if (lineRoot.visible && sNow > 2.1 && sNow < 3.0) { const h = hitTest(e.clientX, e.clientY, pouches); setHover(h ? ownerPouch(h.object) : null); }
  if (openRoot.visible && sNow > 4.05 && op) { const h = hitTest(e.clientX, e.clientY, [openRoot]); if (h) tapOpen(); }
});
$('#again').addEventListener('click', resetOpen); $('#openbtn').addEventListener('click', tapOpen);

// ---------- loop ----------
let last = performance.now(), running = true, acc = 0, frames = 0;
let lastW = 0, lastH = 0;
function resize() { const w = VW(), h = VH(); MOB = matchMedia('(max-width: 760px)').matches; measure(); buildPath(); if (w === lastW && h === lastH) return; lastW = w; lastH = h; camera.aspect = w / h; camera.fov = MOB ? 42 : 35; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); }
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 120); });
document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { last = performance.now(); requestAnimationFrame(frame); } });
function adapt(dt) { acc += dt; frames++; if (acc < 1.5) return; const ms = (1000 * acc) / frames; acc = frames = 0; if (ms > 22 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); renderer.setSize(VW(), VH(), false); } }
function frame(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - last) / 1000); last = t; now = t / 1000;
  const target = storyTarget(); sNow += (target - sNow) * (1 - Math.exp(-dt * (REDUCE ? 30 : 6))); if (Math.abs(target - sNow) < 1e-4) sNow = target;
  ptr.sx += (ptr.x - ptr.sx) * (1 - Math.exp(-dt * 3)); ptr.sy += (ptr.y - ptr.sy) * (1 - Math.exp(-dt * 3));
  runTweens();
  const time = REDUCE ? 0 : now;
  setPalette(clamp((sNow - 0.5) / 2.0, 0, 1) + clamp((sNow - 3.2) / 0.9, 0, 1));
  updateHero(sNow, time); updateLineup(sNow, time, dt); updateRoute(sNow, time); updateOpen(sNow, time, dt);
  camAt(sNow); camera.position.copy(camP); camera.lookAt(camL); camera.updateMatrixWorld();
  skyMesh.position.copy(camera.position);
  key.position.set(camP.x - 4, camP.y + 6, camP.z + 5); key.target.position.copy(camL); rim.position.set(camL.x + 5, camL.y + 2, camL.z - 4); rim.target.position.copy(camL);
  let white = 0; for (const y of TRANSIT) white = Math.max(white, 1 - smooth(2.5, 9, Math.abs(camera.position.y - y)));
  sky.uWhite.value = white; cloudU.uFog.value = 0.007 + white * 0.06;
  if (!COARSE && lineRoot.visible && sNow > 2.1 && sNow < 3.0 && ptr.cx >= 0 && !down) { const h = hitTest(ptr.cx, ptr.cy, pouches); setHover(h ? ownerPouch(h.object) : null); } else if (sNow <= 2.05 || sNow >= 3.05) setHover(null);
  updateClouds(dt, time);
  renderer.render(scene, camera);
  adapt(dt);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
resize(); setPalette(0);
scene.environment = buildEnv();
Promise.all([buildHero(), buildClouds()]).then(() => {
  document.documentElement.classList.add('ready'); requestAnimationFrame(frame);
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(() => { buildLineup(); buildRoute(); buildOpen(); });
});
addEventListener('load', measure);
window.__ng3d = { get s() { return sNow; }, renderer };
