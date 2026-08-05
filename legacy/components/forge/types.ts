/**
 * The panel's client-side view of the server contracts. Server truth lives
 * in modes.mjs (task registry), generate/route.ts (jobs) and
 * pipeline/route.ts (cut/crush/stage) — these types mirror, never define.
 */

export type Manifest = {
  backendPresent: boolean;
  comfyHome: string;
  comfy: { reachable: boolean; version?: string; device?: string; vramFreeGiB?: number; vramTotalGiB?: number };
  settings: { comfyUrl: string; civitaiTokenSet: boolean; chosen: Record<string, string> };
  legs: any[];
};

export type ModeField = {
  id: string;
  label: string;
  type: "select" | "text";
  options?: { id: string; label: string }[];
  default?: string;
  placeholder?: string;
  required?: boolean;
  /** Only render when another field holds a value, e.g. {facing: "custom"}. */
  showIf?: Record<string, string>;
  /** Text field whose empty value is previewed from a preset select. */
  prefillFrom?: string;
};

export type Mode = {
  id: string;
  title: string;
  blurb: string;
  leg: "qwen" | "wan";
  needs: { init?: boolean; end?: boolean; mask?: boolean; style?: boolean | "optional" };
  fields: ModeField[];
  batch: { id: string; label: string; values: Record<string, string>[] } | null;
  presets: { id: string; label: string; action: string; clip: string }[] | null;
  etaS: { quality: number; fast: number };
  fastAvailable: boolean;
  notes: string[];
};

export type Progress = { node: string | null; value: number; max: number };

export type Job = {
  state: "running" | "done" | "error" | "cancelled";
  mode: string;
  label: string;
  startedAt: number;
  params?: Record<string, string>;
  resolvedPrompt?: string;
  seed?: number;
  fast?: boolean;
  project?: string;
  character?: string;
  progress?: Progress;
  hasPreview?: boolean;
  frames?: string[];
  error?: string;
  tookS?: number;
  note?: string;
};

export type LibraryAsset = { label: string; url: string };

export type LibraryCharacter = {
  name: string;
  label: string;
  icon: string;
  blurb: string;
  kind: "player" | "monster" | "art-only";
  thumb: string | null;
  published: LibraryAsset[];
  inbox: LibraryAsset[];
  sources: { drop: string; files: LibraryAsset[] }[];
  recent: { jobId: string; label: string; startedAt: number; frames: LibraryAsset[] }[];
};

export type LibraryState = {
  projects: { id: string; title: string }[];
  activeProject: string | null;
  characters: LibraryCharacter[];
};

/** A frame the user pulled aside for the sheet, tagged with its clip. */
export type TrayFrame = {
  key: string;
  src: string;
  clip: string;
};

/** Row order the game's sheets use; `stumble` is the stagger clip, not `hurt`. */
export const CLIP_NAMES = ["idle", "walk", "run", "attack", "stumble", "death", "roll", "crouch", "wait", "wake"] as const;

export type CutResult = {
  ok: boolean;
  rows: { clip: string; cells: [number, number, number, number][] }[];
  labels: string[];
  slicedRows: number;
  matte: { pockets: number } | null;
  warnings: string[];
  suggestedSidecar: { rows: string[] };
  error?: string;
};

export type CrushResult = { ok: boolean; previewB64: string; report: string; frames: number; error?: string };
