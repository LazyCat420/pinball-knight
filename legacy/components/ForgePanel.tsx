"use client";

/**
 * The /forge panel — sprite generation front-end over the local ComfyUI
 * backend, in three cards:
 *
 *   STATUS    is the server up, what card, how much VRAM; start/stop
 *   MODELS    every pipeline slot with its options: which are REQUIRED,
 *             which one is the proven default, what swapping costs.
 *             Download buttons stream server-side into ~/comfy.
 *   GENERATE  pick an init frame → rotate / animate / edit → frames back.
 *
 * All talk goes through /api/comfy/* on the Next server (same box as
 * ~/comfy): no CORS, and the Civitai token never reaches this page —
 * Settings only learns whether one is stored.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

const S = {
  page: {
    minHeight: "100vh",
    background: "#0a0a0f",
    color: "#c8ccd4",
    fontFamily: "ui-monospace, Consolas, monospace",
    fontSize: 13,
    padding: "24px 20px 80px",
  } as React.CSSProperties,
  wrap: { maxWidth: 1060, margin: "0 auto" } as React.CSSProperties,
  h1: { fontSize: 18, color: "#e8e6df", margin: "0 0 4px" } as React.CSSProperties,
  sub: { color: "#6a7080", margin: "0 0 20px" } as React.CSSProperties,
  card: {
    background: "#12141b",
    border: "1px solid #23262f",
    borderRadius: 6,
    padding: "14px 16px",
    marginBottom: 16,
  } as React.CSSProperties,
  cardTitle: { fontSize: 14, color: "#e8e6df", margin: "0 0 10px" } as React.CSSProperties,
  btn: {
    background: "#1d2733",
    color: "#9fd0ff",
    border: "1px solid #2c3a4a",
    borderRadius: 4,
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
  } as React.CSSProperties,
  btnGreen: { background: "#16281c", color: "#8fdd9f", borderColor: "#28483200" } as React.CSSProperties,
  input: {
    background: "#0d0f14",
    color: "#c8ccd4",
    border: "1px solid #2c303b",
    borderRadius: 4,
    padding: "5px 8px",
    fontFamily: "inherit",
    fontSize: 12.5,
    width: "100%",
  } as React.CSSProperties,
  chip: (fg: string, bg: string): React.CSSProperties => ({
    display: "inline-block",
    color: fg,
    background: bg,
    borderRadius: 3,
    padding: "1px 7px",
    fontSize: 11,
    marginLeft: 8,
    verticalAlign: "1px",
  }),
  note: { color: "#6a7080", fontSize: 12, margin: "3px 0 0" } as React.CSSProperties,
};

const fmtGB = (b: number) => (b / 1e9).toFixed(b >= 1e10 ? 0 : 1) + "GB";

type Manifest = {
  backendPresent: boolean;
  comfyHome: string;
  comfy: { reachable: boolean; version?: string; device?: string; vramFreeGiB?: number; vramTotalGiB?: number };
  settings: { comfyUrl: string; civitaiTokenSet: boolean; chosen: Record<string, string> };
  legs: any[];
};

export default function ForgePanel() {
  const [m, setM] = useState<Manifest | null>(null);
  const [dlJobs, setDlJobs] = useState<Record<string, { state: string; error?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [mr, dr] = await Promise.all([fetch("/api/comfy/manifest"), fetch("/api/comfy/download")]);
      setM(await mr.json());
      setDlJobs((await dr.json()).jobs ?? {});
    } catch {
      /* dev server hiccup — next poll wins */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const anyDownloading = Object.values(dlJobs).some((j) => j.state === "downloading");
    const t = setInterval(refresh, anyDownloading ? 1500 : 5000);
    return () => clearInterval(t);
  }, [refresh, dlJobs]);

  const say = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(null), 5000);
  };

  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
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

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>sprite forge — generation panel</h1>
        <p style={S.sub}>
          one init frame in → rotations and move sets out · backend at {m.comfyHome} · outputs land in
          sprite-forge/work/comfy/ and flow into the normal inbox crush
        </p>
        {toast && (
          <div style={{ ...S.card, borderColor: "#4a3a2c", color: "#ffd9a0" }}>{toast}</div>
        )}
        <StatusCard m={m} onAction={async (a) => {
          setBusy(a);
          try {
            const r = await post("/api/comfy/server", { action: a });
            say(a === "start" ? (r.up ? "server is up" : r.note ?? "starting…") : "server stopped");
          } catch (e: any) {
            say(e.message);
          } finally {
            setBusy(null);
            void refresh();
          }
        }} busy={busy} />
        <SettingsCard m={m} onSave={async (patch) => {
          try {
            await post("/api/comfy/settings", patch);
            say("settings saved");
          } catch (e: any) {
            say(e.message);
          } finally {
            void refresh();
          }
        }} />
        <ModelsCard m={m} dlJobs={dlJobs} onDownload={async (id) => {
          try {
            await post("/api/comfy/download", { optionId: id });
          } catch (e: any) {
            say(e.message);
          } finally {
            void refresh();
          }
        }} onChoose={async (slotId, optionId) => {
          try {
            await post("/api/comfy/settings", { chosen: { [slotId]: optionId } });
            say("selection saved — generation will use it");
          } catch (e: any) {
            say(e.message);
          } finally {
            void refresh();
          }
        }} />
        <GenerateCard reachable={m.comfy.reachable} say={say} />
      </div>
    </div>
  );
}

