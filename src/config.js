// Shared tokens and tunables. Anything the scene and the interface both need to
// agree on lives here so the CSS and the WebGL layer cannot drift apart.

// Physical units are metres. A trade octavo is roughly 215mm tall, which keeps
// every number below in a range that reads sensibly against real bookbinding.

export const FORMATS = {
  pocket: { height: 0.166, width: 0.109, thickness: 0.025, label: 'Pocket' },
  octavo: { height: 0.214, width: 0.140, thickness: 0.035, label: 'Octavo' },
  quarto: { height: 0.256, width: 0.181, thickness: 0.046, label: 'Quarto' },
  folio: { height: 0.311, width: 0.216, thickness: 0.059, label: 'Folio' },
};

export const BINDING = {
  // Board thickness, and how far the boards overhang the text block at the
  // head, tail and fore edge. Real hardcovers overhang by about 3mm.
  boardThickness: 0.0026,
  boardOverhang: 0.0034,
  // The spine is a half cylinder, so its radius is half the book thickness.
  // A slight hinge inset keeps the boards from intersecting that curve.
  hingeInset: 0.0016,
  headbandHeight: 0.0042,
};

export const SHELF = {
  gap: 0.0035, // air between neighbouring volumes
  openingHeight: 0.352, // clear height from the deck to the underside of the top plank
  deckThickness: 0.022,
  backPanelThickness: 0.016,
  depth: 0.244, // front to back of the casework
  dividerEvery: 5, // a walnut divider after every N volumes
  dividerThickness: 0.014,
};

export const CAMERA = {
  fov: 30,
  near: 0.01,
  far: 24,
  // How many volumes should sit across the frame. Narrow viewports show fewer
  // so the spines stay legible instead of shrinking to slivers.
  volumesInFrame: { wide: 8.5, medium: 5.5, narrow: 3.4 },
  browseHeightFraction: 0.52, // look at this fraction of the shelf opening
  browseTilt: 0.045, // radians of downward tilt, keeps the deck visible
};

export const INSPECT = {
  // Where the selected volume travels to when it leaves the shelf.
  lift: 0.055,
  forward: 0.3,
  yaw: -0.96, // radians, roughly 55 degrees: front board plus spine in one view
  pitch: 0.1,
  // Orbit limits, expressed as multiples of the volume's own height so large
  // and small formats frame identically.
  minDistanceFactor: 0.95,
  maxDistanceFactor: 3.1,
  minPolarAngle: 0.28,
  maxPolarAngle: Math.PI * 0.84,
  panLimitFactor: 0.55, // how far the orbit target may be dragged from the book
};

export const MOTION = {
  transitionSeconds: 0.92,
  glideLambda: 7.5, // exponential damping rate for the shelf glide
  flickProjectionSeconds: 0.34, // how far a released flick is allowed to carry
  maxFlickVolumes: 7,
  wheelIdleMs: 170,
  dragTapThresholdPx: 6,
};

export const TEXTURE = {
  clothSize: 512,
  pageSize: 512,
  woodSize: 768,
  spineWidth: 256,
  spineHeight: 768,
  coverSize: 1024,
  coverCacheLimit: 4,
};

// One accent, locked across the whole experience. The gold is the foil that is
// physically stamped into the covers, so the interface borrows a real material
// rather than introducing a second unrelated brand colour.
export const FOIL = {
  color: '#b08d5c',
  roughness: 0.29,
  metalness: 1.0,
};

export const WOOD = {
  base: '#6b4726',
  grainDark: '#3f2810',
  grainLight: '#8a6039',
};

// Scene tokens per theme. The dark variant is an evening reading room: the same
// walnut and cloth, lit low, rather than an inverted colour scheme.
export const THEME = {
  light: {
    background: '#e6dfd1',
    backdrop: '#d9d0bd',
    floor: '#c7bca5',
    hemiSky: '#fdf7ea',
    hemiGround: '#7d6a4e',
    hemiIntensity: 1.05,
    keyColor: '#fff3dd',
    keyIntensity: 2.6,
    fillColor: '#e4ddcd',
    fillIntensity: 0.72,
    rimColor: '#fff1d6',
    rimIntensity: 0.9,
    envIntensity: 0.5,
    exposure: 1.0,
    // Multipliers applied to the lighting once a volume is under inspection,
    // so the surrounding shelf recedes and the subject holds the frame.
    inspectDim: 0.46,
  },
  dark: {
    background: '#191510',
    backdrop: '#221c15',
    floor: '#15110c',
    hemiSky: '#3a3125',
    hemiGround: '#0f0c08',
    hemiIntensity: 0.5,
    keyColor: '#ffdfa8',
    keyIntensity: 2.05,
    fillColor: '#4a4133',
    fillIntensity: 0.4,
    rimColor: '#ffe6bb',
    rimIntensity: 0.72,
    envIntensity: 0.24,
    exposure: 0.98,
    inspectDim: 0.58,
  },
};
