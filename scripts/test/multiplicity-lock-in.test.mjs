// multiplicity-lock-in.test.mjs — behavior tests for "how many of this can I have,
// from what sources," the domain #225 unifies into one identity/reconciliation pass.
//
// The decided model (see #225):
//   - Power/skill identity is the ABILITY (name): same name = same power. You have
//     it or you don't (Cancel from two casters, Reload from two classes — one ability).
//   - "Having it twice" is never an illegal build. A grant coinciding with a purchase
//     REFUNDS the purchase to free; redundant grants dedup. Same rule for skills AND
//     powers (the old powers-only `powerCounts` diverged and is retired).
//   - The ONE genuine error is buying MORE PURCHASES of a cap-limited thing than its
//     cap allows (OVER_CAP) — an illegal build. Duplicates otherwise only arrive via a
//     bad import (the picker blocks re-taking an owned power) and dedup harmlessly.
//
// These lock the reachable, decided behavior so the consolidation can't regress it.

import { test, eq, ok } from "./harness.mjs";
import { makeChar } from "./make-char.mjs";
import { validate } from "../../src/engine/validate.js";
import { computeSpend } from "../../src/engine/testing.js";

// ── OVER-CAP (illegal build): buying MORE PURCHASES of a cap-1 entity than allowed
//    is the one real duplicate error, and it surfaces with a message. ──────────────
test("over-cap PURCHASES of a cap-1 entity surface (Weapon Specialization x2)", () => {
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
    "the over-cap purchase is flagged with a message",
  );
});

// ── RESOLUTION: a grant coinciding with a purchase makes the purchase FREE and is
//    NOT an error — for skills. (Powers must behave the same; see below.) ───────────
test("a grant coinciding with a purchased skill makes the purchase free (not an error)", () => {
  const c = makeChar("Mage 4", { add: ["Sharp Mind", "Library Use"] });
  const spend = computeSpend(c);
  const purchased = spend.byItem["skills:Library Use"];
  ok(purchased, "the purchased Library Use has a ledger entry");
  eq(purchased.cost, 0, "purchase refunded to free — the grant won");
  ok(
    validate(c).prereqs.issues.every((i) => i.item !== "Library Use"),
    "a grant+purchase coincidence is NOT flagged as invalid",
  );
});

// ── SAME ABILITY, ONE COPY: a single copy of a power is never a duplicate. ─────────
test("a power taken once is never flagged as a duplicate", () => {
  const c = makeChar("Fighter 4", { lineage: "Human", add: ["Parry Blow"] });
  const r = validate(c);
  ok(
    !r.prereqs.issues.some((i) => i.item === "Parry Blow" && /taken once|selected \d/.test(i.text || "")),
    "a single copy is legal",
  );
});
