// Builds one clothbound hardcover.
//
// Local axes, matching how a book actually stands on a shelf:
//   x  thickness, spine width, centred on zero
//   y  height, zero at the deck
//   z  depth, the spine faces +z toward the room, the fore edge faces -z

import * as THREE from 'three';
import { BINDING, FORMATS } from '../config.js';
import { WEAVE_TILE_METRES } from '../assets/procedural.js';

// One repeat figure serves every format. It is derived from the octavo board so
// the thread pitch on the boards matches the weave baked into the spine and
// cover art, which is generated per volume at true scale.
const CLOTH_REPEAT = new THREE.Vector2(
  (FORMATS.octavo.width - FORMATS.octavo.thickness / 2) / WEAVE_TILE_METRES,
  FORMATS.octavo.height / WEAVE_TILE_METRES
);

let sharedGeometry = null;

function getSharedGeometry() {
  if (!sharedGeometry) {
    sharedGeometry = {
      // Unit primitives, scaled per volume. Sharing them keeps the draw
      // buffers small across nineteen books.
      box: new THREE.BoxGeometry(1, 1, 1),
      plane: new THREE.PlaneGeometry(1, 1),
      // The spine is the +z facing half of a cylinder. thetaStart -PI/2 puts
      // u = 0 on the -x edge, so texture left is the viewer's left.
      spine: new THREE.CylinderGeometry(0.5, 0.5, 1, 26, 1, true, -Math.PI / 2, Math.PI),
      headband: new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1),
    };
  }
  return sharedGeometry;
}

