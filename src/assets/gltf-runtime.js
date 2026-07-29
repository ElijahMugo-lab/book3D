// Shared, Draco capable glTF loader.
//
// Mint's GLB optimizer emits KHR_draco_mesh_compression, so a bare GLTFLoader
// cannot decode a minted model. Every path that may receive a Mint GLB goes
// through createGLTFLoader() and shares one decoder instance.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Immutable, version pinned. Do not swap this for a mutable "latest" path.
export const MINT_DRACO_PATH = 'https://cdn.mint.gg/runtime/draco/gltf/three-0.184.0/';

let sharedDraco = null;
let decoderPath = MINT_DRACO_PATH;

// Call before the first loader is created to point at a self hosted decoder.
export function setDecoderPath(path) {
  if (sharedDraco) throw new Error('Decoder path must be set before the first loader is created.');
  decoderPath = path;
}

function getDracoLoader() {
  if (!sharedDraco) {
    sharedDraco = new DRACOLoader();
    sharedDraco.setDecoderPath(decoderPath);
    // The decoder itself is only fetched when a Draco primitive is met.
    sharedDraco.setDecoderConfig({ type: 'js' });
  }
  return sharedDraco;
}

export function createGLTFLoader() {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  return loader;
}

// Reports required extensions this runtime cannot honour, so an unsupported
// file fails with something actionable instead of rendering nothing.
const SUPPORTED_REQUIRED = new Set(['KHR_draco_mesh_compression']);

export function assertRuntimeSupport(artifact) {
  const required = artifact?.extensionsRequired ?? [];
  const missing = required.filter((name) => !SUPPORTED_REQUIRED.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${artifact.filename ?? 'model'} requires glTF extensions this runtime does not configure: ${missing.join(', ')}. ` +
        'Add the matching decoder (setMeshoptDecoder or setKTX2Loader) before loading it.'
    );
  }
}

// Only during permanent teardown. Disposing between loads would force the
// decoder to be downloaded again.
export function disposeGLTFRuntime() {
  if (sharedDraco) {
    sharedDraco.dispose();
    sharedDraco = null;
  }
}
