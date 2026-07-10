#!/usr/bin/env node
// tsc-ratchet.mjs — RATCHET gates for `tsc --noEmit`.
//
// Two gates run here, both with the same discipline (mirror the eslint
// --max-warnings ratchet): the error count must never EXCEED its baseline, and
// when it drops the baseline should be lowered to match. New code can't add
// errors; every migration step only ratchets down.
//
//   STRICT gate      — plain `tsc --noEmit` (tsconfig as-is). Baseline 0: a hard
//                       gate. Any error fails the build.
//   NO-IMPLICIT-ANY  — `tsc --noEmit --noImplicitAny`. tsconfig ships with
//   gate               noImplicitAny:false, so the untyped-param / untyped-index
//                       debt (TS7006 / TS7053, all in src/engine/*) is invisible
//                       to the strict gate. This second gate makes that debt
//                       count and forces it down. See issue #177.
//
// Goal: drive NO_IMPLICIT_ANY_BASELINE to 0, then flip `noImplicitAny: true` in
// tsconfig.json, delete this second gate, and the strict gate covers everything.

import { execSync } from "node:child_process";

function tscErrorCount(cmd) {
  let out = "";
  try {
    execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  return { count: (out.match(/error TS\d+/g) || []).length, out };
}

// A single ratchet check. Returns true on regression (caller exits non-zero).
function gate(label, cmd, baseline) {
  const { count, out } = tscErrorCount(cmd);

  if (count > baseline) {
    console.error(`✗ ${label}: ${count} type errors — ABOVE the ratchet baseline of ${baseline}.`);
    console.error("  New type errors were introduced. Fix them (or, if intentional, they");
    console.error("  belong to pre-existing debt you should be reducing, not growing).");
    console.error(
      "\n" +
        out
          .split("\n")
          .filter((l) => /error TS/.test(l))
          .slice(0, 40)
          .join("\n"),
    );
    return true;
  }

  if (count < baseline) {
    console.error(`✓ ${label}: ${count} type errors — BELOW the baseline of ${baseline}.`);
    console.error(`  Nice — lower the baseline in scripts/tsc-ratchet.mjs to ${count} to lock the gain in.`);
    return true;
  }

  console.log(`✓ ${label}: ${count} type errors — at the ratchet baseline (${baseline}). No regression.`);
  return false;
}

// STRICT gate — hard: tsconfig as-is must be clean.
const STRICT_BASELINE = 0;
// NO-IMPLICIT-ANY gate — untyped-param / untyped-index debt (issue #177). Lower as it drops.
const NO_IMPLICIT_ANY_BASELINE = 296;

const regressed =
  gate("tsc (strict)", "npx tsc --noEmit", STRICT_BASELINE) |
  gate("tsc (--noImplicitAny)", "npx tsc --noEmit --noImplicitAny", NO_IMPLICIT_ANY_BASELINE);

if (regressed) process.exit(1);
