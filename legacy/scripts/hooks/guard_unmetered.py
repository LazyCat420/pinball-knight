#!/usr/bin/env python3
"""PreToolUse guard: heavy runs in braindeadbot-client go through the meter.

The rule this enforces: no run takes the whole box. `scripts/ops/pk-run.sh`
holds flock'd thread/core grants out of one machine-global budget, with cores
reserved for the humans, so parallel sessions share the machine instead of
measuring each other.

Why it needs enforcing rather than remembering, in three distinct shapes:

  * A bare `vitest run` sizes its worker pool from `nproc` — all 24 logical
    CPUs here — and nothing in its output says so. It looks exactly like a
    metered run that was granted 24.
  * `npm test` is only metered in a checkout whose package.json routes it
    through pk-run.sh. Every worktree cut before 2026-08-05 still has the bare
    script, so the SAME command is metered in one directory and not in the one
    next to it. That is invisible from the command line, which is why this
    guard reads the package.json of the directory the command will run in
    rather than trusting the command's spelling.
  * The browser harnesses additionally hold a GPU context and a detached
    Windows Chrome that outlives the run; unmetered, that cost is off-book
    entirely (it is not even in /proc).

The failure mode is never an error — it is a slower desktop, someone else's
benchmark quietly invalidated, and a timing nobody can reproduce. So it gets a
guard rather than a note in a README.

Contract (matches the other hooks here): exit 0 allows, exit 2 denies with the
remedy on stderr. Anything this cannot parse is ALLOWED — a guard that blocks
on its own confusion is worse than the risk it covers.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve()


def git(args: list[str], cwd: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), *args],
            capture_output=True, text=True, timeout=5, check=True,
        ).stdout.strip()
    except Exception:
        return None
    return out or None


def repo_home() -> Path:
    """The PRIMARY checkout of the repo this guard belongs to.

    Asked of git rather than taken from `__file__`, because the two differ:
    the registered hook runs from the primary checkout, but a copy of it in a
    worktree (a branch under test, say) would otherwise conclude that its OWN
    worktree is the repo and then decide that every real checkout belongs to
    someone else — a guard that silently stops guarding.
    """
    if not hasattr(repo_home, "_cached"):
        common = git(["rev-parse", "--git-common-dir"], HERE.parent)
        home = HERE.parents[2]
        if common:
            p = Path(common) if os.path.isabs(common) else (HERE.parent / common)
            try:
                home = p.resolve().parent
            except OSError:
                pass
        repo_home._cached = home  # type: ignore[attr-defined]
    return repo_home._cached  # type: ignore[attr-defined]

# A command-POSITION match, not a mention: `grep vitest x`, `cat vitest.config.js`
# and `ls node_modules/vitest` all contain the word and invoke nothing. Optional
# leading env assignments, `timeout N`, and a package runner are all allowed to
# sit in front of the real command.
_START = r"(?:^|[;&|(]|\n|&&|\|\|)\s*"
_ENVS = r"(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*"
_TIMEOUT = r"(?:timeout\s+\S+\s+)?"
_RUNNER = r"(?:(?:npx|pnpm|yarn|bunx)\s+(?:exec\s+|dlx\s+)?)?"

INVOKES_VITEST = re.compile(
    _START + _ENVS + _TIMEOUT + _RUNNER + r"(?:\S*node_modules/\.bin/)?vitest\b",
)
# `vitest --version` costs nothing and answers a question; don't make it a fight.
VITEST_IS_HARMLESS = re.compile(r"vitest\s+(--version|--help|-h)\b")

# The harnesses that drive a real browser: each one takes a GPU context and
# leaves a detached Windows Chrome behind. Verified by their import of
# scripts/lib/host-chrome.mjs.
BROWSER_HARNESS = re.compile(
    r"\b(playtest|room-bench|room-bench-probe|lag-profile|audit-checklist|webgpu-check"
    r"|cpu-slots-smoke|fx-probe|fx-motion|ui-probe|floor-census)\.mjs\b",
)

# npm/pnpm script invocations whose SCRIPT BODY is what has to be metered.
NPM_SCRIPT = re.compile(
    _START + _ENVS + _TIMEOUT + r"(?:npm|pnpm|yarn)\s+(?:run\s+(?:--silent\s+)?)?([A-Za-z0-9:_-]+)",
)
# `dev` is deliberately NOT here. A dev server is one thread; blocking someone
# from starting one in an old worktree costs more than the thread is worth, and
# the unmetered ones still show up by name in `npm run ops:status`.
GUARDED_SCRIPTS = {
    "test", "sprites",
    "playtest", "playtest:gpu", "playtest:soak", "playtest:watch",
    "audit", "audit:gpu",
    "webgpu:check", "webgpu:check:local",
}

# Already routed through the broker (either entry point), or explicitly opted
# out by name. `test:raw` is the documented escape hatch and stays open — the
# point is that bypassing the meter must be something you TYPED, not something
# you inherited from an old checkout.
ALREADY_METERED = re.compile(r"\bpk-run\.sh\b|\bwith-cores\.sh\b")

# `cd <dir> && …` decides which package.json the command will actually read.
CD_TARGET = re.compile(r"(?:^|[;&|(]|\n|&&)\s*cd\s+(?:--\s+)?([^\s;&|]+)")


def deny(problem: str, remedy: str) -> None:
    sys.stderr.write(f"BLOCKED — {problem}\n\n{remedy}\n")
    sys.exit(2)


def effective_dir(cmd: str, cwd: str) -> Path:
    """Where the command will actually run: its first `cd`, else the session cwd."""
    m = CD_TARGET.search(cmd)
    if m:
        target = os.path.expanduser(m.group(1).strip("'\""))
        p = Path(target if os.path.isabs(target) else os.path.join(cwd, target))
        if p.is_dir():
            return p
    return Path(cwd)


def checkout_root(d: Path) -> Path | None:
    """The braindeadbot-client checkout `d` belongs to, or None.

    Asks git for the COMMON dir, so a worktree resolves to the repo it was cut
    from — the worktrees under sun/.worktrees/ have no "braindeadbot-client" in
    their path at all, and a path-substring test would silently skip every one
    of them.
    """
    common = git(["rev-parse", "--git-common-dir"], d)
    top = git(["rev-parse", "--show-toplevel"], d)
    if not common or not top:
        return None
    common_path = Path(common) if os.path.isabs(common) else (d / common)
    try:
        if common_path.resolve().parent != repo_home():
            return None
    except OSError:
        return None
    return Path(top)


def script_body(root: Path, name: str) -> str | None:
    try:
        pkg = json.loads((root / "package.json").read_text())
    except Exception:
        return None
    body = pkg.get("scripts", {}).get(name)
    return body if isinstance(body, str) else None


def pk_run_for(root: Path) -> str:
    """The wrapper to recommend: this checkout's own, else the primary's."""
    local = root / "scripts" / "ops" / "pk-run.sh"
    return "scripts/ops/pk-run.sh" if local.is_file() else str(repo_home() / "scripts" / "ops" / "pk-run.sh")


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if payload.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if not cmd or ALREADY_METERED.search(cmd):
        sys.exit(0)

    hits_vitest = INVOKES_VITEST.search(cmd) and not VITEST_IS_HARMLESS.search(cmd)
    hits_browser = BROWSER_HARNESS.search(cmd)
    npm_hits = [m.group(1) for m in NPM_SCRIPT.finditer(cmd) if m.group(1) in GUARDED_SCRIPTS]
    if not (hits_vitest or hits_browser or npm_hits):
        sys.exit(0)

    root = checkout_root(effective_dir(cmd, payload.get("cwd") or os.getcwd()))
    if root is None:
        sys.exit(0)  # another repo entirely — not ours to police
    pk = pk_run_for(root)

    if hits_vitest:
        deny(
            "this runs vitest unmetered, so it sizes its worker pool from nproc and "
            "takes every logical CPU on a box several sessions share.",
            f"Run `npm test` (metered) or wrap it:\n"
            f"  {pk} --class test -- npx vitest run <paths>\n"
            f"`npm run ops:status` shows what is already held; PK_TEST_THREADS sets the "
            f"ask. If you truly want the unmetered run, `npm run test:raw` says so out "
            f"loud — and its timings are not comparable to anything.",
        )

    if hits_browser:
        deny(
            "this drives a real browser unmetered: it takes a GPU context and a detached "
            "Windows Chrome that outlives the run, and neither shows up in /proc.",
            f"Wrap it so the cost is on the books:\n"
            f"  {pk} --class webgpu -- <the same command>\n"
            f"or use the wrapped aliases (`npm run playtest:gpu`, `npm run audit:gpu`).",
        )

    # The subtle one: the command is right, the CHECKOUT is old. Read the script
    # body that will actually run rather than trusting the command's spelling.
    for name in npm_hits:
        body = script_body(root, name)
        if body is None or ALREADY_METERED.search(body):
            continue
        deny(
            f"`{name}` in {root} is the pre-meter script (`{body}`), so this command is "
            f"metered in the main checkout and unmetered here — same words, different box "
            f"behaviour.",
            f"Either bring the meter into this worktree (`git merge main`), or call it "
            f"directly:\n"
            f"  {pk} --class test -- npx vitest run <paths>\n"
            f"`npm run ops:status` shows what is already held.",
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
