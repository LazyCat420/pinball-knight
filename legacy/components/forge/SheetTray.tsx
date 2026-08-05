"use client";

/**
 * Frames → a sheet the inbox will accept, without leaving the browser.
 *
 * The tray collects frames under clip names; assembly draws them onto a
 * white field (the matte keys white from the border), one row per clip,
 * uniform cells, feet on a shared baseline — the three things README.md
 * says a sheet MUST be. From there the real pipeline takes over via the
 * pipeline route: auto-cut runs the SAME matte→slice→label the import
 * uses and overlays the rects it found; crush runs the SAME k-centroid
 * reduce + palette snap that will ship. What you see here is what
 * `npm run sprites` will do — same code, earlier.
 *
 * Staging writes inbox/<name>.png + sidecar — TRACKED files, the
 * sanctioned import edge. Publishing stays `npm run sprites` on purpose:
 * the publisher is a vitest edge and tests must never run from a route.
 */
import React, { useMemo, useState } from "react";
import { S, GREEN, RED, AMBER, BLUE } from "./theme";
import type { CrushResult, CutResult, TrayFrame } from "./types";
import { CLIP_NAMES } from "./types";
import { postJSON } from "./api";

const ROW_COLORS = ["#8fdd9f", "#9fd0ff", "#ffd9a0", "#dd8f8f", "#c89fff", "#8fdada", "#dad98f", "#ff9fd0"];

/** Draw the tray onto a white sheet: row per clip, uniform cells, baseline feet. */
async function assemble(tray: TrayFrame[], order: string[]): Promise<{ b64: string; w: number; h: number }> {
  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all(
    tray.map(
      (f) =>
        new Promise<void>((res, rej) => {
          const im = new Image();
          im.onload = () => {
            imgs.set(f.key, im);
            res();
          };
          im.onerror = () => rej(new Error(`could not load ${f.src}`));
          im.src = f.src;
        }),
    ),
  );
  const pad = 12;
  const cellW = Math.max(...tray.map((f) => imgs.get(f.key)!.naturalWidth)) + pad * 2;
  const cellH = Math.max(...tray.map((f) => imgs.get(f.key)!.naturalHeight)) + pad * 2;
  const rows = order.map((clip) => tray.filter((f) => f.clip === clip)).filter((r) => r.length);
  const cols = Math.max(...rows.map((r) => r.length));
  const cv = document.createElement("canvas");
  cv.width = cellW * cols;
  cv.height = cellH * rows.length;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  rows.forEach((row, ri) => {
    row.forEach((f, ci) => {
      const im = imgs.get(f.key)!;
      // Bottom-centered: frames register by bounding box downstream, and a
      // shared feet line is what keeps a walk from bobbing.
      const x = ci * cellW + (cellW - im.naturalWidth) / 2;
      const y = ri * cellH + (cellH - pad - im.naturalHeight);
      ctx.drawImage(im, x, y);
    });
  });
  return { b64: cv.toDataURL("image/png"), w: cv.width, h: cv.height };
}

