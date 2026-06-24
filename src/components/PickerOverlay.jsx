import React, { useState, useMemo } from "react";
import { lookupEntity, UNLIMITED_SKILLS } from '../engine/data.js';
import { prereqStatus } from "../engine/validate.js";
import { gameEffectFacets } from "../engine/game-effects.js";
import { EntityBody } from "./DetailPane.jsx";
import Overlay from "./ui/Overlay.jsx";

function Tag({ label, tone = "amber" }) {
  return <span className={`b-tag b-tag-${tone}`}>{label}</span>;
}

function CostBadge({ cost }) {
  if (cost === "Var") return <Tag label="variable BP" tone="amber" />;
  if (cost) return <Tag label={`${cost} BP`} tone="indigo" />;
  return null;
}

const spellTierKey = (c) => {
  const t = c.tierList || "";
  if (/novice/i.test(t)) return "novice";
  if (/adept/i.test(t)) return "adept";
  if (/greater/i.test(t)) return "greater";
  if (/cantrip/i.test(t)) return "cantrip";
  return null;
};

const spellTierLabel = (c) => {
  const k = spellTierKey(c);
  if (k === "novice") return "Novice";
  if (k === "adept") return "Adept";
  if (k === "greater") return "Greater";
  if (k === "cantrip") return "Cantrip";
  return "";
};

const refreshBucket = (c) => {
  const r = (c.refresh || "").toLowerCase();
  if (!r || r === "none" || r === "passive") return "Passive";
  if (r.includes("long")) return "Long Rest";
  if (r.includes("short")) return "Short Rest";
  if (r.includes("immediate")) return "Immediate";
  return c.refresh;
};

const SPELL_TIER_BUCKET = { noviceSpells: "Novice", adeptSpells: "Adept", greaterSpells: "Greater", cantrips: "Cantrip" };

// Group axes. Single-facet axes return ONE key via `key(c)`. The player-facing
// game-effect axes are MULTI-facet: `keys(c, entityType)` returns every bucket the
// item belongs to (a Flame power that also Roots lands in both Flame and Root), so
// browsing "everything that can Root" actually shows everything that can Root.
const GROUP_AXES = {
  tier:         { label: "Tier",          key: (c) => SPELL_TIER_BUCKET[c.tierList] || c.tier || "—" },
  category:     { label: "Category",      key: (c) => c.cat || c.tierList || "Other" },
  refresh:      { label: "Refresh",       key: refreshBucket },
  effect:       { label: "Effect",        multi: true, facet: "effect",    placeholder: "No targeted effect" },
  damage:       { label: "Damage type",   multi: true, facet: "damage",    placeholder: "Untyped" },
  condition:    { label: "Condition",     multi: true, facet: "condition", placeholder: "No condition" },
  alphabetical: { label: "A–Z",           key: (c) => (c.name[0] || "#").toUpperCase() },
  cost:         { label: "Cost",          key: (c) => (typeof c.cost === "number" ? `${c.cost} BP` : "—") },
};

// Buckets an item belongs to under an axis (always an array; single-facet axes
// return [oneKey]). For a multi-facet axis with no matches, returns [placeholder].
function bucketsFor(axis, c, entityType) {
  if (!axis.multi) return [axis.key(c)];
  const keys = gameEffectFacets(entityType, c.name)[axis.facet];
  return keys.length ? keys : [axis.placeholder];
}

// The OTHER facets an item has on the current axis (for the "also: …" row badge),
// excluding the bucket it's currently shown under.
function otherFacets(axis, c, entityType, currentBucket) {
  if (!axis.multi) return [];
  return (gameEffectFacets(entityType, c.name)[axis.facet] || []).filter((k) => k !== currentBucket);
}

