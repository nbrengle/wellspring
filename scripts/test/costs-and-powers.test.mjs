// costs-and-powers.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
// imports so concurrent features don't collide on one shared import block.
import { test, eq, ok, purchasedSkills, isPurchased } from "./harness.mjs";
import { makeChar } from "./make-char.mjs";
import { validate, characterLevel } from "../../src/engine/validate.js";
import {
  budgetFor,
  computeSlots,
  spellSlots,
  devotionState,
  prereqStatus,
  LEVEL_CAP,
  LEGAL_MIN_LEVEL,
  bestowedAbilities,
  computeSpend,
  getMaxRanks,
  bookcasterSpellOptions,
  arcaneSecretsSpellOptions,
  eligibleClassChoices,
  agileLearnerCapacity,
  basicSpellOptions,
} from "../../src/engine/testing.js";
import { bareSkill, cleanItemName, getClasses, formatParameterizedName } from "../../src/engine/resolver.js";
import {
  solveCrafting,
  RECIPES,
  resolveRecipe,
  classifyIngredient,
  buildCraftTree,
} from "../../src/engine/recipe-solver.js";
import { readFileSync } from "node:fs";
import {
  lookupEntity,
  eligiblePowers,
  DEVOTIONS,
  DOMAINS,
  REFS,
  CLASSES,
  LINEAGES,
  lineageChoiceSpec,
  lineageItemImpact,
  ALLERGEN_AWARDS,
  allergenOptions,
  allergenAward,
  powerSpellChoiceSpec,
} from "../../src/engine/data.js";
import { resolveCharacterGraph } from "../../src/engine/graph.js";
import {
  hasStartingChoices,
  reconcileStartingChoices,
  rebuildStartingSkills,
  STARTING_CHOICES_CONFIG,
  optionSkills,
  resolveSkill,
  configSkillKeys,
  sourceStartingSkillKeys,
} from "../../src/engine/starting-choices.js";
import ARCHETYPES from "../../src/data/archetypes.json" with { type: "json" };
import CLASSES_JSON from "../../src/data/classes.json" with { type: "json" };

// A character built straight from an archetype mirrors what loadArchetype keeps.
const fromArchetype = (a) => ({ ...a, archetypeName: a.name });

