#!/usr/bin/env node

/**
 * Lazycat Room/Object Audit Script
 *
 * Automatically checks a source file against project conventions.
 * Usage: node scripts/audit-room-object.js <path-to-file>
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed
 */

import { readFileSync, existsSync } from "fs";
import { basename, extname, resolve } from "path";

const PASS = "\x1b[32m✅ PASS\x1b[0m";
const FAIL = "\x1b[31m❌ FAIL\x1b[0m";
const WARN = "\x1b[33m⚠️  WARN\x1b[0m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/audit-room-object.js <path-to-file>");
  process.exit(1);
}

const fullPath = resolve(file);
if (!existsSync(fullPath)) {
  console.error(`File not found: ${fullPath}`);
  process.exit(1);
}

const src = readFileSync(fullPath, "utf-8");
const lines = src.split("\n");
const fileName = basename(fullPath);
const ext = extname(fileName);

let failCount = 0;
let warnCount = 0;
let passCount = 0;

function check(label, pass, detail = "") {
  if (pass) {
    console.log(`  ${PASS}  ${label}`);
    passCount++;
  } else {
    console.log(`  ${FAIL}  ${label}${detail ? ` — ${detail}` : ""}`);
    failCount++;
  }
}

function warn(label, pass, detail = "") {
  if (pass) {
    console.log(`  ${PASS}  ${label}`);
    passCount++;
  } else {
    console.log(`  ${WARN}  ${label}${detail ? ` — ${detail}` : ""}`);
    warnCount++;
  }
}

console.log(`\n${BOLD}🔍 Lazycat Audit: ${fileName}${RESET}\n`);

// ── 1. File Extension ──
console.log(`${BOLD}📁 File Structure${RESET}`);
check("File is .js", ext === ".js", `Got ${ext}`);

// ── 2. Kebab-case filename ──
const isKebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.js$/.test(fileName);
check("Filename is kebab-case", isKebab, `"${fileName}" should be kebab-case`);

// ── 3. Correct suffix ──
const isRoom = fileName.endsWith("-room.js");
const isGame = fileName.endsWith("-game.js");
const isObject = !isRoom && !isGame;
const fileType = isRoom ? "Room" : isGame ? "Game" : "Object";
console.log(`  ℹ️  Detected type: ${fileType}`);

// ── 4. JSDoc module header ──
console.log(`\n${BOLD}📝 Code Conventions${RESET}`);
const hasJSDoc = /^\/\*\*[\s\S]*?\*\//.test(src.trimStart());
check(
  "JSDoc module header at top of file",
  hasJSDoc,
  "Add a /** ... */ block describing the module",
);

// ── 5. ES Module imports ──
const hasRequire = /require\s*\(/.test(src);
check("Uses ES Modules (no require())", !hasRequire, "Found require() — use import/export instead");

const hasThreeImport = /import\s+\*\s+as\s+THREE\s+from\s+["']three["']/.test(src);
check('Imports THREE correctly (import * as THREE from "three")', hasThreeImport);

// ── 6. createToonMaterial usage ──
const usesToonMaterial = /createToonMaterial/.test(src);
const importsToonMaterial = /import\s*\{[^}]*createToonMaterial[^}]*\}\s*from/.test(src);
if (usesToonMaterial) {
  check("Imports createToonMaterial from shaders", importsToonMaterial);
}

// ── 7. Named exports ──
const exports = [
  ...src.matchAll(/export\s+(?:function|const|let|class|async\s+function)\s+(\w+)/g),
].map((m) => m[1]);
if (isGame) {
  const hasLaunch = exports.some((e) => /^launch/.test(e));
  check(
    "Game exports a launch*() function",
    hasLaunch,
    `Found exports: ${exports.join(", ") || "none"}`,
  );
} else if (isRoom) {
  const hasCreate = exports.some((e) => /^create/.test(e));
  check(
    "Room exports a create*() function",
    hasCreate,
    `Found exports: ${exports.join(", ") || "none"}`,
  );
} else {
  const hasCreate = exports.some((e) => /^create/.test(e));
  warn(
    "Object exports a create*() function",
    hasCreate,
    `Found exports: ${exports.join(", ") || "none"}`,
  );
}

// ── 8. THREE.Group naming ──
const groupCreations = [...src.matchAll(/new\s+THREE\.Group\(\)/g)];
const groupNames = [...src.matchAll(/\.name\s*=\s*["'][^"']+["']/g)];
if (groupCreations.length > 0) {
  check(
    "THREE.Group instances have .name set",
    groupNames.length > 0,
    `Found ${groupCreations.length} Group(s) but ${groupNames.length} .name assignments`,
  );
}