function StatusCard({ m, onAction, busy }: { m: Manifest; onAction: (a: "start" | "stop") => void; busy: string | null }) {
  const c = m.comfy;
  return (
    <div style={S.card}>
      <h2 style={S.cardTitle}>
        backend
        {c.reachable ? (
          <span style={S.chip("#8fdd9f", "#16281c")}>up · ComfyUI {c.version}</span>
        ) : (
          <span style={S.chip("#dd8f8f", "#281616")}>down</span>
        )}
      </h2>
      {c.reachable ? (
        <p style={S.note}>
          {c.device} · VRAM {c.vramFreeGiB} / {c.vramTotalGiB} GiB free · stop it when you are done — the card is shared
        </p>
      ) : (
        <p style={S.note}>server not answering at {m.settings.comfyUrl}</p>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        {!c.reachable && (
          <button style={{ ...S.btn, ...S.btnGreen }} disabled={busy !== null} onClick={() => onAction("start")}>
            {busy === "start" ? "starting… (~20s)" : "start server"}
          </button>
        )}
        {c.reachable && (
          <button style={S.btn} disabled={busy !== null} onClick={() => onAction("stop")}>
            {busy === "stop" ? "stopping…" : "stop server"}
          </button>
        )}
      </div>
    </div>
  );
}

function SettingsCard({ m, onSave }: { m: Manifest; onSave: (patch: any) => void }) {
  const [url, setUrl] = useState(m.settings.comfyUrl);
  const [token, setToken] = useState("");
  useEffect(() => setUrl(m.settings.comfyUrl), [m.settings.comfyUrl]);
  return (
    <div style={S.card}>
      <h2 style={S.cardTitle}>settings</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label>
          <div style={S.note}>ComfyUI API URL</div>
          <input style={S.input} value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label>
          <div style={S.note}>
            Civitai API key {m.settings.civitaiTokenSet ? "· one is stored" : "· none stored"} — needed only for the
            two Civitai models below (free: civitai.com → account → API Keys)
          </div>
          <input
            style={S.input}
            type="password"
            placeholder={m.settings.civitaiTokenSet ? "••••••••  (leave blank to keep)" : "paste key"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          style={S.btn}
          onClick={() => onSave({ comfyUrl: url, ...(token ? { civitaiToken: token } : {}) })}
        >
          save settings
        </button>
      </div>
    </div>
  );
}

function ModelsCard({
  m,
  dlJobs,
  onDownload,
  onChoose,
}: {
  m: Manifest;
  dlJobs: Record<string, { state: string; error?: string }>;
  onDownload: (id: string) => void;
  onChoose: (slotId: string, optionId: string) => void;
}) {
  return (
    <div style={S.card}>
      <h2 style={S.cardTitle}>models</h2>
      <p style={S.note}>
        REQUIRED slots must have one installed option or that leg will not run. Where a slot offers alternatives, the
        radio picks which one generation uses — installed alternatives swap instantly, no restart.
      </p>
      {m.legs.map((leg) => (
        <div key={leg.id} style={{ marginTop: 14 }}>
          <div style={{ color: "#e8e6df" }}>{leg.title}</div>
          <p style={S.note}>{leg.blurb}</p>
          {leg.slots.map((slot: any) => (
            <div key={slot.id} style={{ margin: "10px 0 0 0", padding: "8px 10px", background: "#0d0f14", borderRadius: 4 }}>
              <div>
                {slot.role}
                {slot.required ? (
                  <span style={S.chip("#ffd9a0", "#2c2416")}>required</span>
                ) : (
                  <span style={S.chip("#6a7080", "#171921")}>optional</span>
                )}
              </div>
              {slot.options.map((o: any) => {
                const st = o.install?.state ?? "missing";
                const job = dlJobs[o.id];
                const downloading = job?.state === "downloading" || st === "partial";
                const pct = downloading && o.bytes ? Math.min(99, Math.round(((o.install?.bytes ?? 0) / o.bytes) * 100)) : null;
                const isChosen =
                  slot.choice &&
                  ((m.settings.chosen[slot.id] ?? slot.options.find((x: any) => x.recommended)?.id) === o.id);
                return (
                  <div key={o.id} style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    {slot.choice && (
                      <input
                        type="radio"
                        name={slot.id}
                        checked={!!isChosen}
                        disabled={st !== "installed"}
                        title={st !== "installed" ? "download it first" : "use this one"}
                        onChange={() => onChoose(slot.id, o.id)}
                      />
                    )}
                    <span style={{ color: "#c8ccd4" }}>{o.name}</span>
                    <span style={{ color: "#6a7080" }}>{fmtGB(o.bytes)}</span>
                    <span style={{ color: "#6a7080" }}>{o.license}</span>
                    {o.recommended && <span style={S.chip("#9fd0ff", "#16202b")}>default</span>}
                    {o.kind === "civitai" && !m.settings.civitaiTokenSet && (
                      <span style={S.chip("#ffd9a0", "#2c2416")}>needs Civitai key</span>
                    )}
                    {st === "installed" && <span style={S.chip("#8fdd9f", "#16281c")}>installed</span>}
                    {st === "broken" && <span style={S.chip("#dd8f8f", "#281616")}>broken file — re-download</span>}
                    {job?.state === "error" && (
                      <span style={S.chip("#dd8f8f", "#281616")} title={job.error}>
                        failed: {job.error?.slice(0, 80)}
                      </span>
                    )}
                    {downloading ? (
                      <span style={S.chip("#9fd0ff", "#16202b")}>downloading{pct !== null ? ` ${pct}%` : "…"}</span>
                    ) : (
                      st !== "installed" && (
                        <button style={S.btn} onClick={() => onDownload(o.id)}>
                          download
                        </button>
                      )
                    )}
                    {o.note && <div style={{ ...S.note, flexBasis: "100%", marginLeft: slot.choice ? 22 : 0 }}>{o.note}</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function GenerateCard({ reachable, say }: { reachable: boolean; say: (s: string) => void }) {
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [kind, setKind] = useState<"rotate" | "animate" | "edit">("rotate");
  const [to, setTo] = useState("left, seen from the side");
  const [action, setAction] = useState("hopping forward");
  const [prompt, setPrompt] = useState("");
  const [seed, setSeed] = useState("7");
  const [job, setJob] = useState<{ id: string; state: string; frames?: string[]; tookS?: number; error?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pick = (f: File) => {
    const rd = new FileReader();
    rd.onload = () => setImageB64(String(rd.result));
    rd.readAsDataURL(f);
  };

  const start = async () => {
    if (!imageB64) return say("pick an init frame first");
    const body: any = { kind, imageB64, seed };
    if (kind === "rotate") body.to = to;
    if (kind === "animate") body.action = action;
    if (kind === "edit") body.prompt = prompt;
    const r = await fetch("/api/comfy/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok || j.error) return say(j.error ?? `HTTP ${r.status}`);
    setJob({ id: j.jobId, state: "running" });
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const s = await (await fetch(`/api/comfy/generate?id=${j.jobId}`)).json();
      setJob({ id: j.jobId, ...s });
      if (s.state !== "running" && pollRef.current) clearInterval(pollRef.current);
    }, 2000);
  };

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  return (
    <div style={S.card}>
      <h2 style={S.cardTitle}>generate</h2>
      {!reachable && <p style={S.note}>server is down — start it above first</p>}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <label style={{ ...S.btn, display: "inline-block" }}>
          pick init frame…
          <input type="file" accept="image/png,image/webp" style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        {imageB64 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageB64} alt="init" style={{ width: 96, height: 96, objectFit: "contain", background: "#fff", borderRadius: 4, imageRendering: "pixelated" }} />
        )}
        <div style={{ flex: 1, minWidth: 300 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {(["rotate", "animate", "edit"] as const).map((k) => (
              <button key={k} style={{ ...S.btn, ...(kind === k ? S.btnGreen : {}) }} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
            <input style={{ ...S.input, width: 90 }} title="seed" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </div>
          {kind === "rotate" && (
            <select style={S.input} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="left, seen from the side">face left (side view)</option>
              <option value="right, seen from the side">face right (side view)</option>
              <option value="the camera (front view)">face the camera</option>
              <option value="away from the camera (back view)">face away (back view)</option>
            </select>
          )}
          {kind === "animate" && (
            <input style={S.input} value={action} onChange={(e) => setAction(e.target.value)}
              placeholder="hopping forward / attacking with claws / dying and collapsing…" />
          )}
          {kind === "edit" && (
            <input style={S.input} value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="free instruction, e.g. raise both arms overhead" />
          )}
          <div style={{ marginTop: 8 }}>
            <button style={{ ...S.btn, ...S.btnGreen }} disabled={!reachable || job?.state === "running"} onClick={start}>
              {job?.state === "running" ? "generating… (rotate ~4min, animate ~7min)" : "generate"}
            </button>
          </div>
        </div>
      </div>
      {job?.state === "error" && <p style={{ ...S.note, color: "#dd8f8f" }}>{job.error}</p>}
      {job?.state === "done" && job.frames && (
        <div style={{ marginTop: 12 }}>
          <p style={S.note}>
            {job.frames.length} frame(s) in {job.tookS}s — saved under sprite-forge/work/comfy/{job.id}/ for the inbox
            crush
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {job.frames.map((f) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f} src={`/api/comfy/generate?id=${job.id}&frame=${f}`} alt={f}
                style={{ width: 128, height: 128, objectFit: "contain", background: "#fff", borderRadius: 4 }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