// ─── grants: a source grants a named ability, for free (kind #1) ──────────────
test("lineage advantage grants the named perk (Aewen → Magical Resilience)", () => {
  const c = { lineage: "Aewen", lineageAdvantages: ["Mystic Resilience"] };
  const g = bestowedAbilities(c);
  ok(
    g.list.some((x) => x.ability === "perks:Magical Resilience"),
    "Magical Resilience granted",
  );
  eq(g.list.find((x) => x.ability === "perks:Magical Resilience").source, "Mystic Resilience", "source name");
});
test("a slot-grant advantage is NOT a named entity grant (Aewen Deep Reserves)", () => {
  const c = { lineage: "Aewen", lineageAdvantages: ["Deep Reserves"] };
  eq(bestowedAbilities(c).list.length, 0, "no named-entity grant");
});
test("an in-play Grant (sub-power) is NOT bestowed on the owner of the granting power", () => {
  // Holding Out for a Hero's Call is an in-play "Grant Power: Save the Day" (conferred
  // on a target when used), NOT a build-time bestowal. So Save the Day must not appear
  // as a bestowal on the character who owns Holding Out for a Hero.
  const c = makeChar("Socialite 10", { add: ["The Right Hand", "Holding Out for a Hero"] });
  const g = bestowedAbilities(c);
  ok(
    !g.list.some((x) => x.ability === "powers:Save the Day"),
    "Save the Day is an in-play Grant to a target, not bestowed on the owner",
  );
});
test("a BESTOW_SOURCE grant materializes as a free, non-removable owned item (Way of the Blade → Weapon Spec)", () => {
  // Uniform engine-driven grants: a power that grants a named entity surfaces that
  // entity as an owned item (one render path, regardless of grant source) so the UI
  // shows + can parameterize it — instead of the grant living only as a hidden effect.
  // The materialized row carries sourceType:'grant' + index:-1 so the build sheet's
  // canRemove (sourceType === 'purchased' && index>=0) is false: a granted ability isn't deletable.
  const c = makeChar("Rogue 4", { add: ["Way of the Blade"], choices: { "powers:Way of the Blade": "Daggers" } });
  const r = validate(c);
  const granted = (r.owned?.bestowedSkills || []).filter((x) => x.bestowedBy === "Way of the Blade");
  eq(granted.length, 2, "both granted skills surface (Weapon Spec - Daggers + Two Weapon Style)");
  const spec = granted.find((x) => /^Weapon Spec/.test(x.name));
  ok(spec, "the parameterized Weapon Specialization grant is present");
  eq(/Daggers/.test(spec.name), true, "parameterized with the Way-of-the-Blade choice (Daggers)");
  eq(spec.field, "skills", "lands in a *Bestow field (engine-materialized, not a purchase)");
  eq(spec.sourceType, "bestow", "sourceType bestow so the UI treats it as non-removable");
  eq(spec.index, -1, "index -1 → canRemove false");
  eq(spec.cost?.cost ?? 0, 0, "bestowed ability is free");
});
test("a grant refunds a matching parameterized purchase, by parameter (Way of the Blade → Weapon Spec)", () => {
  // Way of the Blade (choosing Daggers) grants "Weapon Specialization - Daggers".
  // A previously-PURCHASED "Weapon Specialization (Daggers)" must go free + attributed
  // — the dash vs parens form must not block the match. A different weapon must NOT.
  const daggers = computeSpend(
    makeChar("Rogue 4", {
      add: ["Weapon Specialization (Daggers)", "Way of the Blade"],
      choices: { "powers:Way of the Blade": "Daggers" },
    }),
  );
  const dk = daggers.byItem["skills:Weapon Specialization (Daggers)"];
  eq(dk.cost, 0, "matching weapon → refunded to free");
  eq(dk.bestow?.source, "Way of the Blade", "attributed to the granting power");

  const swords = computeSpend(
    makeChar("Rogue 4", {
      add: ["Weapon Specialization (Swords)", "Way of the Blade"],
      choices: { "powers:Way of the Blade": "Daggers" },
    }),
  );
  eq(
    swords.byItem["skills:Weapon Specialization (Swords)"].cost,
    4,
    "different weapon → NOT refunded (parameter precision)",
  );
});
test("a selected power that grants a perk zeroes that perk (Implicit Truths → Insight)", () => {
  const c = makeChar("Socialite 4", { add: ["Implicit Truths", "Insight"] });
  const eff = computeSpend(c).byItem["purchasedPerks:Insight"];
  eq(eff.cost, 0, "Insight free");
  eq(eff.bestow.source, "Implicit Truths", "grant source attributed");
  ok(eff.bestow.derived, "derived from the graph, not a sidecar");
});

test("a fixed power grant with parameters surfaces BOTH (Lessons from Scars → 2 Lores)", () => {
  // Lessons from Scars "gains Lore: Historical (2), Lore: Noble (2) Perks" — a FIXED
  // (non-choice) grant of two PARAMETERIZED skills. Both must materialize, free, and
  // distinctly (not collapse to one bare "Lore"). The in-play "Choose one target…"
  // sentence in the same description must NOT suppress the grant.
  const owned = validate(makeChar("Fighter 6", { add: ["Lessons from Scars"] })).owned;
  const granted = (owned?.bestowedSkills || []).filter((s) => s.bestowedBy === "Lessons from Scars");
  eq(granted.length, 2, "both Lore grants surface");
  ok(
    granted.some((s) => /Historical/.test(s.name)) && granted.some((s) => /Noble/.test(s.name)),
    "distinct parameters preserved (Historical + Noble)",
  );
  ok(
    granted.every((s) => (s.cost?.cost ?? 0) === 0),
    "both free",
  );
});
test("a choice-gated grant does NOT grant every option for free (The Learned One)", () => {
  // The Learned One is "choose one of 8 at level-up" (chooseOne kind:play). Its
  // REFS.grants lists all 8 — emitting them flat would grant all for free. The
  // structured chooseOne must gate them, so zero auto-grants.
  const owned = validate(makeChar("Artisan 10", { add: ["The Learned One"] })).owned;
  eq(
    (owned?.skills || []).filter((s) => s.bestowedBy === "The Learned One").length,
    0,
    "no flat grant — the choice gates it",
  );
});

