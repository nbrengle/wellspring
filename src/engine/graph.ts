import { EFFECT_EXTRACTORS } from "./extractors.js";
import {
  lookupEntity,
  allergenAward,
  ALLERGEN_AWARDS,
  LEVEL_TABLE,
  CLASS_PROGRESSION,
  REFS,
  CLASS_POWERS,
  CLASSES,
  BASE_CLASSES,
  collectionOf,
} from "../engine/data.js";
import { startingSkillGrants } from "./starting-choices.js";
import { MAX_FLAW_BP } from "./validate/core.js";
import { costKey } from "./validate/cost-key.js";
import { cleanItemName, bareSkill, getClasses } from "./resolver.js";
import { characterLevel, getMaxRanks } from "./validate/core.js";
import { paramInfo, paramReusable } from "./param-domain.js";
import { spellSlots } from "./validate/slots.js";
import type {
  CharacterState,
  GraphItem,
  CharacterGraph,
  Effect,
  EntitySource,
  BucketedView,
  BPLedger,
  BPLedgerEntry,
} from "./types.js";
import {
  Source,
  isPurchased,
  isStarting,
  sourceClass,
  ResolvedStats,
  GrantedAbility,
  PrereqReport,
  WealthReport,
  PrereqIssue,
  PrereqNote,
} from "./types.js";

const idName = (id: string) => id.split(":")[1] || id;

// Parse a chosen parameter out of a raw item name ONCE, so the param is a
// structured field on the node (GraphItem.param) instead of being re-scraped from
// the display name in identity/bucket code. Matches the two stored forms:
// "Lore (Arcane)" and "Profession - Apprentice". Falls back to the entity's own
// parameter label only if the name carries no explicit value. null = no param.
function extractParam(rawName: string): string | null {
  const clean = cleanItemName(rawName);
  const m = clean.match(/\(([^)]+)\)\s*$/) || clean.match(/\s-\s([^()]+)$/);
  return m ? m[1].trim() : null;
}

// The base name with any parameter suffix stripped ("Lore (Arcane)" → "Lore").
function stripParam(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();
}

// The plural COLLECTION/key namespace for an entity — built from its SINGULAR
// `.type` discriminator (never parsed from the id string). Use to build id keys.
function idPrefix(entity: { type?: string } | null | undefined): string {
  return entity?.type ? collectionOf(entity.type) : "";
}

export class CharacterGraphModel implements CharacterGraph {
  // Derived fields are LAZY + memoized getters, not eager constructor work. This
  // (a) encodes the dependency DAG in the data flow — e.g. `prereqs` reads
  // `ownedIds` reads `grantedAbilitiesList` — so it can't be broken by reordering,
  // (b) forces each compute* to be a pure function of already-resolved fields
  // (a getter computing from other getters can't depend on hidden mutation), which
  // keeps every one liftable into its own module as it hotspots, and (c) avoids
  // computing fields a given caller never reads. The cache makes each compute run
  // at most once per instance.
  private _memo = new Map<string, unknown>();
  private memo<T>(key: string, compute: () => T): T {
    if (!this._memo.has(key)) this._memo.set(key, compute());
    return this._memo.get(key) as T;
  }

  constructor(
    public character: CharacterState,
    public items: GraphItem[],
    public characterLevel: number,
    public classes: { name: string; level: number }[],
  ) {}

  get uiBuckets(): BucketedView {
    return this.memo("uiBuckets", () => this.buildBucketedView());
  }
  get stats(): ResolvedStats {
    return this.memo("stats", () => this.computeStats());
  }
  private get _grantedAbilitiesList(): GrantedAbility[] {
    return this.memo("granted", () => this.computeGrantedAbilitiesList());
  }
  private get _ownedIds(): Set<string> {
    return this.memo("ownedIds", () => this.computeOwnedIds());
  }
  get prereqs(): PrereqReport {
    return this.memo("prereqs", () => this.computePrereqs());
  }
  get wealth(): WealthReport {
    return this.memo("wealth", () => this.computeWealth());
  }
  get spend(): BPLedger {
    return this.memo("spend", () => this.computeSpend());
  }

  get activePowers(): Set<string> {
    const s = new Set<string>();
    const b = this.uiBuckets;
    for (const pool of [
      b.innatePowers,
      b.basicPowers,
      b.advancedPowers,
      b.veteranPowers,
      b.utilityPowers,
      b.classPowers,
      b.domainPowers,
    ]) {
      for (const p of pool) s.add(p.id || p.name);
    }
    return s;
  }

  hasEntity(entityId: string): boolean {
    return this.items.some((i) => i.id === entityId || i.entity?.id === entityId);
  }

  *[Symbol.iterator](): IterableIterator<GraphItem> {
    for (const node of this.items) {
      yield node;
    }
  }

  find(predicate: (node: GraphItem) => boolean): GraphItem | undefined {
    return this.items.find(predicate);
  }

  filter(predicate: (node: GraphItem) => boolean): GraphItem[] {
    return this.items.filter(predicate);
  }

  some(predicate: (node: GraphItem) => boolean): boolean {
    return this.items.some(predicate);
  }

