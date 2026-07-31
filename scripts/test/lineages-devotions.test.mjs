// lineages-devotions.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
// imports so concurrent features don't collide on one shared import block.
import { test, eq, ok, Source } from "./harness.mjs";
import { makeChar } from "./make-char.mjs";
import { validate, characterLevel, classifyOwnedItems } from "../../src/engine/validate.js";
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
  weirdWanderingsOptions,
  studiedFocusOptions,
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
  divineSubstitutionOptions,
  pickAndChooseOptions,
} from "../../src/engine/data.js";
import { resolveCharacterGraph } from "../../src/engine/graph.js";
const resolved = (c) => resolveCharacterGraph(c).character;
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

// ─── lineages / LBP ───────────────────────────────────────────────────────────
test("LBP: challenges award, advantages spend, cap at 10", () => {
  const a = LINEAGES.Aewen;
  const req = a.challenges.find((c) => c.required);
  const c = {
    lineage: "Aewen",
    lineageChallenges: [req.name, "Mana Lines [Repped]", "Pointed Ears [Repped]"],
    lineageAdvantages: ["Deep Reserves"],
  };
  const s = validate(c).lbp;
  eq(s.awarded, 5, "awarded");
  eq(s.spent, 4, "spent");
  eq(s.remaining, 1, "remaining");
  ok(s.valid, "complete build is valid");
});
test("LBP: overspend is invalid", () => {
  const s = validate({
    lineage: "Aewen",
    lineageChallenges: ["Pointed Ears [Repped]"],
    lineageAdvantages: ["Deep Reserves"],
  }).lbp;
  ok(s.overspent, "overspent (1 awarded, 4 spent)");
});
test("LBP: missing required challenge is invalid", () => {
  const s = validate({ lineage: "Lost", lineageChallenges: ["Lost Life [Repped]"], lineageAdvantages: [] }).lbp;
  ok(s.missingRequired.length > 0, "required challenge flagged");
});
test("LBP: Lost Life / Additional Lost Life dynamic LBP calculation", () => {
  // Lost Life (Pointed Ears (1 LBP)) should award 1 LBP
  let s = validate({
    lineage: "Lost",
    lineageChallenges: [
      "Born of the Void [Required]",
      "Scarred by the Void [Repped] [Required]",
      "Lost Life [Repped] (Pointed Ears (1 LBP))",
    ],
    lineageAdvantages: [],
  }).lbp;
  // Born of the Void = 0, Scarred by the Void = 3, Lost Life = 1. Total = 4.
  eq(s.rawAwarded, 4, "Lost Life parsed from LBP suffix");

  // Lost Life (Horns) should lookup Horns in Chimera lineage (3 LBP) and award 3 LBP
  s = validate({
    lineage: "Lost",
    lineageChallenges: [
      "Born of the Void [Required]",
      "Scarred by the Void [Repped] [Required]",
      "Lost Life [Repped] (Horns)",
    ],
    lineageAdvantages: [],
  }).lbp;
  // Born of the Void = 0, Scarred by the Void = 3, Horns = 3. Total = 6.
  eq(s.rawAwarded, 6, "Lost Life looked up by challenge name");
});
test("LBP: Lost Life picker storage format (base name + rep param) resolves", () => {
  // The Lost Life rep PICKER stores "Lost Life (<rep>)" using the bare baseName
  // (no [Repped] tag). Confirm that exact shape resolves the rep's LBP, and that
  // an un-repped Lost Life awards 0 (the bug the picker fixes).
  const req = ["Born of the Void [Required]", "Scarred by the Void [Repped] [Required]"];
  const repped = validate({
    lineage: "Lost",
    lineageChallenges: [...req, "Lost Life (Horns)"],
    lineageAdvantages: [],
  }).lbp;
  eq(repped.rawAwarded, 6, 'picker-stored "Lost Life (Horns)" awards Horns\' LBP (0+3+3)');

  const bare = validate({ lineage: "Lost", lineageChallenges: [...req, "Lost Life"], lineageAdvantages: [] }).lbp;
  eq(bare.rawAwarded, 3, 'un-repped "Lost Life" awards 0 (just the required Scarred=3)');
});

