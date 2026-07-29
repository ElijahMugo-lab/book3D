# The Complete Shelf

A continuous 3D shelf of nineteen clothbound hardcovers: ten works of classical
literature and nine books of the Bible. Browse the shelf laterally, then pull a
volume forward and inspect it with orbit, pan, and zoom.

Vanilla Three.js, ES modules, no build step.

## Run it

```bash
npm start        # serves the folder at http://localhost:5173
npm run check    # parses every module, resolves imports and assets, checks the manifest
```

Any static server works. Opening `index.html` from the filesystem does not,
because ES modules and `fetch` need an HTTP origin.

## Deploy

Static, no build step. On Netlify, connect the repository and accept
`netlify.toml`: publish directory `.`, no build command. Or drag the folder onto
the Netlify dashboard, or run `npx netlify-cli deploy --prod --dir .`.

Nothing is fetched from a third party at runtime. Three.js r185 is vendored
under `vendor/three`, the typeface is self hosted, and the covers are generated
in the browser, so the deployed site has no external dependency to go down.

To move to a different Three.js release, download the same file set from
`https://unpkg.com/three@<version>/` into `vendor/three` (keeping the directory
shape), then run `npm run check`, which fails if a vendored module needs a file
that was not brought across:

```text
build/three.module.js
build/three.core.js
examples/jsm/controls/OrbitControls.js
examples/jsm/environments/RoomEnvironment.js
examples/jsm/loaders/GLTFLoader.js
examples/jsm/loaders/DRACOLoader.js
examples/jsm/utils/BufferGeometryUtils.js
examples/jsm/utils/SkeletonUtils.js
```

## Controls

| Input | Effect |
| --- | --- |
| Drag | Move the shelf. Release flicks with momentum and lands on a volume |
| Wheel or trackpad | Move the shelf, snapping when the gesture stops |
| Left and right arrows | Step one volume |
| Home and End | Jump to the first or last volume |
| Previous and next buttons | Step one volume |
| Marker rail | Jump straight to any of the nineteen |
| Click a volume, Enter, or the open button | Pull it forward for inspection |
| Left drag, right drag, wheel | Orbit, pan, zoom while inspecting |
| Escape or the return button | Go back to the shelf |

The shelf is an infinite ring. Volumes are laid out once into a ring of total
width W and placed each frame at `wrap(baseX - offset)`, so there is no end
stop. The camera rig refuses to pull back to the point where the wrap would be
visible, except beyond roughly 2.5:1 aspect, where keeping the tallest volume
uncropped wins and the far edges of the frame show bare shelf.

## Layout

```text
index.html                  shell, import map, interface markup
styles.css                  design tokens, panels, responsive and reduced motion
assets/manifest.json        the asset contract
assets/mint/                minted files land here
assets/fonts/               EB Garamond, self hosted
assets/icons/               Phosphor icon sources
vendor/three/               Three.js r185, vendored
netlify.toml                static hosting config
src/config.js               dimensions, framing, motion, and theme tokens
src/catalog.js              the nineteen volumes
src/assets/procedural.js    bookcloth, page edges, walnut, and the foil motifs
src/assets/loader.js        resolves manifest entries to Mint files or generators
src/assets/gltf-runtime.js  shared Draco capable glTF loader
src/scene/book.js           the hardcover mesh
src/scene/shelf.js          casework and the infinite ring
src/scene/room.js           lighting, backdrop, and the camera framing rule
src/interaction/browse.js   all five browsing inputs
src/interaction/inspect.js  the pull forward transition and orbit rig
src/ui/overlay.js           interface binding
src/main.js                 renderer, resize, frame loop
scripts/check.mjs           the project gate
```

## The asset seam

`assets/manifest.json` is the only contract between the scene and its assets.
Each channel has a `src` and a `fallback`:

```json
{
  "id": "iliad",
  "spine": { "src": null, "ormSrc": null, "fallback": "procedural:spine#iliad" },
  "cover": { "src": null, "ormSrc": null, "fallback": "procedural:cover#iliad" },
  "model": { "src": null, "fallback": "procedural:hardcover", "extensionsRequired": [] }
}
```

`src/assets/loader.js` loads the file when `src` is set and calls the named
generator when it is not. Nothing downstream knows which answered.

### Bringing in Mint assets

Mint MCP is not connected in this project yet. `https://mcp.mint.gg/mcp` needs
an OAuth sign in, which has to happen in an interactive session:

```bash
claude mcp add --transport http mint https://mcp.mint.gg/mcp
# then authorize it with /mcp
```

Once it is authorized, generating the pack is:

1. Generate the nineteen piece asset pack through Mint MCP in auto mode.
2. Save each artifact manifest and sync it into the project registry:

   ```bash
   node ~/.claude/skills/mint-threejs-skills/scripts/sync-mint-assets.mjs \
     --project . --manifest /tmp/iliad.json --key iliad --asset-root assets/mint
   ```

3. Copy the recorded `localPath` values into the matching `src` fields in
   `assets/manifest.json` and set `pack.source` to `"mint"`.
4. Run `npm run check`. It fails if a `src` points at a file that is not there.

No scene code changes. Browser code never calls Mint MCP; generation happens at
authoring time and the manifest is the handoff.

Minted GLBs use `KHR_draco_mesh_compression`. Every loader path goes through
`createGLTFLoader()` in `src/assets/gltf-runtime.js`, which attaches one shared
Draco decoder. A bare `GLTFLoader` cannot read them.

## Assets

Covers, cloth, page edges, and walnut are generated into canvases at load. One
weave tile stands for a fixed span of real bookcloth, and the spine and cover
art are drawn per volume at true scale, so the thread pitch matches on a pocket
and a folio. Foil is a packed material map: green carries roughness, blue
carries metalness, so the stamped marks are genuine metal in the same material
as the cloth around them.

Spine art is built for all nineteen at load. Cover boards are built at preview
resolution at load and regenerated at full resolution for the one volume under
inspection, then released.

## Design notes

EB Garamond throughout, self hosted. Garamond descends from the humanist romans
used for printed editions of the classics and for early printed scripture, which
is the reason for a serif here rather than a general preference for one.

One accent: the antique gold of the foil. The interface borrows the material
rather than introducing an unrelated brand colour, and uses it only for state
(the current marker, focus, the primary action).

Dark mode is an evening reading room rather than an inverted palette: the same
walnut and cloth, lit low, with the interface panels following.
`prefers-reduced-motion` removes momentum and cuts the transitions to their end
states.
