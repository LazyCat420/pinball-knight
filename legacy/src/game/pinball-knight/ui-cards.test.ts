/**
 * CARD MARKUP + THE RARITY-SCALED HOVER CONTRACT.
 *
 * The hover effects are pointer-driven CSS, so their LOOK can only be judged by
 * rendering (scripts/card-hover.mjs does that). What is testable — and what
 * actually broke during the rework — is the CONTRACT the markup and stylesheet
 * have to satisfy for those effects to be reachable at all:
 *
 *   - the effect tier must escalate with rarity, and a shiny must be promoted,
 *     or the animation stops being a rarity tell and every card in a thirty-card
 *     stash demands the same attention;
 *   - the tilt layer must be a SEPARATE element from the lifting card, because
 *     the drop shadow is on the outer one and a shadow that tilts with its card
 *     reads as a sticker;
 *   - the mote layer must exist only for mythics — it carries a running CSS
 *     animation, and putting one on every card in a stash is thirty animations
 *     competing with the dungeon's own frame budget.
 *
 * The stylesheet is asserted as text because it is a template literal: a single
 * stray backtick inside a CSS comment silently terminates it, which is exactly
 * how a build break got introduced during this rework.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A MINIMAL DOM, rather than a jsdom dependency.
 *
 * This repo's suites are deliberately DOM-free — the game's logic is tested
 * without a browser and there is no jsdom or happy-dom installed. The only DOM
 * these tests need is enough for `injectCardStyles` to park one <style> element
 * somewhere and for the test to read it back, so a ~20-line stub is a far
 * better trade than pulling a browser emulator into the dependency tree for one
 * file. `holoCard` itself is pure string building and needs nothing.
 */
interface StubEl {
  id: string;
  textContent: string;
  tagName: string;
}
let head: StubEl[] = [];

beforeEach(() => {
  vi.resetModules();
  head = [];
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => head.find((e) => e.id === id) ?? null,
    createElement: (tagName: string): StubEl => ({ id: "", textContent: "", tagName }),
    querySelectorAll: (sel: string) => head.filter((e) => sel === `#${e.id}`),
    head: {
      appendChild: (el: StubEl) => {
        head.push(el);
        return el;
      },
    },
  };
});

async function ui(): Promise<typeof import("./ui-cards")> {
  return import("./ui-cards");
}

/** The stylesheet text `injectCardStyles` parked, or "". */
function styleText(): string {
  return head.find((e) => e.id === "dungeon-card-ui-style")?.textContent ?? "";
}

