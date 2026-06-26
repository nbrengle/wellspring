// harness.mjs — the zero-dependency test runner shared by every test file.
//
// Tests live in per-domain files (scripts/test/*.test.mjs) that each import
// `{ test, eq, ok }` from here and own their OWN imports. This is deliberate: a
// new feature adds its test + imports to its domain file, so two features no
// longer collide on one giant shared import block (the old scripts/test.mjs
// hotspot). The entry (scripts/test.mjs) imports every domain file, then calls
// report() once for a single pass/fail tally + exit code.

let passed = 0;
const failures = [];

export function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(`${name}: ${e.message}`); }
}

export function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function ok(cond, msg = '') { if (!cond) throw new Error(msg || 'expected truthy'); }

// Printed once by the entry after all domain files have registered their tests.
export function report() {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('✓ all green');
}
