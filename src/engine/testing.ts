import { resolveCharacterGraph } from './graph.js';

export { budgetFor, bonusBudgetFor, devotionState } from './validate.js';
export { computeSlots, spellSlots, bookcasterSpellOptions, arcaneSecretsSpellOptions, weirdWanderingsOptions, studiedFocusOptions, eligibleClassChoices, agileLearnerCapacity, basicSpellOptions } from './validate/slots.js';
export { prereqStatus, checkLevelConstraint } from './validate/prereqs.js';
export { LEVEL_CAP, LEGAL_MIN_LEVEL, getMaxRanks } from './validate/core.js';
export { grantedAbilities } from './graph.js';

export function computeSpend(character) {
  return resolveCharacterGraph(character).spend;
}
