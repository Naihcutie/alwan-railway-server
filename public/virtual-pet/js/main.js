import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  applyGrassMaterialFromTemplate,
  buildEnvironment,
  createBushPlacements,
  createTreePlacements,
  POND_LAYOUT,
  populateLegacyPond,
} from "./environment.js";

const container = document.getElementById("app");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff); // will be overridden by environment fog

const DEVICE_MEMORY_GB = navigator.deviceMemory || 0;
const CPU_CORES = navigator.hardwareConcurrency || 0;
const IS_LOW_END_DEVICE =
  DEVICE_MEMORY_GB > 0 && DEVICE_MEMORY_GB <= 4 ||
  CPU_CORES > 0 && CPU_CORES <= 4;
const MAX_PIXEL_RATIO = IS_LOW_END_DEVICE ? 1 : 1.5;
const TARGET_FPS = IS_LOW_END_DEVICE ? 30 : 60;
const FRAME_TIME_MS = 1000 / TARGET_FPS;
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0.5, 0);
const SETUP_CAMERA_POSITION = new THREE.Vector3(0, 2.4, 6.2);
const DEFAULT_MIN_POLAR = Math.PI / 6;
const DEFAULT_MAX_POLAR = Math.PI / 2.95;
const SETUP_MIN_POLAR = 1.05;
const SETUP_MAX_POLAR = 1.75;
const MAX_CAMERA_PAN_RADIUS = 8;

// Isometric-style camera
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(14, 14, 14);

const renderer = new THREE.WebGLRenderer({
  antialias: !IS_LOW_END_DEVICE,
  powerPreference: IS_LOW_END_DEVICE ? "low-power" : "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = IS_LOW_END_DEVICE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Isometric orbit — zoom + 360 rotation, no pan
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(DEFAULT_CAMERA_TARGET);
controls.enableRotate = true;
controls.enablePan = true;
controls.enableZoom = true;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_ROTATE,
};
controls.panSpeed = 1.0;
controls.screenSpacePanning = true;
controls.minDistance = 12;
controls.maxDistance = 50;
controls.minAzimuthAngle = -Infinity;
controls.maxAzimuthAngle = Infinity;
controls.minPolarAngle = DEFAULT_MIN_POLAR;
controls.maxPolarAngle = DEFAULT_MAX_POLAR;
controls.zoomSpeed = 1.2;
controls.update();

function syncSetupCameraMode() {
  if (petSetupComplete) {
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minPolarAngle = DEFAULT_MIN_POLAR;
    controls.maxPolarAngle = DEFAULT_MAX_POLAR;
    return;
  }
  controls.enableRotate = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = SETUP_MIN_POLAR;
  controls.maxPolarAngle = SETUP_MAX_POLAR;
  controls.target.set(0, 1.0, 0);
  camera.position.copy(SETUP_CAMERA_POSITION);
}


// Lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0x88cc44, 1.2);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xfffbe0, 2.5);
dir.position.set(10, 18, 10);
dir.castShadow = true;
dir.shadow.mapSize.set(IS_LOW_END_DEVICE ? 512 : 1024, IS_LOW_END_DEVICE ? 512 : 1024);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 60;
dir.shadow.camera.left = -15;
dir.shadow.camera.right = 15;
dir.shadow.camera.top = 15;
dir.shadow.camera.bottom = -15;
scene.add(dir);

if (!IS_LOW_END_DEVICE) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
}

// Ground raycaster for gravity snapping
const groundRaycaster = new THREE.Raycaster();
const tapRaycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
const pointerNdc = new THREE.Vector2();
let groundMeshes = []; // populated after environment builds

function snapToGround(obj) {
  if (!obj) return;
  // Flat ground — just use cached groundY, no raycaster needed
  const baseY = obj.userData.groundY || GROUND_SURFACE_Y;
  obj.position.y = baseY + getPondSinkOffsetForObject(obj);
}

function getDistanceFromPond(x, z) {
  return Math.hypot(x - POND_X, z - POND_Z);
}

function getPondSinkOffset(x, z) {
  const dist = getDistanceFromPond(x, z);
  if (dist >= POND_WATER_RADIUS) return 0;
  return -POND_WATER_SINK;
}

function getPondSinkOffsetForObject(obj) {
  if (!obj) return 0;
  const box = new THREE.Box3().setFromObject(obj);
  const nearestX = THREE.MathUtils.clamp(POND_X, box.min.x, box.max.x);
  const nearestZ = THREE.MathUtils.clamp(POND_Z, box.min.z, box.max.z);
  return getPondSinkOffset(nearestX, nearestZ);
}

function resolvePondMovement(nx, nz) {
  const distFromPond = getDistanceFromPond(nx, nz);
  if (distFromPond <= POND_WATER_RADIUS || distFromPond >= POND_RADIUS) {
    return { x: nx, z: nz };
  }

  const dirX = nx - POND_X;
  const dirZ = nz - POND_Z;
  const len = Math.hypot(dirX, dirZ) || 1;

  return {
    x: POND_X + (dirX / len) * (POND_WATER_RADIUS - POND_EDGE_BUFFER),
    z: POND_Z + (dirZ / len) * (POND_WATER_RADIUS - POND_EDGE_BUFFER),
  };
}

function clampToPlayableArea(x, z) {
  const distFromCenter = Math.hypot(x, z);
  if (distFromCenter <= PLAYABLE_RADIUS) {
    return { x, z };
  }
  const scale = PLAYABLE_RADIUS / (distFromCenter || 1);
  return { x: x * scale, z: z * scale };
}

function setManualMoveTarget(x, z, moveState = "walk") {
  const clamped = clampToPlayableArea(x, z);
  const resolved = resolvePondMovement(clamped.x, clamped.z);
  targetPoint.set(resolved.x, 0, resolved.z);
  manualMoveActive = true;
  manualIdleTimer = 0;
  currentState = moveState;
  if (destinationMarker) {
    destinationMarker.visible = true;
    destinationMarker.position.set(resolved.x, 0.5, resolved.z);
  }

  if (lieMode) {
    lieMode = false;
    lieTransition = 0;
    lieTransitionDir = 0;

    if (lieRoot && modelRoot) {
      modelRoot.position.x = lieRoot.position.x;
      modelRoot.position.z = lieRoot.position.z;
      modelYaw = lieRoot.rotation.y - Math.PI;
      modelRoot.rotation.y = modelYaw;
    }

    if (lieRoot) {
      lieRoot.visible = false;
    }

    if (modelRoot) {
      modelRoot.visible = true;
      modelRoot.scale.setScalar(0.04);
      snapToGround(modelRoot);
    }
  }

  setState(moveState);
}

function projectPointerToGround(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  tapRaycaster.setFromCamera(pointerNdc, camera);
  const hits = tapRaycaster.intersectObject(envGround, false);
  if (hits.length === 0) return null;
  return hits[0].point;
}

// Build environment
const {
  ground: envGround,
  group: environmentRoot,
  pondAnchor,
  treeAnchor,
  bushAnchor,
} = buildEnvironment(scene);
groundMeshes = [envGround];

// Compute actual ground surface Y after scale
const _groundBox = new THREE.Box3().setFromObject(envGround);
const GROUND_SURFACE_Y = _groundBox.max.y;
console.log("Ground surface Y:", GROUND_SURFACE_Y);

const loader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const clock = new THREE.Clock();
let mixer = null;
let activeAction = null;
let activeLabel = null;
let clips = new Map();
let currentState = "idle";
let stateTime = 0;
let stateDuration = 2;
let targetPoint = new THREE.Vector3(0, 0, 0);
let manualMoveActive = false;
let manualIdleTimer = 0;
let destinationMarker = null;
let modelYaw = 0;
let transitionTime = 0.25;
let tailBones = [];
let tailBind = [];
let speedControl = null;
let hideTailControl = null;
let tailTuckControl = null;
let tailHideControl = null;
let clipSelect = null;
let tailTuckVal = null;
let tailHideVal = null;
let speedVal = null;
let modelRoot = null;
let lieRoot = null;
let lieMixer = null;
let lieClip = null;
let lieMode = false;
let petActionLockTimer = 0;
const PET_STORAGE_KEY = "capybaraVirtualPet.v1";
const PET_PROFILE_KEY = "capybaraVirtualPet.profile.v1";
const PET_INVENTORY_KEY = "capybaraVirtualPet.inventory.v1";
const PET_SAVE_INTERVAL_MS = 2000;
const PET_SPECIES = "capybara";
const DRAWER_ACTION = "action";
const DRAWER_SHOP = "shop";
const DRAWER_INVENTORY = "inventory";
const DRAWER_INFO = "info";
const SHOP_ITEMS = Object.freeze([
  Object.freeze({ id: "carrot", name: "Carrot Bites", price: 14, hunger: 16, happiness: 4 }),
  Object.freeze({ id: "watermelon", name: "Watermelon Slice", price: 22, hunger: 24, happiness: 6 }),
  Object.freeze({ id: "leaf", name: "Fresh Leaf Bundle", price: 10, hunger: 10, happiness: 3 }),
]);
const petState = {
  hunger: 82,
  energy: 78,
  happiness: 80,
  lastUpdated: Date.now(),
};
const petProfile = {
  species: PET_SPECIES,
  gender: "male",
  skinColor: "default",
  name: "Cappy",
  initialized: false,
};
let petInventory = {
  coins: 120,
  items: {},
};
let lastPetSaveAt = 0;
let petMoodEl = null;
let petHintEl = null;
let hungerValueEl = null;
let energyValueEl = null;
let happinessValueEl = null;
let hungerFillEl = null;
let energyFillEl = null;
let happinessFillEl = null;
let petSetupComplete = false;
let activeDrawer = null;
let petSetupOverlayEl = null;
let petSetupHudEl = null;
let petMainUiEl = null;
let petDrawerEl = null;
let petNameInputEl = null;
let petInfoNameEl = null;
let petInfoGenderEl = null;
let petInfoSpeciesEl = null;
let showSetupPreviewPet = false;

// Dust particles
let dustParticles = null;
let dustActive = false;
let dustTime = 0;
const DUST_DURATION = 1.2;
let tailWake = null;
let tailWakeHasPrevPos = false;
let tailWakePrevPos = new THREE.Vector3();
let tailWakeDir = new THREE.Vector3(0, 0, 1);

