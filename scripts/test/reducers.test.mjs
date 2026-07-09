// reducers.test.mjs — coverage for the pure character-state reducers
// (src/engine/reducers.ts), the character write path.
//
// PURCHASED SKILLS are V2-native: the reducers push/patch/remove CharacterChoice
// entries in `character.skills` (source 'Purchased'), addressed positionally
// among the purchased entries — no flat `purchasedSkills`, no id. Other fields
// (perks/powers/spells) still use the flat parallel-array path until their slice.
import { test, eq, ok } from "./harness.mjs";
import { Source, isPurchased, isStarting, sourceClass } from "../../src/engine/types.js";
import {
  addEntity,
  removeEntity,
  setRank,
  setChoice,
  setSlotPick,
  clearSlot,
  updateParameter,
  setGrantedSelection,
  setAgileLearnerTrade,
  splitParameterizedName,
} from "../../src/engine/reducers.js";

// The purchased-skill entries of a character (a purchased source in skills[]).
const purchased = (c) => (c.skills || []).filter((s) => isPurchased(s.source));

// ─── addEntity (purchased skills → skills[] bucket) ─────────────────────────
test("addEntity pushes a purchased CharacterChoice with rank 1", () => {
  const c = addEntity({}, "purchasedSkills", "Athletics");
  const p = purchased(c);
  eq(p.length, 1, "one purchased skill present");
  eq(p[0].entityId, "Athletics", "entityId stored");
  ok(isPurchased(p[0].source), "source tagged purchased");
  eq(p[0].ranks, 1, "rank defaults to 1");
});
test("addEntity accepts the resolved 'skills' field too (row field)", () => {
  // The picker adds via 'purchasedSkills'; a resolved row carries 'skills'. Both
  // address the purchased bucket.
  const c = addEntity({}, "skills", "Stealth");
  eq(purchased(c).length, 1, "added via 'skills' field");
});
test("addEntity appends multiple purchased skills in order", () => {
  let c = addEntity({}, "purchasedSkills", "Athletics");
  c = addEntity(c, "purchasedSkills", "Stealth");
  eq(purchased(c).map((s) => s.entityId).join(","), "Athletics,Stealth", "both, in order");
});
test("addEntity is a no-op for a duplicate (non-unlimited) name", () => {
  const c0 = addEntity({}, "purchasedSkills", "Athletics");
  const c1 = addEntity(c0, "purchasedSkills", "Athletics");
  eq(c1, c0, "same reference returned (no change)");
  eq(purchased(c1).length, 1, "still only one");
});
test("addEntity does not mutate its input", () => {
  const input = { skills: [{ entityId: "Athletics", source: Source.purchased(), ranks: 1 }] };
  const out = addEntity(input, "purchasedSkills", "Stealth");
  eq(input.skills.length, 1, "input untouched");
  eq(purchased(out).length, 2, "output extended");
});
test("addEntity preserves non-purchased (e.g. starting) skill entries", () => {
  const input = { skills: [{ entityId: "Lore (Arcane)", source: Source.starting("Mage"), ranks: 1 }] };
  const out = addEntity(input, "purchasedSkills", "Athletics");
  eq(out.skills.length, 2, "starting entry kept + purchased added");
  eq((out.skills || []).filter((s) => isStarting(s.source)).length, 1, "starting preserved");
});

// ─── removeEntity (positional within purchased bucket) ──────────────────────
test("removeEntity removes the purchased skill at the given position", () => {
  const c0 = {
    skills: [
      { entityId: "A", source: Source.purchased(), ranks: 1 },
      { entityId: "B", source: Source.purchased(), ranks: 2 },
      { entityId: "C", source: Source.purchased(), ranks: 3 },
    ],
  };
  const c = removeEntity(c0, "skills", 1);
  eq(purchased(c).map((s) => s.entityId).join(","), "A,C", "B removed by position");
  eq(purchased(c).map((s) => s.ranks).join(","), "1,3", "surviving ranks intact");
});
test("removeEntity is a no-op for an out-of-range position", () => {
  const c0 = { skills: [{ entityId: "A", source: Source.purchased(), ranks: 1 }] };
  eq(removeEntity(c0, "skills", 5), c0, "same reference (no change)");
});
test("add then remove round-trips to empty", () => {
  let c = addEntity({}, "purchasedSkills", "Athletics");
  c = removeEntity(c, "purchasedSkills", 0);
  eq(purchased(c).length, 0, "purchased skill gone");
});

// ─── setRank (rank on the CharacterChoice) ──────────────────────────────────
test("setRank sets the rank on the purchased skill at the given position", () => {
  const c0 = {
    skills: [
      { entityId: "A", source: Source.purchased(), ranks: 1 },
      { entityId: "B", source: Source.purchased(), ranks: 1 },
      { entityId: "C", source: Source.purchased(), ranks: 1 },
    ],
  };
  const c = setRank(c0, "skills", 2, 4);
  eq(purchased(c)[2].ranks, 4, "target rank set");
  eq(purchased(c)[0].ranks, 1, "others untouched");
});

// ─── setChoice ──────────────────────────────────────────────────────────────
test("setChoice sets, then toggles off when reselecting the same option", () => {
  const c1 = setChoice({}, "pow1", "Fire");
  eq(c1.choices.pow1, "Fire", "choice set");
  const c2 = setChoice(c1, "pow1", "Fire");
  eq(c2.choices.pow1, undefined, "reselecting clears it");
  ok(!("pow1" in c2.choices), "key deleted, not left undefined");
});
test("setChoice clears when option is null", () => {
  const c = setChoice({ choices: { pow1: "Fire" } }, "pow1", null);
  ok(!("pow1" in c.choices), "null clears the choice");
});