export function SheetTray({
  tray,
  setTray,
  say,
  suggestedName = "",
  onStaged,
}: {
  tray: TrayFrame[];
  setTray: (t: TrayFrame[]) => void;
  say: (s: string) => void;
  /** Prefill from the library's active character, e.g. "frog-E". */
  suggestedName?: string;
  onStaged?: () => void;
}) {
  const [sheet, setSheet] = useState<{ b64: string; w: number; h: number } | null>(null);
  const [cut, setCut] = useState<CutResult | null>(null);
  const [crush, setCrush] = useState<CrushResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState(suggestedName);
  const [staged, setStaged] = useState<string | null>(null);
  const suggestedRef = React.useRef(suggestedName);
  if (suggestedRef.current !== suggestedName) {
    // A character change re-suggests only while the field is untouched or
    // still holding the previous suggestion — typed names are never clobbered.
    if (name === "" || name === suggestedRef.current) setName(suggestedName);
    suggestedRef.current = suggestedName;
  }

  const rowsInUse = useMemo(() => (CLIP_NAMES as readonly string[]).filter((c) => tray.some((f) => f.clip === c)), [tray]);

  /**
   * THE CRUSH KNOBS, reachable at last.
   *
   * The sidecar used to be hardcoded to `{ rows }`, which quietly made the
   * three decisions that matter most unavailable: whether the sheet gets its
   * OWN palette, how a source pixel becomes a texel, and how hard the matte
   * keys. Measured on the frog (2026-08-05), `derive: 20` moved it from 32
   * shared entries to 20 of its own, isolated texels 24.8% → 16.4%, and the
   * verdict from "resampled" to "imports 1:1 at atlas grid >= 84" — the
   * difference between a muddy frog and a crisp one.
   *
   * Defaults match what the pipeline does without a sidecar, so the controls
   * change nothing until touched.
   */
  const [derive, setDerive] = useState(20);
  const [mode, setMode] = useState<"vote" | "synth" | "native">("vote");
  const [matteTol, setMatteTol] = useState<number | "">("");
  const sidecar = useMemo(() => {
    const commit: Record<string, unknown> = {};
    if (derive > 0) commit.derive = derive;
    if (mode !== "vote") commit.mode = mode;
    return {
      rows: rowsInUse,
      ...(Object.keys(commit).length ? { commit } : {}),
      ...(matteTol === "" ? {} : { matte: { tolerance: Number(matteTol) } }),
    };
  }, [rowsInUse, derive, mode, matteTol]);
  const stale = "regenerate the sheet after changing the tray";

  const move = (key: string, delta: number) => {
    const i = tray.findIndex((f) => f.key === key);
    const f = tray[i];
    const siblings = tray.filter((x) => x.clip === f.clip);
    const si = siblings.findIndex((x) => x.key === key);
    const ti = si + delta;
    if (ti < 0 || ti >= siblings.length) return;
    const next = tray.filter((x) => x.clip !== f.clip);
    siblings.splice(si, 1);
    siblings.splice(ti, 0, f);
    setTray([...next, ...siblings]);
    setSheet(null);
    setCut(null);
    setCrush(null);
  };

  const doAssemble = async () => {
    setBusy("assemble");
    try {
      if (!tray.some((f) => f.clip === "idle")) say("no idle row yet — a sheet without idle never draws in-game");
      setSheet(await assemble(tray, CLIP_NAMES as unknown as string[]));
      setCut(null);
      setCrush(null);
      setStaged(null);
    } catch (e: any) {
      say(e.message);
    } finally {
      setBusy(null);
    }
  };

  const doCut = async () => {
    setBusy("cut");
    try {
      setCut(await postJSON("/api/comfy/pipeline", { op: "cut", sheetB64: sheet!.b64, sidecar }));
    } catch (e: any) {
      say(e.message);
    } finally {
      setBusy(null);
    }
  };

  const doCrush = async () => {
    setBusy("crush");
    try {
      setCrush(await postJSON("/api/comfy/pipeline", { op: "crush", sheetB64: sheet!.b64, sidecar }));
    } catch (e: any) {
      say(e.message);
    } finally {
      setBusy(null);
    }
  };

  const doStage = async (overwrite = false) => {
    setBusy("stage");
    try {
      const r = await postJSON("/api/comfy/pipeline", { op: "stage", name, sheetB64: sheet!.b64, sidecar, overwrite });
      setStaged(r.pngPath);
      say(`staged — now run: npm run sprites`);
      onStaged?.();
    } catch (e: any) {
      if (String(e.message).includes("exists") && !overwrite) {
        if (window.confirm(`${name} already exists in the inbox — overwrite it?`)) return doStage(true);
      } else {
        say(e.message);
      }
    } finally {
      setBusy(null);
    }
  };

  if (!tray.length) {
    return (
      <div style={S.card}>
        <h2 style={S.cardTitle}>sheet</h2>
        <p style={S.note}>
          empty — generate frames above and press &ldquo;+ sheet&rdquo; on the keepers. Rows group by clip name; the game
          needs at least an idle row (stagger is <b>stumble</b>, never hurt).
        </p>
      </div>
    );
  }

  const scale = sheet ? Math.min(1, 900 / sheet.w) : 1;

  return (
    <div style={S.card}>
      <h2 style={S.cardTitle}>
        sheet
        <span style={S.chip(BLUE.fg, BLUE.bg)}>{tray.length} frame(s)</span>
        <button style={{ ...S.btn, ...S.btnGhost, marginLeft: 8, fontSize: 11 }} onClick={() => { setTray([]); setSheet(null); setCut(null); setCrush(null); }}>
          clear
        </button>
      </h2>
      {rowsInUse.map((clip) => (
        <div key={clip} style={{ marginTop: 6 }}>
          <span style={S.note}>{clip}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
            {tray
              .filter((f) => f.clip === clip)
              .map((f, i, row) => (
                <div key={f.key} style={{ textAlign: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.src} alt={f.clip} style={{ width: 72, height: 72, objectFit: "contain", background: "#fff", borderRadius: 3 }} />
                  <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                    <button style={{ ...S.btn, ...S.btnGhost, fontSize: 10, padding: "0 4px" }} disabled={i === 0} onClick={() => move(f.key, -1)}>
                      ←
                    </button>
                    <select
                      style={{ ...S.input, width: 66, fontSize: 10, padding: "1px 2px" }}
                      value={f.clip}
                      onChange={(e) => {
                        setTray(tray.map((x) => (x.key === f.key ? { ...x, clip: e.target.value } : x)));
                        setSheet(null);
                      }}
                    >
                      {CLIP_NAMES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button style={{ ...S.btn, ...S.btnGhost, fontSize: 10, padding: "0 4px" }} disabled={i === row.length - 1} onClick={() => move(f.key, 1)}>
                      →
                    </button>
                    <button style={{ ...S.btn, ...S.btnGhost, fontSize: 10, padding: "0 4px" }} onClick={() => { setTray(tray.filter((x) => x.key !== f.key)); setSheet(null); }}>
                      ×
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center", padding: "8px 10px", background: "#0d0f14", borderRadius: 4 }}>
        <span style={S.note}>crush</span>
        <label style={{ ...S.note, display: "flex", alignItems: "center", gap: 4 }} title="give this sheet its OWN palette of N entries instead of spending N of the shared 32 — measured: keeps a creature's colours and can win a 1:1 import">
          own palette
          <select style={{ ...S.input, width: 92 }} value={derive} onChange={(e) => { setDerive(Number(e.target.value)); setCrush(null); }}>
            <option value={0}>shared 32</option>
            <option value={16}>16 entries</option>
            <option value={20}>20 entries</option>
            <option value={24}>24 entries</option>
          </select>
        </label>
        <label style={{ ...S.note, display: "flex", alignItems: "center", gap: 4 }} title="vote = k-centroid (default) · synth = decide regions first, flat fill + outline (for mosaic-ish art) · native = one source pixel IS one texel (throws rather than shrinking)">
          reduce
          <select style={{ ...S.input, width: 88 }} value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setCrush(null); }}>
            <option value="vote">vote</option>
            <option value="synth">synth</option>
            <option value="native">native</option>
          </select>
        </label>
        <label style={{ ...S.note, display: "flex", alignItems: "center", gap: 4 }} title="how far from the border colour still counts as background — raise it when the cut report says the background could not be keyed">
          matte tol
          <input
            style={{ ...S.input, width: 62 }}
            placeholder="40"
            value={matteTol}
            onChange={(e) => { const v = e.target.value; setMatteTol(v === "" ? "" : Number(v)); setCut(null); setCrush(null); }}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button style={{ ...S.btn, ...S.btnGreen }} disabled={busy !== null} onClick={doAssemble}>
          {busy === "assemble" ? "assembling…" : sheet ? "re-assemble sheet" : "assemble sheet"}
        </button>
        {sheet && (
          <>
            <button style={S.btn} disabled={busy !== null} title="run the real matte + slicer and show what it finds" onClick={doCut}>
              {busy === "cut" ? "cutting…" : "auto-cut check"}
            </button>
            <button style={S.btn} disabled={busy !== null} title="the real k-centroid reduce + palette snap, at atlas size" onClick={doCrush}>
              {busy === "crush" ? "crushing…" : "crush preview"}
            </button>
          </>
        )}
      </div>
      {sheet && (
        <div style={{ marginTop: 10, position: "relative", width: sheet.w * scale, maxWidth: "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sheet.b64} alt="assembled sheet" style={{ width: "100%", borderRadius: 4 }} />
          {cut?.rows && (
            <svg
              viewBox={`0 0 ${sheet.w} ${sheet.h}`}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            >
              {cut.rows.flatMap((row, ri) =>
                row.cells.map((c, ci) => (
                  <rect
                    key={`${ri}-${ci}`}
                    x={c[0]}
                    y={c[1]}
                    width={c[2] - c[0]}
                    height={c[3] - c[1]}
                    fill="none"
                    stroke={ROW_COLORS[ri % ROW_COLORS.length]}
                    strokeWidth={Math.max(2, 2 / scale)}
                  />
                )),
              )}
            </svg>
          )}
        </div>
      )}
      {cut && (
        <div style={{ marginTop: 8 }}>
          <p style={S.note}>
            slicer found {cut.slicedRows} row(s):{" "}
            {cut.rows.map((r, i) => (
              <span key={i} style={{ color: ROW_COLORS[i % ROW_COLORS.length] }}>
                {r.clip} ×{r.cells.length}{" "}
              </span>
            ))}
            {cut.matte && ` · matte left ${cut.matte.pockets} enclosed pocket(s)`}
          </p>
          {cut.warnings.map((w) => (
            <p key={w} style={{ ...S.note, color: AMBER.fg }}>
              ⚠ {w}
            </p>
          ))}
        </div>
      )}
      {crush && (
        <div style={{ marginTop: 10 }}>
          <p style={S.note}>crushed at atlas size — this is what will ship, not a smooth preview:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${crush.previewB64}`} alt="crush preview" style={{ maxWidth: "100%", borderRadius: 4, imageRendering: "pixelated", marginTop: 6 }} />
          <pre style={{ ...S.note, whiteSpace: "pre-wrap", background: "#0d0f14", padding: 8, borderRadius: 4, marginTop: 6 }}>{crush.report}</pre>
        </div>
      )}
      {sheet && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            style={{ ...S.input, width: 220 }}
            value={name}
            placeholder="name, e.g. ratking-E"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            style={{ ...S.btn, ...(staged ? {} : S.btnGreen) }}
            disabled={busy !== null || !/^[a-z0-9_]+(-[ENS])?$/.test(name)}
            title="writes inbox/<name>.png + sidecar — tracked files, the sanctioned import edge"
            onClick={() => doStage()}
          >
            {busy === "stage" ? "staging…" : "stage to inbox"}
          </button>
          {staged && (
            <span style={S.chip(GREEN.fg, GREEN.bg)}>
              staged — run `npm run sprites` to publish
            </span>
          )}
          {cut && sheet && cut.warnings.length > 0 && <span style={S.chip(RED.fg, RED.bg)}>fix the cut warnings first</span>}
        </div>
      )}
    </div>
  );
}
