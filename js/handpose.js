/**
 * HandTracker — owns the webcam, the ml5.js hand model and the skeleton rendering.
 *
 * Contract (see js/contracts.js):
 *   await tracker.init()          starts the camera + model; never throws, sets getError()
 *   tracker.isReady()             true once results can be drawn
 *   tracker.getError()            user-facing error string, or null
 *   tracker.getFrame()            -> HandFrame with normalized 0..1 coordinates
 *   tracker.getAspect()           camera width / height (for viewportFor)
 *   tracker.draw()                draws the skeleton on the p5 canvas (never the video)
 *   tracker.stop()                releases the camera and the model
 *
 * The camera image is deliberately never drawn: the game screen shows only
 * the stick-figure hands.
 */
class HandTracker {
  /** Bones of the MediaPipe hand topology, as index pairs. */
  static CONNECTIONS = [
    // thumb
    [0, 1], [1, 2], [2, 3], [3, 4],
    // index
    [0, 5], [5, 6], [6, 7], [7, 8],
    // middle
    [5, 9], [9, 10], [10, 11], [11, 12],
    // ring
    [9, 13], [13, 14], [14, 15], [15, 16],
    // pinky
    [13, 17], [17, 18], [18, 19], [19, 20],
    // palm
    [0, 17],
  ];

  /**
   * @param {Object} [options]
   * @param {number} [options.maxHands=2]
   * @param {boolean} [options.mirror=true]      flip x so movement matches selfie view
   * @param {Object} [options.modelOptions]      extra ml5.handPose options (runtime, modelType)
   */
  constructor(options = {}) {
    this.maxHands = options.maxHands ?? 2;
    this.mirror = options.mirror ?? true;
    this.modelOptions = options.modelOptions ?? {};
    // "canvas" feeds a 2d canvas drawn from the video (deterministic pixels).
    // "video" feeds the video element directly; kept only for A/B debugging.
    this.inputMode = options.input ?? "canvas";
    // Model input is downscaled: the detector resizes to ~224px internally, so
    // uploading a full 640x480 texture every frame only costs time.
    this.inputMaxWidth = options.inputMaxWidth ?? 480;
    // Inference is far more expensive than drawing; no point running it above
    // the display rate. 30 Hz looks continuous and halves the CPU/GPU load.
    this.detectFps = options.detectFps ?? 30;
    this._inputCanvas = null;
    this._inputCtx = null;
    this._inputWidth = 0;
    this._inputHeight = 0;
    this._lastDetectAt = 0;
    this._points = [];
    this._colors = null;

    this.style = {
      leftHand: "#4cc9f0",
      rightHand: "#f72585",
      unknownHand: "#ffffff",
      boneWeight: 4,
      jointRadius: 7,
    };

    /** @type {HTMLVideoElement|null} */
    this.video = null;
    /** @type {object|null} */
    this.model = null;
    /** @type {HandFrame} */
    this.frame = { hands: [], updatedAt: 0 };
    this.ready = false;
    this.error = null;
    this.framesReceived = 0;
    this.lastResultAt = 0;
    this._running = false;
  }

  async init() {
    if (this.ready || this.error) return;

    try {
      this.video = await this._createVideo();
      this.model = await this._loadModel();
      this._startDetection();
      this.ready = true;
    } catch (error) {
      this.error = error?.message ?? String(error);
      this.stop();
    }
  }

  /**
   * ml5 1.x exposes handPose as a SYNCHRONOUS factory whose load promise is
   * `instance.ready`. Awaiting the factory call alone is a no-op and starts
   * detectStart() against a null model, which kills ml5's detection loop
   * silently (no error, zero hands forever).
   *
   * Different ml5 builds and wrappers have shipped different shapes, so this
   * accepts all of them and fails loudly with a description of what arrived.
   */
  async _loadModel() {
    if (typeof ml5?.handPose !== "function") {
      const hint =
        typeof ml5?.handpose === "function"
          ? " Found ml5.handpose (lowercase): this is ml5 0.x, not 1.x."
          : "";
      throw new Error(
        `ml5.handPose is not a function | ml5 is ${typeof ml5}` +
          ` | ml5.version=${ml5?.version ?? "unknown"}` +
          ` | ml5 exports=${Object.keys(ml5 ?? {}).slice(0, 12).join(",")}.${hint}`
      );
    }

    const created = ml5.handPose({ maxHands: this.maxHands, ...this.modelOptions });

    let model = created;

    // Shape A: the factory returned a promise of the instance.
    if (typeof model?.then === "function") model = await model;

    // Shape B: the factory returned the instance and exposed `.ready`.
    if (typeof model?.ready?.then === "function") {
      const resolved = await model.ready;
      if (resolved && typeof resolved.detectStart === "function") model = resolved;
    }

    if (!model || typeof model.detectStart !== "function") {
      throw new Error(
        `ml5.handPose() gave ${this._describe(model)} without detectStart()` +
          ` | ml5.version=${ml5?.version ?? "unknown"}` +
          ` | ml5 exports=${Object.keys(ml5 ?? {}).slice(0, 12).join(",")}`
      );
    }

    return model;
  }