function createDustSystem() {
  const count = IS_LOW_END_DEVICE ? 18 : 40;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    velocities.push(new THREE.Vector3(
      (Math.random() - 0.5) * 1.5,
      Math.random() * 1.2 + 0.2,
      (Math.random() - 0.5) * 1.5
    ));
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.userData.velocities = velocities;
  geo.userData.count = count;

  const mat = new THREE.PointsMaterial({
    color: 0xc8a96e,
    size: 0.08,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  dustParticles = new THREE.Points(geo, mat);
  dustParticles.visible = false;
  scene.add(dustParticles);
}

function isObjectInPondWater(obj) {
  return getPondSinkOffsetForObject(obj) < 0;
}

function createDestinationMarker() {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.42, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 999;
  group.add(ring);

  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
  );
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.01;
  dot.renderOrder = 1000;
  group.add(dot);

  group.visible = false;
  scene.add(group);
  destinationMarker = group;
}
createDestinationMarker();
createTailWake();

function spawnDust(x, y, z) {
  if (!dustParticles) return;
  const pos = dustParticles.geometry.attributes.position.array;
  const count = dustParticles.geometry.userData.count;
  const vels = dustParticles.geometry.userData.velocities;
  for (let i = 0; i < count; i++) {
    pos[i * 3] = x + (Math.random() - 0.5) * 0.4;
    pos[i * 3 + 1] = y + Math.random() * 0.2;
    pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
    vels[i].set(
      (Math.random() - 0.5) * 1.5,
      Math.random() * 1.0 + 0.1,
      (Math.random() - 0.5) * 1.5
    );
  }
  dustParticles.geometry.attributes.position.needsUpdate = true;
  dustParticles.material.opacity = 0.7;
  dustParticles.visible = true;
  dustActive = true;
  dustTime = 0;
}

function updateDust(dt) {
  if (!dustActive || !dustParticles) return;
  dustTime += dt;
  const t = dustTime / DUST_DURATION;
  if (t >= 1) {
    dustParticles.visible = false;
    dustActive = false;
    return;
  }
  const pos = dustParticles.geometry.attributes.position.array;
  const vels = dustParticles.geometry.userData.velocities;
  const count = dustParticles.geometry.userData.count;
  for (let i = 0; i < count; i++) {
    pos[i * 3] += vels[i].x * dt;
    pos[i * 3 + 1] += vels[i].y * dt;
    pos[i * 3 + 2] += vels[i].z * dt;
    vels[i].y -= 1.5 * dt; // gravity
  }
  dustParticles.geometry.attributes.position.needsUpdate = true;
  dustParticles.material.opacity = 0.7 * (1 - t);
}

function createTailWake() {
  const group = new THREE.Group();

  const waveA = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.03),
    new THREE.MeshBasicMaterial({
      color: 0xeaffff,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  waveA.rotation.x = -Math.PI / 2;
  waveA.position.set(0, 0, -0.04);
  waveA.renderOrder = 5;
  waveA.userData.phase = 0;
  waveA.userData.baseScale = 1;
  group.add(waveA);

  const waveB = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.028),
    new THREE.MeshBasicMaterial({
      color: 0xdaf9ff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  waveB.rotation.x = -Math.PI / 2;
  waveB.position.set(0, 0, -0.24);
  waveB.renderOrder = 5;
  waveB.userData.phase = Math.PI * 0.6;
  waveB.userData.baseScale = 0.84;
  group.add(waveB);

  const waveC = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.024),
    new THREE.MeshBasicMaterial({
      color: 0xcff7ff,
      transparent: true,
      opacity: 0.58,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  waveC.rotation.x = -Math.PI / 2;
  waveC.position.set(0, 0, -0.46);
  waveC.renderOrder = 5;
  waveC.userData.phase = Math.PI * 1.1;
  waveC.userData.baseScale = 0.9;
  group.add(waveC);

  group.visible = false;
  group.renderOrder = 5;
  scene.add(group);
  tailWake = group;
}

function updateTailWake(dt, obj) {
  if (!tailWake) return;
  const isMovingInWater =
    (currentState === "walk" || currentState === "run" || manualMoveActive) &&
    obj &&
    isObjectInPondWater(obj);
  if (!isMovingInWater) {
    tailWake.visible = false;
    tailWakeHasPrevPos = false;
    return;
  }

  if (!tailWakeHasPrevPos) {
    tailWakePrevPos.copy(obj.position);
    tailWakeHasPrevPos = true;
    tailWake.visible = false;
    return;
  }

  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const velocity = obj.position.clone().sub(tailWakePrevPos);
  tailWakePrevPos.copy(obj.position);
  const speed = velocity.length() / Math.max(dt, 1e-4);
  const minWakeSpeed = 0.08;
  if (speed < minWakeSpeed) {
    tailWake.visible = false;
    return;
  }

  const fallbackHeading = lieMode && lieRoot ? lieRoot.rotation.y - Math.PI : modelYaw;
  const fallbackDir = new THREE.Vector3(Math.sin(fallbackHeading), 0, Math.cos(fallbackHeading));
  const moveDir = velocity.lengthSq() > 1e-8 ? velocity.normalize() : fallbackDir;
  tailWakeDir.lerp(moveDir, THREE.MathUtils.clamp(dt * 10, 0, 1)).normalize();

  const backOffset = THREE.MathUtils.clamp(Math.max(size.x, size.z) * 0.44, 0.42, 0.78);
  const offsetX = -tailWakeDir.x * backOffset;
  const offsetZ = -tailWakeDir.z * backOffset;

  tailWake.position.set(
    obj.position.x + offsetX,
    POND_TAIL_WAKE_Y,
    obj.position.z + offsetZ
  );
  tailWake.rotation.y = Math.atan2(tailWakeDir.x, tailWakeDir.z);

  const bodyScale = THREE.MathUtils.clamp(Math.max(size.x, size.z) * 0.58, 0.65, 1.22);
  const movingBoost = currentState === "run" ? 1.2 : currentState === "walk" ? 1.05 : 1;
  tailWake.scale.setScalar(bodyScale * movingBoost);

  const camDir = camera.position.clone().sub(obj.position);
  camDir.y = 0;
  camDir.normalize();
  const facingToCamera = tailWakeDir.dot(camDir);
  const frontViewFade = THREE.MathUtils.clamp(1 - Math.max(0, facingToCamera) * 0.45, 0.55, 1);

  tailWake.visible = true;
  const t = performance.now() * 0.001;
  tailWake.children.forEach((wave, index) => {
    const phase = wave.userData.phase || 0;
    const baseScale = wave.userData.baseScale || 1;
    const pulse = 1 + Math.sin(t * 8 + phase) * 0.12;
    wave.scale.set(baseScale * pulse, 1, 1);
    const baseOpacity = index === 0 ? 0.92 : index === 1 ? 0.76 : 0.64;
    wave.material.opacity = (baseOpacity + Math.sin(t * 9 + phase) * 0.1) * frontViewFade;
  });
}
let baseMaterials = [];
let originalMaterials = new Map();
let toonModeControl = null;
let outlineEnabled = false;
let outlineMeshes = [];
let toonEnabled = true;
let toonMaterials = new Map();

// Stride lengths per animation cycle (tuned to match visual foot movement)
// These are world-unit distances the capybara travels per full animation cycle
const STRIDE = {
  walk: 0.22,  // distance per walk cycle
  run:  0.45,  // distance per run cycle
};
const PLATFORM_Y = 0.3;
// Environment is scaled up, and tree ring sits near the outer edge.
// Keep a small inner margin so trees act as natural visual barrier.
const PLATFORM_RADIUS = 28.8;
const PLAYABLE_RADIUS = 27.0;
const POND_X = 1.8, POND_Z = 0.9, POND_RADIUS = 4.0;
const POND_WATER_RADIUS = 4.0;
const POND_WATER_SINK = 0.58;
const POND_EDGE_BUFFER = 0.08;
const POND_TAIL_WAKE_Y = 0.5;
const MANUAL_IDLE_DURATION = 5;
const TAP_MOVE_THRESHOLD_PX = 8;
let prevAnimTime = 0;

const isFemale = (() => {
  try {
    const raw = localStorage.getItem('capybaraVirtualPet.profile.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.gender === "female";
    }
  } catch (e) {}
  return false;
})();
const baseModelPath = "./models/capybara_anims/8f8f1f16-ec93-43ea-9610-ca23b8ef9283_idle.glb";
const lieModelPath = "./models/3ab40a16-03b9-4bcd-8f8e-5610b21a07bd.glb";
const ribbonModelPath = "./models/ribbon.glb";
const pondModelPaths = ["./models/cartoon_pond.glb", "./models/cartoon_pond (1).glb"];
const grassTextureModelPath = "./models/grass__tile_texture.glb";
const bushModelPath = "./models/cartoon_tree_or_bush_foliage.glb";
const treeModelPath = "./models/tree_pack/free-pack-tree.fbx";
const treeTexturePath = "./models/tree_pack/Texture_BaseColor_v02.png";
const animationFiles = [
  { file: "./models/capybara_anims/8f8f1f16-ec93-43ea-9610-ca23b8ef9283_idle.glb", label: "idle" },
  { file: "./models/capybara_anims/8f8f1f16-ec93-43ea-9610-ca23b8ef9283_walk.glb", label: "walk" },
  { file: "./models/capybara_anims/8f8f1f16-ec93-43ea-9610-ca23b8ef9283_run.glb", label: "run" },
  { file: "./models/capybara_anims/8f8f1f16-ec93-43ea-9610-ca23b8ef9283_jump.glb", label: "jump" },
];

function createDefaultInventory() {
  const itemSeed = {};
  SHOP_ITEMS.forEach((item) => {
    itemSeed[item.id] = 0;
  });
  return {
    coins: 120,
    items: itemSeed,
  };
}

function normalizeGenderLabel(value) {
  if (value === "female") return "Female";
  return "Male";
}

let ribbonRoot = null;
let ribbonAnchor = null;
let ribbonBaseScale = 1;
let ribbonPlacementCalibrated = false;

function findHeadBone(root) {
  if (!root) return null;
  let candidate = null;
  root.traverse((obj) => {
    if (candidate || !obj.isBone || !obj.name) return;
    const key = obj.name.toLowerCase();
    if (key.includes("head")) candidate = obj;
  });
  return candidate;
}

function findEarBone(root) {
  if (!root) return null;
  let leftCandidate = null;
  let anyEar = null;
  root.traverse((obj) => {
    if (!obj.isBone || !obj.name) return;
    const key = obj.name.toLowerCase();
    if (!key.includes("ear")) return;
    if (!anyEar) anyEar = obj;
    if (
      key.includes("left") ||
      key.includes("_l") ||
      key.includes(".l") ||
      key.endsWith("l")
    ) {
      leftCandidate = obj;
    }
  });
  return leftCandidate || anyEar;
}

function attachRibbonToModel() {
  if (!modelRoot || !ribbonRoot) return;

  const earBone = findEarBone(modelRoot);
  const headBone = findHeadBone(modelRoot);
  const preferredBone = earBone || headBone;
  if (!ribbonAnchor) {
    ribbonAnchor = new THREE.Group();
  }

  if (ribbonAnchor.parent && ribbonAnchor.parent !== preferredBone && ribbonAnchor.parent !== modelRoot) {
    ribbonAnchor.parent.remove(ribbonAnchor);
  }

  if (preferredBone) {
    if (ribbonAnchor.parent !== preferredBone) preferredBone.add(ribbonAnchor);
    // Ear-first attachment, tuned to sit on top of head.
    if (earBone) {
      ribbonAnchor.position.set(0.0, 0.06, 0.02);
      ribbonAnchor.rotation.set(Math.PI * 0.5, 0, 0);
      ribbonAnchor.scale.setScalar(18.0);
    } else {
      ribbonAnchor.position.set(0, 0.6, 0);
      ribbonAnchor.rotation.set(Math.PI * 0.5, 0, 0);
      ribbonAnchor.scale.setScalar(22.0);
    }
  } else {
    if (ribbonAnchor.parent !== modelRoot) modelRoot.add(ribbonAnchor);
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = box.getSize(new THREE.Vector3());
    const localX = -size.x * 0.22;
    const localY = size.y * 0.64;
    const localZ = size.z * 0.22;
    ribbonAnchor.position.set(localX, localY, localZ);
    ribbonAnchor.rotation.set(0.2, 0.0, -0.25);
    ribbonAnchor.scale.setScalar(1.2);
  }

  if (ribbonRoot.parent !== ribbonAnchor) {
    ribbonAnchor.add(ribbonRoot);
  }
  ribbonRoot.position.set(0, 0, 0);
  ribbonRoot.rotation.set(0, 0, 0);
  ribbonRoot.scale.setScalar(ribbonBaseScale);
  ribbonPlacementCalibrated = false;
}

function calibrateRibbonPlacement() {
  if (!modelRoot || !ribbonRoot || !ribbonAnchor) return;
  if (ribbonPlacementCalibrated) return;

  const modelBox = new THREE.Box3().setFromObject(modelRoot);
  const modelHeight = Math.max(0.001, modelBox.max.y - modelBox.min.y);
  const centerWorld = modelBox.getCenter(new THREE.Vector3());
  const headBone = findHeadBone(modelRoot);
  const headWorld = headBone
    ? headBone.getWorldPosition(new THREE.Vector3())
    : new THREE.Vector3(
        (modelBox.min.x + modelBox.max.x) * 0.5,
        modelBox.max.y - modelHeight * 0.18,
        modelBox.max.z - modelHeight * 0.05
      );

  // Geometry-only logic:
  // 1) from nose/head point, move toward body (back),
  // 2) push upward to forehead/top zone,
  // 3) slight side offset so it doesn't sit on centerline.
  const towardBody = centerWorld.clone().sub(headWorld).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const side = up.clone().cross(towardBody).normalize().multiplyScalar(-1);

  const targetWorld = headWorld
    .clone()
    .add(towardBody.multiplyScalar(modelHeight * 0.18))
    .add(up.multiplyScalar(modelHeight * 0.25))
    .add(side.multiplyScalar(modelHeight * 0.04));

  const localTarget = modelRoot.worldToLocal(targetWorld);
  if (ribbonAnchor.parent !== modelRoot) modelRoot.add(ribbonAnchor);
  ribbonAnchor.position.copy(localTarget);
  ribbonAnchor.rotation.set(Math.PI * 0.5, 0, 0);
  ribbonAnchor.scale.setScalar(8.5);

  ribbonPlacementCalibrated = true;
}

function updateRibbonVisibility() {
  if (!ribbonRoot) return;
  ribbonRoot.visible = petProfile.gender === "female";
}

function savePetProfile() {
  try {
    localStorage.setItem(PET_PROFILE_KEY, JSON.stringify(petProfile));
  } catch (err) {
    console.warn("Unable to persist pet profile", err);
  }
}

function restorePetProfile() {
  try {
    const raw = localStorage.getItem(PET_PROFILE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    petProfile.species = parsed.species || PET_SPECIES;
    petProfile.gender = parsed.gender === "female" ? "female" : "male";
    petProfile.skinColor = parsed.skinColor || "default";
    petProfile.name = (parsed.name || "Cappy").toString().trim().slice(0, 24) || "Cappy";
    petProfile.initialized = Boolean(parsed.initialized);
  } catch (err) {
    console.warn("Unable to restore pet profile", err);
  }
}

function savePetInventory() {
  try {
    localStorage.setItem(PET_INVENTORY_KEY, JSON.stringify(petInventory));
  } catch (err) {
    console.warn("Unable to persist pet inventory", err);
  }
}

function restorePetInventory() {
  petInventory = createDefaultInventory();
  try {
    const raw = localStorage.getItem(PET_INVENTORY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const nextItems = { ...petInventory.items };
    if (parsed.items && typeof parsed.items === "object") {
      SHOP_ITEMS.forEach((item) => {
        nextItems[item.id] = Math.max(0, Number(parsed.items[item.id]) || 0);
      });
    }
    petInventory = {
      coins: Math.max(0, Number(parsed.coins) || 0),
      items: nextItems,
    };
  } catch (err) {
    console.warn("Unable to restore pet inventory", err);
  }
}

function updateProfileInfoUI() {
  if (petInfoNameEl) petInfoNameEl.textContent = petProfile.name || "Cappy";
  if (petInfoGenderEl) petInfoGenderEl.textContent = normalizeGenderLabel(petProfile.gender);
  if (petInfoSpeciesEl) {
    petInfoSpeciesEl.textContent = petProfile.species === PET_SPECIES ? "Capybara" : petProfile.species;
  }
  updateRibbonVisibility();
}

function closeDrawer() {
  activeDrawer = null;
  if (petDrawerEl) {
    petDrawerEl.classList.remove("pet-drawer-action", "pet-drawer-action-open");
    petDrawerEl.style.top = "";
    petDrawerEl.style.right = "";
    petDrawerEl.classList.add("is-hidden");
    petDrawerEl.innerHTML = "";
  }
  document.querySelectorAll(".pet-rail-btn").forEach((btn) => btn.classList.remove("active"));
}

function positionActionDrawer(buttonEl) {
  if (!petDrawerEl || !buttonEl) return;

  petDrawerEl.classList.add("pet-drawer-action");
  petDrawerEl.classList.remove("pet-drawer-action-open");

  requestAnimationFrame(() => {
    if (!petDrawerEl || !buttonEl) return;
    const btnRect = buttonEl.getBoundingClientRect();
    const drawerHeight = petDrawerEl.offsetHeight || 220;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const margin = 12;

    const right = Math.max(margin, viewportW - btnRect.left + 10);
    let top = btnRect.top + btnRect.height / 2 - drawerHeight / 2;
    top = Math.max(margin, Math.min(top, viewportH - drawerHeight - margin));

    petDrawerEl.style.right = `${right}px`;
    petDrawerEl.style.top = `${top}px`;
    petDrawerEl.classList.add("pet-drawer-action-open");
  });
}

function renderShopItems() {
  const shopCoinsEl = document.getElementById("shopCoins");
  const shopItemsListEl = document.getElementById("shopItemsList");
  if (shopCoinsEl) {
    shopCoinsEl.textContent = `Coins: ${petInventory.coins}`;
  }
  if (!shopItemsListEl) return;

  shopItemsListEl.innerHTML = SHOP_ITEMS.map((item) => (
    `<div class="pet-list-item">
      <div>
        <strong>${item.name}</strong>
        <span> +${item.hunger}% hunger • ₵${item.price}</span>
      </div>
      <button type="button" class="pet-btn primary" data-buy-item="${item.id}">Buy</button>
    </div>`
  )).join("");

  shopItemsListEl.querySelectorAll("[data-buy-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = btn.getAttribute("data-buy-item");
      const found = SHOP_ITEMS.find((x) => x.id === itemId);
      if (!found) return;
      if (petInventory.coins < found.price) {
        if (petHintEl) petHintEl.textContent = "Not enough coins.";
        return;
      }
      const nextItems = {
        ...petInventory.items,
        [found.id]: (petInventory.items[found.id] || 0) + 1,
      };
      petInventory = {
        coins: petInventory.coins - found.price,
        items: nextItems,
      };
      if (petHintEl) petHintEl.textContent = `Bought ${found.name}.`;
      savePetInventory();
      renderShopItems();
      renderInventoryItems();
    });
  });
}

function renderInventoryItems() {
  const inventoryCoinsEl = document.getElementById("inventoryCoins");
  const inventoryItemsListEl = document.getElementById("inventoryItemsList");
  if (inventoryCoinsEl) {
    inventoryCoinsEl.textContent = `Coins: ${petInventory.coins}`;
  }
  if (!inventoryItemsListEl) return;

  const rows = SHOP_ITEMS.map((item) => {
    const amount = petInventory.items[item.id] || 0;
    return `
      <div class="pet-list-item">
        <div>
          <strong>${item.name}</strong>
          <span>Owned: ${amount}</span>
        </div>
        <button type="button" class="pet-btn ${amount > 0 ? "primary" : "secondary"}" data-use-item="${item.id}" ${amount > 0 ? "" : "disabled"}>Use</button>
      </div>
    `;
  }).join("");

  inventoryItemsListEl.innerHTML = rows;
  inventoryItemsListEl.querySelectorAll("[data-use-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = btn.getAttribute("data-use-item");
      const item = SHOP_ITEMS.find((x) => x.id === itemId);
      if (!item) return;
      const available = petInventory.items[item.id] || 0;
      if (available <= 0) return;

      const nextItems = {
        ...petInventory.items,
        [item.id]: available - 1,
      };
      petInventory = {
        ...petInventory,
        items: nextItems,
      };

      petState.hunger = clampPercent(petState.hunger + item.hunger);
      petState.happiness = clampPercent(petState.happiness + item.happiness);
      if (petHintEl) petHintEl.textContent = `Used ${item.name}.`;
      updatePetHud();
      savePetState(true);
      savePetInventory();
      renderInventoryItems();
      renderShopItems();
    });
  });
}

