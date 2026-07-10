#!/usr/bin/env node
// tsc-ratchet.mjs — a RATCHET gate for `tsc --noEmit`.
//
// The engine still carries pre-existing untyped-TS debt (mostly `any`/`never` in
// graph.ts and the validators). The north star is zero, but until then this gate
// enforces the ratchet: the type-error count must never EXCEED the baseline below,
// and when it drops the baseline should be lowered to match (same discipline as the
// eslint --max-warnings ratchet). New code can't add type errors; every migration
// step only ratchets it down.
//
// Lower BASELINE whenever the real count drops. Goal: 0, then flip this to a hard
// `tsc --noEmit` (any error fails) and delete the ratchet.

import { execSync } from "node:child_process";

const BASELINE = 173;

let out = "";
try {
  execSync("npx tsc --noEmit", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  out = `${e.stdout || ""}${e.stderr || ""}`;
}

const count = (out.match(/error TS\d+/g) || []).length;

if (count > BASELINE) {
  console.error(`✗ tsc: ${count} type errors — ABOVE the ratchet baseline of ${BASELINE}.`);
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
  process.exit(1);
}

if (count < BASELINE) {
  console.error(`✓ tsc: ${count} type errors — BELOW the baseline of ${BASELINE}.`);
  console.error(`  Nice — lower BASELINE in scripts/tsc-ratchet.mjs to ${count} to lock the gain in.`);
  process.exit(1);
}

console.log(`✓ tsc: ${count} type errors — at the ratchet baseline (${BASELINE}). No regression.`);
