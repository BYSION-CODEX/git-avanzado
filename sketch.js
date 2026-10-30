/**nopi n
 * Composition root only. No feature logic lives here.
 * Order per frame: read input -> update logic -> draw hands -> draw HUD.
 */

let handTracker;
let game;
let hud;
let showDebug = true;

function setup() {
  createCanvas(windowWidth, windowHeight);
  // Render at CSS pixels: on high-DPI screens the default doubles the framebuffer,
  // which quadruples fill cost for a full-screen background every frame.
  pixelDensity(1);

  handTracker = new HandTracker({ maxHands: 2 });
  game = new GameLogic();
  hud = new Hud();

  // init() is async; draw() renders a loading state until it resolves.
  handTracker.init();
}

function draw() {
  background(0);

  const error = handTracker.getError();
  if (error) {
    drawStartupNotice(`Hand tracking unavailable\n${error}`, true);
    if (showDebug) drawDebugPanel();
    return;
  }

  if (!handTracker.isReady()) {
    drawStartupNotice("Loading hand model...", false);
    return;
  }

  const frame = handTracker.getFrame();

  game.update(frame);
  handTracker.draw();
  hud.draw(frame, game.getState());

  if (showDebug) drawDebugPanel();

  if (!handTracker.hasResults()) {
    drawStartupNotice("Model ready, waiting for camera frames...", false);
  }
}

function drawStartupNotice(message, isError) {
  push();
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(16);
  fill(isError ? "#ff5c5c" : "#7a7a7a");
  text(message, width / 2, height / 2);
  pop();
}

/** Temporary on-canvas diagnostics. Toggle with D. */
function drawDebugPanel() {
  const d = handTracker.getDiagnostics();
  const lines = [
    `ml5 ${d.ml5Version} | model ${d.modelLoaded ? "loaded" : "none"} | loop ${d.detecting ? "on" : "off"}`,
    `frames ${d.framesReceived} | hands ${d.hands} | last result ${d.msSinceLastResult ?? "-"}ms ago`,
    `video ${d.videoWidth}x${d.videoHeight} | readyState ${d.videoReadyState} | paused ${d.videoPaused}`,
    "press D to hide",
  ];

  push();
  noStroke();
  fill(130);
  textAlign(RIGHT, TOP);
  textSize(12);
  textFont("monospace");
  text(lines.join("\n"), width - 16, 16);
  pop();
}

function keyPressed() {
  if (key === "d" || key === "D") showDebug = !showDebug;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
