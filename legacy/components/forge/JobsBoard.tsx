"use client";

/**
 * Every generation this dev server knows about, newest first — live ones
 * with a progress bar and a cancel, finished ones with their frames and
 * the three actions that make iteration cheap:
 *
 *   ↻ re-roll        same job, new seed — for "right idea, wrong roll"
 *   → use as init    chain the output into the next generation (the
 *                    continuity move: each frame builds on the last)
 *   + add to sheet   pull frames into the tray under a clip name
 *
 * Job state comes from polling the generate route; the live preview image
 * is refetched only while the server says one exists.
 */
import React, { useState } from "react";
import { S, GREEN, RED, BLUE, AMBER, GREY } from "./theme";
import type { Job } from "./types";
import { CLIP_NAMES } from "./types";
import { FramePlayer } from "./FramePlayer";
import { RetryImg } from "./RetryImg";
import { postJSON, urlToB64 } from "./api";

/**
 * Cut a keyframe sheet into per-pose cells, client-side: the pipeline's
 * cut op finds the rects (the REAL slicer — same failure modes, same
 * fixes), the browser crops them onto white. Returned as data URLs so
 * every existing frame action (→ init, fetch, + sheet) works unchanged —
 * fetch() accepts data: URLs.
 *
 * ── EVERY CELL COMES OUT ON THE SAME CANVAS, AND THAT IS THE POINT ──────
 * A pose's bounding box is its own size (measured: 321×365, 267×437,
 * 288×410, 264×432 for one walk row). Cropped tight, each cell is a
 * different aspect ratio — and the first/last-frame video node stretches
 * whatever it is given to ONE square, so two tight crops arrive at two
 * different scales and the model dutifully interpolates between them.
 * That reads as a slow zoom-in across the clip, which is exactly what it
 * looked like.
 *
 * So cells are placed, never rescaled: one canvas sized to the widest and
 * tallest cell, figure centred horizontally, FEET ON A SHARED BASELINE —
 * the same registration rule the sprite importer uses (see the forge
 * README on scale and baselines). Identical canvas, identical scale, no
 * zoom for the model to invent.
 */
async function cutSheetToCells(frameSrc: string, clip: string): Promise<string[]> {
  const b64 = await urlToB64(frameSrc);
  const cut = await postJSON("/api/comfy/pipeline", { op: "cut", sheetB64: b64, sidecar: { rows: [clip || "idle"] } });
  const rects: number[][] = (cut.rows ?? []).flatMap((r: { cells: number[][] }) => r.cells);
  if (!rects.length) throw new Error(`cut found no cells${cut.warnings?.length ? ` — ${cut.warnings[0]}` : ""}`);
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    // An <img> error event is NOT an Error — rejecting with it raw is what
    // made this failure surface as the word "undefined".
    img.onerror = () => rej(new Error("the sheet did not decode in the browser"));
    // urlToB64 hands back a COMPLETE data: URL (FileReader.readAsDataURL),
    // so prefixing it again built "data:…;base64,data:…" and every cut died
    // on an unparseable image.
    img.src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  });
  // HEADROOM, proportional. Even with the scales matched, the video leg
  // grows the figure ~11% across a clip (measured), and a fixed 24px
  // margin let that growth crop the head. Margins scale with the figure:
  // generous above (growth reads as a push-in, so the head goes first),
  // wide enough at the sides for a full stride, tight under the feet so
  // the baseline stays where the importer expects it.
  const maxW = Math.max(...rects.map(([x0, , x1]) => x1 - x0));
  const maxH = Math.max(...rects.map(([, y0, , y1]) => y1 - y0));
  const padX = Math.ceil(maxW * 0.18);
  const padTop = Math.ceil(maxH * 0.2);
  const padBottom = Math.ceil(maxH * 0.06);
  const cw = maxW + padX * 2;
  const ch = maxH + padTop + padBottom;
  return rects.map(([x0, y0, x1, y1]) => {
    const w = x1 - x0;
    const h = y1 - y0;
    const cv = document.createElement("canvas");
    cv.width = cw;
    cv.height = ch;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    // 1:1 blit — centred, bottom-aligned to the shared baseline.
    ctx.drawImage(img, x0, y0, w, h, Math.round((cw - w) / 2), ch - padBottom - h, w, h);
    return cv.toDataURL("image/png");
  });
}