// ─── slot pick / clear (V2 powers bucket) ───────────────────────────────────
// Slot powers are CharacterChoice[] in powers[], costField = the slot field, and
// sourced Source.class(<grantingClass>) — the class lives IN the source, not a
// parallel powerClass map. Addressing is positional among a field's entries.
const slotEntries = (c, field) => (c.powers || []).filter((p) => p.costField === field);
test("setSlotPick places a power sourced to the granting class", () => {
  const c = setSlotPick({}, "basicPowers", 0, "Battlemind", "Fighter");
  const e = slotEntries(c, "basicPowers");
  eq(e.length, 1, "one slot entry");
  eq(e[0].entityId, "Battlemind", "power placed");
  eq(sourceClass(e[0].source), "Fighter", "granting class in source");
  eq(e[0].costField, "basicPowers", "costField preserved for BP keying");
});
test("setSlotPick with flatIndex < 0 appends", () => {
  const c0 = setSlotPick({}, "basicPowers", 0, "Battlemind", "Fighter");
  const c = setSlotPick(c0, "basicPowers", -1, "Disengage", "Fighter");
  eq(slotEntries(c, "basicPowers").map((p) => p.entityId).join(","), "Battlemind,Disengage", "appended at end");
});
test("setSlotPick keeps other-field power entries untouched", () => {
  const c0 = setSlotPick({}, "utilityPowers", 0, "Bowyer", "Fighter");
  const c = setSlotPick(c0, "basicPowers", 0, "Battlemind", "Fighter");
  eq(slotEntries(c, "utilityPowers").length, 1, "utility entry preserved");
  eq(slotEntries(c, "basicPowers").length, 1, "basic entry added");
});
test("clearSlot removes the pick at the given position", () => {
  let c = setSlotPick({}, "basicPowers", 0, "Battlemind", "Fighter");
  c = setSlotPick(c, "basicPowers", -1, "Disengage", "Fighter");
  c = clearSlot(c, "basicPowers", 0);
  eq(slotEntries(c, "basicPowers").map((p) => p.entityId).join(","), "Disengage", "first pick removed");
});
test("clearSlot is a no-op for an out-of-range position", () => {
  const c0 = setSlotPick({}, "basicPowers", 0, "Battlemind", "Fighter");
  eq(clearSlot(c0, "basicPowers", 9), c0, "same reference (no change)");
});
test("addEntity routes classPowers to the powers bucket (purchased)", () => {
  const c = addEntity({}, "classPowers", "Cantrip Scholar");
  const e = slotEntries(c, "classPowers");
  eq(e.length, 1, "class power in bucket");
  ok(isPurchased(e[0].source), "purchased source");
  eq(e[0].costField, "classPowers", "costField preserved");
});

// ─── updateParameter (patches the purchased-skill entityId) ─────────────────
const mkPurchased = (...names) => ({
  skills: names.map((entityId) => ({ entityId, source: Source.purchased(), ranks: 1 })),
});
test("updateParameter renames the purchased skill at the given position", () => {
  const c0 = mkPurchased("Lore", "Craft");
  const c = updateParameter(c0, "skills", "Lore", "Lore (History)", 0);
  eq(purchased(c)[0].entityId, "Lore (History)", "renamed in place");
  eq(purchased(c)[1].entityId, "Craft", "sibling untouched");
});
test("updateParameter falls back to entityId match when no index is given", () => {
  const c0 = mkPurchased("Lore", "Craft");
  const c = updateParameter(c0, "skills", "Craft", "Craft (Smithing)");
  eq(purchased(c)[1].entityId, "Craft (Smithing)", "located by oldName");
});
test("updateParameter is a no-op when the purchased skill is not found", () => {
  const c0 = mkPurchased("Lore");
  const c = updateParameter(c0, "skills", "Missing", "Whatever");
  eq(c, c0, "unchanged reference");
});
test("updateParameter clears devotion state when a Worship skill loses its parameter", () => {
  const c0 = {
    ...mkPurchased("Worship (Some Deity)"),
    devotion: "Some Deity",
    divineDomains: ["War"],
    domainPowers: ["Smite"],
  };
  const c = updateParameter(c0, "skills", "Worship (Some Deity)", "Worship", 0);
  eq(purchased(c)[0].entityId, "Worship", "skill entityId cleared to bare Worship");
  eq(c.devotion, null, "devotion cleared");
  eq(c.divineDomains.length, 0, "domains cleared");
  eq(c.domainPowers.length, 0, "domain powers cleared");
});

// ─── splitParameterizedName ─────────────────────────────────────────────────
test("splitParameterizedName parses (paren) and - dash - forms", () => {
  eq(splitParameterizedName("Lore (History)").baseName, "Lore", "paren base");
  eq(splitParameterizedName("Lore (History)").paramVal, "History", "paren param");
  eq(splitParameterizedName("Worship - Sun God").baseName, "Worship", "dash base");
  eq(splitParameterizedName("Worship - Sun God").paramVal, "Sun God", "dash param");
  eq(splitParameterizedName("Athletics").paramVal, "", "bare name has no param");
});

// ─── misc keyed reducers ────────────────────────────────────────────────────
test("setGrantedSelection records under the selection id", () => {
  const c = setGrantedSelection({}, "sel1", "Option A");
  eq(c.grantedSelections.sel1, "Option A", "value stored");
});
test("setAgileLearnerTrade adjusts by delta and clamps at 0", () => {
  let c = setAgileLearnerTrade({}, "Fighter", 2);
  eq(c.agileLearnerTrades.Fighter, 2, "increased");
  c = setAgileLearnerTrade(c, "Fighter", -5);
  eq(c.agileLearnerTrades.Fighter, 0, "clamped at 0, not negative");
});
