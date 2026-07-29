// Procedural cover pack. Every texture the shelf needs is drawn here into a
// canvas, so the experience is complete with no network assets. The Mint
// manifest in assets/manifest.json addresses these generators by name, which
// means a minted file can replace any one of them without touching the scene.

import * as THREE from 'three';
import { FOIL, TEXTURE, WOOD } from '../config.js';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise. The lattice wraps, so every texture built on it can be
// repeated across a plank or a cover without a visible seam.
function makeNoise(seed, size = 64) {
  const rand = mulberry32(seed);
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();

  return function sample(x, y) {
    const fx = x * size;
    const fy = y * size;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const x0 = ((ix % size) + size) % size;
    const y0 = ((iy % size) + size) % size;
    const x1 = (x0 + 1) % size;
    const y1 = (y0 + 1) % size;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = grid[y0 * size + x0];
    const b = grid[y0 * size + x1];
    const c = grid[y1 * size + x0];
    const d = grid[y1 * size + x1];
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
  };
}

function makeFbm(seed, octaves = 4) {
  const layers = [];
  for (let i = 0; i < octaves; i += 1) layers.push(makeNoise(seed + i * 977, 64));
  return function fbm(x, y) {
    let sum = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < layers.length; i += 1) {
      sum += layers[i](x * frequency, y * frequency) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / norm;
  };
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function toTexture(canvas, { srgb = true, repeat = null, anisotropy = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (repeat) texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function heightToNormal(height, size, strength) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len) * 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Shared surfaces: bookcloth, page edges, walnut
// ---------------------------------------------------------------------------

const shared = {
  weaveCanvas: null,
  weaveField: null,
  clothMap: null,
  clothNormal: null,
  pageMap: null,
  woodMap: null,
  woodNormal: null,
};

// A plain weave: alternating cells show the warp thread or the weft thread, so
// the surface catches light in two directions the way real bookcloth does.
function weaveHeightField(size, threads) {
  const field = new Float32Array(size * size);
  const fiber = makeFbm(0x51c10, 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const cellX = Math.floor(u * threads);
      const cellY = Math.floor(v * threads);
      const fu = u * threads - cellX;
      const fv = v * threads - cellY;
      const warpOver = (cellX + cellY) % 2 === 0;
      const bump = warpOver ? Math.sin(Math.PI * fu) : Math.sin(Math.PI * fv);
      const shaped = Math.pow(Math.max(bump, 0), 0.75);
      field[y * size + x] = shaped * 0.86 + fiber(u * 7, v * 7) * 0.14;
    }
  }
  return field;
}

// The weave canvas doubles as the fill pattern for every spine and cover, so it
// is built on first use rather than depending on call order elsewhere.
function ensureWeave() {
  if (shared.weaveCanvas) return shared.weaveField;
  const size = TEXTURE.clothSize;
  const field = weaveHeightField(size, 46);

  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i += 1) {
    // Kept bright: this map only modulates the cloth colour, it does not
    // carry the colour itself.
    const value = Math.round((0.7 + field[i] * 0.3) * 255);
    const p = i * 4;
    image.data[p] = value;
    image.data[p + 1] = value;
    image.data[p + 2] = value;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  shared.weaveCanvas = canvas;
  shared.weaveField = field;
  return field;
}

export function getClothTextures(anisotropy = 1) {
  if (!shared.clothMap) {
    const field = ensureWeave();
    shared.clothMap = toTexture(shared.weaveCanvas, { anisotropy });
    shared.clothNormal = toTexture(heightToNormal(field, TEXTURE.clothSize, 3.4), {
      srgb: false,
      anisotropy,
    });
  }
  return { map: shared.clothMap, normalMap: shared.clothNormal };
}

export function getPageTexture(anisotropy = 1) {
  if (!shared.pageMap) {
    const size = TEXTURE.pageSize;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const leaves = 232;
    const jitter = makeNoise(0x9a17, 128);
    const grime = makeFbm(0x2f81, 3);

    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const cell = u * leaves;
      const within = cell - Math.floor(cell);
      // Each leaf is a thin bright face with a darker crease where it meets
      // the next one.
      const crease = Math.pow(Math.sin(Math.PI * within), 0.35);
      const variation = jitter(Math.floor(cell) / leaves, 0.5) * 0.12;
      for (let y = 0; y < size; y += 1) {
        const v = y / size;
        const soil = grime(u * 3, v * 3) * 0.09;
        const tone = 0.66 + crease * 0.28 + variation - soil;
        const p = (y * size + x) * 4;
        image.data[p] = Math.round(Math.min(1, tone * 1.02) * 236);
        image.data[p + 1] = Math.round(Math.min(1, tone * 0.99) * 226);
        image.data[p + 2] = Math.round(Math.min(1, tone * 0.93) * 205);
        image.data[p + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    shared.pageMap = toTexture(canvas, { anisotropy });
  }
  return shared.pageMap;
}

export function getWoodTextures(anisotropy = 1) {
  if (!shared.woodMap) {
    const size = TEXTURE.woodSize;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    const wander = makeFbm(0x77a3, 4);
    const fleck = makeFbm(0x1d55, 3);
    const base = new THREE.Color(WOOD.base);
    const dark = new THREE.Color(WOOD.grainDark);
    const light = new THREE.Color(WOOD.grainLight);
    const mixed = new THREE.Color();
    const rings = 11; // integer keeps the grain tileable along the plank

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size;
        const v = y / size;
        // Grain runs along the plank, so the rings vary with v and wobble with u.
        const wobble = (wander(u * 2, v * 5) - 0.5) * 2.1;
        const ring = Math.sin((v * rings + wobble) * Math.PI * 2) * 0.5 + 0.5;
        const grain = Math.pow(ring, 1.7);
        mixed.copy(dark).lerp(base, grain);
        const streak = fbmClamp(fleck(u * 16, v * 44));
        mixed.lerp(light, streak * 0.2);

        const i = y * size + x;
        height[i] = grain * 0.7 + streak * 0.3;
        const p = i * 4;
        image.data[p] = Math.round(mixed.r * 255);
        image.data[p + 1] = Math.round(mixed.g * 255);
        image.data[p + 2] = Math.round(mixed.b * 255);
        image.data[p + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    shared.woodMap = toTexture(canvas, { anisotropy });
    shared.woodNormal = toTexture(heightToNormal(height, size, 1.5), {
      srgb: false,
      anisotropy,
    });
  }
  return { map: shared.woodMap, normalMap: shared.woodNormal };
}

function fbmClamp(value) {
  return Math.max(0, Math.min(1, (value - 0.42) * 2.6));
}

// ---------------------------------------------------------------------------
// Foil motifs
// ---------------------------------------------------------------------------

// Every motif is abstract geometry drawn inside the box it is handed. They read
// as blind and foil tooling rather than illustration.
const MOTIFS = {
  'rule-stack'(ctx, box) {
    const { x, y, w, h } = box;
    const weights = [0.09, 0.03, 0.16, 0.03, 0.09];
    const insets = [0, 0.12, 0.05, 0.12, 0];
    let cursor = y;
    const unit = h / 1.9;
    weights.forEach((weight, i) => {
      const thickness = Math.max(1, unit * weight);
      const inset = w * insets[i];
      ctx.fillRect(x + inset, cursor, w - inset * 2, thickness);
      cursor += thickness + unit * 0.17;
    });
  },

  arch(ctx, box) {
    const { x, y, w, h } = box;
    const line = Math.max(1, w * 0.035);
    const radius = w * 0.34;
    const cx = x + w / 2;
    const springLine = y + h * 0.66;
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.moveTo(cx - radius, y + h * 0.94);
    ctx.lineTo(cx - radius, springLine);
    ctx.arc(cx, springLine, radius, Math.PI, 0);
    ctx.lineTo(cx + radius, y + h * 0.94);
    ctx.stroke();
    // Keystone
    const keyW = w * 0.13;
    const keyH = h * 0.14;
    ctx.fillRect(cx - keyW / 2, springLine - radius - keyH * 0.45, keyW, keyH);
  },

  rosette(ctx, box) {
    const { x, y, w, h } = box;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const outer = Math.min(w, h) * 0.44;
    const line = Math.max(1, w * 0.03);
    ctx.lineWidth = line;
    [outer, outer * 0.62].forEach((r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    const spokes = 12;
    for (let i = 0; i < spokes; i += 1) {
      const angle = (i / spokes) * Math.PI * 2;
      const inner = outer * 0.72;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer * 0.94, cy + Math.sin(angle) * outer * 0.94);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, outer * 0.2, 0, Math.PI * 2);
    ctx.fill();
  },

  laurel(ctx, box) {
    const { x, y, w, h } = box;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const line = Math.max(1, w * 0.028);
    ctx.lineWidth = line;
    const radius = Math.min(w, h) * 0.46;
    const span = Math.PI * 0.4;
    // Two mirrored arcs: one opening right, one opening left.
    [0, Math.PI].forEach((base) => {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, base - span, base + span);
      ctx.stroke();
      for (let i = 1; i < 7; i += 1) {
        const angle = base - span + (span * 2 * i) / 7;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.lineTo(cx + Math.cos(angle) * radius * 1.2, cy + Math.sin(angle) * radius * 1.2);
        ctx.stroke();
      }
    });
  },

  meander(ctx, box) {
    const { x, y, w, h } = box;
    const line = Math.max(1, w * 0.045);
    const bandH = h * 0.46;
    const top = y + (h - bandH) / 2;
    const units = 3;
    const unitW = w / units;
    ctx.lineWidth = line;
    ctx.lineJoin = 'miter';
    for (let i = 0; i < units; i += 1) {
      const ox = x + i * unitW;
      ctx.beginPath();
      ctx.moveTo(ox, top + bandH);
      ctx.lineTo(ox, top);
      ctx.lineTo(ox + unitW * 0.72, top);
      ctx.lineTo(ox + unitW * 0.72, top + bandH * 0.68);
      ctx.lineTo(ox + unitW * 0.3, top + bandH * 0.68);
      ctx.lineTo(ox + unitW * 0.3, top + bandH * 0.34);
      ctx.stroke();
    }
  },

  grid(ctx, box) {
    const { x, y, w, h } = box;
    const cols = 4;
    const rows = 3;
    const line = Math.max(1, w * 0.022);
    ctx.lineWidth = line;
    const cellW = w / cols;
    const cellH = h / rows;
    const pad = Math.min(cellW, cellH) * 0.22;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const filled = (r + c) % 3 === 0;
        const bx = x + c * cellW + pad;
        const by = y + r * cellH + pad;
        const bw = cellW - pad * 2;
        const bh = cellH - pad * 2;
        if (filled) ctx.fillRect(bx, by, bw, bh);
        else ctx.strokeRect(bx, by, bw, bh);
      }
    }
  },

  starfield(ctx, box) {
    const { x, y, w, h, rand } = box;
    const count = 11;
    for (let i = 0; i < count; i += 1) {
      const px = x + (0.12 + rand() * 0.76) * w;
      const py = y + (0.12 + rand() * 0.76) * h;
      const size = w * (0.035 + rand() * 0.045);
      ctx.beginPath();
      ctx.moveTo(px, py - size);
      ctx.lineTo(px + size * 0.42, py);
      ctx.lineTo(px, py + size);
      ctx.lineTo(px - size * 0.42, py);
      ctx.closePath();
      ctx.fill();
    }
  },

  wave(ctx, box) {
    const { x, y, w, h } = box;
    const line = Math.max(1, w * 0.028);
    ctx.lineWidth = line;
    const rows = 4;
    for (let r = 0; r < rows; r += 1) {
      const baseY = y + h * (0.22 + (r / (rows - 1)) * 0.56);
      const amp = h * 0.09 * (1 - r * 0.14);
      ctx.beginPath();
      for (let i = 0; i <= 48; i += 1) {
        const t = i / 48;
        const px = x + t * w;
        const py = baseY + Math.sin(t * Math.PI * 2 + r * 0.6) * amp;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  },

  keystone(ctx, box) {
    const { x, y, w, h } = box;
    const cx = x + w / 2;
    const topW = w * 0.26;
    const bottomW = w * 0.44;
    const top = y + h * 0.24;
    const bottom = y + h * 0.78;
    ctx.beginPath();
    ctx.moveTo(cx - topW / 2, top);
    ctx.lineTo(cx + topW / 2, top);
    ctx.lineTo(cx + bottomW / 2, bottom);
    ctx.lineTo(cx - bottomW / 2, bottom);
    ctx.closePath();
    ctx.fill();
    const line = Math.max(1, h * 0.028);
    ctx.fillRect(x, y + h * 0.1, w, line);
    ctx.fillRect(x, y + h * 0.9, w, line);
  },

  column(ctx, box) {
    const { x, y, w, h } = box;
    const flutes = 5;
    const line = Math.max(1, w * 0.028);
    const capH = Math.max(1, h * 0.05);
    ctx.fillRect(x + w * 0.08, y + h * 0.12, w * 0.84, capH);
    ctx.fillRect(x + w * 0.08, y + h * 0.83, w * 0.84, capH);
    const span = w * 0.66;
    const left = x + (w - span) / 2;
    for (let i = 0; i < flutes; i += 1) {
      const px = left + (span / (flutes - 1)) * i;
      ctx.fillRect(px - line / 2, y + h * 0.24, line, h * 0.55);
    }
  },
};

export const MOTIF_NAMES = Object.keys(MOTIFS);

// ---------------------------------------------------------------------------
// Type setting on canvas
// ---------------------------------------------------------------------------

const SERIF = '"EB Garamond", Georgia, "Times New Roman", serif';

function setFont(ctx, size, weight = 500, tracking = 0) {
  ctx.font = `${weight} ${size}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking}px`;
}

function fitFont(ctx, text, maxWidth, startSize, minSize, weight, tracking) {
  let size = startSize;
  setFont(ctx, size, weight, tracking * size);
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= Math.max(1, size * 0.05);
    setFont(ctx, size, weight, tracking * size);
  }
  return size;
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// Spine artwork
// ---------------------------------------------------------------------------

// One weave tile stands for WEAVE_TILE_METRES of real bookcloth. Callers pass
// the canvas resolution in pixels per metre so the thread pitch comes out the
// same on a pocket spine and a folio board.
export const WEAVE_TILE_METRES = 46 * 0.0009;

function paintCloth(ctx, w, h, clothColor, pixelsPerMetre) {
  ensureWeave();
  ctx.fillStyle = clothColor;
  ctx.fillRect(0, 0, w, h);

  const pattern = ctx.createPattern(shared.weaveCanvas, 'repeat');
  if (!pattern) return;

  const tilePixels = WEAVE_TILE_METRES * pixelsPerMetre;
  const scale = tilePixels / TEXTURE.clothSize;
  if (typeof DOMMatrix === 'function' && typeof pattern.setTransform === 'function') {
    pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
  }

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawSpineArt(ctx, volume, w, h, ink) {
  const rand = mulberry32(hashString(`${volume.id}-spine`));
  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  const margin = w * 0.2;
  const innerW = w - margin * 2;
  const hair = Math.max(1, w * 0.008);

  // Head and foot rule pairs frame the panel.
  ctx.fillRect(margin, h * 0.075, innerW, hair * 2.2);
  ctx.fillRect(margin, h * 0.098, innerW, hair);
  ctx.fillRect(margin, h * 0.885, innerW, hair);
  ctx.fillRect(margin, h * 0.9, innerW, hair * 2.2);

  const motif = MOTIFS[volume.motif] || MOTIFS['rule-stack'];
  motif(ctx, { x: margin, y: h * 0.14, w: innerW, h: h * 0.125, rand, ink });

  // Title reads top to bottom, the way it sits when the book is upright.
  const bandTop = h * 0.32;
  const bandLength = h * 0.42;
  ctx.save();
  ctx.translate(w / 2, bandTop);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, volume.title, bandLength * 0.95, w * 0.36, w * 0.15, 600, 0.04);
  ctx.fillText(volume.title, bandLength / 2, 0);
  ctx.restore();

  // Attribution, set smaller and spaced, below the title panel.
  const attribTop = h * 0.78;
  const attribLength = h * 0.09;
  ctx.save();
  ctx.translate(w / 2, attribTop);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = volume.attribution.toUpperCase();
  fitFont(ctx, label, attribLength * 0.95, w * 0.16, w * 0.075, 500, 0.16);
  ctx.fillText(label, attribLength / 2, 0);
  ctx.restore();

  ctx.restore();
}

export function createSpineTextures(volume, dims, anisotropy = 1) {
  const w = TEXTURE.spineWidth;
  const h = TEXTURE.spineHeight;
  // The spine is the +z half of a cylinder, so its surface is half a
  // circumference wide.
  const arcMetres = (Math.PI * dims.thickness) / 2;
  const pixelsPerMetre = w / arcMetres;

  const colorCanvas = makeCanvas(w, h);
  const colorCtx = colorCanvas.getContext('2d');
  paintCloth(colorCtx, w, h, volume.cloth, pixelsPerMetre);
  drawSpineArt(colorCtx, volume, w, h, FOIL.color);

  // Packed material map: green carries roughness, blue carries metalness.
  const ormCanvas = makeCanvas(w, h);
  const ormCtx = ormCanvas.getContext('2d');
  ormCtx.fillStyle = `rgb(255, ${Math.round(0.92 * 255)}, 0)`;
  ormCtx.fillRect(0, 0, w, h);
  drawSpineArt(ormCtx, volume, w, h, `rgb(255, ${Math.round(FOIL.roughness * 255)}, 255)`);

  return {
    map: toTexture(colorCanvas, { anisotropy }),
    ormMap: toTexture(ormCanvas, { srgb: false, anisotropy }),
  };
}

// ---------------------------------------------------------------------------
// Cover artwork
// ---------------------------------------------------------------------------

function drawCoverArt(ctx, volume, w, h, ink) {
  const rand = mulberry32(hashString(`${volume.id}-cover`));
  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;

  const hair = Math.max(1, w * 0.006);
  const inset = w * 0.085;

  // Double rule frame, the standard tooling on a stamped board.
  ctx.lineWidth = hair * 2;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.lineWidth = hair;
  const inner = inset + w * 0.028;
  ctx.strokeRect(inner, inner, w - inner * 2, h - inner * 2);

  const contentX = inner + w * 0.09;
  const contentW = w - (contentX - 0) * 2;

  const motif = MOTIFS[volume.motif] || MOTIFS['rule-stack'];
  motif(ctx, {
    x: contentX + contentW * 0.22,
    y: h * 0.17,
    w: contentW * 0.56,
    h: h * 0.16,
    rand,
    ink,
  });

  // Title, wrapped and centred in the middle panel.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let size = w * 0.13;
  setFont(ctx, size, 600, size * 0.02);
  let lines = wrapLines(ctx, volume.title, contentW);
  while (lines.length > 3 && size > w * 0.07) {
    size *= 0.9;
    setFont(ctx, size, 600, size * 0.02);
    lines = wrapLines(ctx, volume.title, contentW);
  }
  const lineHeight = size * 1.16;
  const blockTop = h * 0.47 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, blockTop + i * lineHeight);
  });

  // Short rule, then the attribution.
  const ruleY = blockTop + (lines.length - 1) * lineHeight + size * 0.72;
  ctx.fillRect(w / 2 - contentW * 0.13, ruleY, contentW * 0.26, hair * 1.6);

  const label = volume.attribution.toUpperCase();
  const attribSize = fitFont(ctx, label, contentW * 0.92, w * 0.055, w * 0.03, 500, 0.16);
  ctx.fillText(label, w / 2, ruleY + attribSize * 2.3);

  ctx.restore();
}

/**
 * @param {number} boardWidth visible width of the board in metres, which is the
 *   volume's width less the part of the depth taken by the spine curve.
 */
export function createCoverTextures(volume, dims, boardWidth, size, anisotropy = 1) {
  const h = size;
  const w = Math.max(2, Math.round(size * (boardWidth / dims.height)));
  const pixelsPerMetre = w / boardWidth;

  const colorCanvas = makeCanvas(w, h);
  const colorCtx = colorCanvas.getContext('2d');
  paintCloth(colorCtx, w, h, volume.cloth, pixelsPerMetre);
  drawCoverArt(colorCtx, volume, w, h, FOIL.color);

  const ormCanvas = makeCanvas(w, h);
  const ormCtx = ormCanvas.getContext('2d');
  ormCtx.fillStyle = `rgb(255, ${Math.round(0.92 * 255)}, 0)`;
  ormCtx.fillRect(0, 0, w, h);
  drawCoverArt(ormCtx, volume, w, h, `rgb(255, ${Math.round(FOIL.roughness * 255)}, 255)`);

  return {
    map: toTexture(colorCanvas, { anisotropy }),
    ormMap: toTexture(ormCanvas, { srgb: false, anisotropy }),
  };
}

export function disposeSharedTextures() {
  Object.keys(shared).forEach((key) => {
    const value = shared[key];
    if (value && typeof value.dispose === 'function') value.dispose();
    shared[key] = null;
  });
}
