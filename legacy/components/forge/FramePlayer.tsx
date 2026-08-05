"use client";

/**
 * Scrub a returned motion clip and pick the frames worth keeping.
 *
 * A Wan run returns 17-33 frames of 16fps motion; a sprite clip wants 3-8
 * with big readable pose deltas. So the player exists to LOOK, and the
 * stride + checkboxes exist to CHOOSE — the selection flows into the sheet
 * tray, everything else stays on disk.
 */
import React, { useEffect, useRef, useState } from "react";
import { S, BLUE } from "./theme";
import { RetryImg } from "./RetryImg";

export function FramePlayer({
  frames,
  onAdd,
}: {
  frames: { name: string; src: string }[];
  onAdd: (srcs: string[]) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stride, setStride] = useState(1);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (playing) {
      timer.current = setInterval(() => setIdx((i) => (i + 1) % frames.length), 1000 / 12);
    } else if (timer.current) {
      clearInterval(timer.current);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, frames.length]);

  const strided = frames.map((_, i) => i).filter((i) => i % stride === 0);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frames[idx] ? `${frames[idx].src}&w=384` : undefined}
            alt={`frame ${idx}`}
            style={{ width: 192, height: 192, objectFit: "contain", background: "#fff", borderRadius: 4 }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
            <button style={S.btn} onClick={() => setPlaying(!playing)}>
              {playing ? "pause" : "play"}
            </button>
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={idx}
              style={{ flex: 1 }}
              onChange={(e) => {
                setPlaying(false);
                setIdx(+e.target.value);
              }}
            />
            <span style={S.note}>
              {idx + 1}/{frames.length}
            </span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 320 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={S.note}>keep every</span>
            {[1, 2, 3, 4].map((n) => (
              <button key={n} style={{ ...S.btn, ...(stride === n ? S.btnGreen : {}) }} onClick={() => setStride(n)}>
                {n === 1 ? "all" : `${n}th`}
              </button>
            ))}
            <button
              style={S.btn}
              onClick={() => setSel(new Set(strided))}
              title="select the strided frames below"
            >
              select these
            </button>
            {sel.size > 0 && (
              <button
                style={{ ...S.btn, ...S.btnGreen }}
                onClick={() => {
                  onAdd([...sel].sort((a, b) => a - b).map((i) => frames[i].src));
                  setSel(new Set());
                }}
              >
                add {sel.size} to sheet →
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {frames.map((f, i) => {
              const dim = stride > 1 && i % stride !== 0;
              const on = sel.has(i);
              return (
                <button
                  key={f.name}
                  onClick={() => {
                    const next = new Set(sel);
                    if (on) next.delete(i);
                    else next.add(i);
                    setSel(next);
                    setPlaying(false);
                    setIdx(i);
                  }}
                  title={f.name}
                  style={{
                    padding: 0,
                    border: on ? `2px solid ${BLUE.fg}` : "2px solid transparent",
                    borderRadius: 4,
                    background: "none",
                    cursor: "pointer",
                    opacity: dim ? 0.35 : 1,
                  }}
                >
                  <RetryImg src={`${f.src}&w=112`} alt={f.name} style={{ width: 56, height: 56, objectFit: "contain", background: "#fff", borderRadius: 2, display: "block" }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
