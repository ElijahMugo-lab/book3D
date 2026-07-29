// The editorial layer over the canvas.
//
// It owns no state of its own beyond what is on screen: main.js tells it which
// volume is centred and which mode the experience is in, and it renders that.

import { COLLECTIONS } from '../catalog.js';
import { FORMATS } from '../config.js';

export class Overlay {
  constructor({ catalog, onStep, onGoTo, onOpen, onClose }) {
    this.catalog = catalog;
    this.body = document.body;

    const pick = (role) => document.querySelector(`[data-role="${role}"]`);
    this.el = {
      collection: pick('collection'),
      era: pick('era'),
      title: pick('title'),
      attribution: pick('attribution'),
      note: pick('note'),
      format: pick('format'),
      clothName: pick('cloth-name'),
      rail: pick('rail'),
      prev: pick('prev'),
      next: pick('next'),
      open: pick('open'),
      close: pick('close'),
      statusLabel: pick('status-label'),
      statusFill: pick('status-fill'),
      live: pick('live'),
    };

    this.el.prev.addEventListener('click', () => onStep(-1));
    this.el.next.addEventListener('click', () => onStep(1));
    this.el.open.addEventListener('click', () => onOpen());
    this.el.close.addEventListener('click', () => onClose());

    this.ticks = catalog.map((volume, index) => {
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'rail__tick';
      tick.setAttribute('aria-label', `Go to ${volume.title}`);
      tick.setAttribute('aria-current', 'false');
      tick.addEventListener('click', () => onGoTo(index));
      this.el.rail.append(tick);
      return tick;
    });

    this.currentIndex = -1;
  }

  setVolume(index) {
    if (index === this.currentIndex) return;
    const volume = this.catalog[index];
    if (!volume) return;

    this.currentIndex = index;
    this.el.collection.textContent = COLLECTIONS[volume.collection] ?? '';
    this.el.era.textContent = volume.era;
    this.el.title.textContent = volume.title;
    this.el.attribution.textContent = volume.attribution;
    this.el.note.textContent = volume.note;
    this.el.format.textContent = FORMATS[volume.format]?.label ?? '';
    this.el.clothName.textContent = volume.clothName;

    this.ticks.forEach((tick, i) => {
      tick.setAttribute('aria-current', i === index ? 'true' : 'false');
    });

    this.announce(`${volume.title}, ${volume.attribution}. Volume ${index + 1} of ${this.catalog.length}.`);
  }

  /** browse, transition, or inspect. Drives which controls are offered. */
  setMode(mode) {
    this.body.classList.remove('mode-browse', 'mode-transition', 'mode-inspect');
    this.body.classList.add(`mode-${mode}`);
    const busy = mode !== 'browse';
    this.el.prev.disabled = busy;
    this.el.next.disabled = busy;
    this.ticks.forEach((tick) => {
      tick.disabled = busy;
    });
  }

  setProgress(done, total, label) {
    this.el.statusFill.style.width = `${Math.round((done / total) * 100)}%`;
    if (label) this.el.statusLabel.textContent = label;
  }

  setReady() {
    this.body.classList.remove('is-loading');
    this.el.statusFill.style.width = '100%';
  }

  setError(message) {
    this.body.classList.remove('is-loading');
    this.body.classList.add('has-error');
    this.el.statusLabel.textContent = message;
  }

  announce(message) {
    this.el.live.textContent = message;
  }
}
