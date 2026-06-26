import { startingSkillGrants } from "../starting-choices.js";
import { cleanItemName, bareSkill } from '../resolver.js';
import { MAX_FLAW_BP } from './core.js';
import { costKey } from './cost-key.js';
import { REFS } from '../data.js';

// Determine if a discount source applies to a specific graph item
function discountApplies(src, itemNode, pos) {
  const ent = itemNode.entity;
  const itemName = itemNode.name;
  
  if (src.exclusions?.includes(ent?.id) || src.exclusions?.includes(`perks:${cleanItemName(itemName)}`)) return false;
  
  const cat = ent?.category;
  if (src.scope.kind === 'category') {
    return Array.isArray(src.scope.value) && src.scope.value.some(c => c.toLowerCase() === String(cat).toLowerCase());
  }
  if (src.scope.kind === 'firstN') {
    return new RegExp(`^${src.scope.value}\\b`, 'i').test(cleanItemName(itemName)) && (src.scope.n == null || pos < src.scope.n);
  }
  if (src.scope.kind === 'skillRanks') {
    return new RegExp(`^${src.scope.value}\\b`, 'i').test(cleanItemName(itemName));
  }
  if (src.scope.kind === 'namedSkill') {
    return bareSkill(cleanItemName(itemName)) === src.scope.value;
  }
  if (src.scope.kind === 'prereq') {
    const pr = REFS.prereqs?.[ent?.id];
    const target = `perks:${src.scope.value}`;
    return !!pr && (pr.skills?.includes(target) || pr.other?.some(o => new RegExp(src.scope.value, 'i').test(o)));
  }
  if (src.scope.kind === 'giftEligible') {
    if (!ent || ent.id?.startsWith('skills:')) return false;
    if (ent.id === `perks:${src.scope.value}`) return false;
    const prereqText = String(ent.prereq || ent.prerequisites || '');
    if (new RegExp(`\\b${src.scope.value}\\b`, 'i').test(prereqText)) return false;
    return true;
  }
  return false;
}

