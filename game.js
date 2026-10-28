/* =====================================================================
   TURBO CIRCUIT 3D
   Corrida arcade em Three.js: pista, física, IA, voltas, som e minimapa.
   Fluxo: init() -> createTrack() -> createEnvironment() -> loadCar()
          -> animate() (updatePhysics, updateAI, checkLaps, updateCamera, updateHUD)
   ===================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------- CONFIGURAÇÕES ---------- */
const RACE = { laps: 3, countdownLength: 3.6 };

const TRACK = {
  samples: 700,               // resolução da pista
  halfWidth: 9,               // metade da largura do asfalto
  kerbNormal: 0.8,
  kerbCorner: 1.6,
  cornerThreshold: 0.045,
  wallHeight: 1.2,
};
TRACK.wallDist = TRACK.halfWidth + 1.8;
TRACK.carLimit = TRACK.halfWidth + 0.8;

const CAR = { length: 4.6, wheelRadius: 0.45 };

const PHYS = {
  accel: 26, maxSpeed: 58, brake: 40, reverseAccel: 12, reverseMax: 16,
  coast: 0.5, handbrakeDecel: 12, maxSteer: 0.55, steerResponse: 9, yawRate: 2.6,
  grip: 12, gripHandbrake: 2.2, wallBounce: 1.3, wallScrape: 0.985,
};

const RIVAL_CONFIG = [
  { name: 'AZUL',    speed: 36, lane: 2.4,  color: 0x1e5bd8 },
  { name: 'AMARELO', speed: 42, lane: -2.4, color: 0xf2c200 },
];

const COLORS = {
  red: 0xe10600, white: 0xf2f2f2, asphalt: 0x3a3d44, grass: 0x3f8f3f,
  playerBody: 0xd7000f,
};

const CONTROL_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

/* ---------- ESTADO ---------- */
let renderer, scene, camera, sun, curve, clock;
let player;
const rivals = [];
let character = null;
let hud = {};
const mm = {};                          // dados do minimapa
const camTarget = new THREE.Vector3();
const keys = new Set();
const track = { length: 0, center: [], tan: [], side: [], corner: [] };
const skid = { pool: [], idx: 0 };
const audio = { ctx: null };

const game = {
  state: 'countdown',        // 'countdown' | 'racing' | 'finished'
  paused: false,
  countdownT: 0,
  countdownLabel: null,
  raceTime: 0,
  best: loadBestLap(),
  shake: 0,
};

/* ---------- INICIALIZAÇÃO ---------- */
function init() {
  cacheHud();

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe9f7, 200, 720);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);

  createSky();
  createLights();
  createTrack();
  createEnvironment();
  createFinishLine();
  createSkidPool();

  player = loadCar(COLORS.playerBody);
  scene.add(player.root);

  for (const cfg of RIVAL_CONFIG) {
    const r = loadCar(cfg.color);
    Object.assign(r, { isAI: true, name: cfg.name, color: cfg.color, speed: cfg.speed,
      lane: cfg.lane, s: 0, finished: false, finishTime: null });
    rivals.push(r);
    scene.add(r.root);
  }

  createMinimap();
  resetRace();
  updateCamera(1);
  bindEvents();

  clock = new THREE.Clock();
  loadAssets();
  window.gameReady = true;
  animate();
}

function createSky() {
  const geo = new THREE.SphereGeometry(1200, 32, 16);
  const pos = geo.attributes.position;
  const horizon = new THREE.Color(0xcfe9f7);
  const zenith = new THREE.Color(0x3d7fd1);
  const c = new THREE.Color();
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 1200, 0, 1);
    c.lerpColors(horizon, zenith, Math.pow(t, 0.5));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false,
  })));
}

function createLights() {
  scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x4a7a3a, 1.0));
  sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -300; c.right = 300; c.top = 300; c.bottom = -300; c.near = 10; c.far = 800;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
}

