# Unconscious Layers — implementation plan

## Context

Two exploration repos each solved half of a piece. `9_painting-sketches` (experiment **04-01-face-landmarks**) makes a continuously self-painting abstract canvas and, when someone is present, steals marks out of that painting to draw their body outline plus their eyes and mouth. `7_unconscious` figured out reliable blink detection and — more importantly — a *determiner* (`discovery.js`) that watches how someone blinks and decides whether they have consciously **discovered** that blinking does something.

Neither repo is the piece. This project is: a person walks up to a painting, sees themselves drawn in its own marks, blinks, and something happens; the system quietly works out whether they've realised *they* caused it, and when it's sure, it says so.

Both halves already exist and are tuned. **The work here is integration, not invention** — the risk is concentrated in three places: collapsing three MediaPipe model instances down to one, making painting math that was baked to a fixed 1120×800 canvas resolution-independent, and a session state machine that decides when the piece forgets you.

Target: single full-screen page, 16:9, ~1280×720, likely a Raspberry Pi 5 (possibly a laptop).

### Decisions already made
1. **Engaged** = segmentation coverage above threshold **AND** a detected face whose on-screen scale exceeds a threshold. Face scale is the proximity proxy.
2. **Blink reveal** = full-bleed **opaque** `<img>` above everything, instant on/off, no transition — exactly repo B's `eyes-closed`.
3. **Discovery text** lingers after disengagement so the same person can return and resume, and clears when the linger expires **or** identity tracking says a different person arrived.
4. **Canvas** = native viewport resolution, authored against a **1280×720 reference**.

---

## Findings that shape the plan

- **Repo A's production build is already dead.** `/node_modules/@mediapipe/tasks-vision/wasm` is baked literally into its committed `dist/`. Only the dev server ever worked. Must be fixed here, not inherited.
- **The local `face_landmarker.task` already contains blendshapes** (`strings` finds `face_blendshapes.tflite`, `eyeBlinkLeft`, `eyeBlinkRight`). So one local 3.7 MB model serves both the eye/mouth marks and blink detection — no CDN, no `storage.googleapis.com` dependency, works offline.
- **Repo A's canvas is CSS-stretched today** (`experiment.css` forces `100vw/100vh` over `createCanvas(1120,800)`). Everything visually tuned so far was tuned *through* that stretch. Moving to native resolution will change proportions — budget a re-tune, don't read it as a port bug.
- **The 16:9 move silently fixes a real bug.** `buildPersonMask` cover-crops to 320×180 (16:9); `buildFaceFeaturePoints` cover-crops to 1120/800 (1.4:1). Body outline and eyes/mouth are in slightly *different* spaces right now. At 16:9 the two crops become identical.
- **The two blink callers in repo B disagree about units** — `blink/index.js:109` feeds the detector *normalized* closure, `blink-tracking/index.html:695` feeds it *raw*. Pick one deliberately: **normalized** (what the shipped eyes-closed piece did), and write the choice down at the call site.
- p5 **1.9.2**'s `main` is already UMD, so a plain `p5` dependency works and the `p5-v1` alias, p5 2.x and `p5.brush` all disappear.

---

## A. Scaffold

```
12_unconscious-layers/
├── package.json  vite.config.js  index.html  .gitignore  README.md
├── public/
│   ├── models/{face_landmarker.task, selfie_segmenter_landscape.tflite}   ← copy from repo A
│   └── images/reveal.jpg                                ← start with repo B's placeholder.svg
├── scripts/{parity-check.js, discovery-sim.js, blink-timing.js}   ← repo B, import paths retargeted
└── src/
    ├── main.js                     the only entry; wires the four subsystems
    ├── styles/{stage.css, reveal.css, debug-panel.css}
    ├── settings/{defaults.js, tiers.js, flags.js, debugPanel.js}
    ├── perception/
    │   ├── camera.js               openCamera() — the ONE getUserMedia
    │   ├── vision.js               memoized FilesetResolver + model factories
    │   ├── perception.js           ← THE HUB: one video, one segmenter, one landmarker
    │   ├── segmentation.js         from shared/personSegmentation.js, camera ownership removed
    │   ├── personMask.js           verbatim from repo A
    │   ├── faceFeatures.js         index groups + canvas mapping + face-scale metric
    │   ├── blinkPipeline.js        normalizer → readFace → detector (replaces blink/index.js)
    │   ├── participant.js          verbatim from repo B
    │   └── blink/                  ← VERBATIM from repo B, minus index.js
    │       └── {detector.js, normalize.js, gates.js, discovery.js, panel.js}
    ├── painting/
    │   ├── painting.js             from mySketch.js; a factory, not a top-level `new p5`
    │   ├── contours.js             extractContours + createContourMetric + pointAlongContour
    │   ├── scale.js                reference-resolution scaling
    │   └── {PaintingQueue.js, NearestPointIndex.js}   verbatim
    └── experience/
        ├── experienceState.js      ← THE STATE MACHINE
        ├── engagement.js           coverage + face-scale hysteresis and dwell
        ├── revealImage.js          full-bleed opaque <img> layer
        └── revealText.js           the sentence layer
```