/** Pose text for cell i, recovered from the job's own resolved prompt. */
function poseLine(job: Job, i: number): string {
  const m = /left to right: (.*?)\. Large/.exec(job.resolvedPrompt ?? "");
  if (!m) return "";
  const parts = m[1].split(/\(\d\)\s*/).filter((s) => s.trim());
  return (parts[i] ?? "").replace(/,\s*$/, "").trim();
}

const STATE_COLOR: Record<Job["state"], { fg: string; bg: string }> = {
  queued: GREY,
  running: BLUE,
  done: GREEN,
  error: RED,
  cancelled: GREY,
};

/**
 * Which clip this job's frames belong to — or "" when nothing on the job says.
 *
 * ⚠️ THIS USED TO GUESS, AND THE GUESS WAS ALWAYS `walk`. An `animate` job
 * whose preset is `custom` carries clip "" by design (MOVESET's custom entry
 * declares no clip), and the old fallback turned that into `walk`. So a
 * custom-action death clip — a creature toppling over and lying still — came
 * up labelled "walk", and the label is not cosmetic: it is what the frames get
 * added to the sheet tray AS. A wrong row in the tray becomes a wrong row in
 * the sidecar becomes a wrong clip in the game.
 *
 * "" is the honest answer, and `` renders it as an explicit "— pick a clip —"
 * that blocks the add buttons until the operator chooses. A prompt is better
 * than a plausible guess, because the guess is invisible once it is wrong.
 */
function clipGuess(job: Job): string {
  // The preset's declared clip travels on the job (defend → crouch etc.);
  // reading the preset id is the fallback for pre-clip jobs already on disk.
  if (job.clip && (CLIP_NAMES as readonly string[]).includes(job.clip)) return job.clip;
  const p = String(job.params?.preset ?? "");
  if ((CLIP_NAMES as readonly string[]).includes(p)) return p;
  // A single-frame qwen leg (rotate/edit/cut-out) really is an idle pose —
  // that is what a master IS — so it keeps a default. Everything else asks.
  return job.mode === "animate" ? "" : "idle";
}