/* ---------- CENÁRIO ---------- */
function createEnvironment() {
  // Chão
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ color: COLORS.grass, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Montanhas ao fundo
  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x5b7c6a, roughness: 1, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
    const r = 640 + Math.random() * 120;
    const h = 140 + Math.random() * 160;
    const m = new THREE.Mesh(new THREE.ConeGeometry(110 + Math.random() * 90, h, 6), mountainMat);
    m.position.set(Math.cos(a) * r, h / 2 - 10, Math.sin(a) * r);
    scene.add(m);
  }

  // Árvores espalhadas (fora da pista)
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 2.6, 6).translate(0, 1.3, 0);
  const crownGeo = new THREE.ConeGeometry(2.1, 5, 7).translate(0, 4.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 });
  let placed = 0, tries = 0;
  while (placed < 220 && tries < 3000) {
    tries++;
    const x = (Math.random() - 0.5) * 900;
    const z = (Math.random() - 0.5) * 900;
    const i = nearestIndex(x, z);
    if (Math.hypot(track.center[i].x - x, track.center[i].z - z) < TRACK.wallDist + 8) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    const crown = new THREE.Mesh(crownGeo, crownMat);
    trunk.castShadow = crown.castShadow = true;
    tree.add(trunk, crown);
    tree.scale.setScalar(0.8 + Math.random() * 0.7);
    tree.position.set(x, 0, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    scene.add(tree);
    placed++;
  }

  // Postes de luz ao longo da pista
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d9, emissive: 0xfff0b0, emissiveIntensity: 0.8 });
  const N = TRACK.samples;
  for (let i = 0; i < N; i += 50) {
    for (const sg of [1, -1]) {
      const c = track.center[i], s = track.side[i];
      const off = TRACK.wallDist + 1.8;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 9, 8), poleMat);
      pole.position.set(c.x + s.x * off * sg, 4.5, c.z + s.z * off * sg);
      pole.castShadow = true;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.6), lampMat);
      lamp.position.set(c.x + s.x * (off - 0.9) * sg, 9.0, c.z + s.z * (off - 0.9) * sg);
      scene.add(pole, lamp);
    }
  }

  // Arquibancada perto da largada
  buildGrandstand(30);
}

function buildGrandstand(index) {
  const c = track.center[index], s = track.side[index];
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x6e7785, roughness: 0.6, metalness: 0.4 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xe9ecf1, roughness: 0.5 });
  const width = 26, tiers = 4;

  for (let t = 0; t < tiers; t++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(width, 0.9 * (t + 1), 1.6), steel);
    step.position.set(0, 0.45 * (t + 1), -t * 1.6);
    step.castShadow = step.receiveShadow = true;
    group.add(step);
  }
  const palette = [0xe10600, 0x1e5bd8, 0xffd400, 0xffffff, 0x2e7d32, 0xff7a00];
  for (let k = 0; k < 90; k++) {
    const t = Math.floor(Math.random() * tiers);
    const spectator = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.6, 0.4),
      new THREE.MeshStandardMaterial({ color: palette[k % palette.length], roughness: 0.8 })
    );
    spectator.position.set((Math.random() - 0.5) * (width - 2), 0.9 * (t + 1) + 0.3, -t * 1.6 + 0.3);
    group.add(spectator);
  }
  const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(width + 1, 0.3, 6), roof);
  roofMesh.position.set(0, 4.8, -3);
  roofMesh.castShadow = true;
  group.add(roofMesh);

  // Fica do lado de fora, virada para a pista
  const off = TRACK.halfWidth + 9;
  group.position.set(c.x - s.x * off, 0, c.z - s.z * off);
  group.rotation.y = Math.atan2(s.x, s.z);
  scene.add(group);
}

/* ---------- PISTA ---------- */
function createTrack() {
  const controlPts = [];
  const K = 14;
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    const r = 130 + 28 * Math.sin(3 * a) + 12 * Math.cos(5 * a);
    controlPts.push(new THREE.Vector3(Math.cos(a) * r * 1.25, 0, Math.sin(a) * r));
  }
  curve = new THREE.CatmullRomCurve3(controlPts, true, 'centripetal');
  track.length = curve.getLength();

  const N = TRACK.samples;
  const pts = curve.getSpacedPoints(N);
  for (let i = 0; i < N; i++) track.center.push(pts[i].setY(0));

  for (let i = 0; i < N; i++) {
    const prev = track.center[(i - 1 + N) % N];
    const next = track.center[(i + 1) % N];
    const t = new THREE.Vector3().subVectors(next, prev).normalize();
    track.tan.push(t);
    track.side.push(new THREE.Vector3(-t.z, 0, t.x));
  }
  for (let i = 0; i < N; i++) {
    const a = track.tan[(i - 3 + N) % N];
    const b = track.tan[(i + 3) % N];
    track.corner.push(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) > TRACK.cornerThreshold);
  }

  // Asfalto
  const road = buildRibbon(
    loopPoints(() => TRACK.halfWidth, 0.02),
    loopPoints(() => -TRACK.halfWidth, 0.02),
    () => COLORS.asphalt
  );
  road.castShadow = false;
  road.receiveShadow = true;
  scene.add(road);

  // Linha central tracejada
  const dashes = buildRibbon(
    loopPoints(() => 0.12, 0.025),
    loopPoints(() => -0.12, 0.025),
    i => (Math.floor(i / 6) % 2 ? 0xe8e8e8 : COLORS.asphalt)
  );
  dashes.castShadow = false;
  dashes.receiveShadow = true;
  scene.add(dashes);

  // Zebras vermelho/branco nas bordas (mais largas nas curvas)
  for (const sign of [1, -1]) {
    const kerb = buildRibbon(
      loopPoints(j => sign * (TRACK.halfWidth + (track.corner[j] ? TRACK.kerbCorner : TRACK.kerbNormal)), 0.03),
      loopPoints(() => sign * TRACK.halfWidth, 0.03),
      i => (Math.floor(i / 4) % 2 ? COLORS.red : COLORS.white)
    );
    kerb.castShadow = false;
    kerb.receiveShadow = true;
    scene.add(kerb);
  }

  // Barreiras laterais
  for (const sign of [1, -1]) {
    const wall = buildRibbon(
      loopPoints(() => sign * TRACK.wallDist, 0),
      loopPoints(() => sign * TRACK.wallDist, TRACK.wallHeight),
      i => (Math.floor(i / 3) % 2 ? COLORS.red : COLORS.white)
    );
    wall.receiveShadow = true;
    scene.add(wall);
  }
}

