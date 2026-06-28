import { EFFECT_EXTRACTORS } from './extractors.js';
import { lookupEntity, allergenAward, ALLERGEN_AWARDS, LEVEL_TABLE, CLASS_PROGRESSION, REFS, CLASS_POWERS, CLASSES, BASE_CLASSES } from '../engine/data.js';
import { cleanItemName, bareSkill, getClasses } from './resolver.js';
import { characterLevel, getMaxRanks } from './validate/core.js';
import { paramInfo, paramReusable } from './param-domain.js';
import { spellSlots } from './validate/slots.js';
import { ARMOR_SKILLS } from './config.js';
import type { CharacterStateV2, CharacterChoice, GraphItem, CharacterGraph, Entity, Effect, EntitySource, BucketedView } from './types.js';

const idName = (id: string) => id.split(':')[1] || id;


export class CharacterGraphModel implements CharacterGraph {
  public readonly uiBuckets: BucketedView;
  public readonly stats: any;
  public readonly prereqs: { issues: any[]; notes: any[] };
  public readonly wealth: { base: number; income: number; total: number; sources: any[] };
  private _ownedIds: Set<string>;
  private _grantedAbilitiesList: any[];

  constructor(
    public character: CharacterStateV2,
    private _items: GraphItem[],
    public characterLevel: number,
    public classes: { name: string; level: number }[]
  ) {
    this.uiBuckets = this.buildBucketedView();
    this.stats = this.computeStats();
    this._grantedAbilitiesList = this.computeGrantedAbilitiesList();
    this._ownedIds = this.computeOwnedIds();
    this.prereqs = this.computePrereqs();
    this.wealth = this.computeWealth();
  }

  get activePowers(): Set<string> {
    const s = new Set<string>();
    const b = this.uiBuckets;
    for (const pool of [b.innatePowers, b.basicPowers, b.advancedPowers, b.veteranPowers, b.utilityPowers, b.classPowers, b.domainPowers]) {
      for (const p of pool) s.add(p.id || p.name);
    }
    return s;
  }

  hasEntity(entityId: string): boolean {
    return this._items.some(i => i.id === entityId || i.entity?.id === entityId);
  }

  *[Symbol.iterator](): IterableIterator<GraphItem> {
    for (const node of this._items) {
      yield node;
    }
  }

  find(predicate: (node: GraphItem) => boolean): GraphItem | undefined {
    return this._items.find(predicate);
  }

  filter(predicate: (node: GraphItem) => boolean): GraphItem[] {
    return this._items.filter(predicate);
  }

  some(predicate: (node: GraphItem) => boolean): boolean {
    return this._items.some(predicate);
  }

  private computeStats() {
    const mods: any = { lifePoints: 0, spikes: 0, naturalArmor: 0, armor: 0 };
    const sources: any[] = [];
    const notes: any[] = [];

    const apply = (name: string, ent: any) => {
      if (!ent) return;
      for (const { stat, n } of (ent.statMods || [])) {
        if (n !== 0) {
          mods[stat] = (mods[stat] || 0) + n;
          sources.push({ name, stat, n });
        }
      }
      for (const note of (ent.statModNotes || [])) {
        notes.push({ name, ...note });
      }
    };

    for (const node of this._items) {
      for (const eff of node.effects) {
        if (eff.type === 'STAT') {
          mods[eff.stat] = (mods[eff.stat] || 0) + eff.amount;
          sources.push({ name: node.name, stat: eff.stat, n: eff.amount });
        }
      }
      if (node.entity?.statModNotes) {
        for (const note of node.entity.statModNotes) {
          notes.push({ name: node.name, ...note });
        }
      }
    }

    for (const { name: cls, level: clsLevel } of this.classes) {
      const prog = CLASS_PROGRESSION[cls] || {};
      for (let lvl = 1; lvl <= clsLevel; lvl++) {
        apply(`${cls} L${lvl}`, prog[lvl]);
      }
    }

    const level = this.characterLevel;
    const minRow = LEVEL_TABLE[0] || { level: 4, lp: 3, spikes: 0 };
    const maxRow = LEVEL_TABLE[LEVEL_TABLE.length - 1] || minRow;
    
    const row = LEVEL_TABLE.find((r: any) => r.level === level)
      || (level < minRow.level ? minRow : maxRow);

    const baseLp = row.lp ?? 0;
    const baseSp = row.spikes ?? 0;

    return {
      baseLifePoints: baseLp, 
      baseSpikes: baseSp,
      lifePoints: baseLp + (mods.lifePoints || 0),
      spikes: baseSp + (mods.spikes || 0),
      armor: mods.armor || 0,
      naturalArmor: mods.naturalArmor || 0,
      mods: { ...mods, sources, notes },
    };
  }

