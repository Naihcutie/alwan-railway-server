import * as THREE from "three";

export const POND_LAYOUT = Object.freeze({
  localPosition: Object.freeze({ x: 1, y: 0.18, z: 0.5 }),
  modelFootprint: 8.4,
  collision: Object.freeze({ x: 1.8, z: 0.9, radius: 4.0 }),
});

const grassMaterials = [];

export function createTreePlacements() {
  const placements = [];

  const r1 = 17.5;
  const n1 = 36;
  for (let i = 0; i < n1; i += 1) {
    const a = (i / n1) * Math.PI * 2;
    const radius = r1 + Math.sin(i * 2.37) * 0.4;
    placements.push({
      x: Math.cos(a) * radius,
      z: Math.sin(a) * radius,
      scale: 1.18 + ((i % 5) * 0.06),
      rotationY: a + Math.PI * 0.5 + (i % 3) * 0.18,
    });
  }

  const r2 = 15.5;
  const n2 = 24;
  for (let i = 0; i < n2; i += 1) {
    const a = (i / n2) * Math.PI * 2 + 0.18;
    const radius = r2 + Math.cos(i * 1.91) * 0.5;
    placements.push({
      x: Math.cos(a) * radius,
      z: Math.sin(a) * radius,
      scale: 0.9 + ((i % 4) * 0.05),
      rotationY: a + Math.PI * 0.35 + (i % 2) * 0.24,
    });
  }

  return placements;
}

export function createBushPlacements() {
  const placements = [];
  const count = 40;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + Math.sin(i * 1.37) * 0.2;
    const r = 12 + ((i * 7) % 9) * 0.32;
    placements.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      scale: 0.85 + (i % 5) * 0.08,
      rotationY: a + (i % 4) * 0.27,
    });
  }
  return placements;
}

// ── Palette (Animal Crossing / Stardew vibe) ──────────────────────────────
const C = {
  groundTop:    0x8dc96a,
  groundSide:   0x6aaa3e,
  groundDark:   0x5a9030,
  dirt:         0xb8956a,
  dirtDark:     0x9a7a50,
  water:        0x6dd4e8,
  waterLight:   0xa8eaf5,
  waterDeep:    0x3ab0cc,
  stone:        0xa0b0b8,
  stoneDark:    0x7a9098,
  stoneLight:   0xc8d8de,
  bambooLight:  0x9ad464,
  bamboo:       0x72b840,
  bambooDark:   0x4e8c28,
  bambooNode:   0x3a6e1e,
  leaf:         0x5ed448,
  leafDark:     0x3aaa28,
  leafLight:    0x88e060,
  treeTrunk:    0x7a5030,
  treeTrunkDk:  0x5a3818,
  treeLeaf:     0x5ed448,
  treeLeafDk:   0x3aaa28,
  flowerRed:    0xff6060,
  flowerYellow: 0xffe040,
  flowerPink:   0xff90c0,
  flowerWhite:  0xffffff,
  flowerStem:   0x60c030,
  lilyPad:      0x48b830,
  lilyFlower:   0xffeeaa,
  pathStone:    0xc8c0a8,
  pathStoneDk:  0xa8a090,
  fog:          0xe8f4e0,
};

function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, ...opts });
}

// ── Gradient map for toon shading ─────────────────────────────────────────
function makeGradientMap() {
  const data = new Uint8Array([60, 60, 60, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}
const gradientMap = makeGradientMap();

function mat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap, ...opts });
}

function grassMat(color, opts = {}) {
  const material = mat(color, opts);
  material.userData.baseColor = color;
  grassMaterials.push(material);
  return material;
}

export function applyGrassMaterialFromTemplate(template) {
  if (!template) return;

  const prepareMap = (map) => {
    if (!map) return null;
    const nextMap = map.clone();
    nextMap.wrapS = THREE.RepeatWrapping;
    nextMap.wrapT = THREE.RepeatWrapping;
    nextMap.repeat.set(12, 12);
    nextMap.needsUpdate = true;
    return nextMap;
  };

  grassMaterials.forEach((material) => {
    if (template.map) {
      material.map = prepareMap(template.map);
    }
    if (template.normalMap) {
      material.normalMap = prepareMap(template.normalMap);
    }
    if (template.roughnessMap) {
      material.roughnessMap = prepareMap(template.roughnessMap);
    }
    if (template.alphaMap) {
      material.alphaMap = prepareMap(template.alphaMap);
      material.transparent = true;
    }
    if (template.color) {
      material.color.copy(template.color);
    }
    material.needsUpdate = true;
  });
}

