import { lookupEntity, LINEAGES, CLASS_PROGRESSION, REFS } from "../data/index.js";
import { cleanItemName, bareSkill, resolveId, entityType, getClasses } from './resolver.js';
import { COMMON_ALLERGENS } from './config.js';
import { 
  characterLevel, parseTrailingRank, rankOf, 
  BP_FIELDS, BP_POWER_FIELDS, POWER_SOURCE_FIELDS, 
  activeInnatePowers
} from './validate/core.js';

// Convert the flat character dictionary into a list of typed CharacterItems
export function resolveCharacterGraph(character) {
  const items = [];
  const charLevel = characterLevel(character);
  const classes = getClasses(character);

  const attachGlobalEffects = (id, effects, ent) => {
    if (REFS.discounts?.[id]) {
      effects.push({ type: 'DISCOUNT_SOURCE', discount: REFS.discounts[id] });
    }
    const isChoice = ent?.chooseOne?.kind === 'build' ||
      /\b(?:choose\s+one|gains?\s+one\s+of|one\s+of\s+the\s+following|gains?\s+one\s+skill)\b/i.test(ent?.requirement || '') ||
      /\b(?:choose\s+one|gains?\s+one\s+of|one\s+of\s+the\s+following|gains?\s+one\s+skill)\b/i.test(ent?.description || '') ||
      /\b(?:choose\s+one|gains?\s+one\s+of|one\s+of\s+the\s+following|gains?\s+one\s+skill)\b/i.test(ent?.skillsAndOptions || '');
    if (REFS.grants?.[id] && !isChoice) {
      effects.push({ type: 'GRANT_SOURCE', grants: REFS.grants[id] });
    }
  };

  const addItem = (field, rawString, sourceType, index) => {
    const cleanName = cleanItemName(rawString);
    const bareName = bareSkill(cleanName);
    const id = resolveId(rawString, field, character) 
      || `${entityType(field)}:${bareName}`;
    
    let ent = lookupEntity(id) || lookupEntity(`skills:${bareName}`) || lookupEntity(`perks:${cleanName}`) || lookupEntity(`powers:${cleanName}`);
    const rank = rankOf(character, field, index);
    const effects = [];

    // Extract Base Cost
    let baseCost = 0;
    if (Array.isArray(ent?.tiers) && ent.tiers.length) {
      const n = Math.min(rank, ent.tiers.length);
      baseCost = ent.tiers.slice(0, n).reduce((s, t) => s + (t.cost || 0), 0);
    } else {
      baseCost = (typeof ent?.cost === 'number' ? ent.cost : 0) * rank;
    }

    const authoredCost = character.effectiveBP?.[field]?.[index];
    const grantSidecar = character.grants?.[field]?.[index];

    attachGlobalEffects(ent?.id || id, effects, ent);
    
    if (ent?.wealthIncome) {
      effects.push({
        type: 'WEALTH', amount: ent.wealthIncome.n,
        note: ent.wealthIncome.kind === 'manse' ? 'or resources' : 
              ent.wealthIncome.kind === 'firstEvent' ? 'one-time, first event' : undefined
      });
    }

    if (ent?.statMods) {
      for (const mod of ent.statMods) {
        effects.push({ type: 'STAT', stat: mod.stat, amount: mod.n });
      }
    }
    
    // Choose-one powers (Expert Craft) grant the selected skill
    if (ent?.chooseOne?.kind === 'build') {
      const chosen = character.choices?.[`powers:${ent.name}`];
      if (chosen) {
        const opt = ent.chooseOne.options.find((o) => o.grantsSkill === chosen || o.text === chosen);
        if (opt?.grantsSkill) {
          effects.push({ type: 'GRANT_SOURCE', grants: [`skills:${opt.grantsSkill}`] });
        }
      }
    }

    items.push({
      id: ent?.id || id,
      name: ent?.name || cleanName,
      rawString,
      field,
      sourceType,
      index,
      rank,
      baseCost,
      authoredCost,
      grantSidecar,
      entity: ent,
      effects
    });
  };

  // 1. Process BP Fields (Starting, Purchased Skills, Perks) and classSkills
  for (const field of ['startingSkills', 'purchasedSkills', 'purchasedPerks', 'classSkills']) {
    const sourceType = field === 'startingSkills' ? 'starting' : 'purchased';
    (character[field] || []).forEach((itemStr, idx) => addItem(field, itemStr, sourceType, idx));
  }

  // 1.5 Process Flaws
  (character.flaws || []).forEach((itemStr, idx) => {
    const cleanName = cleanItemName(itemStr);
    const ent = lookupEntity(`flaws:${cleanName}`);
    let bp = 0;
    if (ent) {
      if (ent.baseName === "Mild Allergy" || ent.baseName === "Severe Allergy") {
        const isCommon = COMMON_ALLERGENS.includes(String(ent.parameter || "").toLowerCase().trim());
        bp = ent.baseName === "Mild Allergy" ? (isCommon ? 2 : 1) : (isCommon ? 3 : 2);
      } else {
        bp = typeof ent.bp === 'number' ? ent.bp : parseInt(String(ent.bp), 10) || 0;
      }
    }
    items.push({
      id: ent?.id || `flaws:${cleanName}`,
      name: ent?.name || cleanName,
      rawString: itemStr,
      field: 'flaws',
      sourceType: 'flaw',
      index: idx,
      rank: 1,
      baseCost: -bp,
      entity: ent,
      effects: [{ type: 'FLAW_AWARD', amount: bp }]
    });
  });

  // 2. Process Chosen Powers
  for (const field of POWER_SOURCE_FIELDS) {
    (character[field] || []).forEach((itemStr, idx) => addItem(field, itemStr, 'power', idx));
  }

  // 3. Process Innate Powers
  const innate = activeInnatePowers(character);
  for (const ip of innate) {
    if (ip.source === 'class') {
      const ent = lookupEntity(`powers:${ip.name}`) || ip.entity;
      const effects = [];
      const id = ent?.id || `powers:${ip.name}`;
      attachGlobalEffects(id, effects, ent);

      if (ent?.wealthIncome) {
        effects.push({ type: 'WEALTH', amount: ent.wealthIncome.n });
      }
      if (ent?.statMods) {
        for (const mod of ent.statMods) {
          effects.push({ type: 'STAT', stat: mod.stat, amount: mod.n });
        }
      }
      
      // Level-gated discounts (e.g. Ritual Affinity)
      if (ip.cls && ent?.levelDiscounts) {
        const clsLevel = classes.find((c) => c.name === ip.cls)?.level || 0;
        for (const ld of ent.levelDiscounts) {
          if (clsLevel >= ld.atLevel) {
            effects.push({
              type: 'DISCOUNT_SOURCE',
              discount: { amount: ld.amount, cap: null, min: 0, refundIfFree: true, exclusions: [], scope: { kind: 'namedSkill', value: ld.skill } }
            });
          }
        }
      }

      items.push({
        id,
        name: ip.name,
        rawString: ip.name,
        field: 'innatePowers',
        sourceType: 'innate',
        index: -1,
        rank: 1,
        entity: ent,
        effects
      });
    }
  }

  // 4. Process Lineage Advantages
  if (character.lineage && character.lineageAdvantages) {
    const lin = LINEAGES[character.lineage];
    for (const adv of character.lineageAdvantages) {
      const ent = (lin?.advantages || []).find((x) => x.name === adv || x.baseName === adv);
      const effects = [];
      const id = `advantages:${character.lineage} - ${ent?.baseName || adv}`;
      attachGlobalEffects(id, effects, ent);
      
      if (ent?.statMods) {
        for (const mod of ent.statMods) {
          effects.push({ type: 'STAT', stat: mod.stat, amount: mod.n });
        }
      }
      items.push({
        id,
        name: adv,
        rawString: adv,
        field: 'lineageAdvantages',
        sourceType: 'lineage',
        index: -1,
        rank: 1,
        entity: ent,
        effects
      });
    }
  }

  // 5. Add Synthetic Item for Tax Evasion
  const hasTaxEvasion = items.some(i => i.name === 'Tax Evasion');
  if (hasTaxEvasion) {
    const profRanks = items.filter(i => /^Profession\b/i.test(i.name)).length;
    let bonus = profRanks * 3;
    if (items.some(i => i.name === 'Manse')) bonus += 2;
    if (items.some(i => i.name === 'Income')) bonus += 2;
    if (bonus > 0) {
      items.push({
        id: 'synthetic:Tax Evasion Wealth',
        name: 'Tax Evasion Bonus',
        rawString: 'Tax Evasion Bonus',
        field: 'synthetic',
        sourceType: 'synthetic',
        index: -1,
        rank: 1,
        effects: [{ type: 'WEALTH', amount: bonus, note: 'from Profession/Manse/Income' }]
      });
    }
  }

  return {
    items,
    characterLevel: charLevel,
    classes
  };
}