test("Pick and Choose: a cross-lineage advantage is applied with its full effects", () => {
  // Lost "Pick and Choose" → purchase one advantage from ANOTHER lineage. The pool is
  // every non-Lost advantage, grouped by lineage; the chosen one applies its effects.
  const opts = pickAndChooseOptions();
  ok(opts.length > 50, "pool spans all non-Lost lineages");
  ok(
    opts.every((o) => o.group !== "Lost"),
    "never offers a Lost advantage",
  );
  ok(
    opts.some((o) => o.advId === "Iron Touch") && !opts.some((o) => o.advId.includes(" - ")),
    "options carry the BARE advId (lineage is a field, not concatenated — #195)",
  );
  // Pick Underkin "Iron Touch" (grants the Mystic Armorer perk) → it materializes free.
  const owned = validate(
    makeChar("Fighter 6", {
      lineage: "Lost",
      lineageAdvantages: ["Pick and Choose"],
      advantageChoices: { "Pick and Choose": "Iron Touch" },
    }),
  ).owned;
  ok(
    (owned?.perks || []).some((p) => p.name === "Mystic Armorer" && p.bestowedBy === "Iron Touch"),
    "the chosen advantage’s grant is applied across lineages",
  );
});

const findLin = (ln, nm) => {
  const l = LINEAGES[ln];
  for (const k of ["challenges", "advantages"])
    for (const it of l[k] || []) if ((it.baseName || it.name) === nm) return it;
};

test("lineageChoiceSpec classifies sub-choice items by kind", () => {
  eq(lineageChoiceSpec(findLin("Lost", "Divine Magic")).kind, "cantrip", "Divine Magic = cantrip");
  eq(lineageChoiceSpec(findLin("Human", "Psionic Cantrip")).kind, "cantrip", "Psionic Cantrip = cantrip");
  ok(lineageChoiceSpec(findLin("Human", "Psionic Cantrip")).pool.includes("Arcane"), "Psionic pool includes Arcane");
  ok(!lineageChoiceSpec(findLin("Lost", "Divine Magic")).pool.includes("Arcane"), "Divine Magic pool is Divine-only");
  eq(lineageChoiceSpec(findLin("Lost", "Lost Life")).kind, "rep", "Lost Life = rep");
  eq(lineageChoiceSpec(findLin("Aewen", "Elemental Expression")).kind, "flavor", "Elemental Expression = flavor");
  eq(lineageChoiceSpec(findLin("Aewen", "Deep Reserves")), null, "an ordinary advantage has no choice spec");
  // Arcane Aptitude: a 'spell' pick (cantrip/novice from any base Arcane class).
  const aa = lineageChoiceSpec(findLin("Aewen", "Arcane Aptitude"));
  eq(aa.kind, "spell", "Arcane Aptitude = spell");
  ok(aa.pool.includes("Arcane") && aa.tiers.includes("novice"), "Arcane Aptitude pool=Arcane, includes novice");
});

test("Arcane Aptitude grants the chosen spell as a Known Spell", () => {
  const char = {
    lineage: "Aewen",
    lineageAdvantages: ["Arcane Aptitude"],
    advantageChoices: { "Arcane Aptitude": "Flameburst" },
    ranks: {},
  };
  const items = Array.from(resolveCharacterGraph(char));
  const aa = items.find((i) => /Arcane Aptitude/.test(i.name));
  ok(
    aa.effects.some((e) => e.type === "BESTOW_SOURCE" && e.bestows.includes("powers:Flameburst")),
    "the picked spell is granted",
  );
});

test("Arcane Secrets (domain power) grants the chosen arcane spell as a Known Spell", () => {
  // powerSpellChoiceSpec drives an owned-power spell pick, keyed by choices['powers:..'].
  const spec = powerSpellChoiceSpec({ name: "Arcane Secrets" });
  ok(spec?.kind === "spell" && spec.optionsKey === "arcaneSecretsOptions", "Arcane Secrets = arcane spell pick");
  const char = makeChar("Cleric 6", {
    devotion: "The Librarian",
    add: [{ name: "Arcane Secrets", field: "domainPowers" }],
    choices: { "powers:Arcane Secrets": "Arcane Barrage" },
  });
  const sec = resolveCharacterGraph(char).find((i) => /Arcane Secrets/.test(i.name));
  ok(
    sec.effects.some((e) => e.type === "BESTOW_SOURCE" && e.bestows.includes("powers:Arcane Barrage")),
    "the picked spell is granted",
  );
  // With no pick, no grant.
  const none = resolveCharacterGraph(
    makeChar("Cleric 6", { devotion: "The Librarian", add: [{ name: "Arcane Secrets", field: "domainPowers" }] }),
  ).find((i) => /Arcane Secrets/.test(i.name));
  ok(!none.effects.some((e) => e.type === "BESTOW_SOURCE"), "no pick → no spell granted");
});

