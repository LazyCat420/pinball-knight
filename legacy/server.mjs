/**
 * Custom production server: Next.js + the in-process multiplayer pool hub.
 *
 * WHY THIS EXISTS. The public edge proxies braindeadbot.com → this server
 * (:5174) and nothing else, and deploy-kit (the edge config) is read-only. So
 * the multiplayer hub lives HERE, in-process (`server/realtime.mjs`): the
 * browser connects same-origin to `/ws` — `wss://braindeadbot.com/ws` publicly,
 * `ws://10.0.0.16:5174/ws` on the LAN — and both land in the SAME pool. (An
 * earlier version tunneled /ws to braindeadbot-service, but that service is
 * LAN-bound and unreachable from inside this container; the in-process hub
 * removes the cross-container hop entirely.)
 *
 * The leaderboard takes the same shape for the same reason: `/api/scores` is
 * forwarded server-side to braindeadbot-service (see server/scores-proxy.mjs),
 * because the service's address is baked into the bundle as a LAN one and a
 * public visitor's browser cannot reach it. Every OTHER HTTP request is handled
 * by Next exactly as `next start` would.
 */
import { createServer } from "node:http";
import next from "next";
import { attachRealtime } from "./server/realtime.mjs";
import { proxyScores } from "./server/scores-proxy.mjs";

const port = parseInt(process.env.PORT || "5174", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

// `proxyScores` returns true when it has taken the request; anything it declines
// falls through to Next untouched. Ordered BEFORE `handle` deliberately — Next
// owns every other route and would answer /api/scores with the app shell (a 200
// full of HTML), which is exactly what a leaderboard fetch must not receive.
const server = createServer((req, res) => {
  if (proxyScores(req, res)) return;
  handle(req, res);
});

// Browser origins allowed to open the pool socket. Same-origin covers the
// normal cases; the list exists to reject hostile third-party pages embedding
// the endpoint. ALLOWED_ORIGINS (comma-separated) extends it without a rebuild.
const allowedOrigins = new Set(
  [
    "https://braindeadbot.com",
    "http://braindeadbot.com",
    "https://www.braindeadbot.com",
    "http://10.0.0.16:5174",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    ...(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()),
  ].filter(Boolean),
);

attachRealtime(server, { allowedOrigins });

server.listen(port, hostname, () => {
  console.log(`▲ braindeadbot-client on http://${hostname}:${port}  (multiplayer pool on /ws)`);
});
