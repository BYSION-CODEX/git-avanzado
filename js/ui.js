/**
 * Hud — placeholder owned by the UI developer.
 *
 * Rules for this file:
 * - Reads HandFrame and GameLogic.getState(). Draws overlays only.
 * - Does not read keypoint topology and does not mutate game state.
 */
class Hud {
  constructor() {
    this.style = { text: "#e0e0e0", dim: "#7a7a7a" };
  }

  /**
   * @param {HandFrame} frame
   * @param {Object} gameState
   */
  draw(frame, gameState) {
    push();
    noStroke();
    textAlign(LEFT, TOP);
    textSize(14);

    fill(this.style.dim);
    text("hands detected", 20, 20);

    fill(this.style.text);
    textSize(28);
    text(String(gameState.handCount ?? frame.hands.length), 20, 40);

    pop();
  }
}