test("a domain power routes to the domainPowers bucket, not classPowers", () => {
  // A domain power is entity.type 'power' with no distinguishing entity field; the graph
  // stamps powerKind from its originating (domainPowers) bucket. Previously the router
  // keyed on `field === "domainPowers"`, which never matched (field is "powers"), so
  // domain powers wrongly fell into classPowers and domainPowers stayed empty.
  const char = makeChar("Cleric 6", {
    devotion: "The Librarian",
    add: [{ name: "Arcane Secrets", field: "domainPowers" }],
  });
  const owned = classifyOwnedItems(char);
  eq(owned.domainPowers.length, 1, "the domain power lands in the domainPowers bucket");
  ok(!owned.classPowers.some((p) => /Arcane Secrets/.test(p.name)), "the domain power is NOT lumped into classPowers");
});

test("Weird Wanderings grants a chosen Basic power from a non-Artisan base class", () => {
  // Same power-choice machinery, kind:'power' — pool = report.weirdWanderingsOptions
  // (Basic powers of any non-Artisan Base Class, no Spell refresh).
  const spec = powerSpellChoiceSpec({ name: "Weird Wanderings" });
  ok(spec?.kind === "power" && spec.optionsKey === "weirdWanderingsOptions", "Weird Wanderings = power pick");
  const pool = weirdWanderingsOptions();
  ok(pool.length > 0, "pool is non-empty");
  ok(pool.includes("Battlemind"), "offers a Fighter Basic power");
  // No Artisan powers (it copies from OTHER classes) and no Spell-refresh powers.
  ok(!pool.some((n) => lookupEntity(`powers:${n}`)?.parentClass === "Artisan"), "excludes Artisan powers");
  const char = makeChar("Artisan 4", {
    add: ["Weird Wanderings"],
    choices: { "powers:Weird Wanderings": "Battlemind" },
  });
  const ww = resolveCharacterGraph(char).find((i) => /Weird Wanderings/.test(i.name));
  ok(
    ww.effects.some((e) => e.type === "BESTOW_SOURCE" && e.bestows.includes("powers:Battlemind")),
    "the picked power is granted",
  );
});

test("Studied Focus: a tag gates the pool, and both picks are granted", () => {
  // "Instead of an Advanced Power, choose TWO Basic Artisan Powers with the same
  // Specialty Tag." The (ie: …) example in the doc must NOT become a bogus chooseOne.
  ok(!lookupEntity("powers:Studied Focus").chooseOne, 'no bogus chooseOne from the "(ie:)" example');
  const crafter = studiedFocusOptions("Crafter");
  ok(
    crafter.length >= 2 && crafter.every((n) => (lookupEntity(`powers:${n}`)?.tags || []).includes("Crafter")),
    "pool is exactly the chosen tag’s Basic Artisan powers",
  );
  // Both picks of the same tag are granted.
  const char = makeChar("Artisan 10", {
    add: ["Studied Focus"],
    choices: {
      "powers:Studied Focus": "Crafter",
      "powers:Studied Focus:1": "Analysis",
      "powers:Studied Focus:2": "Antidote",
    },
  });
  const sf = resolveCharacterGraph(char).find((i) => /Studied Focus/.test(i.name));
  ok(sf.effects.filter((e) => e.type === "BESTOW_SOURCE").length === 2, "both chosen powers granted");
  ok(
    sf.effects.some((e) => e.bestows?.includes("powers:Analysis")) &&
      sf.effects.some((e) => e.bestows?.includes("powers:Antidote")),
    "the two picks specifically",
  );
});

test("Arcane Secrets pool is rank-gated, not a flat list (the rules gate by castable rank)", () => {
  // Caster with a Known Spell: the pool is gated by Arcane spell-slots held — a low
  // caster (novice slots only) sees fewer spells than a high caster (adept unlocked).
  const lo = arcaneSecretsSpellOptions(makeChar("Mage 2", { add: ["Flameburst"] }));
  const hi = arcaneSecretsSpellOptions(makeChar("Mage 10", { add: ["Flameburst"] }));
  ok(lo.length > 0 && hi.length > lo.length, "higher caster level → strictly larger gated pool");
  // The pool draws from ANY base arcane class, not just the character's own.
  ok(hi.length >= 80, "pool spans all base arcane classes (not just the owned class)");
  // No Known Spells → the "up to Adept" branch (excludes any Greater-tier spell).
  const noncaster = arcaneSecretsSpellOptions(makeChar("Cleric 6"));
  ok(noncaster.length > 0, "non-caster still gets an arcane pool, capped at Adept");
});