export function computeBP(graph, character) {
  const startFloors = startingSkillGrants(character).floor;
  
  // Build index of things granted by the character's owned items. A grant matches
  // an owned node so that node renders free + attributed. Two keys are needed:
  //   - exact id (`skills:Two Weapon Style`), and
  //   - a PARAMETERIZED key (`skills:Weapon Specialization|daggers`), because a
  //     parameterized grant ("Weapon Specialization - Daggers", dash form) must
  //     match a parameterized PURCHASE ("Weapon Specialization (Daggers)", parens
  //     form) of the same weapon — but NOT a different weapon. The node's bare
  //     `id` drops the parameter (both forms resolve to the base skill entity), so
  //     bare-id matching alone would refund the wrong purchase (or none).
  const paramKey = (typedName) => {
    const c = typeof typedName === 'string' && typedName.includes(':')
      ? typedName : `:${typedName}`;
    const [type, rest = ''] = [c.slice(0, c.indexOf(':')), c.slice(c.indexOf(':') + 1)];
    // Normalize both "Base - Param" and "Base (Param)" to base + lowercased param.
    const paren = rest.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const dash = rest.match(/^(.*?)\s+-\s+(.*)$/);
    const m = paren || dash;
    if (!m) return null; // no parameter → nothing to disambiguate
    return `${type}:${m[1].trim()}|${m[2].trim().toLowerCase()}`;
  };
  const grantIndex = {};
  const grantParamIndex = {};
  for (const node of graph.items) {
    for (const eff of node.effects) {
      if (eff.type === 'GRANT_SOURCE') {
        eff.grants.forEach(g => {
          if (!grantIndex[g]) grantIndex[g] = node.name;
          const pk = paramKey(g);
          if (pk && !grantParamIndex[pk]) grantParamIndex[pk] = node.name;
        });
      }
    }
  }

  let rawAwarded = 0;
  let refunded = 0;
  const byItem = {};
  
  // Phase 1: Base Costs and Grants
  let startingExcess = 0;
  
  for (let idx = 0; idx < graph.items.length; idx++) {
    const node = graph.items[idx];
    
    // Ledger key (shared scheme — see cost-key.js).
    const key = costKey(node.field, node.rawString, node.index);

    if (node.field === 'flaws') {
      byItem[key] = { cost: node.baseCost, base: node.baseCost, grant: null };
      rawAwarded += (-node.baseCost);
      continue;
    }

    let isGranted = false;
    let grantSrc = null;
    let isDerived = false;
    // The node's parameterized key: its base id (type:base) + the param from its
    // raw string, so a granted "Weapon Specialization - Daggers" matches a bought
    // "Weapon Specialization (Daggers)" but not "(Swords)".
    const nodeParamKey = node.id && /\(|\s-\s/.test(node.rawString || '')
      ? paramKey(`${node.id.slice(0, node.id.indexOf(':') + 1)}${node.rawString}`)
      : null;
    if (node.grantSidecar?.kind === 'grant') {
      isGranted = true; grantSrc = node.grantSidecar.source;
    } else if (grantIndex[node.id]) {
      isGranted = true; grantSrc = grantIndex[node.id]; isDerived = true;
    } else if (nodeParamKey && grantParamIndex[nodeParamKey]) {
      isGranted = true; grantSrc = grantParamIndex[nodeParamKey]; isDerived = true;
    } else if (node.sourceType === 'innate' || node.field === 'multiclassGrant') {
      isGranted = true; grantSrc = 'class'; isDerived = true;
    }

    if (typeof node.authoredCost === 'number') {
      if (isDerived && node.authoredCost > 0) {
        // Derived grants force cost to 0 unless authored cost was 0 anyway (legacy quirk)
        byItem[key] = { cost: 0, base: node.baseCost, grant: { kind: 'grant', source: grantSrc, derived: true }, rank: node.rank };
      } else {
        byItem[key] = { cost: node.authoredCost, base: node.baseCost, grant: node.grantSidecar, rank: node.rank, authored: true };
      }
      continue;
    }

    if (node.field === 'startingSkills') {
      const grant = node.grantSidecar;
      if (grant?.kind === 'discount' && grant.amount) {
         byItem[key] = { cost: -grant.amount, base: 0, grant };
         refunded += grant.amount;
         continue;
      }
      
      
      const floor = startFloors[node.index];
      
      if (floor && node.rank > floor) {
        const extra = node.rank - floor;
        const entCost = (node.baseCost / node.rank) || 0;
        const extraCost = entCost * extra;
        byItem[key] = { cost: extraCost, base: entCost, grant: null, rank: node.rank, freeRanks: floor, paidRanks: extra };
        startingExcess += extraCost;
      } else {
        byItem[key] = { cost: 0, base: (node.baseCost / node.rank)||0, grant: null, rank: node.rank, freeRanks: floor || 1, paidRanks: 0 };
      }
      continue;
    }
    
    if (isGranted) {
      byItem[key] = { cost: 0, base: node.baseCost, grant: { kind: 'grant', source: grantSrc, derived: true }, rank: node.rank };
    } else {
      byItem[key] = { cost: node.baseCost, base: node.baseCost, grant: node.grantSidecar, rank: node.rank };
    }
  }

  // Phase 2: Apply Discounts
  const discountSources = [];
  graph.items.forEach(node => {
    node.effects.forEach(eff => {
      if (eff.type === 'DISCOUNT_SOURCE') {
        discountSources.push({ ...eff.discount, id: node.id, name: node.name });
      }
    });
  });

  const used = new Map();
  const catCount = new Map();
  let discountFreeBP = 0;
  const discountsApplied = [];

  for (const node of graph.items) {
    if (node.field !== 'purchasedSkills' && node.field !== 'purchasedPerks' && node.field !== 'startingSkills') continue;
    
    const key = costKey(node.field, node.rawString, node.index);
    const eff = byItem[key];
    if (!eff || eff.authored) continue;

    const catKey = node.entity?.category || cleanItemName(node.rawString).split(' ')[0];
    const pos = catCount.get(catKey) || 0;
    catCount.set(catKey, pos + 1);

    for (const src of discountSources) {
      if (!discountApplies(src, node, pos)) continue;
      const min = src.min ?? 0;
      const room = src.cap == null ? Infinity : src.cap - (used.get(src.id) || 0);
      if (room <= 0) continue;
      
      const reducible = Math.max(0, eff.cost - min);
      const cut = Math.min(src.amount, reducible, room);
      
      if (cut <= 0) {
        if (eff.cost === 0 && eff.grant?.kind === 'grant' && src.refundIfFree) {
          const refund = Math.min(src.amount, room);
          discountFreeBP += refund;
          used.set(src.id, (used.get(src.id) || 0) + refund);
          discountsApplied.push({ key, source: src.name, amount: refund, asFreeBP: true });
        }
        continue;
      }
      
      eff.cost -= cut;
      eff.discount = { source: src.name, amount: cut };
      used.set(src.id, (used.get(src.id) || 0) + cut);
      discountsApplied.push({ key, source: src.name, amount: cut });
      break;
    }
  }

  // Phase 3: Total Summation
  let spent = startingExcess;
  const costFields = ['purchasedSkills', 'purchasedPerks', 'domainPowers', 'classPowers', 'formPowers'];
  
  for (const node of graph.items) {
    if (costFields.includes(node.field)) {
      const eff = byItem[costKey(node.field, node.rawString, node.index)];
      if (eff && eff.cost > 0) {
        spent += eff.cost;
      }
    }
  }

  const awarded = Math.min(rawAwarded, MAX_FLAW_BP);

  return {
    spent,
    awarded,
    rawAwarded,
    flawCapped: rawAwarded > MAX_FLAW_BP,
    refunded,
    discountFreeBP,
    discountsApplied,
    net: spent - refunded - discountFreeBP,
    byItem
  };
}
