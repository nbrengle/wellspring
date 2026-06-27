// EntityChoicePicker — a searchable read-pane overlay for choosing ONE option from a
// large, opaque pool (powers, spells, domains, rep-challenges). Generalized from the
// Lost Life RepPicker: a grouped/searchable left list + a right READ pane that shows
// the selected option's description (and tag/cost) so the player reads what they're
// picking before committing. Use this instead of a bare <SubSelect> when the pool is
// big and each option is just a name you'd otherwise have to look up elsewhere
// (rule of thumb: >~10 opaque options).
//
// Options can be plain entity NAMES (strings) — their descriptions are resolved via
// lookupEntity(`${resolveType}:<name>`) — or pre-shaped objects:
//   { name, description?, group?, tag?, cost?, costClass? }
import { useMemo, useState } from "react";
import Overlay from "./Overlay.jsx";
import { lookupEntity } from "../../engine/data.js";

export default function EntityChoicePicker({
  title = "Choose one",
  subtitle,
  options,            // (string | {name, description?, group?, tag?, cost?, costClass?})[]
  resolveType = "powers", // entity type for description lookup when options are names
  value,              // currently-chosen name (or null)
  chooseLabel,        // (name) => string  — footer button text
  onChoose,
  onClose,
}) {
  const [query, setQuery] = useState("");

  // Normalize to a flat list of option objects, resolving descriptions for bare names.
  const all = useMemo(() => (options || []).map((o) => {
    const base = typeof o === "string" ? { name: o } : { ...o };
    if (base.description == null) {
      const ent = lookupEntity(`${resolveType}:${base.name}`);
      base.description = ent?.description || ent?.summary || "";
      if (base.tag == null && ent?.parentClass) base.tag = ent.parentClass;
    }
    return base;
  }), [options, resolveType]);

  const [selected, setSelected] = useState(() => value || all[0]?.name || null);

  // Group for the left column (by `group` if present, else a single list).
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (o) => !q || o.name.toLowerCase().includes(q)
      || (o.group || "").toLowerCase().includes(q) || (o.description || "").toLowerCase().includes(q);
    const byGroup = new Map();
    for (const o of all) {
      if (!match(o)) continue;
      const g = o.group || "";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(o);
    }
    return [...byGroup.entries()];
  }, [all, query]);

  const sel = useMemo(() => all.find((o) => o.name === selected) || null, [all, selected]);

  return (
    <Overlay onClose={onClose} panelClassName="b-picker" ariaLabel={title}>
      <header className="b-picker-head">
        <div>
          <h2 className="b-picker-title">{title}</h2>
          {subtitle && <p className="b-picker-sub">{subtitle}</p>}
        </div>
        <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
      </header>

      <div className="b-picker-cols">
        <div className="b-picker-browse">
          <div className="b-picker-controls">
            <input className="b-picker-search" type="text" aria-label="Search" placeholder="Search…"
                   value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </div>
          <div className="b-picker-groups">
            {groups.length === 0 && <p className="b-detail-missing">Nothing matches.</p>}
            {groups.map(([group, opts]) => (
              <div key={group || "_"} className="b-picker-group">
                {group && <h3 className="b-picker-group-label">{group}</h3>}
                <ul className="b-picker-names">
                  {opts.map((o) => (
                    <li key={o.name}>
                      <button className={`b-picker-row ${selected === o.name ? "is-selected" : ""}`}
                              onClick={() => setSelected(o.name)}>
                        <span className="b-picker-row-name">{o.name}</span>
                        {o.tag && <span className="b-picker-row-tag">{o.tag}</span>}
                        {o.cost != null && <span className={`b-picker-row-cost ${o.costClass || ""}`}>{o.cost}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="b-picker-read">
          {sel ? (
            <>
              <header className="b-read-head">
                <h2 className="b-read-title">{sel.name}</h2>
                {(sel.tag || sel.group) && (
                  <p className="b-detail-type">{[sel.group, sel.tag].filter(Boolean).join(" · ")}</p>
                )}
              </header>
              <div className="b-read-body">
                <p className="b-detail-desc">{sel.description || "No description."}</p>
              </div>
              <footer className="b-read-foot">
                <button className="b-read-choose" onClick={() => onChoose(sel.name)}>
                  {chooseLabel ? chooseLabel(sel.name) : (value === sel.name ? "Keep this choice" : `Choose ${sel.name}`)}
                </button>
              </footer>
            </>
          ) : (
            <p className="b-detail-hint">Select an option on the left to read it.</p>
          )}
        </div>
      </div>
    </Overlay>
  );
}