// ─── discount sources: category, firstN, refund-if-free, cap ──────────────────
test("Human Environmental Mastery discounts a Gathering skill by 1", () => {
  const c = { lineage: "Human", lineageAdvantages: ["Environmental Mastery"], ...purchasedSkills(["Forage I"]) };
  const s = computeSpend(c);
  eq(s.byItem["skills:Forage I"].cost, 2, "Forage 3→2");
  eq(s.byItem["skills:Forage I"].discount.source, "Environmental Mastery", "source on chip");
});
test("Lost Wisdom of Many discounts only the first three Lore skills", () => {
  const c = {
    lineage: "Lost",
    lineageAdvantages: ["Wisdom of Many"],
    ...purchasedSkills(["Lore (History)", "Lore (Religion)", "Lore (Arcana)", "Lore (Nature)"]),
  };
  const s = computeSpend(c);
  eq(s.byItem["skills:Lore (History)"].cost, 1, "1st discounted");
  eq(s.byItem["skills:Lore (Arcana)"].cost, 1, "3rd discounted");
  eq(s.byItem["skills:Lore (Nature)"].cost, 2, "4th full");
});

test("Patron discounts gift-eligible perks by 1, excludes Strong Bloodline + Gifts", () => {
  const c = makeChar("Cleric 4", { add: ["Patron", "Greedy Soul", "Strong Bloodline"] });
  const s = computeSpend(c);
  eq(s.byItem["purchasedPerks:Greedy Soul"].cost, 2, "Greedy Soul 3→2");
  eq(s.byItem["purchasedPerks:Greedy Soul"].discount.source, "Patron", "attributed to Patron");
  eq(s.byItem["purchasedPerks:Strong Bloodline"].cost, 3, "Strong Bloodline excluded");
});

// ─── Ritual Affinity: per-class level-gated BP discount ──────────────────────────
// The innate power (Cleric+Mage) makes Journeyman Ritual Magic cost 1 less at the
// GRANTING class's L7, and Greater at L12, refunding retroactively (auto via
// recompute). Gate is per granting class, so a multiclass discounts each track
// independently. Parser emits levelDiscounts; validate applies them per class.
test("Ritual Affinity discounts Ritual Magic at the granting class level", () => {
  const cost = (c, skill) => {
    const s = computeSpend(c);
    const k = Object.keys(s.byItem).find((x) => x.endsWith(`:${skill}`));
    return s.byItem[k]?.cost;
  };
  eq(
    cost(makeChar("Cleric 4", { add: ["Journeyman Ritual Magic"] }), "Journeyman Ritual Magic"),
    2,
    "L4: gate not met, full 2",
  );
  eq(
    cost(makeChar("Cleric 7", { add: ["Journeyman Ritual Magic"] }), "Journeyman Ritual Magic"),
    1,
    "L7: Journeyman 2→1",
  );
  eq(
    cost(makeChar("Cleric 7", { add: ["Greater Ritual Magic"] }), "Greater Ritual Magic"),
    3,
    "L7: Greater gate (L12) not met, full 3",
  );
  eq(cost(makeChar("Cleric 12", { add: ["Greater Ritual Magic"] }), "Greater Ritual Magic"), 2, "L12: Greater 3→2");
  // Multiclass: Cleric track at 12 gates Greater; the discount fires once.
  eq(
    cost(makeChar("Cleric 12, Mage 4", { add: ["Greater Ritual Magic"] }), "Greater Ritual Magic"),
    2,
    "Cleric12 track discounts Greater",
  );
  // No Ritual Affinity → no discount; no leak to similarly-named skills.
  eq(cost(makeChar("Fighter 7", { add: ["Journeyman Ritual Magic"] }), "Journeyman Ritual Magic"), 2, "no RA → full");
  eq(cost(makeChar("Cleric 12", { add: ["Greater Alchemy"] }), "Greater Alchemy"), 5, "no leak to Greater Alchemy");
});

