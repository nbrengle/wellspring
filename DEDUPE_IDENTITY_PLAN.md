# Dedupe / Identity Model — Plan (on top of PR #145)

**Status:** spec / contract. Not yet implemented.
**Builds on:** PR #145 (`feature/ts-migration`, Phase 3 engine→graph). This plan assumes
#145's surviving core: the effect-extractor pipeline (`EFFECT_EXTRACTORS`, `GRANT_SOURCE`,
`WEALTH`, `FLAW_AWARD`), the single resolve pass that normalizes all character fields, and
grant-routing-by-entity-type. It **replaces** #145's dedupe core (the `bareKey()` string-
matching block in `graph.ts`, lines ~176–206) and the read-time `classifyOwnedItems` flow.

This is the contract the engine must satisfy. It exists so we stop re-fucking dedupe.

---

## 0. Why this plan exists

Dedupe has been wrong repeatedly (Lessons-from-Scars not stacking, Arcane Secrets mis-routed,
Weapon Spec false-split, Lore false-merged). Every failure traces to one thing: **identity was
guessed from name strings** (`cleanItemName` + regex param extraction + lowercase) instead of
read from structured facts. #145 keeps doing this via `bareKey()`. This plan makes identity
mechanical and, crucially, **derivable** — not a hand-maintained allowlist that rots on re-parse.

---

## 1. The core insight (the thing that makes it buildable)

For an entity that can be taken more than once and takes a parameter, the only hard question is:

> **Can the same parameter value be reused across ranks, or must each rank pick a distinct one?**

That question is **not authored** — it is **derived by arithmetic**:

```
reusable = cap > |paramDomain|
```

- If the cap exceeds the number of legal parameter values, distinct-per-rank is impossible →
  reuse is forced (param is *payload*; count to cap).
- If there are always enough distinct values to cover the cap, each rank takes a fresh value →
  param is *identity* (a repeat of the same value is redundant).

### Validation against all 13 parameterized multi-rank entities

| Entity | cap | param domain | \|domain\| | cap>\|domain\| → reusable | ruling |
|---|---|---|---|---|---|
| Studied Process | 3 | Alchemy, Enchanting, Tinkering | 3 | no | distinct (per-param) — "once for each Craft" ✓ |
| Batch Process | 4 | Alchemy, Ritual, Enchanting, Tinkering | 4 | no | distinct (per-param) ✓ |
| Extended Capacity ×3 | 4/4/3 | Sphere = {Arcane, Divine} | 2 | yes | reusable (stacking) ✓ |
| Lore | ∞ | areas (open-ended) | ∞ | no | distinct (per-param) ✓ |
| Additional Cantrip | 4 | class cantrip list | large | no | distinct (per-param) ✓ |
| Chronic Hobbyist | 3 | professions | large | no | distinct (per-param) ✓ |
| Accent Substantiation | 8 | substitution list | ≥8 | no | distinct (per-param) ✓ |
| Elemental Affinity | 2 | Flame/Ice/Lightning/Acid | 4 | no | distinct — "one at a time", 2nd is an alt ✓ |
| Extensive Combat Training ×2 | 2 | non-casting class powers | large | no | distinct (per-param) ✓ |
| Extensive Training | 2 | non-casting utility powers | large | no | distinct (per-param) ✓ |

`reusable = cap > |domain|` reproduces **every** ruling, including Elemental Affinity (which a
prose reading first mis-classified). The rule is the model, not a heuristic.

---

## 2. The identity model

Every owned/granted item resolves to an **identity key** and a **cap**:

```
cap        = normalizeCap(entity)            // see §3 — unify ranks + maxRanks, recover (N)
hasParam   = entity has a parameter
reusable   = hasParam && (cap > paramDomainSize(entity))   // §4

identityKey =
    !hasParam              → baseName
    hasParam &&  reusable  → baseName                    // param is payload, not identity
    hasParam && !reusable  → baseName + "|" + paramValue // param distinguishes

perKeyCap =
    !hasParam              → cap        // hold up to `cap` copies of the base
    reusable               → cap        // hold up to `cap` total, any param mix
    !reusable              → 1          // one per distinct param value
```

There is **no enum to author** and **no `paramIsIdentity` allowlist**. Identity falls out of
three facts: `cap`, `hasParam`, `paramDomainSize`. The first two exist in data today; the third
is the one parser addition (§4).

