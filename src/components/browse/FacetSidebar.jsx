// The V4 faceted sidebar — a column of checkbox facets that NARROW a list. Its
// defining behavior (the thing that made it feel right in prototyping): it
// DIMS-DON'T-HIDE. When a filter makes a value impossible, that checkbox goes gray
// with a 0 and disables, but it never disappears — so the option list never shifts
// under you. Multi-select within a facet (OR), AND across facets.
//
// Pure presentation over the shared facet model: the parent owns `sel` (the
// selection map) and the candidate pool; this renders the controls and reports
// toggles back. Counts for each value reflect the OTHER active facets, so you can
// see what checking it would yield.
import { useState } from "react";
import { facetValues, passesFacetsExcept, activeFacetCount, toggleFacetValue } from "./facets.js";

const DEFAULT_LIMIT = 8;

export default function FacetSidebar({
  // The full pool (pre-facet) — counts and availability computed against it + sel.
  pool,
  // The facets to show: [{ id, label, values(entity) }]. Parent decides which apply.
  facets,
  // Selection map { facetId: Set<value> } and its setter.
  sel,
  onChange,
  // Optional extra search predicate applied before counting (so counts track search).
  query = "",
  matches,
  // Optional header/extra content rendered above the facets (e.g. search box).
  header,
}) {
  const [collapsed, setCollapsed] = useState({});
  const [expanded, setExpanded] = useState({}); // facet id -> show all values

  const searched = query && matches ? pool.filter((e) => matches(e, query.trim().toLowerCase())) : pool;

  const toggle = (id, v) => onChange(toggleFacetValue(sel, id, v));
  const clearFacet = (id) => {
    const next = { ...sel };
    delete next[id];
    onChange(next);
  };

  return (
    <aside className="b-facetbar">
      {header}
      {facets.map((f) => {
        const set = sel[f.id] || new Set();
        // All values over the searched pool (so options persist), each counted against
        // the OTHER active facets — the dim-don't-hide signal.
        const allVals = facetValues(searched, f).map(([v]) => v);
        const counted = allVals.map((v) => ({
          v,
          on: set.has(v),
          n: searched.filter((e) => passesFacetsExcept(e, sel, f.id) && f.values(e).includes(v)).length,
        }));
        // Selected first, then by count desc, then label.
        counted.sort((a, b) => Number(b.on) - Number(a.on) || b.n - a.n || String(a.v).localeCompare(String(b.v)));
        const isColl = collapsed[f.id];
        const shown = isColl ? [] : expanded[f.id] ? counted : counted.slice(0, DEFAULT_LIMIT);
        const nSel = set.size;
        return (
          <div key={f.id} className="b-facetbar-group">
            <div className="b-facetbar-head" onClick={() => setCollapsed((c) => ({ ...c, [f.id]: !c[f.id] }))}>
              <span className="b-facetbar-label">{f.label}</span>
              {nSel > 0 && (
                <button
                  className="b-facetbar-clear"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFacet(f.id);
                  }}
                >
                  clear {nSel}
                </button>
              )}
              <span className="b-facetbar-chev">{isColl ? "▸" : "▾"}</span>
            </div>
            {shown.map(({ v, on, n }) => (
              <label key={v} className={`b-facetbar-opt ${on ? "is-on" : ""} ${n === 0 && !on ? "is-zero" : ""}`}>
                <input type="checkbox" checked={on} disabled={n === 0 && !on} onChange={() => toggle(f.id, v)} />
                <span className="b-facetbar-v">{v}</span>
                <span className="b-facetbar-c">{n}</span>
              </label>
            ))}
            {!isColl && counted.length > shown.length && (
              <button className="b-facetbar-more" onClick={() => setExpanded((x) => ({ ...x, [f.id]: true }))}>
                +{counted.length - shown.length} more…
              </button>
            )}
          </div>
        );
      })}
    </aside>
  );
}

// Convenience: the chip bar of active filters (removable), shown above results.
export function ActiveFilterBar({ sel, onChange, facetLabel }) {
  if (activeFacetCount(sel) === 0) return null;
  const chips = [];
  for (const [id, set] of Object.entries(sel)) for (const v of set || []) chips.push([id, v]);
  return (
    <div className="b-facetbar-active">
      {chips.map(([id, v]) => (
        <span key={`${id}:${v}`} className="b-facetbar-chip">
          {facetLabel ? `${facetLabel(id)}: ${v}` : v}
          <button onClick={() => onChange(toggleFacetValue(sel, id, v))} aria-label={`Remove ${v}`}>
            ×
          </button>
        </span>
      ))}
      <button className="b-facetbar-clearall" onClick={() => onChange({})}>
        clear all
      </button>
    </div>
  );
}
