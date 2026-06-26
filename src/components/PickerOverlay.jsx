import React, { useState, useMemo, useRef, useLayoutEffect } from "react";
import { lookupEntity, UNLIMITED_SKILLS } from '../engine/data.js';
import { prereqStatus } from "../engine/validate.js";
import { browse, gameEffectAxes, axisApplies, otherBuckets } from "./browse/browse.js";
import { availableFacets as computeAvailableFacets, passesFacets as facetsPass,
         passesFacetsExcept as facetsPassExcept, activeFacetCount as countActiveFacets,
         toggleFacetValue } from "./browse/facets.js";
import { EntityBody } from "./DetailPane.jsx";
import { spellTierKey, spellTierLabel, CLASS_TONES } from "./build-sheet/utils.js";
import Overlay from "./ui/Overlay.jsx";

function Tag({ label, tone = "amber" }) {
  return <span className={`b-tag b-tag-${tone}`}>{label}</span>;
}

function CostBadge({ cost }) {
  if (cost === "Var") return <Tag label="variable BP" tone="amber" />;
  if (cost) return <Tag label={`${cost} BP`} tone="indigo" />;
  return null;
}



const refreshBucket = (c) => {
  const r = (c.refresh || "").toLowerCase();
  if (!r || r === "none" || r === "passive") return "Passive";
  if (r.includes("long")) return "Long Rest";
  if (r.includes("short")) return "Short Rest";
  if (r.includes("immediate")) return "Immediate";
  return c.refresh;
};

const SPELL_TIER_BUCKET = { noviceSpells: "Novice", adeptSpells: "Adept", greaterSpells: "Greater", cantrips: "Cantrip" };

// Surface-specific axes (tier/category/refresh/cost/A–Z). The shared player-facing
// game-effect axes (Effect / Damage type / Condition) are appended from useBrowse so
// they read identically here and in the lineage choices.
const SURFACE_AXES = [
  { id: "tier",         label: "Tier",     key: (c) => SPELL_TIER_BUCKET[c.tierList] || c.tier || "—" },
  { id: "category",     label: "Category", key: (c) => c.cat || c.tierList || "Other" },
  { id: "refresh",      label: "Refresh",  key: refreshBucket },
  { id: "alphabetical", label: "A–Z",      key: (c) => (c.name[0] || "#").toUpperCase() },
  { id: "cost",         label: "Cost",     key: (c) => (typeof c.cost === "number" ? `${c.cost} BP` : "—") },
];

