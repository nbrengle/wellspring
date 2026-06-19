// Sublineage step — its OWN full-width band above the earn/spend columns (not a
// column), so it never reads as "one column per sublineage". A sublineage is
// OPTIONAL: a "None — General only" card is the default, and you may take options
// from at most one sublineage. Picking one SWAPS freely (no lock-in); the parent
// handles dropping orphaned picks + auto-adding the new sublineage's requireds.
//
// Per the rules, civilization sub-lineages aren't a separate category — they're
// just sub-lineages whose title carries a civilization name, which you may only
// play if your character is from that civilization. So they sit in the SAME list,
// tagged with their required civilization (not hoisted into an "origin" section).
// Descriptions show when present (parser follow-up — they hide cleanly when absent).
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

  const Card = (s) => {
    const on = selKey === subKey(s.label);
    return (
      <button
        key={s.label}
        className={`b-lin-sub-card ${s.civ ? "is-civ" : ""} ${on ? "is-on" : ""}`}
        onClick={() => onSelect(on ? null : s.label)}
      >
        <span className="b-lin-sub-card-name">{s.name}</span>
        {/* Civilization sub-lineages may only be played if you're from there. */}
        {s.civ && s.context && (
          <span className="b-lin-sub-card-ctx">Requires: {s.context.replace(/^Civilization:\s*/i, "")}</span>
        )}
        {!s.civ && s.context && <span className="b-lin-sub-card-ctx">{s.context}</span>}
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
        {subs.map((s) => Card(s))}
      </div>
    </div>
  );
}