**package.json** — deps `@mediapipe/tasks-vision@0.10.22-rc.20250304`, `p5@^1.9.2`; devDeps `vite@6.4.3`, `vite-plugin-static-copy@^2.2.0`. `"type": "module"` (required by Vite *and* by repo B's node scripts). Scripts: `dev` (port 5300, `--host`), `build`, `preview`, `check` (`parity-check && discovery-sim`), `timing`.

**The wasm fileset** — use `vite-plugin-static-copy` to copy `node_modules/@mediapipe/tasks-vision/wasm/*` → `mediapipe/wasm`. One URL, `/mediapipe/wasm`, **identical in dev and prod** (the plugin installs a dev middleware too), version pinned by `package.json`, no `import.meta.env.DEV` branch. An env branch was rejected specifically because it bakes a difference between what you test and what you install — the exact class of bug that killed repo A's build. Committing 19 MB of wasm to git was rejected because it drifts from `package.json` on every update.

All MediaPipe paths live in one place, `src/perception/vision.js`:
```js
const WASM_BASE = "/mediapipe/wasm";
const FACE_MODEL = "/models/face_landmarker.task";
const SEGMENTER_MODEL = "/models/selfie_segmenter_landscape.tflite";
let filesetPromise = null;
export function loadVision() { filesetPromise ??= FilesetResolver.forVisionTasks(WASM_BASE); return filesetPromise; }
export async function createFaceLandmarker({ delegate = "GPU" }) { … }   // try GPU, catch → CPU
export async function createSegmenter({ delegate = "GPU" }) { … }
```

**index.html** — from `04-01/index.html`, back-link removed, two reveal layers added:

| layer | z | rule |
|---|---|---|
| p5 canvas | 0 | created at viewport size — **no CSS stretch** |
| `#reveal-text` | 10 | `opacity:0`; `body.discovered #reveal-text { opacity:1 }`; `font-size: clamp(24px, 4.6vw, 96px)` |
| `#reveal-image` | 20 | `fixed; inset:0; object-fit:cover; opacity:0`; `body.eyes-closed #reveal-image { opacity:1 }` — **no transition** |
| `#debug-panel` | 30 | |

The image sits above the text, so a blink during the discovered state hides the sentence. That's the intended default (it preserves "the picture exists only inside the blink"), but add `settings.textAboveReveal` (default `false`) to flip it.

---

## B. Unifying the ML pipeline — the biggest risk

Naively combined, this page would run **three** MediaPipe models across **two** library versions and **two** wasm filesets. Collapse to one camera, one `ImageSegmenter`, one `FaceLandmarker`.

| today | fate |
|---|---|
| `personSegmentation.js` owns the camera | ownership moves to `camera.js`; the loop stays |
| `faceLandmarkTracking.js` — FaceLandmarker #1, no blendshapes, 15fps | **deleted**; only `FACE_FEATURE_INDEX_GROUPS` survives into `faceFeatures.js` |
| `blink/index.js` — FaceLandmarker #2, CDN 0.10.3, remote model | **deleted**; its lines 109-125 become `blinkPipeline.js` |
| CDN `tasks-vision@0.10.3` | deleted; npm `0.10.22-rc` everywhere |

### Decompose `startBlinkDetection`, don't ride along

Its `ownsCamera` check (`blink/index.js:66`) avoids a second *MediaStream*, but **not** a second *FaceLandmarker* — and the model is the expensive thing. Riding along means two `detectForVideo` calls per frame, two graph instances, two GPU contexts, two copies of a 3.7 MB model, on exactly the hardware that can't afford it. It also hardcodes a CDN and a remote model URL an unattended installation can't depend on.

Everything carrying tuning — `detector.js`, `normalize.js`, `gates.js`, `discovery.js` — is copied **byte-identical**, so `parity-check.js` and `discovery-sim.js` keep passing unmodified and the "one detector, not two" property survives. **Zero lines change inside the copied folder.** Only the file whose whole job was owning a camera and a model gets rewritten.

### The hub

```js
// src/perception/perception.js
export function createPerception({ video, settings, flags }) → {
  start(), stop(), on(event, handler),   // on() returns an unsubscribe
  latest,                                 // last snapshot, for the panel
  handles: { detector, normalizer, discovery, participant, engagement },
}
```

| event | payload | rate |
|---|---|---|
| `face` | `{ at, points, raw:{left,right}, closure, matrix, face, faceScale, featurePoints, hasFace, latency }` | camera rate |
| `blink` | `{ closed, at }` — transitions only | on change |
| `mask` | `{ mask, width, height, coverage }` — **hub-owned copy** | 15fps, tunable |
| `engagement` | `{ engaged, reason, coverage, faceScale, holdMs }` | on change |
| `discovery` | `{ report }` | once per session |
| `participant` | `{ type:"start"\|"end", why, sessionId }` | on change |
| `error` | `{ message, fatal }` | |

**Two loops, one video, two rates.** Blinks are 100–150 ms, so the landmarker loop runs at camera rate via `video.requestVideoFrameCallback` (rAF fallback, deduped on `video.currentTime`); segmentation runs at `settings.segmentationFps` (default 15) on its own throttled rAF loop.

Fast loop per frame: one `detectForVideo` → `scoreByName(cats, "eyeBlinkLeft"/"eyeBlinkRight")` (**by name, never index** — a silent off-by-one here looks like a detection problem for weeks) → `readFace(points, matrix)` → fan out to `blinkPipeline.frame(...)`, `discovery.frame(...)`, `participant.saw(points)`, `mapFaceFeatures(...)`, `engagement.updateFace(...)`.

Three details that will bite if not designed in:

1. **`personMask.js` uses module-level shared mutable buffers.** Any consumer holding the array past the callback reads garbage. The hub `.set()`s into its own `Uint8Array(320*180)` (57.6 KB) before emitting — do this, don't just document it.
2. **MediaPipe timestamps must be strictly increasing per task instance.** Wrap each loop's clock: `at = Math.max(last + 1, performance.now())`. `performance.now()` can repeat on coarse-clock machines.
3. **Never feed `discovery` normalized closure.** It creates its own normalizer at `discovery.js:198`. Double-normalizing silently ruins the `squint` and `hold` channels — the two that read absolute levels. Raw blendshape scores only; put a comment at the call site saying so.

```js
// src/perception/blinkPipeline.js
export function createBlinkPipeline({ config = {}, normalize = true }) → {
  frame({ left, right, points, matrix, at, hasFace }) → { closed, changed, closure, value, pred, velocity, reason, face, levels, blocked },
  detector, normalizer, config, blocked, setNormalize(on),
}
```
Body lifted verbatim from `blink/index.js:109-125`.

```js
// src/perception/camera.js
export async function openCamera({ deviceId, width = 1280, height = 720, frameRate = 30 }) → { video, stream, stop() }
```
Changes from `personSegmentation.js:19-26`: drop `facingMode:"user"` (meaningless and occasionally fatal for a USB webcam on Linux), add `frameRate: { ideal: 30 }`, add optional `deviceId`, and retry once with `{ video: true }` on `OverconstrainedError` — repo B's README documents that exact failure taking an installation down.

---

## C. Resolution independence

```js
// src/painting/scale.js
export const REFERENCE_WIDTH = 1280, REFERENCE_HEIGHT = 720;
export function createScale(width, height) {
  const length = height / REFERENCE_HEIGHT;                              // linear
  const area = (width * height) / (REFERENCE_WIDTH * REFERENCE_HEIGHT);  // areal
  return { width, height, length, area, px: (v) => v * length, count: (v) => Math.round(v * area) };
}
```

Height-based, not diagonal-based: mark size should track apparent *body height*. On a true 16:9 screen the two are identical anyway; it only matters in a non-16:9 dev window.

**Keep `settings.*` as reference-resolution numbers and call `scale.px()` / `scale.count()` at the point of use, never at load.** Then the panel shows the same numbers on the laptop and the Pi, exported settings are portable, and `windowResized` never rewrites settings. Re-anchoring is nearly free: 40 000 / (1120×800) = 0.0446 marks/px², which at 1280×720 is 41 100 — inside the noise.

All constants live in `mySketch.js` unless noted:

**Linear (`scale.px`):** typhoon min width `+5` (:363) · `step = random(1,20)` (:378) · `deterministicJitter * 4` (:1109) · `perimeter >= 60` in `isOuterPersonContour` (:517) · face-point cull margin ±20 (:563-567) · arrival epsilon `max(4, …)` (:867) · `fallVelocityX/Y` (:829-830) · `gravity = 0.38` (:837) · falling cull `+120` (:847) · settings `maxTyphoonSize`, `maxOutlineObjectSize`, `outlineApproachSpeedPixelsPerSecond`, `crawlSpeedPixelsPerSecond`, `perimeterMinSize/MaxSize`

**Areal (`scale.count`):** `objectCount` (marks per unit area is the invariant) · `primitivesPerSecond` (scale *with* `objectCount` so FIFO turnover *period* stays constant — otherwise a bigger canvas takes proportionally longer to renew and the painting stops breathing)

**Inverse:** `noiseScale = 0.001` → `0.001 / scale.length` (it's a per-pixel frequency; unscaled, gestures curl tighter on a bigger canvas)

**Must NOT scale:** `contour.length < 8` (:504 — counts *mask-space* edges, mask is fixed 320×180) · `fallAngularVelocity` (radians) · `strokeWeight(size/10)` (already relative) · `positionEasePerFrame`, stain/highlight percents, blend weights, `perimeterSizeVariability` (all dimensionless) · `MASK_WIDTH/HEIGHT` · `maxOutlineObjects`/`maxFaceObjects` (judgement call — they count *source points* from fixed-resolution inputs; leaving them unscaled keeps point density constant and spacing proportional)

**Threaded, not scaled:** `extractContours` (:486-487) and `buildFaceFeaturePoints` read module-level `CANVAS_WIDTH/HEIGHT`. When they move to `contours.js` / `faceFeatures.js`, take canvas dimensions as parameters.

**`windowResized`** — 200 ms debounce (Chromium fires dozens per drag). Scale every object's `homeX/Y`, `x/y`, `targetX/Y`, `outlineTargetX/Y` by `sx`/`sy` and `baseSize` by the scale ratio; `resizeCanvas`; `resizeObjectPool` to the new areal count; `rebuildPaintingLayers`; clear `latestContours/Metrics/Outline` (next mask frame refills them). **The painting is preserved, not rebuilt.**

> Asymmetry trap: `applyBlendStyle` (:936,:944,:950) derives `size` from `baseSize`, but outline/face objects have `size` overwritten by `resizePerimeterObjects` (:883-903). Walk *both* paths or half the marks resize and half don't.

In the kiosk this never runs — it exists so the piece is tunable in a laptop window, which is where all the tuning happens.

---

## D. Experience state machine

Owned by `src/experience/experienceState.js` — the only module that knows what the piece *is*. `perception` knows nothing about states; `painting` knows nothing about discovery.

```js
export const STATE = {
  IDLE:       "idle",        // painting only
  ENGAGED:    "engaged",     // outline + eyes + mouth; blink reveal armed; discovery fed
  DISCOVERED: "discovered",  // as ENGAGED, plus the sentence
  LINGERING:  "lingering",   // sentence stays, marks gone, grace clock runs
};
```

**`eyesClosed` is deliberately not a state.** It's an orthogonal boolean rendered as an overlay — it can be true in ENGAGED, DISCOVERED or (briefly) LINGERING, and modelling it as a state gives you the product of two machines. One line: `document.body.classList.toggle("eyes-closed", eyesClosed && state !== STATE.IDLE)`.

| from | to | condition | default |
|---|---|---|---|
| IDLE | ENGAGED | gate true, held | `engageDwellMs: 600` |
| ENGAGED | IDLE | gate false, held | `disengageDwellMs: 900` |
| ENGAGED | DISCOVERED | `discovery.onDiscovered` fires while ENGAGED | — |
| DISCOVERED | LINGERING | gate false, held | `disengageDwellMs: 900` |
| LINGERING | DISCOVERED | gate true again, held | `engageDwellMs: 600` |
| LINGERING | IDLE | linger expires | `lingerMs: 20000` |
| DISCOVERED \| LINGERING | IDLE | `participant` `onEnd("swapped")` | immediate + `swapCooldownMs: 400` |
| any | IDLE | camera error / fatal | immediate |

```js
engagement: { enterCoverage: 0.020, exitCoverage: 0.010,      // fraction of the 320×180 mask
              enterFaceScale: 0.22, exitFaceScale: 0.17,      // bbox diagonal / crop diagonal — CALIBRATE ON SITE
              engageDwellMs: 600, disengageDwellMs: 900 },
session:    { lingerMs: 20000, swapCooldownMs: 400,
              identityTolerance: 0.18, identitySwapConfirmMs: 2500, identityMinVisible: 0.55 },
reveal:     { imageSrc: "/images/reveal.jpg", textAboveReveal: false, eyesClosedWatchdogMs: 3000 },
```

### One timeout, expressed three times

`experienceState` owns the linger clock authoritatively, and the two ported modules are derived from it so they can't disagree:
- `participant.absenceEndsSession = lingerMs / 1000` (repo B's default 3 s would end the session long before the linger window and defeat "returns and resumes")
- `discovery.absentResetMs = lingerMs` (repo B's default 2500 — raising it is what lets the sticky `discovered` flag survive a brief absence). Acts as a backstop; on LINGERING→IDLE, `experienceState` calls `discovery.reset()` explicitly rather than waiting for it.
- On `onEnd("swapped")`, call `discovery.reset()` **immediately** — a new person arriving before the old one's grace expires must not inherit their evidence. `onDiscovered` listeners survive a reset, so the next person triggers normally.

### Interaction cases, spelled out

- **Blink while the sentence is up** — both render, image covers the sentence (default). No state change.
- **Discovery fires while eyes are shut** — sentence mounts under the opaque image; they meet it when they open. No special case.
- **Someone walks away mid-blink.** `detector.frame` with `hasFace:false` drives `raw → 0` (`detector.js:81` via `combine`), `pred` drops below `enter`, the release branch at `:118` fires and the image comes down on its own. **Belt and braces anyway:** a watchdog forces `eyesClosed = false` after `eyesClosedWatchdogMs` (3000) or on IDLE. A blink is 150 ms; three seconds is not a blink, and a stuck full-bleed image is the worst possible failure.
- **Discovery fires while IDLE** — can't, because `discovery.frame` gets `hasFace: sessionActive && !!points`. Guard the handler anyway (`if (state === IDLE) return`); the sticky flag would otherwise burn the single `onDiscovered` firing on nobody.
- **Second person joins** — `numFaces:1`, MediaPipe picks one; identity may fire `"swapped"`. Intended: the sentence belongs to whoever the machine is currently reading.
- **Different person re-engages during LINGERING** — drift beyond `0.18` held for `identitySwapConfirmMs` → `"swapped"` → sentence clears → cooldown → fresh ENGAGED. A stranger sees the previous sentence for up to 2.5 s; acceptable, and far better than clearing on a head turn.

```js
export function createExperience({ settings, perception, painting, revealImage, revealText }) → {
  tick(at), get state(), get sessionId(), get timeInState(),
  on(event, handler), forceState(name), snapshot(),
}
```
All entry effects in one `applyState()` so the piece's behaviour is written down in exactly one place: IDLE → `painting.setEngaged(false)` (existing `dropActive*Objects` fling the marks off with gravity) + `revealText.hide()` + `eyesClosed = false`; ENGAGED → `painting.setEngaged(true)`, arm the reveal; DISCOVERED → `revealText.show()`; LINGERING → `painting.setEngaged(false)`, text stays.

---

## E. Raspberry Pi 5

**Plan for 4 000–10 000 marks at 30 fps, not 40 000 at 60.** 40k Canvas2D primitives/frame is ~5–8 ms on an M-series Mac even with the existing draw-state dedupe (:1050-1094) and 3-layer blend batching; a Pi 5's VideoCore VII under Chromium is realistically 5–15× slower. Two things make it worse than a naive count suggests: `drawObject` type 0 (:995-1003) does a full `push/translate/rotate/square/pop` transform save-restore **per mark**, and `blendMode(MULTIPLY/SCREEN)` maps to `globalCompositeOperation`, which is expensive on a tiled/software rasterizer.

```js
// src/settings/tiers.js
high:   { objectCount: 40000, primitivesPerSecond: 90, segmentationFps: 15, outlineRetargetHz: 15,
          maxOutlineObjects: 1400, maxFaceObjects: 300, rotatedSquares: true,  delegate: "GPU" }
medium: { objectCount: 16000, primitivesPerSecond: 45, segmentationFps: 12, outlineRetargetHz: 10,
          maxOutlineObjects:  900, maxFaceObjects: 240, rotatedSquares: true,  delegate: "GPU" }
low:    { objectCount:  6000, primitivesPerSecond: 22, segmentationFps:  8, outlineRetargetHz:  6,
          maxOutlineObjects:  500, maxFaceObjects: 180, rotatedSquares: false, delegate: "CPU" }
```
Resolution order: `?tier=` → `settings.tier` from localStorage → `high`. A tier is a **partial overlay applied before** `loadSettings()` hydrates, so panel overrides still win and persist. Auto-downgrade **once**: if smoothed fps (the panel already keeps an 8-sample window, `debugPanel.js:679-693`) stays under 24 for 5 continuous seconds within the first 60 s, step down one tier and never step again — an installation that oscillates between tiers is worse than one that's slow.

Knobs that actually matter, in order: **`objectCount`** (linear in draw calls — the whole ballgame) · **`rotatedSquares`** (new boolean; when false, type 0 uses `p.rect(x,y,size,size)` — `rectMode(CENTER)` is already set at :116 — removing a transform save-restore from a third of all marks for a change the eye barely registers on a 5px mark) · `primitivesPerSecond` (draw work *and* GC pressure from typhoon allocation) · **`outlineRetargetHz`** · `segmentationFps` · `maxTyphoonSize` (fill *area* is what a software rasterizer charges for) · `delegate`.

`outlineRetargetHz` deserves explaining because it's invisible in the source: every mask frame, `updateStaticOutlineTargets` (:788-808) builds a **brand-new** `NearestPointIndex`, and `buildTree` (`NearestPointIndex.js:46-63`) does a `sort` plus two `slice` allocations *per node*. A 1 000–1 500-point silhouette means a fresh O(n log²n) tree with ~1 200 array allocations 15×/sec, then 1 400 queries. Decoupling retarget rate from segmentation rate costs nothing.

**Honest unknowns:**
- **GPU delegate in Chromium on Pi OS** may silently fall back to CPU or fail `createFromOptions`. Ship `?delegate=cpu` and a try-GPU-catch-CPU in `vision.js`. Don't assume GPU is faster here — for small models on unified-memory SoCs, CPU is often competitive and always more predictable.
- **Camera frame rate is the blink budget, and it's upstream of the whole piece.** A blink is 100–150 ms; at 30 fps you get 3–4 samples, which is what `detector.js`'s `lead: 60` and `slopeSmoothing: 0.35` were tuned against. Blendshapes + transformation matrices roughly triple the landmarker's work versus what repo A ran. Below ~20 fps the reveal degrades from "instant" to "sometimes, late". **Measure this in Phase 2**, before anything is built on top.
- **Webcam pixel format**: many USB cameras hit 30 fps at 720p only in MJPEG; in YUY2 they cap at 10, and `getUserMedia` will hand you the 10 fps stream without complaint. Log `stream.getVideoTracks()[0].getSettings()` at startup and put `frameRate` in the readout.
- **Kiosk**: `--kiosk --app=http://localhost:4173 --use-gl=egl --autoplay-policy=no-user-gesture-required --noerrdialogs`, a dedicated profile with camera permission pre-granted (or `--use-fake-ui-for-media-stream`). `getUserMedia` needs a secure context — serve `npm run preview` on the Pi itself and **never** open the LAN IP.
- **Escape hatch if none of it is enough**: stamp new marks onto a persistent buffer with a slow global fade instead of redrawing a FIFO of live objects — O(new marks) instead of O(all marks) per frame. It changes the look (marks fade rather than vanish cleanly), so it's out of scope, but it's worth knowing the answer exists before starting rather than after.

---

## F. Debug panel

Extend `debugPanel.js` through its existing declarative arrays — `CONTROL_SECTIONS`/`BOOLEAN_CONTROLS`/`NUMBER_CONTROLS` (:14-224) generate everything and `loadSettings` (:226-276) validates against those same arrays, so adding a key to an array is genuinely all it takes for a knob to be controllable *and* persisted. Don't hand-roll.

**Delete first:** the one-time experiment-03 settings/palette migration (`:4-11`, `:230-240`, `:267-270`, `:707-731`) — in a new project it would silently import an unrelated sketch's tuning on first run. Change `STORAGE_KEY` to `unconscious-layers:12:settings:v1`.

New sections: `engagement`, `blink`, `discovery`, `session`, `performance`. New flat number keys (flat so validation works untouched): `enterCoverage`/`exitCoverage`/`enterFaceScale`/`exitFaceScale`/`engageDwellMs`/`disengageDwellMs`; `blinkEnter`/`blinkExit`/`blinkLead`/`blinkSmooth`/`blinkSlopeSmoothing`/`blinkMinSpeed`/`blinkMinVisible`/`blinkMaxTurn`/`blinkMaxPartialMs`; `discoverySuspect`/`discoveryDiscovered`/`discoveryTauMs`/`discoveryRapidMaxMs`/`discoveryRapidMinRun`; `lingerMs`/`identityTolerance`/`identitySwapConfirmMs`; `segmentationFps`/`outlineRetargetHz`. New booleans: `blinkGates`, `blinkBothEyes`, `blinkNormalize`, `revealImageEnabled`, `textAboveReveal`, `rotatedSquares`, `mirror`.

**One structural addition — readouts.** The panel has only two output paths (`updateStats`, `updateMask`). Add a third declarative array (`READOUT_GROUPS` for session/blink/discovery rows, plus the five discovery `CHANNELS`) and two returned methods, `updateReadout(groupKey, values)` and `updateChannels(report)` — ~60 lines, and every future readout is then free. The channel bars port straight from `methods/blink-tracking/index.html:1042-1054` (markup) and `:1063-1131` (the 250 ms loop) — that loop is a pure `discovery.report()` consumer with no dependency on that page. **Include the "said in words" `dWhy` line at `:1077-1084`** — it names *which* channels are carrying the score and is the single most useful line on the whole bench. Drive it from the existing 250 ms cadence (`mySketch.js:269-272`) and early-return when `panel.hidden`, exactly as `updateMask` does at `:638`, so it costs nothing in the installation.

Live params write back through the mutable config objects (`detector.config`, `discovery.config` — that's why `blink/index.js:161` exposes `stop.settings`), via one `applyPerceptionSettings(key)` in `main.js` called from `handleSettingsChange`.

**Also add Export/Import settings JSON** buttons next to the palette save/load (`debugPanel.js:493-501` is the pattern). localStorage doesn't travel from laptop to Pi, and hand-copying forty numbers through a panel over VNC eats an install day.

---

## G. Build order

**Phase 0 — scaffold.** package.json, vite.config.js, index.html, empty main.js, models copied.
*Verify:* `npm run dev` and `npm run build && npm run preview` both serve the page; `ls dist/mediapipe/wasm` shows the files; **`grep -r "node_modules" dist/` returns nothing** — the exact regression that killed repo A's build.

**Phase 1 — the painting, resolution-independent, no camera.** Port `mySketch.js` → `painting.js` as a factory, extract `contours.js`, add `scale.js` threaded through every constant in §C, add `windowResized`, port `debugPanel.js` with the 03-migration deleted.
*Verify:* `?skipCamera=1&freezePainting=1&testSeed=7` at 1280×720 and at 1120×800 produce compositions of the same character and mark density (screenshot both, compare side by side). 60 fps on the Mac at 40 000. Resize during a live run — the painting persists rather than restarting. Panel opens on Space; values survive reload.

**Phase 2 — perception hub, no visuals.** `camera.js`, `vision.js`, `perception.js`, `segmentation.js`, `faceFeatures.js`, `blinkPipeline.js`, the verbatim `blink/` folder.
*Verify:* log the blendshape category list once and confirm `eyeBlinkLeft`/`eyeBlinkRight` exist in the **npm 0.10.22 + local model** combination — the one substantive version risk in the plan. Instrument the model factories with a counter and **assert each is called exactly once**. Readout shows camera resolution and *actual* frame rate, face count, `faceScale`, `coverage`, per-frame `latency`, blink transitions, live discovery score. `node scripts/parity-check.js` and `node scripts/discovery-sim.js` both pass against the copied modules — proving they were copied, not rewritten.

**Phase 3 — engagement and the marks.** `engagement.js`; wire `mask` → contours → outline objects and `face` → feature points, gated by engagement rather than raw presence hysteresis.
*Verify:* walk toward the camera — dwell counters run, marks assemble at the visible threshold; walk back, they fall. Tune `enterFaceScale`/`exitFaceScale` live from the actual installation distance. Confirm outline and eyes/mouth land in the same coordinate space (the 16:9 fix).

**Phase 4 — the blink reveal.** `revealImage.js`, the `eyes-closed` body class, the watchdog.
*Verify:* `?eyesClosed=1` pins the image. Blink while engaged — instant opaque image, instant off, no transition, painting and marks fully hidden. Walk away mid-blink and confirm the image comes down (both via the detector's own release, and again with the detector stubbed to confirm the watchdog). Confirm the reveal does **not** arm while IDLE.

**Phase 5 — discovery, the sentence, the session.** `experienceState.js`, `revealText.js`, `participant.js`, linger/identity coupling.
*Verify:* `?state=discovered` renders the sentence with no work done — check typography at 1280×720 before ever earning it. `?forceDiscovery=1` fires the transition after 3 s engaged. Then earn it: blink rapidly 5–6× and watch the `rapid` channel climb past 0.7. Then the three lifecycle cases — (i) away 10 s, return: sentence still up, same session resumes; (ii) away 25 s, return: sentence gone, fresh session; (iii) swap with a second person inside the grace window: sentence clears within ~2.5 s and `discovery.report().score` is 0 for the newcomer.

**Phase 6 — tiers and the Pi.** `tiers.js`, auto-downgrade, `rotatedSquares`, `outlineRetargetHz`, integer-keyed `extractContours`, settings export/import, kiosk autostart.
*Verify:* on the actual Pi 5, `?tier=low&delegate=cpu`, sustained fps over a 10-minute run with a person in frame; blink latency judged by eye against a hand clap. Walk the tiers up until it breaks and record where. Cold-boot and confirm it comes up unattended with no dialogs.

---

## Risks

1. **Pi frame budget is the project risk.** 40 000 marks will not happen. Treat `low` as the real target and `high` as the laptop preview. If even 6 000 fails, the persistent-buffer rewrite (§E) is the fallback and it changes the look.
2. **FaceLandmarker frame rate on the Pi** is second, and upstream of everything. Measure in Phase 2; let it decide whether the piece ships on this hardware.
3. **`enterFaceScale` cannot be guessed** — it depends on lens FOV and mounting distance. 0.22 is a starting point, not a value. Budget an on-site tuning session, and make sure settings export/import exists *before* it.
4. **`participant.js` identity is not yaw-invariant.** `signature()` (:17-27) divides by inter-eye distance — robust to *distance*, not *rotation*; a head turned 40° reads as drift, and a false swap **clears the sentence**. Mitigations already in the plan: only call `participant.saw()` when `face.visible >= 0.55` (reusing `gates.js`'s own measure), and raise `swapConfirm` 1.5 s → 2.5 s. Expect to tune `identityTolerance` upward in the field.
5. **`extractContours` is a garbage machine.** :440-454 allocates an object plus two template-literal strings per edge into a `Map`, ~1 500–3 000× per mask frame at 15 Hz — up to 90 000 short-lived strings/sec, GC sawtooth on a Pi. Fix is mechanical: key the `Map` on the integer `y * (maskWidth + 1) + x`. Phase 6, with a before/after profile.
6. **The CSS stretch is going away** and everything visually tuned so far was tuned through it. Marks will look different at 1280×720 even with correct scaling.
7. **`personMask.js`'s shared buffers** — handled by the hub's copy. If anyone later adds a consumer that reads `event.mask` asynchronously it produces a bug that looks like a segmentation problem. Keep the copy.

**Deliberately dropped:** p5 2.x, `p5.brush`, the `p5`→`dist/app.js` alias, multi-page rollup inputs, repo B's Express server and ComfyUI bridge, `lib/blink.js` (the 58-line adapter), `lib/settings.js` (its device-id job is now one option on `openCamera`), and the experiment-03 settings migration.

---

## Critical files

- `9_painting-sketches/experiments/04-01-face-landmarks/mySketch.js` — the whole painting/outline/face-mark system; becomes `src/painting/painting.js` + `contours.js`; every §C constant lives here
- `9_painting-sketches/experiments/04-01-face-landmarks/debugPanel.js` — the declarative panel to extend
- `9_painting-sketches/shared/personSegmentation.js` — segmentation loop; camera ownership stripped, becomes `src/perception/segmentation.js`
- `7_unconscious/public/lib/blink/discovery.js` — the determiner, 665 lines of tuning; **copied verbatim**, fed raw ungated per-eye scores, `absentResetMs` raised to `lingerMs`
- `7_unconscious/public/lib/blink/index.js` — the file being **decomposed**: camera/model ownership deleted, lines 109-125 become `src/perception/blinkPipeline.js`
- `7_unconscious/public/lib/participant.js`, `public/experiments/eyes-closed/index.html`, `public/methods/blink-tracking/index.html:1042-1131` — identity, the reveal, the discovery readout