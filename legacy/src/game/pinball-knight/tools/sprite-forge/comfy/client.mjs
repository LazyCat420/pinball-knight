/**
 * ComfyUI API client — the whole backend contract in one file.
 *
 * The server is ComfyUI running headless at ~/comfy (see README.md here).
 * Its native API is small and stable; this speaks it directly rather than
 * through an SDK, because the surface we use is six endpoints:
 *
 *   POST /prompt          submit an API-format graph, returns {prompt_id}
 *   GET  /history/{id}    per-prompt status + output filenames when done
 *   GET  /view            fetch an output image (raw PNG — never the lossy
 *                         webp preview; frames must be pixel-exact)
 *   POST /upload/image    push an init image into the server's input dir
 *   GET  /object_info     node schemas — used to FAIL LOUDLY when a node
 *                         class this driver builds is missing or renamed
 *   GET  /system_stats    liveness + VRAM
 *
 * Completion is polled via /history rather than the websocket: no extra
 * dependency, and a sprite job is seconds-to-minutes, so 500ms polling is
 * nothing. If a driver ever needs per-node progress, that is the one reason
 * to add the /ws client.
 */

const BASE = process.env.COMFY_URL ?? "http://127.0.0.1:8188";

export async function systemStats() {
  const r = await fetch(`${BASE}/system_stats`);
  if (!r.ok) throw new Error(`[comfy] ${BASE}/system_stats -> ${r.status}. Is the server up? Start it with ~/comfy/run.sh -d`);
  return r.json();
}

/**
 * Assert every node class the graph uses actually exists on the server.
 *
 * A renamed core node (it happens across ComfyUI releases) otherwise
 * surfaces as an opaque 400 from /prompt. This turns it into "node X is
 * missing — update graphs.mjs or the server" BEFORE anything is queued.
 */
export async function assertNodes(graph) {
  const r = await fetch(`${BASE}/object_info`);
  if (!r.ok) throw new Error(`[comfy] /object_info -> ${r.status}`);
  const known = await r.json();
  const missing = [...new Set(Object.values(graph).map((n) => n.class_type))].filter((c) => !known[c]);
  if (missing.length) {
    throw new Error(
      `[comfy] server is missing node class(es): ${missing.join(", ")}.\n` +
        `Core nodes: the ComfyUI checkout at ~/comfy/ComfyUI may be older/newer than this driver expects.\n` +
        `GGUF nodes: is custom_nodes/ComfyUI-GGUF installed and did the server start clean? Check ~/comfy/comfy.log`,
    );
  }
}

/** Upload an init image; returns the server-side name LoadImage expects. */
export async function uploadImage(path, name) {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  const fd = new FormData();
  fd.append("image", new Blob([buf], { type: "image/png" }), name);
  fd.append("overwrite", "true");
  const r = await fetch(`${BASE}/upload/image`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`[comfy] upload of ${path} failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

export async function queuePrompt(graph) {
  const r = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph }),
  });
  const j = await r.json();
  if (!r.ok || j.error) {
    // node_errors carries per-node validation detail — surface it whole.
    throw new Error(`[comfy] /prompt rejected the graph: ${JSON.stringify(j, null, 1)}`);
  }
  return j.prompt_id;
}

/**
 * Poll until the prompt leaves the queue, then return its history entry.
 * Throws with the server's own error payload on execution failure — a
 * failed sampler run must never be reported as "no outputs".
 */
export async function waitFor(promptId, { pollMs = 500, timeoutMs = 30 * 60_000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const r = await fetch(`${BASE}/history/${promptId}`);
    if (r.ok) {
      const h = (await r.json())[promptId];
      if (h) {
        const status = h.status?.status_str;
        if (status === "error") {
          const msgs = (h.status?.messages ?? []).filter(([k]) => k === "execution_error").map(([, v]) => v);
          throw new Error(`[comfy] execution failed:\n${JSON.stringify(msgs, null, 1)}`);
        }
        if (h.outputs && Object.keys(h.outputs).length) return h;
      }
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`[comfy] prompt ${promptId} still running after ${timeoutMs / 1000}s — interrupt with POST ${BASE}/interrupt`);
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

/** Every image a finished prompt produced, as {filename, subfolder, type}. */
export function outputImages(history) {
  return Object.values(history.outputs).flatMap((o) => o.images ?? []).filter((i) => i.type === "output");
}

/** Fetch one output image as a Buffer (raw PNG, no preview transcode). */
export async function fetchImage({ filename, subfolder, type }) {
  const q = new URLSearchParams({ filename, subfolder: subfolder ?? "", type: type ?? "output" });
  const r = await fetch(`${BASE}/view?${q}`);
  if (!r.ok) throw new Error(`[comfy] /view ${filename} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
