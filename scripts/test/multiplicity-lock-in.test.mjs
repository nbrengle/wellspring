// multiplicity-lock-in.test.mjs — CHARACTERIZATION tests for the "how many of
// this can I have, from what sources" behavior, ahead of the #225 consolidation.
//
// Multiplicity/purchasability is currently decided across FOUR disconnected sites
// (OVER_CAP in resolve.ts, the powers `powerCounts` loop in prereqs.ts, the
// param-distinct identity in resolve.ts getIdentity, and the bestow-reconciliation
// loop in resolve.ts:302). #225 will consolidate them into ONE pass. These tests
// pin the OBSERVABLE behavior so that consolidation can be proven behavior-preserving
// — they must stay green through the refactor.
//
// The domain rule (Agile Learner / Extensive Combat Training skills): "the Power
// cannot be one the character already has." The two concerns it splits into:
//   - RESOLUTION: a bestow coinciding with a purchase → the bestow wins, the
//     purchase becomes free. Not an error (the bestow legitimately makes it free).
//   - VALIDATION: surplus PURCHASES with no bestow → an illegal build, surfaced.
// A bad IMPORT can carry either, so validation must surface the illegal one rather
// than silently absorbing it. These tests lock exactly that boundary.

import { test, eq, ok } from "./harness.mjs";
import { makeChar } from "./make-char.mjs";
import { validate } from "../../src/engine/validate.js";
import { computeSpend } from "../../src/engine/testing.js";

// ── VALIDATION: a bad import that took the same power twice (no bestow) must
//    SURFACE — not pass silently, not get quietly refunded to free. ────────────
test("duplicate purchased power surfaces as an invalid build (bad import)", () => {
  const c = makeChar("Fighter 4", { lineage: "Human", add: ["Parry Blow", "Parry Blow"] });
  const r = validate(c);
  ok(!r.valid, "a power taken twice is an invalid build");
  ok(
    r.prereqs.issues.some((i) => i.item === "Parry Blow" && /only be taken once/.test(i.text || "")),
    "the duplicate is flagged with a message, not silently absorbed",
  );
});

test("a power taken once is NOT flagged as a duplicate (no false positive)", () => {
  const c = makeChar("Fighter 4", { lineage: "Human", add: ["Parry Blow"] });
  const r = validate(c);
  ok(
    !r.prereqs.issues.some((i) => i.item === "Parry Blow" && /only be taken once/.test(i.text || "")),
    "single copy is legal",
  );
});

// ── RESOLUTION: a bestow (Sharp Mind bestows Library Use) coinciding with a
//    purchase of the same skill → the bestow wins, the purchase is refunded to
//    FREE, and it is NOT an error. This is the legitimate case the validation
//    path must NOT flag. ───────────────────────────────────────────────────────
test("a bestow coinciding with a purchase makes the purchase free (not an error)", () => {
  const c = makeChar("Mage 4", { add: ["Sharp Mind", "Library Use"] });
  const spend = computeSpend(c);
  const purchased = spend.byItem["skills:Library Use"];
  ok(purchased, "the purchased Library Use has a ledger entry");
  eq(purchased.cost, 0, "purchase refunded to free — the bestow won");
  eq(purchased.bestow?.source, "Sharp Mind", "attributed to the bestowing entity");
  ok(
    validate(c).prereqs.issues.every((i) => i.item !== "Library Use"),
    "a bestow+purchase coincidence is NOT flagged",
  );
});

// ── VALIDATION: buying more of a cap-1 entity than allowed (Weapon Specialization,
//    two weapon types) is over-cap → surfaced as illegal. Guards the OVER_CAP path
//    distinctly from the powers "taken once" path above. ─────────────────────────
test("over-cap purchase of a cap-1 entity surfaces (Weapon Specialization x2)", () => {
  const c = makeChar("Fighter 4", {
    add: [
      { name: "Weapon Specialization", param: "Swords" },
      { name: "Weapon Specialization", param: "Axes" },
    ],
  });
  const r = validate(c);
  ok(!r.valid, "two Weapon Specializations exceed the cap of 1");
  ok(
    r.prereqs.issues.some((i) => /Weapon Specialization/.test(i.item) && /can only be taken once/.test(i.text || "")),
    "the over-cap purchase is flagged",
  );
});
