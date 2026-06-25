import { getClasses } from "./resolver.js";
import {
  STARTING_CHOICES_CONFIG, hasStartingChoices, reconcileStartingChoices, rebuildStartingSkills
} from '../engine/starting-choices.js';

// ─── INITIAL STATE TEMPLATE ──────────────────────────────────────────────────
export const EMPTY_CHARACTER = {
  name: "",
  archetypeName: null,       // which archetype this was loaded from (for the badge)
  classLevels: null,         // "Cleric 4" — single class for now
  specialization: null,      // "Mystic" / "Crafter" / "Artificer" — only for Artisan
  lineage: null,             // "Human" / "Aewen" / ...
  sublineage: null,
  devotion: null,            // for clerics: "The Mother" / "Senri" / ...
  lifePoints: null,
  armorPoints: null,
  spikes: null,
  wealth: null,              // null → DEFAULT_WEALTH (8); perks/sheet may set it
  resources: null,           // free-form, from the sheet
  startingSkills: [],
  purchasedSkills: [],
  purchasedPerks: [],
  flaws: [],
  advantageChoices: {},
  grantedSelections: {},
  innatePowers: [], utilityPowers: [], basicPowers: [],
  advancedPowers: [], veteranPowers: [], classPowers: [],
  rightHandPowers: [], cantrips: [],
  noviceSpells: [], adeptSpells: [], greaterSpells: [], bookSpells: [],
  domainPowers: [], formPowers: [],
  agileLearnerTrades: {},
  multiclassAllocations: {},
};

// ─── PURE STATE MODIFIERS ───────────────────────────────────────────────────
export function applyClassStartingAbilities(character, className, level = 1) {
  const isPrimary = getClasses(character)[0]?.name === className;

  let nextCharacter = { ...character };
  if (isPrimary) {
    const expectedKeys = (STARTING_CHOICES_CONFIG[className] || []).map((c) => c.id);
    const hasAllExpected = expectedKeys.every((k) => character.startingChoices?.[k] !== undefined);
    const hasOnlyExpected = Object.keys(character.startingChoices || {}).every((k) => expectedKeys.includes(k));
    if (!character.startingChoices || !hasAllExpected || !hasOnlyExpected) {
      nextCharacter.startingChoices = reconcileStartingChoices(character, className);
    }
    nextCharacter = rebuildStartingSkills(nextCharacter, className);
  }

  return nextCharacter;
}

export function loadArchetype(archetype) {
  const c = { ...EMPTY_CHARACTER, archetypeName: archetype.name };
  for (const k of Object.keys(EMPTY_CHARACTER)) {
    if (k === "archetypeName") continue;
    if (archetype[k] !== undefined) c[k] = archetype[k];
  }
  if (archetype.grants) c.grants = archetype.grants;
  if (archetype.effectiveBP) c.effectiveBP = archetype.effectiveBP;
  if (archetype.ranks) c.ranks = archetype.ranks;
  const primary = getClasses(c)[0]?.name;
  if (primary && hasStartingChoices(primary)) {
    c.startingChoices = reconcileStartingChoices(c, primary);
    return rebuildStartingSkills(c, primary, c.startingChoices);
  }
  return c;
}