  private buildBucketedView(): BucketedView {
    const view: BucketedView = {
      classes: [], innatePowers: [], basicPowers: [], advancedPowers: [],
      veteranPowers: [], utilityPowers: [], classPowers: [], domainPowers: [],
      skills: [], perks: [], flaws: [], knownSpells: []
    };

    const SOURCE_OF = { starting: 'class', purchased: 'purchased', power: 'purchased', innate: 'class', multiclass: 'class', grantedSelection: 'class' };

    for (const { name: cls, level: clsLevel } of this.classes) {
      view.classes.push({ name: cls, level: clsLevel, type: 'class' });
    }

    for (const node of this._items) {
      if (node.field === 'synthetic' || node.field === 'lineageAdvantages' || node.field === 'lineageChallenges') continue;

      const clean = cleanItemName(node.rawString || node.name);
      const paramM = clean.match(/\(([^)]+)\)\s*$/) || clean.match(/\s-\s([^()]+)$/);
      const paramValue = paramM ? paramM[1].trim() : (node.entity?.parameter || undefined);
      const displayName = paramValue && !node.name.includes(paramValue) ? `${node.name} (${paramValue})` : node.name;

      const source = SOURCE_OF[node.sourceType] || (node.sourceType === 'grant' ? 'class' : 'purchased');
      const isFree = node.sourceType === 'grant' || (node.effects && node.effects.some(e => e.type === 'REFUND_GRANT'));
      
      let grantedBy = node.grantedBy;
      if (isFree && !grantedBy) {
         const refundEff = node.effects?.find(e => e.type === 'REFUND_GRANT');
         if (refundEff) grantedBy = refundEff.source;
      }

      const viewEntry = {
        ...(node.entity || { name: displayName, type: 'unknown' }),
        id: node.id,
        entityId: node.entity?.id || node.id,
        name: displayName,
        source,
        grantedBy,
        free: isFree,
        cost: isFree ? 0 : (node.authoredCost ?? node.baseCost),
        rank: node.rank,
        effects: node.effects,
        rawString: node.rawString,
        field: node.field,
        choiceData: node.choiceData,
        specialty: node.specialty,
        floor: node.floor,
      } as any;

      if (node.field === 'flaws') {
        view.flaws.push(viewEntry);
        continue;
      }

      const t = node.entity?.type;
      const tier = (node.entity as any)?.tier;

      if (node.sourceType === 'innate') {
        view.innatePowers.push(viewEntry);
      } else if (node.sourceType === 'grant' && t === 'spell') {
        view.knownSpells.push(viewEntry);
      } else if (t === 'power') {
        if (tier === 'Basic') view.basicPowers.push(viewEntry);
        else if (tier === 'Advanced') view.advancedPowers.push(viewEntry);
        else if (tier === 'Veteran') view.veteranPowers.push(viewEntry);
        else if (tier === 'Utility') view.utilityPowers.push(viewEntry);
        else if (tier === 'Class' || node.field === 'classPowers') view.classPowers.push(viewEntry);
        else if (node.field === 'domainPowers') view.domainPowers.push(viewEntry);
        else view.classPowers.push(viewEntry);
      } else if (t === 'spell') {
        view.knownSpells.push(viewEntry);
      } else if (t === 'perk') {
        view.perks.push(viewEntry);
      } else {
        view.skills.push(viewEntry);
      }
    }

