import { REFS } from './data.js';

/**
 * Extractor plugins for the CharacterGraph.
 * Each extractor takes an entity and character context and returns an array of Effects.
 * This pattern keeps `graph.js` agnostic to specific game mechanics.
 */

function extractDiscounts(ent, character, id) {
  if (REFS.discounts?.[id]) {
    return [{ type: 'DISCOUNT_SOURCE', discount: REFS.discounts[id] }];
  }
  return [];
}

function extractGlobalGrants(ent, character, id) {
  const isChoice = ent?.chooseOne?.kind === 'build' ||
    /\b(?:choose\s+one|gains?\s+one\s+of|one\s+of\s+the\s+following|gains?\s+one\s+skill)\b/i.test(ent?.requirement || '') ||
    /\b(?:choose\s+one|gains?\s+one\s+of|one\s+of\s+the\s+following|gains?\s+one\s+skill)\b/i.test(ent?.description || '') ||
    /\b(?:choose\s+one|gains?\s+one\s+of|one\s+of\s+the\s+following|gains?\s+one\s+skill)\b/i.test(ent?.skillsAndOptions || '');
    
  if (REFS.grants?.[id] && !isChoice) {
    return [{ type: 'GRANT_SOURCE', grants: REFS.grants[id] }];
  }
  return [];
}

function extractWealth(ent, character, id) {
  if (ent?.wealthIncome) {
    return [{
      type: 'WEALTH', 
      amount: ent.wealthIncome.n,
      note: ent.wealthIncome.kind === 'manse' ? 'or resources' : 
            ent.wealthIncome.kind === 'firstEvent' ? 'one-time, first event' : undefined
    }];
  }
  return [];
}

function extractStatMods(ent, character, id) {
  if (ent?.statMods) {
    return ent.statMods.map(mod => ({ type: 'STAT', stat: mod.stat, amount: mod.n }));
  }
  return [];
}

// A build chooseOne option's granted skills. The parser emits this under `grants`
// for most powers but `grantsSkills` for a few (Way of the Blade) — read either so a
// field-name drift never silently drops the grant (which left the chosen spec NOT
// free). Normalizing the parser too, but stay tolerant here.
const optGrants = (o) => o?.grants || o?.grantsSkills || [];

function extractChooseOne(ent, character, id) {
  if (ent?.chooseOne?.kind === 'build') {
    const chosen = character.choices?.[`powers:${ent.name}`];
    if (chosen) {
      // Find the option by direct text match, or by seeing if one of its granted skills matches the chosen string.
      const opt = ent.chooseOne.options.find((o) => o.text === chosen || optGrants(o).includes(chosen));
      const grants = optGrants(opt);
      if (grants.length > 0) {
        return [{ type: 'GRANT_SOURCE', grants: grants.map(s => `skills:${s}`) }];
      }
    }
  }
  return [];
}

export const EFFECT_EXTRACTORS = [
  extractDiscounts,
  extractGlobalGrants,
  extractWealth,
  extractStatMods,
  extractChooseOne
];
