// Builder — single-page character creator. State lives in the URL so any
// character is shareable / bookmarkable. Three panes side-by-side on desktop:
// identity (left), build sheet (center), detail (right). On narrow screens
// the detail pane becomes an overlay.
//
// Powers are built through SLOTS, not flat lists: a class grants N positions per
// tier (2 Utility, 2 Basic, …). Each slot is a fixed row — filled rows show the
// chosen power, empty rows invite a pick. Picking happens in the detail pane,
// which doubles as the entity inspector so you can follow a power's links
// (prereqs / unlocks / mentions) while deciding.

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ARCHETYPES, REFS, lookupEntity, LEVEL_TABLE,
  eligiblePowers,
} from "./data/index.js";
import { validate, characterLevel, prereqStatus } from "./data/validate.js";
import "./Builder.css";

// ─── CHARACTER STATE ────────────────────────────────────────────────────────
// A character is a flat object that mirrors the archetype shape so loading
// from an archetype is a direct copy. Anything missing means "no choice yet".

const EMPTY_CHARACTER = {
  name: "",
  archetypeName: null,       // which archetype this was loaded from (for the badge)
  classLevels: null,         // "Cleric 4" — single class for now
  specialization: null,      // "Mystic" / "Crafter" / "Artificer" — only for Artisan
  lineage: null,             // "Human" / "Aewen" / ...
  sublineage: null,
  devotion: null,            // for clerics: "The Mother" / "Senri" / ...
  lifePoints: null,
  armorPoints: null,
  spikes: null,
  startingSkills: [],
  purchasedSkills: [],
  purchasedPerks: [],
  flaws: [],
  innatePowers: [], utilityPowers: [], basicPowers: [],
  advancedPowers: [], veteranPowers: [], classPowers: [],
  rightHandPowers: [], cantrips: [],
  noviceSpells: [], adeptSpells: [], greaterSpells: [], bookSpells: [],
  domainPowers: [], formPowers: [],
};

// Load an archetype into character state — straight copy of the relevant
// fields, plus the archetypeName badge so the UI can show "Based on X".
function loadArchetype(archetype) {
  const c = { ...EMPTY_CHARACTER, archetypeName: archetype.name };
  for (const k of Object.keys(EMPTY_CHARACTER)) {
    if (k === "archetypeName") continue;
    if (archetype[k] !== undefined) c[k] = archetype[k];
  }
  // Preserve the parser's grant / effectiveBP sidecars so the validator can
  // honor them; they aren't part of EMPTY_CHARACTER but ride along untouched.
  if (archetype.grants) c.grants = archetype.grants;
  if (archetype.effectiveBP) c.effectiveBP = archetype.effectiveBP;
  return c;
}

// ─── URL STATE ──────────────────────────────────────────────────────────────
// Character is base64-encoded JSON in the URL hash. Hash (not query) so the
// server never sees it and reloads stay client-side. encodeURIComponent
// handles slashes / quotes in entity names.

function readFromHash() {
  const h = window.location.hash.slice(1);
  if (!h) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(h))));
  } catch {
    return null;
  }
}

function writeToHash(character) {
  // Only write if there's meaningful state — otherwise leave the URL clean.
  if (!character.archetypeName && !character.name && character.startingSkills.length === 0) {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    return;
  }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(character))));
  window.history.replaceState(null, "", `${window.location.pathname}#${encoded}`);
}

// ─── SLOT MODEL ──────────────────────────────────────────────────────────────
// Map a validator slot category to the character field that stores its picks and
// a human label. Order controls how slot blocks appear in the build sheet.
const SLOT_FIELD = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
  cantrips: "cantrips",
  // spellsKnown picks land in noviceSpells for now (level-4 casters only learn
  // novice); higher tiers are out of scope for this pass.
  spellsKnown: "noviceSpells",
};

// ─── UI PRIMITIVES ──────────────────────────────────────────────────────────

function Tag({ label, tone = "amber" }) {
  return <span className={`b-tag b-tag-${tone}`}>{label}</span>;
}