// ─── shared powers: same-named cross-class powers stay mechanically equivalent ───
// A/B distinction is in the parser: `sharedWith` lists every offering class; a
// per-class level-scaled discount is `levelDiscounts`. Shared powers must be
// mechanically equivalent (cost/refresh) EXCEPT where they carry levelDiscounts
// (Ritual Affinity) — so a future edit that makes a shared copy diverge fails loud.
test("shared powers are mechanically equivalent unless level-scaled", () => {
  const TIERS = [
    "innate",
    "utility",
    "basic",
    "advanced",
    "veteran",
    "classSkills",
    "rightHandPowers",
    "cantrips",
    "noviceSpells",
    "adeptSpells",
    "greaterSpells",
  ];
  const copies = {}; // name -> [{cost, refresh, hasLD}]
  for (const c of CLASSES_JSON)
    for (const t of TIERS)
      for (const p of c[t] || []) {
        (copies[p.name] = copies[p.name] || []).push({
          cost: p.cost ?? null,
          refresh: p.refresh ?? null,
          hasLD: !!p.levelDiscounts,
          sharedWith: p.sharedWith,
        });
      }
  for (const [name, cs] of Object.entries(copies)) {
    if (cs.length < 2) continue; // shared only
    ok(
      cs.every((x) => Array.isArray(x.sharedWith) && x.sharedWith.length >= 2),
      `${name} copies tagged sharedWith`,
    );
    if (cs.some((x) => x.hasLD)) continue; // level-scaled (Ritual Affinity) may differ per class
    eq(new Set(cs.map((x) => JSON.stringify(x.cost))).size, 1, `${name} copies share one cost`);
    eq(new Set(cs.map((x) => JSON.stringify(x.refresh))).size, 1, `${name} copies share one refresh`);
  }
});

// ─── xN on unlimited-ranks skills → distinct instances, not rank N ────────────
// Purchased skills import into the skills[] bucket (source 'Purchased').
const extractPurchasedSkills = (c) => (c.skills || []).filter((s) => isPurchased(s.source)).map((s) => s.entityId);
test("two distinct parameterized Lores are two separate purchased rows", () => {
  const c = makeChar("Mage 4", { add: ["Lore (Historical)", "Lore (Arcane)"] });
  const rows = (c.skills || []).filter((s) => isPurchased(s.source));
  eq(rows.length, 2, "two rows");
  // The entity is bare "Lore" on both; the chosen subject lives in the parameter field.
  ok(
    rows.every((r) => r.entityId === "Lore"),
    "both are the bare Lore entity",
  );
  ok(rows[0].parameter !== rows[1].parameter, "distinct subjects (in the parameter field)");
  ok(
    rows.every((r) => r.parameter),
    "both carry a parameter",
  );
});
test("two Lores under Sharp Mind cost 1 each (per-instance discount), net 2", () => {
  const c = makeChar("Mage 4", { add: ["Sharp Mind", "Lore (Historical)", "Lore (Arcane)"] });
  const s = computeSpend(c);
  const lores = Object.keys(s.byItem).filter((k) => /skills:Lore/.test(k));
  eq(lores.length, 2, "two distinct byItem keys");
  lores.forEach((k) => eq(s.byItem[k].cost, 1, `${k} discounted to 1`));
});
test('finite-ranks "Extended Capacity - Novice" at rank 2 stays one row', () => {
  const c = makeChar("Mage 4", { add: [{ name: "Extended Capacity - Novice", ranks: 2 }] });
  eq(extractPurchasedSkills(c).length, 1, "single row");
});

// ─── tiered perks: cumulative cost + hard-enforced per-tier level gate ────────
test("Draconic Heritage rank 2 costs cumulative tier sum (2+3=5)", () => {
  const c = makeChar("Mage 5", { add: [{ name: "Draconic Heritage", ranks: 2 }] });
  eq(computeSpend(c).byItem["purchasedPerks:Draconic Heritage"].cost, 5, "tiers 1+2");
});
test("Draconic Heritage rank 4 costs 2+3+4+5 = 14 (not base×4)", () => {
  const c = makeChar("Mage 15", { add: [{ name: "Draconic Heritage", ranks: 4 }] });
  eq(computeSpend(c).byItem["purchasedPerks:Draconic Heritage"].cost, 14, "all four tiers");
});
test("tier level gate is hard-enforced (rank 2 below char level 5 is an issue)", () => {
  const below = validate(makeChar("Mage 4", { add: [{ name: "Draconic Heritage", ranks: 2 }] }));
  ok(
    below.prereqs.issues.some((i) => /tier 2 requires character level 5/.test(i.text || "")),
    "gated",
  );
  ok(!below.valid, "invalid below the gate");
  const at = validate(makeChar("Mage 5", { add: [{ name: "Draconic Heritage", ranks: 2 }] }));
  ok(!at.prereqs.issues.some((i) => i.tier), "clears at the required level");
});