function loopPoints(offsetOf, y) {
  const N = track.center.length;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const j = i % N;
    const o = offsetOf(j);
    pts.push(new THREE.Vector3(
      track.center[j].x + track.side[j].x * o, y,
      track.center[j].z + track.side[j].z * o
    ));
  }
  return pts;
}

function buildRibbon(A, B, colorFn) {
  const pos = [], col = [];
  const c = new THREE.Color();
  for (let i = 0; i < A.length - 1; i++) {
    c.set(colorFn(i));
    const a0 = A[i], a1 = A[i + 1], b0 = B[i], b1 = B[i + 1];
    pos.push(
      a0.x, a0.y, a0.z,  b0.x, b0.y, b0.z,  a1.x, a1.y, a1.z,
      a1.x, a1.y, a1.z,  b0.x, b0.y, b0.z,  b1.x, b1.y, b1.z
    );
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
  }));
  mesh.castShadow = true;
  return mesh;
}

function createFinishLine() {
  const cvs = document.createElement('canvas');
  cvs.width = 256; cvs.height = 64;
  const g = cvs.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? '#111111' : '#f5f5f5';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;

  const c = track.center[0], t = track.tan[0], s = track.side[0];
  const heading = Math.atan2(t.x, t.z);

  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK.halfWidth * 2, 2.2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })
  );
  line.rotation.order = 'YXZ';
  line.rotation.set(-Math.PI / 2, heading, 0);
  line.position.set(c.x, 0.05, c.z);
  line.receiveShadow = true;
  scene.add(line);

  const postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
  const bannerMat = new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.6 });
  const off = TRACK.halfWidth + 2.5;
  for (const sg of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), postMat);
    post.position.set(c.x + s.x * off * sg, 3.5, c.z + s.z * off * sg);
    post.castShadow = true;
    scene.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(off * 2 + 0.8, 1.4, 0.3), bannerMat);
  banner.rotation.y = heading;
  banner.position.set(c.x, 6.8, c.z);
  banner.castShadow = true;
  scene.add(banner);
}

/* Marcas de pneu (derrapagem): pool reutilizável */
function createSkidPool() {
  const geo = new THREE.PlaneGeometry(0.4, 1.4).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 260; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    skid.pool.push(m);
  }
}

function spawnSkid(x, z, heading) {
  const m = skid.pool[skid.idx];
  skid.idx = (skid.idx + 1) % skid.pool.length;
  m.position.set(x, 0.045, z);
  m.rotation.y = heading;
  m.visible = true;
}

function clearSkids() {
  for (const m of skid.pool) m.visible = false;
  skid.idx = 0;
}

/* ---------- CARROS ---------- */
function loadCar(color) {
  const root = new THREE.Group();
  const visual = new THREE.Group();
  root.add(visual);
  visual.add(buildBlockCar(color));
  return {
    root, visual,
    wheels: collectWheels(visual),
    vel: new THREE.Vector3(),
    heading: 0, steer: 0, wheelAngle: 0, lat: 0, drifting: false, skidTimer: 0,
    idx: 0, lastIdx: 0, cps: [false, false, false],
    laps: 0, lapStart: 0, lapTimes: [],
    dist: 0, finished: false, finishTime: null,
    isAI: false, name: 'VOCÊ', color: 0xd7000f, speed: 0, lane: 0, s: 0,
  };
}