// ─── IDENTITY RAIL ───────────────────────────────────────────────────────────
// Shows class/lineage/devotion as cards, stats as a strip, plus the live BP
// budget meter so spend is always visible.
function IdentityRail({ character, report, onClickField, onRestart }) {
  const cls = character.classLevels?.split(" ")[0] || null;
  const fields = [
    { key: "class", icon: "⚔", label: "Class", value: cls, sub: character.specialization },
    { key: "lineage", icon: "🧬", label: "Lineage", value: character.lineage, sub: character.sublineage },
    { key: "devotion", icon: "🌟", label: "Devotion", value: character.devotion, sub: null },
  ];
  return (
    <aside className="b-rail b-rail-left">
      <header className="b-rail-header">
        <h2 className="b-rail-title">Identity</h2>
        {character.archetypeName && (
          <p className="b-rail-sub">Based on <em>{character.archetypeName}</em></p>
        )}
      </header>

      {fields.map((f) => (
        <button key={f.key} className={`b-id-card ${f.value ? "is-set" : "is-empty"}`} onClick={() => onClickField(f.key)}>
          <span className="b-id-icon">{f.icon}</span>
          <span className="b-id-body">
            <span className="b-id-label">{f.label}</span>
            <span className="b-id-value">{f.value || <em>not set</em>}</span>
            {f.sub && <span className="b-id-sub">{f.sub}</span>}
          </span>
        </button>
      ))}

      <div className="b-stat-strip">
        <Stat label="LP" value={character.lifePoints ?? "—"} />
        <Stat label="Spikes" value={character.spikes ?? "—"} />
        <Stat label="AP" value={character.armorPoints?.replace(/\s*\(.+\)/, "") ?? "—"} />
      </div>

      {report.spellSlots && <SpellSlotStrip slots={report.spellSlots} />}

      {character.archetypeName && <BudgetMeter report={report} />}

      <button className="b-restart" onClick={onRestart}>
        <span className="b-restart-icon">↺</span> Start over
      </button>
    </aside>
  );
}

function Stat({ label, value }) {
  return (
    <div className="b-stat">
      <span className="b-stat-val">{value}</span>
      <span className="b-stat-label">{label}</span>
    </div>
  );
}