function renderDrawer(kind) {
  if (!petDrawerEl) return;

  const currentButton = {
    [DRAWER_ACTION]: document.getElementById("openActionPanel"),
    [DRAWER_SHOP]: document.getElementById("openShopPanel"),
    [DRAWER_INVENTORY]: document.getElementById("openInventoryPanel"),
    [DRAWER_INFO]: document.getElementById("openInfoPanel"),
  }[kind];

  if (activeDrawer === kind) {
    closeDrawer();
    return;
  }

  activeDrawer = kind;
  document.querySelectorAll(".pet-rail-btn").forEach((btn) => btn.classList.remove("active"));
  if (currentButton) currentButton.classList.add("active");
  petDrawerEl.classList.remove("pet-drawer-action", "pet-drawer-action-open");
  petDrawerEl.style.top = "";
  petDrawerEl.style.right = "";
  petDrawerEl.classList.remove("is-hidden");
  petDrawerEl.innerHTML = "";

  const templateId = {
    [DRAWER_ACTION]: "petActionTemplate",
    [DRAWER_SHOP]: "petShopTemplate",
    [DRAWER_INVENTORY]: "petInventoryTemplate",
    [DRAWER_INFO]: "petInfoTemplate",
  }[kind];

  const template = document.getElementById(templateId);
  if (!template) return;
  petDrawerEl.appendChild(template.content.cloneNode(true));

  if (kind === DRAWER_ACTION) {
    const actionPlayBtn = document.getElementById("actionPlayBtn");
    const actionSleepBtn = document.getElementById("actionSleepBtn");
    const actionIdleBtn = document.getElementById("actionIdleBtn");
    petHintEl = document.getElementById("petHint");
    if (actionPlayBtn) actionPlayBtn.addEventListener("click", () => applyPetAction("play"));
    if (actionSleepBtn) actionSleepBtn.addEventListener("click", () => applyPetAction("sleep"));
    if (actionIdleBtn) actionIdleBtn.addEventListener("click", () => applyPetAction("idle"));
    if (currentButton) positionActionDrawer(currentButton);
  } else if (kind === DRAWER_SHOP) {
    renderShopItems();
  } else if (kind === DRAWER_INVENTORY) {
    renderInventoryItems();
  } else if (kind === DRAWER_INFO) {
    petMoodEl = document.getElementById("petMood");
    hungerValueEl = document.getElementById("hungerValue");
    energyValueEl = document.getElementById("energyValue");
    happinessValueEl = document.getElementById("happinessValue");
    hungerFillEl = document.getElementById("hungerFill");
    energyFillEl = document.getElementById("energyFill");
    happinessFillEl = document.getElementById("happinessFill");
    petInfoNameEl = document.getElementById("petInfoName");
    petInfoGenderEl = document.getElementById("petInfoGender");
    petInfoSpeciesEl = document.getElementById("petInfoSpecies");
    updateProfileInfoUI();
    updatePetHud();
  }
}

