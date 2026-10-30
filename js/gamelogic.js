/**
 * GameLogic — placeholder owned by the game developer.
 *
 * Rules for this file:
 * - Consumes HandFrame (normalized 0..1, see js/contracts.js) once per frame.
 * - NEVER calls p5 drawing functions. The HUD renders; this file only decides.
 * - Exposes getState() so ui.js can render whatever the game exposes.
 */
class GameLogic {
  constructor() {
    /** @type {HandFrame} */
    this.frame = { hands: [], updatedAt: 0 };
    this.state = { handCount: 0 };
  }

  /** @param {HandFrame} frame */
  update(frame) {
    this.frame = frame;
    this.state = { handCount: frame.hands.length };
    // TODO(game): turn hand positions into gameplay here.
  }

  getState() {
    return this.state;
  }
}
