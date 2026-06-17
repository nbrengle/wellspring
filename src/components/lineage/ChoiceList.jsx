// The choices pane: one unified, SEARCHABLE/FILTERABLE list of a lineage's
// challenges + advantages (pain #3 crowding, #4 no search/filter). Grouped by
// challenges (award LBP) / advantages (spend LBP); each item is a ChoiceRow.
import React, { useState, useMemo } from "react";
import { subKey } from "../../engine/validate.js";
import { cleanChallengeName } from "../LineagePanel.jsx";
import ChoiceRow from "./ChoiceRow.jsx";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" }, // matches sublineage / general
  { id: "taken", label: "Taken" },
  { id: "required", label: "Required" },
];

export default function ChoiceList({
  lin, lineage, character, lbp, pickedSub,
  onToggle, onInspect, onSetChoice, onSetRep,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const storedFor = (field, it) => (character[field] || []).find(
    (n) => n === it.name || cleanChallengeName(n) === cleanChallengeName(it.name));

  const resolvedLbpFor = (it) =>
    lbp?.chosenChallenges?.find((c) => cleanChallengeName(c.name) === cleanChallengeName(it.name))?.lbp;

  const matches = (it, field) => {
    const q = query.trim().toLowerCase();
    if (q && !((it.baseName || it.name).toLowerCase().includes(q) || (it.desc || "").toLowerCase().includes(q))) return false;
    const k = subKey(it.sublineage);
    const available = !k || k === "general" || !pickedSub || k === pickedSub;
    const taken = storedFor(field, it) !== undefined;
    if (filter === "available") return available;
    if (filter === "taken") return taken;
    if (filter === "required") return !!it.required;
    return true; // all
  };

  const rows = (list, field, kind) =>
    (list || []).filter((it) => matches(it, field)).map((it) => {
      const storedName = storedFor(field, it);
      return (
        <ChoiceRow key={it.name} item={it} lineage={lineage} kind={kind}
                   chosen={storedName !== undefined} storedName={storedName}
                   resolvedLbp={resolvedLbpFor(it)}
                   onToggle={onToggle} onInspect={onInspect}
                   onSetChoice={onSetChoice} onSetRep={onSetRep}
                   advantageChoices={character.advantageChoices} />
      );
    });

  const ch = rows(lin.challenges, "lineageChallenges", "challenge");
  const adv = rows(lin.advantages, "lineageAdvantages", "advantage");

  return (
    <div className="b-lin-choices">
      <div className="b-lin-choices-controls">
        <input className="b-lin-search" type="search" placeholder="Search challenges & advantages…"
               value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search lineage options" />
        <div className="b-lin-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`b-lin-filter ${filter === f.id ? "is-on" : ""}`}
                    onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="b-lin-choices-group">
        <h3 className="b-lin-group-head">Challenges <span className="b-lin-group-note">award LBP</span></h3>
        {ch.length ? <ul className="b-lin-list">{ch}</ul> : <p className="b-empty">No matching challenges.</p>}
      </div>
      <div className="b-lin-choices-group">
        <h3 className="b-lin-group-head">Advantages <span className="b-lin-group-note">spend LBP</span></h3>
        {adv.length ? <ul className="b-lin-list">{adv}</ul> : <p className="b-empty">No matching advantages.</p>}
      </div>
    </div>
  );
}