function setTutorialVisible(visible) {
  if (petSetupOverlayEl) {
    petSetupOverlayEl.classList.toggle("is-hidden", !visible);
  }
  syncSetupCameraMode();
}

function setSetupHudVisible(visible) {
  showSetupPreviewPet = Boolean(visible);
  if (petSetupHudEl) {
    petSetupHudEl.classList.toggle("is-hidden", !visible);
  }
  if (!petSetupComplete && modelRoot) {
    modelRoot.visible = showSetupPreviewPet;
    if (showSetupPreviewPet) {
      manualMoveActive = false;
      if (destinationMarker) destinationMarker.visible = false;
      if (lieMode) setLieMode(false);
      modelRoot.position.x = 0;
      modelRoot.position.z = 0;
      modelYaw = 0;
      modelRoot.rotation.y = modelYaw;
      setState("idle");
      playClip("idle", true);
    }
  }
  syncSetupCameraMode();
}

function setPetReadyState(ready) {
  petSetupComplete = ready;
  if (ready) {
    setTutorialVisible(false);
    setSetupHudVisible(false);
  }
  if (petMainUiEl) petMainUiEl.classList.toggle("is-hidden", !ready);
  if (ready && environmentRoot) {
    environmentRoot.visible = true;
    scene.fog = new THREE.Fog(0xe8f4e0, 26, 70);
  } else if (!ready && environmentRoot) {
    environmentRoot.visible = false;
    scene.fog = null;
  }
  if (modelRoot) {
    modelRoot.visible = ready ? true : showSetupPreviewPet;
    if (!ready && showSetupPreviewPet) {
      modelYaw = 0;
      modelRoot.rotation.y = modelYaw;
    }
  }
  syncSetupCameraMode();
}

function spawnPetIntoField() {
  if (!modelRoot) return;
  let spawnX = 0;
  let spawnZ = 0;
  let attempts = 0;
  do {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 10;
    spawnX = Math.cos(a) * r;
    spawnZ = Math.sin(a) * r;
    attempts += 1;
  } while (Math.sqrt((spawnX - POND_X) ** 2 + (spawnZ - POND_Z) ** 2) < POND_RADIUS + 1 && attempts < 24);
  modelRoot.position.x = spawnX;
  modelRoot.position.z = spawnZ;
}

function finishPetSetup() {
  const nextName = (petNameInputEl?.value || "Cappy").trim().slice(0, 24) || "Cappy";
  petProfile.name = nextName;
  petProfile.initialized = true;
  savePetProfile();
  setPetReadyState(true);
  spawnPetIntoField();
  updateProfileInfoUI();
  setState("idle");
}

function initSetupFlow() {
  restorePetProfile();
  restorePetInventory();

  if (!petSetupOverlayEl || !petMainUiEl) return;

  const petStep0Next = document.getElementById("petStep0Next");
  const petFinishSetup = document.getElementById("petFinishSetup");
  const genderButtons = document.querySelectorAll(".pet-gender-icon-btn");
  const infoBtn = document.getElementById("openInfoPanel");
  const actionBtn = document.getElementById("openActionPanel");
  const shopBtn = document.getElementById("openShopPanel");
  const inventoryBtn = document.getElementById("openInventoryPanel");

  if (petNameInputEl) petNameInputEl.value = petProfile.name;
  genderButtons.forEach((btn) => {
    const isSelected = btn.getAttribute("data-gender") === petProfile.gender;
    btn.classList.toggle("active", isSelected);
    btn.addEventListener("click", () => {
      const nextGender = btn.getAttribute("data-gender");
      const prevGender = petProfile.gender;
      petProfile.gender = nextGender === "female" ? "female" : "male";
      savePetProfile();
      genderButtons.forEach((item) => item.classList.toggle("active", item === btn));
      // Reload page so the correct model (male/female) is loaded
      if (prevGender !== petProfile.gender) {
        window.location.reload();
        return;
      }
      ribbonPlacementCalibrated = false;
      calibrateRibbonPlacement();
      updateRibbonVisibility();
    });
  });

  // Skin color swatches
  const skinSwatches = document.querySelectorAll(".pet-skin-swatch");
  skinSwatches.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-skin") === petProfile.skinColor);
    btn.addEventListener("click", () => {
      petProfile.skinColor = btn.getAttribute("data-skin");
      skinSwatches.forEach((s) => s.classList.toggle("active", s === btn));
      applySkinColor(petProfile.skinColor);
      savePetProfile();
    });
  });

  if (petStep0Next) {
    petStep0Next.addEventListener("click", () => {
      setTutorialVisible(false);
      setSetupHudVisible(true);
    });
  }
  if (petFinishSetup) petFinishSetup.addEventListener("click", finishPetSetup);
  if (petNameInputEl) {
    petNameInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finishPetSetup();
    });
  }

  if (actionBtn) actionBtn.addEventListener("click", () => renderDrawer(DRAWER_ACTION));
  if (shopBtn) shopBtn.addEventListener("click", () => renderDrawer(DRAWER_SHOP));
  if (inventoryBtn) inventoryBtn.addEventListener("click", () => renderDrawer(DRAWER_INVENTORY));
  if (infoBtn) infoBtn.addEventListener("click", () => renderDrawer(DRAWER_INFO));

  if (petProfile.initialized) {
    setPetReadyState(true);
    setTutorialVisible(false);
    updateProfileInfoUI();
  } else {
    setPetReadyState(false);
    setTutorialVisible(true);
    setSetupHudVisible(false);
  }
}

function clampPercent(value) {
  return THREE.MathUtils.clamp(value, 0, 100);
}

function getPetMoodText() {
  if (petState.energy < 25) return "Mood: Antok siya, patulugin mo muna.";
  if (petState.hunger < 25) return "Mood: Gutom siya, feed mo siya.";
  if (petState.happiness < 25) return "Mood: Malungkot, laro tayo.";
  if (petState.happiness > 75 && petState.energy > 55) return "Mood: Masigla at masaya!";
  return "Mood: Chill lang si capy.";
}

function updatePetHud() {
  const hunger = Math.round(clampPercent(petState.hunger));
  const energy = Math.round(clampPercent(petState.energy));
  const happiness = Math.round(clampPercent(petState.happiness));

  if (hungerValueEl) hungerValueEl.textContent = `${hunger}%`;
  if (energyValueEl) energyValueEl.textContent = `${energy}%`;
  if (happinessValueEl) happinessValueEl.textContent = `${happiness}%`;
  if (hungerFillEl) hungerFillEl.style.width = `${hunger}%`;
  if (energyFillEl) energyFillEl.style.width = `${energy}%`;
  if (happinessFillEl) happinessFillEl.style.width = `${happiness}%`;
  if (petMoodEl) petMoodEl.textContent = getPetMoodText();
}