  _describe(value) {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    const keys = Object.keys(value).slice(0, 8).join(",");
    return `${Object.prototype.toString.call(value)} keys=[${keys}]`;
  }

  /**
   * Own detection loop instead of ml5's detectStart().
   *
   * ml5's internal loop has no error handling: one rejected estimateHands()
   * (bad frame, backend failure, wasm issue) kills it permanently and silently.
   * Running detect() ourselves means failures surface on screen instead of
   * leaving an empty frame forever.
   */
  _startDetection() {
    if (this._running) return;
    this._running = true;

    const loop = async () => {
      const minInterval = 1000 / this.detectFps;

      while (this._running) {
        const now = performance.now();
        if (now - this._lastDetectAt >= minInterval) {
          this._lastDetectAt = now;
          try {
            const hands = await this.model.detect(this._inputSource());
            this._handleResults(hands);
          } catch (error) {
            this.error = `Detection failed: ${error?.message ?? error}`;
            this._running = false;
            break;
          }
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    };

    loop();
  }

  /**
   * Model input. Drawing the video into a 2d canvas first guarantees real pixel
   * data: `fromPixels(videoElement)` can yield all-zero pixels in some
   * browser/backend combinations, which makes the detector silently return an
   * empty array frame after frame.
   */
  _inputSource() {
    const videoWidth = this.video?.videoWidth ?? 0;
    const videoHeight = this.video?.videoHeight ?? 0;
    if (!videoWidth || !videoHeight) return this.video;

    if (this.inputMode !== "canvas") {
      this._inputWidth = videoWidth;
      this._inputHeight = videoHeight;
      return this.video;
    }

    const scale = Math.min(1, this.inputMaxWidth / videoWidth);
    const width = Math.round(videoWidth * scale);
    const height = Math.round(videoHeight * scale);

    if (!this._inputCanvas) {
      this._inputCanvas = document.createElement("canvas");
      this._inputCtx = this._inputCanvas.getContext("2d", { willReadFrequently: true });
    }

    if (this._inputCanvas.width !== width || this._inputCanvas.height !== height) {
      this._inputCanvas.width = width;
      this._inputCanvas.height = height;
    }

    this._inputWidth = width;
    this._inputHeight = height;
    this._inputCtx.drawImage(this.video, 0, 0, width, height);
    return this._inputCanvas;
  }

  /** Compact state snapshot for the on-canvas debug panel. */
  getDiagnostics() {
    return {
      ml5Version: typeof ml5?.version === "string" ? ml5.version : "unknown",
      modelLoaded: Boolean(this.model),
      detecting: this._running,
      framesReceived: this.framesReceived,
      hands: this.frame.hands.length,
      input: this.inputMode,
      videoWidth: this.video?.videoWidth ?? 0,
      videoHeight: this.video?.videoHeight ?? 0,
      videoReadyState: this.video?.readyState ?? 0,
      videoPaused: this.video?.paused ?? true,
      msSinceLastResult: this.lastResultAt
        ? Math.round(performance.now() - this.lastResultAt)
        : null,
    };
  }

  isReady() {
    return this.ready;
  }

  getError() {
    return this.error;
  }

  getFrame() {
    return this.frame;
  }

  getAspect() {
    if (!this.video || !this.video.videoHeight) return 4 / 3;
    return this.video.videoWidth / this.video.videoHeight;
  }

  /**
   * True once the model has delivered at least one result frame.
   * Distinguishes "model still loading" from "model loaded but silent".
   */
  hasResults() {
    return this.framesReceived > 0;
  }

  /**
   * Draw only the skeleton: bones as sticks, joints as circles.
   * Requires p5 global mode (width/height, push, line, circle...).
   */
  draw() {
    if (!this.ready) return;

    const viewport = viewportFor(width, height, this.getAspect());

    push();
    noFill();
    strokeCap(ROUND);
    strokeJoin(ROUND);

    for (const hand of this.frame.hands) {
      const color = this._colorFor(hand.handedness);
      const points = this._mapPoints(hand, viewport);

      stroke(color);
      strokeWeight(this.style.boneWeight);
      for (let i = 0; i < HandTracker.CONNECTIONS.length; i += 1) {
        const [from, to] = HandTracker.CONNECTIONS[i];
        const a = points[from];
        const b = points[to];
        if (!a || !b) continue;
        line(a.x, a.y, b.x, b.y);
      }

      noStroke();
      fill(color);
      const diameter = this.style.jointRadius * 2;
      for (let i = 0; i < points.length; i += 1) {
        circle(points[i].x, points[i].y, diameter);
      }
    }

    pop();
  }

  /** Map keypoints into canvas space reusing one buffer: no per-frame garbage. */
  _mapPoints(hand, viewport) {
    const buffer = this._points;
    const keypoints = hand.keypoints;

    while (buffer.length < keypoints.length) buffer.push({ x: 0, y: 0 });

    for (let i = 0; i < keypoints.length; i += 1) {
      const keypoint = keypoints[i];
      const point = buffer[i];
      point.x = viewport.offsetX + keypoint.x * viewport.drawWidth;
      point.y = viewport.offsetY + keypoint.y * viewport.drawHeight;
    }

    buffer.length = keypoints.length;
    return buffer;
  }

  stop() {
    this._running = false;
    if (this.model && typeof this.model.detectStop === "function") {
      this.model.detectStop();
    }
    if (this.video?.srcObject) {
      for (const track of this.video.srcObject.getTracks()) track.stop();
      this.video.srcObject = null;
    }
    this.video?.remove();
    this.video = null;
    this.ready = false;
  }

  async _createVideo() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "getUserMedia is unavailable. Open the page from localhost or HTTPS instead of file://."
      );
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    // Keep the element in the document but rendered off-screen (NOT display:none
    // and NOT detached): some browsers stop producing frames for videos with no
    // render surface, which yields an empty detection result forever.
    video.setAttribute("playsinline", "");
    video.style.position = "fixed";
    video.style.top = "0";
    video.style.left = "0";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.setAttribute("aria-hidden", "true");
    document.body.appendChild(video);

    await video.play();

    if (!video.videoWidth) {
      await new Promise((resolve) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
      });
    }

