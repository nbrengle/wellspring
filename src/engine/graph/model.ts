import { EFFECT_EXTRACTORS } from "../extractors.js";
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
} from "../../engine/data.js";
import { startingSkillGrants } from "../starting-choices.js";
import { MAX_FLAW_BP } from "../validate/core.js";
import { costKey } from "../validate/cost-key.js";
import { cleanItemName, bareSkill, getClasses, parseWordNumber } from "../resolver.js";
import { characterLevel, getMaxRanks } from "../validate/core.js";
import { paramInfo, paramReusable } from "../param-domain.js";
import { spellSlots, type SpellPool } from "../validate/slots.js";
import type {
  CharacterState,
  GraphItem,
  CharacterGraph,
  Effect,
  EntitySource,
  BucketedView,
  BPLedger,
  BPLedgerEntry,
  BaseEntity,
  Entity,
  CharacterChoice,
  DiscountSpec,
  WealthReport,
} from "../types.js";
import {
  Source,
  isPurchased,
  isStarting,
  sourceClass,
  ResolvedStats,
  GrantedAbility,
  PrereqReport,
  PrereqIssue,
  PrereqNote,
} from "../types.js";
import { computeStats } from "./stats.js";
import { buildBucketedView } from "./buckets.js";
import { computeGrantedAbilitiesList, computeOwnedIds } from "./grants.js";
import { prereqStatusFor, computePrereqs } from "./prereqs.js";
import { computeWealth } from "./wealth.js";
import { computeSpend } from "./spend.js";

export function extractParam(rawName: string): string | null {
    const clean = cleanItemName(rawName);
    const m = clean.match(/\(([^)]+)\)\s*$/) || clean.match(/\s-\s([^()]+)$/);
    return m ? m[1].trim() : null;
}

export function stripParam(name: string): string {
    return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();
}

export function idPrefix(entity: { type?: string } | null | undefined): string {
    return entity?.type ? collectionOf(entity.type) : "";
}

export class CharacterGraphModel implements CharacterGraph {
    private _memo = new Map<string, unknown>();

    constructor(public character: CharacterState, public items: GraphItem[], public characterLevel: number, public classes: { name: string; level: number }[]) {
    }

    get uiBuckets(): BucketedView {
        return this.memo("uiBuckets", () => buildBucketedView(this));
    }

    get stats(): ResolvedStats {
        return this.memo("stats", () => computeStats(this));
    }

    public get _grantedAbilitiesList(): GrantedAbility[] {
        return this.memo("granted", () => computeGrantedAbilitiesList(this));
    }

    public get _ownedIds(): Set<string> {
        return this.memo("ownedIds", () => computeOwnedIds(this));
    }

    get prereqs(): PrereqReport {
        return this.memo("prereqs", () => computePrereqs(this));
    }

    get wealth(): WealthReport {
        return this.memo("wealth", () => computeWealth(this));
    }

    get spend(): BPLedger {
        return this.memo("spend", () => computeSpend(this));
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

    private memo<T>(key: string, compute: () => T): T {
        if (!this._memo.has(key)) this._memo.set(key, compute());
        return this._memo.get(key) as T;
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

    prereqStatusFor(entityId: string) {
        return prereqStatusFor(this, entityId);
    }
}
export const idName = (id: string) => id.split(':')[1] || id;