test("cantrip-choice lineage items grant + slot the chosen cantrip (Divine Magic + the previously-broken Psionic Cantrip)", () => {
  const dm = validate(
    makeChar("Cleric 4", {
      lineage: "Lost",
      lineageAdvantages: ["Divine Magic"],
      advantageChoices: { "Divine Magic": "Cancel" },
    }),
  );
  ok(
    dm.bestowedAbilities.list.some((g) => g.ability === "powers:Cancel"),
    "Divine Magic grants the chosen cantrip (unchanged)",
  );
  // Psionic Cantrip was hardcoded-out before; the generalized path fixes it.
  const pc = validate(
    makeChar("Mage 4", {
      lineage: "Human",
      sublineage: "Psionic",
      lineageAdvantages: ["Psionic Cantrip"],
      advantageChoices: { "Psionic Cantrip": "Cancel" },
    }),
  );
  ok(
    pc.bestowedAbilities.list.some((g) => g.ability === "powers:Cancel"),
    "Psionic Cantrip now grants the chosen cantrip",
  );
});

test("lineageItemImpact summarizes mechanical effect", () => {
  eq(lineageItemImpact(findLin("Aewen", "Deep Reserves"), "Aewen")[0], "+1 highest spell-slot", "slot impact");
  ok(
    lineageItemImpact(findLin("Aewen", "Mystic Resilience"), "Aewen").some((s) => /grants Magical Resilience/.test(s)),
    "grant impact",
  );
  ok(lineageItemImpact(findLin("Lost", "Divine Magic"), "Lost")[0].includes("cantrip"), "cantrip-choice impact");
});
test("sublineage: same sublineage (inconsistent strings) is NOT mixed", () => {
  const a = LINEAGES.Aewen;
  const accC = a.challenges.find((c) => /^Accented/.test(c.sublineage));
  const accA = a.advantages.find((c) => c.sublineage === "Accented");
  const s = validate({ lineage: "Aewen", lineageChallenges: [accC.name], lineageAdvantages: [accA.name] }).lbp;
  ok(!s.mixedSublineage, "Accented long/short forms treated as one sublineage");
});
test("sublineage: mixing two sublineages is flagged", () => {
  const a = LINEAGES.Aewen;
  const accC = a.challenges.find((c) => /^Accented/.test(c.sublineage));
  const shornC = a.challenges.find((c) => /Shorn Urbanite/.test(c.sublineage));
  const s = validate({ lineage: "Aewen", lineageChallenges: [accC.name, shornC.name], lineageAdvantages: [] }).lbp;
  ok(s.mixedSublineage, "two sublineages flagged as mixed");
});
test("sublineage: an optional sublineage item requires selecting that sublineage (#2)", () => {
  // A Human taking a Psionic challenge (its downside) without committing to the
  // Psionic sublineage is illegal — being psionic is a sublineage commitment.
  const psiCh = LINEAGES.Human.challenges.find((c) => /psionic/i.test(c.sublineage || ""));
  const without = validate({ lineage: "Human", lineageChallenges: [psiCh.name], lineageAdvantages: [] }).lbp;
  ok(without.needsSublineage, "flags missing sublineage selection");
  ok(!without.valid, "invalid without the sublineage selected");
  const withSub = validate({
    lineage: "Human",
    sublineage: "Psionic",
    lineageChallenges: [psiCh.name],
    lineageAdvantages: [],
  }).lbp;
  ok(!withSub.needsSublineage && withSub.valid, "valid once Psionic is selected");
});
test("sublineage: a REQUIRED sublineage-tagged challenge does NOT force a selection", () => {
  // Aewen's required challenge is tagged to a default presentation; taking it
  // shouldn't demand a sublineage pick.
  const a = LINEAGES.Aewen;
  const req = a.challenges.find((c) => c.required);
  const s = validate({ lineage: "Aewen", lineageChallenges: [req.name], lineageAdvantages: [] }).lbp;
  ok(!s.needsSublineage, "required challenge does not trigger needsSublineage");
});

