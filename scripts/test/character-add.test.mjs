// character-add.test.mjs — coverage for the one add-to-character API. Callers pass
// a NAME; the API derives bucket / source / costField from the entity. These lock
// that derivation so a future data or rule change can't silently misfile a pick.
import { test, eq, ok, sourceClass, isPurchased } from "./harness.mjs";
import { addToCharacter } from "../../src/engine/character-add.js";
import { makeChar } from "./make-char.mjs";

const base = () => ({
  classes: [{ name: "Fighter", level: 6 }],
  skills: [],
  perks: [],
  powers: [],
  spells: [],
  flaws: [],
  devotions: [],
});
const mage = () => ({
  classes: [{ name: "Mage", level: 6 }],
  skills: [],
  perks: [],
  powers: [],
  spells: [],
  flaws: [],
  devotions: [],
});
const only = (c, bucket) => c[bucket];

// ─── bucket + source derivation, from the name alone ────────────────────────
test("a purchased skill lands in skills[] with a purchased source", () => {
  const c = addToCharacter(base(), "Athletics");
  eq(only(c, "skills").length, 1, "in skills bucket");
  eq(c.skills[0].entityId, "Athletics", "name kept");
  ok(isPurchased(c.skills[0].source), "purchased source derived");
});
test("a basic power lands in powers[] class-sourced to its parentClass, costField basicPowers", () => {
  const c = addToCharacter(base(), "Battlemind");
  eq(only(c, "powers").length, 1, "in powers bucket");
  eq(sourceClass(c.powers[0].source), "Fighter", "class-sourced to Fighter");
  eq(c.powers[0].costField, "basicPowers", "tier→costField derived");
});
test("a utility power derives utilityPowers costField", () => {
  const c = addToCharacter(base(), "Armored Shell");
  eq(c.powers[0].costField, "utilityPowers", "Utility tier → utilityPowers");
});
test("a class-tier power is PURCHASED (classPowers), not a free slot", () => {
  const c = addToCharacter(mage(), "Cantrip Scholar");
  ok(isPurchased(c.powers[0].source), "purchased, not class-slot");
  eq(c.powers[0].costField, "classPowers", "classPowers costField");
});
test("a cantrip lands in SPELLS[] (a power with a caster tier is a spell)", () => {
  const c = addToCharacter(mage(), "Force Shield");
  eq(only(c, "spells").length, 1, "routed to spells bucket, not powers");
  eq(only(c, "powers").length, 0, "not in powers");
  eq(c.spells[0].costField, "cantrips", "Cantrip tier → cantrips");
  eq(sourceClass(c.spells[0].source), "Mage", "class-sourced to Mage");
});
test("a novice spell lands in spells[] with noviceSpells costField", () => {
  const c = addToCharacter(mage(), "Arcane Barrage");
  eq(only(c, "spells").length, 1, "in spells bucket");
  eq(c.spells[0].costField, "noviceSpells", "Novice → noviceSpells");
});

// ─── opts overrides (the rare non-derivable cases) ──────────────────────────
test("param opt stores the parameter as a field, entityId stays bare", () => {
  const c = addToCharacter(base(), "Lore", { param: "Arcane" });
  eq(c.skills[0].entityId, "Lore", "entityId is the bare entity (param never concatenated)");
  eq(c.skills[0].parameter, "Arcane", "param recorded in the field");
});
test("source opt forces provenance (e.g. a starting skill)", () => {
  const c = addToCharacter(base(), "Basic Martial Weapons", { source: { type: "class", name: "Fighter" } });
  eq(c.skills[0].source.type, "class", "starting source honored");
});
test("cls opt sets the granting class for a slot power (multiclass)", () => {
  const mc = {
    classes: [
      { name: "Fighter", level: 3 },
      { name: "Rogue", level: 3 },
    ],
    skills: [],
    perks: [],
    powers: [],
    spells: [],
    flaws: [],
    devotions: [],
  };
  const c = addToCharacter(mc, "Battlemind", { cls: "Fighter" });
  eq(sourceClass(c.powers[0].source), "Fighter", "explicit cls wins");
});

// ─── the factory over the API ───────────────────────────────────────────────
test("makeChar seeds the class starting kit (realistic character)", () => {
  const c = makeChar("Fighter 4");
  ok(c.skills.length > 0, "starting skills seeded");
  ok(
    c.skills.every((s) => s.source.type === "class"),
    "all seeded skills are starting-sourced",
  );
});
test("makeChar add[] funnels through the real add API", () => {
  const c = makeChar("Fighter 4", { add: ["Battlemind", "Athletics"] });
  ok(
    c.powers.some((p) => p.entityId === "Battlemind" && p.costField === "basicPowers"),
    "power added + derived",
  );
  ok(
    c.skills.some((s) => s.entityId === "Athletics" && isPurchased(s.source)),
    "purchased skill added",
  );
});