    return view;
  }

  // ─── Granted abilities list (computed from graph items) ───────────────────
  // Walks every GRANT_SOURCE effect in the graph to build { ability, abilityName,
  // abilityType, source, sourceId, sourceKind } rows. Computed once, reused by
  // _ownedIds and prereqs.
  private computeGrantedAbilitiesList(): any[] {
    const list: any[] = [];
    for (const node of this._items) {
      for (const eff of node.effects) {
        if (eff.type !== 'GRANT_SOURCE') continue;
        for (const ability of eff.grants) {
          const ent = lookupEntity(ability) as any;
          list.push({
            ability,
            abilityName: ent?.name || ability.split(":")[1],
            abilityType: ability.slice(0, ability.indexOf(':')),
            source: node.name,
            sourceId: node.id,
            sourceKind: node.sourceType,
          });
        }
      }
    }
    return list;
  }

  // ─── Owned IDs ────────────────────────────────────────────────────────────
  // All entity ids the character owns, for satisfying skill-prereqs. DERIVED from
  // the character graph (single source of truth — it already walks every owned
  // field) plus granted abilities. For each owned item we add its resolved id and a
  // spread of name-aliases so a prereq stated against any equivalent id
  // (powers:/perks:/skills:, full or bare name) resolves.
  private computeOwnedIds(): Set<string> {
    const owned = new Set<string>();
    for (const node of this._items) {
      if (node.field === 'flaws' || node.field === 'synthetic') continue;
      if (node.id) {
        owned.add(node.id);
        if (node.id.includes('|')) owned.add(node.id.split('|')[0] + '|any');
      }
      const clean = cleanItemName(node.rawString);
      const bare = bareSkill(clean);
      const candidates = [
        `${node.field}:${bare}`,
        `powers:${clean}`, `perks:${clean}`, `skills:${clean}`,
        `powers:${bare}`, `perks:${bare}`, `skills:${bare}`,
      ];
      for (const cand of candidates) {
        const e = lookupEntity(cand);
        if (e) { owned.add(e.id); owned.add(`${e.type}:${bareSkill(e.name)}`); }
      }
      if (node.entity) { owned.add(node.entity.id); owned.add(`${node.entity.type}:${bareSkill(node.entity.name)}`); }
      
      if (node.entity && node.entity.parameter) {
        const p = node.entity.parameter.toLowerCase();
        owned.add(`${node.id}|${p}`);
        owned.add(`${node.id}|any`);
      }
    }
    // Granted abilities also satisfy prerequisites.
    for (const g of this._grantedAbilitiesList) {
      owned.add(g.ability);
      const ent = lookupEntity(g.ability);
      if (ent) owned.add(`${ent.type}:${bareSkill(ent.name)}`);
    }
    return owned;
  }

  // ─── prereqStatusFor ──────────────────────────────────────────────────────
  // Whether a character meets the prereqs for a single entity id — used by the
  // power picker to flag locked candidates. Returns { met, missing, anyOf, notes }
  // where `met` is true only when all hard skill-prereqs (incl. disjunctions) are
  // satisfied. Free-text level/other prereqs can't be auto-verified, so they don't
  // block `met` but are surfaced as notes.
  prereqStatusFor(entityId: string): { met: boolean; missing: any[]; anyOf: any[]; notes: any[] } {
    const ent = lookupEntity(entityId) || lookupEntity(entityId.split(':')[0] + ':' + bareSkill(entityId.split(':')[1]));
    const pr = (REFS as any).prereqs[ent?.id || entityId];
    if (!pr) return { met: true, missing: [], anyOf: [], notes: [] };
    const owned = this._ownedIds;
    const missing = (pr.skills || []).filter((dep: string) => !owned.has(dep));
    const unmetGroups = (pr.anyOf || []).filter((g: string[]) => !g.some((dep: string) => owned.has(dep)));
    const notes = [...(pr.levels || []), ...(pr.other || [])];
    return {
      met: missing.length === 0 && unmetGroups.length === 0,
      missing: missing.map((m: string) => ({ id: m, name: m.split(':')[1] || m })),
      anyOf: unmetGroups.map((g: string[]) => g.map((m: string) => ({ id: m, name: m.split(':')[1] || m }))),
      notes,
    };
  }

  // ─── Prereqs ──────────────────────────────────────────────────────────────
  // Prereq check across every owned item. Skill-prereqs (entity ids) are verified
  // against ownership and become hard `issues` when unmet. Level/other prereqs are
  // free-text. Level constraints are parsed and hard-enforced as issues, while
  // unrecognized/other constraints surface as `notes` (manual verification).
  private computePrereqs(): { issues: any[]; notes: any[] } {
    const owned = this._ownedIds;
    const issues: any[] = [];
    const notes: any[] = [];
    const seen = new Set<string>();
    const charLevel = this.characterLevel;
    const charClasses = this.classes;
    const character = this.character;

    for (const node of this._items) {
      if (node.field === 'flaws' || node.field === 'synthetic') continue;
      const id = node.id;
      if (seen.has(id)) continue;
      seen.add(id);
      const ent = node.entity;
      
      // Tiered perks (Draconic Heritage): each purchased tier requires a minimum
      // CHARACTER level (tier 2 → lvl 5, …).
      if (Array.isArray(ent?.tiers) && ent.tiers.length) {
        const rank = Math.min(node.rank || 1, ent.tiers.length);
        const need = ent.tiers[rank - 1]?.level || 0;
        if (need > charLevel) {
          issues.push({ id, item: node.name, field: node.field, tierLevel: need, tier: rank,
            text: `tier ${rank} requires character level ${need}` });
        }
      }

      if (ent && ent.tier === 'SubPower') {
        issues.push({
          id, item: node.name, field: node.field,
          text: `${ent.name} is a sub-power and cannot be selected directly.`,
        });
      }

      const pr = (REFS as any).prereqs[ent?.id || id];
      if (!pr) continue;

      const missing = (pr.skills || []).filter((dep: string) => !owned.has(dep));
      const unmetGroups = (pr.anyOf || []).filter((group: string[]) => !group.some((dep: string) => owned.has(dep)));
      if (missing.length || unmetGroups.length) {
        const eId = node.entity ? id.replace(/^[^:]+:/, `${node.entity.type}:`) : id;
        issues.push({
          id: eId, item: node.name, field: node.field,
          missing: missing.map((m: string) => ({ id: m, name: idName(m) })),
          anyOf: unmetGroups.map((group: string[]) => group.map((m: string) => ({ id: m, name: idName(m) }))),
        });
      }
      for (const lvl of pr.levels || []) {
        const p = node.entity;
        if (p && p.parentClass && charClasses.every((c) => c.name !== p.parentClass)) {
          issues.push({ id: p.id, item: node.name, field: node.field, 
            text: `Requires a level in ${p.parentClass}` });
        }
        const met = checkLevelConstraint(character, lvl, owned);
        if (met === false) {
          issues.push({
            id, item: node.name, field: node.field,
            text: `Requires ${lvl}`
          });
        } else if (met === null) {
          notes.push({ id, item: node.name, field: node.field, kind: 'level', text: lvl });
        }
      }
      for (const o of pr.other || []) {
        const met = checkLevelConstraint(character, o, owned);
        if (met === false) {
          issues.push({
            id, item: node.name, field: node.field,
            text: `Requires ${o}`
          });
        } else if (met === null) {
          notes.push({ id, item: node.name, field: node.field, kind: 'other', text: o });
        }
      }
    }

    const weaponSpecs: any[] = [];
    for (const node of this._items) {
      if (node.field !== 'flaws' && bareSkill(cleanItemName(node.name)) === 'Weapon Specialization') {
        weaponSpecs.push({ item: node.name, field: node.field });
      }
    }
    for (const g of this._grantedAbilitiesList) {
      if (g.abilityType === 'skills' && bareSkill(cleanItemName(g.abilityName)) === 'Weapon Specialization') {
        weaponSpecs.push({ item: g.abilityName, field: 'granted' });
      }
    }
    // Filter out unparameterized 'Weapon Specialization' if a parameterized one is present
    const hasParameterized = weaponSpecs.some(ws => ws.item.includes('('));
    const filteredWeaponSpecs = hasParameterized
      ? weaponSpecs.filter(ws => ws.item.includes('('))
      : weaponSpecs;

    if (filteredWeaponSpecs.length > 1) {
      const types = filteredWeaponSpecs.map(ws => {
        const m = ws.item.match(/\(([^)]+)\)/);
        return m ? m[1].trim() : 'unspecified';
      });
      issues.push({
        id: 'skills:Weapon Specialization',
        item: 'Weapon Specialization',
        text: `A character may only have Weapon Specialization with one weapon type (found: ${types.join(', ')}).`,
      });
    }

    // ─── Advanced Classes limit ───
    const advancedClasses = charClasses.filter(c => !BASE_CLASSES.has(c.name));
    const baseLevel = charClasses
      .filter(c => BASE_CLASSES.has(c.name))
      .reduce((sum, c) => sum + c.level, 0);

    if (advancedClasses.length > 0 && baseLevel < 10) {
      issues.push({
        id: 'classes', item: 'Advanced Classes', field: 'classes',
        text: `Advanced classes cannot be taken until total level 10 has been reached. (Current base level: ${baseLevel})`,
      });
    }

    if (advancedClasses.length > 2) {
      issues.push({
        id: 'classes', item: 'Advanced Classes', field: 'classes',
        text: `Character has ${advancedClasses.length} Advanced classes but is limited to a maximum of two.`,
      });
    }

    // An advanced class itself cannot exceed 5 levels
    for (const ac of advancedClasses) {
      if (ac.level > 5) {
        issues.push({
          id: 'classes', item: ac.name, field: 'classes',
          text: `Advanced class ${ac.name} cannot exceed a maximum of 5 levels.`,
        });
      }
    }

    // ─── Armor/Shield penalty notes ───
    // Characters need the corresponding skill (or higher) to avoid BP penalties.
    // We collect the heaviest armor/shield they own and check skills.
    const ownedArmor: string[] = [];
    for (const node of this._items) {
      if (node.entity?.type !== 'skills') continue;
      const clean = cleanItemName(node.name);
      if (ARMOR_SKILLS.has(clean) || ARMOR_SKILLS.has(bareSkill(clean))) ownedArmor.push(clean);
    }
    for (const g of this._grantedAbilitiesList) {
      if (g.abilityType === 'skills') {
        const clean = cleanItemName(g.abilityName);
        if (ARMOR_SKILLS.has(clean) || ARMOR_SKILLS.has(bareSkill(clean))) {
          ownedArmor.push(clean);
        }
      }
    }
    const hasDraconicHeritage = [...owned].some(id => id.startsWith('perks:Draconic Heritage'));
    if (hasDraconicHeritage) {
      notes.push({
        id: 'perks:Draconic Heritage',
        item: 'Draconic Heritage',
        field: 'purchasedPerks',
        kind: 'other',
        text: 'Must be taken at Character Creation.',
      });
    }

    // ─── Mutual exclusions (perks/flaws that "cannot be taken along with" each other) ───
    const excludes = (REFS as any).excludes || {};
    if (Object.keys(excludes).length) {
      const ownedExcl = new Set<string>();
      for (const node of this._items) {
        if (node.field === 'purchasedPerks' || node.field === 'flaws' || node.field === 'innatePerks') {
          if (node.id) ownedExcl.add(node.id);
        }
      }
      for (const g of this._grantedAbilitiesList) {
        if (/^(perks|flaws):/.test(g.ability)) ownedExcl.add(g.ability);
      }
      const reportedPairs = new Set<string>();
      for (const id of ownedExcl) {
        for (const other of excludes[id] || []) {
          if (!ownedExcl.has(other)) continue;
          const pairKey = [id, other].sort().join('|');
          if (reportedPairs.has(pairKey)) continue;
          reportedPairs.add(pairKey);
          issues.push({
            id, item: idName(id), field: id.split(':')[0],
            excludes: other,
            text: `cannot be taken along with ${idName(other)}`,
          });
        }
      }
    }

    // ─── Power requirements (parser-extracted: requiredLevel + requiresEntity) ───
    const charClassLevels = new Map(charClasses.map((c) => [c.name, c.level]));
    const powerInContext = (name: string) => {
      for (const { name: cls } of charClasses) {
        const tiers = (CLASS_POWERS as any)[cls];
        if (!tiers) continue;
        for (const list of Object.values(tiers)) {
          if (!Array.isArray(list)) continue;
          const hit = list.find((p: any) => p.name === name);
          if (hit) return { ...hit, __contextClass: cls };
        }
      }
      return lookupEntity(`powers:${name}`);
    };

    for (const node of this._items) {
      if (node.entity?.type !== 'powers') continue;
      const name = cleanItemName(node.name);
      const field = node.field;
      const ent = powerInContext(name) as any;
      if (!ent) continue;

      if (ent.requiredLevel > 0) {
        const reqClass = ent.requiredClass || ent.__contextClass;
        const have = reqClass ? (charClassLevels.get(reqClass) || 0) : charLevel;
        if (have < ent.requiredLevel) {
          issues.push({ id: `powers:${name}`, item: name, field,
            text: `Requires ${reqClass ? `${reqClass} ` : ''}Level ${ent.requiredLevel}` });
        }
      }

      for (const reqName of (ent.requiresEntity || [])) {
        const ok = owned.has(`powers:${reqName}`) || owned.has(`skills:${reqName}`)
          || owned.has(`perks:${reqName}`) || owned.has(`powers:${bareSkill(reqName)}`);
        if (!ok) {
          issues.push({ id: `powers:${name}`, item: name, field,
            requiresEntity: reqName, text: `Requires ${reqName}` });
        }
      }
    }

    const powerCounts = new Map<string, number>();
    for (const node of this._items) {
      if (node.entity?.type !== 'powers' || node.sourceType !== 'purchased') continue;
      const name = cleanItemName(node.name);
      if (!name) continue;
      powerCounts.set(name, (powerCounts.get(name) || 0) + 1);
    }
    for (const [name, count] of powerCounts) {
      if (count > 1) {
        issues.push({
          id: `powers:${name}`, item: name, field: 'powers',
          duplicate: count,
          text: `selected ${count} times — a power may only be taken once`,
        });
      }
    }

    // ─── Elemental Affinity cap ───
    const elemAffinities: string[] = [];
    for (const node of this._items) {
      if (bareSkill(cleanItemName(node.name)) === 'Elemental Affinity') {
        elemAffinities.push(node.rawString);
      }
    }
    if (elemAffinities.length) {
      if (elemAffinities.length > 2) {
        issues.push({
          id: 'perks:Elemental Affinity', item: 'Elemental Affinity', field: 'purchasedPerks',
          text: `taken ${elemAffinities.length} times — may be taken at most twice`,
        });
      }
      const elements = elemAffinities
        .map((p) => (p.match(/\(([^)]+)\)/) || [])[1]?.trim())
        .filter(Boolean);
      const dupElement = elements.find((e, i) => elements.findIndex((x) => x.toLowerCase() === e!.toLowerCase()) !== i);
      if (dupElement) {
        issues.push({
          id: 'perks:Elemental Affinity', item: 'Elemental Affinity', field: 'purchasedPerks',
          text: `cannot attune to ${dupElement} twice — each Elemental Affinity must be a different element`,
        });
      }
    }

    const bloodlines: string[] = [];
    for (const node of this._items) {
      if (node.entity?.category === 'Bloodline') bloodlines.push(node.rawString);
    }
    if (bloodlines.length > 1) {
      issues.push({
        id: 'perks', item: 'Bloodline Perks', field: 'purchasedPerks',
        text: `has ${bloodlines.length} Bloodline Perks (${bloodlines.join(', ')}) — character may only have one`,
      });
    }

    // ─── Lineage-specific constraints ───
    const sublineages = (character as any).sublineages || {};
    
    if (sublineages["Hot Blooded"] && (character.flaws || []).includes("Pliant")) {
      issues.push({
        id: 'flaws:Pliant', item: 'Pliant', field: 'flaws',
        text: `cannot be taken along with the Hot Blooded lineage challenge`,
      });
    }

    if (sublineages["Anti-magic"]) {
      const spellcastingLevels = ((character as any).classes || []).filter((c: any) => (CLASSES as any)[c.name]?.spellcaster && c.level > 0);
      if (spellcastingLevels.length > 0) {
        issues.push({
          id: 'classes:' + spellcastingLevels[0].name, item: spellcastingLevels[0].name, field: 'classes',
          text: `cannot take class levels in spellcasting classes due to Anti-magic lineage challenge`,
        });
      }
      if (((character as any).startingSkills || []).includes("Ritual Magic") || ((character as any).purchasedSkills || []).includes("Ritual Magic")) {
        issues.push({
          id: 'skills:Ritual Magic', item: 'Ritual Magic', field: 'skills',
          text: `cannot purchase Ritual Magic due to Anti-magic lineage challenge`,
        });
      }
    }

    if (sublineages["The Fractured"]) {
      const stats = (character as any).stats || {};
      if (stats.maxLifePoints < 1) {
        issues.push({
          id: 'lineage:The Fractured', item: 'The Fractured', field: 'lineage',
          text: `cannot be taken if the character already has 1 maximum Life Point (would reduce below 1)`,
        });
      }
    }

    if (sublineages["Divinity's Scourge"] && (character.flaws || []).includes("Divine Vulnerability")) {
      issues.push({
        id: 'flaws:Divine Vulnerability', item: 'Divine Vulnerability', field: 'flaws',
        text: `cannot be taken along with the Divinity's Scourge lineage challenge`,
      });
    }

    return { issues, notes };
  }

  // ─── Wealth ───────────────────────────────────────────────────────────────
  // Walk the graph for WEALTH effects and combine with the character's base wealth.
  private computeWealth(): { base: number; income: number; total: number; sources: any[] } {
    const DEFAULT_WEALTH = 8;
    const characterWealth = this.character.wealth;
    const base = characterWealth != null && characterWealth !== ''
      ? (parseInt(String(characterWealth), 10) || DEFAULT_WEALTH)
      : DEFAULT_WEALTH;

    const sources: any[] = [];
    let income = 0;

    const add = (name: string, n: number, note: string) => {
      if (n > 0) {
        income += n;
        sources.push({ name, n, note });
      }
    };

    // The graph already extracted all WEALTH effects (including the synthetic Tax Evasion)
    for (const node of this._items) {
      for (const eff of node.effects) {
        if (eff.type === 'WEALTH') {
          add(node.name, eff.amount, eff.note);
        }
      }
    }

    return { base, income, total: base + income, sources };
  }
}