function buildBlockCar(color) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 0.15, metalness: 0.6 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.3, metalness: 0.9 });

  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
  };
  add(new THREE.BoxGeometry(1.9, 0.45, 4.2), paint, 0, 0.5, 0);
  add(new THREE.BoxGeometry(1.4, 0.3, 1.0), paint, 0, 0.4, 2.5);
  add(new THREE.BoxGeometry(1.45, 0.5, 1.9), glass, 0, 1.0, -0.2);
  add(new THREE.BoxGeometry(1.4, 0.12, 1.6), paint, 0, 1.3, -0.2);
  add(new THREE.BoxGeometry(2.0, 0.08, 0.55), paint, 0, 1.3, -2.1);
  add(new THREE.BoxGeometry(0.12, 0.6, 0.12), dark, -0.6, 0.95, -2.0);
  add(new THREE.BoxGeometry(0.12, 0.6, 0.12), dark, 0.6, 0.95, -2.0);

  const tireGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.42, 18).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.44, 12).rotateZ(Math.PI / 2);
  const spots = [[-0.95, 1.45, true], [0.95, 1.45, true], [-0.95, -1.4, false], [0.95, -1.4, false]];
  for (const [x, z, front] of spots) {
    const pivot = makeWheelPivot(x, CAR.wheelRadius, z, front);
    const tire = new THREE.Mesh(tireGeo, dark);
    const rim = new THREE.Mesh(rimGeo, silver);
    tire.castShadow = true;
    pivot.add(tire, rim);
    group.add(pivot);
  }
  return group;
}

function makeWheelPivot(x, y, z, front) {
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  pivot.position.set(x, y, z);
  pivot.userData.isWheel = true;
  pivot.userData.front = front;
  return pivot;
}

function collectWheels(root) {
  const list = [];
  root.traverse(o => { if (o.userData && o.userData.isWheel) list.push(o); });
  return list;
}

/* ---------- MODELOS 3D EMBUTIDOS ---------- */
async function loadAssets() {
  setStatus('Carregando modelos 3D…');
  try {
    const loader = new GLTFLoader();
    const parse = b64 => new Promise((res, rej) => {
      if (!b64 || b64.startsWith('__')) return rej(new Error('modelo não incluído'));
      loader.parse(base64ToArrayBuffer(b64), '', res, rej);
    });
    const safe = p => p.catch(e => { console.warn(e.message); return null; });

    const [rivalG, charG] = await Promise.all([
      safe(parse(window.EMBEDDED_MODELS.rival)),
      safe(parse(window.EMBEDDED_MODELS.character)),
    ]);

    // Todos os carros usam o gumball: o jogador e os dois rivais
    if (rivalG) {
      const carHolder = prepareCarModel(rivalG.scene, /cylinder/i);
      swapVisual(player, carHolder);
      for (const r of rivals) swapVisual(r, carHolder.clone());
    }
    if (charG) addCharacter(charG);

    const loaded = [rivalG, charG].filter(Boolean).length;
    setStatus(loaded === 2 ? 'Modelos 3D carregados' : 'Alguns modelos não carregaram: usando blocos');
  } catch (err) {
    console.error(err);
    setStatus('Usando carros de blocos');
  }
  setTimeout(() => hud.status.classList.add('hide'), 3000);
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function swapVisual(car, newVisual) {
  car.visual.clear();
  car.visual.add(newVisual);
  car.wheels = collectWheels(car.visual);
}

function prepareCarModel(gltfScene, wheelPattern) {
  const holder = new THREE.Group();
  holder.add(gltfScene);
  let size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
  if (size.x > size.z) gltfScene.rotation.y = Math.PI / 2;
  // Corrige a orientação do modelo: a frente do carro deve apontar para +Z,
  // que é a direção usada pela física quando o jogador acelera.
  gltfScene.rotation.y += Math.PI;
  holder.updateMatrixWorld(true);
  size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
  holder.scale.setScalar(CAR.length / size.z);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -box.min.y, -c.z);
  holder.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  rigWheels(holder, wheelPattern);
  return holder;
}

/* Cria um pivô para cada malha de roda, para girar e esterçar no próprio centro */
function rigWheels(holder, pattern) {
  holder.updateMatrixWorld(true);
  const found = [];
  holder.traverse(o => { if (o.isMesh && pattern.test(o.name)) found.push(o); });
  for (const node of found) {
    const center = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
    const pivot = makeWheelPivot(0, 0, 0, false);
    holder.add(pivot);
    pivot.position.copy(holder.worldToLocal(center.clone()));
    pivot.userData.front = pivot.position.z > 0;
    pivot.attach(node);
  }
}

/* Ajusta um modelo para uma altura fixa, com os pés no chão e centralizado */
function fitModelToHeight(obj, height) {
  const holder = new THREE.Group();
  holder.add(obj);
  holder.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
  holder.scale.setScalar(height / size.y);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -box.min.y, -c.z);
  holder.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return holder;
}

/* Personagem na linha de largada/chegada, de frente para a pista, com bandeira quadriculada */
function addCharacter(gltf) {
  const holder = fitModelToHeight(gltf.scene, 1.9);
  const root = new THREE.Group();
  root.add(holder);
  const p = track.center[0], s = track.side[0];
  const off = TRACK.halfWidth + 4.5;
  root.position.set(p.x + s.x * off, 0, p.z + s.z * off);
  root.rotation.y = Math.atan2(-s.x, -s.z);
  scene.add(root);

  const hand = new THREE.Group();          // pivô da bandeira (na "mão")
  hand.position.set(0.8, 1.2, 0.25);
  hand.add(buildCheckerFlag());
  root.add(hand);

  character = { root, hand, t: 0, cue: null, cueT: 0 };
}