// ── 9. Constants convention ──
const constDecls = [...src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=/g)].map((m) => m[1]);
const hasScreamingConsts = constDecls.length > 0;
warn(
  "Uses SCREAMING_SNAKE_CASE constants",
  hasScreamingConsts,
  "Add top-level constants for dimensions, speeds, etc.",
);

// ── 10. Dispose / cleanup ──
console.log(`\n${BOLD}🧹 Cleanup & Memory${RESET}`);
const hasDispose = /\.dispose\(\)/.test(src);
const hasCleanup = /dispose|cleanup|teardown|destroy|exit/i.test(src);
check(
  "Has dispose/cleanup logic",
  hasDispose || hasCleanup,
  "Must dispose geometries and materials on exit",
);

if (isGame) {
  // Games should remove event listeners
  const hasRemoveListener = /removeEventListener/.test(src);
  check(
    "Removes event listeners on exit",
    hasRemoveListener,
    "Must clean up keydown/keyup/click listeners",
  );

  // Games should remove HUD
  const hasHUDRemoval = /remove\(\)|removeChild|innerHTML\s*=\s*["']/.test(src);
  warn("Removes HUD/overlay elements on exit", hasHUDRemoval);

  // Games should cancel animation frames
  const hasCancelRAF = /cancelAnimationFrame/.test(src);
  warn("Cancels requestAnimationFrame on exit", hasCancelRAF);
}

// ── 11. Audio safety ──
console.log(`\n${BOLD}🔊 Audio${RESET}`);
const hasAudio = /AudioContext|audioCtx/.test(src);
if (hasAudio) {
  const hasTryCatch = /try\s*\{[\s\S]*?audioCtx[\s\S]*?catch/.test(src);
  check("Audio wrapped in try/catch", hasTryCatch);

  const hasResumeCheck = /audioCtx\.state/.test(src);
  check("Checks audioCtx.state before playing", hasResumeCheck);
} else {
  console.log("  ℹ️  No AudioContext usage detected (OK)");
}

// ── 12. Performance ──
console.log(`\n${BOLD}⚡ Performance${RESET}`);
const getByNameInLoop =
  /(?:for|while|function\s+animate|function\s+update)[\s\S]{0,200}getObjectByName/;
const hasBadLookup = getByNameInLoop.test(src);
warn(
  "No getObjectByName() in hot loops (cache references)",
  !hasBadLookup,
  "Cache getObjectByName() results in module-level vars",
);

const instancedMeshUse = /InstancedMesh/.test(src);
const manyIdentical = [...src.matchAll(/new\s+THREE\.Mesh\(/g)].length;
if (manyIdentical > 20 && !instancedMeshUse) {
  warn(
    `Consider InstancedMesh (${manyIdentical} Mesh instances found)`,
    false,
    "Use InstancedMesh for >20 identical objects",
  );
} else if (instancedMeshUse) {
  console.log(`  ${PASS}  Uses InstancedMesh for batched rendering`);
  passCount++;
}

// ── 13. Material best practices ──
console.log(`\n${BOLD}🎨 Materials${RESET}`);
const standardMats = [...src.matchAll(/new\s+THREE\.MeshStandardMaterial\(\{([^}]+)\}/g)];
let missingRoughness = 0;
for (const m of standardMats) {
  if (!/roughness/.test(m[1])) missingRoughness++;
}
if (standardMats.length > 0) {
  warn(
    "MeshStandardMaterial has roughness/metalness",
    missingRoughness === 0,
    `${missingRoughness}/${standardMats.length} materials missing roughness`,
  );
}

// ── Summary ──
console.log(`\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
console.log(
  `${BOLD}Results:${RESET} ${passCount} passed, ${failCount} failed, ${warnCount} warnings`,
);
console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

if (failCount > 0) {
  console.log(
    `\x1b[31m${BOLD}ACTION REQUIRED: Fix ${failCount} failing check(s) before merging.${RESET}\n`,
  );
  process.exit(1);
} else if (warnCount > 0) {
  console.log(
    `\x1b[33m${BOLD}Review ${warnCount} warning(s) — these are recommendations.${RESET}\n`,
  );
  process.exit(0);
} else {
  console.log(`\x1b[32m${BOLD}All checks passed! 🎉${RESET}\n`);
  process.exit(0);
}