// ─── power requirements (parser-extracted requiredLevel + requiresEntity) ─────
// A selected power's requirement is enforced: a minimum class level and/or another
// owned entity. Requirements resolve in the OWNING class's context (power names are
// shared across classes with different requirements).
test("power level requirement is enforced", () => {
  // Warrior Spirit requires Fighter Level 10.
  const below = validate(makeChar("Fighter 4", { add: ["Warrior Spirit"] }));
  ok(
    below.prereqs.issues.some((i) => i.item === "Warrior Spirit" && /Fighter Level 10/.test(i.text)),
    "flagged below level",
  );
  const at = validate(makeChar("Fighter 10", { add: ["Warrior Spirit"] }));
  ok(!at.prereqs.issues.some((i) => i.item === "Warrior Spirit"), "clears at level");
});
test("power entity requirement is enforced (Expert Parry needs Parry Blow)", () => {
  // Parry Blow is a Fighter innate at L3. A Fighter 2 doesn't have it yet, so
  // Expert Parry's requiresEntity is unmet → flagged.
  const missing = validate(makeChar("Fighter 2", { add: ["Expert Parry"] }));
  ok(
    missing.prereqs.issues.some((i) => i.item === "Expert Parry" && i.requiresEntity === "Parry Blow"),
    "flagged without prerequisite",
  );
  // A Fighter 6 AUTO-gets Parry Blow (innate), which satisfies the requirement —
  // the prereq check now sees auto-granted innates (graph-derived ownedIds), so it
  // clears without needing to separately select Parry Blow.
  const auto = validate(makeChar("Fighter 6", { add: ["Expert Parry"] }));
  ok(
    !auto.prereqs.issues.some((i) => i.item === "Expert Parry"),
    "clears when the prerequisite is auto-granted as an innate",
  );
});
test("shared power name resolves requirement per owning class (no false positive)", () => {
  // "Ritual Affinity" exists for both Cleric (Cleric L3) and Mage (Mage L3). A
  // Cleric who owns it at Cleric L3 must NOT be flagged with the Mage requirement.
  const cleric = validate(makeChar("Cleric 4", { add: ["Ritual Affinity"] }));
  ok(!cleric.prereqs.issues.some((i) => i.item === "Ritual Affinity"), "cleric version satisfied, not the mage one");
});

// ─── per-level power benefits (Adept Ritualist) ──────────────────────────────
test("Adept Ritualist level-benefits activate by Artisan class level", () => {
  const at1 = validate(makeChar("Artisan 1", { add: ["Adept Ritualist"] }));
  const pb1 = at1.powerBenefits.find((b) => b.power === "Adept Ritualist");
  ok(pb1, "powerBenefits present");
  eq(pb1.gateClass, "Artisan", "gates on Artisan level");
  eq(pb1.benefits.find((b) => b.level === 1).active, true, "L1 active at Artisan 1");
  eq(pb1.benefits.find((b) => b.level === 3).active, false, "L3 locked at Artisan 1");
  const at7 = validate(makeChar("Artisan 7", { add: ["Adept Ritualist"] }));
  const pb7 = at7.powerBenefits.find((b) => b.power === "Adept Ritualist");
  ok(
    pb7.benefits.every((b) => b.active),
    "all active at Artisan 7",
  );
});

// ─── choose-one: build-time selection grants the chosen skill free ────────────
test("Expert Craft build-time choice grants the selected skill at 0 BP", () => {
  const base = makeChar("Artisan 10", { add: ["Expert Craft", "Greater Alchemy"] });
  eq(computeSpend(base).byItem["skills:Greater Alchemy"].cost, 5, "full cost without a choice");
  const chosen = { ...base, choices: { "powers:Expert Craft": "Greater Alchemy" } };
  const eff = computeSpend(chosen).byItem["skills:Greater Alchemy"];
  eq(eff.cost, 0, "free once chosen");
  eq(eff.bestow.source, "Expert Craft", "attributed to Expert Craft");
});

// ─── flaw BP award capped at 5 (rules limit) ─────────────────────────────────
test("flaw BP award is capped at 5 (extra flaws give no more BP)", () => {
  const manyFlaws = ["Binding Oath of Charity", "Binding Oath of Peace", "Torn Soul"]; // 5+5+4 = 14 raw
  const s = computeSpend(makeChar("Fighter 10", { add: manyFlaws }));
  eq(s.awarded, 5, "awarded clamped to 5");
  ok(s.rawAwarded > 5, "rawAwarded reflects the uncapped sum");
  ok(s.flawCapped, "flawCapped flagged");
});