function buildCheckerFlag() {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5, roughness: 0.4 })
  );
  pole.position.y = 0.65;

  const cvs = document.createElement('canvas');
  cvs.width = 128; cvs.height = 96;
  const g = cvs.getContext('2d');
  for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) {
    g.fillStyle = (x + y) % 2 ? '#111111' : '#ffffff';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.6),
    new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 })
  );
  cloth.position.set(0.45, 1.1, 0);
  group.add(pole, cloth);
  return group;
}

/* Animação do personagem: acena na contagem, baixa a bandeira no "JÁ!" e comemora na chegada */
function updateCharacter(dt) {
  const c = character;
  if (!c) return;
  c.t += dt;

  let jump = 0;
  let wave = Math.sin(c.t * 3) * 0.35;
  let swing = 0;

  if (c.cue) c.cueT += dt;
  if (c.cue === 'go') {
    const k = Math.min(c.cueT / 0.5, 1);
    swing = Math.sin(k * Math.PI) * -1.4;     // bandeira desce e volta: largada
    if (c.cueT > 1.2) c.cue = null;
  } else if (c.cue === 'finish') {
    if (c.cueT < 4) {
      jump = Math.abs(Math.sin(c.cueT * 5)) * 0.8;
      wave = Math.sin(c.cueT * 9) * 0.9;      // comemoração
    } else {
      c.cue = null;
    }
  }

  c.hand.rotation.x = swing;
  c.hand.rotation.z = wave;
  c.root.position.y = jump;
}

function triggerCharacterCue(name) {
  if (character) { character.cue = name; character.cueT = 0; }
}

/* ---------- CORRIDA ---------- */
function resetRace() {
  placeAtStart(player);
  player.vel.set(0, 0, 0);
  player.steer = 0; player.wheelAngle = 0; player.lat = 0; player.drifting = false;
  player.laps = 0; player.cps = [false, false, false]; player.lapTimes = [];
  player.lapStart = 0; player.dist = 0; player.finished = false; player.finishTime = null;
  player.lastIdx = player.idx;

  for (const r of rivals) {
    r.s = 0; r.finished = false; r.finishTime = null; r.wheelAngle = 0;
  }

  game.state = 'countdown';
  game.paused = false;
  game.countdownT = 0;
  game.countdownLabel = null;
  game.raceTime = 0;
  game.shake = 0;

  if (character) character.cue = null;
  clearSkids();
  hud.victory.classList.remove('show');
  hud.pause.classList.remove('show');
  hud.countdown.classList.remove('show');
}

function placeAtStart(car) {
  const u = 1 - 4 / track.length;
  const p = curve.getPointAt(u);
  const t = curve.getTangentAt(u);
  car.root.position.set(p.x, 0, p.z);
  car.heading = Math.atan2(t.x, t.z);
  car.idx = nearestIndex(p.x, p.z);
}

function startRace() {
  game.state = 'racing';
  game.raceTime = 0;
  player.lapStart = 0;
  hud.countdown.classList.remove('show');
  playTone(880, 0.25);
  triggerCharacterCue('go');
}

