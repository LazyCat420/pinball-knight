/**
 * The unmetered-run guard, both directions.
 *
 * A guard is only worth having if it is silent on the commands people actually
 * type all day and loud on the ones that take the box — so the allow cases here
 * matter at least as much as the deny cases ("a check that passes for both
 * states is not a check").
 *
 * Each case feeds the hook a real PreToolUse payload on stdin and asserts the
 * exit code: 0 allows, 2 denies with the remedy on stderr.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GUARD = resolve(__dirname, "guard_unmetered.py");
const REPO = resolve(__dirname, "..", "..");

function run(command: string, cwd: string = REPO) {
  const r = spawnSync("python3", [GUARD], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
    encoding: "utf8",
  });
  return { code: r.status, stderr: r.stderr };
}

describe("guard_unmetered — denies", () => {
  it("a bare vitest run", () => {
    const r = run("npx vitest run src/game/pinball-knight");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/pk-run\.sh --class test/);
  });

  it("vitest reached through node_modules/.bin", () => {
    expect(run("./node_modules/.bin/vitest run").code).toBe(2);
  });

  it("vitest behind env vars and a timeout", () => {
    expect(run("FORGE_PUBLISH=1 timeout 90 npx vitest run tools/").code).toBe(2);
  });

  it("vitest in the second half of a compound command", () => {
    expect(run("npm install && pnpm exec vitest run").code).toBe(2);
  });

  it("a browser harness driven directly", () => {
    const r = run("node scripts/playtest.mjs --gpu --profile");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--class webgpu/);
  });

  // The subtle case: `npm test` is metered in the main checkout and bare in a
  // worktree cut before the meter landed. Skips once every worktree on the box
  // has merged main — at that point the hole it covers genuinely does not
  // exist, and a green assertion about it would be theatre.
  const stale = staleWorktree();
  it.skipIf(!stale)(`npm test in a pre-meter worktree (${stale ?? "none on disk"})`, () => {
    const r = run("npm test", stale!);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/pre-meter script/);
  });
});

/** A worktree of this repo whose `test` script does not route through pk-run.sh. */
function staleWorktree(): string | null {
  const out = spawnSync("git", ["-C", REPO, "worktree", "list", "--porcelain"], { encoding: "utf8" }).stdout ?? "";
  for (const line of out.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const dir = line.slice("worktree ".length).trim();
    if (dir === REPO) continue;
    try {
      const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
      if (!/pk-run\.sh/.test(pkg.scripts?.test ?? "")) return dir;
    } catch { /* locked, pruned, or mid-checkout — not a usable fixture */ }
  }
  return null;
}

describe("guard_unmetered — allows", () => {
  it("the metered wrapper itself", () => {
    expect(run("scripts/ops/pk-run.sh --class test -- npx vitest run").code).toBe(0);
  });

  it("a run already pinned by with-cores.sh", () => {
    expect(run("scripts/with-cores.sh CPUS=4 --wsl -- vitest run").code).toBe(0);
  });

  it("npm test in a checkout whose script routes through the meter", () => {
    expect(run("npm test").code).toBe(0);
  });

  it("the documented escape hatch, because bypassing must be TYPED", () => {
    expect(run("npm run test:raw").code).toBe(0);
  });

  it("the status report and other npm scripts", () => {
    expect(run("npm run ops:status").code).toBe(0);
    expect(run("npm run build").code).toBe(0);
  });

  it("merely MENTIONING vitest — grep, cat, ls are not invocations", () => {
    expect(run("grep -rn vitest package.json").code).toBe(0);
    expect(run("cat vitest.config.js").code).toBe(0);
    expect(run("ls node_modules/vitest").code).toBe(0);
  });

  it("vitest --version", () => {
    expect(run("npx vitest --version").code).toBe(0);
  });

  it("anything outside a braindeadbot-client checkout", () => {
    expect(run("npx vitest run", "/tmp").code).toBe(0);
  });

  it("an unparseable payload — a guard must fail OPEN", () => {
    const r = spawnSync("python3", [GUARD], { input: "not json", encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});
