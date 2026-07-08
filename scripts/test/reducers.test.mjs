// reducers.test.mjs — coverage for the pure character-state reducers extracted
// from the React handler hooks (src/engine/reducers.ts). The write path used to
// be reachable only through React and had NO test coverage; these tests are the
// safety net that guards the upcoming V1→V2 flip (migration step 3). They assert
// the CURRENT V1-flat behavior: parallel `c[field]` / `ranks[field]` /
// `effectiveBP[field]` arrays, remove-by-index, append-with-rank-1.
import { test, eq, ok } from "./harness.mjs";
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

// ─── addEntity ────────────────────────────────────────────────────────────────
test("addEntity appends the name and a rank of 1", () => {
  const c = addEntity({}, "purchasedSkills", "Athletics");
  eq(c.purchasedSkills.length, 1, "one skill present");
  eq(c.purchasedSkills[0], "Athletics", "skill name stored");
  eq(c.ranks.purchasedSkills[0], 1, "rank defaults to 1");
});
test("addEntity keeps ranks index-aligned across multiple adds", () => {
  let c = addEntity({}, "purchasedSkills", "Athletics");
  c = addEntity(c, "purchasedSkills", "Stealth");
  eq(c.purchasedSkills.length, 2, "both skills present");
  eq(c.ranks.purchasedSkills.length, 2, "one rank per skill");
  eq(c.ranks.purchasedSkills[1], 1, "second rank is 1");
});
test("addEntity is a no-op for a duplicate (non-unlimited) name", () => {
  const c0 = addEntity({}, "purchasedSkills", "Athletics");
  const c1 = addEntity(c0, "purchasedSkills", "Athletics");
  eq(c1, c0, "same reference returned (no change)");
  eq(c1.purchasedSkills.length, 1, "still only one");
});
test("addEntity does not mutate its input", () => {
  const input = { purchasedSkills: ["Athletics"], ranks: { purchasedSkills: [1] } };
  const out = addEntity(input, "purchasedSkills", "Stealth");
  eq(input.purchasedSkills.length, 1, "input untouched");
  eq(out.purchasedSkills.length, 2, "output extended");
});

// ─── removeEntity ───────────────────────────────────────────────────────────
test("removeEntity removes by index and splices the parallel arrays", () => {
  const c0 = {
    purchasedSkills: ["A", "B", "C"],
    ranks: { purchasedSkills: [1, 2, 3] },
    effectiveBP: { purchasedSkills: [10, 20, 30] },
  };
  const c = removeEntity(c0, "purchasedSkills", 1);
  eq(c.purchasedSkills.join(","), "A,C", "B removed");
  eq(c.ranks.purchasedSkills.join(","), "1,3", "rank for B removed, alignment kept");
  eq(c.effectiveBP.purchasedSkills.join(","), "10,30", "BP for B removed, alignment kept");
});
test("add then remove round-trips to empty", () => {
  let c = addEntity({}, "purchasedSkills", "Athletics");
  c = removeEntity(c, "purchasedSkills", 0);
  eq(c.purchasedSkills.length, 0, "skill gone");
  eq(c.ranks.purchasedSkills.length, 0, "rank gone");
});

// ─── setRank ────────────────────────────────────────────────────────────────
test("setRank sets the rank at an index, backfilling missing ranks with 1", () => {
  const c0 = { purchasedSkills: ["A", "B", "C"] }; // no ranks array yet
  const c = setRank(c0, "purchasedSkills", 2, 4);
  eq(c.ranks.purchasedSkills.length, 3, "ranks backfilled to list length");
  eq(c.ranks.purchasedSkills[0], 1, "backfilled to 1");
  eq(c.ranks.purchasedSkills[2], 4, "target rank set");
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

// ─── slot pick / clear ──────────────────────────────────────────────────────
test("setSlotPick places a power and records the granting class", () => {
  const c = setSlotPick({}, "basicPowers", 0, "Cleave", "Fighter");
  eq(c.basicPowers[0], "Cleave", "power placed");
  eq(c.powerClass.basicPowers[0], "Fighter", "class recorded");
});
test("setSlotPick with flatIndex < 0 appends", () => {
  const c0 = setSlotPick({}, "basicPowers", 0, "Cleave", "Fighter");
  const c = setSlotPick(c0, "basicPowers", -1, "Guard", "Fighter");
  eq(c.basicPowers.join(","), "Cleave,Guard", "appended at end");
  eq(c.powerClass.basicPowers.join(","), "Fighter,Fighter", "class array aligned");
});
test("clearSlot removes a pick and keeps powerClass/effectiveBP aligned", () => {
  const c0 = {
    basicPowers: ["Cleave", "Guard"],
    powerClass: { basicPowers: ["Fighter", "Barbarian"] },
    effectiveBP: { basicPowers: [5, 7] },
  };
  const c = clearSlot(c0, "basicPowers", 0);
  eq(c.basicPowers.join(","), "Guard", "first pick removed");
  eq(c.powerClass.basicPowers.join(","), "Barbarian", "class array spliced");
  eq(c.effectiveBP.basicPowers.join(","), "7", "BP array spliced");
});

// ─── updateParameter ────────────────────────────────────────────────────────
test("updateParameter renames the item at the given index", () => {
  const c0 = { purchasedSkills: ["Lore", "Craft"] };
  const c = updateParameter(c0, "purchasedSkills", "Lore", "Lore (History)", 0);
  eq(c.purchasedSkills[0], "Lore (History)", "renamed in place");
  eq(c.purchasedSkills[1], "Craft", "sibling untouched");
});
test("updateParameter falls back to indexOf when no index is given", () => {
  const c0 = { purchasedSkills: ["Lore", "Craft"] };
  const c = updateParameter(c0, "purchasedSkills", "Craft", "Craft (Smithing)");
  eq(c.purchasedSkills[1], "Craft (Smithing)", "located by oldName");
});
test("updateParameter is a no-op when the item is not found", () => {
  const c0 = { purchasedSkills: ["Lore"] };
  const c = updateParameter(c0, "purchasedSkills", "Missing", "Whatever");
  eq(c, c0, "unchanged reference");
});
test("updateParameter clears devotion state when Worship loses its parameter", () => {
  const c0 = {
    purchasedSkills: ["Worship (Some Deity)"],
    devotion: "Some Deity",
    divineDomains: ["War"],
    domainPowers: ["Smite"],
  };
  const c = updateParameter(c0, "purchasedSkills", "Worship (Some Deity)", "Worship", 0);
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
