"use client";

/**
 * The /forge panel — a PixelLab-shaped sprite workbench over the local
 * ComfyUI backend, in two working tabs and one plumbing tab:
 *
 *   GENERATE  images in → task (rotate/animate/in-between/edit/touch-up/
 *             pixelize) → jobs board with live progress; every frame can
 *             re-roll, chain as the next init, or join the sheet
 *   SHEET     collected frames → assembled sheet → the real auto-cut and
 *             crush previews → staged into the inbox for `npm run sprites`
 *   BACKEND   server start/stop, settings, the model manager
 *
 * The panel is task-first on purpose: modes and their few fields come from
 * the server's registry (modes.mjs), which owns prompts, LoRA policy and
 * sampler sweet spots. Parameter tinkering belongs in ComfyUI's own
 * frontend against the same server; what wins there gets baked into the
 * registry, not surfaced as another knob here.
 *
 * All talk goes through /api/comfy/* on the Next server (same box as
 * ~/comfy): no CORS, and the Civitai token never reaches this page.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { S } from "./forge/theme";
import type { Job, LibraryState, Manifest, Mode, TrayFrame } from "./forge/types";
import { del, postJSON, urlToB64 } from "./forge/api";
import { GenerateCard, type SlotId } from "./forge/GenerateCard";
import { JobsBoard } from "./forge/JobsBoard";
import { LibraryCard } from "./forge/LibraryCard";
import { SheetTray } from "./forge/SheetTray";
import { IntakeCard } from "./forge/IntakeCard";
import { InGameCard } from "./forge/InGameCard";
import { ModelsCard, SettingsCard, StatusCard } from "./forge/BackendCards";

type Tab = "intake" | "generate" | "sheet" | "backend";

export default function ForgePanel() {
  const [m, setM] = useState<Manifest | null>(null);
  const [modes, setModes] = useState<Mode[]>([]);
  const [dlJobs, setDlJobs] = useState<Record<string, { state: string; error?: string }>>({});
  const [genJobs, setGenJobs] = useState<Record<string, Job>>({});
  const [tab, setTab] = useState<Tab>("generate");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [images, setImages] = useState<Record<SlotId, string | null>>({ init: null, end: null, style: null });
  const [mask, setMask] = useState<string | null>(null);
  const [modeRequest, setModeRequest] = useState<{ id: string; params?: Record<string, string>; n: number } | null>(null);
  const modeReqN = useRef(1);
  const [tray, setTray] = useState<TrayFrame[]>([]);
  const [tick, setTick] = useState(0);
  const [library, setLibrary] = useState<LibraryState>({ projects: [], activeProject: null, characters: [] });
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const trayKey = useRef(0);

  // The library scans four directories — refreshed on demand (project change,
  // keep, stage), not on the status poll.
  const refreshLibrary = useCallback(async (project?: string) => {
    try {
      const q = project ? `?project=${project}` : "";
      const r = await fetch(`/api/comfy/library${q}`);
      const j = await r.json();
      if (j.projects) setLibrary(j);
    } catch {
      /* backend absent — the manifest gate reports it */
    }
  }, []);
  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const refresh = useCallback(async () => {
    try {
      const [mr, dr, gr, xr] = await Promise.all([
        fetch("/api/comfy/manifest"),
        fetch("/api/comfy/download"),
        fetch("/api/comfy/generate"),
        fetch("/api/comfy/modes"),
      ]);
      setM(await mr.json());
      setDlJobs((await dr.json()).jobs ?? {});
      setGenJobs((await gr.json()).jobs ?? {});
      const xj = await xr.json();
      // Only replace the modes array when its content really changed —
      // consumers key field-reset effects off it, and a fresh identity every
      // poll would churn them.
      if (xj.modes) {
        setModes((prev) => (JSON.stringify(prev) === JSON.stringify(xj.modes) ? prev : xj.modes));
      }
      setTick((t) => t + 1);
    } catch {
      /* dev server hiccup — next poll wins */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const anyBusy =
      Object.values(dlJobs).some((j) => j.state === "downloading") ||
      Object.values(genJobs).some((j) => j.state === "running");
    const t = setInterval(refresh, anyBusy ? 2000 : 5000);
    return () => clearInterval(t);
  }, [refresh, dlJobs, genJobs]);

  const say = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(null), 6000);
  };

  const setImage = (slot: SlotId, b64: string | null) => setImages((im) => ({ ...im, [slot]: b64 }));

  const addToTray = (srcs: string[], clip: string, facing?: string) => {
    setTray((t) => [...t, ...srcs.map((src) => ({ key: `f${trayKey.current++}`, src, clip, facing }))]);
    say(`${srcs.length} frame(s) → sheet tray (${clip}${facing ? ` · ${facing}` : ""})`);
  };

  const useAsInit = async (src: string) => {
    try {
      setImage("init", await urlToB64(src));
      setMask(null);
      setTab("generate");
      say("frame loaded as the next init");
    } catch (e: any) {
      say(e.message);
    }
  };

  // The keyframe workflow's verbs: pin an in-between's end, brush-fix a
  // cell, or re-render one pose. Each loads the image and STEERS the
  // generate card to the right mode via modeRequest (a nonce so repeat
  // clicks re-fire).
  const requestMode = (id: string, params?: Record<string, string>) =>
    setModeRequest({ id, params, n: modeReqN.current++ });

  const useAsLast = async (src: string) => {
    try {
      setImage("end", await urlToB64(src));
      setTab("generate");
      requestMode("inbetween");
      say("frame pinned as the LAST frame — in-between mode");
    } catch (e: any) {
      say(e.message);
    }
  };

  const fixFrame = async (src: string) => {
    try {
      setImage("init", await urlToB64(src));
      setMask(null);
      setTab("generate");
      requestMode("touchup");
      say("frame loaded — brush over the wrong part");
    } catch (e: any) {
      say(e.message);
    }
  };

  const redoPose = async (src: string, pose: string) => {
    try {
      setImage("init", await urlToB64(src));
      setMask(null);
      setTab("generate");
      requestMode("edit", { prompt: pose ? `Redraw the character in this pose: ${pose}. Same character, same colors, same size, plain white background.` : "" });
      say("pose loaded into edit — tweak the wording and generate");
    } catch (e: any) {
      say(e.message);
    }
  };

  const launch = async (body: Record<string, unknown>) => {
    const r = await postJSON("/api/comfy/generate", {
      ...body,
      project: library.activeProject ?? undefined,
      character: activeCharacter ?? undefined,
    });
    say(`${(r.jobIds ?? [r.jobId]).length} job(s) queued${activeCharacter ? ` under ${activeCharacter}` : ""}`);
    void refresh();
  };

  /**
   * Fire a GPU mode and WAIT for its first output frame.
   *
   * Intake is a chain, not a board: the cut-out feeds the reframe feeds the QA,
   * and there is nothing partial worth showing in between. Everywhere else the
   * jobs board is the right shape — a rotation is minutes and you want to watch
   * it — so this variant lives here rather than replacing `launch`.
   */
  const launchAndWait = async (body: Record<string, unknown>): Promise<string | null> => {
    const r = await postJSON("/api/comfy/generate", {
      ...body,
      project: library.activeProject ?? undefined,
      character: activeCharacter ?? undefined,
    });
    const id = (r.jobIds ?? [r.jobId])[0];
    void refresh();
    for (let i = 0; i < 600; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const s = await (await fetch(`/api/comfy/generate?id=${id}`)).json();
      if (s.state === "running" || s.state === "queued") continue;
      if (s.state !== "done" || !s.frames?.length) {
        say(s.error ?? `job ${s.state}`);
        return null;
      }
      // The cut-out saves BOTH a cutout and a mask; the cutout is the one that
      // carries alpha, so name-match rather than trusting order.
      const want = s.frames.find((f: string) => f.includes("cut")) ?? s.frames[0];
      return urlToB64(`/api/comfy/generate?id=${id}&frame=${want}`);
    }
    say("timed out waiting for the job");
    return null;
  };

  const keep = async (id: string, job: Job) => {
    const character = job.character ?? activeCharacter;
    if (!character) return say("select a character in the library first — keep needs to know whose art this is");
    try {
      const r = await postJSON("/api/comfy/pipeline", { op: "keep", character, jobId: id, frames: job.frames ?? [] });
      say(`kept ${r.files.length} frame(s) → ${r.dir}`);
      void refreshLibrary(library.activeProject ?? undefined);
    } catch (e: any) {
      say(e.message);
    }
  };

  /**
   * Run this job's settings again — unchanged (a re-roll) or edited (a new
   * move, a reworded prompt, or both).
   *
   * `edits` is what makes the card's button honest. With none, this is the old
   * behaviour: same params, fresh seed. With them, it is the FIRST render of
   * something that has not existed before, and the card says `▶ run` instead of
   * `↻ re-roll` — because "re-roll" on a clip nobody has generated reads as a
   * promise that it is already sitting somewhere.
   */
  const reroll = async (id: string, job: Job, edits?: { params?: Record<string, string>; prompt?: string }) => {
    try {
      /**
       * ── THIS USED TO BE A DEAD CLICK ─────────────────────────────────────
       *
       * The server keeps no input images, so a re-run needs an init from the
       * browser. When none was loaded this returned a toast and nothing else —
       * and the toast is a line of text that clears itself after six seconds,
       * so pressing the button looked like pressing nothing. Reported as
       * "I click run attack and nothing happens", which is exactly right.
       *
       * A card that is SHOWING frames always has an init available: its own
       * first frame. Fall back to it and say which one was used, rather than
       * refusing to act while the answer is on screen.
       */
      let init = images.init;
      if (!init && job.frames?.length) {
        init = await urlToB64(`/api/comfy/generate?id=${id}&frame=${job.frames[0]}`);
        say(`no init loaded — using this job's first frame (${job.frames[0]})`);
      }
      if (!init) return say("load an init frame first (→ init on a finished frame)");
      await launch({
        mode: job.mode,
        params: edits?.params ?? job.params ?? {},
        imageB64: init,
        fast: job.fast,
        // Omitted unless the words were actually edited: the registry writes
        // the prompt, and echoing a resolved string back at it would freeze
        // this run against a mode that may since have been improved.
        ...(edits?.prompt ? { prompt: edits.prompt } : {}),
      });
    } catch (e: any) {
      say(e.message);
    }
  };

  if (!m) return <div style={S.page}>loading…</div>;
  if (!m.backendPresent)
    return (
      <div style={S.page}>
        <div style={S.wrap}>
          <h1 style={S.h1}>sprite forge</h1>
          <p style={S.sub}>
            No ComfyUI backend on this machine — expected at {m.comfyHome}. This panel only works on the dev box that
            has the generation stack installed.
          </p>
        </div>
      </div>
    );

  const runningN = Object.values(genJobs).filter((j) => j.state === "running").length;

  /**
   * The library renders on BOTH working tabs, and that is the curation loop:
   * on `generate` it is where a run starts, on `sheet` it is the shelf you
   * pick the keepers off while the tray is on screen beneath it. Choosing
   * frames used to mean scrolling a jobs board on another tab, which is why
   * finished art felt read-only.
   */
  const libraryCard = (
    <LibraryCard
      library={library}
      activeCharacter={activeCharacter}
      onSelectProject={async (id) => {
        try {
          await postJSON("/api/comfy/settings", { project: id });
        } catch {
          /* settings write is best-effort; the query param still switches */
        }
        setActiveCharacter(null);
        void refreshLibrary(id);
      }}
      onSelectCharacter={setActiveCharacter}
      onInit={async (url) => {
        setImage("init", await urlToB64(url));
        setMask(null);
        setTab("generate");
        say("library art loaded as the init frame");
      }}
      onStyle={async (url) => {
        setImage("style", await urlToB64(url));
        say("library art loaded as the style ref");
      }}
      onSheet={addToTray}
    />
  );

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={S.h1}>sprite forge</h1>
          <span style={S.chip(m.comfy.reachable ? "#8fdd9f" : "#dd8f8f", m.comfy.reachable ? "#16281c" : "#281616")}>
            {m.comfy.reachable ? `backend up · ${m.comfy.vramFreeGiB}GiB free` : "backend down"}
          </span>
          {runningN > 0 && <span style={S.chip("#9fd0ff", "#16202b")}>{runningN} generating</span>}
          <span style={{ flex: 1 }} />
          {(["intake", "generate", "sheet", "backend"] as Tab[]).map((t) => (
            <button key={t} style={{ ...S.btn, ...(tab === t ? S.btnGreen : {}) }} onClick={() => setTab(t)}>
              {t}
              {t === "sheet" && tray.length > 0 ? ` (${tray.length})` : ""}
            </button>
          ))}
        </div>
        <p style={S.sub}>
          frames in → move sets out · generated art lands in sprite-forge/work/comfy/ · a staged sheet publishes with
          `npm run sprites`
        </p>
        {toast && <div style={{ ...S.card, borderColor: "#4a3a2c", color: "#ffd9a0" }}>{toast}</div>}

        {tab === "generate" && (
          <>
            {libraryCard}
            <GenerateCard
              modes={modes}
              reachable={m.comfy.reachable}
              images={images}
              setImage={setImage}
              mask={mask}
              setMask={setMask}
              modeRequest={modeRequest}
              onLaunch={launch}
              say={say}
            />
            <JobsBoard
              jobs={genJobs}
              tick={tick}
              modes={modes}
              onCancel={async (id) => {
                try {
                  await del(`/api/comfy/generate?id=${id}`);
                  say("cancelled");
                  void refresh();
                } catch (e: any) {
                  say(e.message);
                }
              }}
              onReroll={reroll}
              onUseAsInit={useAsInit}
              onUseAsLast={useAsLast}
              onFixFrame={fixFrame}
              onRedoPose={redoPose}
              onAddToTray={addToTray}
              onKeep={keep}
            />
          </>
        )}

        {tab === "intake" && (
          <IntakeCard
            modes={modes}
            reachable={m.comfy.reachable}
            say={say}
            onLaunch={launchAndWait}
            onUseAsInit={async (b64) => {
              setImage("init", b64);
              setMask(null);
              setTab("generate");
              requestMode("keyframes");
              say("intake frame is the character — keyframes mode");
            }}
          />
        )}

        {tab === "sheet" && (
          <>
            {libraryCard}
            <SheetTray
              tray={tray}
              setTray={setTray}
              say={say}
              suggestedName={activeCharacter ? `${activeCharacter}-E` : ""}
              onStaged={() => void refreshLibrary(library.activeProject ?? undefined)}
            />
            {/* Staging ends at the inbox; this is the rest of the road. */}
            <InGameCard say={say} />
          </>
        )}

        {tab === "backend" && (
          <>
            <StatusCard
              m={m}
              busy={busy}
              onAction={async (a) => {
                setBusy(a);
                try {
                  const r = await postJSON("/api/comfy/server", { action: a });
                  say(a === "start" ? (r.up ? "server is up" : r.note ?? "starting…") : "server stopped");
                } catch (e: any) {
                  say(e.message);
                } finally {
                  setBusy(null);
                  void refresh();
                }
              }}
            />
            <SettingsCard
              m={m}
              onSave={async (patch) => {
                try {
                  await postJSON("/api/comfy/settings", patch);
                  say("settings saved");
                } catch (e: any) {
                  say(e.message);
                } finally {
                  void refresh();
                }
              }}
            />
            <ModelsCard
              m={m}
              dlJobs={dlJobs}
              onDownload={async (id) => {
                try {
                  await postJSON("/api/comfy/download", { optionId: id });
                } catch (e: any) {
                  say(e.message);
                } finally {
                  void refresh();
                }
              }}
              onChoose={async (slotId, optionId) => {
                try {
                  await postJSON("/api/comfy/settings", { chosen: { [slotId]: optionId } });
                  say("selection saved — generation will use it");
                } catch (e: any) {
                  say(e.message);
                } finally {
                  void refresh();
                }
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
