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