function JobCard({
  id,
  job,
  tick,
  onCancel,
  onReroll,
  onUseAsInit,
  onUseAsLast,
  onFixFrame,
  onRedoPose,
  onAddToTray,
  onKeep,
}: {
  id: string;
  job: Job;
  tick: number;
  onCancel: (id: string) => void;
  onReroll: (id: string, job: Job) => void;
  onUseAsInit: (src: string) => void;
  onUseAsLast: (src: string) => void;
  onFixFrame: (src: string) => void;
  onRedoPose: (src: string, pose: string) => void;
  onAddToTray: (srcs: string[], clip: string) => void;
  onKeep: (id: string, job: Job) => void;
}) {
  const [clip, setClip] = useState(clipGuess(job));
  const [showPrompt, setShowPrompt] = useState(false);
  /**
   * THE GUARD LIVES HERE, not on the buttons.
   *
   * Four different controls add frames to the tray — "add all", the frame
   * player's selection, the per-frame "+ sheet", and each cut cell. Disabling
   * one of them would leave three doors open, and the whole point is that an
   * unlabelled clip must not reach the tray at all.
   */
  const addToTray = (srcs: string[]) => {
    if (!clip) return;
    onAddToTray(srcs, clip);
  };
  /** Every add control wears the same reason when the clip is unset. */
  const addProps = clip
    ? {}
    : { disabled: true, title: "pick which clip these frames are — the tray files them under it" };
  const dimmed = clip ? {} : { opacity: 0.45, cursor: "not-allowed" };
  const [cells, setCells] = useState<string[] | null>(null);
  const [cutting, setCutting] = useState<string | null>(null);
  const c = STATE_COLOR[job.state] ?? GREY;
  const frames = (job.frames ?? []).map((f) => ({ name: f, src: `/api/comfy/generate?id=${id}&frame=${f}` }));
  const elapsed = job.startedAt ? Math.round((Date.now() - job.startedAt) / 1000) : null;
  const pct = job.progress && job.progress.max > 1 ? Math.round((job.progress.value / job.progress.max) * 100) : null;

  return (
    <div style={{ background: "#0d0f14", borderRadius: 4, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#e8e6df" }}>{job.label ?? job.mode}</span>
        <span style={S.chip(c.fg, c.bg)}>{job.state === "queued" ? `queued · waiting for ${job.leg ?? "gpu"}` : job.state}</span>
        {job.character && <span style={S.chip(AMBER.fg, AMBER.bg)}>{job.character}</span>}
        {job.fast && <span style={S.chip(AMBER.fg, AMBER.bg)}>fast</span>}
        {job.seed !== undefined && <span style={S.note}>seed {job.seed}</span>}
        {job.state === "running" && elapsed !== null && <span style={S.note}>{elapsed}s</span>}
        {job.state === "done" && job.tookS !== undefined && <span style={S.note}>{job.tookS}s</span>}
        <span style={{ flex: 1 }} />
        {job.resolvedPrompt && (
          <button style={{ ...S.btn, ...S.btnGhost }} onClick={() => setShowPrompt(!showPrompt)}>
            prompt
          </button>
        )}
        {(job.state === "running" || job.state === "queued") && (
          <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => onCancel(id)}>
            cancel
          </button>
        )}
        {job.state !== "running" && job.state !== "queued" && job.params && (
          <button style={S.btn} title="same settings, new seed" onClick={() => onReroll(id, job)}>
            ↻ re-roll
          </button>
        )}
        {job.state === "done" && (job.frames?.length ?? 0) > 0 && (
          <button
            style={S.btn}
            title="file these frames under the character's sources/ (tracked) — work/ is scratch"
            onClick={() => onKeep(id, job)}
          >
            ⭐ keep
          </button>
        )}
      </div>
      {showPrompt && <p style={{ ...S.note, whiteSpace: "pre-wrap" }}>{job.resolvedPrompt}</p>}
      {job.state === "running" && (
        <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
          {job.hasPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/comfy/generate?id=${id}&preview=1&t=${tick}`}
              alt="live preview"
              style={{ width: 96, height: 96, objectFit: "contain", background: "#fff", borderRadius: 4 }}
            />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ height: 6, background: "#171921", borderRadius: 3, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: pct !== null ? `${pct}%` : "18%",
                  background: BLUE.fg,
                  opacity: pct !== null ? 1 : 0.35,
                  transition: "width 0.5s",
                }}
              />
            </div>
            <p style={S.note}>
              {pct !== null ? `${pct}% — sampling` : "queued / loading models"}
              {job.progress?.node ? ` (${job.progress.node})` : ""}
            </p>
          </div>
        </div>
      )}
      {job.state === "error" && <p style={{ ...S.note, color: RED.fg, whiteSpace: "pre-wrap" }}>{job.error}</p>}
      {job.state === "done" && frames.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <span style={S.note}>as clip</span>
            <select
              style={{ ...S.input, width: 130, ...(clip ? {} : { borderColor: AMBER.fg, color: AMBER.fg }) }}
              value={clip}
              onChange={(e) => setClip(e.target.value)}
            >
              {/* Only offered while nothing is chosen — an unlabelled clip must
                  be a decision, not a state you can go back to by accident. */}
              {!clip && <option value="">— pick a clip —</option>}
              {CLIP_NAMES.map((c2) => (
                <option key={c2} value={c2}>
                  {c2}
                </option>
              ))}
            </select>
            {frames.length > 1 && (
              <button style={{ ...S.btn, ...dimmed }} {...addProps} onClick={() => addToTray(frames.map((f) => f.src))}>
                + add all {frames.length}
              </button>
            )}
          </div>
          {frames.length > 6 ? (
            <FramePlayer frames={frames} onAdd={addToTray} />
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              {frames.map((f) => (
                <div key={f.name}>
                  <RetryImg src={`${f.src}&w=256`} alt={f.name} style={{ width: 128, height: 128, objectFit: "contain", background: "#fff", borderRadius: 4 }} />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <button style={{ ...S.btn, fontSize: 11 }} title="chain: next generation starts from this frame" onClick={() => onUseAsInit(f.src)}>
                      → init
                    </button>
                    <button style={{ ...S.btn, fontSize: 11, ...dimmed }} {...addProps} onClick={() => addToTray([f.src])}>
                      + sheet
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {job.mode === "keyframes" && (
            <div style={{ marginTop: 8 }}>
              {!cells && (
                <button
                  style={{ ...S.btn, ...S.btnGreen }}
                  disabled={cutting !== null}
                  onClick={async () => {
                    setCutting("cutting…");
                    try {
                      setCells(await cutSheetToCells(frames[0].src, clip));
                    } catch (e: any) {
                      setCutting(null);
                      // Never surface a bare "undefined": not everything
                      // thrown in a browser is an Error.
                      return alert(`cut failed: ${e?.message ?? String(e)}`);
                    }
                    setCutting(null);
                  }}
                >
                  {cutting ?? "✂ cut into keyframes"}
                </button>
              )}
              {cells && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {cells.map((c2, i) => (
                    <div key={i} style={{ textAlign: "center" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c2} alt={`key ${i + 1}`} title={poseLine(job, i)} style={{ width: 104, height: 104, objectFit: "contain", background: "#fff", borderRadius: 4, imageRendering: "pixelated" }} />
                      <div style={{ display: "flex", gap: 3, marginTop: 3, justifyContent: "center", flexWrap: "wrap" }}>
                        <button style={{ ...S.btn, fontSize: 10, padding: "1px 5px" }} title="first frame of an in-between" onClick={() => onUseAsInit(c2)}>
                          → init
                        </button>
                        <button style={{ ...S.btn, fontSize: 10, padding: "1px 5px" }} title="LAST frame of an in-between — pins where the motion ends" onClick={() => onUseAsLast(c2)}>
                          → last
                        </button>
                        <button style={{ ...S.btn, fontSize: 10, padding: "1px 5px", ...dimmed }} {...addProps} onClick={() => addToTray([c2])}>
                          + sheet
                        </button>
                        <button style={{ ...S.btn, fontSize: 10, padding: "1px 5px" }} title="brush over the wrong part, regenerate only that" onClick={() => onFixFrame(c2)}>
                          ✎ fix
                        </button>
                        <button style={{ ...S.btn, fontSize: 10, padding: "1px 5px" }} title="re-render just this pose" onClick={() => onRedoPose(c2, poseLine(job, i))}>
                          ↻ pose
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function JobsBoard({
  jobs,
  tick,
  onCancel,
  onReroll,
  onUseAsInit,
  onUseAsLast,
  onFixFrame,
  onRedoPose,
  onAddToTray,
  onKeep,
}: {
  jobs: Record<string, Job>;
  tick: number;
  onCancel: (id: string) => void;
  onReroll: (id: string, job: Job) => void;
  onUseAsInit: (src: string) => void;
  onUseAsLast: (src: string) => void;
  onFixFrame: (src: string) => void;
  onRedoPose: (src: string, pose: string) => void;
  onAddToTray: (srcs: string[], clip: string) => void;
  onKeep: (id: string, job: Job) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const entries = Object.entries(jobs).sort((a, b) => (b[1].startedAt ?? 0) - (a[1].startedAt ?? 0));
  const visible = showAll ? entries : entries.slice(0, 6);
  if (!entries.length) return null;
  return (
    <div style={S.card}>
      <h2 style={S.cardTitle}>
        jobs
        <span style={S.chip(GREY.fg, GREY.bg)}>
          {entries.filter(([, j]) => j.state === "running").length} running ·{" "}
          {entries.filter(([, j]) => j.state === "queued").length} queued
        </span>
      </h2>
      {visible.map(([id, j]) => (
        <JobCard key={id} id={id} job={j} tick={tick} onCancel={onCancel} onReroll={onReroll} onUseAsInit={onUseAsInit} onUseAsLast={onUseAsLast} onFixFrame={onFixFrame} onRedoPose={onRedoPose} onAddToTray={onAddToTray} onKeep={onKeep} />
      ))}
      {entries.length > 6 && (
        <button style={{ ...S.btn, ...S.btnGhost, marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
          {showAll ? "show fewer" : `show all ${entries.length}`}
        </button>
      )}
    </div>
  );
}
