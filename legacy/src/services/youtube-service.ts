/**
 * YouTube Service — client-side wrapper for the backend's channel sync endpoint.
 *
 * Components call syncChannels() and get back a typed result. They do not build
 * URLs, do not call fetch, and do not cast the response to `any[]`.
 */

import { BACKEND_API_URL, isRemoteBackendEnabled } from "./api-config";

/**
 * Request/response shapes.
 *
 * These MIRROR the authoritative definitions in the backend repo at
 * braindeadbot-service/src/types/index.ts (ChannelRequest, RecordResult,
 * ResultObj). The contract is deliberately kept per-repo rather than extracted
 * into a shared package — the service stays authoritative for validation, and
 * this file only needs to describe what the client reads. If the server's
 * projection changes, update these to match it.
 */

/** Mirrors ChannelRequest in braindeadbot-service/src/types/index.ts. */
export interface ChannelRequest {
  channelId: string;
  artist?: string;
  maxResults?: number;
}

/** Mirrors RecordResult in braindeadbot-service/src/types/index.ts. */
export interface RecordResult {
  type: string;
  id: string;
  title: string;
  artist: string;
}

/** Mirrors ResultObj in braindeadbot-service/src/types/index.ts. */
export interface ResultObj {
  records: RecordResult[];
  syncedAt: string;
  errors?: string[];
}

/** Thrown when the server answers but rejects the request. Carries the status. */
export class YouTubeSyncError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "YouTubeSyncError";
    this.status = status;
  }
}

/**
 * Sync the given tracked channels via the backend's RSS fetcher.
 *
 * Resolves with the server's ResultObj. Rejects with a YouTubeSyncError on a
 * non-2xx (using the server's `error` field when it sends one), or with the
 * underlying error if the request never completed.
 */
export async function syncChannels(channels: ChannelRequest[]): Promise<ResultObj> {
  // Don't fire at a backend we can't reach from this origin (public site → LAN).
  if (!isRemoteBackendEnabled()) {
    throw new YouTubeSyncError("Backend not reachable from this origin", 0);
  }
  const response = await fetch(`${BACKEND_API_URL}/api/youtube-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channels }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new YouTubeSyncError(errorBody.error || `HTTP ${response.status}`, response.status);
  }

  const data = (await response.json()) as Partial<ResultObj>;
  return {
    records: data.records ?? [],
    syncedAt: data.syncedAt ?? new Date().toISOString(),
    errors: data.errors ?? [],
  };
}
