# LightBox Previs

A from-scratch 3D lighting visualiser built on open standards:

- **MVR** import (DIN SPEC 15800) — fixtures, placement, patch, trusses, with the **GDTF** profiles shipped inside the file
- **GDTF** parsing — DMX modes, 8/16-bit channels, pan/tilt/zoom ranges, shutter/strobe, RGB / CMY / colour-wheel colour
- **sACN (E1.31)** input — multicast, priority + HTP merge, any number of universes
- Three.js scene with volumetric-style beams, moving-head models, spot lighting onto the floor

Original code, MIT licensed. No third-party visualiser code or assets.

## Run it

```
npm install
npm start
```

Needs Node 22+ (24 recommended). The first `npm install` downloads Electron (~100 MB).

## Use it

1. **Demo** — press *Demo rig* (⌘D). 36 fixtures light up from a built-in DMX generator so you can see it working with no console.
2. **Your rig** — export an MVR from grandMA3 (`Export MVR` in the patch) or from Vectorworks / Depence / Capture, then *Open MVR…* (⌘O) or drop the file on the window. Fixtures appear where the file puts them, patched as in the file.
3. **Live DMX** — on grandMA3: *Menu → In & Out → DMX Protocols → sACN*, enable output for the universes you patched. Put the console (or onPC) on the same network as this Mac. The universe chips in the sidebar go green when data arrives. Turn *Demo DMX* off so the console owns the output.
4. **GDTF only** — *Load GDTF…* (⌘G) with a `.gdtf` from gdtf-share.com and it will offer to hang a line of them on a truss, patched from 1.1, so you can check a profile without an MVR.

Controls: drag to orbit, scroll to zoom, right-drag to pan, **F** to frame the rig, click a fixture (or its row) to highlight it, double-click a row to fly to it.

## Layout

```
src/main.js           Electron main: window, file dialogs, sACN → renderer IPC, demo generator
src/preload.js        Safe bridge (contextIsolation) between main and renderer
src/lib/xml.js        Tiny dependency-free XML parser
src/lib/gdtf.js       GDTF description.xml → fixture profile
src/lib/mvr.js        MVR GeneralSceneDescription.xml → scene (fixtures, trusses, patch)
src/lib/sacn.js       E1.31 receiver + packet encoder
src/lib/demo.js       Demo rig + demo DMX frames
src/renderer/         Three.js scene (renderer.js), fixture models + beams (fixture.js), DMX→state mapping (dmx.js)
test/                 node --test suites for every parser and the DMX mapping
```

`npm test` runs the test suite (no Electron needed).

## Conventions

- MVR/GDTF are Z-up, millimetres; Three.js is Y-up, metres. `mvrMatrixToThree()` in `fixture.js` does the change of basis.
- A fixture's local **+Y** (GDTF +Z) is the base axis: tilt-centre beam direction. Hung fixtures (rotated 180° about X in the MVR) therefore point straight down at tilt centre, as on a real rig.
- sACN universes are joined on every non-loopback IPv4 interface. Universe N → `239.255.(N>>8).(N&255)` port 5568.

## Roadmap ideas

- Load MVR truss / scene geometry (`.3ds` / `.glb`) instead of placeholder trusses
- Gobo projection, prism, frost, animation wheels
- Art-Net input, sACN priority per universe UI
- 2D plot view + patch sheet / PDF export
- Camera presets, screenshots, timecode-locked video capture

## Download a built app (DMG)

Every push to `main` runs `.github/workflows/build.yml`, which tests the code and builds
`LightBox-Previs-<version>-arm64.dmg` (Apple Silicon) and `-x64.dmg` (Intel) on a macOS runner.
Grab them from the workflow run's **Artifacts**, or push a tag like `v0.1.0` and they're attached to a GitHub Release.

The build is **not code-signed or notarised** (that needs an Apple Developer ID certificate in the repo secrets).
On first launch macOS will say the app "cannot be verified": right-click the app → **Open** → **Open**, or run
`xattr -cr "/Applications/LightBox Previs.app"` once. After that it opens normally.
