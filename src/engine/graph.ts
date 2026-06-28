import { EFFECT_EXTRACTORS } from './extractors.js';
import { lookupEntity, allergenAward, ALLERGEN_AWARDS } from '../engine/data.js';
import { cleanItemName, bareSkill, getClasses } from './resolver.js';
import { characterLevel } from './validate/core.js';
import type { CharacterStateV2, CharacterChoice, GraphItem, CharacterGraph, Entity, Effect, EntitySource } from './types.js';

export function resolveCharacterGraph(charInput: any): CharacterGraph {
  // If the input is V1 state, convert it to V2 state internally
  let character: CharacterStateV2 = charInput;
  if (!charInput.skills && !charInput.perks && !charInput.powers) {
    character = { ...charInput, skills: [], perks: [], flaws: [], powers: [], spells: [], devotions: [], innatePowers: [...(charInput.innatePowers || [])] };
    const add = (field: string, arr: keyof CharacterStateV2, sourceName: EntitySource) => {
      // For V1, the inputs are in charInput (e.g. purchasedSkills).
      // For innatePowers, we synthesize them into character.innatePowers during the class loop,
      // so we should read from character for that specific field.
      const sourceList = field === 'innatePowers' ? (character as any).innatePowers : charInput[field];
      for (let i = 0; i < (sourceList || []).length; i++) {
         const item = sourceList[i];
         const id = field === 'startingSkills' ? `startingSkills:${i}:${item}` : `${field}:${item}`;
         const choice: CharacterChoice = {
           id,
           entityId: item,
           source: sourceName,
           costOverride: charInput.effectiveBP?.[field]?.[i] ?? undefined,
           ranks: charInput.ranks?.[field]?.[i] ?? 1,
           originalIndex: i, // We attach originalIndex dynamically for tests/validation bridging
         } as any;
         (character[arr] as CharacterChoice[]).push(choice);
      }
    };
    add('startingSkills', 'skills', 'Class:Starting');
    add('purchasedSkills', 'skills', 'Purchased');
    add('purchasedPerks', 'perks', 'Purchased');
    add('flaws', 'flaws', 'Flaw');
    const powerFields = ['classPowers', 'classSkills', 'rightHandPowers', 'utilityPowers', 'basicPowers', 'advancedPowers', 'veteranPowers', 'domainPowers'];
    for (const pf of powerFields) add(pf, 'powers', 'Purchased');
    const charClasses = getClasses(charInput);
    for (const c of charClasses) {
      const clsDef = lookupEntity(`classes:${c.name}`) as any;
      if (clsDef && clsDef.innate) {
        for (const p of clsDef.innate) {
          if (c.level >= (p.requiredLevel || 1)) {
            // FIX: Initialize innatePowers on character if it doesn't exist
            if (!(character as any).innatePowers) {
              (character as any).innatePowers = [];
            }
            if (!(character as any).innatePowers.includes(p.name)) {
              (character as any).innatePowers.push(p.name);
            }
          }
        }
      }
    }
    
    add('innatePowers', 'powers', 'Innate');
    const spellFields = ['cantrips', 'bookSpells', 'spellsKnown', 'noviceSpells', 'adeptSpells', 'greaterSpells'];
    for (const sf of spellFields) add(sf, 'spells', 'Purchased');
    if (charInput.devotion) {
       (character.devotions as CharacterChoice[]).push({ id: `devotions:${charInput.devotion}`, entityId: `devotions:${charInput.devotion}`, source: 'Purchased' });
    }
  }

  const items: GraphItem[] = [];
  const charLevel = characterLevel(character);
  const classes = getClasses(character);

  const addItem = (choice: any) => {
    let ent = lookupEntity(choice.entityId) as any;
    // Remove the collection prefix (e.g. "skills:") for the display name
    const rawName = choice.entityId.replace(/^[a-z]+:/i, '');
    const cleanName = cleanItemName(rawName);
    const bareName = bareSkill(cleanName);
    
    // Fallback if entityId wasn't fully qualified
    if (!ent) {
      ent = lookupEntity(`skills:${bareName}`) || lookupEntity(`perks:${cleanName}`) || lookupEntity(`powers:${cleanName}`);
    }

    const rank = choice.ranks || 1;
    const effects: Effect[] = [];

    // Extract Base Cost
    let baseCost = 0;
    if (Array.isArray(ent?.tiers) && ent.tiers.length) {
      const n = Math.min(rank, ent.tiers.length);
      baseCost = ent.tiers.slice(0, n).reduce((s: number, t: any) => s + (t.cost || 0), 0);
    } else {
      baseCost = (typeof ent?.cost === 'number' ? ent.cost : (ent?.lbp || 0)) * rank;
    }

    const entityId = ent?.id || choice.entityId;
    for (const extractor of EFFECT_EXTRACTORS) {
      effects.push(...extractor(ent, character, entityId));
    }

    // Bridge legacy fields for validation
    const sourceParts = (choice.source || 'Purchased').split(':');
    const sourceType = sourceParts[0].toLowerCase();
    
    // Determine the field based on the entity prefix or fallback
    let field = choice.entityId.split(':')[0];
    if (['skills', 'perks', 'powers', 'flaws'].indexOf(field) === -1) {
      if (ent?.id) field = ent.id.split(':')[0];
      else field = 'unknown';
    }

    items.push({
      id: choice.id || entityId, 
      entityId: entityId,
      name: ent?.name || cleanName,
      rawString: choice.entityId,
      field,
      sourceType,
      rank: choice.ranks || 1,
      index: choice.originalIndex,
      baseCost: baseCost,
      authoredCost: choice.costOverride,
      grantSidecar: null,
      entity: ent,
      effects,
      specialty: null,
      floor: 0,
      choiceData: choice
    });
  };

  for (const choice of character.skills || []) addItem(choice);
  for (const choice of character.perks || []) addItem(choice);
  for (const choice of character.powers || []) addItem(choice);
  for (const choice of character.spells || []) addItem(choice);
  for (const choice of character.devotions || []) addItem(choice);

  for (const field of ['lineageAdvantages', 'lineageChallenges']) {
    for (const name of (character as any)[field] || []) {
      const type = field === 'lineageAdvantages' ? 'advantages' : 'challenges';
      let entityId = `${type}:${name}`;
      if (name === 'Pick and Choose' && character.advantageChoices?.['Pick and Choose']) {
        entityId = `advantages:${character.advantageChoices['Pick and Choose']}`;
      }
      const choice = { entityId, ranks: 1, source: 'Lineage:Lineage' };
      addItem(choice);
    }
  }

  // Process Flaws
  for (const choice of character.flaws || []) {
    const rawName = (choice as any).entityId.replace(/^flaws:/i, '');
    const cleanName = cleanItemName(rawName);
    const ent = lookupEntity(`flaws:${cleanName}`) as any;
    let bp = 0;
    if (ent) {
      const allergenTable = ALLERGEN_AWARDS[ent.baseName];
      if (allergenTable) {
        const chosen = allergenAward(ent.baseName, ent.parameter);
        bp = chosen != null ? chosen : Math.min(...Object.values(allergenTable));
      } else {
        bp = typeof ent.bp === 'number' ? ent.bp : parseInt(String(ent.bp), 10) || 0;
      }
    }
    console.log('FLAW DEBUG:', { cleanName, rawName, entBp: ent?.bp, bp });
    items.push({
      id: ent?.id || `flaws:${cleanName}`,
      name: ent?.name || cleanName,
      rawString: (choice as any).entityId,
      field: 'flaws',
      sourceType: 'flaw',
      rank: 1,
      baseCost: -bp,
      entity: ent,
      effects: [{ type: 'FLAW_AWARD', amount: bp }],
      choiceData: choice as any
    });
  }

  // Generate Synthesized Granted Items
  const bareKey = (name: string, ent: any) => {
    const clean = cleanItemName(name);
    const e = ent || lookupEntity(`skills:${clean}`) || lookupEntity(`powers:${clean}`);
    const base = (e?.baseName || e?.name || bareSkill(clean)).toLowerCase();
    const paramM = clean.match(/\(([^)]+)\)\s*$/) || clean.match(/\s-\s([^()]+)$/);
    return paramM ? `${base}|${paramM[1].trim().toLowerCase()}` : base;
  };
  const ownedKeys = new Set(items
    .filter((it) => it.sourceType !== 'lineage')
    .map((it) => bareKey(it.rawString || it.name, it.entity)));
  const grantedKeys = new Set();
  
  for (const node of [...items]) {
    for (const eff of node.effects) {
      if (eff.type !== 'GRANT_SOURCE') continue;
      for (const gid of eff.grants) {
        const ent = lookupEntity(gid) as any;
        const gType = gid.slice(0, gid.indexOf(':'));
        const rawGidName = gid.slice(gid.indexOf(':') + 1);
        const gName = ent?.name || rawGidName;
        const key = bareKey(rawGidName, ent);
        
        if (ownedKeys.has(key)) {
          const ownedNode = items.find(it => it.sourceType !== 'lineage' && bareKey(it.rawString || it.name, it.entity) === key);
          if (ownedNode && ownedNode.sourceType === 'purchased') {
             ownedNode.effects.push({ type: 'REFUND_GRANT', source: node.name });
          }
          continue;
        }
        if (grantedKeys.has(key)) continue;
        grantedKeys.add(key);
        
        items.push({
          id: ent?.id || gid,
          name: gName,
          rawString: gName,
          field: `${gType}Grant`,
          sourceType: 'grant',
          grantedBy: node.name,
          grantKind: node.sourceType,
          rank: 1,
          baseCost: 0,
          entity: ent,
          effects: [],
          specialty: null,
          floor: 0,
          index: -1,
        });
      }
    }
  }

  // Tax Evasion
  const hasTaxEvasion = items.some(i => i.name === 'Tax Evasion');
  if (hasTaxEvasion) {
    const profRanks = items.filter(i => /^\bProfession\b/i.test(i.name)).length;
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
        rank: 1,
        baseCost: 0,
        effects: [{ type: 'WEALTH', amount: bonus, note: 'from Profession/Manse/Income' }]
      });
    }
  }

  return { character, items, characterLevel: charLevel, classes };
}

export function grantedAbilities(character: any) {
  const graph = resolveCharacterGraph(character);
  const list: any[] = [];
  const bySource: Record<string, any> = {};

  const addRow = (ability: string, sourceName: string, sourceId: string, sourceKind: string) => {
    const ent = lookupEntity(ability) as any;
    const row = {
      ability,
      abilityName: ent?.name || ability.split(":")[1],
      abilityType: ability.slice(0, ability.indexOf(':')),
      source: sourceName,
      sourceId,
      sourceKind,
    };
    list.push(row);
    if (!bySource[sourceId]) bySource[sourceId] = { source: sourceName, sourceKind, abilities: [] };
    bySource[sourceId].abilities.push(row);
  };

  for (const node of graph.items) {
    for (const eff of node.effects) {
      if (eff.type !== 'GRANT_SOURCE') continue;
      for (const ability of eff.grants) {
         addRow(ability, node.name, node.id, node.sourceType);
      }
    }
  }
  return { list, bySource };
}