test("flaws RAISE the budget rather than lowering spend", () => {
  // Flaw BP is awarded BP: it should lift the displayed cap (spent of base+flaws),
  // not net out of spend (which would make the build look like it spent less).
  const none = validate(makeChar("Fighter 4"));
  const five = validate(makeChar("Fighter 4", { add: ["Nightmares", "Pliant"] })); // 3 + 2 = 5
  eq(five.budget, none.budget + 5, "budget lifts by the 5 awarded flaw BP");
  eq(five.spend.net, none.spend.net, "spend is unchanged by flaws (not netted down)");
  eq(five.remaining, none.remaining + 5, "remaining grows by the flaw award");
  ok(!five.overBudget, "awarding budget headroom does not flag over-budget");
  // The lift is capped at MAX_FLAW_BP just like the award.
  const eight = validate(makeChar("Fighter 4", { add: ["Nightmares", "Pliant", "Outdoor Discomfort"] })); // 3+2+3=8
  eq(eight.budget, none.budget + 5, "budget lift is capped at 5 even with more flaw BP");
});

test("allergy flaws calculate awards dynamically based on parameter", () => {
  const s1 = computeSpend(makeChar("Fighter 10", { add: ["Mild Allergy (Iron)"] }));
  eq(s1.rawAwarded, 2, "common mild allergy awards 2 BP");

  const s2 = computeSpend(makeChar("Fighter 10", { add: ["Mild Allergy (Gold)"] }));
  eq(s2.rawAwarded, 1, "uncommon mild allergy awards 1 BP");

  const s3 = computeSpend(makeChar("Fighter 10", { add: ["Severe Allergy (Iron)"] }));
  eq(s3.rawAwarded, 3, "common severe allergy awards 3 BP");

  const s4 = computeSpend(makeChar("Fighter 10", { add: ["Severe Allergy (Gold)"] }));
  eq(s4.rawAwarded, 2, "uncommon severe allergy awards 2 BP");
});

test("allergy awards are derived from the parsed rulebook table, not hardcoded", () => {
  // Source of truth: the parser scrapes "Standard Allergens and Awards" into a
  // structured `allergens` field; ALLERGEN_AWARDS / allergenAward read that field.
  ok(ALLERGEN_AWARDS["Mild Allergy"] && ALLERGEN_AWARDS["Severe Allergy"], "both allergy tables present");
  eq(allergenOptions("Mild Allergy").length, 15, "all 15 standard allergens offered");
  // Every substance in the table prices exactly as the table says, for both flaws.
  for (const flaw of ["Mild Allergy", "Severe Allergy"]) {
    for (const [sub, bp] of Object.entries(ALLERGEN_AWARDS[flaw])) {
      eq(allergenAward(flaw, sub), bp, `${flaw} (${sub}) → ${bp}`);
      // case/whitespace-insensitive
      eq(allergenAward(flaw, ` ${sub.toUpperCase()} `), bp, `${flaw} (${sub}) normalizes`);
    }
  }
  // No substance, or one off the table → undetermined (null), not a wrong number.
  eq(allergenAward("Mild Allergy", ""), null, "no substance → undetermined");
  eq(allergenAward("Mild Allergy", "butter"), null, "off-table substance → undetermined");
  // The engine still books a conservative minimum for a bare allergy.
  eq(
    computeSpend(makeChar("Fighter 10", { add: ["Mild Allergy"] })).rawAwarded,
    1,
    "bare Mild Allergy defaults to the table minimum (1)",
  );
});

// ─── sub-power extraction + grant (Strange Token → Curious Balm) ──────────────
test("inline sub-powers are extracted as entities", () => {
  ok(lookupEntity("powers:Curious Balm"), "Curious Balm exists");
  ok(lookupEntity("powers:Holy Rest"), "Holy Rest exists");
  ok(lookupEntity("powers:Curious Balm").effect, "sub-power carries its stat block (effect)");
});
test("a power's in-play Grant of a sub-power is not a build-time bestowal", () => {
  // Strange Token's Call grants Curious Balm in play; the sub-power is captured as a
  // browsable entity (test above) but is NOT bestowed on Strange Token's owner.
  const g = bestowedAbilities(makeChar("Artisan 10", { add: ["Strange Token"] }));
  ok(
    !g.list.some((x) => x.ability === "powers:Curious Balm"),
    "Curious Balm is an in-play Grant, not bestowed on the owner",
  );
});
