/**
 * API config — the single place the client learns where the backend lives.
 *
 * Every service module imports BACKEND_API_URL from here. Components must not
 * read NEXT_PUBLIC_BACKEND_URL directly or rebuild this string: the copies drift,
 * and a component that hand-rolls the base URL also tends to hand-roll the fetch,
 * the error handling and the response types along with it.
 *
 * NEXT_PUBLIC_BACKEND_URL is inlined at BUILD time. next.config.js resolves it
 * (build ARG → vault `defaultHost` → 10.0.0.16) and declares it under `env`, so
 * it is always defined in a real build. The `||` below only covers exotic cases
 * like a bare unit test importing this module with no Next build around it —
 * it is deliberately NOT the production path. A localhost default that reaches
 * production points every visitor's browser at their own machine.
 */
export const BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5175";

/**
 * True for a loopback / private-LAN / .local hostname — an address that is only
 * reachable from the same machine or the same private network, never from a
 * visitor out on the public internet.
 */
function isPrivateHost(hostname: string): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h === "::1" ||
    h.startsWith("127.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function backendHost(): string {
  try {
    return new URL(BACKEND_API_URL).hostname;
  } catch {
    return "";
  }
}

/**
 * Whether the client should actually talk to the backend, or skip the request
 * and let each caller fall back to localStorage.
 *
 * The backend URL is baked in at build time and, in the current deploy, points
 * at a private NAS address (10.0.0.16:5175 / localhost). That is fine when the
 * page is ALSO served from the LAN (the owner playing on the local network, or
 * dev) — the box is right there. But when a visitor loads the deployed PUBLIC
 * site, their browser would be told to reach into their own local network, so
 * every leaderboard read/write fires off a doomed request that shows up as a
 * failed "connecting to localhost" attempt in the console/network tab.
 *
 * So: a public backend URL is always allowed; a private one is allowed ONLY
 * when the page itself is being served from a private origin. Otherwise we go
 * offline-only and there are no stray local-network connections at all.
 */
export function isRemoteBackendEnabled(): boolean {
  // No browser (SSR / build / bare unit test) — never reach out.
  if (typeof window === "undefined") return false;
  const beHost = backendHost();
  // A real, public backend is always safe to call.
  if (beHost && !isPrivateHost(beHost)) return true;
  // Private/loopback backend: only when we're on the LAN/dev origin too.
  return isPrivateHost(window.location.hostname);
}
