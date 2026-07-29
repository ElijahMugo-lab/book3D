// The single seam between minted assets and the bundled procedural pack.
//
// Everything downstream asks this module for textures and never knows which
// source answered. Adding Mint output later means writing files into
// assets/mint/, filling in the src fields of assets/manifest.json, and nothing
// else. Browser code never talks to Mint MCP; the manifest is the only contract.

import * as THREE from 'three';
import { CATALOG, findIndexById } from '../catalog.js';
import { FORMATS, TEXTURE } from '../config.js';
import {
  createCoverTextures,
  createSpineTextures,
  getClothTextures,
  getPageTexture,
  getWoodTextures,
} from './procedural.js';
import { assertRuntimeSupport, createGLTFLoader } from './gltf-runtime.js';

const MANIFEST_URL = new URL('../../assets/manifest.json', import.meta.url);

function resolveAssetUrl(pack, src) {
  if (!src) return null;
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return src;
  const root = pack.assetRoot ? `${pack.assetRoot.replace(/\/$/, '')}/` : '';
  // Manifest paths are project relative, so resolve them against the page.
  return new URL(`../../${root}${src}`, import.meta.url).href;
}

function loadTexture(textureLoader, url, { srgb, anisotropy }) {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      () => reject(new Error(`Could not load texture: ${url}`))
    );
  });
}

export async function loadManifest() {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`Could not read the asset manifest (${response.status}).`);
  }
  return response.json();
}

/**
 * Builds every texture the scene needs.
 *
 * @param {object} options
 * @param {number} options.anisotropy renderer.capabilities.getMaxAnisotropy()
 * @param {(done:number,total:number,label:string)=>void} [options.onProgress]
 */
export async function loadCoverPack({ anisotropy = 1, onProgress } = {}) {
  const manifest = await loadManifest();
  const textureLoader = new THREE.TextureLoader();
  const pack = manifest.pack ?? {};

  const total = 3 + manifest.items.length;
  let done = 0;

  // Texture generation is synchronous canvas work. Handing a frame back between
  // steps lets the progress indicator actually paint instead of jumping from
  // empty to full when the main thread finally frees up.
  const yieldToPaint = () =>
    new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });

  const step = async (label) => {
    done += 1;
    if (onProgress) onProgress(done, total, label);
    await yieldToPaint();
  };

  // Type has to be ready before any canvas draws text, or the foil stamping
  // falls back to a system serif with different metrics.
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.load('600 72px "EB Garamond"');
      await document.fonts.ready;
    } catch {
      // A missing webfont is not fatal: the canvas falls back to Georgia.
    }
  }

  // --- shared surfaces -----------------------------------------------------
  const sharedSpec = manifest.shared ?? {};

  async function resolvePair(entry, procedural, { srgb = true } = {}) {
    if (entry?.src) {
      const map = await loadTexture(textureLoader, resolveAssetUrl(pack, entry.src), {
        srgb,
        anisotropy,
      });
      const normalMap = entry.normalSrc
        ? await loadTexture(textureLoader, resolveAssetUrl(pack, entry.normalSrc), {
            srgb: false,
            anisotropy,
          })
        : null;
      return { map, normalMap, source: 'mint' };
    }
    return { ...procedural(), source: 'procedural' };
  }

  const cloth = await resolvePair(sharedSpec.cloth, () => getClothTextures(anisotropy));
  await step('Weaving bookcloth');

  let page;
  if (sharedSpec.page?.src) {
    page = {
      map: await loadTexture(textureLoader, resolveAssetUrl(pack, sharedSpec.page.src), {
        srgb: true,
        anisotropy,
      }),
      source: 'mint',
    };
  } else {
    page = { map: getPageTexture(anisotropy), source: 'procedural' };
  }
  await step('Cutting page edges');

  const wood = await resolvePair(sharedSpec.wood, () => getWoodTextures(anisotropy));
  await step('Milling walnut');

  // --- per volume ----------------------------------------------------------
  const items = new Map();

  for (const entry of manifest.items) {
    const index = findIndexById(entry.id);
    if (index < 0) {
      throw new Error(`Manifest lists "${entry.id}", which is not in the catalog.`);
    }
    const volume = CATALOG[index];
    const dims = FORMATS[volume.format];

    let spine;
    if (entry.spine?.src) {
      spine = {
        map: await loadTexture(textureLoader, resolveAssetUrl(pack, entry.spine.src), {
          srgb: true,
          anisotropy,
        }),
        ormMap: entry.spine.ormSrc
          ? await loadTexture(textureLoader, resolveAssetUrl(pack, entry.spine.ormSrc), {
              srgb: false,
              anisotropy,
            })
          : null,
        source: 'mint',
      };
    } else {
      spine = { ...createSpineTextures(volume, dims, anisotropy), source: 'procedural' };
    }

    // The board stops where the spine curve begins, so the art is generated at
    // the board's own aspect and never stretched onto the plate.
    const boardWidth = dims.width - dims.thickness / 2;

    // Covers are only legible under inspection, so they are built on demand at
    // full resolution rather than paid for on every volume at load.
    const coverEntry = entry.cover ?? {};
    const makeCover = async (size) => {
      if (coverEntry.src) {
        return {
          map: await loadTexture(textureLoader, resolveAssetUrl(pack, coverEntry.src), {
            srgb: true,
            anisotropy,
          }),
          ormMap: coverEntry.ormSrc
            ? await loadTexture(textureLoader, resolveAssetUrl(pack, coverEntry.ormSrc), {
                srgb: false,
                anisotropy,
              })
            : null,
          source: 'mint',
        };
      }
      return {
        ...createCoverTextures(volume, dims, boardWidth, size, anisotropy),
        source: 'procedural',
      };
    };

    // A minted GLB would replace the generated hardcover geometry here.
    let model = null;
    if (entry.model?.src) {
      assertRuntimeSupport(entry.model);
      const gltf = await createGLTFLoader().loadAsync(resolveAssetUrl(pack, entry.model.src));
      model = gltf.scene;
    }

    items.set(volume.id, { volume, dims, spine, makeCover, model, index });
    await step(volume.title);
  }

  return {
    pack,
    source: pack.source ?? 'procedural',
    shared: { cloth, page, wood },
    items,
    coverPreviewSize: Math.round(TEXTURE.coverSize / 3),
    coverDetailSize: TEXTURE.coverSize,
  };
}
