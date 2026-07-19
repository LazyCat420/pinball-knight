/**
 * API config — the single place the client learns where the backend lives.
 *
 * Every service module imports BACKEND_API_URL from here. Components must not
 * read NEXT_PUBLIC_BACKEND_URL directly or rebuild this string: the copies drift,
 * and a component that hand-rolls the base URL also tends to hand-roll the fetch,
 * the error handling and the response types along with it.
 */
export const BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5175";