  private computeStats() {
    const mods: Record<string, number> = { lifePoints: 0, spikes: 0, naturalArmor: 0, armor: 0 };
    const sources: { name: string; stat: string; n: number }[] = [];
    const notes: { name: string; stat: string; [k: string]: unknown }[] = [];

    const apply = (name: string, ent: any) => {
      if (!ent) return;
      for (const { stat, n } of ent.statMods || []) {
        if (n !== 0) {
          mods[stat] = (mods[stat] || 0) + n;
          sources.push({ name, stat, n });
        }
      }
      for (const note of ent.statModNotes || []) {
        notes.push({ name, ...note });
      }
    };

    for (const node of this.items) {
      for (const eff of node.effects) {
        if (eff.type === "STAT") {
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

    const row = LEVEL_TABLE.find((r: any) => r.level === level) || (level < minRow.level ? minRow : maxRow);

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
      classes: [],
      innatePowers: [],
      basicPowers: [],
      advancedPowers: [],
      veteranPowers: [],
      utilityPowers: [],
      classPowers: [],
      domainPowers: [],
      skills: [],
      perks: [],
      flaws: [],
      knownSpells: [],
    };

    for (const { name: cls, level: clsLevel } of this.classes) {
      view.classes.push({ name: cls, level: clsLevel, type: "class" });
    }

    for (const node of this.items) {
      if (node.field === "synthetic" || node.field === "lineageAdvantages" || node.field === "lineageChallenges")
        continue;

      // Use the structured node.param (parsed once at creation); fall back to the
      // entity's param label only for display when the node carries no value.
      const paramValue = node.param ?? (node.entity?.parameter || undefined);
      const displayName = paramValue && !node.name.includes(paramValue) ? `${node.name} (${paramValue})` : node.name;

      const isFree =
        node.sourceType === "grant" || (node.effects && node.effects.some((e) => e.type === "REFUND_GRANT"));
      let grantedBy = node.grantedBy;
      if (isFree && !grantedBy) {
        const refundEff = node.effects?.find((e) => e.type === "REFUND_GRANT");
        if (refundEff) grantedBy = refundEff.source;
      }

      const viewEntry = {
        ...(node.entity || { name: displayName, type: "unknown" }),
        id: node.id,
        entityId: node.entity?.id || node.id,
        name: displayName,
        sourceType: node.sourceType,
        grantedBy,
        free: isFree,
        cost: isFree ? 0 : (node.authoredCost ?? node.baseCost),
        rank: node.rank,
        // Grants/synthesized items have no storage index; -1 marks them
        // non-removable (the UI's canRemove is `!fromClass && index >= 0`).
        index: node.index ?? (node.sourceType === "grant" ? -1 : node.index),
        // Which class this came from (for multiclass clarity): the granting/owning
        // class, else the entity's parentClass.
        cls: node.cls ?? node.entity?.parentClass ?? null,
        effects: node.effects,
        rawString: node.rawString,
        field: node.field,
        choiceData: node.choiceData,
        specialty: node.specialty,
        floor: node.floor,
      } as any;

      if (node.field === "flaws") {
        view.flaws.push(viewEntry);
        continue;
      }

      // Entity types are PLURAL ('skills' / 'perks' / 'powers' / 'spell'); route by them.
      const t = node.entity?.type;
      const tier = (node.entity as any)?.tier;

      if (node.sourceType === "innate") {
        view.innatePowers.push(viewEntry);
      } else if (t === "spell") {
        view.knownSpells.push(viewEntry);
      } else if (t === "power") {
        if (tier === "Basic") view.basicPowers.push(viewEntry);
        else if (tier === "Advanced") view.advancedPowers.push(viewEntry);
        else if (tier === "Veteran") view.veteranPowers.push(viewEntry);
        else if (tier === "Utility") view.utilityPowers.push(viewEntry);
        else if (tier === "Class" || node.field === "classPowers") view.classPowers.push(viewEntry);
        else if (node.field === "domainPowers") view.domainPowers.push(viewEntry);
        else view.classPowers.push(viewEntry);
      } else if (t === "perk") {
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
  private computeGrantedAbilitiesList(): GrantedAbility[] {
    const list: GrantedAbility[] = [];
    for (const node of this.items) {
      for (const eff of node.effects) {
        if (eff.type !== "GRANT_SOURCE") continue;
        for (const ability of eff.grants) {
          const ent = lookupEntity(ability) as any;
          list.push({
            ability,
            abilityName: ent?.name || ability.split(":")[1],
            abilityType: ability.slice(0, ability.indexOf(":")),
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
    for (const node of this.items) {
      if (node.field === "flaws" || node.field === "synthetic") continue;
      if (node.id) {
        owned.add(node.id);
        if (node.id.includes("|")) owned.add(node.id.split("|")[0] + "|any");
      }
      const clean = cleanItemName(node.rawString || node.name);
      const bare = bareSkill(clean);
      const candidates = [
        `${node.field}:${bare}`,
        `powers:${clean}`,
        `perks:${clean}`,
        `skills:${clean}`,
        `powers:${bare}`,
        `perks:${bare}`,
        `skills:${bare}`,
      ];
      for (const cand of candidates) {
        const e = lookupEntity(cand);
        if (e) {
          owned.add(e.id);
          owned.add(`${idPrefix(e)}:${bareSkill(e.name)}`);
        }
      }
      if (node.entity?.id) {
        owned.add(node.entity.id);
        owned.add(`${idPrefix(node.entity)}:${bareSkill(node.entity.name)}`);
      }

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
      if (ent) owned.add(`${idPrefix(ent)}:${bareSkill(ent.name)}`);
    }
    return owned;
  }

  // ─── prereqStatusFor ──────────────────────────────────────────────────────
  // Whether a character meets the prereqs for a single entity id — used by the
  // power picker to flag locked candidates. Returns { met, missing, anyOf, notes }
  // where `met` is true only when all hard skill-prereqs (incl. disjunctions) are
  // satisfied. Free-text level/other prereqs can't be auto-verified, so they don't
  // block `met` but are surfaced as notes.
  prereqStatusFor(entityId: string): {
    met: boolean;
    missing: { id: string; name: string }[];
    anyOf: { id: string; name: string }[][];
    notes: string[];
  } {
    const ent =
      lookupEntity(entityId) || lookupEntity(entityId.split(":")[0] + ":" + bareSkill(entityId.split(":")[1]));
    const pr = REFS.prereqs[ent?.id || entityId];
    if (!pr) return { met: true, missing: [], anyOf: [], notes: [] };
    const owned = this._ownedIds;
    const missing = (pr.skills || []).filter((dep: string) => !owned.has(dep));
    const unmetGroups = (pr.anyOf || []).filter((g: string[]) => !g.some((dep: string) => owned.has(dep)));
    const notes = [...(pr.levels || []), ...(pr.other || [])];
    return {
      met: missing.length === 0 && unmetGroups.length === 0,
      missing: missing.map((m: string) => ({ id: m, name: m.split(":")[1] || m })),
      anyOf: unmetGroups.map((g: string[]) => g.map((m: string) => ({ id: m, name: m.split(":")[1] || m }))),
      notes,
    };
  }

  // ─── Prereqs ──────────────────────────────────────────────────────────────
  // Prereq check across every owned item. Skill-prereqs (entity ids) are verified
  // against ownership and become hard `issues` when unmet. Level/other prereqs are
  // free-text. Level constraints are parsed and hard-enforced as issues, while
  // unrecognized/other constraints surface as `notes` (manual verification).
  private computePrereqs(): PrereqReport {
    const owned = this._ownedIds;
    const issues: PrereqIssue[] = [];
    const notes: PrereqNote[] = [];
    const seen = new Set<string>();
    const charLevel = this.characterLevel;
    const charClasses = this.classes;
    const character = this.character;

    for (const node of this.items) {
      if (node.field === "flaws" || node.field === "synthetic") continue;
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
          issues.push({
            id,
            item: node.name,
            field: node.field,
            tierLevel: need,
            tier: rank,
            text: `tier ${rank} requires character level ${need}`,
          });
        }
      }

      // A sub-power can't be SELECTED directly — but it's legitimate when a grant
      // confers it (e.g. Holding Out for a Hero grants the sub-power Save the Day).
      // Flag a player-CHOSEN one (purchased, or a class-slot pick), NOT a granted or
      // innate one. (Slot picks are sourceType 'class' — still a direct selection.)
      if (ent && ent.tier === "SubPower" && (node.sourceType === "purchased" || node.sourceType === "class")) {
        issues.push({
          id,
          item: node.name,
          field: node.field,
          text: `${ent.name} is a sub-power and cannot be selected directly.`,
        });
      }

      const pr = REFS.prereqs[ent?.id || id];
      if (!pr) continue;

      const missing = (pr.skills || []).filter((dep: string) => !owned.has(dep));
      const unmetGroups = (pr.anyOf || []).filter((group: string[]) => !group.some((dep: string) => owned.has(dep)));
      if (missing.length || unmetGroups.length) {
        const eId = node.entity ? id.replace(/^[^:]+:/, `${idPrefix(node.entity)}:`) : id;
        issues.push({
          id: eId,
          item: node.name,
          field: node.field,
          missing: missing.map((m: string) => ({ id: m, name: idName(m) })),
          anyOf: unmetGroups.map((group: string[]) => group.map((m: string) => ({ id: m, name: idName(m) }))),
        });
      }
      for (const lvl of pr.levels || []) {
        const p = node.entity;
        if (p && p.parentClass && charClasses.every((c) => c.name !== p.parentClass)) {
          issues.push({
            id: p.id || id,
            item: node.name,
            field: node.field,
            text: `Requires a level in ${p.parentClass}`,
          });
        }
        const met = checkLevelConstraint(character, lvl, owned);
        if (met === false) {
          issues.push({
            id,
            item: node.name,
            field: node.field,
            text: `Requires ${lvl}`,
          });
        } else if (met === null) {
          notes.push({ id, item: node.name, field: node.field, kind: "level", text: lvl });
        }
      }
      for (const o of pr.other || []) {
        const met = checkLevelConstraint(character, o, owned);
        if (met === false) {
          issues.push({
            id,
            item: node.name,
            field: node.field,
            text: `Requires ${o}`,
          });
        } else if (met === null) {
          notes.push({ id, item: node.name, field: node.field, kind: "other", text: o });
        }
      }
    }

    // Over-cap PURCHASES (flagged generically by the dedupe pass via OVER_CAP) —
    // buying more of a thing than its cap allows is an illegal build. This is the
    // generic replacement for the old Weapon-Spec-specific check: it covers Weapon
    // Specialization (cap 1, two weapon types), a duplicate same-area Lore, a 5th
    // Extended Capacity, etc., from one rule.
    for (const node of this.items) {
      const overCap = node.effects?.find((e) => e.type === "OVER_CAP");
      if (!overCap) continue;
      issues.push({
        id: node.id,
        item: node.name,
        field: node.field,
        text:
          overCap.cap === 1
            ? `${node.name} can only be taken once.`
            : `${node.name} can be taken at most ${overCap.cap} time(s).`,
      });
    }

    // Independent rule families, each a single-concern check the model composes.
    for (const sub of [
      this.checkAdvancedClasses(),
      this.checkCreationOnlyPerks(),
      this.checkMutualExclusions(),
      this.checkPowerRequirements(),
      this.checkRepeatableCaps(),
      this.checkLineageConstraints(),
    ]) {
      issues.push(...sub.issues);
      notes.push(...sub.notes);
    }

    return { issues, notes };
  }

  // Advanced-class legality: base level ≥ 10 to take any, ≤ 2 advanced classes, and
  // each advanced class ≤ 5 levels.
  private checkAdvancedClasses(): {
    issues: PrereqIssue[];
    notes: PrereqNote[];
  } {
    const issues: PrereqIssue[] = [];
    const charClasses = this.classes;
    const advancedClasses = charClasses.filter((c) => !BASE_CLASSES.has(c.name));
    const baseLevel = charClasses.filter((c) => BASE_CLASSES.has(c.name)).reduce((sum, c) => sum + c.level, 0);

    if (advancedClasses.length > 0 && baseLevel < 10) {
      issues.push({
        id: "classes",
        item: "Advanced Classes",
        field: "classes",
        text: `Advanced classes cannot be taken until total level 10 has been reached. (Current base level: ${baseLevel})`,
      });
    }
    if (advancedClasses.length > 2) {
      issues.push({
        id: "classes",
        item: "Advanced Classes",
        field: "classes",
        text: `Character has ${advancedClasses.length} Advanced classes but is limited to a maximum of two.`,
      });
    }
    for (const ac of advancedClasses) {
      if (ac.level > 5) {
        issues.push({
          id: "classes",
          item: ac.name,
          field: "classes",
          text: `Advanced class ${ac.name} cannot exceed a maximum of 5 levels.`,
        });
      }
    }
    return { issues, notes: [] };
  }

  // Perks that must be taken at character creation (Draconic Heritage) → a note.
  private checkCreationOnlyPerks(): {
    issues: PrereqIssue[];
    notes: PrereqNote[];
  } {
    const notes: PrereqNote[] = [];
    if ([...this._ownedIds].some((id) => id.startsWith("perks:Draconic Heritage"))) {
      notes.push({
        id: "perks:Draconic Heritage",
        item: "Draconic Heritage",
        field: "purchasedPerks",
        kind: "other",
        text: "Must be taken at Character Creation.",
      });
    }
    return { issues: [], notes };
  }

  // Mutually-exclusive perks/flaws ("cannot be taken along with" each other).
  private checkMutualExclusions(): {
    issues: PrereqIssue[];
    notes: PrereqNote[];
  } {
    const issues: PrereqIssue[] = [];
    const excludes = REFS.excludes || {};
    if (Object.keys(excludes).length) {
      const ownedExcl = new Set<string>();
      for (const node of this.items) {
        if (node.field === "purchasedPerks" || node.field === "flaws" || node.field === "innatePerks") {
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
          const pairKey = [id, other].sort().join("|");
          if (reportedPairs.has(pairKey)) continue;
          reportedPairs.add(pairKey);
          issues.push({
            id,
            item: idName(id),
            field: id.split(":")[0],
            excludes: other,
            text: `cannot be taken along with ${idName(other)}`,
          });
        }
      }
    }
    return { issues, notes: [] };
  }

  // Parser-extracted power requirements: requiredLevel (per class), requiresEntity,
  // and a take-once duplicate guard on purchased powers.
  private checkPowerRequirements(): {
    issues: PrereqIssue[];
    notes: PrereqNote[];
  } {
    const issues: PrereqIssue[] = [];
    const owned = this._ownedIds;
    const charClasses = this.classes;
    const charLevel = this.characterLevel;
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

    for (const node of this.items) {
      if (node.entity?.type !== "power") continue;
      const name = cleanItemName(node.name);
      const field = node.field;
      const ent = powerInContext(name) as any;
      if (!ent) continue;

      if (ent.requiredLevel > 0) {
        const reqClass = ent.requiredClass || ent.__contextClass;
        const have = reqClass ? charClassLevels.get(reqClass) || 0 : charLevel;
        if (have < ent.requiredLevel) {
          issues.push({
            id: `powers:${name}`,
            item: name,
            field,
            text: `Requires ${reqClass ? `${reqClass} ` : ""}Level ${ent.requiredLevel}`,
          });
        }
      }
      for (const reqName of ent.requiresEntity || []) {
        const ok =
          owned.has(`powers:${reqName}`) ||
          owned.has(`skills:${reqName}`) ||
          owned.has(`perks:${reqName}`) ||
          owned.has(`powers:${bareSkill(reqName)}`);
        if (!ok) {
          issues.push({
            id: `powers:${name}`,
            item: name,
            field,
            requiresEntity: reqName,
            text: `Requires ${reqName}`,
          });
        }
      }
    }

    const powerCounts = new Map<string, number>();
    for (const node of this.items) {
      if (node.entity?.type !== "power" || node.sourceType !== "purchased") continue;
      const name = cleanItemName(node.name);
      if (!name) continue;
      powerCounts.set(name, (powerCounts.get(name) || 0) + 1);
    }
    for (const [name, count] of powerCounts) {
      if (count > 1) {
        issues.push({
          id: `powers:${name}`,
          item: name,
          field: "powers",
          duplicate: count,
          text: `selected ${count} times — a power may only be taken once`,
        });
      }
    }
    return { issues, notes: [] };
  }

  // Caps on repeatable perks where the parameter must differ (Elemental Affinity:
  // ≤2, distinct elements) or that are mutually exclusive as a group (Bloodlines: 1).
  private checkRepeatableCaps(): {
    issues: PrereqIssue[];
    notes: PrereqNote[];
  } {
    const issues: PrereqIssue[] = [];
    const elemAffinities: string[] = [];
    for (const node of this.items) {
      if (bareSkill(cleanItemName(node.name)) === "Elemental Affinity") {
        elemAffinities.push(node.rawString || node.name);
      }
    }
    if (elemAffinities.length) {
      if (elemAffinities.length > 2) {
        issues.push({
          id: "perks:Elemental Affinity",
          item: "Elemental Affinity",
          field: "purchasedPerks",
          text: `taken ${elemAffinities.length} times — may be taken at most twice`,
        });
      }
      const elements = elemAffinities.map((p) => (p.match(/\(([^)]+)\)/) || [])[1]?.trim()).filter(Boolean);
      const dupElement = elements.find((e, i) => elements.findIndex((x) => x.toLowerCase() === e!.toLowerCase()) !== i);
      if (dupElement) {
        issues.push({
          id: "perks:Elemental Affinity",
          item: "Elemental Affinity",
          field: "purchasedPerks",
          text: `cannot attune to ${dupElement} twice — each Elemental Affinity must be a different element`,
        });
      }
    }

    const bloodlines: string[] = [];
    for (const node of this.items) {
      if (node.entity?.category === "Bloodline") bloodlines.push(node.rawString || node.name);
    }
    if (bloodlines.length > 1) {
      issues.push({
        id: "perks",
        item: "Bloodline Perks",
        field: "purchasedPerks",
        text: `has ${bloodlines.length} Bloodline Perks (${bloodlines.join(", ")}) — character may only have one`,
      });
    }
    return { issues, notes: [] };
  }

  // Lineage-challenge constraints (Hot Blooded, Anti-magic, The Fractured, …).
  private checkLineageConstraints(): {
    issues: PrereqIssue[];
    notes: PrereqNote[];
  } {
    const issues: PrereqIssue[] = [];
    const character = this.character;
    const sublineages = character.sublineages || {};
    const hasFlaw = (name: string) => (character.flaws || []).some((f) => f.entityId === name);
    const hasSkill = (name: string) => (character.skills || []).some((s) => s.entityId === name);

    if (sublineages["Hot Blooded"] && hasFlaw("Pliant")) {
      issues.push({
        id: "flaws:Pliant",
        item: "Pliant",
        field: "flaws",
        text: `cannot be taken along with the Hot Blooded lineage challenge`,
      });
    }

    if (sublineages["Anti-magic"]) {
      const spellcastingLevels = character.classes.filter((c) => CLASSES[c.name]?.spellcaster && c.level > 0);
      if (spellcastingLevels.length > 0) {
        issues.push({
          id: "classes:" + spellcastingLevels[0].name,
          item: spellcastingLevels[0].name,
          field: "classes",
          text: `cannot take class levels in spellcasting classes due to Anti-magic lineage challenge`,
        });
      }
      if (hasSkill("Ritual Magic")) {
        issues.push({
          id: "skills:Ritual Magic",
          item: "Ritual Magic",
          field: "skills",
          text: `cannot purchase Ritual Magic due to Anti-magic lineage challenge`,
        });
      }
    }

    if (sublineages["The Fractured"]) {
      const stats = character.stats || {};
      if ((stats.maxLifePoints ?? 0) < 1) {
        issues.push({
          id: "lineage:The Fractured",
          item: "The Fractured",
          field: "lineage",
          text: `cannot be taken if the character already has 1 maximum Life Point (would reduce below 1)`,
        });
      }
    }

    if (sublineages["Divinity's Scourge"] && hasFlaw("Divine Vulnerability")) {
      issues.push({
        id: "flaws:Divine Vulnerability",
        item: "Divine Vulnerability",
        field: "flaws",
        text: `cannot be taken along with the Divinity's Scourge lineage challenge`,
      });
    }
    return { issues, notes: [] };
  }

  // ─── Wealth ───────────────────────────────────────────────────────────────
  // Walk the graph for WEALTH effects and combine with the character's base wealth.
  private computeWealth(): WealthReport {
    const DEFAULT_WEALTH = 8;
    const characterWealth = this.character.wealth;
    const base =
      characterWealth != null && characterWealth !== ""
        ? parseInt(String(characterWealth), 10) || DEFAULT_WEALTH
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
    for (const node of this.items) {
      for (const eff of node.effects) {
        if (eff.type === "WEALTH") {
          add(node.name, eff.amount, eff.note || "");
        }
      }
    }

    return { base, income, total: base + income, sources };
  }

  // ─── BP Spend ─────────────────────────────────────────────────────────────
  // Full BP ledger: base costs, grants, discounts, and totals. Computed once.
  private computeSpend(): BPLedger {
    // Build index of things granted by the character's owned items.
    const paramKey = (typedName: any) => {
      const c = typeof typedName === "string" && typedName.includes(":") ? typedName : `:${typedName}`;
      let type = c.slice(0, c.indexOf(":"));
      const rest = c.slice(c.indexOf(":") + 1);
      if (type === "purchasedSkills" || type === "startingSkills") type = "skills";
      if (type === "purchasedPerks") type = "perks";
      const paren = rest.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      const dash = rest.match(/^(.*?)\s+-\s+(.*)$/);
      const m = paren || dash;
      if (!m) return null;
      return `${type}:${m[1].trim()}|${m[2].trim().toLowerCase()}`;
    };
    const grantIndex: any = {};
    const grantParamIndex: any = {};
    for (const node of this.items) {
      for (const eff of node.effects) {
        if (eff.type === "GRANT_SOURCE") {
          eff.grants.forEach((g: string) => {
            if (!grantIndex[g]) grantIndex[g] = node.name;
            const pk = paramKey(g);
            if (pk && !grantParamIndex[pk]) grantParamIndex[pk] = node.name;
          });
        }
      }
    }

    let rawAwarded = 0;
    let refunded = 0;
    const byItem: Record<string, BPLedgerEntry> = {};

    // Phase 1: Base Costs and Grants
    //
    // The cost entry lives ON the node (node.costEntry) — the spreadsheet-row model:
    // each owned item carries its own base/rank/floor/discount/you-pay. Phases 2–3
    // and the total read the entry off the node; nothing looks a cost up by a string
    // key or array index. `byItem` (below) is a derived name-keyed PROJECTION built
    // once at the end for external/UI consumers, not the engine's source of truth.
    const setEntry = (node: GraphItem, entry: BPLedgerEntry) => {
      node.costEntry = entry;
    };

    for (const node of this.items) {
      if (node.field === "flaws") {
        setEntry(node, { cost: node.baseCost, base: node.baseCost, grant: null });
        rawAwarded += -node.baseCost;
        continue;
      }

      let isGranted = false;
      let grantSrc: any = null;
      let isDerived = false;
      const nId = node.entityId || node.id;
      // Build the grant-matching key from the node's STRUCTURED param (parsed once
      // at creation) instead of re-scraping rawString. Key shape matches paramKey():
      // `${type}:${base}|${param}`. null when the node carries no param.
      const nodeParamKey =
        node.param && nId
          ? `${nId.slice(0, nId.indexOf(":"))}:${node.entity?.baseName || stripParam(node.name)}|${node.param.toLowerCase()}`
          : null;
      const normalizedId = nId
        ? nId
            .replace(/^purchasedSkills:/, "skills:")
            .replace(/^startingSkills(:\d+)?:/, "skills:")
            .replace(/^purchasedPerks:/, "perks:")
        : null;

      if (normalizedId && grantIndex[normalizedId]) {
        isGranted = true;
        grantSrc = grantIndex[normalizedId];
        isDerived = true;
      } else if (nodeParamKey && grantParamIndex[nodeParamKey]) {
        isGranted = true;
        grantSrc = grantParamIndex[nodeParamKey];
        isDerived = true;
      } else if (node.sourceType === "innate" || node.field === "multiclassGrant") {
        isGranted = true;
        grantSrc = "class";
        isDerived = true;
      }

      if (typeof node.authoredCost === "number") {
        if (isDerived && node.authoredCost > 0) {
          setEntry(node, {
            cost: 0,
            base: node.baseCost,
            grant: { kind: "grant", source: grantSrc, derived: true },
            rank: node.rank,
          });
        } else {
          setEntry(node, {
            cost: node.authoredCost,
            base: node.baseCost,
            grant: null,
            rank: node.rank,
            authored: true,
          });
        }
        continue;
      }

      if (node.sourceType === "class") {
        const floor = node.floor;

        if (isGranted) {
          setEntry(node, { cost: -node.baseCost, base: 0, grant: { kind: "grant", source: grantSrc, derived: true } });
          refunded += node.baseCost;
          continue;
        }

        if (floor && node.rank > floor) {
          const extra = node.rank - floor;
          const entCost = node.baseCost / node.rank || 0;
          const extraCost = entCost * extra;
          setEntry(node, {
            cost: extraCost,
            base: entCost,
            grant: null,
            rank: node.rank,
            freeRanks: floor,
            paidRanks: extra,
          });
        } else {
          setEntry(node, {
            cost: 0,
            base: node.baseCost / node.rank || 0,
            grant: null,
            rank: node.rank,
            freeRanks: floor || 1,
            paidRanks: 0,
          });
        }
        continue;
      }

      if (isGranted) {
        setEntry(node, {
          cost: 0,
          base: node.baseCost,
          grant: { kind: "grant", source: grantSrc, derived: true },
          rank: node.rank,
        });
      } else {
        setEntry(node, { cost: node.baseCost, base: node.baseCost, grant: null, rank: node.rank });
      }
    }

    // Phase 2: Apply Discounts
    const discountSources: any[] = [];
    for (const node of this.items) {
      for (const eff of node.effects) {
        if (eff.type === "DISCOUNT_SOURCE") {
          discountSources.push({ ...eff.discount, id: node.id, name: node.name });
        }
      }
    }

    const used = new Map();
    const catCount = new Map();
    let discountFreeBP = 0;
    const discountsApplied: any[] = [];

    for (const node of this.items) {
      if (node.field !== "skills" && node.field !== "perks") continue;

      const eff = node.costEntry;
      if (!eff || eff.authored) continue;

      const catKey = node.entity?.category || cleanItemName(node.rawString || node.name).split(" ")[0];
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
          if (eff.cost === 0 && (eff.grant?.kind === "grant" || (eff.freeRanks || 0) > 0) && src.refundIfFree) {
            const refund = Math.min(src.amount, room);
            discountFreeBP += refund;
            used.set(src.id, (used.get(src.id) || 0) + refund);
            discountsApplied.push({ key: node.id, source: src.name, amount: refund, asFreeBP: true });
          }
          continue;
        }

        eff.cost -= cut;
        eff.discount = { source: src.name, amount: cut };
        used.set(src.id, (used.get(src.id) || 0) + cut);
        discountsApplied.push({ key: node.id, source: src.name, amount: cut });
        break;
      }
    }

    // Phase 3: Total Summation — read the you-pay cost straight off each node's
    // entry (flaws carry a negative "cost" that feeds rawAwarded, not spend).
    let spent = 0;
    for (const node of this.items) {
      if (node.field === "flaws") continue;
      const eff = node.costEntry;
      if (eff && eff.cost > 0) spent += eff.cost;
    }

    // Derived name-keyed projection for external/UI consumers (sheet, validate rows).
    // Not the engine's source of truth — that's node.costEntry. Later readers move
    // to reading cost off the resolved row and this can go.
    for (const node of this.items) {
      const k = costKey(node);
      if (node.costEntry && k) byItem[k] = node.costEntry;
    }

    const awarded = Math.min(rawAwarded, MAX_FLAW_BP);

    // `refunded` and `discountFreeBP` are accounting intermediates — they feed `net`
    // and nothing outside reads them, so they stay local (not part of the ledger).
    return {
      spent,
      awarded,
      rawAwarded,
      flawCapped: rawAwarded > MAX_FLAW_BP,
      discountsApplied,
      net: spent - refunded - discountFreeBP,
      byItem,
    };
  }
}

// Determine if a discount source applies to a specific graph item
function discountApplies(src: any, itemNode: any, pos: number): boolean {
  const ent = itemNode.entity;
  const itemName = itemNode.name;

  if (src.exclusions?.includes(ent?.id) || src.exclusions?.includes(`perks:${cleanItemName(itemName)}`)) return false;

  const cat = ent?.category;
  if (src.scope.kind === "category") {
    return (
      Array.isArray(src.scope.value) &&
      src.scope.value.some((c: string) => c.toLowerCase() === String(cat).toLowerCase())
    );
  }
  if (src.scope.kind === "firstN") {
    return (
      new RegExp(`^${src.scope.value}\\b`, "i").test(cleanItemName(itemName)) &&
      (src.scope.n == null || pos < src.scope.n)
    );
  }
  if (src.scope.kind === "skillRanks") {
    return new RegExp(`^${src.scope.value}\\b`, "i").test(cleanItemName(itemName));
  }
  if (src.scope.kind === "namedSkill") {
    return bareSkill(cleanItemName(itemName)) === src.scope.value;
  }
  if (src.scope.kind === "prereq") {
    const pr = REFS.prereqs?.[ent?.id];
    const target = `perks:${src.scope.value}`;
    return (
      !!pr && (pr.skills?.includes(target) || !!pr.other?.some((o: string) => new RegExp(src.scope.value, "i").test(o)))
    );
  }
  if (src.scope.kind === "giftEligible") {
    if (!ent || ent.id?.startsWith("skills:")) return false;
    if (ent.id === `perks:${src.scope.value}`) return false;
    const prereqText = String(ent.prereq || ent.prerequisites || "");
    if (new RegExp(`\\b${src.scope.value}\\b`, "i").test(prereqText)) return false;
    return true;
  }
  return false;
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
    const martial = charClasses
      .filter((c) => (CLASSES as any)[c.name]?.tags?.includes("Martial"))
      .reduce((sum, c) => sum + c.level, 0);
    return martial >= required;
  }
  // 2. "Level N [Class]" (e.g., "Level 2 Spellcaster", "Level 3 Mage")
  m = constraintStr.match(/^Level\s+(\d+)\s+([A-Za-z\s]+)$/i);
  if (m) {
    const requiredLevel = parseInt(m[1], 10);
    const classStr = m[2].trim().toLowerCase();

    // Spellcaster meta-class
    if (classStr === "spellcaster" || classStr === "spellcaster class") {
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
    const have = Object.values(slots || {}).reduce((s: number, c: any) => s + (c[tier] || 0), 0);
    return have >= count;
  }
  // 6. "N Ranks of Profession"
  m = constraintStr.match(/^(\d+)\s+Ranks\s+of\s+Profession/i);
  if (m) {
    const count = parseInt(m[1], 10);
    const profs = [...owned].filter((id) => /^skills:Profession/i.test(id));
    return profs.length >= count;
  }

  return null;
}

// Normalize a character at the engine boundary: seed the two facts that are DERIVED
// (not stored on the character) — class-granted innate powers and the devotion bucket
// entry — so everything past resolveCharacterGraph sees a complete character.
// Idempotent: re-running never double-seeds (innates dedupe by name, the devotion
// entry is added only when absent).
function normalizeCharacter(character: CharacterState): CharacterState {
  const classes = getClasses(character);
  const powers = [...(character.powers || [])];
  // Class-granted innate powers (level-gated) are DERIVED from the class list, not
  // stored on the character. Seed the ones the character qualifies for that aren't
  // already present (dedupe by name keeps this idempotent across re-resolves).
  const owned = new Set(powers.map((p) => p.entityId));
  for (const c of classes) {
    const clsDef = lookupEntity(`classes:${c.name}`);
    for (const p of clsDef?.innate || []) {
      if (c.level >= (p.requiredLevel || 1) && !owned.has(p.name)) {
        owned.add(p.name);
        powers.push({ entityId: p.name, source: Source.innate(), ranks: 1, costField: "innatePowers" });
      }
    }
  }

  // The `devotion` scalar becomes a devotions-bucket entry (added only when absent).
  const devotions = [...(character.devotions || [])];
  if (character.devotion && !devotions.some((d) => d.entityId === `devotions:${character.devotion}`)) {
    devotions.push({ entityId: `devotions:${character.devotion}`, source: Source.purchased() });
  }

  return { ...character, classes, powers, devotions };
}

export function resolveCharacterGraph(charInput: CharacterState): CharacterGraphModel {
  // The character is born from the buckets (UI reducers, loadArchetype, the sheet importer, and
  // the test factory all produce buckets). At the boundary we only DERIVE the
  // two facts that aren't stored — class innate powers + the devotion entry.
  const character = normalizeCharacter(charInput);

  const items: GraphItem[] = [];
  const charLevel = characterLevel(character);
  const classes = getClasses(character);

  const addItem = (choice: any) => {
    let ent = lookupEntity(choice.entityId) as any;
    // Remove the collection prefix (e.g. "skills:") for the display name
    const rawName = choice.entityId.replace(/^[a-z]+:/i, "");
    const cleanName = cleanItemName(rawName);
    const bareName = bareSkill(cleanName);

    // Fallback if entityId wasn't fully qualified
    if (!ent) {
      ent =
        lookupEntity(`skills:${bareName}`) || lookupEntity(`perks:${cleanName}`) || lookupEntity(`powers:${cleanName}`);
    }

    const rank = choice.ranks || 1;
    const effects: Effect[] = [];

    // Extract Base Cost
    let baseCost = 0;
    if (Array.isArray(ent?.tiers) && ent.tiers.length) {
      const n = Math.min(rank, ent.tiers.length);
      baseCost = ent.tiers.slice(0, n).reduce((s: number, t: any) => s + (t.cost || 0), 0);
    } else {
      baseCost = (typeof ent?.cost === "number" ? ent.cost : ent?.lbp || 0) * rank;
    }

    const entityId = ent?.id || choice.entityId;
    for (const extractor of EFFECT_EXTRACTORS) {
      effects.push(...extractor(ent, character, entityId));
    }

    // The node model's internal sourceType string, derived from the structured
    // source's `type`. `starting` maps to 'class' (a starting skill was the old
    // 'Class:Starting' string → sourceType 'class'); `granted` → 'grant'.
    const src: EntitySource = (choice.source as EntitySource) || Source.purchased();
    const SOURCE_TYPE: Record<EntitySource["type"], string> = {
      purchased: "purchased",
      class: "class",
      starting: "class",
      innate: "innate",
      granted: "grant",
      lineage: "lineage",
      flaw: "flaw",
    };
    const sourceType = SOURCE_TYPE[src.type] || "purchased";

    // Determine the field based on the entity prefix or fallback
    let field = choice.entityId.split(":")[0];
    if (["skills", "perks", "powers", "flaws"].indexOf(field) === -1) {
      if (ent?.id) field = ent.id.split(":")[0];
      else field = "unknown";
    }

    // Node id is the PARAMETER-PRESERVING instance key used for the BP ledger,
    // prereq issue ids, and dedupe — NOT ent.id (the param-stripped BASE). Its
    // prefix is the ORIGINATING character field: flat-path buckets carry it as
    // `choice.costField` (e.g. 'classPowers'); native skills have none, so they
    // key under their entity collection ('skills'). Falls back to the raw entityId.
    const idPrefixName = (choice as any).costField || (ent?.type ? idPrefix(ent) : null);
    const nodeId = idPrefixName ? `${idPrefixName}:${cleanName}` : entityId;
    items.push({
      id: nodeId,
      entityId: entityId,
      name: ent?.name || cleanName,
      rawString: choice.entityId,
      param: extractParam(rawName),
      field,
      sourceType,
      cls: sourceClass(src),
      rank: choice.ranks || 1,
      index: choice.originalIndex,
      baseCost: baseCost,
      authoredCost: choice.costOverride,
      entity: ent,
      effects,
      specialty: null,
      floor: 0,
      choiceData: choice,
    });
  };

  // Skills carry a bucket-relative position per source: purchased skills use it for
  // removal (the UI passes the index among purchased entries); starting skills use
  // it only so the derived byItem projection has a distinct key per row and the
  // floor/specialty zip lines up. It is NOT an identity — the dedupe pass tells
  // duplicates apart.
  let purchasedSkillIdx = 0;
  let startingSkillIdx = 0;
  for (const choice of character.skills || []) {
    if (isPurchased(choice.source)) {
      addItem({ ...choice, originalIndex: choice.originalIndex ?? purchasedSkillIdx++ });
    } else if (isStarting(choice.source)) {
      addItem({ ...choice, originalIndex: startingSkillIdx++ });
    } else {
      addItem(choice);
    }
  }
  for (const choice of character.perks || []) addItem(choice);

  const powerIdxByField: Record<string, number> = {};
  for (const choice of character.powers || []) {
    if (isPurchased(choice.source) && choice.costField) {
      const idx = powerIdxByField[choice.costField] || 0;
      powerIdxByField[choice.costField] = idx + 1;
      addItem({ ...choice, originalIndex: idx });
    } else {
      addItem(choice);
    }
  }
  for (const choice of character.spells || []) addItem(choice);
  for (const choice of character.devotions || []) addItem(choice);

  for (const field of ["lineageAdvantages", "lineageChallenges"]) {
    for (const name of (character as any)[field] || []) {
      const type = field === "lineageAdvantages" ? "advantages" : "challenges";
      let entityId = `${type}:${name}`;
      if (name === "Pick and Choose" && character.advantageChoices?.["Pick and Choose"]) {
        entityId = `advantages:${character.advantageChoices["Pick and Choose"]}`;
      }
      const choice = { entityId, ranks: 1, source: Source.lineage() };
      addItem(choice);
    }
  }

  // Process Flaws
  for (const choice of character.flaws || []) {
    const rawName = (choice as any).entityId.replace(/^flaws:/i, "");
    const cleanName = cleanItemName(rawName);
    const ent = lookupEntity(`flaws:${cleanName}`) as any;
    let bp = 0;
    if (ent) {
      const allergenTable = ALLERGEN_AWARDS[ent.baseName];
      if (allergenTable) {
        const chosen = allergenAward(ent.baseName, ent.parameter);
        bp = chosen != null ? chosen : Math.min(...Object.values(allergenTable));
      } else {
        bp = typeof ent.bp === "number" ? ent.bp : parseInt(String(ent.bp), 10) || 0;
      }
    }
    items.push({
      id: ent?.id || `flaws:${cleanName}`,
      name: ent?.name || cleanName,
      rawString: (choice as any).entityId,
      param: extractParam(rawName),
      field: "flaws",
      sourceType: "flaw",
      index: character.flaws?.indexOf(choice),
      rank: 1,
      baseCost: -bp,
      entity: ent,
      effects: [{ type: "FLAW_AWARD", amount: bp }],
      choiceData: choice as any,
    });
  }

  // Generate Synthesized Granted Items & Deduplicate
  const getIdentity = (rawName: string, ent: any, param?: string | null) => {
    const clean = cleanItemName(rawName);
    const entityId = ent?.id || rawName;
    const cap = getMaxRanks(entityId);
    const info = paramInfo(ent);
    const reusable = paramReusable(ent, entityId);
    const baseName = (ent?.baseName || ent?.name || bareSkill(clean)).toLowerCase();

    // Take-once entities (cap 1) have ONE identity regardless of parameter — the
    // param is flavor on the single instance, not a distinguisher. e.g. Weapon
    // Specialization (Swords) and (Axes) are the SAME identity, so a second one is
    // redundant (free BP). Without this, a parameterized cap-1 entity keyed by
    // base|param wrongly kept both. (Param distinguishes only when cap > 1.)
    if (cap <= 1) return { key: baseName, cap };

    // No param, or param is payload (reusable) → identity is the base; the cap
    // governs how many total takings are kept.
    if (!info || reusable) return { key: baseName, cap };

    // Parameterized, multi-rank, not reusable (Lore, …) → param distinguishes
    // distinct instances, each capped at one. Read the structured node.param,
    // falling back to the entity's param label only if absent.
    const paramValue = (param ?? ent?.parameter ?? "unknown").toLowerCase();
    return { key: `${baseName}|${paramValue}`, cap: 1 };
  };

  const itemIdentities = new Map<string, { cap: number; nodes: any[] }>();
  for (const it of items) {
    if (it.sourceType === "lineage") continue;
    const { key, cap } = getIdentity(it.rawString || it.name, it.entity, it.param);
    if (!itemIdentities.has(key)) itemIdentities.set(key, { cap, nodes: [] });
    itemIdentities.get(key)!.nodes.push(it);
  }

  // Enforce the cap on PURCHASES per identity. You can't buy more of a thing than
  // its cap (e.g. two Weapon Specializations, or a 2nd Lore of the same area) —
  // that's an illegal build, so flag the surplus purchases with an OVER_CAP effect
  // that computePrereqs surfaces as a validation issue. (Grants that push you over
  // cap are handled separately below — those refund as free BP, not an error.)
  for (const group of itemIdentities.values()) {
    const purchases = group.nodes.filter((n) => n.sourceType === "purchased");
    if (purchases.length > group.cap) {
      for (const surplus of purchases.slice(group.cap)) {
        surplus.effects = surplus.effects || [];
        surplus.effects.push({ type: "OVER_CAP", cap: group.cap });
      }
    }
  }

  for (const node of [...items]) {
    for (const eff of node.effects) {
      if (eff.type !== "GRANT_SOURCE") continue;
      for (const gid of eff.grants) {
        let ent = lookupEntity(gid) as any;
        const gType = gid.slice(0, gid.indexOf(":"));
        const rawGidName = gid.slice(gid.indexOf(":") + 1);
        if (!ent) {
          const clean = cleanItemName(rawGidName);
          ent = lookupEntity(`skills:${clean}`) || lookupEntity(`powers:${clean}`) || lookupEntity(`perks:${clean}`);
        }

        const gName = ent?.name || rawGidName;
        const { key, cap } = getIdentity(gName, ent, extractParam(rawGidName));

        let group = itemIdentities.get(key);
        if (!group) {
          group = { cap, nodes: [] };
          itemIdentities.set(key, group);
        }

        // Check if we are at cap with grants + purchases
        const grantCount = group.nodes.filter((n) => n.sourceType === "grant").length;
        const purchaseCount = group.nodes.filter((n) => n.sourceType === "purchased").length;

        if (grantCount + purchaseCount >= cap) {
          // We are at cap. Grant wins, so refund a purchase if one exists
          const purchasedNode = group.nodes.find(
            (n) => n.sourceType === "purchased" && !n.effects?.some((e) => e.type === "REFUND_GRANT"),
          );
          if (purchasedNode) {
            purchasedNode.effects = purchasedNode.effects || [];
            purchasedNode.effects.push({ type: "REFUND_GRANT", source: node.name });
          }
          // At cap: the grant is redundant and is dropped (not added as a node).
          // This is correct for cost — a grant's baseCost is 0, so "free BP equal to
          // its cost" is 0; there's no BP to recover. If a PURCHASE shared the key it
          // was refunded above (grant wins, purchase becomes free). With no purchase
          // (e.g. two classes granting the same skill) the duplicate simply collapses
          // to the single kept node.
          continue;
        }

        const newGrant = {
          id: ent?.id || gid,
          name: gName,
          rawString: gName,
          param: extractParam(gName),
          field: `${gType}Grant`,
          sourceType: "grant",
          grantedBy: node.name,
          grantKind: node.sourceType,
          cls: node.cls ?? node.entity?.parentClass ?? null,
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
  const hasTaxEvasion = items.some((i) => i.name === "Tax Evasion");
  if (hasTaxEvasion) {
    const profRanks = items.filter((i) => /^\bProfession\b/i.test(i.name)).length;
    let bonus = profRanks * 3;
    if (items.some((i) => i.name === "Manse")) bonus += 2;
    if (items.some((i) => i.name === "Income")) bonus += 2;
    if (bonus > 0) {
      items.push({
        id: "synthetic:Tax Evasion Wealth",
        name: "Tax Evasion Bonus",
        rawString: "Tax Evasion Bonus",
        field: "synthetic",
        sourceType: "synthetic",
        rank: 1,
        baseCost: 0,
        effects: [{ type: "WEALTH", amount: bonus, note: "from Profession/Manse/Income" }],
      });
    }
  }

  // Attach the free-rank floor + specialty provenance onto each starting-skill node
  // (the spreadsheet "free floor" / "granted-by" columns). Derived on read from the
  // class's starting-choice config — not persisted — so it survives import/round-trip.
  // startingSkillGrants yields them positioned over the Class:Starting entries in
  // bucket order; we walk the starting nodes in that same order to zip them on. This
  // order is iteration, NOT an identity — duplicates are still told apart by the
  // dedupe pass, never by position.
  const grants = startingSkillGrants(character);
  let startingNodeIdx = 0;
  for (const node of items) {
    if (node.field === "skills" && node.sourceType === "class") {
      if (grants.specialty[startingNodeIdx] != null) node.specialty = grants.specialty[startingNodeIdx];
      if (grants.floor[startingNodeIdx] != null) node.floor = grants.floor[startingNodeIdx];
      startingNodeIdx++;
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
      abilityType: ability.slice(0, ability.indexOf(":")),
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
      if (eff.type !== "GRANT_SOURCE") continue;
      for (const ability of eff.grants) {
        addRow(ability, node.name, node.id, node.sourceType);
      }
    }
  }
  return { list, bySource };
}
