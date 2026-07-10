# Type-clean + Character-V2 migration — handoff

**North star:** the whole app runs on **CharacterStateV2**, is **fully typed**, with
**zero `any`, zero casts, zero V1** — and `tsc --noEmit` runs clean **as a CI gate**.

**Standing rule (important):** where code reads a V1-flat field, **delete the read
(migrate it to V2)** — do **not** type the V1 shape. _Sooner remove V1 than make it
pass._ Rip up whatever's needed; nothing about the current shapes is sacred.

---

## Where things stand (as of this handoff)

- `tsc --noEmit`: **183 errors** (down from 208). All pre-existing untyped-TS debt;
  the migration work has only _reduced_ it, never added.
- `as any` casts in `src/engine`: **~29** (down from 43).
- **169 tests green**, lint clean, `check:data` green. Every merged step stayed green.
- `tsc` is **not yet a CI gate** (that's the finish line). Node-24 CI is in place (#154).

### Already merged (the foundation)

- **#153** — completed core types: `BaseEntity` (id, baseName, parameter, tier, tiers,
  parentClass, statMods, …) + `CharacterStateV2` (real fields; `classes` is
  `{name,level}[]`); extracted `v1ToV2()` boundary; deleted graph casts.
- **#155** — **singular `entity.type` discriminator** (`'perk'` not `'perks'`). The
  plural survives only as the id/key namespace (`perks:Foo`), which is an opaque
  handle: **build keys via `collectionOf(type)`, never parse an id for meaning.**
  Read `.type`/`.name` off the object.
- **#156** — typed + slimmed the **BP ledger** (`graph.spend: BPLedger`, entries
  `BPLedgerEntry`); exported `BuildReport = ReturnType<typeof validate>`.
- **#157** — engine helpers `hasWorship` / `ownsDivineSubstitution` /
  `activePowerBenefits` now read V2 buckets, not V1 flat fields.

---

## The core problem still to solve: V1 is still the _native_ shape

The character is born, edited, and stored as **V1-flat** (parallel arrays of name
strings: `purchasedSkills: string[]`, `classPowers: string[]`, `ranks[field][i]`,
`effectiveBP[field][i]`). The engine converts V1→V2 at `resolveCharacterGraph` via
`v1ToV2()`. So V2 only lives _inside_ the engine.

The remaining errors/casts nearly all trace to this: files that read/write the V1
flat shape. **The fix is the inversion — make V2 the native shape — not typing V1.**

Key V1 machinery to retire:

- `EMPTY_CHARACTER` (src/engine/character-state.ts) — V1-flat template.
- `loadArchetype` — emits V1-flat.
- **The handlers** (src/hooks/handlers/useCoreHandlers.js + siblings) — write V1:
  `c[field] = [...names]` keyed by V1 collection name, with parallel
  `ranks[field]` / `effectiveBP[field]` arrays, remove-by-index.
- `usePickers.js` field config (`field: "purchasedSkills"` etc.).
- `sheet.ts` — has a **V1-reconstruction shim** (lines ~84–98) that rebuilds V1 from
  V2 just to format; the formatter + importer then read V1.
- `v1ToV2()` + `V1CharacterInput` (src/engine/graph.ts, types.ts) — the bridge; the
  _goal is to delete these entirely_.
- **Every test builds V1 char literals** (`{ classLevels, purchasedSkills: [...] }`).
  Tests do NOT exercise the React handlers (⚠ the write path is unguarded).

---

## Recommended sequence (each step stays green)

The pieces are coupled — source shape, the reducers that mutate it, and the test
literals that assert on it flip together. Sequence to keep it verifiable:

1. **Extract handler reducers → pure functions + test them FIRST.** Pull each
   `setCharacter(c => …)` body in useCoreHandlers/etc. into a pure
   `(char, args) => char`. No behavior change, but now unit-testable. Add a
   reducer test suite (add skill → present + removable-by-id; ranks; dedupe).
   **This is the safety net; the write path has no coverage today.** Do it before
   touching behavior.
2. **`EMPTY_CHARACTER` → V2** and `loadArchetype` emits V2 (can run its existing
   output through the trusted `v1ToV2` to start).
3. **Flip the reducers to write V2** — push `CharacterChoice` into
   `character.skills/perks/powers/spells`; cost/rank **on the object**; remove **by
   id** (the UUID), not index; drop the parallel `ranks`/`effectiveBP` arrays.
   Guarded by step 1's tests.
4. **Migrate test char-literals to V2** (introduce a `makeChar()`/V2 builder helper;
   the ~7 `scripts/test/*.test.mjs` files + their line-27 "mirrors loadArchetype"
   pattern).
5. **Delete `v1ToV2` + `V1CharacterInput`** — `resolveCharacterGraph(character:
CharacterStateV2)` takes V2 directly.
6. **Delete the sheet.ts reconstruction shim**; point the formatter + importer at
   the V2 buckets / `report.owned`.
7. **Finish the type cleanup** (now trivial — most errors were V1 reads):
   - thread the model's remaining `any`s: `graph.stats` → a `ResolvedStats` type,
     `graph.prereqs` → a `PrereqReport` type (issues/notes entry shapes).
   - annotate remaining consumers with `BuildReport`.
   - clear residual `never`-typed inits (`const x = []` → typed) in slots.ts,
     recipe-solver.ts, etc.
8. **Add `tsc --noEmit` to CI** as a required gate (`.github/workflows/*.yml` — add a
   `type-check` job next to lint/test). This is the finish line — locks it at 0.

### Error hot-spots (where the work lands), current counts

```
49  src/engine/sheet.ts            (V1 shim + formatter/importer → migrate to V2)
39  src/engine/starting-choices.ts (V1 field reads/writes)
26  src/engine/validate/slots.ts   (mostly never-typed inits + V1 reads)
15  src/engine/validate.ts
15  src/engine/recipe-solver.ts    (never-typed collections)
13  src/engine/graph.ts
 9  src/engine/character-state.ts  (EMPTY_CHARACTER / loadArchetype)
 + smaller: prereqs, game-effects, lbp, sheet-schema, extractors
```

---

## Design invariants to preserve (hard-won this session)

- **Singular discriminator, plural id-namespace.** `entity.type === 'perk'`;
  ids/keys are `perks:Foo`, **built** with `collectionOf(type)`, **never parsed**.
- **Build keys, don't parse them.** No `id.slice(0, indexOf(':'))` /
  `.split(':')[0]` to _recover_ a type — read `.type`/`.name` off the object.
- **`node.param` is the structured parameter** (parsed once at node creation, #50) —
  don't re-scrape params from display names.
- **One resolution site.** `CharacterGraphModel` is the sole thing that resolves
  "what does the character own." `classifyOwnedItems` is a thin projection of
  `graph.uiBuckets` — don't reintroduce a parallel resolver.
- **Lazy memoized getters** on the model keep each computed field a pure function of
  the resolved object (liftable). Keep that.
- **Grants carry params; cap/dedupe is `reusable = cap > |paramDomain|`** — see
  `DEDUPE_IDENTITY_PLAN.md`. Over-cap _purchase_ = validation error; over-cap
  _grant_ = free BP.

## Environment notes

- Work in an **isolated git worktree** (e.g. `.claude/worktrees/…`), NOT the shared
  main checkout — a branch switch in the shared dir hijacked this session's work
  once (recovered via reflog, nothing lost, but avoid it).
- There's a stray untracked `PR149_REVIEW.md` in the repo root — deletable.
