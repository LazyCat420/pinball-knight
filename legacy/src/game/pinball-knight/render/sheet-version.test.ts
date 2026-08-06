/**
 * A CACHED SHEET IMAGE MUST NEVER OUTLIVE ITS MANIFEST.
 *
 * The production failure, in one line: the sidecar is served `no-store` and the
 * PNG `max-age=86400, stale-while-revalidate=604800`, so a returning browser
 * pairs a FRESH manifest with a STALE image — for a day by max-age and a week
 * under stale-while-revalidate. Every cell rect then points into the wrong
 * bitmap. `loadImportedSheet`'s size check notices and falls back to the
 * painter, which is the safe outcome and still the wrong one: the player picked
 * Mario and got "SHEET MISSING". Measured live on `mario-S`: manifest 197x352,
 * cached PNG 116x304.
 *
 * The rule these tests hold: if the sheet changed, the URL changed.
 */
import { describe, it, expect } from "vitest";
import { versioned } from "./imported-paints";
import type { SheetManifest } from "../tools/sprite-forge/manifest";

function sheet(over: Partial<SheetManifest> = {}): SheetManifest {
  return {
    name: "mario",
    dir: "S",
    image: "/sprites/mario-S.png",
    source: [197, 352],
    rows: [],
    ...over,
  } as SheetManifest;
}

describe("the sheet image URL is versioned by its manifest", () => {
  it("REPUBLISHED AT A NEW SIZE — the exact production failure — changes the URL", () => {
    // 116x304 was the previous mario-S; 197x352 is the one that replaced it.
    // These two must not be able to resolve to the same cache entry.
    const before = versioned(sheet({ source: [116, 304] }));
    const after = versioned(sheet({ source: [197, 352] }));
    expect(before).not.toEqual(after);
  });

  it("republished at the SAME size still changes the URL when a hash is written", () => {
    // Dimensions cannot see this one, which is why the publisher writes a hash:
    // a recoloured or re-cut sheet of identical size is a real republish.
    const before = versioned(sheet({ hash: "aaaaaaaaaaaa" }));
    const after = versioned(sheet({ hash: "bbbbbbbbbbbb" }));
    expect(before).not.toEqual(after);
  });

  it("is STABLE when nothing changed — or every load would miss the cache", () => {
    // The other half of the contract. A URL that varies per call would defeat
    // caching entirely and re-download every sheet on every boot.
    expect(versioned(sheet({ hash: "abc123abc123" }))).toEqual(versioned(sheet({ hash: "abc123abc123" })));
    expect(versioned(sheet())).toEqual(versioned(sheet()));
  });

  it("falls back to the dimensions for sheets published before hashes existed", () => {
    // jester, beaver, frog, fish_feet, zombie, stiltneck and pinball_knight all
    // predate the hash. They must be protected without being re-exported first.
    const url = versioned(sheet({ hash: undefined }));
    expect(url).toContain("v=197x352");
  });

  it("prefers the hash over the dimensions when both are available", () => {
    expect(versioned(sheet({ hash: "deadbeef0000" }))).toContain("v=deadbeef0000");
  });

  it("keeps the image path intact and appends a real query parameter", () => {
    expect(versioned(sheet())).toMatch(/^\/sprites\/mario-S\.png\?v=/);
  });

  it("uses & when the path already carries a query", () => {
    const url = versioned(sheet({ image: "/sprites/mario-S.png?raw=1" }));
    expect(url).toContain("?raw=1&v=");
    expect(url.match(/\?/g)).toHaveLength(1);
  });
});
