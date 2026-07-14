import { describe, it, expect } from "vitest";
import { PLAYER_FRAMES, ZOMBIE_FRAMES, CHARS, type ActorFrames } from "./sprite-data";
import { SPRITE_PX } from "../constants";

/**
 * The art is hand-typed character grids, so the failure mode is a typo: a row
 * that's the wrong length, or a char with no palette entry. Both would either
 * throw at load or silently paint the wrong colour. Catch them here.
 */

const actors: Array<[string, ActorFrames]> = [
  ["player", PLAYER_FRAMES],
  ["zombie", ZOMBIE_FRAMES],
];

describe("sprite art", () => {
  for (const [name, frames] of actors) {
    describe(name, () => {
      it("has idle and walk in every authored direction", () => {
        for (const dir of ["S", "N", "E"] as const) {
          expect(frames[dir].idle, `${dir} idle`).toBeTruthy();
          expect(frames[dir].walk, `${dir} walk`).toBeTruthy();
        }
      });

      it("every frame is exactly 16x16", () => {
        for (const dir of ["S", "N", "E"] as const) {
          for (const [clip, list] of Object.entries(frames[dir])) {
            list?.forEach((frame, fi) => {
              expect(frame.length, `${dir}:${clip}[${fi}] row count`).toBe(SPRITE_PX);
              frame.forEach((row, ri) => {
                expect(row.length, `${dir}:${clip}[${fi}] row ${ri}`).toBe(SPRITE_PX);
              });
            });
          }
        }
      });

      it("uses only characters that map to a palette entry", () => {
        const unknown = new Set<string>();
        for (const dir of ["S", "N", "E"] as const) {
          for (const list of Object.values(frames[dir])) {
            list?.forEach((frame) => {
              frame.forEach((row) => {
                for (const ch of row) {
                  if (CHARS[ch] === undefined) unknown.add(ch);
                }
              });
            });
          }
        }
        expect([...unknown]).toEqual([]);
      });

      it("has a non-empty silhouette in every frame", () => {
        // A frame that is entirely transparent means a copy-paste slip.
        for (const dir of ["S", "N", "E"] as const) {
          for (const [clip, list] of Object.entries(frames[dir])) {
            list?.forEach((frame, fi) => {
              const solid = frame.join("").split("").filter((c) => c !== ".").length;
              expect(solid, `${dir}:${clip}[${fi}] is blank`).toBeGreaterThan(20);
            });
          }
        }
      });
    });
  }
});
