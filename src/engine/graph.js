import { lookupEntity, LINEAGES, CLASS_PROGRESSION, REFS, lineageChoiceSpec } from '../engine/data.js';
import { startingSkillGrants } from '../engine/starting-choices.js';
import { cleanItemName, bareSkill, resolveId, entityType, getClasses, idName } from './resolver.js';
import { COMMON_ALLERGENS } from './config.js';
import {
  characterLevel, parseTrailingRank, rankOf,
  BP_FIELDS, BP_POWER_FIELDS, POWER_SOURCE_FIELDS,
  activeInnatePowers, multiclassGrants
} from './validate/core.js';

// Convert the flat character dictionary into a list of typed CharacterItems
export function resolveCharacterGraph(character) {
  const items = [];
  const charLevel = characterLevel(character);
  const classes = getClasses(character);
  // Starting-skill provenance (which specialty block granted it) and the free-rank
  // floor — DERIVED from the class config, keyed by startingSkills index. Attached
  // to starting-skill nodes so consumers (classifyOwnedItems) read it off the graph.
  const ssGrants = startingSkillGrants(character);

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
    
    // Choose-one powers (Expert Craft) grant the selected skill(s)
    if (ent?.chooseOne?.kind === 'build') {
      const chosen = character.choices?.[`powers:${ent.name}`];
      if (chosen) {
        // Find the option by direct text match, or by seeing if one of its granted skills matches the chosen string.
        const opt = ent.chooseOne.options.find((o) => o.text === chosen || o.grants?.includes(chosen));
        if (opt?.grants && opt.grants.length > 0) {
          effects.push({ type: 'GRANT_SOURCE', grants: opt.grants.map(s => `skills:${s}`) });
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
      effects,
      // Starting-skill provenance (specialty block + free-rank floor), null/0 for
      // other fields. Lets classifyOwnedItems read provenance straight off the graph.
      specialty: field === 'startingSkills' ? (ssGrants.specialty[index] || null) : null,
      floor: field === 'startingSkills' ? (ssGrants.floor[index] || 0) : 0,
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
        cls: ip.cls ?? null,
        index: ip.index !== undefined ? ip.index : -1,
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
      // A cantrip-choice advantage (Divine Magic, Psionic Cantrip, …) grants the
      // chosen cantrip. Data-driven via lineageChoiceSpec — no per-name special case.
      if (lineageChoiceSpec(ent)?.kind === 'cantrip') {
        const picked = character.advantageChoices?.[ent?.baseName || ent?.name];
        if (picked) effects.push({ type: 'GRANT_SOURCE', grants: [`powers:${picked}`] });
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

  // 4b. Process Lineage Challenges — they can carry permanent stat effects too
  // (e.g. Lost's Fragile Form: −1 Maximum Life Point). Names may carry a rep
  // parameter ("Lost Life (…)"), so match on the cleaned base name.
  if (character.lineage && character.lineageChallenges) {
    const lin = LINEAGES[character.lineage];
    for (const ch of character.lineageChallenges) {
      const cleanCh = cleanItemName(ch);
      const ent = (lin?.challenges || []).find(
        (x) => x.name === cleanCh || x.baseName === cleanCh || x.name === ch || x.baseName === ch
      );
      if (!ent) continue;
      const effects = [];
      const id = `challenges:${character.lineage} - ${ent.baseName || cleanCh}`;
      attachGlobalEffects(id, effects, ent);
      if (ent.statMods) {
        for (const mod of ent.statMods) {
          effects.push({ type: 'STAT', stat: mod.stat, amount: mod.n });
        }
      }
      items.push({
        id,
        name: ch,
        rawString: ch,
        field: 'lineageChallenges',
        sourceType: 'lineage',
        index: -1,
        rank: 1,
        entity: ent,
        effects,
      });
    }
  }

  // 4.5 Multi-class-granted SKILLS — free skills a 2nd+ class grants. These are
  // genuinely OWNED items (like innates/advantages), so they belong in the graph.
  // (The matching `freeBP` — when a grant duplicates an owned skill — is a budget
  // DERIVATION, not an item, and stays in validate(). computeBP already treats
  // field 'multiclassGrant' as cost-0/derived-granted.)
  const mcGrants = multiclassGrants(character);
  for (const g of mcGrants.skills) {
    const ent = lookupEntity(`skills:${bareSkill(cleanItemName(g.name))}`);
    items.push({
      id: ent?.id || `skills:${cleanItemName(g.name)}`,
      name: g.name,
      rawString: g.name,
      field: 'multiclassGrant',
      sourceType: 'multiclass',
      grantedBy: g.source,
      index: -1,
      rank: 1,
      baseCost: 0,
      entity: ent,
      effects: [],
      specialty: null,
      floor: 0,
    });
  }

  // 4.6 Granted Selections — dynamic picks that belong in the graph so they count as owned items.
  for (const [selId, val] of Object.entries(character.grantedSelections || {})) {
    if (!val || val === "temp") continue;
    // Extract the raw name from the value (which is "PowerName (ClassName)")
    const nameMatch = val.match(/^(.*?)(?:\s+\([^)]+\))?$/);
    const rawName = nameMatch ? nameMatch[1].trim() : val;
    const cleanName = cleanItemName(rawName);
    const bareName = bareSkill(cleanName);
    const ent = lookupEntity(`powers:${cleanName}`) ||
                lookupEntity(`skills:${bareName}`) ||
                lookupEntity(`perks:${cleanName}`);
    const field = ent ? entityType(ent.id) : 'synthetic';
    
    items.push({
      id: ent?.id || `synthetic:${cleanName}`,
      name: rawName,
      rawString: val,
      field,
      sourceType: 'grantedSelection',
      index: -1,
      rank: 1,
      baseCost: 0,
      entity: ent,
      effects: [],
      specialty: null,
      floor: 0,
    });
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

// Map a graph node's source to the `sourceKind` the grant consumers expect.
// (Mirrors the kinds the old ownedGrantSources produced: advantage/perk/feature/
// power, plus 'choice' for build-time choose-one grants.)
function nodeGrantKind(node) {
  if (node.sourceType === 'lineage') return 'advantage';
  if (node.sourceType === 'innate') return 'feature';
  if (node.field === 'purchasedPerks') return 'perk';
  return 'power';
}

// Named abilities the character GAINS FOR FREE from a source they own, DERIVED
// from the character graph (single source of truth) rather than a separate walk.
// Returns { list, bySource }; list is [{ ability, abilityName, abilityType,
// source, sourceId, sourceKind }], bySource groups list by sourceId. Because it
// reads the graph, it sees grant sources the old per-field walk missed (e.g. a
// Right Hand power bought into purchasedSkills, like "Holding Out for a Hero").
export function grantedAbilities(character) {
  const graph = resolveCharacterGraph(character);
  const list = [];
  const bySource = {};

  const addRow = (ability, sourceName, sourceId, sourceKind) => {
    const ent = lookupEntity(ability);
    const row = {
      ability,
      abilityName: ent?.name || idName(ability),
      abilityType: ability.slice(0, ability.indexOf(':')),
      source: sourceName,
      sourceId,
      sourceKind,
    };
    list.push(row);
    (bySource[sourceId] = bySource[sourceId] || { source: sourceName, sourceKind, abilities: [] })
      .abilities.push(row);
  };

  for (const node of graph.items) {
    for (const eff of node.effects) {
      if (eff.type !== 'GRANT_SOURCE') continue;
      // Choose-one build grants are surfaced by the graph as a GRANT_SOURCE on the
      // choosing power itself; tag those 'choice' to match the legacy shape.
      const isChoiceGrant = node.entity?.chooseOne?.kind === 'build';
      const kind = isChoiceGrant ? 'choice' : nodeGrantKind(node);
      const sourceId = isChoiceGrant ? `powers:${node.name}` : node.id;
      for (const ability of eff.grants) addRow(ability, node.name, sourceId, kind);
    }
  }
  return { list, bySource };
}