/* ---------- FÍSICA DO JOGADOR ---------- */
function updatePhysics(dt) {
  const p = player;
  const driving = game.state === 'racing';
  const up = driving && pressed('KeyW', 'ArrowUp');
  const down = driving && pressed('KeyS', 'ArrowDown');
  const left = driving && pressed('KeyA', 'ArrowLeft');
  const right = driving && pressed('KeyD', 'ArrowRight');
  const handbrake = driving && pressed('Space');

  const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
  const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
  let v = p.vel.dot(fwd);
  let lat = p.vel.dot(side);

  if (up) v += PHYS.accel * Math.max(0, 1 - v / PHYS.maxSpeed) * dt;
  if (down) {
    if (v > 0.5) v -= PHYS.brake * dt;
    else v = Math.max(v - PHYS.reverseAccel * dt, -PHYS.reverseMax);
  }
  if (!up && !down) {
    v *= Math.exp(-PHYS.coast * dt);
    if (Math.abs(v) < 0.05) v = 0;
  }
  if (handbrake && Math.abs(v) > 0) {
    const decel = PHYS.handbrakeDecel * dt;
    v = Math.abs(v) <= decel ? 0 : v - Math.sign(v) * decel;
  }
  v = THREE.MathUtils.clamp(v, -PHYS.reverseMax, PHYS.maxSpeed);

  const grip = handbrake ? PHYS.gripHandbrake : PHYS.grip;
  lat *= Math.exp(-grip * dt);
  p.vel.copy(fwd).multiplyScalar(v).addScaledVector(side, lat);
  p.lat = lat;

  const steerInput = (left ? 1 : 0) - (right ? 1 : 0);
  p.steer += (steerInput * PHYS.maxSteer - p.steer) * Math.min(1, PHYS.steerResponse * dt);
  const speedFactor = Math.min(1, Math.abs(v) / 12) * Math.sign(v || 1);
  p.heading += p.steer * speedFactor * PHYS.yawRate * (handbrake ? 1.4 : 1) * dt;

  if (driving && v > 0) p.dist += v * dt;

  p.root.position.addScaledVector(p.vel, dt);
  const hit = collideWithWalls(p);
  if (hit) {
    game.shake = Math.min(0.5, game.shake + 0.25);
    playThud(Math.min(1, Math.abs(hit) / 20));
  }
  p.root.rotation.y = p.heading;
  p.visual.rotation.z = -p.steer * Math.min(1, Math.abs(v) / 30) * 0.05;
  animateWheels(p, v, p.steer, dt);

  // Marcas de pneu quando há derrapagem forte
  p.drifting = driving && Math.abs(lat) > 4.5 && Math.abs(v) > 10;
  p.skidTimer -= dt;
  if (p.drifting && p.skidTimer <= 0) {
    p.skidTimer = 0.04;
    const f = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    const sd = new THREE.Vector3(-f.z, 0, f.x);
    const base = p.root.position.clone().addScaledVector(f, -1.5);
    spawnSkid(base.x + sd.x * 0.85, base.z + sd.z * 0.85, p.heading);
    spawnSkid(base.x - sd.x * 0.85, base.z - sd.z * 0.85, p.heading);
  }
}

/* Mantém o carro na pista. Retorna a velocidade da batida (0 se não bateu). */
function collideWithWalls(car) {
  const pos = car.root.position;
  car.idx = nearestIndex(pos.x, pos.z);
  const c = track.center[car.idx];
  const s = track.side[car.idx];
  const d = (pos.x - c.x) * s.x + (pos.z - c.z) * s.z;
  const lim = TRACK.carLimit;
  if (Math.abs(d) <= lim) return 0;

  const sign = Math.sign(d);
  const push = sign * lim - d;
  pos.x += s.x * push;
  pos.z += s.z * push;

  const sv = car.vel.x * s.x + car.vel.z * s.z;
  let impact = 0;
  if (sv * sign > 0) {
    impact = Math.abs(sv);
    car.vel.addScaledVector(s, -sv * PHYS.wallBounce);
  }
  car.vel.multiplyScalar(PHYS.wallScrape);
  return impact;
}

function animateWheels(car, speed, steer, dt) {
  car.wheelAngle += (speed / CAR.wheelRadius) * dt;
  for (const w of car.wheels) {
    w.rotation.x = car.wheelAngle;
    if (w.userData.front) w.rotation.y = steer * 0.5;
  }
}

/* ---------- ADVERSÁRIOS (IA) ---------- */
function updateAI(dt) {
  const total = RACE.laps * track.length;
  for (const r of rivals) {
    const moving = game.state !== 'countdown' && !r.finished;
    if (moving) {
      r.s += r.speed * dt;
      if (r.s >= total) {
        r.s = total;
        r.finished = true;
        r.finishTime = game.raceTime;
      }
    }
    const u = (r.s % track.length) / track.length;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).setY(0).normalize();
    r.root.position.set(p.x - t.z * r.lane, 0, p.z + t.x * r.lane);
    r.heading = Math.atan2(t.x, t.z);
    r.root.rotation.y = r.heading;
    animateWheels(r, moving ? r.speed : 0, 0, dt);
  }
}

/* ---------- VOLTAS ---------- */
function checkLaps() {
  const p = player;
  const N = TRACK.samples;
  const i = p.idx;
  const delta = i - p.lastIdx;

  if (delta > 0 && delta < N / 2) {
    for (let k = 0; k < 3; k++) {
      const mark = ((k + 1) * N) / 4;
      if (p.lastIdx < mark && i >= mark) p.cps[k] = true;
    }
  } else if (delta < -N / 2) {
    if (p.cps.every(Boolean)) completeLap();
    p.cps = [false, false, false];
  }
  p.lastIdx = i;
}

function completeLap() {
  const lapTime = game.raceTime - player.lapStart;
  player.lapStart = game.raceTime;
  player.laps++;
  player.lapTimes.push(lapTime);
  if (game.best === null || lapTime < game.best) {
    game.best = lapTime;
    saveBestLap(lapTime);
  }
  playTone(660, 0.18);
  if (player.laps >= RACE.laps) finishRace();
}

function racePosition() {
  return 1 + rivals.filter(r => r.s > player.dist).length;
}

