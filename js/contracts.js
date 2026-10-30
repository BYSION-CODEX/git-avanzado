/**
 * Shared data contract between the handpose, gamelogic and ui modules.
 *
 * This is the only file all three owners share. Change it only when all three
 * agree, because every module is written against these shapes.
 *
 * Coordinate convention: EVERYTHING is normalized to the camera frame.
 *   x, y in [0, 1]  (x already mirrored for selfie view when the tracker mirrors)
 *   z relative depth, roughly on the same scale as x
 * Consumers scale to their own canvas. Nobody exchanges camera pixels.
 */

/**
 * A single hand landmark.
 * @typedef {{ x: number, y: number, z: number }} HandKeypoint
 */

/**
 * One detected hand.
 * @typedef {Object} Hand
 * @property {number} index          Position of this hand inside the frame array.
 * @property {"Left"|"Right"|"unknown"} handedness  Already corrected for mirroring.
 * @property {number} confidence     0..1
 * @property {HandKeypoint[]} keypoints  Exactly HAND_LANDMARK_COUNT points, MediaPipe order.
 */

/**
 * One frame of hand data. Replaced wholesale on every model callback.
 * @typedef {Object} HandFrame
 * @property {Hand[]} hands
 * @property {number} updatedAt   performance.now() of the last model result.
 */

/** MediaPipe hand topology size (wrist + 4 joints per finger + 4 fingertips + thumb base). */
const HAND_LANDMARK_COUNT = 21;

/** MediaPipe hand landmark indices, in the order ml5 returns them. */
const HAND_LANDMARKS = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_FINGER_MCP: 5,
  INDEX_FINGER_PIP: 6,
  INDEX_FINGER_DIP: 7,
  INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9,
  MIDDLE_FINGER_PIP: 10,
  MIDDLE_FINGER_DIP: 11,
  MIDDLE_FINGER_TIP: 12,
  RING_FINGER_MCP: 13,
  RING_FINGER_PIP: 14,
  RING_FINGER_DIP: 15,
  RING_FINGER_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
});

/** A cached camera-to-canvas mapping, so every module scales hands the same way. */
/**
 * @typedef {Object} Viewport
 * @property {number} offsetX
 * @property {number} offsetY
 * @property {number} drawWidth
 * @property {number} drawHeight
 */

/**
 * Cover-fit the camera aspect ratio into the canvas and return the mapping.
 * Pure math, no p5: handpose and gamelogic must not each reinvent this.
 *
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} videoAspect  camera width / height (e.g. 640 / 480)
 * @returns {Viewport}
 */
function viewportFor(canvasWidth, canvasHeight, videoAspect) {
  let drawWidth = canvasWidth;
  let drawHeight = drawWidth / videoAspect;

  if (drawHeight < canvasHeight) {
    drawHeight = canvasHeight;
    drawWidth = drawHeight * videoAspect;
  }

  return {
    offsetX: (canvasWidth - drawWidth) / 2,
    offsetY: (canvasHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  };
}

/**
 * Map a normalized hand point into canvas pixels using a viewport.
 *
 * @param {HandKeypoint} point
 * @param {Viewport} viewport
 * @returns {{ x: number, y: number }}
 */
function mapPointToCanvas(point, viewport) {
  return {
    x: viewport.offsetX + point.x * viewport.drawWidth,
    y: viewport.offsetY + point.y * viewport.drawHeight,
  };
}