// ── Tiered ground platform ────────────────────────────────────────────────
function makeGround(scene) {
  const geo = new THREE.CylinderGeometry(18, 18.8, 0.7, 10);
  const m = new THREE.Mesh(geo, grassMat(C.groundTop));
  m.receiveShadow = true;
  scene.add(m);

  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(18.8, 19.5, 0.55, 10),
    grassMat(C.groundSide)
  );
  skirt.position.y = -0.6;
  scene.add(skirt);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(19.5, 20.2, 0.45, 10),
    grassMat(C.groundDark)
  );
  base.position.y = -1.1;
  scene.add(base);
  return m;
}

// ── Oval pond ─────────────────────────────────────────────────────────────
function makePond(scene) {
  // Pond bed
  const bedGeo = new THREE.CylinderGeometry(3.5, 3.3, 0.35, 32);
  bedGeo.scale(1.2, 1, 0.85);
  const bed = new THREE.Mesh(bedGeo, mat(C.dirtDark));
  bed.position.set(1, -0.05, 0.5);
  scene.add(bed);

  // Inner dirt ring
  const innerGeo = new THREE.CylinderGeometry(3.0, 3.0, 0.1, 32);
  innerGeo.scale(1.2, 1, 0.85);
  const inner = new THREE.Mesh(innerGeo, mat(C.dirt));
  inner.position.set(1, 0.05, 0.5);
  scene.add(inner);

  // Water
  const waterGeo = new THREE.CylinderGeometry(2.8, 2.8, 0.1, 32);
  waterGeo.scale(1.2, 1, 0.85);
  const water = new THREE.Mesh(waterGeo, mat(C.water, { transparent: true, opacity: 0.88 }));
  water.position.set(1, 0.18, 0.5);
  water.userData.isWater = true;
  scene.add(water);

  // Water highlight
  const hlGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.02, 16);
  hlGeo.scale(1.3, 1, 0.7);
  const hl = new THREE.Mesh(hlGeo, mat(C.waterLight, { transparent: true, opacity: 0.4 }));
  hl.position.set(0.5, 0.24, 0.2);
  scene.add(hl);
}

function makePondAnchor(scene) {
  const anchor = new THREE.Group();
  anchor.position.set(
    POND_LAYOUT.localPosition.x,
    POND_LAYOUT.localPosition.y,
    POND_LAYOUT.localPosition.z
  );
  scene.add(anchor);
  return anchor;
}

function makeTreeAnchor(scene) {
  const anchor = new THREE.Group();
  scene.add(anchor);
  return anchor;
}

function makeBushAnchor(scene) {
  const anchor = new THREE.Group();
  scene.add(anchor);
  return anchor;
}

export function populateLegacyPond(scene) {
  makePond(scene);
  makeRocks(scene);
  makeLilyPads(scene);
}

// ── Rocks around pond ─────────────────────────────────────────────────────
function makeRocks(scene) {
  const positions = [
    [-1.8, 0.5], [-0.5, 3.2], [1.5, 3.0], [3.2, 2.0],
    [4.0, 0.5], [3.5, -1.2], [2.0, -2.5], [0.0, -2.8],
    [-1.5, -2.2], [-2.8, -0.8], [-2.5, 1.2],
  ];
  positions.forEach(([x, z]) => {
    const s = 0.2 + Math.random() * 0.3;
    const geo = new THREE.DodecahedronGeometry(s, 0);
    const color = [C.stone, C.stoneDark, C.stoneLight][Math.floor(Math.random() * 3)];
    const rock = new THREE.Mesh(geo, mat(color));
    rock.position.set(x + 1, s * 0.35 + 0.3, z + 0.5);
    rock.rotation.set(Math.random() * 2, Math.random() * 6, Math.random() * 2);
    rock.castShadow = true;
    scene.add(rock);
  });
}

// ── Stepping stones path ──────────────────────────────────────────────────
function makeSteppingStones(scene) {
  const steps = [
    [5.5, 1.5], [6.8, 0.8], [7.8, 0.2], [8.5, -0.5],
  ];
  steps.forEach(([x, z]) => {
    const geo = new THREE.CylinderGeometry(0.35, 0.38, 0.12, 7);
    const stone = new THREE.Mesh(geo, mat(C.pathStone));
    stone.position.set(x, 0.36, z);
    stone.rotation.y = Math.random() * Math.PI;
    scene.add(stone);
    // Dark edge
    const edge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.4, 0.06, 7),
      mat(C.pathStoneDk)
    );
    edge.position.set(x, 0.3, z);
    scene.add(edge);
  });
}

