// Browsing the continuous shelf.
//
// Five input paths write to one number. Drag, wheel, arrow keys, the previous
// and next buttons, and the marker rail all move `targetOffset`; the frame loop
// eases `offset` toward it and hands the result to the shelf. Nothing else in
// the app is allowed to move the shelf.

import * as THREE from 'three';
import { MOTION } from '../config.js';
import { wrapToRing } from '../scene/shelf.js';

const SELECTION_LIFT = 0.011;

export class BrowseController {
  constructor({ shelf, canvas, camera, onSelect, onActivate }) {
    this.shelf = shelf;
    this.canvas = canvas;
    this.camera = camera;
    this.onSelect = onSelect ?? (() => {});
    this.onActivate = onActivate ?? (() => {});

    this.offset = 0;
    this.targetOffset = 0;
    this.enabled = true;
    this.reducedMotion = false;
    this.metersPerPixel = 0.0008;

    this.selectedIndex = 0;
    this.hoveredIndex = -1;

    this.pointerId = null;
    this.dragStartX = 0;
    this.dragLastX = 0;
    this.dragMoved = 0;
    this.samples = [];
    this.wheelTimer = 0;

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.pickTargets = [];
    shelf.books.forEach((book) => {
      book.group.traverse((child) => {
        if (child.isMesh) this.pickTargets.push(child);
      });
    });

    this.#bind();
  }

  #bind() {
    this.handlers = {
      pointerdown: this.#onPointerDown.bind(this),
      pointermove: this.#onPointerMove.bind(this),
      pointerup: this.#onPointerUp.bind(this),
      pointercancel: this.#onPointerCancel.bind(this),
      pointerleave: this.#onPointerLeave.bind(this),
      wheel: this.#onWheel.bind(this),
      keydown: this.#onKeyDown.bind(this),
    };

