import { getClasses, cleanItemName } from "./resolver.js";
import { getAllEntities } from "./data.js";
import {
  STARTING_CHOICES_CONFIG, hasStartingChoices, reconcileStartingChoices, rebuildStartingSkills
} from '../engine/starting-choices.js';

// Infer build choose-one selections (Way of the Blade, Expert Craft) from the skills
// a character already owns. Archetypes ship the granted skills + a grant sidecar but
// often NO `choices` entry, so the chooseOne UI shows nothing selected and the choice
// can't be changed/cleaned. This is the read-side counterpart: if an owned skill
// matches one of a build choose-one's options' granted skills, that option was chosen.
// Mirrors reconcileStartingChoices (derive choices from the resolved character).
function reconcileBuildChoices(character) {
  // Options differ only by their PARAMETERIZED grant ("Weapon Specialization -
  // Swords" vs "- Daggers"), so match on the full param-aware key, not the bare
  // skill (which would make every option look matched). Normalize both the dash
  // form ("Foo - Swords") and the parens form ("Foo (Swords)") to "foo|swords".
  const key = (name) => {
    const clean = cleanItemName(name);
    const m = clean.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (m && !/^\d+$/.test(m[2].trim())) return `${m[1].trim().toLowerCase()}|${m[2].trim().toLowerCase()}`;
    const dash = clean.match(/^(.*?) - ([^-]+)$/);
    if (dash) return `${dash[1].trim().toLowerCase()}|${dash[2].trim().toLowerCase()}`;
    return clean.toLowerCase();
  };
  const owned = new Set(
    [...(character.startingSkills || []), ...(character.purchasedSkills || []), ...(character.classSkills || [])]
      .map(key),
  );
  const choices = { ...(character.choices || {}) };
  for (const ent of getAllEntities()) {
    if (ent.chooseOne?.kind !== 'build') continue;
    const choiceKey = `powers:${ent.name}`;
    if (choices[choiceKey]) continue; // already recorded — don't override an explicit pick
    for (const opt of ent.chooseOne.options) {
      const grants = opt.grants || opt.grantsSkills || [];
      // The option's DISTINGUISHING grant is its parameterized one; require that it's
      // owned (shared grants like "Two Weapon Style" can't tell options apart).
      const distinguishing = grants.filter((g) => key(g).includes('|'));
      const probe = distinguishing.length ? distinguishing : grants;
      if (probe.length && probe.every((g) => owned.has(key(g)))) {
        choices[choiceKey] = opt.text;
        break;
      }
    }
  }
  return choices;
}

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
};

// ─── PURE STATE MODIFIERS ───────────────────────────────────────────────────
export function applyClassStartingAbilities(character, className, _level = 1) {
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
  let out = c;
  if (primary && hasStartingChoices(primary)) {
    c.startingChoices = reconcileStartingChoices(c, primary);
    out = rebuildStartingSkills(c, primary, c.startingChoices);
  }
  // Infer build choose-one selections (Way of the Blade, …) from the granted skills
  // the archetype shipped, so the choice shows as made and stays editable.
  const choices = reconcileBuildChoices(out);
  if (Object.keys(choices).length) out = { ...out, choices };
  return out;
}

