# AGENTS.md

Static p5.js + ml5.js hand-gesture game prototype. No package manager, no bundler, no tests, no CI.

## Run

- No build step. Serve the folder over HTTP (e.g. `npx serve .`) and open it — `file://` will fail because the webcam needs `localhost` or HTTPS.
- Camera permission is requested on load via `HandTracker.init()`; a denied prompt renders as red text on the canvas.

## Architecture

Three people own three modules in parallel. One shared contract, one wiring file.

- `js/contracts.js` — **the only shared file**. `Hand` / `HandFrame` typedefs, MediaPipe landmark indices, and the pure `viewportFor` / `mapPointToCanvas` helpers. Changing it requires agreement from all three owners.
- `js/handpose.js` — `HandTracker`: owns the hidden `<video>`, the ml5 model, and the skeleton rendering. Public API: `init()`, `isReady()`, `getError()`, `getFrame()`, `getAspect()`, `draw()`, `stop()`.
- `js/gamelogic.js` — `GameLogic`: consumes `HandFrame`, decides, exposes `getState()`. Must never call p5 drawing functions.
- `js/ui.js` — `Hud`: draws overlays from `HandFrame` + `getState()`. Must not touch keypoint topology or mutate game state.
- `sketch.js` — composition root only. Per frame: `background` → `game.update(frame)` → `handTracker.draw()` → `hud.draw()`. Keep feature logic out of this file.
- `index.html` — load order is load-bearing: p5 → ml5 → `contracts.js` → `gamelogic.js` → `handpose.js` → `ui.js` → `sketch.js`. `sketch.js` stays last (defines `setup`/`draw`); `contracts.js` must precede every module that reads the typedefs.

## Conventions and gotchas

- **Hand coordinates are normalized 0..1** in camera space, never pixels. Consumers scale with `viewportFor(width, height, handTracker.getAspect())`. Do not introduce camera-pixel coordinates into the contract.
- Camera image is never drawn — only the stick-figure skeleton. Do not add `image(video, ...)`; the video element is created off-DOM on purpose.
- X is mirrored (`mirror: true`) so movement matches selfie view, and `handedness` is swapped accordingly. Flipping any of that requires updating both drawing and game input.
- No ES modules. Scripts share global scope via plain `<script>` tags, so `import`/`export` fail. A new file must be registered in `index.html` in the right order.
- Use p5 global mode (`setup`/`draw`), not instance mode, matching existing code.
- p5 is pinned to `2.3.3` and ml5 to `1.4.0` in `index.html`; bump deliberately, never implicitly.
- `ml5.handPose()` is a **synchronous factory**: it returns the instance immediately and the load promise is `instance.ready`. `await ml5.handPose()` is a no-op and makes `detectStart()` run against a null model, killing ml5's internal loop silently (no console error, zero hands forever). Always `await instance.ready` before `detectStart()`.
- `detectStart(video, cb)` pushes results on its own; `draw()` must tolerate running before init resolves (it renders loading text, and a separate "waiting for camera frames" state when the model is loaded but silent).
- The camera `<video>` stays in the DOM, off-screen and transparent — not `display:none`, not detached, because some browsers stop producing frames without a render surface. The image itself is never drawn.
- ml5 results give 21 `keypoints` in MediaPipe order; `HandTracker.CONNECTIONS` encodes the bones. Adding a landmark consumer means using `HAND_LANDMARKS` from `contracts.js`, not magic indices.
- Performance knobs live on `HandTracker`: `detectFps` (default 30), `inputMaxWidth` (default 480, model input is downscaled), `input: "canvas" | "video"`. Keypoints are normalized against the **input canvas** size (`_inputWidth`/`_inputHeight`), not `videoWidth` — changing `inputMaxWidth` without that normalization silently shifts the skeleton.
- `sketch.js` calls `pixelDensity(1)`; removing it quadruples fill cost on high-DPI screens.
- Commit messages in this repo are in Spanish (e.g. "Se creó la estructura de archivos"); match that language.

## Branching

- Branches: `main`, `develop`, and one feature branch per feature (`feature/handpose` currently active).
- No remote is configured and there is no PR/CI workflow to satisfy.