    this.canvas.addEventListener('pointerdown', this.handlers.pointerdown);
    this.canvas.addEventListener('pointermove', this.handlers.pointermove);
    this.canvas.addEventListener('pointerup', this.handlers.pointerup);
    this.canvas.addEventListener('pointercancel', this.handlers.pointercancel);
    this.canvas.addEventListener('pointerleave', this.handlers.pointerleave);
    this.canvas.addEventListener('wheel', this.handlers.wheel, { passive: false });
    // Keys are bound at the window so browsing still answers the arrow keys
    // after the pointer has moved focus to a button in the interface.
    window.addEventListener('keydown', this.handlers.keydown);
  }

  detach() {
    this.canvas.removeEventListener('pointerdown', this.handlers.pointerdown);
    this.canvas.removeEventListener('pointermove', this.handlers.pointermove);
    this.canvas.removeEventListener('pointerup', this.handlers.pointerup);
    this.canvas.removeEventListener('pointercancel', this.handlers.pointercancel);
    this.canvas.removeEventListener('pointerleave', this.handlers.pointerleave);
    this.canvas.removeEventListener('wheel', this.handlers.wheel);
    window.removeEventListener('keydown', this.handlers.keydown);
  }

  setViewport(visibleWidth, cssWidth) {
    // Drag tracks the shelf one to one under the pointer.
    this.metersPerPixel = visibleWidth / Math.max(1, cssWidth);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.#endDrag();
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  #onPointerDown(event) {
    if (!this.enabled || event.button !== 0) return;
    this.canvas.focus({ preventScroll: true });
    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    this.dragStartX = event.clientX;
    this.dragLastX = event.clientX;
    this.dragMoved = 0;
    this.samples = [{ x: event.clientX, time: event.timeStamp }];
    this.canvas.classList.add('is-dragging');
  }

  #onPointerMove(event) {
    if (!this.enabled) return;

    if (this.pointerId === event.pointerId) {
      const dx = event.clientX - this.dragLastX;
      this.dragLastX = event.clientX;
      this.dragMoved += Math.abs(dx);
      // Pointer right moves volumes right, which means a smaller offset.
      this.offset -= dx * this.metersPerPixel;
      this.targetOffset = this.offset;

      this.samples.push({ x: event.clientX, time: event.timeStamp });
      while (this.samples.length > 6) this.samples.shift();
      return;
    }

    this.hoverPending = { x: event.clientX, y: event.clientY };
  }

  #onPointerUp(event) {
    if (this.pointerId !== event.pointerId) return;
    const wasTap = this.dragMoved < MOTION.dragTapThresholdPx;
    const velocity = this.#releaseVelocity(event.timeStamp);
    this.#endDrag();

    if (wasTap) {
      const hit = this.pickAt(event.clientX, event.clientY);
      if (hit >= 0) {
        this.goTo(hit);
        this.onActivate(hit);
        return;
      }
    }

    this.#settle(velocity);
  }

  #onPointerCancel(event) {
    if (this.pointerId !== event.pointerId) return;
    this.#endDrag();
    this.#settle(0);
  }

  #onPointerLeave() {
    this.hoverPending = null;
    if (this.hoveredIndex !== -1) {
      this.hoveredIndex = -1;
      this.canvas.classList.remove('is-over-volume');
    }
  }

  #endDrag() {
    if (this.pointerId !== null) {
      if (this.canvas.hasPointerCapture(this.pointerId)) {
        this.canvas.releasePointerCapture(this.pointerId);
      }
      this.pointerId = null;
    }
    this.canvas.classList.remove('is-dragging');
  }

  /** Metres per second, measured over the last few pointer samples. */
  #releaseVelocity(endTime) {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const elapsed = Math.max(1, (endTime || last.time) - first.time);
    if (endTime - last.time > 90) return 0; // paused before releasing
    const pixelsPerMs = (last.x - first.x) / elapsed;
    return -pixelsPerMs * 1000 * this.metersPerPixel;
  }

  /** Projects a flick, then lands it on a volume rather than between two. */
  #settle(velocity) {
    if (this.reducedMotion || Math.abs(velocity) < 0.02) {
      this.targetOffset = this.shelf.offsetForIndex(
        this.shelf.indexAt(this.offset),
        this.offset
      );
      return;
    }
    const reach = THREE.MathUtils.clamp(
      velocity * MOTION.flickProjectionSeconds,
      -MOTION.maxFlickVolumes * this.shelf.averagePitch,
      MOTION.maxFlickVolumes * this.shelf.averagePitch
    );
    const projected = this.offset + reach;
    this.targetOffset = this.shelf.offsetForIndex(this.shelf.indexAt(projected), projected);
  }

  // -------------------------------------------------------------------------
  // Wheel and keyboard
  // -------------------------------------------------------------------------

  #onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();

    let unit = 1;
    if (event.deltaMode === 1) unit = 16; // lines
    else if (event.deltaMode === 2) unit = this.canvas.clientHeight; // pages

    // Trackpads report horizontal intent on deltaX; wheels report on deltaY.
    const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    this.targetOffset += raw * unit * this.metersPerPixel;

    if (this.reducedMotion) {
      this.offset = this.targetOffset;
    }

    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      this.targetOffset = this.shelf.offsetForIndex(
        this.shelf.indexAt(this.targetOffset),
        this.targetOffset
      );
    }, MOTION.wheelIdleMs);
  }

  #onKeyDown(event) {
    if (!this.enabled) return;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.step(1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.step(-1);
        break;
      case 'Home':
        event.preventDefault();
        this.goTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.goTo(this.shelf.books.length - 1);
        break;
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        // A focused button owns Enter and Space; do not open a volume as well.
        if (event.key !== 'ArrowUp' && event.target?.closest?.('button')) return;
        event.preventDefault();
        this.onActivate(this.selectedIndex);
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Programmatic movement
  // -------------------------------------------------------------------------

  step(delta) {
    const count = this.shelf.books.length;
    const next = (((this.selectedIndex + delta) % count) + count) % count;
    this.goTo(next);
  }

  goTo(index, { immediate = false } = {}) {
    this.targetOffset = this.shelf.offsetForIndex(index, this.offset);
    if (immediate || this.reducedMotion) this.offset = this.targetOffset;
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickTargets, false);
    if (hits.length === 0) return -1;
    const index = hits[0].object.userData.bookIndex;
    return typeof index === 'number' ? index : -1;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt) {
    if (this.pointerId === null) {
      this.offset = this.reducedMotion
        ? this.targetOffset
        : THREE.MathUtils.damp(this.offset, this.targetOffset, MOTION.glideLambda, dt);
    }

    // One raycast per frame at most, and only when the pointer actually moved.
    if (this.hoverPending && this.enabled && this.pointerId === null) {
      const index = this.pickAt(this.hoverPending.x, this.hoverPending.y);
      this.hoverPending = null;
      if (index !== this.hoveredIndex) {
        this.hoveredIndex = index;
        this.canvas.classList.toggle('is-over-volume', index >= 0);
      }
    }

    const index = this.shelf.indexAt(this.offset);
    if (index !== this.selectedIndex) {
      this.selectedIndex = index;
      this.onSelect(index);
    }

    // The centred volume stands a little proud of its neighbours.
    const lift = this.reducedMotion ? 1 : 8;
    this.shelf.books.forEach((book, i) => {
      const wanted = i === this.selectedIndex && this.enabled ? SELECTION_LIFT : 0;
      book.hoverLift = this.reducedMotion
        ? wanted
        : THREE.MathUtils.damp(book.hoverLift, wanted, lift, dt);
    });

    this.shelf.setOffset(this.offset);
  }

  /** Distance of the centred volume from the exact centre, in metres. */
  centreError() {
    return Math.abs(
      wrapToRing(this.shelf.slots[this.selectedIndex] - this.offset, this.shelf.ringWidth)
    );
  }
}
