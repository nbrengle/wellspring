// starting-choices.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
// imports so concurrent features don't collide on one shared import block.
import { test, eq, ok, Source, isStarting } from "./harness.mjs";
import { validate, characterLevel } from "../../src/engine/validate.js";
import {
  budgetFor,
  computeSlots,
  spellSlots,
  devotionState,
  prereqStatus,
  LEVEL_CAP,
  LEGAL_MIN_LEVEL,
  grantedAbilities,
  computeSpend,
  getMaxRanks,
  bookcasterSpellOptions,
  arcaneSecretsSpellOptions,
  eligibleClassChoices,
  agileLearnerCapacity,
  basicSpellOptions,
} from "../../src/engine/testing.js";
import { bareSkill, cleanItemName, getClasses, formatParameterizedName } from "../../src/engine/resolver.js";
import { formatCharacterSheet, parseCharacterSheet } from "../../src/engine/sheet.js";
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
  startingSkillGrants,
} from "../../src/engine/starting-choices.js";
import ARCHETYPES from "../../src/data/archetypes.json" with { type: "json" };
import CLASSES_JSON from "../../src/data/classes.json" with { type: "json" };

// A character built straight from an archetype mirrors what loadArchetype keeps.
const fromArchetype = (a) => a;

// Starting skills are: starting-sourced entries in the skills[] bucket.
const startingChoices = (c) => (c.skills || []).filter((s) => isStarting(s.source));
const startingNames = (c) => startingChoices(c).map((s) => s.entityId);
// Rename the i-th starting skill (player picks a parameter, etc.) in place.
const setStartingName = (c, i, name) => {
  const starting = startingChoices(c);
  starting[i] = { ...starting[i], entityId: name };
  const others = (c.skills || []).filter((s) => !isStarting(s.source));
  return { ...c, skills: [...starting, ...others] };
};

// ─── starting-choice config integrity ─────────────────────────────────────────
// STARTING_CHOICES_CONFIG is curated (hand-transcribed from each class's prose
// "Starting Skills" entry, which is too irregular to parse reliably). These guard
// against the config silently drifting from reality:

// Every skill named in the config must resolve to a real entity — catches typos /
// alias drift (this is what caught "Bits & Pieces" vs the real "Bits and Pieces").
test("every starting-choice config skill resolves to an entity", () => {
  for (const [cls, blocks] of Object.entries(STARTING_CHOICES_CONFIG)) {
    for (const block of blocks) {
      for (const s of block.options.flatMap(optionSkills)) {
        ok(resolveSkill(s.name), `${cls} / ${block.label}: "${s.name}" must resolve`);
      }
    }
  }
});

// ── Helpers: resolve a block's id / an option's label from the live (derived)
// config by CONTENT, so these tests assert on behavior (the right option is
// chosen, swaps work) without hardcoding derived ids/labels that change when the
// derivation does. `blockBy` finds a block whose any option grants `skillName`;
// `optLabel` finds the label of the option in that block granting `skillName`.
const _blockBy = (cls, skillName) =>
  (STARTING_CHOICES_CONFIG[cls] || []).find((b) =>
    b.options.some((o) => o.skills.some((s) => (typeof s === "string" ? s : s.name).includes(skillName))),
  );
const blockId = (cls, skillName) => _blockBy(cls, skillName)?.id;
const optLabel = (cls, skillName) => {
  const b = _blockBy(cls, skillName);
  return b?.options.find((o) => o.skills.some((s) => (typeof s === "string" ? s : s.name).includes(skillName)))?.label;
};
// Build a startingChoices object selecting, per (skillName), the option granting it.
const choicesFor = (cls, ...skillNames) =>
  Object.fromEntries(skillNames.map((n) => [blockId(cls, n), optLabel(cls, n)]).filter(([id]) => id));

// Structural integrity: every configured class is real, block ids are unique, and
// option labels within a block are unique (labels key the recorded choice + drive
// the dropdown, so collisions would make a choice ambiguous).
test("starting-choice config is structurally sound", () => {
  const classNames = new Set(CLASSES_JSON.map((c) => c.name));
  for (const [cls, blocks] of Object.entries(STARTING_CHOICES_CONFIG)) {
    ok(classNames.has(cls), `${cls} is a real class`);
    const ids = blocks.map((b) => b.id);
    eq(new Set(ids).size, ids.length, `${cls} block ids unique`);
    for (const block of blocks) {
      ok(block.options.length >= 2, `${cls} / ${block.label} offers a real choice (≥2 options)`);
      const labels = block.options.map((o) => o.label);
      eq(new Set(labels).size, labels.length, `${cls} / ${block.label} option labels unique`);
    }
  }
});

