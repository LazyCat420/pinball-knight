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
 */
async function cutSheetToCells(frameSrc: string, clip: string): Promise<string[]> {
  const b64 = await urlToB64(frameSrc);
  const cut = await postJSON("/api/comfy/pipeline", { op: "cut", sheetB64: b64, sidecar: { rows: [clip || "idle"] } });
  const rects: number[][] = (cut.rows ?? []).flatMap((r: { cells: number[][] }) => r.cells);
  if (!rects.length) throw new Error(`cut found no cells${cut.warnings?.length ? ` — ${cut.warnings[0]}` : ""}`);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = `data:image/png;base64,${b64}`;
  });
  const PAD = 12;
  return rects.map(([x0, y0, x1, y1]) => {
    const cv = document.createElement("canvas");
    cv.width = x1 - x0 + PAD * 2;
    cv.height = y1 - y0 + PAD * 2;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, PAD, PAD, x1 - x0, y1 - y0);
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

function clipGuess(job: Job): string {
  // The preset's declared clip travels on the job (defend → crouch etc.);
  // guessing from the preset id is the fallback for pre-clip jobs on disk.
  if (job.clip && (CLIP_NAMES as readonly string[]).includes(job.clip)) return job.clip;
  if (job.mode === "animate") {
    const p = String(job.params?.preset ?? "");
    return (CLIP_NAMES as readonly string[]).includes(p) ? p : "walk";
  }
  return "idle";
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
            <select style={{ ...S.input, width: 110 }} value={clip} onChange={(e) => setClip(e.target.value)}>
              {CLIP_NAMES.map((c2) => (
                <option key={c2} value={c2}>
                  {c2}
                </option>
              ))}
            </select>
            {frames.length > 1 && (
              <button style={S.btn} onClick={() => onAddToTray(frames.map((f) => f.src), clip)}>
                + add all {frames.length}
              </button>
            )}
          </div>
          {frames.length > 6 ? (
            <FramePlayer frames={frames} onAdd={(srcs) => onAddToTray(srcs, clip)} />
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              {frames.map((f) => (
                <div key={f.name}>
                  <RetryImg src={`${f.src}&w=256`} alt={f.name} style={{ width: 128, height: 128, objectFit: "contain", background: "#fff", borderRadius: 4 }} />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <button style={{ ...S.btn, fontSize: 11 }} title="chain: next generation starts from this frame" onClick={() => onUseAsInit(f.src)}>
                      → init
                    </button>
                    <button style={{ ...S.btn, fontSize: 11 }} onClick={() => onAddToTray([f.src], clip)}>
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
                      return alert(e.message);
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
                        <button style={{ ...S.btn, fontSize: 10, padding: "1px 5px" }} onClick={() => onAddToTray([c2], clip)}>
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