describe("holoCard markup carries the hover contract", () => {
  it("declares an effect tier that escalates with rarity", async () => {
    const { holoCard } = await ui();
    const tierOf = (html: string): number => Number(/--fx:(\d)/.exec(html)?.[1] ?? -1);
    // common → rare → epic → legendary → mythic
    expect(tierOf(holoCard("spidersilk"))).toBe(0);
    expect(tierOf(holoCard("goblintooth"))).toBe(1);
    expect(tierOf(holoCard("crystalshard"))).toBe(2);
    expect(tierOf(holoCard("grimscythe"))).toBe(3);
    expect(tierOf(holoCard("worldbreaker"))).toBe(4);
  });

  it("promotes a SHINY one tier, so a shiny common still feels like a pull", async () => {
    const { holoCard } = await ui();
    const tierOf = (html: string): number => Number(/--fx:(\d)/.exec(html)?.[1] ?? -1);
    expect(tierOf(holoCard("spidersilk"))).toBe(0);
    expect(tierOf(holoCard("spidersilk#1s"))).toBe(1);
    // ...but never past the top of the ladder.
    expect(tierOf(holoCard("worldbreaker#1s"))).toBe(4);
  });

  it("separates the tilting layer from the lifting card", async () => {
    // The canvas must sit inside .hc-inner, and .hc-inner inside .hcard. The
    // pointer handler walks canvas → inner → card; flattening this silently
    // breaks the tilt because `card` would resolve to the wrong element.
    const { holoCard } = await ui();
    const html = holoCard("grimscythe");
    const inner = html.indexOf('class="hc-inner"');
    const face = html.indexOf("hc-face");
    expect(inner).toBeGreaterThan(-1);
    expect(face).toBeGreaterThan(inner);
  });

  it("gives the mote layer ONLY to mythics", async () => {
    const { holoCard } = await ui();
    expect(holoCard("worldbreaker")).toContain("hc-motes");
    expect(holoCard("spidersilk")).not.toContain("hc-motes");
    expect(holoCard("grimscythe")).not.toContain("hc-motes");
    // A shiny legendary is promoted INTO the mote tier.
    expect(holoCard("grimscythe#1s")).toContain("hc-motes");
  });

  it("passes the card's own material colour through for the hover glow", async () => {
    const { holoCard } = await ui();
    // A Golem card lights slate-green and a Ghost card lights cold blue: the
    // frame style and the motion have to agree, or every card throws the same
    // white light and the material system stops meaning anything on hover.
    const stone = /--gc:(#[0-9a-f]{6})/.exec(holoCard("crystalshard"))?.[1];
    const ink = /--gc:(#[0-9a-f]{6})/.exec(holoCard("wispspark"))?.[1];
    expect(stone).toBeTruthy();
    expect(ink).toBeTruthy();
    expect(stone).not.toBe(ink);
  });
});

describe("the injected stylesheet", () => {
  it("defines every layer the markup and the pointer handler reference", async () => {
    const { injectCardStyles } = await ui();
    injectCardStyles();
    const css = styleText();
    for (const sel of [".hcard", ".hc-inner", ".hc-face", ".hc-glare", ".hc-foil", ".hc-motes", ".hc-lv"]) {
      expect(css, `stylesheet is missing ${sel}`).toContain(sel);
    }
  });

  it("contains no backtick — the stylesheet is a template literal", async () => {
    // A backtick anywhere in this CSS (including inside a comment) terminates
    // the literal early and turns the rest of the stylesheet into JavaScript.
    // It is a silent, confusing build break, and it has happened twice.
    const { injectCardStyles } = await ui();
    injectCardStyles();
    expect(styleText()).not.toContain("`");
  });

  it("is injected exactly once however many times it is asked for", async () => {
    const { injectCardStyles } = await ui();
    injectCardStyles();
    injectCardStyles();
    injectCardStyles();
    expect(head.filter((e) => e.id === "dungeon-card-ui-style")).toHaveLength(1);
  });

  it("never blends the foil with color-dodge", async () => {
    // Dodge divides by the inverse of the backdrop. These cards are near-black
    // by design, so that tends to infinity: the first cut rendered a hovered
    // legendary as a solid rainbow smear with the portrait and every stat line
    // gone. Overlay is the mode that survives a dark card.
    const { injectCardStyles } = await ui();
    injectCardStyles();
    const css = styleText();
    expect(css).not.toContain("color-dodge");
  });

  it("pauses every idle animation until the card is hovered", async () => {
    // An animation at opacity:0 is INVISIBLE, not stopped — it still composites
    // every frame. Left running, a thirty-card stash is thirty animating layers
    // behind a live three.js dungeon, animating cards nobody is looking at.
    const { injectCardStyles } = await ui();
    injectCardStyles();
    const css = styleText();
    expect(css).toContain("animation-play-state:paused");
    expect(css).toContain(".hcard:hover .hcard-shimmer::before{animation-play-state:running}");
    expect(css).toContain(".hcard:hover .hc-motes{animation-play-state:running}");
  });

  it("silences the CSS animations under prefers-reduced-motion", async () => {
    // The JS handler has its own reduced-motion guard, but it only gates the
    // POINTER effects — the idle shimmer, mote drift and shiny pulse are pure
    // CSS and would keep moving for exactly the users who asked them not to.
    const { injectCardStyles } = await ui();
    injectCardStyles();
    expect(styleText()).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the mote field sparse rather than tiled", async () => {
    // Repeating gradients at a few px tile into a visible screen-door MESH that
    // covers the whole card — the dots and the gaps are the same order, so the
    // eye reads the grid. The motes must be placed individually.
    const { injectCardStyles } = await ui();
    injectCardStyles();
    const css = styleText();
    const motes = /\.hc-motes\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(motes).toContain("no-repeat");
  });
});
