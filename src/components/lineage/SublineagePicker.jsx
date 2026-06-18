// Sublineage step — its OWN full-width band above the earn/spend columns (not a
// column), so it never reads as "one column per sublineage". A sublineage is
// OPTIONAL: a "None — General only" card is the default, and you may take options
// from at most one sublineage. Picking one SWAPS freely (no lock-in); the parent
// handles dropping orphaned picks + auto-adding the new sublineage's requireds.
//
// Two kinds are separated: mechanical TYPES (unlock their options) and CIVILIZATION
// origins (playable only if your character is from there). Descriptions show when
// present (they aren't in the data yet — a parser follow-up — so they hide cleanly).
import React from "react";
import { subKey } from "../../engine/validate.js";
import { parseSublineage, distinctiveFor, isCivSublineage } from "./lineage-helpers.js";

export default function SublineagePicker({ lin, selected, onSelect }) {
  const subs = (lin.sublineages || [])
    .filter((s) => parseSublineage(s).name.toLowerCase() !== "general")
    .map((s) => {
      const p = parseSublineage(s);
      const d = distinctiveFor(lin, p.label);
      return {
        ...p,
        civ: isCivSublineage(s),
        count: d.challenges.length + d.advantages.length,
        desc: (typeof s === "object" && s.description) || "",
      };
    });
  if (subs.length === 0) return null;
  const selKey = selected ? subKey(selected) : null;
  const types = subs.filter((s) => !s.civ);
  const civs = subs.filter((s) => s.civ);

  const Card = (s, { civ } = {}) => {
    const on = selKey === subKey(s.label);
    return (
      <button
        key={s.label}
        className={`b-lin-sub-card ${civ ? "is-civ" : ""} ${on ? "is-on" : ""}`}
        onClick={() => onSelect(on ? null : s.label)}
      >
        <span className="b-lin-sub-card-name">{s.name}</span>
        {s.context && <span className="b-lin-sub-card-ctx">{s.context}</span>}
        {s.desc && <span className="b-lin-sub-card-desc">{s.desc}</span>}
        {s.count > 0 && (
          <span className="b-lin-sub-card-count">
            {s.count} option{s.count === 1 ? "" : "s"} unlocked
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="b-lin-sub-step">
      <h3 className="b-lin-sub-heading">Sublineage — optional</h3>
      <p className="b-lin-sub-note">
        Build from <strong>General</strong> options alone, or pick <strong>one</strong> sublineage to unlock its extra
        options. Switch any time — you can only take options from a single sublineage at once.
      </p>
      <div className="b-lin-sub-cards">
        <button className={`b-lin-sub-card is-none ${!selected ? "is-on" : ""}`} onClick={() => onSelect(null)}>
          <span className="b-lin-sub-card-name">None</span>
          <span className="b-lin-sub-card-ctx">General options only — no commitment</span>
        </button>
        {types.map((s) => Card(s))}
      </div>
      {civs.length > 0 && (
        <>
          <p className="b-lin-sub-kind">Or an origin (civilization — requires being from there)</p>
          <div className="b-lin-sub-cards">{civs.map((s) => Card(s, { civ: true }))}</div>
        </>
      )}
    </div>
  );
}