function finishRace() {
  game.state = 'finished';
  player.finished = true;
  player.finishTime = game.raceTime;

  const position = racePosition();
  hud.vTitle.textContent = position === 1 ? 'VITÓRIA!' : `${position}º LUGAR`;
  hud.vSub.textContent = position === 1
    ? 'Você completou as 3 voltas na frente!'
    : 'Os adversários cruzaram a linha antes de você.';
  hud.vTotal.textContent = formatTime(player.finishTime);
  hud.vBest.textContent = formatTime(Math.min(...player.lapTimes));
  hud.victory.classList.add('show');
  playTone(990, 0.4);
  triggerCharacterCue('finish');
}

/* ---------- CONTAGEM REGRESSIVA ---------- */
function updateCountdown() {
  const t = game.countdownT;
  const label = t < 0.9 ? '3' : t < 1.8 ? '2' : t < 2.7 ? '1' : 'JÁ!';
  if (label === game.countdownLabel) return;
  game.countdownLabel = label;
  hud.countdown.textContent = label;
  hud.countdown.classList.toggle('go', label === 'JÁ!');
  hud.countdown.classList.remove('show');
  void hud.countdown.offsetWidth;
  hud.countdown.classList.add('show');
  playTone(label === 'JÁ!' ? 880 : 440, 0.12);
}

/* ---------- CÂMERA ---------- */
function updateCamera(dt) {
  const p = player;
  const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
  const speed = p.vel.length();

  const desired = p.root.position.clone()
    .addScaledVector(fwd, -(9.5 + Math.min(speed * 0.04, 2)))
    .add(new THREE.Vector3(0, 4.2, 0));
  camera.position.lerp(desired, 1 - Math.exp(-6 * dt));

  const look = p.root.position.clone().addScaledVector(fwd, 6);
  look.y = 1.2;
  camTarget.lerp(look, 1 - Math.exp(-10 * dt));

  if (game.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * game.shake;
    camera.position.y += (Math.random() - 0.5) * game.shake;
    game.shake *= Math.exp(-8 * dt);
  }
  camera.lookAt(camTarget);

  const fovWanted = 60 + Math.min(speed * 0.18, 10);
  camera.fov += (fovWanted - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();

  sun.position.copy(p.root.position).add(new THREE.Vector3(120, 180, 80));
  sun.target.position.copy(p.root.position);
}

/* ---------- SOM (Web Audio, sem arquivos) ---------- */
function initAudio() {
  if (audio.ctx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    audio.ctx = ctx;

    // Motor: onda dente-de-serra com filtro passa-baixa
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;
    osc.connect(lp).connect(engineGain).connect(ctx.destination);
    osc.start();
    audio.engine = { osc, lp, gain: engineGain };

    // Ruído para cantada de pneu
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    audio.noiseBuffer = buf;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 2;
    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    src.connect(bp).connect(screechGain).connect(ctx.destination);
    src.start();
    audio.screech = screechGain;
  } catch (err) {
    console.warn('Áudio indisponível:', err);
    audio.ctx = null;
  }
}

function updateAudio() {
  if (!audio.ctx || !audio.engine) return;
  const t = audio.ctx.currentTime;
  const kmh = player.vel.length();
  const running = game.state !== 'finished' && !game.paused;
  audio.engine.osc.frequency.setTargetAtTime(45 + kmh * 4.5, t, 0.08);
  audio.engine.lp.frequency.setTargetAtTime(350 + kmh * 14, t, 0.08);
  audio.engine.gain.gain.setTargetAtTime(running ? 0.05 : 0.01, t, 0.1);
  audio.screech.gain.setTargetAtTime(player.drifting && running ? 0.09 : 0, t, 0.05);
}

function playTone(freq, duration) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  o.connect(g).connect(audio.ctx.destination);
  o.start(t);
  o.stop(t + duration + 0.02);
}

function playThud(intensity) {
  if (!audio.ctx || !audio.noiseBuffer) return;
  const t = audio.ctx.currentTime;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.noiseBuffer;
  const lp = audio.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300;
  const g = audio.ctx.createGain();
  g.gain.setValueAtTime(0.25 * intensity + 0.05, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  src.connect(lp).connect(g).connect(audio.ctx.destination);
  src.start(t, 0, 0.4);
}

/* ---------- MINIMAPA ---------- */
function createMinimap() {
  const size = 190;
  const canvas = hud.minimap;
  canvas.width = size;
  canvas.height = size;
  hud.mmCtx = canvas.getContext('2d');

  const base = document.createElement('canvas');
  base.width = size;
  base.height = size;
  const bg = base.getContext('2d');

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.center) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = 14;
  Object.assign(mm, { base, size, pad, minX, minZ,
    scale: (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ) });

  bg.fillStyle = 'rgba(8,10,16,0.75)';
  bg.fillRect(0, 0, size, size);
  bg.strokeStyle = '#cfd6e0';
  bg.lineWidth = 8;
  bg.lineJoin = 'round';
  bg.beginPath();
  track.center.forEach((p, i) => {
    const x = mmX(p.x), y = mmY(p.z);
    if (i === 0) bg.moveTo(x, y); else bg.lineTo(x, y);
  });
  bg.closePath();
  bg.stroke();
  bg.strokeStyle = '#3a3d44';
  bg.lineWidth = 4;
  bg.stroke();
  // Linha de chegada
  bg.fillStyle = '#ffffff';
  bg.fillRect(mmX(track.center[0].x) - 3, mmY(track.center[0].z) - 3, 6, 6);
}