// Parse and check free-text level/class/armor/spell-slot/profession constraints.
// Returns:
//   true  if the constraint is parsed and met.
//   false if the constraint is parsed and failed.
//   null  if the constraint format is unrecognized.
function checkLevelConstraint(character: any, constraintStr: string, owned: Set<string>): boolean | null {
  const charLevel = characterLevel(character);
  const charClasses = getClasses(character);

  // 1. "N levels in Martial Classes" or "N levels in a Martial Classes" or "N class-levels in martial classes"
  let m = constraintStr.match(/^(\d+)\s+(?:levels?|class-levels)\s+in\s+(?:a\s+)?Martial\s+Classes/i);
  if (m) {
    const required = parseInt(m[1], 10);
    const martial = charClasses.filter((c) => (CLASSES as any)[c.name]?.tags?.includes('Martial'))
      .reduce((sum, c) => sum + c.level, 0);
    return martial >= required;
  }
  // 2. "Level N [Class]" (e.g., "Level 2 Spellcaster", "Level 3 Mage")
  m = constraintStr.match(/^Level\s+(\d+)\s+([A-Za-z\s]+)$/i);
  if (m) {
    const requiredLevel = parseInt(m[1], 10);
    const classStr = m[2].trim().toLowerCase();
    
    // Spellcaster meta-class
    if (classStr === 'spellcaster' || classStr === 'spellcaster class') {
      const highestSpellcasterLevel = charClasses
        .filter((c) => (CLASSES as any)[c.name]?.spellcaster)
        .reduce((max, c) => Math.max(max, c.level), 0);
      return highestSpellcasterLevel >= requiredLevel;
    }
    
    // Specific class
    const matchClass = charClasses.find((c) => c.name.toLowerCase() === classStr);
    return matchClass ? matchClass.level >= requiredLevel : false;
  }
  // 3. "Level N" (general character level)
  m = constraintStr.match(/^Level\s+(\d+)$/i);
  if (m) {
    return charLevel >= parseInt(m[1], 10);
  }
  // 4. "Light Armor", "Medium Armor", "Heavy Armor" (must be owned)
  if (/^Light Armor|Medium Armor|Heavy Armor$/i.test(constraintStr)) {
    return owned.has(`skills:${constraintStr}`);
  }
  // 5. "N Apprentice spell-slot(s)"
  m = constraintStr.match(/^(\d+)\s+(Apprentice|Journeyman|Greater|Master)\s+spell-slots?/i);
  if (m) {
    const count = parseInt(m[1], 10);
    const tier = m[2];
    const slots = spellSlots(character);
    const have = Object.values(slots).reduce((s: number, c: any) => s + (c[tier] || 0), 0);
    return have >= count;
  }
  // 6. "N Ranks of Profession"
  m = constraintStr.match(/^(\d+)\s+Ranks\s+of\s+Profession/i);
  if (m) {
    const count = parseInt(m[1], 10);
    const profs = [...owned].filter(id => /^skills:Profession/i.test(id));
    return profs.length >= count;
  }

  return null;
}


