// The continuous shelf.
//
// Volumes are laid out once into a ring of total width W. Every frame each one
// is placed at wrap(baseX - offset), so dragging past the last volume brings the
// first one round again with no end stop and no seam. W is kept comfortably
// wider than the frame, and the camera rig refuses to pull back past the point
// where the wrap would become visible.

import * as THREE from 'three';
import { SHELF } from '../config.js';
import { Book } from './book.js';

/** Maps any value onto the ring, into the range [-width/2, width/2). */
export function wrapToRing(value, width) {
  return value - width * Math.round(value / width);
}

export class Shelf {
  constructor(pack) {
    this.group = new THREE.Group();
    this.group.name = 'shelf';

    this.books = [];
    this.slots = [];
    this.dividerPositions = [];

    // Front alignment: every spine sits the same distance behind the deck edge,
    // the way books are pulled forward to a shelf's front rail.
    this.spineInset = 0.012;

    this.#layout(pack);
    this.#buildCasework(pack);
  }

  #layout(pack) {
    const gap = SHELF.gap;
    const dividerT = SHELF.dividerThickness;
    let cursor = 0;

    const entries = [...pack.items.values()].sort((a, b) => a.index - b.index);

    entries.forEach((entry, i) => {
      if (i > 0 && i % SHELF.dividerEvery === 0) {
        this.dividerPositions.push(cursor + dividerT / 2);
        cursor += dividerT + gap;
      }

      const book = new Book(entry, pack.shared);
      const t = book.dims.thickness;
      this.slots.push(cursor + t / 2);
      // Base pose within the slot. Browsing writes group.position.x each frame;
      // y and z are fixed by the format.
      book.baseZ = -this.spineInset - book.dims.width / 2;
      book.group.position.set(0, 0, book.baseZ);
      this.books.push(book);
      this.group.add(book.group);

      cursor += t + gap;
    });

    // A closing divider so the wrap point looks like every other join.
    this.dividerPositions.push(cursor + dividerT / 2);
    cursor += dividerT + gap;

    this.ringWidth = cursor;
    this.averagePitch = this.ringWidth / this.books.length;
    this.tallest = Math.max(...this.books.map((book) => book.dims.height));
  }

  #buildCasework(pack) {
    const { map, normalMap } = pack.shared.wood;
    const span = this.ringWidth * 1.06;

    if (map) {
      map.repeat.set(span / 0.9, 1);
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
    }
    if (normalMap) {
      normalMap.repeat.set(span / 0.9, 1);
      normalMap.wrapS = THREE.RepeatWrapping;
      normalMap.wrapT = THREE.RepeatWrapping;
    }

    this.woodMaterial = new THREE.MeshStandardMaterial({
      map: map ?? null,
      normalMap: normalMap ?? null,
      normalScale: new THREE.Vector2(0.6, 0.6),
      color: '#ffffff',
      roughness: 0.62,
      metalness: 0,
    });

    // Dividers and the back panel read better without the plank grain stretched
    // across them, so they share the material but not the repeat.
    this.woodEndMaterial = new THREE.MeshStandardMaterial({
      color: '#5b3d22',
      roughness: 0.66,
      metalness: 0,
    });

    const box = new THREE.BoxGeometry(1, 1, 1);
    this.caseGeometry = box;

    const deckT = SHELF.deckThickness;
    const depth = SHELF.depth;
    const opening = SHELF.openingHeight;

    const add = (material, sx, sy, sz, x, y, z) => {
      const mesh = new THREE.Mesh(box, material);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    // Deck the volumes stand on. Its top face is y = 0.
    add(this.woodMaterial, span, deckT, depth, 0, -deckT / 2, -depth / 2);

    // Top plank. Extended upward so a wide viewport never sees past it.
    add(this.woodMaterial, span, deckT, depth, 0, opening + deckT / 2, -depth / 2);

    // Back panel. It runs a long way below the deck and above the top plank so
    // that a tall or cropped viewport never sees past the casework into the
    // room, and the shelf never looks like it is floating.
    const backH = opening + 1.1;
    add(
      this.woodEndMaterial,
      span,
      backH,
      SHELF.backPanelThickness,
      0,
      opening / 2 - 0.34,
      -depth - SHELF.backPanelThickness / 2
    );

    this.dividerMeshes = this.dividerPositions.map(() =>
      add(
        this.woodEndMaterial,
        SHELF.dividerThickness,
        opening,
        depth * 0.93,
        0,
        opening / 2,
        -depth * 0.93 / 2
      )
    );
  }

  /** Places every volume and divider for the given scroll position. */
  setOffset(offset) {
    const W = this.ringWidth;

    this.books.forEach((book, i) => {
      const x = wrapToRing(this.slots[i] - offset, W);
      book.group.position.set(
        x + book.offset.x,
        book.hoverLift + book.offset.y,
        book.baseZ + book.offset.z
      );
      book.group.rotation.set(
        book.rotationOffset.x,
        book.rotationOffset.y,
        book.rotationOffset.z
      );
    });

    this.dividerMeshes.forEach((mesh, i) => {
      mesh.position.x = wrapToRing(this.dividerPositions[i] - offset, W);
    });
  }

  /** Index of the volume nearest the centre of the frame. */
  indexAt(offset) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.slots.length; i += 1) {
      const distance = Math.abs(wrapToRing(this.slots[i] - offset, this.ringWidth));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /**
   * Offset that centres a volume, chosen on the near side of the ring so the
   * shelf never spins the long way round to reach a neighbour.
   */
  offsetForIndex(index, fromOffset) {
    const wrapped = wrapToRing(this.slots[index] - fromOffset, this.ringWidth);
    return fromOffset + wrapped;
  }

  /** Signed distance in volumes from the centre, used for the marker rail. */
  progressAt(offset) {
    return wrapToRing(offset, this.ringWidth) / this.ringWidth;
  }

  bookById(id) {
    return this.books.find((book) => book.volume.id === id) ?? null;
  }

  dispose() {
    this.books.forEach((book) => book.dispose());
    this.woodMaterial.dispose();
    this.woodEndMaterial.dispose();
    this.caseGeometry.dispose();
  }
}
