// The room around the shelf: environment, lighting stack, backdrop, and the
// camera framing rule that keeps the ring's wrap point off screen.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAMERA, SHELF, THEME } from '../config.js';

export class Room {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.focus = 0; // 0 while browsing, 1 while a volume is under inspection

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.environment;

    // Key light. Front left and above, the direction bookbinding photography
    // uses because it rakes across the cloth and lights the foil.
    this.key = new THREE.DirectionalLight('#ffffff', 1);
    this.key.position.set(-0.55, 0.95, 0.85);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0012;
    this.key.shadow.normalBias = 0.008;
    // Wide enough to cover the whole framed span on an ultrawide viewport,
    // where the camera pulls back furthest.
    const shadowCam = this.key.shadow.camera;
    shadowCam.left = -1.15;
    shadowCam.right = 1.15;
    shadowCam.top = 0.7;
    shadowCam.bottom = -0.5;
    shadowCam.near = 0.05;
    shadowCam.far = 3.2;
    shadowCam.updateProjectionMatrix();
    scene.add(this.key);
    scene.add(this.key.target);

    // Fill from the opposite side keeps the spines legible in the recess.
    this.fill = new THREE.DirectionalLight('#ffffff', 1);
    this.fill.position.set(0.9, 0.35, 0.7);
    scene.add(this.fill);

    // Rim from behind separates the top edges from the back panel.
    this.rim = new THREE.DirectionalLight('#ffffff', 1);
    this.rim.position.set(0.15, 0.8, -0.9);
    scene.add(this.rim);

    this.hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
    scene.add(this.hemi);

    // Backdrop and floor. Both sit well outside the casework so they read as
    // room rather than as panels.
    const surfaceGeometry = new THREE.PlaneGeometry(1, 1);
    this.surfaceGeometry = surfaceGeometry;

    this.backdropMaterial = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    this.backdrop = new THREE.Mesh(surfaceGeometry, this.backdropMaterial);
    this.backdrop.scale.set(9, 6, 1);
    this.backdrop.position.set(0, 0.4, -(SHELF.depth + 0.55));
    this.backdrop.receiveShadow = true;
    scene.add(this.backdrop);

    this.floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    this.floor = new THREE.Mesh(surfaceGeometry, this.floorMaterial);
    this.floor.scale.set(9, 6, 1);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, -0.42, -SHELF.depth / 2);
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    this.scene.fog = new THREE.Fog('#000000', 0.75, 3.4);

    this.theme = 'light';
    this.applyTheme('light');
  }

  applyTheme(name) {
    this.theme = THEME[name] ? name : 'light';
    const t = THEME[this.theme];

    this.scene.background = new THREE.Color(t.background);
    this.scene.fog.color.set(t.background);
    this.backdropMaterial.color.set(t.backdrop);
    this.floorMaterial.color.set(t.floor);

    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.key.color.set(t.keyColor);
    this.fill.color.set(t.fillColor);
    this.rim.color.set(t.rimColor);

    this.scene.environmentIntensity = t.envIntensity;
    this.renderer.toneMappingExposure = t.exposure;

    this.applyFocus(this.focus);
  }

  /**
   * Dims the room as a volume is drawn out, so the surrounding shelf recedes
   * and the subject holds the frame. 0 is the browse state, 1 is inspection.
   */
  applyFocus(amount) {
    this.focus = THREE.MathUtils.clamp(amount, 0, 1);
    const t = THEME[this.theme];
    const dim = THREE.MathUtils.lerp(1, t.inspectDim, this.focus);

    this.hemi.intensity = t.hemiIntensity * dim;
    this.key.intensity = THREE.MathUtils.lerp(t.keyIntensity, t.keyIntensity * 1.08, this.focus);
    this.fill.intensity = t.fillIntensity * dim;
    this.rim.intensity = t.rimIntensity * THREE.MathUtils.lerp(1, 0.72, this.focus);
    this.scene.environmentIntensity = t.envIntensity * THREE.MathUtils.lerp(1, 1.25, this.focus);
  }

  dispose() {
    this.environment.dispose();
    this.backdropMaterial.dispose();
    this.floorMaterial.dispose();
    this.surfaceGeometry.dispose();
  }
}

/**
 * Works out the browse camera pose without moving anything.
 *
 * Two rules compete. The shelf should fill the frame vertically, and at least a
 * handful of volumes should be readable across it. A third rule overrides both:
 * never pull back far enough that the visible width approaches the ring width,
 * because that is the point where a volume would appear twice.
 *
 * The caller applies the result, so a resize during inspection can refresh the
 * pose the experience will return to without snatching the camera from the
 * orbit rig.
 */
export function computeFraming(shelf, width, height) {
  const aspect = width / Math.max(1, height);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(CAMERA.fov) / 2);

  const volumes =
    aspect > 1.35
      ? CAMERA.volumesInFrame.wide
      : aspect > 0.85
        ? CAMERA.volumesInFrame.medium
        : CAMERA.volumesInFrame.narrow;

  const minWidth = volumes * shelf.averagePitch;

  const forWidth = minWidth / (2 * tanHalf * aspect);
  const forHeight = (SHELF.openingHeight * 1.05) / (2 * tanHalf);
  const ringLimit = (shelf.ringWidth * 0.82) / (2 * tanHalf * aspect);

  // A hard floor: the tallest volume is never cropped, whatever the aspect.
  const forTallest = (shelf.tallest * 1.12) / (2 * tanHalf);

  const preferred = Math.min(Math.max(forWidth, forHeight), Math.max(forWidth, ringLimit));
  // Past roughly 2.5:1 these two rules cannot both hold. Keeping the volumes
  // whole wins; the cost is bare shelf at the extreme edges of a very wide
  // viewport, which the continuous casework absorbs.
  const distance = Math.max(preferred, forTallest);

  const targetY = SHELF.openingHeight * CAMERA.browseHeightFraction;

  return {
    distance,
    position: new THREE.Vector3(
      0,
      targetY + distance * Math.sin(CAMERA.browseTilt),
      distance * Math.cos(CAMERA.browseTilt)
    ),
    target: new THREE.Vector3(0, targetY, 0),
    visibleWidth: 2 * tanHalf * distance * aspect,
    visibleHeight: 2 * tanHalf * distance,
  };
}
