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
import type { Job, Manifest, Mode, TrayFrame } from "./forge/types";
import { del, postJSON, urlToB64 } from "./forge/api";
import { GenerateCard, type SlotId } from "./forge/GenerateCard";
import { JobsBoard } from "./forge/JobsBoard";
import { SheetTray } from "./forge/SheetTray";
import { ModelsCard, SettingsCard, StatusCard } from "./forge/BackendCards";

type Tab = "generate" | "sheet" | "backend";

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
  const [tray, setTray] = useState<TrayFrame[]>([]);
  const [tick, setTick] = useState(0);
  const trayKey = useRef(0);

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
      if (xj.modes) setModes(xj.modes);
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

  const addToTray = (srcs: string[], clip: string) => {
    setTray((t) => [...t, ...srcs.map((src) => ({ key: `f${trayKey.current++}`, src, clip }))]);
    say(`${srcs.length} frame(s) → sheet tray (${clip})`);
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

  const launch = async (body: Record<string, unknown>) => {
    const r = await postJSON("/api/comfy/generate", body);
    say(`${(r.jobIds ?? [r.jobId]).length} job(s) queued`);
    void refresh();
  };

  const reroll = async (id: string, job: Job) => {
    try {
      // Same mode + params, fresh seed. The init is whatever is loaded NOW —
      // the server does not keep input images, and the honest fix is loading
      // the frame you want first (→ init on any output does exactly that).
      if (!images.init) return say("load an init frame first (→ init on a finished frame)");
      await launch({ mode: job.mode, params: job.params ?? {}, imageB64: images.init, fast: job.fast });
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
          {(["generate", "sheet", "backend"] as Tab[]).map((t) => (
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
            <GenerateCard
              modes={modes}
              reachable={m.comfy.reachable}
              images={images}
              setImage={setImage}
              mask={mask}
              setMask={setMask}
              onLaunch={launch}
              say={say}
            />
            <JobsBoard
              jobs={genJobs}
              tick={tick}
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
              onAddToTray={addToTray}
            />
          </>
        )}

        {tab === "sheet" && <SheetTray tray={tray} setTray={setTray} say={say} />}

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
