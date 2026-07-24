/**
 * 🔌 NetClient — the browser end of the realtime transport.
 *
 * A thin, typed wrapper over the native WebSocket: connects same-origin to the
 * in-process pool hub (see realtimeUrl), reconnects with backoff, and dispatches
 * decoded {@link ServerMessage}s to typed listeners. It knows nothing about the
 * tavern or the dungeon — those wire their own handlers on top.
 */
import type { ClientMessage, ServerMessage, ServerMessageOf, ServerMessageType } from "./protocol";

type Handler<T extends ServerMessageType> = (msg: ServerMessageOf<T>) => void;

export type NetStatus = "idle" | "connecting" | "open" | "closed";

/**
 * ws(s):// URL for the realtime hub, or null when networking is disabled.
 *
 * ALWAYS SAME-ORIGIN `/ws`. The multiplayer pool hub runs IN-PROCESS in the
 * game's own production server (server.mjs → server/realtime.mjs), so the socket
 * endpoint is wherever the page came from — `wss://braindeadbot.com/ws`
 * publicly, `ws://10.0.0.16:5174/ws` on the LAN. One origin, one pool: never
 * dial a different host, or LAN and public players would split into separate
 * worlds (that was the bug with routing ws to braindeadbot-service, which is
 * also LAN-bound and unreachable both from public pages and from inside the
 * client's container).
 *
 * Under `next dev` there is no custom server, so the upgrade fails and the game
 * simply runs single-player — to test multiplayer locally, use
 * `npm run build && npm start`.
 */
export function realtimeUrl(): string | null {
  if (typeof window === "undefined") return null;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

export class NetClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Map<string, Set<(m: ServerMessage) => void>>();
  private _status: NetStatus = "idle";
  private _id: string | null = null;
  private _seed: number | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wantOpen = false;
  /** Re-sent on every (re)connect so a dropped socket re-announces itself. */
  private onOpenHook: (() => void) | null = null;

  get status(): NetStatus {
    return this._status;
  }
  get id(): string | null {
    return this._id;
  }
  /** The shared world seed handed out in `welcome` — the whole pool's dungeon. */
  get seed(): number | null {
    return this._seed;
  }
  get connected(): boolean {
    return this._status === "open";
  }

  /**
   * Open the socket. `onOpen` fires on the first connect AND every reconnect —
   * callers use it to (re-)send `hello`. Returns false when networking is
   * disabled for this origin (caller stays single-player).
   */
  connect(onOpen?: () => void): boolean {
    const url = realtimeUrl();
    if (!url) return false;
    this.wantOpen = true;
    this.onOpenHook = onOpen ?? null;
    this.open(url);
    return true;
  }

  private open(url: string): void {
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(url);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
      this.onOpenHook?.();
    };
    ws.onmessage = (ev) => this.dispatch(ev.data);
    ws.onclose = () => {
      this.ws = null;
      this._id = null;
      this.setStatus("closed");
      if (this.wantOpen) this.scheduleReconnect(url);
    };
    ws.onerror = () => {
      // onclose will follow and drive the reconnect; nothing to do here.
    };
  }

  private scheduleReconnect(url: string): void {
    if (this.reconnectTimer || !this.wantOpen) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantOpen) this.open(url);
    }, delay);
  }

  private dispatch(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "welcome") {
      this._id = msg.id;
      this._seed = msg.seed;
    }
    const set = this.listeners.get(msg.type);
    if (set) for (const h of [...set]) h(msg);
  }

  /** Subscribe to one message type. Returns an unsubscribe function. */
  on<T extends ServerMessageType>(type: T, handler: Handler<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const wrapped = handler as (m: ServerMessage) => void;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Close intentionally — no reconnect. */
  close(): void {
    this.wantOpen = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._id = null;
    this.setStatus("idle");
  }

  private setStatus(s: NetStatus): void {
    this._status = s;
  }
}

/**
 * The process-wide client. One socket serves both the tavern and the dungeon —
 * the drop-in pool you joined is the pool you dungeon with, so the connection
 * must survive the scene change.
 */
let shared: NetClient | null = null;
export function net(): NetClient {
  if (!shared) shared = new NetClient();
  return shared;
}
