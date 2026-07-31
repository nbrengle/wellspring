// skills-and-stats.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
// imports so concurrent features don't collide on one shared import block.
import { test, eq, ok, purchasedSkills, isPurchased, Source } from "./harness.mjs";
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
  maxRanks,
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

// ─── base stats from the level table + numeric power/perk/lineage mods ────────
test("base Life Points / Spikes come from the level table (classless baseline)", () => {
  // Base LP is the classless table value; class progression bonuses layer on top.
  const s4 = validate(makeChar("Fighter 4")).stats;
  eq(s4.baseLifePoints, 3, "L4 base = 3 LP");
  eq(s4.spikes, 2, "L4 = 2 spikes");
  // Fighter's L2 "+1 Base Maximum Life Points" applies → total 4 at L4.
  eq(s4.lifePoints, 4, "L4 Fighter total = 3 base + 1 (Fighter L2 bonus)");
  const s10 = validate(makeChar("Fighter 10")).stats;
  eq(s10.baseLifePoints, 4, "L10 base = 4 LP");
  eq(s10.spikes, 4, "L10 = 4 spikes (3 base + 1 Fighter L9 bonus)");
  eq(s10.lifePoints, 6, "L10 Fighter total = 4 base + 1 (L2) + 1 (Warrior Spirit)");
});
test("class progression LP bonus applies and is level-gated", () => {
  // Fighter L2 grants +1 Base Maximum LP; below L2 it should NOT apply.
  eq(validate({ classes: [{ name: "Fighter", level: 1 }] }).stats.lifePoints, 3, "L1 = 3 (no bonus yet)");
  eq(validate({ classes: [{ name: "Fighter", level: 2 }] }).stats.lifePoints, 4, "L2 = 4 (bonus applies)");
  // Cleric gets its +1 at L7, not before.
  eq(validate({ classes: [{ name: "Cleric", level: 6 }] }).stats.lifePoints, 4, "Cleric L6 = 4 (table, no bonus)");
  eq(validate({ classes: [{ name: "Cleric", level: 7 }] }).stats.lifePoints, 5, "Cleric L7 = 4 + 1 bonus");
});
test("Healthy class skill adds +1 max Life Point", () => {
  const without = validate(makeChar("Fighter 6")).stats.lifePoints;
  const withH = validate(makeChar("Fighter 6", { add: ["Healthy"] })).stats;
  eq(withH.lifePoints, without + 1, "Healthy adds +1 LP");
  ok(
    withH.mods.sources.some((s) => s.name === "Healthy" && s.stat === "lifePoints"),
    "Healthy is a recorded LP source",
  );
});
test("Druid Form spells do not inflate permanent Life Points", () => {
  // "Lesser Form of the Hulking Bear" grants +1 LP only WHILE transformed (tag: Form).
  const s = validate(makeChar("Druid 4", { add: ["Lesser Form of the Hulking Bear"] })).stats;
  eq(s.lifePoints, 3, "Druid L4 stays 3 — form LP is conditional, not a build stat");
});
test("Toughness adds +1 max Life Point (counted once, not per phrasing)", () => {
  // Druid L4 has no class LP bonus, so this isolates the perk's single +1.
  const s = validate(makeChar("Druid 4", { add: ["Toughness"] })).stats;
  eq(s.baseLifePoints, 3, "base 3");
  eq(s.lifePoints, 4, "3 + 1");
  eq(s.mods.sources.filter((x) => x.name === "Toughness").length, 1, "one source, no double-count");
});
test("Natural Armor lineage advantage adds Natural Armor", () => {
  const s = validate(
    makeChar("Druid 10", { lineage: "Oaksworn", lineageAdvantages: ["Hardened Flesh (Dryad)"] }),
  ).stats;
  eq(s.naturalArmor, 2, "+2 Natural Armor from Hardened Flesh");
});

// ─── Class Powers (classSkills) are buyable + cost BP ─────────────────────────
test("Class Powers are eligible per class and cost their BP", () => {
  const mage = eligiblePowers("Mage", "classSkills");
  ok(mage.length >= 3, "Mage has class skills");
  ok(
    mage.some((p) => p.name === "Arcane Charge"),
    "Arcane Charge is offered",
  );
  const s = computeSpend(makeChar("Mage 10", { add: ["Cantrip Scholar"] }));
  eq(s.byItem["powers:Cantrip Scholar"].cost, 4, "Cantrip Scholar costs 4 BP");
  eq(s.net, 4, "counted in spend");
});
test("sub-powers are filtered out of eligiblePowers", () => {
  const clericSpells = eligiblePowers("Cleric", "spellsKnown");
  ok(!clericSpells.some((p) => p.name === "Holy Rest"), "Holy Rest (SubPower) is not offered directly");
  ok(
    clericSpells.some((p) => p.name === "Prayer of Rest"),
    "Prayer of Rest (Novice) is offered",
  );
});

