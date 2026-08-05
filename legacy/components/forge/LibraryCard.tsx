"use client";

/**
 * The character library — the roster with everything each creature already
 * has, so starting work never involves a file manager: pick the project,
 * pick the character, click any existing art straight into the init or
 * style slot. While a character is selected, every generation files under
 * it (the job tag is what the library's "recent" group scans), and the
 * sheet tab pre-names its stage after it.
 */
import React, { useState } from "react";
import { S, AMBER, BLUE, GREY } from "./theme";
import type { LibraryCharacter, LibraryState } from "./types";

function AssetThumb({
  label,
  url,
  onInit,
  onStyle,
}: {
  label: string;
  url: string;
  onInit: (url: string) => void;
  onStyle: (url: string) => void;
}) {
  return (
    <div style={{ textAlign: "center" }} title={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} style={{ width: 56, height: 56, objectFit: "contain", background: "#fff", borderRadius: 3 }} />
      <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 2 }}>
        <button style={{ ...S.btn, fontSize: 10, padding: "0 5px" }} title="use as the init frame" onClick={() => onInit(url)}>
          → init
        </button>
        <button style={{ ...S.btn, ...S.btnGhost, fontSize: 10, padding: "0 5px" }} title="use as the style ref" onClick={() => onStyle(url)}>
          → style
        </button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={S.note}>{title}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>{children}</div>
    </div>
  );
}

export function LibraryCard({
  library,
  activeCharacter,
  onSelectProject,
  onSelectCharacter,
  onInit,
  onStyle,
}: {
  library: LibraryState;
  activeCharacter: string | null;
  onSelectProject: (id: string) => void;
  onSelectCharacter: (name: string | null) => void;
  onInit: (url: string) => void;
  onStyle: (url: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const sel: LibraryCharacter | null = library.characters.find((c) => c.name === activeCharacter) ?? null;
  const hasArt = (c: LibraryCharacter) =>
    c.published.length + c.inbox.length + c.sources.length + c.recent.length > 0;
  const roster = showAll ? library.characters : library.characters.filter((c) => hasArt(c) || c.kind === "player");

  return (
    <div style={S.card}>
      <h2 style={S.cardTitle}>
        library
        {library.projects.length > 0 && (
          <select
            style={{ ...S.input, width: "auto", marginLeft: 10, display: "inline-block" }}
            value={library.activeProject ?? ""}
            onChange={(e) => onSelectProject(e.target.value)}
          >
            {library.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
        {activeCharacter && (
          <span style={S.chip(AMBER.fg, AMBER.bg)}>generations file under {activeCharacter}</span>
        )}
      </h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {roster.map((c) => (
          <button
            key={c.name}
            style={{ ...S.btn, ...(c.name === activeCharacter ? S.btnGreen : hasArt(c) ? {} : S.btnGhost) }}
            title={c.blurb || c.name}
            onClick={() => onSelectCharacter(c.name === activeCharacter ? null : c.name)}
          >
            {c.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.thumb} alt="" style={{ width: 16, height: 16, objectFit: "cover", verticalAlign: "-3px", marginRight: 5, borderRadius: 2, background: "#fff" }} />
            ) : (
              <span style={{ marginRight: 5 }}>{c.icon}</span>
            )}
            {c.label}
          </button>
        ))}
        <button style={{ ...S.btn, ...S.btnGhost }} onClick={() => setShowAll(!showAll)}>
          {showAll ? "with art only" : "whole roster…"}
        </button>
      </div>
      {sel && (
        <div style={{ marginTop: 10, padding: "8px 10px", background: "#0d0f14", borderRadius: 4 }}>
          {sel.blurb && <p style={{ ...S.note, marginTop: 0 }}>{sel.blurb}</p>}
          {sel.published.length > 0 && (
            <Group title="published (what the game ships)">
              {sel.published.map((a) => (
                <AssetThumb key={a.url} {...a} onInit={onInit} onStyle={onStyle} />
              ))}
            </Group>
          )}
          {sel.inbox.length > 0 && (
            <Group title="inbox (staged for npm run sprites)">
              {sel.inbox.map((a) => (
                <AssetThumb key={a.url} {...a} onInit={onInit} onStyle={onStyle} />
              ))}
            </Group>
          )}
          {sel.sources.map((s) => (
            <Group key={s.drop} title={`sources · ${s.drop} (tracked originals)`}>
              {s.files.map((a) => (
                <AssetThumb key={a.url} {...a} onInit={onInit} onStyle={onStyle} />
              ))}
            </Group>
          ))}
          {sel.recent.length > 0 && (
            <Group title="recent generations (work — kept only until the next cleanup)">
              {sel.recent.flatMap((r) =>
                r.frames.slice(0, 8).map((a) => (
                  <AssetThumb key={a.url} label={`${r.label} · ${a.label}`} url={a.url} onInit={onInit} onStyle={onStyle} />
                )),
              )}
            </Group>
          )}
          {!hasArt(sel) && (
            <p style={S.note}>
              no art yet — pick any image as the init (or pixelize a reference) and the first generation starts this
              character&rsquo;s library.
            </p>
          )}
        </div>
      )}
      {!library.characters.length && <p style={S.note}>no project selected — nothing to list.</p>}
      <p style={{ ...S.note, marginTop: 8 }}>
        <span style={S.chip(BLUE.fg, BLUE.bg)}>→ init</span> start from this art ·{" "}
        <span style={S.chip(GREY.fg, GREY.bg)}>→ style</span> match its look · keep a generation with the{" "}
        <b>keep</b> button on its job card to file it under sources permanently
      </p>
    </div>
  );
}