// Caster-only spell-slot capacity per tier (Novice / Adept / Greater). Read-only
// — slots are per-rest capacity, not build-time choices. Tiers with 0 slots are
// dimmed rather than hidden so the progression is legible.
function SpellSlotStrip({ slots }) {
  const tiers = [
    { key: "novice", label: "Nov" },
    { key: "adept", label: "Adp" },
    { key: "greater", label: "Grt" },
  ];
  return (
    <div className="b-spellslots">
      <span className="b-spellslots-label">Spell Slots</span>
      <div className="b-spellslots-row">
        {tiers.map((t) => (
          <div key={t.key} className={`b-spellslot ${slots[t.key] ? "" : "is-zero"}`}>
            <span className="b-spellslot-val">{slots[t.key]}</span>
            <span className="b-spellslot-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Live BP meter: a bar that fills with spend and turns red when over budget.
function BudgetMeter({ report }) {
  const { spend, budget, remaining, overBudget } = report;
  const pct = budget ? Math.min(100, (spend.net / budget) * 100) : 0;
  return (
    <div className={`b-budget ${overBudget ? "is-over" : ""}`}>
      <div className="b-budget-head">
        <span className="b-budget-label">Build Points</span>
        <span className="b-budget-nums">
          <strong>{spend.net}</strong> / {budget}
          {spend.awarded > 0 && <span className="b-budget-flaws"> (+{spend.awarded} from flaws)</span>}
        </span>
      </div>
      <div className="b-budget-bar"><div className="b-budget-fill" style={{ width: `${pct}%` }} /></div>
      <p className="b-budget-foot">
        {overBudget
          ? `${-remaining} BP over budget`
          : `${remaining} BP remaining`}
      </p>
    </div>
  );
}

// ─── BUILD SHEET ─────────────────────────────────────────────────────────────

function BuildSheet({ character, report, view, onPickArchetype, onInspect, onOpenSlot }) {
  if (!character.archetypeName) {
    return <ArchetypePicker onPick={onPickArchetype} />;
  }
  const isFocused = (item, field) =>
    view?.mode === "inspect" && view.item === item && view.field === field;
  const activeSlot = (category, index) =>
    view?.mode === "pick" && view.category === category && view.index === index;

  return (
    <main className="b-sheet">
      <header className="b-sheet-header">
        <h1 className="b-sheet-title">{character.archetypeName}</h1>
        <p className="b-sheet-tagline">{ARCHETYPES.find((a) => a.name === character.archetypeName)?.tagline}</p>
      </header>

      <Section title="Skills" tone="amber">
        <ItemGrid items={[...character.startingSkills, ...character.purchasedSkills]} field="purchasedSkills"
                 onClick={onInspect} isFocused={isFocused} resolveType="skills" report={report} />
      </Section>

      <Section title="Perks" tone="teal">
        <ItemGrid items={character.purchasedPerks} field="purchasedPerks"
                 onClick={onInspect} isFocused={isFocused} resolveType="perks" report={report} />
      </Section>

      {report.slots.length > 0 && (
        <Section title="Powers" tone="purple">
          {report.slots.map((slot) => (
            <SlotBlock key={slot.category} slot={slot} character={character}
                       onInspect={onInspect} onOpenSlot={onOpenSlot}
                       isFocused={isFocused} activeSlot={activeSlot} />
          ))}
        </Section>
      )}

      <Section title="Flaws" tone="red">
        <ItemGrid items={character.flaws} field="flaws"
                 onClick={onInspect} isFocused={isFocused} resolveType="flaws" report={report} />
      </Section>
    </main>
  );
}

function Section({ title, tone = "amber", children }) {
  return (
    <section className="b-section">
      <h2 className={`b-section-title b-section-${tone}`}>{title}</h2>
      <div className="b-section-body">{children}</div>
    </section>
  );
}

// A tier's slots as fixed rows: `allowed` positions, filled by the character's
// picks in order, the rest shown as empty "choose" rows. The header shows
// used/allowed and goes green when exactly filled, red when over.
function SlotBlock({ slot, character, onInspect, onOpenSlot, isFocused, activeSlot }) {
  const field = SLOT_FIELD[slot.category];
  const picks = character[field] || [];
  // Render max(allowed, used) rows so over-cap picks are still visible/removable.
  const rowCount = Math.max(slot.allowed, picks.length);
  const rows = Array.from({ length: rowCount }, (_, i) => picks[i] ?? null);

  const state = slot.over ? "is-over" : slot.used === slot.allowed && slot.allowed > 0 ? "is-full" : "";

  return (
    <div className={`b-slot-block ${state}`}>
      <div className="b-slot-head">
        <h3 className="b-slot-label">{slot.label}</h3>
        <span className="b-slot-count">{slot.used} / {slot.allowed}</span>
      </div>
      <ol className="b-slot-rows">
        {rows.map((pick, i) => {
          const over = i >= slot.allowed;
          if (pick) {
            return (
              <li key={i} className={`b-slot-row is-filled ${over ? "is-over" : ""} ${isFocused(pick, field) ? "is-focused" : ""}`}>
                <span className="b-slot-num">{i + 1}</span>
                <button className="b-slot-pick" onClick={() => onInspect(pick, field, "powers")}>{pick}</button>
                <button className="b-slot-action" title="Swap" onClick={() => onOpenSlot(slot.category, i)}>✎</button>
                <button className="b-slot-action" title="Clear" onClick={() => onOpenSlot(slot.category, i, true)}>✕</button>
              </li>
            );
          }
          return (
            <li key={i} className={`b-slot-row is-empty ${activeSlot(slot.category, i) ? "is-active" : ""}`}>
              <span className="b-slot-num">{i + 1}</span>
              <button className="b-slot-add" onClick={() => onOpenSlot(slot.category, i)}>
                + choose a {slot.label} power
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Render a list of item names as clickable chips. Annotates each with its
// effective BP cost / grant state from the report when available.
function ItemGrid({ items, field, onClick, isFocused, resolveType, report }) {
  if (!items || items.length === 0) {
    return <p className="b-empty">none</p>;
  }
  return (
    <ul className="b-item-grid">
      {items.map((item, i) => {
        const cost = report?.spend.byItem[`${field}:${item}`];
        return (
          <li key={`${field}-${i}-${item}`}>
            <button
              className={`b-item ${isFocused(item, field) ? "is-focused" : ""}`}
              onClick={() => onClick(item, field, resolveType)}
            >
              <span className="b-item-name">{item}</span>
              {cost && cost.base > 0 && (
                <span className={`b-item-bp ${cost.cost === 0 ? "is-free" : ""}`}>
                  {cost.cost === 0 ? "free" : `${cost.cost} BP`}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Initial archetype picker — shown when no character is loaded yet.
function ArchetypePicker({ onPick }) {
  const byClass = useMemo(() => {
    const map = new Map();
    for (const a of ARCHETYPES) {
      const cls = a.classLevels?.split(" ")[0] || "Other";
      if (!map.has(cls)) map.set(cls, []);
      map.get(cls).push(a);
    }
    return [...map.entries()];
  }, []);

  return (
    <main className="b-sheet">
      <header className="b-sheet-header">
        <h1 className="b-sheet-title">Pick a starting character</h1>
        <p className="b-sheet-tagline">
          New to Wellspring? Any of these gives you a complete, legal level-4 character.
          You can tweak anything afterward — or hit "Start blank" to build from scratch.
        </p>
      </header>

      {byClass.map(([cls, archetypes]) => (
        <section key={cls} className="b-section">
          <h2 className="b-section-title b-section-amber">{cls}</h2>
          <div className="b-archetype-grid">
            {archetypes.map((a) => (
              <button key={a.name} className="b-archetype-card" onClick={() => onPick(a)}>
                <span className="b-archetype-name">{a.name}</span>
                <span className="b-archetype-tagline">{a.tagline}</span>
                <span className="b-archetype-meta">
                  {a.specialization && <Tag label={a.specialization} tone="amber" />}
                  <span className="b-archetype-stats">LP {a.lifePoints} · Sp {a.spikes}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="b-section">
        <button className="b-blank-button" onClick={() => onPick({ ...EMPTY_CHARACTER, archetypeName: "Custom Build" })}>
          Start blank — I want full control
        </button>
      </section>
    </main>
  );
}

// ─── DETAIL PANE ─────────────────────────────────────────────────────────────
// Dual-mode right pane. INSPECT shows one entity with its description, facts, and
// followable links. PICK lists the eligible powers for a slot, each inspectable
// (with links) and choosable. Both modes share the entity-card renderer.

function DetailPane({ view, onInspect, onChoosePower, onBack, onClose }) {
  if (!view) {
    return (
      <aside className="b-rail b-rail-right">
        <div className="b-detail-empty">
          <p className="b-detail-hint">Click any item to see what it does, or click an empty power slot to choose one.</p>
        </div>
      </aside>
    );
  }
  return <EntityDetail view={view} onInspect={onInspect} onChoose={view.choosable ? onChoosePower : null}
                       onBack={onBack} onClose={onClose} />;
}

// ─── POWER PICKER OVERLAY ─────────────────────────────────────────────────────
// Full-screen two-pane picker. Left: searchable, grouped, prereq-aware candidate
// list. Right: the full reading view for the highlighted candidate (description,
// facts, followable sub-links) — following a link here is "just reading" via a
// local nav stack and never commits the pick. Choose commits.

function groupCandidates(candidates, character, groupBy) {
  // Decorate each candidate with prereq status, then bucket by the chosen axis.
  const decorated = candidates.map((p) => ({
    ...p,
    locked: !prereqStatus(character, `powers:${p.name}`).met,
  }));
  const buckets = new Map();
  const keyOf = (p) => {
    if (groupBy === "tier") {
      return ({ noviceSpells: "Novice", adeptSpells: "Adept", greaterSpells: "Greater",
                cantrips: "Cantrip" })[p.tierList] || "Other";
    }
    // refresh axis: normalize the noisy values into a few readable buckets.
    const r = (p.refresh || "").toLowerCase();
    if (!r || r === "none" || r === "passive") return "Passive";
    if (r.includes("long")) return "Long Rest";
    if (r.includes("short")) return "Short Rest";
    if (r.includes("immediate")) return "Immediate";
    return p.refresh;
  };
  for (const p of decorated) {
    const k = keyOf(p);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  return [...buckets.entries()];
}

function PickerOverlay({ slot, character, onChoose, onClose }) {
  const { category, index, label } = slot;
  const cls = character.classLevels?.split(" ")[0];
  const field = SLOT_FIELD[category];
  const candidates = useMemo(() => eligiblePowers(cls, category), [cls, category]);
  const taken = useMemo(() => new Set(character[field] || []), [character, field]);
  // Casters' spell pickers span tiers → group by tier; martials → by refresh.
  const groupBy = category === "spellsKnown" ? "tier" : "refresh";

  const [query, setQuery] = useState("");
  const [hideLocked, setHideLocked] = useState(false);
  const [selected, setSelected] = useState(candidates[0]?.name || null);
  // Local reading stack: when null we're reading the selected candidate; pushing
  // an entity id lets the user follow links without leaving the picker.
  const [readStack, setReadStack] = useState([]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = candidates;
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.desc || "").toLowerCase().includes(q));
    const grouped = groupCandidates(list, character, groupBy);
    if (hideLocked) return grouped.map(([g, ps]) => [g, ps.filter((p) => !p.locked)]).filter(([, ps]) => ps.length);
    return grouped;
  }, [candidates, query, hideLocked, character, groupBy]);

  // The entity currently shown in the reading pane: a followed link if the stack
  // is non-empty, otherwise the selected candidate resolved to its full entity.
  const readingEntity = useMemo(() => {
    if (readStack.length) return lookupEntity(readStack[readStack.length - 1]);
    return selected ? lookupEntity(`powers:${selected}`) : null;
  }, [readStack, selected]);

  const selectCandidate = (name) => { setSelected(name); setReadStack([]); };
  const followLink = (name, _field, type) => setReadStack((s) => [...s, `${type}:${name}`]);
  const readBack = () => setReadStack((s) => s.slice(0, -1));
  const isFollowing = readStack.length > 0;
  const selectedLocked = selected && !prereqStatus(character, `powers:${selected}`).met;

  // Esc closes; keep focus trap simple for this pass.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="b-overlay" onClick={onClose}>
      <div className="b-picker" onClick={(e) => e.stopPropagation()}>
        <header className="b-picker-head">
          <div>
            <h2 className="b-picker-title">Choose a {label} power</h2>
            <p className="b-picker-sub">slot {index + 1} · {candidates.length} options for {cls}</p>
          </div>
          <button className="b-picker-x" onClick={onClose}>×</button>
        </header>

        <div className="b-picker-cols">
          {/* LEFT: browse */}
          <div className="b-picker-browse">
            <div className="b-picker-controls">
              <input className="b-picker-search" type="text" placeholder="Search powers…"
                     value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
              <label className="b-picker-toggle">
                <input type="checkbox" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />
                Hide locked
              </label>
            </div>
            <div className="b-picker-groups">
              {groups.length === 0 && <p className="b-detail-missing">No powers match.</p>}
              {groups.map(([group, powers]) => (
                <div key={group} className="b-picker-group">
                  <h3 className="b-picker-group-label">{group}</h3>
                  <ul className="b-picker-names">
                    {powers.map((p) => {
                      const isTaken = taken.has(p.name);
                      return (
                        <li key={p.name}>
                          <button
                            className={`b-picker-row ${selected === p.name ? "is-selected" : ""} ${p.locked ? "is-locked" : ""} ${isTaken ? "is-taken" : ""}`}
                            onClick={() => selectCandidate(p.name)}>
                            <span className="b-picker-row-name">{p.name}</span>
                            {p.locked && <span className="b-picker-row-tag b-locked">locked</span>}
                            {isTaken && <span className="b-picker-row-tag b-chosen">chosen</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: read */}
          <div className="b-picker-read">
            {readingEntity ? (
              <>
                <header className="b-read-head">
                  {isFollowing && <button className="b-detail-back" onClick={readBack}>‹ back to {selected}</button>}
                  <h2 className="b-read-title">{readingEntity.name}</h2>
                  <p className="b-detail-type">{readingEntity.type}{readingEntity.tier ? ` · ${readingEntity.tier}` : ""}</p>
                </header>
                <div className="b-read-body">
                  <EntityBody entity={readingEntity} onInspect={followLink} />
                </div>
                {!isFollowing && (
                  <footer className="b-read-foot">
                    {selectedLocked && (
                      <p className="b-read-warn">Prereqs not met — you can still choose it, but the build won't be legal.</p>
                    )}
                    <button className="b-read-choose" disabled={taken.has(selected)}
                            onClick={() => onChoose(category, index, selected)}>
                      {taken.has(selected) ? "Already chosen" : `Choose ${selected}`}
                    </button>
                  </footer>
                )}
              </>
            ) : (
              <p className="b-detail-hint">Select a power on the left to read it.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// INSPECT mode: one entity, its facts, and followable links.
function EntityDetail({ view, onInspect, onChoose, onBack, onClose }) {
  const entity = useResolvedEntity(view.item, view.field, view.resolveType, view.archetypeName);
  const { item, resolveType } = view;

  return (
    <aside className="b-rail b-rail-right">
      <header className="b-detail-header">
        <button className="b-detail-close" onClick={onClose}>×</button>
        {onBack && <button className="b-detail-back" onClick={onBack}>‹ back</button>}
        <h2 className="b-detail-title">{entity?.name || item}</h2>
        <p className="b-detail-type">{entity?.type || resolveType}</p>
      </header>
      <div className="b-detail-body">
        <EntityBody entity={entity} onInspect={onInspect} />
        {onChoose && (
          <button className="b-detail-choose" onClick={() => onChoose(view.category, view.index, item)}>
            Choose this power
          </button>
        )}
      </div>
    </aside>
  );
}

// The shared reading body for an entity — description, facts, forward + back
// links. Used by both the rail inspector and the picker's reading pane so the
// content (and link-following) is identical everywhere.
function EntityBody({ entity, onInspect }) {
  if (!entity) {
    return <p className="b-detail-missing">No detail available — this item may be unresolved.</p>;
  }
  // Domains carry no prose in the source — only an accent and a powers list. Show
  // those as content instead of an empty "no description" so the link is useful.
  const domainPowers = entity.type === "domains" ? (entity.powers || []) : null;
  return (
    <>
      {entity.description
        ? <p className="b-detail-desc">{entity.description}</p>
        : domainPowers
          ? <p className="b-detail-desc">A divine domain{entity.accent ? ` (${entity.accent} accent)` : ""} granting {domainPowers.length} power{domainPowers.length === 1 ? "" : "s"}.</p>
          : <p className="b-detail-missing">No description on record.</p>}
      <DetailFacts entity={entity} />
      {domainPowers && domainPowers.length > 0 && (
        <LinkList title="Domain powers" tone="purple" onInspect={onInspect}
                  ids={domainPowers.map((p) => `powers:${p.name}`)} />
      )}
      <ForwardLinks entity={entity} onInspect={onInspect} />
      <BackLinks entity={entity} onInspect={onInspect} />
    </>
  );
}

// The labeled fact rows (cost / prereq / tier / call / effect), shown compactly.
function DetailFacts({ entity }) {
  if (!entity) return null;
  const facts = [];
  if (typeof entity.cost === "number") facts.push(["Cost", `${entity.cost} BP`]);
  if (entity.prereq && entity.prereq !== "None") facts.push(["Prereq", entity.prereq]);
  if (entity.prerequisites && entity.prerequisites !== "None") facts.push(["Prereq", entity.prerequisites]);
  if (entity.tier) facts.push(["Tier", entity.tier]);
  if (entity.refresh && entity.refresh !== "None") facts.push(["Refresh", entity.refresh]);
  if (entity.call && entity.call !== "None") facts.push(["Call", entity.call]);
  if (entity.effect) facts.push(["Effect", entity.effect]);
  if (facts.length === 0) return null;
  return (
    <dl className="b-facts">
      {facts.map(([k, v]) => (
        <div key={k} className="b-fact">
          <dt className="b-fact-label">{k}</dt>
          <dd className="b-fact-val">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// A clickable list of related entities. `ids` are entity ids; each resolves to a
// name and navigates the inspector when clicked. Unresolvable ids are skipped.
function LinkList({ title, ids, tone, onInspect }) {
  const links = useMemo(() => {
    const seen = new Set();
    return (ids || []).filter((id) => !seen.has(id) && seen.add(id))
      .map((id) => ({ id, ent: lookupEntity(id), type: id.slice(0, id.indexOf(":")), name: id.slice(id.indexOf(":") + 1) }))
      // Only show links that actually resolve, so none dead-end.
      .filter((l) => l.ent);
  }, [ids]);
  if (links.length === 0) return null;
  return (
    <div className="b-links">
      {title && <h3 className={`b-links-title b-links-${tone}`}>{title}</h3>}
      <ul className="b-links-list">
        {links.map((l) => (
          <li key={l.id}>
            <button className="b-link" onClick={() => onInspect(l.name, null, l.type)}>
              {l.name}
              <span className="b-link-type">{l.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Forward links: what this entity requires (prereqs), enables (unlocks), and
// references (mentions). These are the "follow the thread" links.
function ForwardLinks({ entity, onInspect }) {
  const pr = REFS.prereqs[entity.id];
  const prereqIds = pr ? [...(pr.skills || []), ...((pr.anyOf || []).flat())] : [];
  const unlockIds = REFS.unlocks[entity.id] || [];
  const mentionIds = REFS.mentions[entity.id] || [];
  return (
    <>
      <LinkList title="Requires" ids={prereqIds} tone="red" onInspect={onInspect} />
      <LinkList title="Unlocks" ids={unlockIds} tone="green" onInspect={onInspect} />
      <LinkList title="References" ids={mentionIds} tone="blue" onInspect={onInspect} />
    </>
  );
}

// Backlinks: archetypes that pick this entity (followable to nothing useful yet,
// so rendered as plain labels) and other entities that mention it.
function BackLinks({ entity, onInspect }) {
  const mb = REFS.mentionedBy[entity.id] || [];
  const archetypes = mb.filter((id) => id.startsWith("archetypes:"));
  const others = mb.filter((id) => !id.startsWith("archetypes:"));
  if (archetypes.length === 0 && others.length === 0) return null;
  return (
    <>
      {archetypes.length > 0 && (
        <div className="b-links">
          <h3 className="b-links-title b-links-dim">Picked by archetypes</h3>
          <ul className="b-links-list">
            {archetypes.map((id) => <li key={id} className="b-link-static">{id.slice("archetypes:".length)}</li>)}
          </ul>
        </div>
      )}
      {/* "Mentioned by" is low-signal, so it's collapsed behind a disclosure. */}
      {others.length > 0 && (
        <details className="b-mentioned">
          <summary className="b-mentioned-summary">Mentioned by {others.length} other{others.length > 1 ? "s" : ""}</summary>
          <LinkList ids={others} tone="dim" onInspect={onInspect} />
        </details>
      )}
    </>
  );
}

// Resolve the entity an item refers to, preferring the archetype's ref ids
// (index-aligned with the source list) and falling back to a name lookup.
function useResolvedEntity(item, field, resolveType, archetypeName) {
  return useMemo(() => {
    if (!item) return null;
    if (archetypeName && field) {
      const ids = REFS.archetypeRefs[`archetypes:${archetypeName}`]?.[field];
      const archetype = ARCHETYPES.find((a) => a.name === archetypeName);
      const src = archetype?.[field];
      if (ids && src) {
        const idx = src.indexOf(item);
        if (idx >= 0 && ids[idx]) return lookupEntity(ids[idx]);
      }
    }
    // Fallback: type-prefixed lookup. resolveType may be a concrete type
    // ("powers") or a field-ish hint; try it directly.
    return resolveType ? lookupEntity(`${resolveType}:${item}`) : null;
  }, [item, field, resolveType, archetypeName]);
}

// ─── ROOT COMPONENT ─────────────────────────────────────────────────────────

export default function Builder() {
  const [character, setCharacter] = useState(() => readFromHash() || EMPTY_CHARACTER);
  // view: null | {mode:'inspect', item, field, resolveType, archetypeName, category?, index?, choosable?}
  // The rail detail pane is inspect-only now; picking happens in a full-screen
  // overlay tracked separately by `picking`.
  const [view, setView] = useState(null);
  const [picking, setPicking] = useState(null); // null | { category, index, label }
  // Navigation history for the inspector so link-following has a back button.
  const [history, setHistory] = useState([]);

  const report = useMemo(() => validate(character), [character]);

  useEffect(() => { writeToHash(character); }, [character]);

  useEffect(() => {
    const onHashChange = () => {
      const next = readFromHash();
      if (next) setCharacter(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handlePickArchetype = useCallback((archetype) => {
    setCharacter(loadArchetype(archetype));
    setView(null); setHistory([]);
  }, []);

  // Inspect an entity. `slot` (optional) carries the pick context so the
  // inspector can offer "Choose this power". Pushes current view onto history.
  const handleInspect = useCallback((item, field, resolveType, slot = null) => {
    setView((cur) => {
      if (cur) setHistory((h) => [...h, cur]);
      return {
        mode: "inspect", item, field, resolveType,
        archetypeName: character.archetypeName,
        category: slot?.category, index: slot?.index, choosable: !!slot,
      };
    });
  }, [character.archetypeName]);

  // Open a slot for picking, or clear it when `clear` is set.
  const handleOpenSlot = useCallback((category, index, clear = false) => {
    if (clear) {
      const field = SLOT_FIELD[category];
      setCharacter((c) => {
        const next = [...(c[field] || [])];
        next.splice(index, 1);
        return { ...c, [field]: next };
      });
      return;
    }
    const label = report.slots.find((s) => s.category === category)?.label || category;
    setPicking({ category, index, label });
  }, [report.slots]);

  // Commit a power choice into the slot's field at the given index.
  const handleChoosePower = useCallback((category, index, powerName) => {
    const field = SLOT_FIELD[category];
    setCharacter((c) => {
      const next = [...(c[field] || [])];
      next[index] = powerName;
      return { ...c, [field]: next };
    });
    setPicking(null);
  }, []);

  const handleBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) { setView(null); return h; }
      const prev = h[h.length - 1];
      setView(prev);
      return h.slice(0, -1);
    });
  }, []);

  const handleClose = useCallback(() => { setView(null); setHistory([]); }, []);

  const handleRestart = useCallback(() => {
    if (window.confirm("Discard this character and start over?")) {
      setCharacter(EMPTY_CHARACTER);
      setView(null); setHistory([]);
    }
  }, []);

  const handleClickIdentityField = useCallback((field) => {
    const item = character[field === "class" ? "classLevels" : field];
    if (item) handleInspect(item, null, field === "class" ? "classes" : field);
  }, [character, handleInspect]);

  return (
    <div className="b-root">
      <BTopBar character={character} report={report} />
      <div className="b-cols">
        <IdentityRail character={character} report={report}
                      onClickField={handleClickIdentityField} onRestart={handleRestart} />
        <BuildSheet character={character} report={report} view={view}
                    onPickArchetype={handlePickArchetype}
                    onInspect={handleInspect} onOpenSlot={handleOpenSlot} />
        <DetailPane view={view}
                    onInspect={handleInspect} onChoosePower={handleChoosePower}
                    onBack={history.length ? handleBack : null} onClose={handleClose} />
      </div>
      {picking && (
        <PickerOverlay slot={picking} character={character}
                       onChoose={handleChoosePower} onClose={() => setPicking(null)} />
      )}
    </div>
  );
}

function BTopBar({ character, report }) {
  const level = character.archetypeName ? characterLevel(character) : null;
  return (
    <header className="b-topbar">
      <div className="b-topbar-brand">
        <span className="b-topbar-title">Wellspring</span>
        <span className="b-topbar-sub">Character Builder</span>
      </div>
      <div className="b-topbar-stats">
        {level && (
          <>
            <span className="b-topbar-stat">Level <strong>{level}</strong></span>
            <span className="b-topbar-stat">Budget <strong>{report.budget} BP</strong></span>
            <span className={`b-topbar-stat ${report.valid ? "is-valid" : "is-invalid"}`}>
              {report.valid ? "✓ legal build" : "⚠ check build"}
            </span>
          </>
        )}
      </div>
      <div className="b-topbar-actions">
        <button className="b-topbar-btn" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
          Copy share link
        </button>
      </div>
    </header>
  );
}
