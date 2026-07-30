/**
 * One rule about canvases that become textures: PAINT BEFORE YOU UPLOAD.
 *
 * `document.createElement("canvas")` — and any later `canvas.width = n`, which
 * reallocates from scratch — leaves the element with correct dimensions and NO
 * backing store. The resource is created by the first paint operation. Bind such
 * a canvas as a texture before anything has drawn into it and WebGPU refuses the
 * upload:
 *
 *   CopyExternalImageToTexture(): Browser fails extracting valid resource from
 *   external image. This API call will return early.
 *
 * The consequence is mild — the texture keeps whatever it had (nothing) until
 * the next `needsUpdate`, and the first real paint fixes it — but it is a
 * console error indistinguishable from an upload that DID matter, and it fires
 * on a load-bearing path: two of this game's canvases are guaranteed to be bound
 * before they are painted. The damage-number pool's slot 0 is `warmupTarget()`,
 * handed to `compileAsync` by the descent-screen prewarm; the UI layer's canvas
 * is reallocated by `syncSize` and stays blank until a screen opens.
 */

/**
 * Allocate a canvas's backing store, leaving it fully transparent.
 *
 * The opaque pixel is not decoration. A transparent fill is a legal no-op and a
 * browser is free to elide it — eliding it leaves the canvas exactly as
 * resource-less as it started, which is the bug. So: paint something real, then
 * wipe the whole surface.
 *
 * Idempotent and cheap (one 1px fill plus one clear), so callers can use it
 * anywhere a canvas is created or resized without thinking about it. The
 * save/restore pair is load-bearing rather than tidy: `layer.ts` hands its
 * context out to every screen in the game, and silently leaving `fillStyle`
 * black behind us is the kind of change that shows up as one wrong-coloured
 * panel three files away.
 */
export function forceBackingStore(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 1, 1);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}
