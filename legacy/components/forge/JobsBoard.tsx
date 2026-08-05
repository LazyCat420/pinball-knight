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

const STATE_COLOR: Record<Job["state"], { fg: string; bg: string }> = {
  running: BLUE,
  done: GREEN,
  error: RED,
  cancelled: GREY,
};

function clipGuess(job: Job): string {
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
  onAddToTray,
  onKeep,
}: {
  id: string;
  job: Job;
  tick: number;
  onCancel: (id: string) => void;
  onReroll: (id: string, job: Job) => void;
  onUseAsInit: (src: string) => void;
  onAddToTray: (srcs: string[], clip: string) => void;
  onKeep: (id: string, job: Job) => void;
}) {
  const [clip, setClip] = useState(clipGuess(job));
  const [showPrompt, setShowPrompt] = useState(false);
  const c = STATE_COLOR[job.state] ?? GREY;
  const frames = (job.frames ?? []).map((f) => ({ name: f, src: `/api/comfy/generate?id=${id}&frame=${f}` }));
  const elapsed = job.startedAt ? Math.round((Date.now() - job.startedAt) / 1000) : null;
  const pct = job.progress && job.progress.max > 1 ? Math.round((job.progress.value / job.progress.max) * 100) : null;

  return (
    <div style={{ background: "#0d0f14", borderRadius: 4, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#e8e6df" }}>{job.label ?? job.mode}</span>
        <span style={S.chip(c.fg, c.bg)}>{job.state}</span>
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
        {job.state === "running" && (
          <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => onCancel(id)}>
            cancel
          </button>
        )}
        {job.state !== "running" && job.params && (
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.src} alt={f.name} style={{ width: 128, height: 128, objectFit: "contain", background: "#fff", borderRadius: 4 }} />
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
  onAddToTray,
  onKeep,
}: {
  jobs: Record<string, Job>;
  tick: number;
  onCancel: (id: string) => void;
  onReroll: (id: string, job: Job) => void;
  onUseAsInit: (src: string) => void;
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
        <span style={S.chip(GREY.fg, GREY.bg)}>{entries.filter(([, j]) => j.state === "running").length} running</span>
      </h2>
      {visible.map(([id, j]) => (
        <JobCard key={id} id={id} job={j} tick={tick} onCancel={onCancel} onReroll={onReroll} onUseAsInit={onUseAsInit} onAddToTray={onAddToTray} onKeep={onKeep} />
      ))}
      {entries.length > 6 && (
        <button style={{ ...S.btn, ...S.btnGhost, marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
          {showAll ? "show fewer" : `show all ${entries.length}`}
        </button>
      )}
    </div>
  );
}
