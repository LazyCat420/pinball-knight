/**
 * ARRIVAL / DEPARTURE announcements.
 *
 * Every case here is a way the naive version gets it wrong in production but
 * looks fine in a one-player test:
 *   · `room:state` fires on YOUR OWN connect carrying everyone already online —
 *     announcing from it greets the whole pool the moment you log in;
 *   · a peer learned via `player:move` before its join lands is stored under the
 *     placeholder name "KNIGHT", so the announcement must read the join payload;
 *   · a flapping socket reconnects and re-sends joins for people who never left.
 * The departure position matters just as much: the server's leave payload is
 * `{id}` alone, so the last-known pose has to be read before the roster entry
 * is dropped, or the hole has nowhere to go.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The module under test pulls in the socket singleton; stub it so no network is
// touched and we can drive server messages by hand.
type Handler = (m: Record<string, unknown>) => void;
const handlers = new Map<string, Handler>();
let connected = true;
let onOpenCb: (() => void) | null = null;

vi.mock("./socket", () => ({
  net: () => ({
    get connected() {
      return connected;
    },
    id: "me",
    seed: 1,
    connect: (onOpen: () => void) => {
      onOpenCb = onOpen;
      onOpen();
      return true;
    },
    send: () => {},
    close: () => {},
    on: (type: string, fn: Handler) => {
      handlers.set(type, fn);
      return () => handlers.delete(type);
    },
  }),
}));

const { startPresence, stopPresence, onPeerArrive, onPeerDepart, peers } = await import("./presence");

/** Fire a server message into the module's subscription. */
const emit = (type: string, m: Record<string, unknown>): void => handlers.get(type)?.(m);

const peer = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slot: 1,
  name: id.toUpperCase(),
  scene: "dungeon:1",
  x: 4,
  z: 5,
  facing: "S",
  ...over,
});

beforeEach(() => {
  handlers.clear();
  connected = true;
  onOpenCb = null;
  startPresence("me");
});

afterEach(() => {
  stopPresence();
});

describe("arrivals", () => {
  it("announces a genuinely new peer, with the name from the JOIN payload", () => {
    const seen: string[] = [];
    onPeerArrive("t", (p) => seen.push(p.name));
    emit("player:join", { player: peer("alice") });
    expect(seen).toEqual(["ALICE"]);
  });

  it("does NOT announce the pool already online when you connect", () => {
    // room:state is the snapshot of everyone present at YOUR arrival.
    const seen: string[] = [];
    onPeerArrive("t", (p) => seen.push(p.name));
    emit("room:state", { players: [peer("alice"), peer("bob")] });
    expect(seen).toEqual([]);
    expect(peers()).toHaveLength(2);
  });

  it("does not re-announce a peer already in the room:state snapshot", () => {
    const seen: string[] = [];
    onPeerArrive("t", (p) => seen.push(p.name));
    emit("room:state", { players: [peer("alice")] });
    emit("player:join", { player: peer("alice") }); // duplicate join
    expect(seen).toEqual([]);
  });

  it("survives a reconnect without greeting the pool again", () => {
    const seen: string[] = [];
    onPeerArrive("t", (p) => seen.push(p.name));
    emit("player:join", { player: peer("alice") });
    expect(seen).toEqual(["ALICE"]);
    // Socket flaps: onOpen re-fires, server re-sends state + a join for alice.
    onOpenCb?.();
    emit("room:state", { players: [peer("alice")] });
    emit("player:join", { player: peer("alice") });
    expect(seen).toEqual(["ALICE"]); // still exactly one
  });

  it("prefers the join payload's name over a placeholder learned via movement", () => {
    const seen: string[] = [];
    onPeerArrive("t", (p) => seen.push(p.name));
    // Movement first — presence inserts the "KNIGHT" placeholder.
    emit("player:move", { id: "alice", x: 1, z: 2, facing: "S", scene: "dungeon:1" });
    expect(peers()[0].name).toBe("KNIGHT");
    emit("player:join", { player: peer("alice") });
    expect(seen).toEqual(["ALICE"]); // NOT "KNIGHT"
  });

  it("announces a real re-join after a genuine departure", () => {
    const seen: string[] = [];
    onPeerArrive("t", (p) => seen.push(p.name));
    emit("player:join", { player: peer("alice") });
    emit("player:leave", { id: "alice" });
    emit("player:join", { player: peer("alice") });
    expect(seen).toEqual(["ALICE", "ALICE"]);
  });
});

describe("departures", () => {
  it("reports the LAST KNOWN position — the leave payload carries none", () => {
    const gone: Array<{ x: number; z: number; name: string; scene: string }> = [];
    onPeerDepart("t", (p) => gone.push({ x: p.x, z: p.z, name: p.name, scene: p.scene }));
    emit("player:join", { player: peer("alice", { x: 1, z: 1 }) });
    emit("player:move", { id: "alice", x: 12.5, z: -3.25, facing: "N", scene: "dungeon:3" });
    emit("player:leave", { id: "alice" });
    expect(gone).toEqual([{ x: 12.5, z: -3.25, name: "ALICE", scene: "dungeon:3" }]);
  });

  it("says nothing for a peer it never knew", () => {
    const gone: string[] = [];
    onPeerDepart("t", (p) => gone.push(p.id));
    emit("player:leave", { id: "ghost" });
    expect(gone).toEqual([]);
  });

  it("drops the peer from the roster", () => {
    emit("player:join", { player: peer("alice") });
    expect(peers()).toHaveLength(1);
    emit("player:leave", { id: "alice" });
    expect(peers()).toHaveLength(0);
  });
});

describe("listener keys", () => {
  it("replaces a same-key hook instead of stacking one per scene entry", () => {
    // A scene re-entered (descend → tavern → descend) must not announce twice.
    let a = 0;
    let b = 0;
    onPeerArrive("dungeon", () => a++);
    onPeerArrive("dungeon", () => b++);
    emit("player:join", { player: peer("alice") });
    expect(a).toBe(0);
    expect(b).toBe(1);
  });

  it("keeps DIFFERENT keys independent, so tavern and dungeon both hear it", () => {
    let t = 0;
    let d = 0;
    onPeerArrive("tavern", () => t++);
    onPeerArrive("dungeon", () => d++);
    emit("player:join", { player: peer("alice") });
    expect(t).toBe(1);
    expect(d).toBe(1);
  });

  it("unsubscribes on null", () => {
    let n = 0;
    onPeerArrive("tavern", () => n++);
    onPeerArrive("tavern", null);
    emit("player:join", { player: peer("alice") });
    expect(n).toBe(0);
  });
});