function savePetState(force = false) {
  const now = Date.now();
  if (!force && now - lastPetSaveAt < PET_SAVE_INTERVAL_MS) return;
  petState.lastUpdated = now;
  try {
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(petState));
    lastPetSaveAt = now;
  } catch (err) {
    console.warn("Unable to persist virtual pet state", err);
  }
}

function decayPetNeeds(seconds) {
  if (seconds <= 0) return;
  const isSleeping = currentState === "lie" || lieMode;
  const isActive = currentState === "walk" || currentState === "run";

  petState.hunger = clampPercent(petState.hunger - seconds * (isSleeping ? 0.12 : isActive ? 0.85 : 0.45));
  petState.happiness = clampPercent(petState.happiness - seconds * (isSleeping ? 0.05 : isActive ? 0.15 : 0.25));

  if (isSleeping) {
    petState.energy = clampPercent(petState.energy + seconds * 2.2);
  } else if (isActive) {
    petState.energy = clampPercent(petState.energy - seconds * 1.1);
  } else {
    petState.energy = clampPercent(petState.energy - seconds * 0.45);
  }
}

function restorePetState() {
  try {
    const raw = localStorage.getItem(PET_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    petState.hunger = clampPercent(Number(parsed.hunger));
    petState.energy = clampPercent(Number(parsed.energy));
    petState.happiness = clampPercent(Number(parsed.happiness));
    petState.lastUpdated = Number(parsed.lastUpdated) || Date.now();

    const elapsedSeconds = Math.max(0, (Date.now() - petState.lastUpdated) / 1000);
    decayPetNeeds(elapsedSeconds);
  } catch (err) {
    console.warn("Unable to restore virtual pet state", err);
  }
}

function applyPetAction(action) {
  if (!modelRoot) return;
  if (!petSetupComplete) return;

  if (action === "feed") {
    petState.hunger = clampPercent(petState.hunger + 22);
    petState.happiness = clampPercent(petState.happiness + 8);
    petActionLockTimer = 2.6;
    setState("idle");
    if (petHintEl) petHintEl.textContent = "Fed! Busog na si capy.";
  } else if (action === "play") {
    petState.happiness = clampPercent(petState.happiness + 18);
    petState.energy = clampPercent(petState.energy - 12);
    petState.hunger = clampPercent(petState.hunger - 6);
    petActionLockTimer = 3.2;
    setState(Math.random() > 0.45 ? "run" : "jump");
    if (petHintEl) petHintEl.textContent = "Play time! Ang kulit ng capy.";
  } else if (action === "sleep") {
    petActionLockTimer = 6.5;
    setState("lie");
    if (petHintEl) petHintEl.textContent = "Sleep mode: pinapahinga si capy.";
  } else if (action === "idle") {
    petActionLockTimer = 1.4;
    setState("idle");
    if (petHintEl) petHintEl.textContent = "Idle mode: chill lang muna.";
  }

  updatePetHud();
  savePetState(true);
}

function updatePetState(dt) {
  petActionLockTimer = Math.max(0, petActionLockTimer - dt);
  decayPetNeeds(dt);

  if (!manualMoveActive && petActionLockTimer <= 0) {
    if (petState.energy < 18 && currentState !== "lie") {
      setState("lie");
      petActionLockTimer = 4.5;
      if (petHintEl) petHintEl.textContent = "Nakapahinga siya dahil low energy.";
    } else if (petState.hunger < 20 && currentState === "idle") {
      setState("walk");
      petActionLockTimer = 1.2;
      if (petHintEl) petHintEl.textContent = "Naghahanap ng food si capy.";
    } else if (petState.happiness < 18 && currentState === "idle") {
      setState("walk");
      petActionLockTimer = 1.2;
      if (petHintEl) petHintEl.textContent = "Need niya ng play para sumaya.";
    }
  }

  if (currentState === "lie" && petState.energy > 92 && petActionLockTimer <= 0.2) {
    setState("standup");
  }

  updatePetHud();
  savePetState(false);
}

function loadTreePack() {
  const treePlacements = createTreePlacements();
  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(
    treeTexturePath,
    (treeTexture) => {
      treeTexture.colorSpace = THREE.SRGBColorSpace;
      fbxLoader.load(
        treeModelPath,
        (fbx) => {
          const source = new THREE.Group();
          source.add(fbx);

          const sourceBox = new THREE.Box3().setFromObject(source);
          const sourceSize = sourceBox.getSize(new THREE.Vector3());
          const sourceHeight = sourceSize.y || 1;
          const targetHeight = 4.8;
          const baseScale = targetHeight / sourceHeight;
          source.scale.setScalar(baseScale);

          const scaledBox = new THREE.Box3().setFromObject(source);
          const center = scaledBox.getCenter(new THREE.Vector3());
          source.position.set(-center.x, -scaledBox.min.y, -center.z);

          source.traverse((obj) => {
            if (!obj.isMesh) return;
            obj.castShadow = true;
            obj.receiveShadow = true;
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            materials.forEach((material) => {
              if (!material) return;
              material.map = treeTexture;
              material.needsUpdate = true;
            });
          });

          treePlacements.forEach((placement) => {
            const tree = source.clone(true);
            tree.position.set(placement.x, 0.3, placement.z);
            tree.rotation.y = placement.rotationY;
            tree.scale.multiplyScalar(placement.scale);
            treeAnchor.add(tree);
          });
        },
        undefined,
        (err) => {
          console.error("Failed to load tree FBX:", err);
        }
      );
    },
    undefined,
    (err) => {
      console.error("Failed to load tree texture:", err);
    }
  );
}

loadTreePack();

function loadBushPack() {
  const bushPlacements = createBushPlacements();
  loader.load(
    bushModelPath,
    (gltf) => {
      const source = gltf.scene;
      const sourceBox = new THREE.Box3().setFromObject(source);
      const sourceSize = sourceBox.getSize(new THREE.Vector3());
      const sourceHeight = sourceSize.y || 1;
      const targetHeight = 1.8;
      const baseScale = targetHeight / sourceHeight;
      source.scale.setScalar(baseScale);

      const scaledBox = new THREE.Box3().setFromObject(source);
      const center = scaledBox.getCenter(new THREE.Vector3());
      source.position.set(-center.x, -scaledBox.min.y, -center.z);

      source.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
      });

      bushPlacements.forEach((placement) => {
        const bush = source.clone(true);
        bush.position.set(placement.x, 0.3, placement.z);
        bush.rotation.y = placement.rotationY;
        bush.scale.multiplyScalar(placement.scale);
        bushAnchor.add(bush);
      });
    },
    undefined,
    (err) => {
      console.error("Failed to load bush GLB:", err);
    }
  );
}

loadBushPack();

function loadGrassTexturePack() {
  loader.load(
    grassTextureModelPath,
    (gltf) => {
      let template = null;

      gltf.scene.traverse((obj) => {
        if (template || !obj.isMesh || !obj.material) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const texturedMaterial = materials.find((material) =>
          material && (material.map || material.normalMap || material.alphaMap)
        );
        if (texturedMaterial) {
          template = texturedMaterial;
        }
      });

      if (!template) {
        console.error("Grass GLB loaded, but no textured material was found.");
        return;
      }

      if (template.map) {
        template.map.colorSpace = THREE.SRGBColorSpace;
      }

      applyGrassMaterialFromTemplate({
        map: template.map || null,
        normalMap: template.normalMap || null,
        roughnessMap: template.roughnessMap || null,
        alphaMap: template.alphaMap || null,
        color: template.color ? template.color.clone() : null,
      });
    },
    undefined,
    (err) => {
      console.error("Failed to load grass texture GLB:", err);
    }
  );
}

loadGrassTexturePack();

function normalizePondModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z);
  const scale = footprint > 0 ? POND_LAYOUT.modelFootprint / footprint : 1;
  root.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const center = scaledBox.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -scaledBox.min.y, -center.z);

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

function loadPondModel(paths, index = 0) {
  if (index >= paths.length) {
    populateLegacyPond(environmentRoot);
    console.error("Failed to load pond GLBs. Falling back to procedural pond.");
    return;
  }

  const file = paths[index];
  loader.load(
    file,
    (gltf) => {
      const pondRoot = gltf.scene;
      normalizePondModel(pondRoot);
      pondAnchor.add(pondRoot);
    },
    undefined,
    (err) => {
      console.error("Failed to load pond GLB:", file, err);
      loadPondModel(paths, index + 1);
    }
  );
}

loadPondModel(pondModelPaths);

function playClip(label, slowIn = false) {
  if (!mixer || !clips.has(label)) return;
  const clip = clips.get(label);
  const nextAction = mixer.clipAction(clip);
  nextAction.reset();
  // Sync animation speed to movement
  const timeScale = label === "run" ? 2.0 : label === "walk" ? 1.0 : slowIn ? 0.5 : 1.0;
  nextAction.setEffectiveTimeScale(timeScale);
  nextAction.setEffectiveWeight(1.0);
  nextAction.play();

  if (activeAction && activeAction !== nextAction) {
    activeAction.crossFadeTo(nextAction, transitionTime, false);
  }
  activeAction = nextAction;
  activeLabel = label;
}

let lieTransition = 0; // 0 = fully base, 1 = fully lie
let lieTransitionDir = 0; // 1 = going to lie, -1 = going to base
const LIE_TRANSITION_SPEED = 0.8; // slower = smoother

