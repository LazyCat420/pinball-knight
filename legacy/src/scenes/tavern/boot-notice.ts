/**
 * THE ONLY THING THAT CAN SPEAK WHILE THE TAVERN IS BLACK.
 *
 * Every other surface in this game is painted into the pixel pass — the descent
 * screen, the vendor counters, the character select, all of it. That is a good
 * design and it has exactly one hole: the span before the tavern's renderer is
 * usable. `presentMode` returns "none" there because `render()` and
 * `presentUi()` both throw on an uninitialised backend, so for that span there
 * is no pass to paint into and a painted screen is not an option — which is why
 * the black gap had nothing on it and a backend failure had nothing to say.
 *
 * So this is plain DOM. The browser composites it with no frame loop, no
 * renderer and no GPU, which is the entire reason it is the right tool here and
 * the wrong tool everywhere else in this codebase.
 *
 * It is deliberately quiet. On the happy path it is up for the length of one
 * pipeline warm (~4s measured on an RTX 3090 Ti) and says only that the room is
 * coming; the failure state is the one that has to be loud, because the
 * alternative it replaces is a black rectangle the player cannot tell apart
 * from a crashed tab.
 */

const ID = "tavern-boot-notice";

export type TavernBootState = "loading" | "failed";

/**
 * Fault-injection seam, kept because this defect is otherwise untestable in a
 * browser: `?tavernfail=1` makes the backend init reject.
 *
 * The permanent black screen — title intro, then nothing, forever — was found
 * by reading and CONFIRMED by driving this, which is the only reason it could
 * be told apart from the merely-slow warm sitting behind the same flag. Its
 * sibling `?tavernwarm=0` exists for the same reason one file over.
 */
export function tavernInitPromise(renderer: { init: () => Promise<unknown> }): Promise<unknown> {
  try {
    if (new URLSearchParams(window.location.search).get("tavernfail") === "1") {
      return Promise.reject(new Error("FAULT INJECTION: ?tavernfail=1"));
    }
  } catch {
    /* no window/search — take the real path */
  }
  return renderer.init();
}

export function showTavernBootNotice(stateName: TavernBootState): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ID;
    // Above the tavern canvas (10005) so it is visible whether or not the
    // canvas ever draws anything.
    el.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:10006",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "gap:14px",
      "background:#07090d",
      "font-family:'JetBrains Mono',monospace",
      "letter-spacing:2px",
      "text-transform:uppercase",
      "text-align:center",
      "padding:24px",
    ].join(";");
    document.body.appendChild(el);
  }
  el.replaceChildren(...body(stateName));
}

export function hideTavernBootNotice(): void {
  if (typeof document === "undefined") return;
  document.getElementById(ID)?.remove();
}

function body(stateName: TavernBootState): HTMLElement[] {
  if (stateName === "loading") {
    const line = document.createElement("div");
    line.style.cssText = "color:#c8a24a;font-size:13px";
    line.textContent = "OPENING THE TAVERN…";
    return [line];
  }

  const head = document.createElement("div");
  head.style.cssText = "color:#c4453f;font-size:15px";
  head.textContent = "THE TAVERN COULD NOT START";

  const why = document.createElement("div");
  why.style.cssText = "color:#8a8578;font-size:11px;max-width:44ch;line-height:1.8";
  // Name the cause. "Something went wrong" would leave the player exactly where
  // the black screen did, which is the whole thing this replaces.
  why.textContent = "the graphics backend refused to start. this is usually a second webgpu context the browser would not grant — closing other tabs and reloading normally clears it.";

  const reload = document.createElement("button");
  reload.style.cssText = [
    "margin-top:6px",
    "padding:10px 22px",
    "background:#2a2118",
    "color:#c8a24a",
    "border:2px solid #c8a24a",
    "font:inherit",
    "font-size:12px",
    "letter-spacing:2px",
    "cursor:pointer",
  ].join(";");
  reload.textContent = "RELOAD";
  reload.addEventListener("click", () => window.location.reload());

  return [head, why, reload];
}