export function resolveCharacterGraph(charInput: any): CharacterGraphModel {
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

  
  // Generate Synthesized Granted Items & Deduplicate
  const getIdentity = (rawName: string, ent: any) => {
    const clean = cleanItemName(rawName);
    const entityId = ent?.id || rawName;
    const cap = getMaxRanks(entityId);
    const info = paramInfo(ent);
    const reusable = paramReusable(ent, entityId);
    const baseName = (ent?.baseName || ent?.name || bareSkill(clean)).toLowerCase();

    if (!info || reusable) return { key: baseName, cap };

    const paramM = clean.match(/\(([^)]+)\)\s*$/) || clean.match(/\s-\s([^()]+)$/);
    const paramValue = paramM ? paramM[1].trim().toLowerCase() : (ent?.parameter ? ent.parameter.toLowerCase() : 'unknown');
    return { key: `${baseName}|${paramValue}`, cap: 1 };
  };

  const itemIdentities = new Map<string, { cap: number, nodes: any[] }>();
  for (const it of items) {
    if (it.sourceType === 'lineage') continue;
    const { key, cap } = getIdentity(it.rawString || it.name, it.entity);
    if (!itemIdentities.has(key)) itemIdentities.set(key, { cap, nodes: [] });
    itemIdentities.get(key)!.nodes.push(it);
  }

  for (const node of [...items]) {
    for (const eff of node.effects) {
      if (eff.type !== 'GRANT_SOURCE') continue;
      for (const gid of eff.grants) {
        let ent = lookupEntity(gid) as any;
        const gType = gid.slice(0, gid.indexOf(':'));
        const rawGidName = gid.slice(gid.indexOf(':') + 1);
        if (!ent) {
          const clean = cleanItemName(rawGidName);
          ent = lookupEntity(`skills:${clean}`) || lookupEntity(`powers:${clean}`) || lookupEntity(`perks:${clean}`);
        }
        
        const gName = ent?.name || rawGidName;
        const { key, cap } = getIdentity(gName, ent);
        
        let group = itemIdentities.get(key);
        if (!group) {
          group = { cap, nodes: [] };
          itemIdentities.set(key, group);
        }

        // Check if we are at cap with grants + purchases
        let grantCount = group.nodes.filter(n => n.sourceType === 'grant').length;
        let purchaseCount = group.nodes.filter(n => n.sourceType === 'purchased').length;

        if (grantCount + purchaseCount >= cap) {
          // We are at cap. Grant wins, so refund a purchase if one exists
          const purchasedNode = group.nodes.find(n => n.sourceType === 'purchased' && !n.effects?.some(e => e.type === 'REFUND_GRANT'));
          if (purchasedNode) {
             purchasedNode.effects = purchasedNode.effects || [];
             purchasedNode.effects.push({ type: 'REFUND_GRANT', source: node.name });
          }
          // Do not push the grant if we hit cap and already refunded all purchases?
          // Actually, if we hit cap, and there are no purchases to refund, we just drop the grant.
          continue;
        }

        const newGrant = {
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
        };
        items.push(newGrant);
        group.nodes.push(newGrant);
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

  return new CharacterGraphModel(character, items, charLevel, classes);
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

  for (const node of graph) {
    for (const eff of node.effects) {
      if (eff.type !== 'GRANT_SOURCE') continue;
      for (const ability of eff.grants) {
         addRow(ability, node.name, node.id, node.sourceType);
      }
    }
  }
  return { list, bySource };
}