function setLieMode(enabled) {
  lieMode = Boolean(enabled);
  lieTransitionDir = lieMode ? 1 : -1;

  // Match lie model scale to base model and place on ground
  if (lieRoot && modelRoot) {
    // Reset to neutral
    lieRoot.rotation.set(0, 0, 0);
    lieRoot.scale.set(1, 1, 1);
    lieRoot.position.set(0, 0, 0);

    // Measure lie model at scale 1
    const lieBox = new THREE.Box3().setFromObject(lieRoot);
    const lieLongest = Math.max(...lieBox.getSize(new THREE.Vector3()).toArray());

    // Measure base model at scale 1
    const savedScale = modelRoot.scale.x;
    modelRoot.scale.set(1, 1, 1);
    const baseBox0 = new THREE.Box3().setFromObject(modelRoot);
    const baseLongest = Math.max(...baseBox0.getSize(new THREE.Vector3()).toArray());
    modelRoot.scale.setScalar(savedScale);

    // Apply matching scale
    const s = lieLongest > 0 ? (baseLongest / lieLongest) * savedScale : savedScale;
    lieRoot.scale.setScalar(s);
    lieRoot.userData.baseScale = s;

    // Now compute ground Y with correct scale applied
    const box2 = new THREE.Box3().setFromObject(lieRoot);
    const groundY = modelRoot.userData.surfaceY || GROUND_SURFACE_Y;
    lieRoot.position.set(
      modelRoot.position.x,
      groundY - box2.min.y,
      modelRoot.position.z
    );
    lieRoot.userData.groundY = groundY - box2.min.y;
    lieRoot.rotation.y = modelYaw + Math.PI;
  }

  // Spawn dust at model position
  if (modelRoot) {
    const box = new THREE.Box3().setFromObject(modelRoot);
    const center = box.getCenter(new THREE.Vector3());
    spawnDust(center.x, modelRoot.position.y, center.z);
  }

  // Make both visible during transition
  if (modelRoot) modelRoot.visible = true;
  if (lieRoot) lieRoot.visible = true;

  if (lieMode) {
    if (activeAction) activeAction.stop();
    if (lieMixer && lieClip) {
      const a = lieMixer.clipAction(lieClip);
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
      lieMixer.update(lieClip.duration);
      lieMixer.update(0);
    }
  } else if (activeLabel) {
    playClip(activeLabel);
  }

  // Snap lie model to exact yaw of base at transition moment
  if (lieRoot && modelRoot) {
    lieRoot.rotation.y = modelYaw + Math.PI;
    lieRoot.position.x = modelRoot.position.x;
    lieRoot.position.z = modelRoot.position.z;
  }
}

function setState(next) {
  currentState = next;
  stateTime = 0;
  prevAnimTime = 0;
  if (next === "idle") stateDuration = 2 + Math.random() * 2;
  if (next === "walk") stateDuration = 3 + Math.random() * 3;
  if (next === "run") stateDuration = 2 + Math.random() * 2;
  if (next === "jump") stateDuration = 1.0;
  if (next === "lie") stateDuration = 10;
  if (next === "standup") stateDuration = 1.0;

  if (next === "lie") {
    // Instant switch + dust effect
    lieMode = true;
    lieTransition = 1;
    lieTransitionDir = 0;

    // Recompute scale — use same approach as setLieMode
    if (lieRoot && modelRoot) {
      lieRoot.rotation.set(0, 0, 0);
      lieRoot.scale.set(1, 1, 1);
      lieRoot.position.set(0, 0, 0);

      const lieBox = new THREE.Box3().setFromObject(lieRoot);
      const lieLongest = Math.max(...lieBox.getSize(new THREE.Vector3()).toArray());

      const savedScale = modelRoot.scale.x;
      modelRoot.scale.set(1, 1, 1);
      const baseBox0 = new THREE.Box3().setFromObject(modelRoot);
      const baseLongest = Math.max(...baseBox0.getSize(new THREE.Vector3()).toArray());
      modelRoot.scale.setScalar(savedScale);

      const s = lieLongest > 0 ? (baseLongest / lieLongest) * savedScale : savedScale;
      lieRoot.scale.setScalar(s);
      lieRoot.userData.baseScale = s;

      const box2 = new THREE.Box3().setFromObject(lieRoot);
      const groundY = modelRoot.userData.surfaceY || GROUND_SURFACE_Y;
      lieRoot.position.set(
        modelRoot.position.x,
        groundY - box2.min.y,
        modelRoot.position.z
      );
      lieRoot.rotation.y = modelYaw + Math.PI;
    }

    if (modelRoot) {
      modelRoot.visible = false;
      modelRoot.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => { m.opacity = 1; m.transparent = false; });
        }
      });
    }
    if (lieRoot) {
      lieRoot.visible = true;
      lieRoot.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => { m.opacity = 1; m.transparent = false; });
        }
      });
    }

    // Spawn dust
    if (modelRoot) {
      const box = new THREE.Box3().setFromObject(modelRoot);
      const center = box.getCenter(new THREE.Vector3());
      spawnDust(center.x, modelRoot.position.y, center.z);
    }

    if (clipSelect) clipSelect.value = "lie";
    if (activeAction) activeAction.stop();
  } else {
    if (lieMode) {
      // Instant hide lie model when standing up
      lieMode = false;
      lieTransition = 0;
      lieTransitionDir = 0;
      if (lieRoot) {
        lieRoot.visible = false;
        lieRoot.traverse((obj) => {
          if (obj.isMesh && obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => { m.opacity = 1; m.transparent = false; });
          }
        });
      }
      if (modelRoot) {
        modelRoot.visible = true;
        modelRoot.scale.setScalar(0.04);
        modelRoot.traverse((obj) => {
          if (obj.isMesh && obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => { m.opacity = 1; m.transparent = false; });
          }
        });
        // Dust on standup
        const box = new THREE.Box3().setFromObject(modelRoot);
        const center = box.getCenter(new THREE.Vector3());
        spawnDust(center.x, modelRoot.position.y, center.z);
      }
    }
    playClip(next === "standup" ? "jump" : next, next === "idle");
    if (clipSelect && next !== "standup") clipSelect.value = next;
  }

  if (!manualMoveActive && (next === "walk" || next === "run")) {
    // Pick target across most of the field while avoiding the rock ring.
    let tx, tz, attempts = 0;
    do {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * (PLAYABLE_RADIUS - 5);
      tx = Math.cos(a) * r;
      tz = Math.sin(a) * r;
      attempts++;
    } while (
      (getDistanceFromPond(tx, tz) > POND_WATER_RADIUS - 0.15 &&
        getDistanceFromPond(tx, tz) < POND_RADIUS + 0.15) &&
      attempts < 20
    );
    targetPoint.set(tx, 0, tz);
  }
}

function updateBehavior(dt) {
  if (!modelRoot) return;
  if (!petSetupComplete) {
    if (lieMode) setLieMode(false);
    manualMoveActive = false;
    if (destinationMarker) destinationMarker.visible = false;
    if (activeLabel !== "idle" && clips.has("idle")) {
      playClip("idle", true);
    }
    if (currentState !== "idle") setState("idle");
    return;
  }
  stateTime += dt;

  if (manualMoveActive) {
    const manualClip = currentState === "run" ? "run" : "walk";
    if (activeLabel !== manualClip) {
      playClip(manualClip);
    }
    if (currentState !== manualClip) {
      currentState = manualClip;
    }

    const manualSpeed = manualClip === "run" ? 2.5 : 1.2;

    const pos = modelRoot.position.clone();
    const dir = targetPoint.clone().sub(pos);
    dir.y = 0;
    const dist = dir.length();

    if (dist > 0.01) {
      dir.normalize();
      const step = dir.clone().multiplyScalar(manualSpeed * dt);
      const nx = modelRoot.position.x + step.x;
      const nz = modelRoot.position.z + step.z;
      const clamped = clampToPlayableArea(nx, nz);
      const resolved = resolvePondMovement(clamped.x, clamped.z);
      modelRoot.position.x = resolved.x;
      modelRoot.position.z = resolved.z;

      const desiredYaw = Math.atan2(dir.x, dir.z);
      modelYaw += (desiredYaw - modelYaw) * Math.min(1, dt * 8);
      modelRoot.rotation.y = modelYaw;
    }

    if (dist < 0.2) {
      manualMoveActive = false;
      manualIdleTimer = MANUAL_IDLE_DURATION;
      if (destinationMarker) {
        destinationMarker.visible = false;
      }
      setState("idle");
    }
    return;
  }

  if (manualIdleTimer > 0) {
    manualIdleTimer = Math.max(0, manualIdleTimer - dt);
    if (manualIdleTimer > 0) {
      if (currentState !== "idle") {
        setState("idle");
      }
      return;
    }
  }

  if (currentState === "lie") {
    if (stateTime >= stateDuration) {
      setState("standup");
    }
    return;
  }

  if (currentState === "standup") {
    if (stateTime >= stateDuration) {
      setState("idle");
    }
    return;
  }

  if (currentState === "walk" || currentState === "run") {
    const speed = manualMoveActive ? 1.2 : currentState === "run" ? 2.5 : 1.2;
    const pos = modelRoot.position.clone();
    const dir = targetPoint.clone().sub(pos);
    dir.y = 0;
    const dist = dir.length();
    if (dist > 0.01) {
      dir.normalize();
      const step = dir.clone().multiplyScalar(speed * dt);
      const nx = modelRoot.position.x + step.x;
      const nz = modelRoot.position.z + step.z;

      // Clamp to platform radius
      const distFromCenter = Math.sqrt(nx * nx + nz * nz);
      const clampedX = distFromCenter > PLATFORM_RADIUS ? nx / distFromCenter * PLATFORM_RADIUS : nx;
      const clampedZ = distFromCenter > PLATFORM_RADIUS ? nz / distFromCenter * PLATFORM_RADIUS : nz;

      const resolved = resolvePondMovement(clampedX, clampedZ);
      modelRoot.position.x = resolved.x;
      modelRoot.position.z = resolved.z;

      const desiredYaw = Math.atan2(dir.x, dir.z);
      modelYaw += (desiredYaw - modelYaw) * Math.min(1, dt * 6);
      modelRoot.rotation.y = modelYaw;
    }
    if (manualMoveActive && dist < 0.2) {
      manualMoveActive = false;
      manualIdleTimer = MANUAL_IDLE_DURATION;
      setState("idle");
      return;
    }
    if (!manualMoveActive && (dist < 0.2 || stateTime >= stateDuration)) {
      if (petActionLockTimer <= 0) {
        setState(Math.random() < 0.2 ? "run" : "idle");
      } else if (dist < 0.2) {
        setState("idle");
      }
    }
  } else if (currentState === "idle") {
    if (stateTime >= stateDuration && petActionLockTimer <= 0) {
      const r = Math.random();
      if (r < 0.45) setState("walk");
      else if (r < 0.7) setState("run");
      else if (r < 0.85) setState("jump");
      else setState("lie");
    }
  } else if (currentState === "jump") {
    if (stateTime >= stateDuration) {
      setState("idle");
    }
  }
}
function loadAnimations() {
  const addOption = (label) => {
    if (!clipSelect) return;
    for (const opt of clipSelect.options) {
      if (opt.value === label) return;
    }
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    clipSelect.appendChild(option);
  };
  animationFiles.forEach((entry) => {
    loader.load(
      entry.file,
      (gltf) => {
        if (gltf.animations && gltf.animations.length > 0) {
          const clip = gltf.animations[0];
          clips.set(entry.label, clip);
          // Store clip duration for stride calculation
          console.log(`${entry.label} clip duration: ${clip.duration}s`);
          addOption(entry.label);
          if (clips.size === 1) {
            playClip(entry.label);
          }
          if (!petSetupComplete && clips.has("idle")) {
            playClip("idle", true);
          }
        }
      },
      undefined,
      (err) => {
        // eslint-disable-next-line no-console
        console.error("Failed to load animation:", entry.file, err);
      }
    );
  });
}

