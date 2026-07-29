// Pulling a volume off the shelf and inspecting it.
//
// One coordinated transition moves four things at once: the volume slides
// forward and turns to a three quarter view, the shelf glides so that volume is
// centred, the camera dollies in, and the room dims. When it lands, orbit
// control takes over. Leaving runs the same tween backwards.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { INSPECT, MOTION } from '../config.js';

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class InspectController {
  constructor({ shelf, browse, camera, canvas, room, getBrowsePose, onStateChange }) {
    this.shelf = shelf;
    this.browse = browse;
    this.camera = camera;
    this.room = room;
    this.getBrowsePose = getBrowsePose;
    this.onStateChange = onStateChange ?? (() => {});

    this.state = 'browse'; // browse | entering | inspect | leaving
    this.book = null;
    this.reducedMotion = false;

    this.controls = new OrbitControls(camera, canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.52;
    this.controls.panSpeed = 0.62;
    this.controls.zoomSpeed = 0.8;
    this.controls.screenSpacePanning = true;
    this.controls.minPolarAngle = INSPECT.minPolarAngle;
    this.controls.maxPolarAngle = INSPECT.maxPolarAngle;

    // Tween bookkeeping
    this.t = 0;
    this.duration = MOTION.transitionSeconds;
    this.from = this.#emptyPose();
    this.to = this.#emptyPose();
    this.lookTarget = new THREE.Vector3();
    this.anchor = new THREE.Vector3();
  }

  #emptyPose() {
    return {
      cameraPosition: new THREE.Vector3(),
      lookAt: new THREE.Vector3(),
      bookOffset: new THREE.Vector3(),
      bookYaw: 0,
      bookPitch: 0,
      shelfOffset: 0,
      focus: 0,
    };
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
    this.duration = reduced ? 0.001 : MOTION.transitionSeconds;
  }

  get isBusy() {
    return this.state === 'entering' || this.state === 'leaving';
  }

  get isInspecting() {
    return this.state === 'inspect' || this.state === 'entering';
  }

  // -------------------------------------------------------------------------

  enter(index) {
    if (this.isBusy) return;
    const book = this.shelf.books[index];
    if (!book) return;

    if (this.state === 'inspect') {
      if (book === this.book) return;
      // Switching volumes: release the current one first.
      this.#restoreBook();
    }

    this.book = book;
    this.controls.enabled = false;
    this.browse.setEnabled(false);

    const dims = book.dims;
    const targetShelfOffset = this.shelf.offsetForIndex(index, this.browse.offset);

    // Where the volume ends up, in shelf space. The group turns about its own
    // base, so the orbit target is the rotated centre, not the resting one.
    const restZ = book.baseZ;
    const outZ = INSPECT.forward;
    const centre = new THREE.Vector3(0, dims.height / 2, 0).applyEuler(
      new THREE.Euler(INSPECT.pitch, INSPECT.yaw, 0)
    );
    this.anchor.set(centre.x, INSPECT.lift + centre.y, restZ + outZ + centre.z);

    // Frame the volume by its own height so every format lands the same size.
    const distance = dims.height * 1.62;
    const direction = new THREE.Vector3(0.2, 0.26, 1).normalize();
    const cameraTo = this.anchor.clone().addScaledVector(direction, distance);

    const pose = this.getBrowsePose();
    this.from = {
      cameraPosition: this.camera.position.clone(),
      lookAt: pose.target.clone(),
      bookOffset: book.offset.clone(),
      bookYaw: book.rotationOffset.y,
      bookPitch: book.rotationOffset.x,
      shelfOffset: this.browse.offset,
      focus: this.room.focus,
    };
    this.to = {
      cameraPosition: cameraTo,
      lookAt: this.anchor.clone(),
      bookOffset: new THREE.Vector3(0, INSPECT.lift, outZ),
      bookYaw: INSPECT.yaw,
      bookPitch: INSPECT.pitch,
      shelfOffset: targetShelfOffset,
      focus: 1,
    };

    this.t = 0;
    this.state = 'entering';
    this.onStateChange(this.state, book);

    // The stamped board is only legible up close, so it is built now rather
    // than paid for by all nineteen volumes at load.
    book.showCoverDetail(this.detailSize ?? 1024).catch(() => {
      // A failed upgrade leaves the preview board in place, which still reads.
    });
  }

  exit() {
    if (this.state !== 'inspect' && this.state !== 'entering') return;

    this.controls.enabled = false;
    const pose = this.getBrowsePose();

    // Mid entry the orbit target has not been handed over yet, so the live
    // tween target is the truthful reading of where the camera is looking.
    const lookingAt =
      this.state === 'inspect' ? this.controls.target.clone() : this.lookTarget.clone();

    this.from = {
      cameraPosition: this.camera.position.clone(),
      lookAt: lookingAt,
      bookOffset: this.book.offset.clone(),
      bookYaw: this.book.rotationOffset.y,
      bookPitch: this.book.rotationOffset.x,
      shelfOffset: this.browse.offset,
      focus: this.room.focus,
    };
    this.to = {
      cameraPosition: pose.position.clone(),
      lookAt: pose.target.clone(),
      bookOffset: new THREE.Vector3(),
      bookYaw: 0,
      bookPitch: 0,
      shelfOffset: this.browse.offset,
      focus: 0,
    };

    this.t = 0;
    this.state = 'leaving';
    this.onStateChange(this.state, this.book);
  }

  #restoreBook() {
    if (!this.book) return;
    this.book.offset.set(0, 0, 0);
    this.book.rotationOffset.set(0, 0, 0);
    this.book.releaseCoverDetail();
  }

  // -------------------------------------------------------------------------

  update(dt) {
    if (this.state === 'entering' || this.state === 'leaving') {
      this.t = Math.min(1, this.t + dt / this.duration);
      const k = easeInOutCubic(this.t);
      this.#applyTween(k);

      if (this.t >= 1) {
        if (this.state === 'entering') {
          this.state = 'inspect';
          this.controls.target.copy(this.to.lookAt);
          this.controls.minDistance = this.book.dims.height * INSPECT.minDistanceFactor;
          this.controls.maxDistance = this.book.dims.height * INSPECT.maxDistanceFactor;
          this.controls.enabled = true;
          this.controls.update();
        } else {
          this.#restoreBook();
          this.book = null;
          this.state = 'browse';
          this.browse.setEnabled(true);
        }
        this.onStateChange(this.state, this.book);
      }
      return;
    }

    if (this.state === 'inspect') {
      this.#clampTarget();
      this.controls.update();
    }
  }

  #applyTween(k) {
    const { from, to } = this;

    this.camera.position.lerpVectors(from.cameraPosition, to.cameraPosition, k);
    this.lookTarget.lerpVectors(from.lookAt, to.lookAt, k);
    this.camera.lookAt(this.lookTarget);

    this.book.offset.lerpVectors(from.bookOffset, to.bookOffset, k);
    this.book.rotationOffset.y = THREE.MathUtils.lerp(from.bookYaw, to.bookYaw, k);
    this.book.rotationOffset.x = THREE.MathUtils.lerp(from.bookPitch, to.bookPitch, k);

    // The shelf keeps gliding under the volume that is being drawn out.
    const shelfOffset = THREE.MathUtils.lerp(from.shelfOffset, to.shelfOffset, k);
    this.browse.offset = shelfOffset;
    this.browse.targetOffset = shelfOffset;

    this.room.applyFocus(THREE.MathUtils.lerp(from.focus, to.focus, k));
  }

  /** Keeps panning from carrying the volume out of the frame. */
  #clampTarget() {
    const limit = this.book.dims.height * INSPECT.panLimitFactor;
    const target = this.controls.target;
    const dx = target.x - this.anchor.x;
    const dy = target.y - this.anchor.y;
    const dz = target.z - this.anchor.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > limit) {
      const scale = limit / distance;
      target.set(
        this.anchor.x + dx * scale,
        this.anchor.y + dy * scale,
        this.anchor.z + dz * scale
      );
    }
  }

  /** Called after a resize so the orbit rig keeps its relationship to the page. */
  handleResize() {
    if (this.state === 'inspect') this.controls.update();
  }

  dispose() {
    this.controls.dispose();
  }
}