    return video;
  }

  _handleResults(hands) {
    // Keypoints come back in the coordinate space of whatever was fed to the
    // model: the downscaled input canvas, not the raw camera resolution.
    const width = this._inputWidth || this.video?.videoWidth || 640;
    const height = this._inputHeight || this.video?.videoHeight || 480;

    const mapped = (hands ?? []).map((hand, index) => ({
      index,
      handedness: this._mirrorHandedness(hand.handedness),
      confidence: typeof hand.confidence === "number" ? hand.confidence : 1,
      keypoints: (hand.keypoints ?? []).map((keypoint) => ({
        x: this.mirror ? 1 - keypoint.x / width : keypoint.x / width,
        y: keypoint.y / height,
        z: (keypoint.z ?? 0) / width,
      })),
    }));

    this.frame = { hands: mapped, updatedAt: performance.now() };
    this.framesReceived += 1;
    this.lastResultAt = this.frame.updatedAt;
  }

  _mirrorHandedness(handedness) {
    const label = handedness ?? "unknown";
    if (!this.mirror) return label;
    if (label === "Left") return "Right";
    if (label === "Right") return "Left";
    return "unknown";
  }

  _colorFor(handedness) {
    if (!this._colors) {
      this._colors = {
        left: color(this.style.leftHand),
        right: color(this.style.rightHand),
        unknown: color(this.style.unknownHand),
      };
    }
    if (handedness === "Left") return this._colors.left;
    if (handedness === "Right") return this._colors.right;
    return this._colors.unknown;
  }
}