// ─── devotions ────────────────────────────────────────────────────────────────
test("all 18 devotions carry domains", () => {
  eq(DEVOTIONS.length, 18, "devotion count");
  for (const d of DEVOTIONS) ok(d.domains.length >= 2, `${d.name} has domains`);
});
test("devotionState resolves The Mother → Life/Creation/Protection", () => {
  const ds = devotionState(resolved({ devotion: "The Mother", divineDomains: ["Life", "Protection"] }));
  ok(ds, "devotionState non-null");
  eq(ds.available.join(","), "Life,Creation,Protection", "available domains");
  eq(ds.chosen.join(","), "Life,Protection", "chosen domains");
});
test("domain → powers → detail chain resolves", () => {
  const life = DOMAINS.find((d) => d.name === "Life");
  ok(life.powers.length, "Life has powers");
  const p = lookupEntity(`powers:${life.powers[0].name}`);
  ok(p && p.description, "domain power resolves with description");
});
test("opposed-domain pairs are parsed (symmetric) from the MegaDoc table", () => {
  const opp = Object.fromEntries(DOMAINS.map((d) => [d.name, d.opposedBy]));
  eq(opp["Chaos"], "Order", "Chaos ↔ Order");
  eq(opp["Order"], "Chaos", "symmetric");
  eq(opp["Life"], "Death", "Life ↔ Death");
  eq(opp["Light"], "Shadow", "Light ↔ Shadow");
  eq(opp["Peace"], "War", "Peace ↔ War");
  eq(opp["Knowledge"], null, "unopposed domain has no pair");
});
test("Divine Substitution offers domains that are neither standard nor opposed", () => {
  // The Mother = Life/Creation/Protection → excludes those AND their opposites
  // (Death opposes Life, Destruction opposes Creation).
  const opts = divineSubstitutionOptions(["Life", "Creation", "Protection"]);
  ok(!opts.some((d) => ["Life", "Creation", "Protection"].includes(d)), "excludes standard");
  ok(!opts.includes("Death") && !opts.includes("Destruction"), "excludes opposed");
  ok(opts.includes("Shadow") && opts.includes("War"), "offers eligible domains");
});
test("Divine Substitution grants the chosen domain (opposition enforced end-to-end)", () => {
  const ds = devotionState(
    makeChar("Cleric 10", {
      devotion: "The Mother",
      add: ["Divine Substitution"],
      choices: { "powers:Divine Substitution": "Shadow" },
      divineDomains: ["Shadow"],
    }),
  );
  ok(ds.substitution, "substitution surfaced when the power is owned");
  eq(ds.substitution.chosen, "Shadow", "records the pick");
  ok(ds.available.includes("Shadow"), "chosen domain becomes available");
  ok(ds.eligiblePowers.length > 0, "its domain powers become purchasable");
  // A forbidden (opposed) pick is rejected: Death opposes Life → not added.
  const bad = devotionState(
    makeChar("Cleric 10", {
      devotion: "The Mother",
      add: ["Divine Substitution"],
      choices: { "powers:Divine Substitution": "Death" },
    }),
  );
  ok(!bad.available.includes("Death"), "an opposed pick is refused");
});

// ─── prereqs (disjunction) ────────────────────────────────────────────────────
test('prereq disjunction: Basic Faith satisfies "Basic Arcane or Basic Faith"', () => {
  const c = makeChar("Cleric 4", {
    archetypeName: "x",
    add: [
      { name: "Basic Faith", source: Source.class("Cleric") },
      { name: "Extended Capacity - Novice", source: Source.class("Cleric") },
    ],
  });
  const ps = prereqStatus(c, "skills:Extended Capacity - Novice");
  ok(ps.met, "met with Basic Faith");
});

// ─── reference resolution coverage ────────────────────────────────────────────
test("≥99% of reference links resolve", () => {
  let total = 0,
    resolved = 0;
  for (const id in REFS.mentions)
    for (const ref of REFS.mentions[id]) {
      total++;
      if (lookupEntity(ref)) resolved++;
    }
  ok(resolved / total >= 0.99, `resolved ${resolved}/${total}`);
});

test("domainPowers: a domain power that defines a pool (Balance Pool) resolves the pool", () => {
  // The Balance of Life is a domain power that defines the Balance Pool: owning it
  // in the domainPowers bucket makes the pool resolve.
  const c = {
    ...makeChar({ classes: [{ name: "Cleric", level: 6 }] }),
    domainPowers: [
      { entityId: "The Balance of Life", source: Source.purchased(), ranks: 1, costField: "domainPowers" },
    ],
  };
  const pool = (validate(c).pools || []).find((p) => p.name === "Balance Pool");
  ok(pool, "Balance Pool resolves from the owned domain power");
});
