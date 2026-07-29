// Bootstrap and frame loop.
//
// One owner for the renderer, scene, camera, resize, and disposal. Browsing owns
// the shelf offset, inspection owns the selected volume's pose, and neither
// reaches into the other.

import * as THREE from 'three';
import { CAMERA, TEXTURE } from './config.js';
import { CATALOG } from './catalog.js';
import { loadCoverPack } from './assets/loader.js';
import { Shelf } from './scene/shelf.js';
import { Room, computeFraming } from './scene/room.js';
import { BrowseController } from './interaction/browse.js';
import { InspectController } from './interaction/inspect.js';
import { Overlay } from './ui/overlay.js';

const canvas = document.getElementById('scene');

const overlay = new Overlay({
  catalog: CATALOG,
  onStep: (delta) => browse?.step(delta),
  onGoTo: (index) => browse?.goTo(index),
  onOpen: () => inspect?.enter(browse.selectedIndex),
  onClose: () => inspect?.exit(),
});

let renderer;
let scene;
let camera;
let room;
let shelf;
let browse;
let inspect;
let framing = { target: new THREE.Vector3(), position: new THREE.Vector3() };

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const clock = new THREE.Clock();

function currentTheme() {
  return themeQuery.matches ? 'dark' : 'light';
}

function reducedMotion() {
  return motionQuery.matches;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function start() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral holds the warmth of cream paper and walnut where ACES would pull it
  // toward grey.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

  const pack = await loadCoverPack({
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    onProgress: (done, total, label) => overlay.setProgress(done, total, label),
  });

  shelf = new Shelf(pack);
  scene.add(shelf.group);

  room = new Room(scene, renderer);
  room.applyTheme(currentTheme());

  browse = new BrowseController({
    shelf,
    canvas,
    camera,
    onSelect: (index) => overlay.setVolume(index),
    onActivate: (index) => inspect.enter(index),
  });

  inspect = new InspectController({
    shelf,
    browse,
    camera,
    canvas,
    room,
    getBrowsePose: () => framing,
    onStateChange: (state) => {
      if (state === 'entering' || state === 'leaving') overlay.setMode('transition');
      else if (state === 'inspect') overlay.setMode('inspect');
      else overlay.setMode('browse');
    },
  });
  inspect.detailSize = TEXTURE.coverSize;

  // Preview boards are cheap and mean the inspection swap never shows a bare
  // cloth cover for a frame.
  await Promise.all(shelf.books.map((book) => book.loadCoverPreview(pack.coverPreviewSize)));

  applyMotionPreference();
  resize();
  browse.goTo(0, { immediate: true });
  overlay.setVolume(0);
  overlay.setMode('browse');
  overlay.setReady();

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  window.addEventListener('keydown', onGlobalKey);
  motionQuery.addEventListener('change', applyMotionPreference);
  themeQuery.addEventListener('change', () => room.applyTheme(currentTheme()));

  canvas.focus({ preventScroll: true });
  renderer.setAnimationLoop(tick);
}

function applyMotionPreference() {
  const reduced = reducedMotion();
  browse.setReducedMotion(reduced);
  inspect.setReducedMotion(reduced);
}

function onGlobalKey(event) {
  if (event.key === 'Escape' && inspect.isInspecting) {
    event.preventDefault();
    inspect.exit();
  }
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function resize() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);

  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();

  // computeFraming is the only place that decides how the shelf is framed.
  framing = computeFraming(shelf, width, height);
  browse.setViewport(framing.visibleWidth, width);

  // While inspecting the camera belongs to the orbit rig, so only the pose the
  // experience will return to is refreshed.
  if (inspect.isInspecting) {
    inspect.handleResize();
  } else {
    camera.position.copy(framing.position);
    camera.lookAt(framing.target);
  }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  inspect.update(dt);
  browse.update(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------

start().catch((error) => {
  console.error(error);
  overlay.setError(
    'The shelf could not be built. Reload the page, and check the console for the underlying error.'
  );
});