export class Book {
  /**
   * @param {object} entry one value from the loader's items map
   * @param {object} surfaces shared cloth and page textures
   */
  constructor(entry, surfaces) {
    this.volume = entry.volume;
    this.dims = entry.dims;
    this.index = entry.index;
    this.makeCover = entry.makeCover;

    this.detailTextures = null;
    this.previewTextures = null;

    const g = getSharedGeometry();
    const { height: h, width: w, thickness: t } = this.dims;
    const bt = BINDING.boardThickness;
    const overhang = BINDING.boardOverhang;
    const radius = t / 2;
    const hinge = BINDING.hingeInset;

    this.group = new THREE.Group();
    this.group.name = `volume:${this.volume.id}`;

    // --- materials ---------------------------------------------------------
    const clothColor = new THREE.Color(this.volume.cloth);
    const sheenColor = clothColor.clone().lerp(new THREE.Color('#ffffff'), 0.45);

    if (surfaces.cloth.map) surfaces.cloth.map.repeat.copy(CLOTH_REPEAT);
    if (surfaces.cloth.normalMap) surfaces.cloth.normalMap.repeat.copy(CLOTH_REPEAT);

    this.clothMaterial = new THREE.MeshPhysicalMaterial({
      color: clothColor,
      map: surfaces.cloth.map ?? null,
      normalMap: surfaces.cloth.normalMap ?? null,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.88,
      metalness: 0,
      sheen: 0.55,
      sheenRoughness: 0.72,
      sheenColor,
    });

    // Green carries roughness, blue carries metalness, so one packed map drives
    // both the cloth and the foil stamped into it.
    this.spineMaterial = new THREE.MeshPhysicalMaterial({
      map: entry.spine.map,
      roughnessMap: entry.spine.ormMap ?? null,
      metalnessMap: entry.spine.ormMap ?? null,
      roughness: entry.spine.ormMap ? 1 : 0.88,
      metalness: entry.spine.ormMap ? 1 : 0,
      normalMap: surfaces.cloth.normalMap ?? null,
      normalScale: new THREE.Vector2(0.28, 0.28),
      sheen: 0.4,
      sheenRoughness: 0.75,
      sheenColor,
      envMapIntensity: 1.15,
    });

    this.coverMaterial = new THREE.MeshPhysicalMaterial({
      color: clothColor,
      map: surfaces.cloth.map ?? null,
      normalMap: surfaces.cloth.normalMap ?? null,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.88,
      metalness: 0,
      sheen: 0.55,
      sheenRoughness: 0.72,
      sheenColor,
      envMapIntensity: 1.15,
    });

    this.pageMaterial = new THREE.MeshStandardMaterial({
      map: surfaces.page.map ?? null,
      color: '#ffffff',
      roughness: 0.94,
      metalness: 0,
    });

    this.headbandMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.volume.headband),
      roughness: 0.7,
      metalness: 0,
    });

    // --- text block --------------------------------------------------------
    const pagesFront = -w / 2 + overhang;
    const pagesBack = w / 2 - radius - hinge;
    const pagesDepth = pagesBack - pagesFront;

    const pages = new THREE.Mesh(g.box, this.pageMaterial);
    pages.scale.set(t - bt * 2, h - overhang * 2, pagesDepth);
    pages.position.set(0, h / 2, (pagesFront + pagesBack) / 2);
    this.group.add(pages);

    // --- boards ------------------------------------------------------------
    // The boards stop at the spine cylinder's widest line, where the curve is
    // exactly tangent to the board face. They meet at that corner with no gap
    // and nothing pokes through the curve.
    const boardDepth = w - radius;
    const boardZ = -radius / 2;

    const frontBoard = new THREE.Mesh(g.box, this.clothMaterial);
    frontBoard.scale.set(bt, h, boardDepth);
    frontBoard.position.set(t / 2 - bt / 2, h / 2, boardZ);
    this.group.add(frontBoard);

    const backBoard = new THREE.Mesh(g.box, this.clothMaterial);
    backBoard.scale.set(bt, h, boardDepth);
    backBoard.position.set(-(t / 2 - bt / 2), h / 2, boardZ);
    this.group.add(backBoard);

    // --- spine -------------------------------------------------------------
    const spine = new THREE.Mesh(g.spine, this.spineMaterial);
    spine.scale.set(t, h, t);
    spine.position.set(0, h / 2, w / 2 - radius);
    this.group.add(spine);
    this.spineMesh = spine;

    // --- headbands ---------------------------------------------------------
    const hb = BINDING.headbandHeight;
    [h - overhang - hb * 0.4, overhang + hb * 0.4].forEach((y) => {
      const band = new THREE.Mesh(g.headband, this.headbandMaterial);
      band.scale.set(hb, t - bt * 2, hb);
      band.rotation.z = Math.PI / 2;
      band.position.set(0, y, pagesBack - hb * 0.1);
      this.group.add(band);
    });

    // --- front cover plate -------------------------------------------------
    // Carries the stamped board art. Sits a fraction proud of the board so it
    // never fights the box for depth.
    const plate = new THREE.Mesh(g.plane, this.coverMaterial);
    plate.scale.set(boardDepth, h, 1);
    plate.rotation.y = Math.PI / 2;
    plate.position.set(t / 2 + 0.00012, h / 2, boardZ);
    this.group.add(plate);
    this.coverPlate = plate;

    this.group.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.bookId = this.volume.id;
        child.userData.bookIndex = this.index;
      }
    });

    // A single sided plane sitting a fraction proud of the board would only
    // cast a shadow onto the board behind it.
    plate.castShadow = false;

    // Presentation offsets, layered on top of the shelf slot. Browsing writes
    // the slot and hoverLift, inspection writes offset and rotationOffset, so
    // the two systems never fight over the same value.
    this.offset = new THREE.Vector3();
    this.rotationOffset = new THREE.Euler();
    this.hoverLift = 0;
  }

  get height() {
    return this.dims.height;
  }

  /** Centre of the volume in its own local space, used as the orbit target. */
  get localCentre() {
    return new THREE.Vector3(0, this.dims.height / 2, 0);
  }

  /** Falls back to plain cloth when no stamped board is available. */
  resetCoverToCloth() {
    this.coverMaterial.map = this.clothMaterial.map;
    this.coverMaterial.roughnessMap = null;
    this.coverMaterial.metalnessMap = null;
    this.coverMaterial.roughness = 0.88;
    this.coverMaterial.metalness = 0;
    this.coverMaterial.color.set(this.volume.cloth);
    this.coverMaterial.needsUpdate = true;
  }

  applyTextures(textures) {
    if (!textures) {
      this.resetCoverToCloth();
      return;
    }
    this.coverMaterial.map = textures.map;
    this.coverMaterial.roughnessMap = textures.ormMap ?? null;
    this.coverMaterial.metalnessMap = textures.ormMap ?? null;
    this.coverMaterial.roughness = textures.ormMap ? 1 : 0.88;
    this.coverMaterial.metalness = textures.ormMap ? 1 : 0;
    this.coverMaterial.color.set(textures.ormMap ? '#ffffff' : this.volume.cloth);
    this.coverMaterial.needsUpdate = true;
  }

  /** Swap in a high resolution board for inspection. */
  async showCoverDetail(size) {
    if (this.detailTextures) {
      this.applyTextures(this.detailTextures);
      return;
    }
    this.detailTextures = await this.makeCover(size);
    this.applyTextures(this.detailTextures);
  }

  /** Drop the inspection board and release its memory. */
  releaseCoverDetail() {
    if (!this.detailTextures) return;
    this.applyTextures(this.previewTextures);
    disposeTextureSet(this.detailTextures);
    this.detailTextures = null;
  }

  async loadCoverPreview(size) {
    if (this.previewTextures) return;
    this.previewTextures = await this.makeCover(size);
    if (!this.detailTextures) this.applyTextures(this.previewTextures);
  }

  dispose() {
    this.clothMaterial.dispose();
    this.spineMaterial.dispose();
    this.coverMaterial.dispose();
    this.pageMaterial.dispose();
    this.headbandMaterial.dispose();
    disposeTextureSet(this.detailTextures);
    disposeTextureSet(this.previewTextures);
    this.detailTextures = null;
    this.previewTextures = null;
  }
}

function disposeTextureSet(set) {
  if (!set) return;
  if (set.map) set.map.dispose();
  if (set.ormMap) set.ormMap.dispose();
}

export function disposeSharedGeometry() {
  if (!sharedGeometry) return;
  Object.values(sharedGeometry).forEach((geometry) => geometry.dispose());
  sharedGeometry = null;
}
