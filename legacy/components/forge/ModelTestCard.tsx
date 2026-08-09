"use client";

import React, { useState } from "react";
import { S, GREEN, AMBER } from "./theme";
import type { Mode } from "./types";
import { fileToB64 } from "./api";
import type { SlotId } from "./GenerateCard";

function ImageSlot({
  label,
  b64,
  hint,
  onSet,
  onClear,
}: {
  label: string;
  b64: string | null;
  hint?: string;
  onSet: (b64: string) => void;
  onClear: () => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onSet(await fileToB64(f));
      }}
      style={{ textAlign: "center" }}
    >
      <label
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 116,
          height: 116,
          borderRadius: 4,
          cursor: "pointer",
          border: `1px dashed ${drag ? "#8fdd9f" : "#2c303b"}`,
          ...(b64 ? {} : { background: "#0d0f14" }),
        }}
      >
        {b64 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={b64}
            alt={label}
            style={{ width: 112, height: 112, objectFit: "contain", background: "#fff", borderRadius: 3, imageRendering: "pixelated" }}
          />
        ) : (
          <span style={{ ...S.note, padding: 6, textAlign: "center" }}>
            {label}
            <br />
            <span style={{ ...S.btn, display: "inline-block", marginTop: 6, pointerEvents: "none" }}>browse…</span>
            <br />
            <span style={{ fontSize: 11 }}>{hint ?? "or drop image here"}</span>
          </span>
        )}
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onSet(await fileToB64(f));
            e.target.value = "";
          }}
        />
      </label>
      {b64 && (
        <button type="button" onClick={onClear} style={{ ...S.btn, ...S.btnGhost, fontSize: 11, marginTop: 4 }}>
          clear
        </button>
      )}
    </div>
  );
}

