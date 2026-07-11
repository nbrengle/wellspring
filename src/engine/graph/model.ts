import { collectionOf } from "../../engine/data.js";
import { cleanItemName } from "../resolver.js";
import type { BPLedger, BucketedView, CharacterGraph, CharacterState, GraphItem, WealthReport } from "../types.js";
import { BestowedAbility, PrereqReport, ResolvedStats } from "../types.js";
import { buildBucketedView } from "./buckets.js";
import { computeBestowedAbilitiesList, computeOwnedIds } from "./grants.js";
import { computePrereqs, prereqStatusFor } from "./prereqs.js";
import { computeSpend } from "./spend.js";
import { computeStats } from "./stats.js";
import { computeWealth } from "./wealth.js";

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

export function composeDisplayName(baseName: string, param?: string | null): string {
  if (!param) return baseName;
  return /\(/.test(baseName) ? baseName : `${baseName} (${param})`;
}

export function idPrefix(entity: { type?: string } | null | undefined): string {
  return entity?.type ? collectionOf(entity.type) : "";
}

interface MemoCache {
  uiBuckets?: BucketedView;
  stats?: ResolvedStats;
  granted?: BestowedAbility[];
  ownedIds?: Set<string>;
  prereqs?: PrereqReport;
  wealth?: WealthReport;
  spend?: BPLedger;
}

export class CharacterGraphModel implements CharacterGraph {
  private _memo: MemoCache = {};

  constructor(
    public character: CharacterState,
    public items: GraphItem[],
    public characterLevel: number,
    public classes: { name: string; level: number }[],
  ) {}

  get uiBuckets(): BucketedView {
    return this.memo("uiBuckets", () => buildBucketedView(this));
  }

  get stats(): ResolvedStats {
    return this.memo("stats", () => computeStats(this));
  }

  public get _bestowedAbilitiesList(): BestowedAbility[] {
    return this.memo("granted", () => computeBestowedAbilitiesList(this));
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

  private memo<K extends keyof MemoCache>(key: K, compute: () => NonNullable<MemoCache[K]>): NonNullable<MemoCache[K]> {
    if (this._memo[key] === undefined) {
      this._memo[key] = compute();
    }
    return this._memo[key] as NonNullable<MemoCache[K]>;
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
export const idName = (id: string) => id.split(":")[1] || id;