loader.load(
  baseModelPath,
  (gltf) => {
    const model = gltf.scene;
    modelRoot = model;
    model.scale.setScalar(0.04);
    scene.add(model);

    // Place temporarily, will auto-adjust after first animation tick
    const origin = new THREE.Vector3(0, 10, 0);
    groundRaycaster.set(origin, DOWN);
    const hits = groundRaycaster.intersectObjects(groundMeshes, false);
    const surfaceY = hits.length > 0 ? hits[0].point.y : GROUND_SURFACE_Y;
    model.userData.surfaceY = surfaceY;
    model.userData.groundY = surfaceY + 0.3; // temp, will be corrected
    model.userData.groundCalibrated = false;
    // Keep pet in center preview until setup is complete.
    if (petSetupComplete) {
      spawnPetIntoField();
      model.position.y = model.userData.groundY;
    } else {
      model.position.set(0, model.userData.groundY, 0);
    }
    cacheMaterialsAndTexture();
    applySkinColor(petProfile.skinColor);
    createDustSystem();

    // Collect tail bones for optional freezing.
    tailBones = [];
    tailBind = [];
    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.renderOrder = 10;
      }
      if (obj.isBone && typeof obj.name === "string") {
        const name = obj.name.toLowerCase();
        if (name.includes("tail")) {
          tailBones.push(obj);
          tailBind.push({
            position: obj.position.clone(),
            quaternion: obj.quaternion.clone(),
            scale: obj.scale.clone(),
          });
        }
      }
    });

    mixer = new THREE.AnimationMixer(model);
    loadAnimations();

    if (toonModeControl && toonModeControl.checked) {
      applyCartoonShading(true);
    }

    setState("idle");
    model.visible = petSetupComplete ? true : showSetupPreviewPet;
    attachRibbonToModel();
    calibrateRibbonPlacement();
    updateRibbonVisibility();
  },
  undefined,
  (err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to load GLB:", err);
  }
);

if (!isFemale) loader.load(
  ribbonModelPath,
  (gltf) => {
    ribbonRoot = gltf.scene;
    ribbonRoot.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.frustumCulled = false;
        obj.renderOrder = 200;
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((mat) => {
            mat.side = THREE.DoubleSide;
            mat.needsUpdate = true;
          });
        }
      }
    });
    ribbonRoot.scale.setScalar(1);
    ribbonRoot.position.set(0, 0, 0);
    ribbonRoot.rotation.set(0, 0, 0);

    // Re-center ribbon geometry so anchor transforms are predictable.
    const rawBox = new THREE.Box3().setFromObject(ribbonRoot);
    const rawCenter = rawBox.getCenter(new THREE.Vector3());
    ribbonRoot.position.sub(rawCenter);

    const ribbonBox = new THREE.Box3().setFromObject(ribbonRoot);
    const ribbonSize = ribbonBox.getSize(new THREE.Vector3());
    const ribbonLongest = Math.max(ribbonSize.x, ribbonSize.y, ribbonSize.z);
    ribbonBaseScale = ribbonLongest > 0 ? (1 / ribbonLongest) : 1;
    attachRibbonToModel();
    calibrateRibbonPlacement();
    updateRibbonVisibility();
  },
  undefined,
  (err) => {
    console.error("Failed to load ribbon GLB:", err);
  }
);

// Load lying pose model
loader.load(
  lieModelPath,
  (gltf) => {
    lieRoot = gltf.scene;
    lieRoot.position.set(0, 0, 0);
    lieRoot.rotation.y = 0;
    lieRoot.scale.set(1, 1, 1);

    // Match scale to base model
    const lieBox = new THREE.Box3().setFromObject(lieRoot);
    const lieSize = lieBox.getSize(new THREE.Vector3());
    const lieLongest = Math.max(lieSize.x, lieSize.y, lieSize.z);

    let scaleFactor = 1;
    if (modelRoot && lieLongest > 0) {
      const baseBox = new THREE.Box3().setFromObject(modelRoot);
      const baseSize = baseBox.getSize(new THREE.Vector3());
      const baseLongest = Math.max(baseSize.x, baseSize.y, baseSize.z);
      scaleFactor = baseLongest / lieLongest;
      lieRoot.scale.setScalar(scaleFactor);
    }

    // Place lie model: bottom of mesh sits on ground surface
    const box2 = new THREE.Box3().setFromObject(lieRoot);
    const surfaceY = modelRoot ? (modelRoot.userData.surfaceY || GROUND_SURFACE_Y) : GROUND_SURFACE_Y;
    lieRoot.position.y = surfaceY - box2.min.y;
    lieRoot.userData.groundY = lieRoot.position.y;

    // Apply rotation last
    lieRoot.rotation.y = Math.PI;
    // Store base scale for morph transition
    lieRoot.userData.baseScale = lieRoot.scale.x;

    lieRoot.traverse((obj) => {
      if (obj.isMesh) {
        obj.renderOrder = 10;
      }
    });

    // Apply cartoon shading if already enabled
    if (toonEnabled) {
      buildLieCartoonMaterials();
      lieRoot.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const entry = toonMaterials.get(obj);
        if (!entry) return;
        obj.material = entry.toonMats.length === 1 ? entry.toonMats[0] : entry.toonMats;
      });
    }

    lieRoot.visible = lieMode;
    scene.add(lieRoot);
    // Apply current skin color to lie model now that it's loaded
    applySkinColor(petProfile.skinColor);
    if (gltf.animations && gltf.animations.length > 0) {
      lieMixer = new THREE.AnimationMixer(lieRoot);
      lieClip = gltf.animations[0];
      console.log("lie clip duration:", lieClip.duration, "tracks:", lieClip.tracks.length);
      const a = lieMixer.clipAction(lieClip);
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
      // seek to frame 1 (1/24 sec)
      lieMixer.update(1 / 24);
      lieMixer.update(0);
    }
    if (lieMode && modelRoot) modelRoot.visible = false;
  },
  undefined,
  (err) => {
    console.error("Failed to load lie GLB:", err);
  }
);

function resize() {
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(width, height);
}

function syncCameraPanLock() {
  const distance = camera.position.distanceTo(controls.target);
  controls.enableRotate = true;
  controls.enablePan = true;

  const zoomT = THREE.MathUtils.clamp(
    (controls.maxDistance - distance) / (controls.maxDistance - controls.minDistance || 1),
    0,
    1
  );
  const allowedPanRadius = 3.5 + MAX_CAMERA_PAN_RADIUS * zoomT;
  const targetXZLength = Math.hypot(
    controls.target.x - DEFAULT_CAMERA_TARGET.x,
    controls.target.z - DEFAULT_CAMERA_TARGET.z
  );

  if (targetXZLength > allowedPanRadius) {
    const scale = allowedPanRadius / (targetXZLength || 1);
    const clampedTarget = new THREE.Vector3(
      DEFAULT_CAMERA_TARGET.x + (controls.target.x - DEFAULT_CAMERA_TARGET.x) * scale,
      DEFAULT_CAMERA_TARGET.y,
      DEFAULT_CAMERA_TARGET.z + (controls.target.z - DEFAULT_CAMERA_TARGET.z) * scale
    );
    const delta = clampedTarget.clone().sub(controls.target);
    controls.target.copy(clampedTarget);
    camera.position.add(delta);
  } else {
    controls.target.y = DEFAULT_CAMERA_TARGET.y;
  }
}

window.addEventListener("resize", resize);
resize();