test("directly selecting a sub-power fails validation", () => {
  const c = makeChar("Cleric 4", { add: ["Holy Rest"] });
  const r = validate(c);
  ok(!r.valid, "Character with sub-power directly selected is invalid");
  ok(
    r.prereqs.issues.some((i) => i.item === "Holy Rest" && i.text.includes("is a sub-power")),
    "Validation flags Holy Rest",
  );
});

test("an in-play Grant (sub-power) is NOT bestowed on the caster", () => {
  // Prayer of Rest's Call is "Grant Power: Holy Rest" targeting Individual (Other) —
  // the sub-power is conferred on a TARGET in play, the caster gains nothing on their
  // sheet. So Holy Rest must NOT appear as a bestowal (a build-time "you gain X").
  const c = makeChar("Cleric 4", { add: ["Prayer of Rest"] });
  const r = validate(c);
  ok(
    !r.bestowedAbilities.list.some((g) => g.abilityName === "Holy Rest"),
    "Holy Rest is an in-play Grant to a target, not bestowed on the caster",
  );
  // And it's still not directly selectable (unchanged).
  ok(!eligiblePowers("Cleric", "spellsKnown").some((p) => p.name === "Holy Rest"), "Holy Rest remains non-selectable");
});

// ─── multi-rank skills, perks, class powers, and instance-based skills ────────
test("maxRanks reads the rank cap off the entity", () => {
  eq(maxRanks(lookupEntity("skills:Spell-Scholar")), 12, "Spell-Scholar max ranks");
  eq(maxRanks(lookupEntity("skills:Bookcaster")), Infinity, "Bookcaster max ranks");
  eq(maxRanks(lookupEntity("skills:Agile Learner")), 3, "Agile Learner max ranks");
  eq(maxRanks(lookupEntity("powers:Custom Brew")), 3, "Custom Brew class power max ranks");
});

test("ranks: computeSpend calculates correctly for multi-rank skills", () => {
  const c = makeChar("Mage 4", { add: [{ name: "Spell-Scholar", ranks: 3 }] });
  const s = computeSpend(c);
  eq(s.byItem["skills:Spell-Scholar"].cost, 12, "Spell-Scholar rank 3 costs 4 * 3 = 12");
});

test("dedupe: unlimited-ranks (instance-based) skills are not collapsed", () => {
  const c = makeChar("Mage 4", { add: ["Bookcaster (Identify)", "Bookcaster (Mageskin)"] });
  const r = validate(c);
  eq(r.spend.net, 2, "Two instances of Bookcaster cost 1 each, net 2 BP");
  // Verify both instances are kept in the owned skills list
  const ownedSkills = r.owned.skills.map((s) => s.name);
  ok(ownedSkills.includes("Bookcaster (Identify)"), "Includes Identify");
  ok(ownedSkills.includes("Bookcaster (Mageskin)"), "Includes Mageskin");
});

test("dedupe: class starting Bookcaster skills + additional purchased Bookcaster", () => {
  const c = makeChar("Mage 4", {
    startingKit: false,
    add: [
      // starts with Bookcaster, Bookcaster
      { name: "Bookcaster (Magekey)", source: Source.class("Mage") },
      { name: "Bookcaster (Mask Aura)", source: Source.class("Mage") },
      "Bookcaster (Identify)",
    ],
  });
  const r = validate(c);
  // Mage starting Bookcaster is free. Purchased Bookcaster should cost 1 BP.
  eq(r.spend.byItem["skills:Bookcaster (Identify)"].cost, 1, "Purchased Bookcaster costs 1 BP");
  eq(r.spend.net, 1, "Total spend net should be 1 BP (purchased Bookcaster)");
});

test("ranked + parameterized purchases cost and rank correctly (Spell-Scholar x3, Bookcaster instances)", () => {
  const c = makeChar("Mage 5", {
    add: [{ name: "Spell-Scholar", ranks: 3 }, "Bookcaster (Identify)", "Bookcaster (Mageskin)"],
  });
  const { spend } = validate(c);
  // A rank-3 Spell-Scholar is one row at cumulative cost; each Bookcaster instance is 1 BP.
  eq(spend.byItem["skills:Spell-Scholar"].rank, 3, "Spell-Scholar rank 3");
  eq(spend.byItem["skills:Spell-Scholar"].cost, 12, "Spell-Scholar x3 costs 12 BP");
  eq(spend.byItem["skills:Bookcaster (Identify)"].rank, 1, "Bookcaster (Identify) rank 1");
  eq(spend.byItem["skills:Bookcaster (Identify)"].cost, 1, "Bookcaster (Identify) costs 1 BP");
  eq(spend.byItem["skills:Bookcaster (Mageskin)"].cost, 1, "Bookcaster (Mageskin) costs 1 BP");
});
