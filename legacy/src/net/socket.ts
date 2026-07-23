/**
 * 🔌 NetClient — the browser end of the realtime transport.
 *
 * A thin, typed wrapper over the native WebSocket: derives the ws(s) URL from
 * the same BACKEND_API_URL the REST client uses, reconnects with backoff, and
 * dispatches decoded {@link ServerMessage}s to typed listeners. It knows nothing
 * about the tavern or the dungeon — those wire their own handlers on top.
 *
 * Reachability follows the REST rule exactly (`isRemoteBackendEnabled`): a
 * private/LAN backend is only dialled when the page is itself served from the
 * LAN, so a public visitor never opens a doomed socket to their own machine.
 */
import { BACKEND_API_URL, isRemoteBackendEnabled } from "../services/api-config";
import type { ClientMessage, ServerMessage, ServerMessageOf, ServerMessageType } from "./protocol";

type Handler<T extends ServerMessageType> = (msg: ServerMessageOf<T>) => void;
type AnyHandler = (msg: ServerMessage) => void;

export type NetStatus = "idle" | "connecting" | "open" | "closed";

/**
 * ws(s):// URL for the realtime hub, or null when networking is disabled.
 *
 * Two cases, because the backend is baked to a PRIVATE LAN address:
 *  • LAN / dev (the page itself is on a private origin) → dial the baked backend
 *    directly (`isRemoteBackendEnabled()` gates this exactly like the REST client).
 *  • PUBLIC page (e.g. braindeadbot.com) → a private-IP socket is unreachable, so
 *    connect SAME-ORIGIN (`wss://<page-host>/ws`). This works the moment the edge
 *    proxies `/ws` → the service; until then the socket just fails and the game
 *    stays single-player. Never dials the private IP from a public page.
 */
export function realtimeUrl(): string | null {
  if (typeof window === "undefined") return null;
  const pageHost = window.location.hostname;
  const pageIsPrivate =
    !pageHost ||
    pageHost === "localhost" ||
    pageHost.endsWith(".localhost") ||
    pageHost.endsWith(".local") ||
    pageHost === "::1" ||
    pageHost.startsWith("127.") ||
    pageHost.startsWith("10.") ||
    pageHost.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(pageHost);

  if (!pageIsPrivate) {
    // Public page → same-origin ws (edge must forward /ws to the service).
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }

  // LAN/dev page → the baked (private) backend, gated like the REST client.
  if (!isRemoteBackendEnabled()) return null;
  try {
    const u = new URL(BACKEND_API_URL);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/ws";
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

export class NetClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Map<string, Set<(m: ServerMessage) => void>>();
  private readonly anyListeners = new Set<AnyHandler>();
  private statusListeners = new Set<(s: NetStatus) => void>();
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
   * callers use it to (re-)send `hello` / `session:hello`. Returns false when
   * networking is disabled for this origin (caller stays single-player).
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
    for (const h of [...this.anyListeners]) h(msg);
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

  /** Subscribe to every message (used for debug / catch-all routing). */
  onAny(handler: AnyHandler): () => void {
    this.anyListeners.add(handler);
    return () => this.anyListeners.delete(handler);
  }

  onStatus(handler: (s: NetStatus) => void): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
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
    if (this._status === s) return;
    this._status = s;
    for (const h of [...this.statusListeners]) h(s);
  }
}

/**
 * The process-wide client. One socket serves both the tavern and the dungeon —
 * the party you formed in the lobby is the party that drops together, so the
 * connection must survive the scene change.
 */
let shared: NetClient | null = null;
export function net(): NetClient {
  if (!shared) shared = new NetClient();
  return shared;
}