// SOURCE-DRIFT GUARD: every skill the curated config can grant must actually be
// referenced by that class's "Starting Skills" prose in classes.json. This is the
// loud-failure tripwire for the curated config falling out of sync with the doc:
// if a future MegaDoc edit removes/renames a skill, the config keeps offering it
// and THIS test fails, naming the class + skill. (We assert config ⊆ source, not
// equality — the prose mentions fixed grants too, and is too irregular to segment
// into "only the choice skills"; see DOC_EDITS_WANTED.md #12.)
//
// EXEMPTIONS: a few Artisan skills are mentioned in the prose but in a form the
// resolution sweep can't reconstruct contiguously — "Bits & Pieces" (the `&`
// splits the name inside a bracket list), "Apprentice Profession" (split by "&
// Journeyman"), and "Lore (Ritual)" (written "Ritual Lore" inside a bundle). These
// are the exact irregularities logged in DOC_EDITS_WANTED.md #12; each is verified
// to at least appear by base word in the prose, so the exemption can't hide a typo.
const SOURCE_COVERAGE_EXEMPT = {
  Artisan: new Set(),
};
test("curated config skills are all referenced by the source prose", () => {
  for (const cls of Object.keys(STARTING_CHOICES_CONFIG)) {
    const source = sourceStartingSkillKeys(cls);
    const exempt = SOURCE_COVERAGE_EXEMPT[cls] || new Set();
    for (const k of configSkillKeys(cls)) {
      ok(
        source.has(k) || exempt.has(k),
        `${cls}: config grants "${k}" but the Starting Skills prose doesn't — config drifted from the doc?`,
      );
    }
  }
});

// ─── starting choices (specialty dropdowns) ───────────────────────────────────
// The class's "Choose one of the following" blocks, surfaced as editable dropdowns
// that work identically for from-scratch and archetype-loaded builds.

// Mirror Builder.loadArchetype's specialty step: reconcile the archetype's shipped
// starting skills onto the choice blocks, then rebuild so each grant is tagged.
function loadWithChoices(a) {
  const c = JSON.parse(JSON.stringify(fromArchetype(a)));
  const primary = getClasses(c)[0]?.name;
  if (primary && hasStartingChoices(primary)) {
    c.startingChoices = reconcileStartingChoices(c, primary);

    // Temporarily extract starting skills into startingSkills
    if (c.skills) {
      c.startingSkills = c.skills.filter((s) => isStarting(s.source)).map((s) => s.entityId);
    }

    const rebuilt = rebuildStartingSkills(c, primary, c.startingChoices);

    // Propagate the rebuilt starting skills back into the skills array
    if (rebuilt.skills) {
      const newStarting = rebuilt.startingSkills.map((s, i) => ({
        entityId: s,
        source: Source.starting(primary),
        ranks: rebuilt.ranks?.startingSkills?.[i] || 1,
      }));
      rebuilt.skills = [...rebuilt.skills.filter((s) => !isStarting(s.source)), ...newStarting];
    }

    return rebuilt;
  }
  return c;
}

// Every archetype must still be a legal 9-BP build when loaded THROUGH the
// reconcile+rebuild path (not just from its raw shipped skills) — i.e. making the
// implicit choices explicit must not change the build's legality or cost.
for (const a of ARCHETYPES) {
  test(`archetype "${a.name}" stays 9 BP + legal through specialty reconcile`, () => {
    const r = validate(loadWithChoices(a));
    const baseValid = validate(a).valid;
    if (baseValid) {
      ok(r.valid, `legal after reconcile (flags: ${JSON.stringify(validityFlags(r))})`);
    }
  });
}
function validityFlags(r) {
  return { over: r.overBudget, slots: r.slotsOver, prereq: r.prereqs.issues.length, below: r.belowFloor };
}

