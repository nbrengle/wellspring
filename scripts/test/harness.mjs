// harness.mjs — the zero-dependency test runner shared by every test file.
//
// Tests live in per-domain files (scripts/test/*.test.mjs) that each import
// `{ test, eq, ok }` from here and own their OWN imports. This is deliberate: a
// new feature adds its test + imports to its domain file, so two features no
// longer collide on one giant shared import block (the old scripts/test.mjs
// hotspot). The entry (scripts/test.mjs) imports every domain file, then calls
// report() once for a single pass/fail tally + exit code.

import { Source, isPurchased, isStarting } from "../../src/engine/types.js";

// Re-exported so test files build/read structured sources without each importing
// from the engine directly (they already import test helpers from here).
export { Source, isPurchased, isStarting };

let passed = 0;
const failures = [];

export function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(`${name}: ${e.message}\n${e.stack}`); }
}

export function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function ok(cond, msg = '') { if (!cond) throw new Error(msg || 'expected truthy'); }

// Build the V2 `skills` bucket (source 'Purchased') from skill names (or
// {name,ranks}). Purchased skills are V2-native (CharacterChoice[]), so a test
// that used to pass `purchasedSkills: ['Lore (Arcane)']` now spreads
// `...pSkills(['Lore (Arcane)'])` into the character literal. The engine keys
// these under the `skills:` prefix in the BP ledger.
export function pSkills(names) {
  return {
    skills: names.map((n) =>
      typeof n === 'string'
        ? { entityId: n, source: Source.purchased(), ranks: 1 }
        : { entityId: n.name, source: Source.purchased(), ranks: n.ranks ?? 1 }),
  };
}

// Same, for the V2 `perks` bucket (source 'Purchased'). A test that used to pass
// `purchasedPerks: ['Toughness']` now spreads `...pPerks(['Toughness'])`. The BP
// ledger keys these under the `purchasedPerks:` prefix.
export function pPerks(names) {
  return {
    perks: names.map((n) =>
      typeof n === 'string'
        ? { entityId: n, source: Source.purchased(), ranks: 1 }
        : { entityId: n.name, source: Source.purchased(), ranks: n.ranks ?? 1 }),
  };
}

// Printed once by the entry after all domain files have registered their tests.
export function report() {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('✓ all green');
}