export default function PickerOverlay({ spec, character, onClose }) {
  const { entityType, title, subtitle, candidates, taken, onChoose } = spec;

  const [query, setQuery] = useState("");
  const [hideLocked, setHideLocked] = useState(false);
  const [selected, setSelected] = useState(candidates[0]?.name || null);
  const isSpells = candidates.some((c) => c.tierList && SPELL_TIER_BUCKET[c.tierList]);
  const hasRefresh = candidates.some((c) => c.refresh && c.refresh !== "None");
  const [groupMode, setGroupMode] = useState(isSpells ? "tier" : hasRefresh ? "refresh" : "category");
  const [sortMode, setSortMode] = useState("name");
  const [readStack, setReadStack] = useState([]);

  const lockedOf = (name) => !prereqStatus(character, `${entityType}:${name}`).met;

  // Only offer a game-effect axis when some candidate actually carries that facet —
  // the Damage/Condition axes are meaningless for a skill or perk picker, so they
  // shouldn't clutter the dropdown there.
  const availableAxes = useMemo(() => {
    const hasFacet = (facet) => candidates.some((c) => gameEffectFacets(entityType, c.name)[facet].length > 0);
    return Object.entries(GROUP_AXES).filter(([, v]) => !v.multi || hasFacet(v.facet));
  }, [candidates, entityType]);

  const groupAxis = GROUP_AXES[groupMode] || GROUP_AXES.category;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = candidates;
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.desc || "").toLowerCase().includes(q));
    const decorated = list.map((c) => ({ ...c, locked: lockedOf(c.name) }));
    const axis = GROUP_AXES[groupMode] || GROUP_AXES.category;
    const placeholder = axis.placeholder;
    // Expand into buckets: multi-facet axes drop an item into EACH bucket it matches.
    const buckets = new Map();
    for (const c of decorated) {
      for (const k of bucketsFor(axis, c, entityType)) {
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(c);
      }
    }
    let entries = [...buckets.entries()];
    if (hideLocked) entries = entries.map(([g, cs]) => [g, cs.filter((c) => !c.locked)]).filter(([, cs]) => cs.length);
    const facetCount = (c) => (axis.multi ? (gameEffectFacets(entityType, c.name)[axis.facet]?.length || 0) : 0);
    const cmp = sortMode === "cost"
      ? (a, b) => (a.cost ?? 999) - (b.cost ?? 999) || a.name.localeCompare(b.name)
      : sortMode === "effect"
        ? (a, b) => facetCount(b) - facetCount(a) || a.name.localeCompare(b.name)
        : (a, b) => a.name.localeCompare(b.name);
    for (const [, cs] of entries) cs.sort(cmp);
    // Alphabetize buckets for A–Z and the game-effect axes (so Charm, Drain, Heal…
    // read predictably); always sink the "no facet" placeholder to the bottom.
    if (groupMode === "alphabetical" || axis.multi) {
      entries.sort((a, b) => {
        if (a[0] === placeholder) return 1;
        if (b[0] === placeholder) return -1;
        return a[0].localeCompare(b[0]);
      });
    }
    return entries;
  }, [candidates, query, hideLocked, character, entityType, groupMode, sortMode]);

  const readingEntity = useMemo(() => {
    if (readStack.length) return lookupEntity(readStack[readStack.length - 1]);
    return selected ? lookupEntity(`${entityType}:${selected}`) : null;
  }, [readStack, selected, entityType]);

  const selectCandidate = (name) => { setSelected(name); setReadStack([]); };
  const followLink = (name, _field, type) => setReadStack((s) => [...s, `${type}:${name}`]);
  const readBack = () => setReadStack((s) => s.slice(0, -1));
  const isFollowing = readStack.length > 0;
  const selectedLocked = selected && lockedOf(selected);
  const selectedTaken = selected && taken.has(selected) && !UNLIMITED_SKILLS.has(selected);

  return (
    <Overlay onClose={onClose} panelClassName="b-picker">
        <header className="b-picker-head">
          <div>
            <h2 className="b-picker-title">{title}</h2>
            <p className="b-picker-sub">{subtitle}</p>
          </div>
          <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="b-picker-cols">
          <div className="b-picker-browse">
            <div className="b-picker-controls">
              <input className="b-picker-search" type="text" aria-label="Search" placeholder="Search…"
                     value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
              <div className="b-picker-sortrow">
                <label className="b-picker-sortlabel">Group
                  <select className="b-picker-sortsel" value={groupMode} onChange={(e) => setGroupMode(e.target.value)}>
                    {availableAxes.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                <label className="b-picker-sortlabel">Sort
                  <select className="b-picker-sortsel" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                    <option value="name">A–Z</option>
                    <option value="cost">Cost</option>
                    <option value="effect">Effect richness</option>
                  </select>
                </label>
                <label className="b-picker-toggle">
                  <input type="checkbox" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />
                  Hide locked
                </label>
              </div>
            </div>
            <div className="b-picker-groups">
              {groups.length === 0 && <p className="b-detail-missing">Nothing matches.</p>}
              {groups.map(([group, items]) => (
                <div key={group} className="b-picker-group">
                  <h3 className="b-picker-group-label">{group}</h3>
                  <ul className="b-picker-names">
                    {items.map((c) => {
                      const isTaken = taken.has(c.name);
                      // When grouping by a game-effect axis, show the item's OTHER
                      // facets so a multi-effect power explains why it's repeated.
                      const also = otherFacets(groupAxis, c, entityType, group);
                      return (
                        <li key={c.name}>
                          <button
                            className={`b-picker-row ${selected === c.name ? "is-selected" : ""} ${c.locked ? "is-locked" : ""} ${isTaken ? "is-taken" : ""}`}
                            onClick={() => selectCandidate(c.name)}>
                            <span className="b-picker-row-name">{c.name}</span>
                            {also.length > 0 && (
                              <span className="b-picker-row-also" title={`Also: ${also.join(", ")}`}>
                                also {also.join(", ")}
                              </span>
                            )}
                            {spellTierKey(c) && <span className={`b-picker-row-tier b-tier-${spellTierKey(c)}`}>{spellTierLabel(c)}</span>}
                            {typeof c.cost === "number" && c.cost > 0 && <span className="b-picker-row-cost">{c.cost} BP</span>}
                            {typeof c.cost === "string" && /^var/i.test(c.cost) && <span className="b-picker-row-cost">Var BP</span>}
                            {typeof c.bp === "number" && c.bp > 0 && <span className="b-picker-row-cost is-award">+{c.bp} BP</span>}
                            {c.locked && <span className="b-picker-row-tag b-locked">locked</span>}
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
                    <button className="b-read-choose" disabled={selectedTaken}
                            onClick={() => onChoose(selected)}>
                      {selectedTaken ? "Already chosen" : `Choose ${selected}`}
                    </button>
                  </footer>
                )}
              </>
            ) : (
              <p className="b-detail-hint">Select an option on the left to read it.</p>
            )}
          </div>
        </div>
    </Overlay>
  );
}