export default function PickerOverlay({ spec, character, onClose }) {
  const { entityType, title, subtitle, candidates, taken, onChoose } = spec;

  const [query, setQuery] = useState("");
  const [hideLocked, setHideLocked] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [facetSel, setFacetSel] = useState({}); // facet id -> Set of selected values
  const filtersBtnRef = useRef(null);
  const [selected, setSelected] = useState(candidates[0]?.name || null);
  const isSpells = candidates.some((c) => c.tierList && SPELL_TIER_BUCKET[c.tierList]);
  const hasRefresh = candidates.some((c) => c.refresh && c.refresh !== "None");
  const [groupMode, setGroupMode] = useState(isSpells ? "tier" : hasRefresh ? "refresh" : "category");
  const [sortMode, setSortMode] = useState("name");
  const [readStack, setReadStack] = useState([]);

  const lockedOf = (name) => !prereqStatus(character, `${entityType}:${name}`).met;

  // Resolve each thin candidate ({name, cat, …}) to its FULL entity so the shared
  // facet registry (which reads entity fields: type/tier/lineage/…) can slice them.
  // Keyed by candidate name; falls back to the candidate itself if not indexed.
  const entityOf = useMemo(() => {
    const m = new Map();
    for (const c of candidates) m.set(c.name, lookupEntity(`${entityType}:${c.name}`) || c);
    return m;
  }, [candidates, entityType]);
  const entities = useMemo(() => candidates.map((c) => entityOf.get(c.name)), [candidates, entityOf]);

  // Surface axes + shared game-effect axes (resolved against this picker's entity
  // type). Drop the Damage/Condition axes when no candidate carries that facet so
  // they don't clutter a skill/perk picker.
  const allAxes = useMemo(
    () => [
      ...SURFACE_AXES,
      { id: "tags", label: "Tags", multi: true, keys: (c) => entityOf.get(c.name)?.tags || [], placeholder: "Untagged" },
      ...gameEffectAxes(() => entityType)
    ],
    [entityType, entityOf],
  );
  const availableAxes = useMemo(
    () => allAxes.filter((a) => axisApplies(a, candidates)),
    [allAxes, candidates],
  );

  // Facets offered for THIS pool: shared registry, only those with 2+ values. A
  // narrow slot ("Add a Mage power" — all Mage) offers few/none.
  const availableFacets = useMemo(() => computeAvailableFacets(entities), [entities]);
  const activeFacetCount = countActiveFacets(facetSel);
  const passesFacets = (c) => facetsPass(entityOf.get(c.name), facetSel);
  const passesFacetsExcept = (c, exceptId) => facetsPassExcept(entityOf.get(c.name), facetSel, exceptId);
  const toggleFacet = (id, v) => setFacetSel((cur) => toggleFacetValue(cur, id, v));

  const facetCount = (c, axis) => (axis?.multi ? (axis.keys(c)?.length || 0) : 0);
  const { axis: groupAxis, groups } = useMemo(
    () => browse({
      items: candidates,
      axes: availableAxes,
      groupBy: groupMode,
      query,
      matches: (c, q) => {
        const ent = entityOf.get(c.name);
        return c.name.toLowerCase().includes(q) || 
               (c.desc || "").toLowerCase().includes(q) ||
               (ent?.tags || []).some((t) => t.toLowerCase().includes(q));
      },
      sort: sortMode,
      compare: (a, b, s, axis) =>
        s === "cost"
          ? (a.cost ?? 999) - (b.cost ?? 999) || a.name.localeCompare(b.name)
          : s === "effect"
            ? facetCount(b, axis) - facetCount(a, axis) || a.name.localeCompare(b.name)
            : a.name.localeCompare(b.name),
      decorate: (c) => ({ ...c, locked: lockedOf(c.name) }),
      filter: (c) => (!hideLocked || !lockedOf(c.name)) && passesFacets(c),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, availableAxes, groupMode, query, sortMode, hideLocked, character, entityType, facetSel],
  );

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
                    {availableAxes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
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
                {availableFacets.length > 0 && (
                  <button ref={filtersBtnRef}
                          className={`b-picker-filters-btn ${activeFacetCount ? "is-active" : ""}`}
                          onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
                    Filters{activeFacetCount ? ` · ${activeFacetCount}` : ""} ▾
                  </button>
                )}
              </div>
            </div>
            {filtersOpen && (
              <FacetPopover anchorRef={filtersBtnRef} facets={availableFacets} sel={facetSel}
                            candidates={candidates} entityOf={entityOf} passesExcept={passesFacetsExcept}
                            onToggle={toggleFacet} onClear={() => setFacetSel({})}
                            onClose={() => setFiltersOpen(false)} />
            )}
            <div className="b-picker-groups">
              {groups.length === 0 && <p className="b-detail-missing">Nothing matches.</p>}
              {groups.map(({ key: group, items }) => (
                <div key={group} className="b-picker-group">
                  <h3 className="b-picker-group-label">{group}</h3>
                  <ul className="b-picker-names">
                    {items.map((c) => {
                      const isTaken = taken.has(c.name);
                      // When grouping by a game-effect axis, show the item's OTHER
                      // facets so a multi-effect power explains why it's repeated.
                      const also = otherBuckets(groupAxis, c, group);
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
                            {(entityOf.get(c.name)?.tags || []).map((t) => {
                              const tone = CLASS_TONES[t];
                              return <span key={t} className={`b-picker-row-tag ${tone ? `b-tag-${tone}` : "b-data"}`}>{t}</span>;
                            })}
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

// The Filters popover: floats over the list (position:fixed, JS-anchored under the
// Filters button) so opening it NEVER reflows the list or the read pane — closed,
// the picker is byte-identical to before. Multi-select checkboxes per facet, each
// value showing how many results it would yield given the other active facets.
function FacetPopover({ anchorRef, facets, sel, candidates, entityOf, passesExcept, onToggle, onClear, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 320) });
    };
    place();
    const onKey = (e) => e.key === "Escape" && onClose();
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, onClose]);

  const countFor = (facet, v) =>
    candidates.filter((c) => passesExcept(c, facet.id) && facet.values(entityOf.get(c.name)).includes(v)).length;
  const anyActive = Object.values(sel).some((s) => s?.size);

  return (
    <div ref={ref} className="b-facet-pop" role="dialog" aria-label="Filters"
         style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}>
      <div className="b-facet-pop-head">
        <span>Filter by</span>
        {anyActive && <button className="b-facet-clear" onClick={onClear}>clear all</button>}
      </div>
      <div className="b-facet-pop-body">
        {facets.map((f) => {
          const set = sel[f.id] || new Set();
          return (
            <div key={f.id} className="b-facet-group">
              <h4 className="b-facet-group-label">{f.label}</h4>
              {f.options.map(([v]) => {
                const n = countFor(f, v);
                const on = set.has(v);
                return (
                  <label key={v} className={`b-facet-opt ${on ? "is-on" : ""} ${n === 0 && !on ? "is-zero" : ""}`}>
                    <input type="checkbox" checked={on} disabled={n === 0 && !on}
                           onChange={() => onToggle(f.id, v)} />
                    {v}<span className="b-facet-c">{n}</span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
