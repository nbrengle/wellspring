# Design Proposal: A general "builder effect" system (#213)

## Status

Proposal for review — **not implemented**. Nate asked for a design, not a framework built solo.

## Problem

Several rules concepts are matched by hardcoded name/regex smeared across engine + UI, instead
of being data-driven. #213 lists them; the honest split is that they are **two different kinds**
of thing, and only one is a simple data-field fix:

### (A) Already data-driven — no work needed

An entity's **own** recurring/first-event/manse wealth is expressed as a `wealthIncome` field
(`BaseEntity.wealthIncome`) and read generically by `extractWealth` (`extractors.ts:33`). Income
(`{n:10, kind:"recurring"}`), Manse (`{n:8, kind:"manse"}`), Inheritance (`{n:100, kind:"firstEvent"}`)
all flow through it. ✅ This is the pattern we want everywhere.

### (B) The hard cases — effects that read WHOLE-CHARACTER state

Two concepts can't be a static field on one entity because their effect depends on **what else the
character owns / has chosen**:

1. **Tax Evasion** (`extractTaxEvasion`, `extractors.ts:127`) — "+3 Wealth per Profession rank, +2 if
   you own Manse, +2 if you own Income." The +2s are _conditional on owning Tax Evasion_, so they can't
   live as `wealthIncome` on Manse/Income (those already have their own base income; this is an extra
   bonus that only exists when Tax Evasion is present). Today: a name-equality `ownsPerk("Manse")` +
   a `/^\bProfession\b/` regex over the character's buckets.

2. **Worship** (`hasWorship`, `validate.ts:136`; `reducers.ts:103`; `useIdentityHandlers.js:33,74`;
   `parameter-suggestions.js:45`) — owning the Worship skill _gates a builder capability_: it unlocks
   following a devotion and buying domain powers. This is not an Entity-local effect at all; it changes
   what the **builder** allows. Today: `/^worship\b/i` magic string smeared across 4 files in both
   engine and UI.

These are **builder effects**: rules that change the build/validation process itself (gates, cross-entity
aggregates, unlocks) rather than adding a stat/cost/grant to a single resolved node.

## Proposal

Introduce a small, declarative **builder-effect** vocabulary carried on the entity (data-driven, parsed),
plus one interpreter per effect kind. The goal: _no rules concept is identified by name-equality_; the
engine reacts to a typed effect, and the UI reads one derived predicate.

### 1. Entity-local effects (already exist) stay as fields

`wealthIncome`, `statMods`, `levelDiscounts`, `slotBestows`, `bestows` — already the model. Keep going.

### 2. New: `builderEffects` — effects that read character state

A typed, discriminated array on the entity, e.g.:

```ts
type BuilderEffect =
  // Unlocks a builder capability while this entity is owned.
  | { kind: "gate"; capability: "follow-devotion" | "buy-domain-powers" }
  // A wealth bonus computed from a count of OTHER owned entities.
  | { kind: "wealthPerOwned"; amount: number; match: EntityMatch } // e.g. +3 × Profession ranks
  // A flat wealth bonus conditional on owning some other entity.
  | { kind: "wealthIfOwned"; amount: number; match: EntityMatch }; // e.g. +2 if Manse owned

// A structured predicate over entities — NEVER a name regex at a call site.
type EntityMatch =
  | { by: "id"; id: string } // exact entity
  | { by: "category"; category: string } // e.g. all Profession-category skills
  | { by: "baseName"; baseName: string };
```

Tax Evasion's data then becomes (parsed from its rules text, or authored):

```json
"builderEffects": [
  { "kind": "wealthPerOwned", "amount": 3, "match": { "by": "baseName", "baseName": "Profession" } },
  { "kind": "wealthIfOwned",  "amount": 2, "match": { "by": "id", "id": "perks:Manse" } },
  { "kind": "wealthIfOwned",  "amount": 2, "match": { "by": "id", "id": "perks:Income" } }
]
```

Worship's data:

```json
"builderEffects": [
  { "kind": "gate", "capability": "follow-devotion" },
  { "kind": "gate", "capability": "buy-domain-powers" }
]
```

### 3. Interpreters — one place each

- **Wealth aggregate**: a single extractor walks `builderEffects` of kind `wealth*`, resolves `match`
  against the character's owned entities (via the existing owned-set / graph), and emits `WEALTH` effects.
  Replaces `extractTaxEvasion`'s bespoke counting. New concepts of the same shape need only data.
- **Gate**: one derived predicate `capabilities(character): Set<Capability>` computed from owned entities'
  `gate` effects. `hasWorship` becomes `capabilities(c).has("follow-devotion")`; the UI imports the SAME
  predicate. The `/^worship\b/` string vanishes from all 4 sites.
  - The UI's entityId-rewrite in `useIdentityHandlers` (Worship → "Worship (Devotion)") is a _parameter_
    concern, not a gate — it should ride the existing param-first-class-storage path (`setParameter`),
    not a Worship-specific regex. Fold it in when that handler is typed (#178/#179).

### 4. Parser

`wealthIncome` is already parsed. `builderEffects` would be authored/extracted the same way — ideally the
parser recognizes the Tax Evasion / Worship prose patterns, but hand-authoring in the JSON is an acceptable
first step (like `allergens`). The engine just reads the field.

## Why not just do it now

- The `EntityMatch` vocabulary + gate-capability enum is a small API that other rules will depend on;
  worth one review pass before it calcifies.
- Touches the parser (new field), the engine (2 interpreters), and the UI (the shared gate predicate) —
  a genuine cross-layer contract, the kind Nate wants eyes on.

## Incremental landing plan (once approved)

1. Add `builderEffects` type + `capabilities()` predicate; migrate Worship's 4 sites to it (no parser
   change — author Worship's gate effects by hand). Deletes the `/^worship\b/` smear.
2. Add the wealth-aggregate interpreter; move Tax Evasion to `builderEffects` data; delete
   `extractTaxEvasion`'s bespoke name-matching.
3. (Optional) teach the parser to emit `builderEffects` for these prose patterns.

## Definition of done (#213), reframed

- No `/^worship/`-style magic-string matching of rules concepts across layers → **gate predicate**.
- Tax Evasion/Manse/Income wealth driven by data/effects, not name equality → **wealth interpreter** over
  `builderEffects`; Manse/Income base income already via `wealthIncome`.