let pointerDownInfo = null;
let lastTapTime = 0;

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!petSetupComplete) {
    pointerDownInfo = null;
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointerDownInfo = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!petSetupComplete) return;
  if (!pointerDownInfo) return;
  if (event.pointerType === "mouse" && event.button !== 0) {
    pointerDownInfo = null;
    return;
  }

  const moved = Math.hypot(
    event.clientX - pointerDownInfo.x,
    event.clientY - pointerDownInfo.y
  );
  pointerDownInfo = null;
  if (moved > TAP_MOVE_THRESHOLD_PX) return;

  const hitPoint = projectPointerToGround(event.clientX, event.clientY);
  if (!hitPoint) return;
  const now = performance.now();
  const isDoubleTap = now - lastTapTime < 280;
  lastTapTime = now;
  setManualMoveTarget(hitPoint.x, hitPoint.z, isDoubleTap ? "run" : "walk");
});

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  if (IS_LOW_END_DEVICE && animate.lastFrameTime && now - animate.lastFrameTime < FRAME_TIME_MS) {
    return;
  }
  animate.lastFrameTime = now;
  syncCameraPanLock();
  controls.update();
  const dt = clock.getDelta();

  updateDust(dt);
  const wakeSource = lieMode && lieRoot ? lieRoot : modelRoot;
  updateTailWake(dt, wakeSource);

  // Handle lie/base transition — smooth morph feel via eased opacity + subtle scale
  if (lieTransitionDir !== 0) {
    lieTransition += lieTransitionDir * dt * LIE_TRANSITION_SPEED;
    lieTransition = Math.max(0, Math.min(1, lieTransition));

    // Ease in-out
    const t = lieTransition < 0.5
      ? 2 * lieTransition * lieTransition
      : 1 - Math.pow(-2 * lieTransition + 2, 2) / 2;

    const setOpacity = (root, alpha) => {
      if (!root) return;
      root.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => { m.transparent = true; m.opacity = alpha; });
        }
      });
    };

    setOpacity(modelRoot, 1 - t);
    setOpacity(lieRoot, t);

    if (lieTransition >= 1) {
      lieTransitionDir = 0;
      if (modelRoot) { modelRoot.visible = false; modelRoot.scale.setScalar(0.04); }
      if (lieRoot) {
        const base = lieRoot.userData.baseScale || 1;
        lieRoot.scale.set(base, base, base);
      }
    } else if (lieTransition <= 0) {
      lieTransitionDir = 0;
      if (lieRoot) lieRoot.visible = false;
      if (modelRoot) modelRoot.scale.setScalar(0.04);
    }
  }

  // Sync lie model position to base every frame during transition
  if (lieRoot && modelRoot && lieTransitionDir !== 0) {
    lieRoot.position.x = modelRoot.position.x;
    lieRoot.position.z = modelRoot.position.z;
  }

  if (mixer) {
    if (speedControl) mixer.timeScale = Number(speedControl.value);
    if (!lieMode) {
      mixer.update(dt);
      updateBehavior(dt);
    } else {
      updateBehavior(dt);
      if (lieMixer) lieMixer.update(dt);
    }
  }
  if (ribbonRoot && !ribbonPlacementCalibrated) {
    calibrateRibbonPlacement();
  }
  if (petSetupComplete) {
    updatePetState(dt);
  }
  if (tailBones.length > 0) {
    const hide = hideTailControl && hideTailControl.checked;
    const tuck = tailTuckControl ? Number(tailTuckControl.value) : 0;
    const pull = tailHideControl ? Number(tailHideControl.value) : 0;
    for (let i = 0; i < tailBones.length; i += 1) {
      const bone = tailBones[i];
      const bind = tailBind[i];
      if (pull !== 0) {
        const factor = 1 - pull;
        bone.position.copy(bind.position).multiplyScalar(factor);
        bone.quaternion.copy(bind.quaternion);
      }
      if (tuck !== 0) {
        const euler = new THREE.Euler(tuck * 0.6, 0, 0);
        const q = new THREE.Quaternion().setFromEuler(euler);
        bone.quaternion.multiply(q);
      }
      if (hide) {
        bone.scale.setScalar(0.001);
      }
      bone.updateMatrixWorld(true);
    }
  }

  if (modelRoot && !lieMode) {
    // Auto-calibrate ground Y using hoof bone positions after first tick
    if (!modelRoot.userData.groundCalibrated && mixer && tailBones.length > 0) {
      // Find lowest point among hoof bones
      let lowestY = Infinity;
      modelRoot.traverse((obj) => {
        if (obj.isBone && obj.name && obj.name.toLowerCase().includes('hoof')) {
          const wp = new THREE.Vector3();
          obj.getWorldPosition(wp);
          if (wp.y < lowestY) lowestY = wp.y;
        }
      });
      if (lowestY < Infinity) {
        const surfaceY = modelRoot.userData.surfaceY || GROUND_SURFACE_Y;
        const correction = surfaceY - lowestY;
        modelRoot.userData.groundY = modelRoot.position.y + correction;
        modelRoot.userData.groundCalibrated = true;
        console.log('Ground calibrated, correction:', correction);
      }
    }
    snapToGround(modelRoot);
  }
  if (lieRoot && lieMode) {
    const baseY = lieRoot.userData.groundY || GROUND_SURFACE_Y;
    lieRoot.position.y = baseY + getPondSinkOffsetForObject(lieRoot);
  }
  renderer.render(scene, camera);
}
animate.lastFrameTime = 0;

hideTailControl = document.getElementById("hideTail");
tailTuckControl = document.getElementById("tailTuck");
tailHideControl = document.getElementById("tailHide");
speedControl = document.getElementById("speed");
clipSelect = document.getElementById("clip");
toonModeControl = document.getElementById("toonMode");
tailTuckVal = document.getElementById("tailTuckVal");
tailHideVal = document.getElementById("tailHideVal");
speedVal = document.getElementById("speedVal");
petMoodEl = document.getElementById("petMood");
petHintEl = document.getElementById("petHint");
hungerValueEl = document.getElementById("hungerValue");
energyValueEl = document.getElementById("energyValue");
happinessValueEl = document.getElementById("happinessValue");
hungerFillEl = document.getElementById("hungerFill");
energyFillEl = document.getElementById("energyFill");
happinessFillEl = document.getElementById("happinessFill");
petSetupOverlayEl = document.getElementById("petSetupOverlay");
petSetupHudEl = document.getElementById("petSetupHud");
petMainUiEl = document.getElementById("petMainUi");
petDrawerEl = document.getElementById("petDrawer");
petNameInputEl = document.getElementById("petNameInput");
petInfoNameEl = document.getElementById("petInfoName");
petInfoGenderEl = document.getElementById("petInfoGender");
petInfoSpeciesEl = document.getElementById("petInfoSpecies");

restorePetState();
updatePetHud();
initSetupFlow();

function updateLabels() {
  if (tailTuckControl && tailTuckVal) {
    const pct = Math.round(((Number(tailTuckControl.value) + 1) / 2) * 100);
    tailTuckVal.textContent = `${pct}%`;
  }
  if (tailHideControl && tailHideVal) {
    const pct = Math.round(Number(tailHideControl.value) * 100);
    tailHideVal.textContent = `${pct}%`;
  }
  if (speedControl && speedVal) {
    const pct = Math.round(Number(speedControl.value) * 100);
    speedVal.textContent = `${pct}%`;
  }
}

tailTuckControl.addEventListener("input", updateLabels);
tailHideControl.addEventListener("input", updateLabels);
speedControl.addEventListener("input", updateLabels);
updateLabels();
clipSelect.addEventListener("change", () => {
  if (clipSelect.value === "lie") {
    setLieMode(true);
  } else {
    setLieMode(false);
    setState(clipSelect.value);
  }
});

function cacheMaterialsAndTexture() {
  if (!modelRoot) return;
  baseMaterials = [];
  originalMaterials.clear();
  modelRoot.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      originalMaterials.set(obj, mats);
      for (const mat of mats) {
        baseMaterials.push({ mat, originalMap: mat.map || null, originalColor: mat.color ? mat.color.clone() : null });
      }
    }
  });
}

const SKIN_COLORS = {
  default: null,
  albino:  0x9b59b6,
  gray:    0x9e9e9e,
  dark:    0x5c3317,
  orange:  0xe07b39,
};

function applySkinColor(skinKey) {
  if (!modelRoot && !lieRoot) return;
  const tint = SKIN_COLORS[skinKey] ?? null;
  const targets = [modelRoot, lieRoot].filter(Boolean);

  // Step 1: Restore original materials first so baseMaterials refs are valid
  targets.forEach((root) => {
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const entry = toonMaterials.get(obj);
      if (entry) {
        obj.material = entry.original.length === 1 ? entry.original[0] : entry.original;
      }
    });
  });

  // Step 2: Apply color tint to original materials
  targets.forEach((root) => {
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        const base = baseMaterials.find(b => b.mat === mat);
        if (base?.originalMap !== undefined) mat.map = base.originalMap;
        if (tint !== null) {
          mat.color.set(tint);
        } else {
          if (base?.originalColor) mat.color.copy(base.originalColor);
        }
        mat.needsUpdate = true;
      });
    });
  });

  // Step 3: Rebuild toon materials from the now-correct base materials
  toonMaterials.clear();
  if (modelRoot) buildCartoonMaterials();
  if (lieRoot) buildLieCartoonMaterials();
  if (toonEnabled) applyCartoonShading(true);
}

function buildCartoonMaterials() {
  toonMaterials.clear();
  const ramp = new Uint8Array([0, 0, 0, 255, 120, 120, 120, 255, 255, 255, 255, 255]);
  const gradientMap = new THREE.DataTexture(ramp, 3, 1, THREE.RGBAFormat);
  gradientMap.needsUpdate = true;
  modelRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const toonMats = mats.map((m) => {
      const toon = new THREE.MeshToonMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map || null,
        gradientMap,
      });
      toon.skinning = Boolean(obj.isSkinnedMesh);
      return toon;
    });
    toonMaterials.set(obj, { toonMats, original: mats });
  });
}

function buildLieCartoonMaterials() {
  if (!lieRoot) return;
  const ramp = new Uint8Array([0, 0, 0, 255, 120, 120, 120, 255, 255, 255, 255, 255]);
  const gradientMap = new THREE.DataTexture(ramp, 3, 1, THREE.RGBAFormat);
  gradientMap.needsUpdate = true;
  lieRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const toonMats = mats.map((m) => new THREE.MeshToonMaterial({
      color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
      map: m.map || null,
      gradientMap,
    }));
    toonMaterials.set(obj, { toonMats, original: mats });
  });
}

function applyCartoonShading(enabled) {
  toonEnabled = Boolean(enabled);
  if (!modelRoot) return;
  if (toonMaterials.size === 0) buildCartoonMaterials();
  // Apply to base model
  modelRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const entry = toonMaterials.get(obj);
    if (!entry) return;
    obj.material = toonEnabled
      ? (entry.toonMats.length === 1 ? entry.toonMats[0] : entry.toonMats)
      : (entry.original.length === 1 ? entry.original[0] : entry.original);
  });
  // Apply to lie model
  if (lieRoot) {
    buildLieCartoonMaterials();
    lieRoot.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const entry = toonMaterials.get(obj);
      if (!entry) return;
      obj.material = toonEnabled
        ? (entry.toonMats.length === 1 ? entry.toonMats[0] : entry.toonMats)
        : (entry.original.length === 1 ? entry.original[0] : entry.original);
    });
  }
}

toonModeControl.addEventListener("change", () => {
  applyCartoonShading(toonModeControl.checked);
});

window.addEventListener("beforeunload", () => {
  savePetState(true);
});

animate();
