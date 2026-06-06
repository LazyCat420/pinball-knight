/**
 * Input Manager — Centralized input ownership system.
 *
 * When a game or overlay takes focus, it calls setInputOwner("game-id").
 * While an owner is set:
 *   - The main.js click handler does NOT delegate to room.handleClick()
 *   - The main.js render loop does NOT call room.animate()
 *   - Only the owning game's own listeners receive events
 *
 * On game exit, the game calls clearInputOwner() to release control.
 *
 * Usage:
 *   import { setInputOwner, clearInputOwner } from "../utils/input-manager.js";
 *   // On game launch:
 *   setInputOwner("cosmic-pool");
 *   // On game exit:
 *   clearInputOwner();
 */

let _currentOwner: string | null = null;
let _mainCanvas: HTMLElement | null = null;

/**
 * Set the current input owner. While owned, the main room
 * click/hover/animate pipeline is fully suppressed.
 *
 * @param {string} gameId — unique identifier for the owning game
 */
export function setInputOwner(gameId: string): void {
  _currentOwner = gameId;
  console.log(`🎮 Input owner set: ${gameId}`);

  // Disable pointer events on the main Three.js canvas so
  // clicks fall through to game overlays only
  if (!_mainCanvas) {
    _mainCanvas = document.getElementById("room-canvas");
  }
  if (_mainCanvas) {
    _mainCanvas.style.pointerEvents = "none";
  }
}

/**
 * Clear input ownership — restores normal room interaction.
 */
export function clearInputOwner(): void {
  const prev = _currentOwner;
  _currentOwner = null;
  console.log(`🎮 Input owner cleared (was: ${prev})`);

  // Restore pointer events on the main canvas
  if (_mainCanvas) {
    _mainCanvas.style.pointerEvents = "auto";
  }
}

/**
 * Get the current input owner ID (or null).
 * @returns {string|null}
 */
export function getInputOwner(): string | null {
  return _currentOwner;
}

/**
 * Check if any game currently owns the input.
 * @returns {boolean}
 */
export function isInputOwned(): boolean {
  return _currentOwner !== null;
}
