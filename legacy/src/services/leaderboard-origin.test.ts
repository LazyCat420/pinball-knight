/**
 * WHERE THE LEADERBOARD IS FETCHED FROM — the choice that decided whether public
 * scores existed at all.
 *
 * `NEXT_PUBLIC_BACKEND_URL` is inlined at build time and, in this deploy, is the
 * LAN address of braindeadbot-service. A visitor on braindeadbot.com cannot
 * reach that, so the client used to skip the request and keep the board in
 * localStorage — every public run ended with the dungeon logging
 * "leaderboard rejected the run score" for a score no server ever saw.
 *
 * The rule pinned here: a PUBLIC page asks its OWN origin (`""`, forwarded by
 * server/scores-proxy.mjs), a PRIVATE one calls the service directly (under
 * `next dev` there is no custom server, so there is no proxy to ask).
 *
 * The suite runs in vitest's node environment, so `window` is stubbed — these
 * functions read exactly one thing off it, `location.hostname`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BACKEND_API_URL, isRemoteBackendEnabled, leaderboardBase } from "./api-config";

function onHost(hostname: string) {
  (globalThis as { window?: unknown }).window = { location: { hostname, protocol: "https:" } };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("leaderboardBase", () => {
  it("sends a PUBLIC page to its own origin, so the server does the reaching", () => {
    onHost("braindeadbot.com");
    expect(leaderboardBase()).toBe("");
    onHost("www.braindeadbot.com");
    expect(leaderboardBase()).toBe("");
  });

  it("keeps LAN and dev pages talking to the service directly", () => {
    for (const h of ["10.0.0.16", "localhost", "127.0.0.1", "192.168.1.20", "nas.local"]) {
      onHost(h);
      expect(leaderboardBase(), `${h} should call the service directly`).toBe(BACKEND_API_URL);
    }
  });

  it("REGRESSION: a public page is never gated by isRemoteBackendEnabled", () => {
    // That gate is still correct for TTS and youtube-sync — those have no proxy
    // and no business firing at a visitor's own LAN. The leaderboard is the one
    // route with a server-side hop, so it must NOT share the gate: pairing them
    // is what made the public board local-only.
    onHost("braindeadbot.com");
    expect(isRemoteBackendEnabled()).toBe(false);
    expect(leaderboardBase()).toBe("");
  });

  it("falls back to the baked URL with no window at all (SSR / build)", () => {
    expect(leaderboardBase()).toBe(BACKEND_API_URL);
  });
});