function mmX(x) { return mm.pad + (x - mm.minX) * mm.scale; }
function mmY(z) { return mm.pad + (z - mm.minZ) * mm.scale; }

function drawMinimap() {
  const ctx = hud.mmCtx;
  if (!ctx || !mm.base) return;
  ctx.drawImage(mm.base, 0, 0);
  const dot = (car, color, radius) => {
    ctx.beginPath();
    ctx.arc(mmX(car.root.position.x), mmY(car.root.position.z), radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  };
  for (const r of rivals) dot(r, '#' + r.color.toString(16).padStart(6, '0'), 5);
  dot(player, '#ff2d2d', 6.5);
}

/* ---------- HUD ---------- */
function updateHUD() {
  const kmh = player.vel.length() * 3.6;
  hud.speed.textContent = Math.round(kmh);
  const frac = Math.min(1, kmh / (PHYS.maxSpeed * 3.6));
  hud.rpm.style.width = `${Math.round(frac * 100)}%`;
  hud.gear.textContent = kmh < 1 ? 'N' : String(Math.min(6, 1 + Math.floor(frac * 6)));

  hud.lap.textContent = `VOLTA ${Math.min(player.laps + 1, RACE.laps)} / ${RACE.laps}`;
  if (game.state !== 'countdown') hud.position.textContent = `${racePosition()}º LUGAR`;

  const shown = game.state === 'finished' ? player.finishTime : game.raceTime;
  hud.time.textContent = formatTime(shown);
  hud.best.textContent = game.best === null ? '--:--.--' : formatTime(game.best);
  drawMinimap();
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function setStatus(text) {
  hud.status.classList.remove('hide');
  hud.status.textContent = text;
}

/* ---------- UTILITÁRIOS ---------- */
function nearestIndex(x, z) {
  let best = 0, bestD = Infinity;
  const c = track.center;
  for (let i = 0; i < c.length; i++) {
    const dx = c[i].x - x, dz = c[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function pressed(...codes) {
  return codes.some(c => keys.has(c));
}

function loadBestLap() {
  try {
    const v = parseFloat(localStorage.getItem('turbo-circuit-best-lap'));
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

function saveBestLap(value) {
  try { localStorage.setItem('turbo-circuit-best-lap', String(value)); } catch { /* ignora */ }
}

function cacheHud() {
  const $ = id => document.getElementById(id);
  hud = {
    lap: $('lap'), position: $('position'), time: $('time'), best: $('best'),
    speed: $('speed'), gear: $('gear'), rpm: $('rpmFill'), minimap: $('minimap'),
    countdown: $('countdown'), status: $('status'), pause: $('pause'),
    victory: $('victory'), vTitle: $('vTitle'), vSub: $('vSub'),
    vTotal: $('vTotal'), vBest: $('vBest'),
  };
}

function togglePause() {
  if (game.state === 'finished') return;
  game.paused = !game.paused;
  hud.pause.classList.toggle('show', game.paused);
}

function bindEvents() {
  window.addEventListener('keydown', e => {
    initAudio();
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    if (CONTROL_KEYS.has(e.code)) { e.preventDefault(); keys.add(e.code); }
    if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) togglePause();
    if (e.code === 'Enter' && game.state === 'finished') resetRace();
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  document.getElementById('restart').addEventListener('click', resetRace);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* ---------- LOOP ---------- */
function update(dt) {
  if (game.state === 'countdown') {
    game.countdownT += dt;
    updateCountdown();
    if (game.countdownT >= RACE.countdownLength) startRace();
  } else {
    game.raceTime += dt;
  }
  updatePhysics(dt);
  updateAI(dt);
  if (game.state === 'racing') checkLaps();
  updateCharacter(dt);
  updateCamera(dt);
  updateHUD();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  try {
    if (!game.paused) update(dt);
    updateAudio();
    renderer.render(scene, camera);
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  console.error(err);
  window.showPageError(err && err.stack ? err.stack : String(err));
}

/* ---------- START ---------- */
try {
  init();
} catch (err) {
  showError(err);
}