> Note: the 44 non-parameterized multi-rank entities (Quality Control, Thick Skin, etc.) need
> **no special handling** for identity — `identityKey = baseName`, `perKeyCap = cap`. Whether
> their per-rank effects escalate is an *effects/rendering* concern, orthogonal to identity.

---

## 3. Resolution rule (keep / refund — never delete)

Within each `identityKey`, takings are reconciled in one place:

```
keep the first `perKeyCap` takings of the key.
for every taking BEYOND perKeyCap:
    if it is a PURCHASE → VALIDATION ERROR  (the builder must block this upstream; you
                                             cannot spend BP into an over-cap state)
    if it is a GRANT    → drop the node, emit FREE_BP = its cost
grant + purchase share a key at cap:
    grant wins as "free"; the redundant PURCHASE refunds (FREE_BP = purchase cost)
```

This is the rulebook's **Redundant Skills** rule ("gain a skill/perk you already have → free BP
equal to its cost; gain a discount you already have → free BP equal to the discount"). Dedupe is
**never** a deletion; surplus converts to free BP. The purchase/grant asymmetry is the key: you
can't *buy* over cap, but a *grant* can push you over and is absorbed as free BP.

**Ordering must be deterministic:** grants reconcile against the owned/purchased set, so "already
have it" is well-defined and not order-of-iteration luck (the failure mode of #145's `bareKey`
pass). Pin precedence explicitly in the implementation.

---

## 4. Required data / parser work (the prerequisite)

This is the buildable, non-rotting part. It is the real content of task #50.

1. **Normalize cap to ONE field.** Today the cap is split:
   - flat skills/perks store it as `ranks` (`-`/null → 1, `N`, `"unlimited"`),
   - class powers store it as `maxRanks`,
   - and class-power `(N)` notation in the MegaDoc is sometimes **dropped** or **misread as
     `cost`** in grant-list context (`scripts/parse-megadoc.js` ~line 278 vs ~426).
   The parser must emit a single normalized cap field for every entity, recovering class-power
   `(N)`. (Counts: 57 entities have cap>1 once both fields are read; only 3 used `maxRanks` and
   were invisible to every `ranks`-only check.)

2. **Extract parameter DOMAIN, not just the label.** Today `parameter` is a label ("Sphere",
   "Area of Lore"). We need the **legal value set's size** (or an ∞ flag):
   - "Choose one Craft: Alchemy, Enchanting, or Tinkering" → enumerate → size 3.
   - "Sphere" → resolve against the known Sphere set → size 2 (Arcane, Divine). *(Confirm: are
     there more spheres? If elemental spheres exist, this number changes — verify.)*
   - "list of suggested areas of study" / "any element they desire" → open-ended → ∞.
   The "Choose one X: a, b, or c" pattern is regular and parser-extractable, same class of work
   the parser already does for tiers/costs.

3. **Derive `reusable = cap > paramDomainSize`** at build/resolve time. No human ruling.

### Drift guard (makes completeness the build's job, not ours)

We proved by repeated undercounting (5 → 7 → 13 → 57) that the candidate set **cannot be
hand-enumerated reliably**. So the guard, not a list, is the safety net:

- Enumerate **every** `cap>1` entity across the resolved graph (all files, both cap fields).
- For each that is parameterized, require a resolvable `paramDomainSize` (a number or explicit ∞).
- **Fail the build** if any parameterized cap>1 entity has an undetermined domain — so a newly
  added or newly discovered one stops the build instead of silently defaulting wrong.
- Bind this to the existing `npm run check:data` drift guard.

Until a domain is captured, the safe default is `paramDomainSize = ∞` ⇒ `reusable = false`
⇒ per-param identity (the visible-failure-mode default: at worst it over-refunds a legit repeat,
never silently allows an illegal duplicate).

---

## 5. Buckets are a SEPARATE pass (physical, not semantic)

Dedupe decides *what exists*; bucketing decides *where it renders*. Keep them distinct:

- **Dedupe** (§2–3): identity + cap + free-BP. Mechanical/semantic. Inputs: `cap`, `param`,
  `paramDomainSize`.