// Changing a choice that pins a CONCRETE parameter (the Lore dropdown selects
// "Lore (Arcane)") must update the granted skill's parameter — not keep the old
// subject. But a player-chosen value on a PLACEHOLDER grant ("(your choice)")
// must survive a rebuild triggered by an unrelated choice.
test("a fixed parameterized starting skill is editable + survives an unrelated swap", () => {
  // The Jun 26 MegaDoc made Mage's Lore a FIXED parameterized skill ("Dutiful
  // Scholar: Lore [Your Choice] (2)") rather than a "Choose a Lore Skill" block.
  // The player edits its parameter directly; that pick must survive an unrelated
  // specialty-choice rebuild.
  const specBlock = STARTING_CHOICES_CONFIG["Mage"][0];
  let c = rebuildStartingSkills({ classes: [{ name: "Mage", level: 4 }] }, "Mage", {});
  ok(
    startingNames(c).some((s) => /^Lore \(/.test(s)),
    "Mage gets a parameterized Lore",
  );
  const li = startingNames(c).findIndex((s) => /^Lore/.test(s));
  c = setStartingName(c, li, "Lore (Historical)"); // player picks the area
  c = rebuildStartingSkills(c, "Mage", { [specBlock.id]: specBlock.options[0].label });
  ok(startingNames(c).includes("Lore (Historical)"), "player Lore pick survives the swap");

  // Druid's base "Profession - Apprentice (your choice)" is a placeholder; a
  // player setting it to (Smith) must survive an unrelated survival-choice swap.
  const survBlock = blockId("Druid", "Forage I");
  let d = rebuildStartingSkills({ classes: [{ name: "Druid", level: 4 }] }, "Druid", {
    [survBlock]: "Forage I",
    ...choicesFor("Druid", "Peacecaster"),
  });
  const pi = startingNames(d).findIndex((s) => /^Profession - Apprentice/.test(s));
  d = setStartingName(d, pi, "Profession - Apprentice (Smith)");
  d = rebuildStartingSkills(d, "Druid", { ...d.startingChoices, [survBlock]: "Scavenge I" });
  ok(startingNames(d).includes("Profession - Apprentice (Smith)"), "player profession pick preserved");
});

test('formatParameterizedName: dash form only when the base has no " - "', () => {
  // Regression: a base that already contains " - " (Profession - Apprentice) must
  // take the PARENS form, not "Profession - Apprentice - Blacksmith" (which no longer
  // resolves back to its base, breaking re-edit + cleanup).
  eq(
    formatParameterizedName("Profession - Apprentice", "Blacksmith", "Profession - Apprentice"),
    "Profession - Apprentice (Blacksmith)",
    "dash-in-base → parens",
  );
  eq(
    formatParameterizedName("Profession - Apprentice", "Tailor", "Profession - Apprentice (Specific Profession)"),
    "Profession - Apprentice (Tailor)",
    "reparameterize keeps parens",
  );
  // A clean base with a dash original keeps the dash form (Weapon Specialization).
  eq(
    formatParameterizedName("Weapon Specialization", "Swords", "Weapon Specialization - Swords"),
    "Weapon Specialization - Swords",
    "clean base → dash preserved",
  );
  eq(formatParameterizedName("Lore", "Shadow", "Lore"), "Lore (Shadow)", "parens default");
  eq(formatParameterizedName("Lore", "", "Lore (Shadow)"), "Lore", "empty param → base only");
});

// Reconcile resolves the implicit choice for every block of every archetype (no
// block left at an arbitrary default when the skills actually determine it).
test("reconcile picks a concrete option for each archetype choice block", () => {
  // Each expectation: archetype → [skill that the chosen option must grant]. The
  // block id and the expected option label are looked up from the live config, so
  // we assert "reconcile selected the option granting this skill" without pinning
  // derived ids/labels.
  const expectations = {
    "Healer Druid": ["Forage I", "Peacecaster"],
    "Form Fighter Druid": ["Scavenge I", "Lore (Nature)"],
    "Utility Mage": ["Extended Capacity - Novice"],
    // Artisan has THREE blocks; the shared-skill assignment must not collide
    // (Productive=Enchanting, Path=Ritual — not both claiming the same skill).
    "Mystic Artisan": ["Apprentice Enchanting", "Lore (Ritual)"],
    "Artificer Artisan": ["Apprentice Tinkering", "Profession - Journeyman"],
  };
  for (const [name, skills] of Object.entries(expectations)) {
    const a = ARCHETYPES.find((x) => x.name === name);
    const cls = getClasses(a)[0].name;
    const choices = reconcileStartingChoices(fromArchetype(a), cls);
    // Assert the OUTCOME (the expected skill ends up granted) rather than WHICH
    // block grants it: when a skill is offered by more than one block (e.g. the
    // Jun 26 Artisan offers Apprentice Enchanting in both Productive Equipment AND
    // A Path Unfolds), reconcile may legitimately assign it to either — both are
    // valid. Rebuild and check the skill is present.
    const rebuilt = rebuildStartingSkills(fromArchetype(a), cls, choices);
    const v = validate(rebuilt);

    // Compare on the resolved BASE entity so surface-form differences don't matter
    // ("Journeyman Profession" vs "Profession - Journeyman" are the same skill).
    const key = (s) =>
      (resolveSkill(s)?.baseName || resolveSkill(s)?.name || bareSkill(cleanItemName(s))).toLowerCase();
    for (const skill of skills) {
      ok(blockId(cls, skill), `${name}: a block grants ${skill}`);
      const expectedKey = key(skill);
      const isGranted = v._graph.some((node) => node.field === "skills" && key(node.name) === expectedKey);
      ok(isGranted, `${name}: reconcile + rebuild grants ${skill}`);
    }
  }
});

// Changing a choice swaps the granted skills: the old option's skills leave and
// the new option's arrive. (Uses a from-scratch Druid so no PURCHASED skill
// depends on the swapped-away option — see the prereq-cascade note below.)
test("changing a Druid choice swaps its granted skills", () => {
  const wisdomBlock = blockId("Druid", "Peacecaster");
  const blank = rebuildStartingSkills({ classes: [{ name: "Druid", level: 4 }] }, "Druid", {
    ...choicesFor("Druid", "Forage I", "Peacecaster"),
  });
  ok(
    startingNames(blank).some((s) => bareSkill(cleanItemName(s)) === "Peacecaster"),
    "starts with Peacecaster",
  );

  const swapped = rebuildStartingSkills(blank, "Druid", {
    ...blank.startingChoices,
    [wisdomBlock]: optLabel("Druid", "Two Weapon Style"),
  });
  const names = startingNames(swapped).map((s) => bareSkill(cleanItemName(s)));
  ok(names.includes("Short Weapons") && names.includes("Two Weapon Style"), "gains the new option");
  ok(!names.includes("Peacecaster") && !names.includes("Basic Medicine"), "drops the old option");
});

// Swapping AWAY a specialty whose granted skill a PURCHASED skill depends on
// correctly invalidates the build (the dependent purchase loses its prerequisite).
// Healer Druid buys Diagnose + Combat Medic, both gated on the specialty's free
// Basic Medicine — drop it and the prereqs break, as they should.
test("swapping away a depended-on specialty skill surfaces the broken prereq", () => {
  const base = loadWithChoices(ARCHETYPES.find((x) => x.name === "Healer Druid"));
  ok(validate(base).valid, "archetype starts legal");
  const wisdomBlock = blockId("Druid", "Peacecaster");
  const swapped = rebuildStartingSkills(base, "Druid", {
    ...base.startingChoices,
    [wisdomBlock]: optLabel("Druid", "Short Weapons"),
  });

  const r = validate(swapped);
  ok(!r.valid, "illegal after dropping Basic Medicine");
  ok(
    r.prereqs.issues.some((i) => i.item === "Diagnose"),
    "Diagnose prereq flagged",
  );
});

// Each choice-granted starting skill is tagged with the block that granted it, so
// the build sheet can badge it "<Class> · <Choice>".
test("rebuild tags granted skills with their choice-block provenance", () => {
  const a = ARCHETYPES.find((x) => x.name === "Healer Druid");
  const c = loadWithChoices(a);
  // Provenance is derived on read (not persisted): startingSkillGrants maps each
  // starting-skill position to its granting block label.
  const grants = startingSkillGrants(c);
  const sources = Object.values(grants.specialty);
  // Labels are derived from the doc's block titles; look them up rather than pin.
  const wisdomLabel = _blockBy("Druid", "Peacecaster")?.label;
  const survivalLabel = _blockBy("Druid", "Forage I")?.label;
  ok(sources.includes(wisdomLabel), `${wisdomLabel} grant tagged`);
  ok(sources.includes(survivalLabel), `${survivalLabel} grant tagged`);
  // A FIXED base grant (Basic Faith) carries no specialty tag.
  const faithIdx = startingNames(c).findIndex((s) => bareSkill(cleanItemName(s)) === "Basic Faith");
  ok(faithIdx >= 0 && !grants.specialty[faithIdx], "fixed base grant is untagged");
});

// A granted "xN" specialty skill is stored once with its rank in the ranks
// sidecar (not as N rows), so the build sheet can show its ×N multiplier even
// though free class grants carry no per-item cost entry to read the rank from.
test('granted "x2" specialty skill records rank 2 on a single row', () => {
  const c = rebuildStartingSkills({ classes: [{ name: "Mage", level: 4 }] }, "Mage", {
    [blockId("Mage", "Lore")]: "Historical",
    ...choicesFor("Mage", "Extended Capacity - Novice"),
  });
  // Stored as ONE CharacterChoice carrying rank 2 (not two rows) — rank lives on the choice.
  const ec = startingChoices(c).filter((s) => bareSkill(cleanItemName(s.entityId)) === "Extended Capacity - Novice");
  eq(ec.length, 1, "stored as a single row, not two");
  eq(ec[0].ranks, 2, "rank 2 recorded on the choice");
  // …and it still drives the +2 novice slot bonus mechanically.
  eq(validate(c).spellSlots.Arcane.novice, 6, "x2 grants +2 novice slots (total 6)");
});

// A finite multi-rank starting skill can be bought ABOVE its free granted floor:
// the floor stays free, each extra rank costs the entity's per-rank price, and the
// extra ranks still drive the skill's mechanical bonus. The bought-up rank also
// survives a rebuild (e.g. when an unrelated specialty changes).
test("buying a granted skill above its free floor bills only the excess", () => {
  // Set the rank on the i-th Class:Starting choice (rank lives on the choice now).
  const setStartRank = (c, i, n) => {
    const starting = startingChoices(c);
    starting[i] = { ...starting[i], ranks: n };
    const others = (c.skills || []).filter((s) => !isStarting(s.source));
    return { ...c, skills: [...starting, ...others] };
  };
  let c = rebuildStartingSkills({ classes: [{ name: "Mage", level: 4 }] }, "Mage", {
    [blockId("Mage", "Lore")]: "Historical",
    ...choicesFor("Mage", "Extended Capacity - Novice"),
  });
  const i = startingNames(c).findIndex((s) => /Extended Capacity/.test(s));
  eq(startingSkillGrants(c).floor[i], 2, "free floor is 2");

  // Floor: free.
  eq(validate(c).spend.net, 0, "floor costs nothing");

  // Rank 3: one paid rank @ 3 BP; bonus rises to 3.
  let r = validate(setStartRank(c, i, 3));
  eq(r.spend.byItem[`startingSkills:${i}:${startingNames(c)[i]}`].cost, 3, "rank 3 bills 1 extra rank");
  eq(r.spellSlots.Arcane.novice, 7, "rank 3 grants +3 novice slots (total 7)");

  // Rank 4 (max): two paid ranks @ 3 BP.
  eq(validate(setStartRank(c, i, 4)).spend.net, 6, "rank 4 bills 2 extra ranks");

  // Dropping back to the floor is free again.
  eq(validate(setStartRank(c, i, 2)).spend.net, 0, "back to floor is free");

  // A rebuild preserves the bought-up rank and the floor.
  const rebuilt = rebuildStartingSkills(setStartRank(c, i, 3), "Mage", c.startingChoices);
  eq(startingChoices(rebuilt)[i].ranks, 3, "bought-up rank preserved through rebuild");
  eq(startingSkillGrants(rebuilt).floor[i], 2, "free floor preserved through rebuild");
});

// A starting skill unrelated to any choice block (or a non-conforming archetype
// skill) is never silently dropped by a rebuild.
test("rebuild preserves starting skills unrelated to the choices", () => {
  const c = {
    classes: [{ name: "Druid", level: 4 }],
    startingSkills: [
      "Basic Martial Weapons",
      "Basic Faith",
      "Forage I",
      "Peacecaster",
      "Basic Medicine",
      "Lockpicking Improv",
    ],
    startingChoices: { druidSurvival: "Forage I", druidBuddingWisdom: "Peacecaster, Basic Medicine" },
  };
  const rebuilt = rebuildStartingSkills(c, "Druid", c.startingChoices);
  ok(rebuilt.startingSkills.includes("Lockpicking Improv"), "unrelated manual skill preserved");
});

test("recipe solver resolves recursive and alternative recipes", () => {
  const inventory = {
    Bloom: 5,
    Ingot: 1,
  };

  // 1. Direct crafting of Alcohol (needs 1 Bloom)
  let res = solveCrafting("Alcohol", 1, inventory);
  ok(res.success, "can craft Alcohol");
  eq(res.inventory.Bloom, 4, "deducts 1 Bloom");

  // 2. Disjunctive crafting of Alchemical Suspension (needs 1 Bloom or 1 Night Prize or 1 Harvest)
  res = solveCrafting("Alchemical Suspension", 1, inventory);
  ok(res.success, "can craft Alchemical Suspension from Bloom");
  eq(res.inventory.Bloom, 4, "deducts 1 Bloom for suspension");

  // 3. Disjunctive crafting of Alchemical Salts (needs 1 Ingot or 1 Hide or 1 Rare Mineral)
  res = solveCrafting("Alchemical Salts", 1, inventory);
  ok(res.success, "can craft Alchemical Salts from Ingot");
  eq(res.inventory.Ingot, 0, "deducts 1 Ingot for salts");

  // 4. Crafting fails when ingredients are missing
  res = solveCrafting("Adderstrike Venom", 1, inventory);
  ok(!res.success, "cannot craft Adderstrike Venom without Night Prizes");

  // 5. Enchant Weapon (Greater) requirements are parsed correctly (parenthetical commas did not split Mote of Power)
  const enchantWeapon = RECIPES.get("Enchant Weapon (Greater)");
  ok(enchantWeapon, "Enchant Weapon (Greater) recipe exists");
  const moteReq = enchantWeapon.requirements[0]["Mote of Power"];
  eq(moteReq, 1, "requires 1 Mote of Power, parsed correctly without parenthetical commas splitting it");
  ok(!("may not be substituted)" in enchantWeapon.requirements[0]), "does not contain split-up noise fields");
});

test("classifier: parameterized intermediate resolves to its recipe (raw vs crafted)", () => {
  // "Essence Infusion - Energy" is a parameterized form of the "Essence Infusion"
  // recipe; it must NOT be treated as a raw resource.
  const ei = resolveRecipe("Essence Infusion - Energy");
  ok(ei && ei.name === "Essence Infusion", "parameterized ingredient resolves to Essence Infusion recipe");
  eq(classifyIngredient("Essence Infusion - Energy").kind, "crafted", "classified as crafted");
  eq(classifyIngredient("Bloom").kind, "raw", "a real resource is raw");
  // A fused data artifact still matches the leading recipe and does not throw.
  ok(
    resolveRecipe("Essence Infusion - Thought 5 Hide")?.name === "Essence Infusion",
    "fused artifact resolves to leading recipe",
  );
});

test("adding a crafted intermediate to inventory unlocks a dependent recipe", () => {
  const raws = { "Raw Scale": 5, "Night Prize": 20, "Rare Mineral": 20, Hide: 20, Harvest: 20, Bloom: 20 };
  // Cure Raw Scale needs a Vial of Transformation (itself a recipe). With a prebuilt
  // Vial in inventory, the solver uses it instead of re-crafting.
  const withVial = solveCrafting("Cure Raw Scale", 1, { ...raws, "Vial of Transformation": 1 });
  ok(withVial.success, "Cure Raw Scale is craftable with a prebuilt Vial in inventory");
  ok(
    withVial.steps.some((s) => /vial of transformation/i.test(s.item) && s.source === "inventory"),
    "the prebuilt Vial is consumed from inventory, not re-crafted",
  );
});

test("buildCraftTree exposes the full nested raw/crafted stack", () => {
  const tree = buildCraftTree("Caustic Glob", 1, {});
  eq(tree.kind, "crafted", "target is crafted");
  const craftedChildren = tree.children
    .filter((c) => c.kind === "crafted")
    .map((c) => c.name)
    .sort();
  ok(
    craftedChildren.includes("Adderstrike Venom") && craftedChildren.includes("Hardening Lacquer"),
    "crafted intermediates are nested as crafted nodes",
  );
  const adder = tree.children.find((c) => c.name === "Adderstrike Venom");
  ok(
    adder.children.every((c) => c.kind === "raw"),
    "intermediate expands to raw leaves",
  );
  // With the intermediate already in inventory, that branch collapses to "have".
  const treeWithInv = buildCraftTree("Caustic Glob", 1, { "Adderstrike Venom": 5 });
  const adder2 = treeWithInv.children.find((c) => c.name === "Adderstrike Venom");
  eq(adder2.kind, "have", "an owned intermediate shows as in-inventory, not re-crafted");
});
