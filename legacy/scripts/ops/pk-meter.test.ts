/**
 * The meter, exercised against a FAKE box.
 *
 * Every case here runs pk-run.sh with BDB_SLOT_LOCKDIR pointed at a temp dir
 * that already contains a topology file, so the suite never touches the real
 * lock pool (killing a parallel session's grant) and never calls PowerShell.
 * The fake box is deliberately tiny — 4 physical / 8 logical, 1 core reserved
 * → a 6-thread budget — because the properties under test are about the budget
 * arithmetic, not about this machine.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PK_RUN = resolve(__dirname, "pk-run.sh");
const STATUS = resolve(__dirname, "pk-status.mjs");
const PHYS = 4, LOGICAL = 8, RESERVE = 1;
const BUDGET = (PHYS - RESERVE) * (LOGICAL / PHYS); // 6 threads

let lockdir: string;
const env = () => ({
  ...process.env,
  BDB_SLOT_LOCKDIR: lockdir,
  BDB_SLOT_RESERVE: String(RESERVE),
});

/** Hold `n` threads for the life of the returned child. */
function hold(n: number, seconds = 30) {
  const child = spawn(PK_RUN, ["--class", "test", "--threads", String(n), "--timeout", "5", "--", "sleep", String(seconds)], {
    env: env(),
    stdio: "ignore",
  });
  return child;
}

function status() {
  return JSON.parse(execFileSync("node", [STATUS, "--json", "--fast"], { env: env(), encoding: "utf8" }));
}

/** Poll until `fn` is true — the grant lands asynchronously in another process. */
async function until(fn: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

beforeEach(() => {
  lockdir = mkdtempSync(join(tmpdir(), "pk-meter-"));
  writeFileSync(
    join(lockdir, "topology"),
    `PHYS=${PHYS}\nLOGICAL=${LOGICAL}\nCOREFIRST="0,2,4,6"\nL3GROUPS="0-1-2-3"\n`,
  );
});
afterEach(() => rmSync(lockdir, { recursive: true, force: true }));

describe("pk-run.sh budget", () => {
  it("reserves cores for the humans instead of handing out the whole box", () => {
    const s = status();
    expect(s.budget.threads).toBe(BUDGET);
    expect(s.budget.threads).toBeLessThan(LOGICAL);
    expect(s.budget.free).toBe(BUDGET);
  });

  it("grants what it says, and the grant is visible in --status while it runs", async () => {
    const child = hold(3);
    try {
      expect(await until(() => status().budget.held === 3)).toBe(true);
      const s = status();
      expect(s.runs).toHaveLength(1);
      expect(s.runs[0]).toMatchObject({ cls: "test", threads: 3 });
      expect(s.budget.free).toBe(BUDGET - 3);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("frees the grant when the run is killed -9 — liveness is the kernel's, not a cleanup pass", async () => {
    const child = hold(3);
    expect(await until(() => status().budget.held === 3)).toBe(true);
    child.kill("SIGKILL");
    expect(await until(() => status().budget.held === 0)).toBe(true);
  });

  it("never oversells: two runs asking for the whole budget cannot both get it", async () => {
    const a = hold(BUDGET);
    try {
      expect(await until(() => status().budget.held === BUDGET)).toBe(true);
      // 75 specifically: "the box is full", distinct from any exit code the
      // command itself could have produced — it never ran.
      let status_code: number | undefined;
      try {
        execFileSync(PK_RUN, ["--class", "test", "--threads", "2", "--timeout", "1", "--", "true"], { env: env(), stdio: "pipe" });
      } catch (e) {
        status_code = (e as { status?: number }).status;
      }
      expect(status_code).toBe(75);
      expect(status().budget.held).toBe(BUDGET);
    } finally {
      a.kill("SIGKILL");
    }
  });

  it("shrinks a unit-test grant rather than failing it (elastic), down to the floor", async () => {
    const a = hold(BUDGET - 1);
    try {
      expect(await until(() => status().budget.held === BUDGET - 1)).toBe(true);
      const out = execFileSync(
        PK_RUN,
        ["--class", "test", "--threads", "4", "--timeout", "2", "--", "printenv", "BDB_JOBS"],
        { env: { ...env(), PK_MIN_THREADS: "1" }, encoding: "utf8" },
      );
      expect(out.trim()).toBe("1"); // one thread was all that was left
    } finally {
      a.kill("SIGKILL");
    }
  });

  it("clamps a caller's --maxWorkers to the grant, because a CLI flag beats vitest.config.js", () => {
    const out = execFileSync(
      PK_RUN,
      ["--class", "test", "--threads", "2", "--", "echo", "--maxWorkers=64"],
      { env: env(), encoding: "utf8" },
    );
    expect(out.trim()).toBe("--maxWorkers=2");
  });

  it("passes a smaller --maxWorkers through untouched", () => {
    const out = execFileSync(
      PK_RUN,
      ["--class", "test", "--threads", "4", "--", "echo", "--maxWorkers=1"],
      { env: env(), encoding: "utf8" },
    );
    expect(out.trim()).toBe("--maxWorkers=1");
  });

  it("refuses an ask larger than the budget for an EXACT class instead of quietly shrinking it", () => {
    expect(() =>
      execFileSync(PK_RUN, ["--class", "perf", "--cpus", String(PHYS), "--timeout", "1", "--", "true"], {
        env: env(),
        stdio: "pipe",
      }),
    ).toThrowError(/out of range/);
  });

  it("sizes the vitest worker pool from the grant, not from nproc", () => {
    const out = execFileSync(PK_RUN, ["--class", "test", "--threads", "3", "--", "printenv", "BDB_JOBS"], {
      env: env(),
      encoding: "utf8",
    });
    expect(Number(out.trim())).toBe(3);
    expect(Number(out.trim())).toBeLessThan(LOGICAL);
  });
});