// ── Lily pads ─────────────────────────────────────────────────────────────
function makeLilyPads(scene) {
  const pads = [
    [0.2, 0.8], [1.8, -0.5], [-0.5, -0.8], [2.2, 1.2], [-0.2, 1.5],
  ];
  pads.forEach(([ox, oz]) => {
    const x = ox + 1, z = oz + 0.5;
    // Pad
    const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.04, 10);
    const pad = new THREE.Mesh(geo, mat(C.lilyPad));
    pad.position.set(x, 0.22, z);
    pad.rotation.y = Math.random() * Math.PI;
    scene.add(pad);
    // Notch (small wedge cut look — just darker line)
    // Flower on some
    if (Math.random() > 0.4) {
      const fGeo = new THREE.SphereGeometry(0.1, 6, 4);
      const flower = new THREE.Mesh(fGeo, mat(C.lilyFlower));
      flower.position.set(x, 0.28, z);
      scene.add(flower);
    }
  });
}

// ── Single bamboo ─────────────────────────────────────────────────────────
function makeBamboo(x, z, scene) {
  const height = 4 + Math.random() * 2.5;
  const segs = Math.floor(height / 0.65);
  const group = new THREE.Group();

  for (let i = 0; i < segs; i++) {
    const y = i * 0.65;
    const r = 0.075 - i * 0.002;
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.max(r, 0.04), Math.max(r + 0.01, 0.05), 0.6, 7),
      mat(i % 2 === 0 ? C.bamboo : C.bambooLight)
    );
    stalk.position.y = y + 0.3;
    group.add(stalk);

    // Node
    const node = new THREE.Mesh(
      new THREE.CylinderGeometry(r + 0.025, r + 0.025, 0.055, 7),
      mat(C.bambooNode)
    );
    node.position.y = y + 0.62;
    group.add(node);

    // Leaves on upper half
    if (i >= segs - 4 && i % 2 === 0) {
      for (let l = 0; l < 4; l++) {
        const la = (l / 4) * Math.PI * 2 + Math.random() * 0.5;
        const leafGeo = new THREE.ConeGeometry(0.22, 0.75, 4);
        const leaf = new THREE.Mesh(leafGeo, mat(l % 2 === 0 ? C.leaf : C.leafDark));
        leaf.position.set(Math.cos(la) * 0.35, y + 0.5, Math.sin(la) * 0.35);
        leaf.rotation.z = Math.PI / 2.2;
        leaf.rotation.y = la;
        group.add(leaf);
      }
    }
  }

  group.position.set(x, 0.3, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);
}

function makeBambooClusters(scene) {
  [
    { cx: -11, cz: -8,  n: 7 },
    { cx:  12, cz: -8,  n: 7 },
    { cx: -12, cz:  7,  n: 6 },
    { cx:  12, cz:  8,  n: 6 },
    { cx:   0, cz: -14, n: 5 },
    { cx:  -5, cz:  12, n: 5 },
    { cx:   7, cz:  12, n: 5 },
  ].forEach(({ cx, cz, n }) => {
    for (let i = 0; i < n; i++) {
      makeBamboo(cx + (Math.random() - 0.5) * 3, cz + (Math.random() - 0.5) * 3, scene);
    }
  });
}

// ── Cartoon tree ──────────────────────────────────────────────────────────
function makeTree(x, z, scene, big = false) {
  const group = new THREE.Group();
  const h = big ? 2.5 + Math.random() : 1.5 + Math.random() * 0.8;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, h, 6),
    mat(Math.random() > 0.5 ? C.treeTrunk : C.treeTrunkDk)
  );
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const layers = big ? 4 : 3;
  for (let i = 0; i < layers; i++) {
    const r = (big ? 1.8 : 1.3) - i * 0.28;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r, 1.1, 6),
      mat(i % 2 === 0 ? C.treeLeaf : C.treeLeafDk)
    );
    cone.position.y = h + i * 0.65;
    cone.castShadow = true;
    group.add(cone);
  }

  group.position.set(x, 0.3, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);
}