- **Bucket** (separate): place each surviving item into `{classes, innatePowers, basicPowers,
  skills, perks, classPowers, ...}` by **entity type + source** (granted-innate vs purchased).
  This is #145's grant-routing-by-type, already ~80% right — it becomes the bucket-placement
  pass. It does **not** re-derive identity (the bug in #145's `classifyOwnedItems`).

Run dedupe, then bucket the survivors. The resolved **read layer** is the pre-sorted bucketed
record the entire UI reads — no `items[]`, no read-time `classifyOwnedItems`, no `bareKey()`.
The user's raw choices are transient input to the single `resolve()`; nothing is persisted.

---

## 6. Work breakdown (ordered by dependency)

1. **Parser: cap normalization** — unify `ranks`/`maxRanks`, recover class-power `(N)`,
   stop misreading `(N)` as cost in grant lists. (#50, prerequisite)
2. **Parser: parameter domain extraction** — enumerate "Choose one X: …" lists; resolve known
   sets (Sphere); flag open-ended (∞). Emit `paramDomainSize`.
3. **Drift guard** — fail build on any parameterized cap>1 entity with undetermined domain.
4. **Dedupe resolver** — replace #145's `bareKey` block with identityKey + perKeyCap + the
   keep/refund rule. Reads normalized cap + `paramDomainSize`. Deterministic grant/purchase order.
5. **Bucket placement** — the read-layer pass (extends #145's grant-by-type routing).
   Independent of 2–4; can proceed in parallel.
6. **Validation** — block over-cap *purchases* at buy time (UI/validator).

Steps 1–2 are pure data/parser (no engine collision). 4–5 are the engine lane.

---

## Appendix A — canonical cases the implementation must pass

| Case | Setup | Expected |
|---|---|---|
| Weapon Spec (cap 1, param) | own (Sword); granted (Axe) | keep Sword; Axe → FREE_BP; param Axe discarded |
| Lore (∞, distinct) | (Arcane), (Religion), 2nd (Arcane) | keep Arcane+Religion; 2nd Arcane → FREE_BP |
| Extended Capacity (cap 4, reusable) | 4× Arcane | all 4 kept |
| Extended Capacity over cap | 5× Arcane | keep 4; 5th purchase = ERROR / 5th grant = FREE_BP |
| Studied Process (cap 3 = domain 3) | Alchemy, Enchanting, Tinkering | all 3 kept; 2nd Alchemy → FREE_BP |
| Scavenge II (cap 1, no param) | ×2 | keep 1; 2nd → FREE_BP |
| Grant-on-purchase (Lessons from Scars) | buy Lore (Arcane), then granted | one node, marked free-via-grant; purchase BP refunds |
| Arcane Secrets grant | power grants a spell | routes to Known Spells bucket, not classPowers |

---

## Appendix B — known gaps the model does NOT yet handle ("it gets worse at scale")

Evidence: the Arcanorum source classes (Assassin, Advanced Cleric) — the kind of
content Wellspring will keep absorbing. These break assumptions in the current
`param-domain.ts` derivation and must be handled before it scales.

1. **Inline `[A/B/C]` pools live in the Call string, not a "Choose one X:" sentence.**
   e.g. Garrote — Call `"Silence by [Agony/Force]"`; Bonds of Protection — Call
   `"Grant Protect vs. [Weapons/Materia/Verbal]"`. The `INLINE_LIST` regex only
   matches `": a, b, or c"` prose, so these are missed → the guard flags them as
   `prose-param`. Derivation must also read `[A/B/C]` brackets in Call/effect text.

2. **Runtime call placeholders are NOT build-time identity params — must be ignored.**
   e.g. `"[Name or Description] ..."`, `"Faithcast [Spell or Cantrip Name]"`,
   `"Subtle [X] by Ingested Poison"`. These are chosen each time the power is *used*,
   not at character build, so they have nothing to do with dedupe identity. **Danger:**
   a parser that scrapes every `[...]` as an identity param would corrupt dedupe (e.g.
   treat `Garrote (2)`'s two ranks as distinguished by `[Agony/Force]` when they're
   plain COUNTED). The signal: heading-bracket / "chosen at creation" = identity param;
   `[...]` inside a Call/Effect line = runtime, ignore.

3. **`(N)` rank notation is pervasive and inline in power names** (Crimson Fever (2),
   Final Stroke (4), …). Already handled by the #147 cap unification — confirmed it
   generalizes — but worth noting the volume only grows.

Takeaway: the build guard (`unresolvedParamDomains`) is what keeps this safe as
content scales — new abilities that the derivation can't classify surface loudly
rather than silently defaulting. The fix path is to teach the derivation the two
new signals above (Call-string `[A/B/C]` pools; ignore runtime `[...]`), shrinking
the `DECLARED` fallback rather than growing it.