export function ModelTestCard({
  modes,
  images,
  onSetImage,
  onClearImage,
  onGenerate,
  busy,
  activeCharacter,
}: {
  modes: Mode[];
  images: Record<SlotId, string | null>;
  onSetImage: (slot: SlotId, b64: string) => void;
  onClearImage: (slot: SlotId) => void;
  onGenerate: (req: { mode: string; params: Record<string, string>; prompt?: string; seed?: number; small?: boolean }) => Promise<void>;
  busy: boolean;
  activeCharacter: string | null;
}) {
  const [modelChoice, setModelChoice] = useState<"h3" | "wan" | "wan5b">("h3");
  const [preset, setPreset] = useState("walk");
  const [actionText, setActionText] = useState("");
  const [frames, setFrames] = useState("5");
  const [tiled, setTiled] = useState(false);
  const [tileSize, setTileSize] = useState(512);
  const [seed, setSeed] = useState<number | "">("");
  const [promptOverride, setPromptOverride] = useState("");

  const handleRunSingle = async () => {
    if (!images.init) return;
    const modeId = modelChoice === "h3" ? "h3" : "animate";
    const params: Record<string, string> = {
      preset,
      action: actionText,
      frames,
      tiled: tiled ? "true" : "false",
      tileSize: String(tileSize),
    };

    await onGenerate({
      mode: modeId,
      params,
      prompt: promptOverride.trim() || undefined,
      seed: typeof seed === "number" ? seed : undefined,
      small: modelChoice === "wan5b",
    });
  };

  const handleRunCompare = async () => {
    if (!images.init) return;
    const testSeed = typeof seed === "number" ? seed : Math.floor(Math.random() * 1e6);
    
    // 1. Run H3
    await onGenerate({
      mode: "h3",
      params: { preset, action: actionText, frames: "5", tiled: "false" },
      seed: testSeed,
    });

    // 2. Run Wan 2.2
    await onGenerate({
      mode: "animate",
      params: { preset, action: actionText, frames: "21" },
      seed: testSeed,
    });
  };

  return (
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "#fff" }}>
          🧪 model test & benchmarking lab
          {activeCharacter && <span style={S.chip(GREEN.fg, GREEN.bg)}>character: {activeCharacter}</span>}
        </h3>
        <span style={S.note}>compare execution speed, memory peak, and output quality across model engines</span>
      </div>

      {/* Model Selection Row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, background: "#11141c", padding: 12, borderRadius: 4 }}>
        <span style={{ fontSize: 13, fontWeight: "bold", color: "#ccc", alignSelf: "center" }}>model engine:</span>
        
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="radio"
            name="modelChoice"
            checked={modelChoice === "h3"}
            onChange={() => {
              setModelChoice("h3");
              setFrames("5");
            }}
          />
          <span style={{ color: modelChoice === "h3" ? GREEN.fg : "#aaa", fontWeight: "bold" }}>
            MiniMax H3 (FL2VA Q3_K_M)
          </span>
          <span style={{ fontSize: 11, color: "#666" }}>~11.6s fast 5f</span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="radio"
            name="modelChoice"
            checked={modelChoice === "wan"}
            onChange={() => {
              setModelChoice("wan");
              setFrames("21");
            }}
          />
          <span style={{ color: modelChoice === "wan" ? GREEN.fg : "#aaa", fontWeight: "bold" }}>
            Wan 2.2 I2V-A14B (2x Experts)
          </span>
          <span style={{ fontSize: 11, color: "#666" }}>~390s full grid</span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="radio"
            name="modelChoice"
            checked={modelChoice === "wan5b"}
            onChange={() => {
              setModelChoice("wan5b");
              setFrames("21");
            }}
          />
          <span style={{ color: modelChoice === "wan5b" ? GREEN.fg : "#aaa", fontWeight: "bold" }}>
            Wan 2.2 TI2V-5B (Fast Small)
          </span>
        </label>
      </div>

      {/* Inputs & Parameters Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20 }}>
        {/* Init & End Frames */}
        <div style={{ display: "flex", gap: 12 }}>
          <ImageSlot
            label="init frame"
            b64={images.init}
            hint="start artwork"
            onSet={(b64) => onSetImage("init", b64)}
            onClear={() => onClearImage("init")}
          />
          <ImageSlot
            label="end frame"
            b64={images.end}
            hint="optional end pin"
            onSet={(b64) => onSetImage("end", b64)}
            onClear={() => onClearImage("end")}
          />
        </div>

        {/* Form Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ width: 80, fontSize: 13, color: "#aaa" }}>action:</span>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              style={S.input}
            >
              <option value="walk">walk (side view)</option>
              <option value="attack">attack (lunge)</option>
              <option value="stumble">stumble (hurt)</option>
              <option value="death">death (collapse)</option>
              <option value="run">run (sprint)</option>
              <option value="idle">idle (breathing)</option>
              <option value="custom">custom action</option>
            </select>
            <input
              type="text"
              placeholder="describe move (e.g. jumping, biting)"
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              style={{ ...S.input, flex: 1 }}
            />
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ width: 80, fontSize: 13, color: "#aaa" }}>frames:</span>
            <select
              value={frames}
              onChange={(e) => setFrames(e.target.value)}
              style={S.input}
            >
              <option value="5">5 frames (fast MiniMax H3 grid)</option>
              <option value="21">21 frames (standard Wan grid)</option>
            </select>
          </div>

          {/* VAE Decode Controls */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", background: "#11141c", padding: 8, borderRadius: 4 }}>
            <span style={{ width: 80, fontSize: 13, color: "#aaa" }}>vae decode:</span>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12, color: "#ccc" }}>
              <input type="radio" name="tiled" checked={!tiled} onChange={() => setTiled(false)} />
              Standard (VAEDecode)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12, color: "#ccc" }}>
              <input type="radio" name="tiled" checked={tiled} onChange={() => setTiled(true)} />
              Tiled (VAEDecodeTiled)
            </label>
            {tiled && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12 }}>
                <span style={{ fontSize: 11, color: "#888" }}>tile size: {tileSize}px</span>
                <input
                  type="range"
                  min="256"
                  max="1024"
                  step="128"
                  value={tileSize}
                  onChange={(e) => setTileSize(Number(e.target.value))}
                />
              </div>
            )}
          </div>

          {/* Seed Input */}
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ width: 80, fontSize: 13, color: "#aaa" }}>seed:</span>
            <input
              type="number"
              placeholder="random seed"
              value={seed}
              onChange={(e) => setSeed(e.target.value === "" ? "" : Number(e.target.value))}
              style={{ ...S.input, width: 120 }}
            />
            <button
              type="button"
              onClick={() => setSeed(Math.floor(Math.random() * 1e6))}
              style={S.btn}
            >
              randomize 🎲
            </button>
          </div>

          {/* Prompt Override */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ width: 80, fontSize: 13, color: "#aaa", paddingTop: 4 }}>prompt:</span>
            <input
              type="text"
              placeholder="custom prompt override (optional)"
              value={promptOverride}
              onChange={(e) => setPromptOverride(e.target.value)}
              style={{ ...S.input, flex: 1 }}
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 12, marginTop: 16, paddingTop: 12, borderTop: "1px solid #1a1d26" }}>
        <button
          type="button"
          onClick={handleRunSingle}
          disabled={!images.init || busy}
          style={{
            ...S.btn,
            ...S.btnGreen,
            padding: "8px 20px",
            fontSize: 14,
            opacity: !images.init || busy ? 0.5 : 1,
          }}
        >
          {busy ? "running test…" : `run ${modelChoice.toUpperCase()} test`}
        </button>

        <button
          type="button"
          onClick={handleRunCompare}
          disabled={!images.init || busy}
          style={{
            ...S.btn,
            borderColor: AMBER.fg,
            color: AMBER.fg,
            padding: "8px 16px",
            fontSize: 13,
            opacity: !images.init || busy ? 0.5 : 1,
          }}
        >
          ⚡ compare H3 vs Wan 2.2 (side-by-side)
        </button>
      </div>
    </div>
  );
}
