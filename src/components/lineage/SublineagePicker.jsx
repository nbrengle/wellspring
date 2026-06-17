// Sublineage selection — the prominent first decision (pain #1: was tiny chips).
// Big cards: name + civilization/context subtitle, and a count of what's unique to
// that sublineage. Selecting one surfaces its distinctive challenges/advantages
// right here (pain #2: those used to be buried in the main list).
import React from "react";
import { subKey } from "../../engine/validate.js";
import { parseSublineage, distinctiveFor } from "./lineage-helpers.js";

export default function SublineagePicker({ lin, selected, onSelect }) {
  const subs = (lin.sublineages || []).map(parseSublineage).filter((s) => s.name && s.name.toLowerCase() !== "general");
  if (subs.length === 0) return null;
  const selKey = selected ? subKey(selected) : null;

  return (
    <div className="b-lin-sub-section">
      <h3 className="b-lin-sub-heading">Sublineage</h3>
      <p className="b-lin-sub-note">Optional — commits you to that sublineage’s challenges &amp; advantages.</p>
      <div className="b-lin-sub-cards">
        {subs.map((s) => {
          const on = selKey === subKey(s.label);
          const d = distinctiveFor(lin, s.label);
          const count = d.challenges.length + d.advantages.length;
          return (
            <button key={s.label} className={`b-lin-sub-card ${on ? "is-on" : ""}`}
                    onClick={() => onSelect(on ? null : s.label)}>
              <span className="b-lin-sub-card-name">{s.name}</span>
              {s.context && <span className="b-lin-sub-card-ctx">{s.context}</span>}
              {count > 0 && (
                <span className="b-lin-sub-card-count">{count} unique option{count === 1 ? "" : "s"}</span>
              )}
            </button>
          );
        })}
      </div>

      {selected && (() => {
        const d = distinctiveFor(lin, selected);
        const items = [...d.challenges, ...d.advantages];
        if (items.length === 0) return null;
        return (
          <div className="b-lin-sub-distinct">
            <span className="b-lin-sub-distinct-label">What makes a {parseSublineage(selected).name} different:</span>
            <span className="b-lin-sub-distinct-list">
              {items.map((it) => it.baseName || it.name).join(" · ")}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