function makeBorderTrees(scene) {
  const r1 = 17.5, n1 = 36;
  for (let i = 0; i < n1; i++) {
    const a = (i / n1) * Math.PI * 2;
    const r = r1 + (Math.random() - 0.5) * 0.8;
    makeTree(Math.cos(a) * r, Math.sin(a) * r, scene, true);
  }
  const r2 = 15.5, n2 = 24;
  for (let i = 0; i < n2; i++) {
    const a = (i / n2) * Math.PI * 2 + 0.18;
    const r = r2 + (Math.random() - 0.5) * 0.8;
    makeTree(Math.cos(a) * r, Math.sin(a) * r, scene, false);
  }
}

// ── Flowers ───────────────────────────────────────────────────────────────
function makeFlowers(scene) {
  const colors = [C.flowerRed, C.flowerYellow, C.flowerPink, C.flowerWhite];
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 4 + Math.random() * 5.5;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.sqrt((x - 1) ** 2 + (z - 0.5) ** 2) < 4) continue;

    // Stem
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.25, 4),
      mat(C.flowerStem)
    );
    stem.position.set(x, 0.42, z);
    scene.add(stem);

    // Petals
    const petal = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 5, 4),
      mat(colors[Math.floor(Math.random() * colors.length)])
    );
    petal.position.set(x, 0.58, z);
    scene.add(petal);

    // Center
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 5, 4),
      mat(C.flowerYellow)
    );
    center.position.set(x, 0.62, z);
    scene.add(center);
  }
}

// ── Grass tufts ───────────────────────────────────────────────────────────
function makeGrassTufts(scene) {
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 3.5 + Math.random() * 6;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.sqrt((x - 1) ** 2 + (z - 0.5) ** 2) < 4.2) continue;

    const h = 0.25 + Math.random() * 0.3;
    const geo = new THREE.ConeGeometry(0.06, h, 4);
    const tuft = new THREE.Mesh(geo, grassMat(Math.random() > 0.5 ? C.groundTop : C.groundDark));
    tuft.position.set(x, 0.3 + h / 2, z);
    tuft.rotation.y = Math.random() * Math.PI;
    tuft.rotation.z = (Math.random() - 0.5) * 0.3;
    scene.add(tuft);
  }
}

// ── Pebbles ───────────────────────────────────────────────────────────────
function makePebbles(scene) {
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 2 + Math.random() * 7;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.sqrt((x - 1) ** 2 + (z - 0.5) ** 2) < 3.8) continue;
    const s = 0.06 + Math.random() * 0.1;
    const geo = new THREE.DodecahedronGeometry(s, 0);
    const pebble = new THREE.Mesh(geo, mat(Math.random() > 0.5 ? C.stone : C.pathStone));
    pebble.position.set(x, 0.32, z);
    pebble.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(pebble);
  }
}

// ── Bushes ────────────────────────────────────────────────────────────────
function makeBushes(scene) {
  const count = 40;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    // Place between inner trees (r~9) and outer trees (r~17.5)
    const r = 12 + Math.random() * 4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    const group = new THREE.Group();
    const layers = 2 + Math.floor(Math.random() * 2);
    for (let l = 0; l < layers; l++) {
      const s = 0.5 + Math.random() * 0.4 - l * 0.1;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(s, 6, 5),
        mat(l % 2 === 0 ? C.treeLeaf : C.leafDark)
      );
      sphere.position.set(
        (Math.random() - 0.5) * 0.4,
        l * 0.3 + s * 0.5,
        (Math.random() - 0.5) * 0.4
      );
      group.add(sphere);
    }
    group.position.set(x, 0.3, z);
    scene.add(group);
  }
}
export function buildEnvironment(scene) {
  scene.fog = new THREE.Fog(C.fog, 55, 80);
  scene.background = new THREE.Color(C.fog);

  // Build into a group then scale up
  const group = new THREE.Group();
  group.scale.setScalar(1.8);
  scene.add(group);

  const ground = makeGround(group);
  const pondAnchor = makePondAnchor(group);
  const treeAnchor = makeTreeAnchor(group);
  const bushAnchor = makeBushAnchor(group);
  makeSteppingStones(group);
  makeBambooClusters(group);
  makeFlowers(group);
  makeGrassTufts(group);
  makePebbles(group);
  return { ground, group, pondAnchor, treeAnchor, bushAnchor };
}
