/**
 * WHICH BUTTON THE PROMPT SHOULD NAME.
 *
 * The tavern's station prompt said `[E]` unconditionally. To someone holding a
 * controller that is not a hint, it is a wrong answer — and it is why the
 * descend board read as broken on a pad (reported 2026-08-29: "in the tavern I
 * can't go into the maze ... I have to hit E on the keyboard even when using
 * controller"). The action was reachable; the label named a key they were not
 * holding.
 *
 * Pure and separate from the painter so the choice can be tested without a
 * canvas, and so the tavern and anything else that grows a prompt cannot
 * disagree about it.
 *
 * ── THE ORDER IS "WHAT ARE THEY HOLDING", NOT "WHAT EXISTS" ──
 * A pad wins because plugging one in is a deliberate act and the hands are on
 * it. Touch comes next: a phone has no keyboard to fall back to, so naming a
 * key there is strictly useless. The keyboard is last because it is the only
 * one that is always technically available and therefore the weakest evidence.
 *
 * ── ASCII ONLY, AND NOT BY TASTE ──
 * The label goes through `text()` at size 8, which draws from the pixel-font
 * atlas. A glyph the atlas lacks draws NOTHING, silently — so the PlayStation
 * cross that the on-screen pad paints as a shape cannot be typed here. `[X]`
 * is the same button in characters the atlas has.
 */
export interface InteractDevices {
  /** A physical controller answered the last poll. */
  pad: boolean;
  /** The on-screen thumb pad is installed. */
  touch: boolean;
}

/** The bracketed button name for "act on the thing in front of you". */
export function interactHint(d: InteractDevices): string {
  if (d.pad) return "[A]";
  if (d.touch) return "[X]";
  return "[E]";
}
