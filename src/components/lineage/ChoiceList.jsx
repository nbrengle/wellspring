// The choices area — B5 layout: two FACING columns (challenges earn LBP ⇄
// advantages spend LBP), always both visible, so the two-sided budget is obvious.
// Within each column, items are grouped into LBP-value bands (a price list you scan
// by cost). One shared search/filter spans both. Sublineage-scoped items are shown
// dimmed/locked until their sublineage is picked. Each item is a ChoiceRow.
import React, { useState } from "react";
import { subKey } from "../../engine/validate.js";
import { cleanChallengeName } from "../LineagePanel.jsx";
import { parseSublineage } from "./lineage-helpers.js";
import ChoiceRow from "./ChoiceRow.jsx";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "taken", label: "Taken" },
  { id: "required", label: "Required" },
];

const subLabel = (s) => (s ? parseSublineage(s).name : "");

// Group items into LBP-value bands, highest value first, with variable-cost (null
// lbp) items in a trailing "Variable" band.
function bandsOf(items) {
  const map = new Map();
  for (const it of items) {
    const v = typeof it.lbp === "number" ? it.lbp : "var";
    if (!map.has(v)) map.set(v, []);
    map.get(v).push(it);
  }
  const nums = [...map.keys()].filter((v) => v !== "var").sort((a, b) => b - a);
  const order = map.has("var") ? [...nums, "var"] : nums;
  return order.map((v) => ({ value: v, items: map.get(v) }));
}

export default function ChoiceList({
  lin,
  lineage,
  character,
  lbp,
  pickedSub,
  onToggle,
  onInspect,
  onSetChoice,
  onSetRep,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const storedFor = (field, it) =>
    (character[field] || []).find((n) => n === it.name || cleanChallengeName(n) === cleanChallengeName(it.name));

  const resolvedLbpFor = (it) =>
    lbp?.chosenChallenges?.find((c) => cleanChallengeName(c.name) === cleanChallengeName(it.name))?.lbp;

  const subInfo = (it) => {
    const k = subKey(it.sublineage);
    const general = !k || k === "general";
    const offSublineage = !general && pickedSub && k !== pickedSub;
    return { general, offSublineage, label: subLabel(it.sublineage) };
  };

  const matches = (it, field) => {
    const q = query.trim().toLowerCase();
    if (q && !((it.baseName || it.name).toLowerCase().includes(q) || (it.desc || "").toLowerCase().includes(q)))
      return false;
    if (filter === "taken") return storedFor(field, it) !== undefined;
    if (filter === "required") return !!it.required;
    return true; // 'all' — sublineage scoping is shown via dimming, not hiding
  };

  // A required challenge applies (auto-taken, locked) when it's General OR scoped to
  // the currently-picked sublineage — identical treatment regardless of source.
  const requiredActive = (it) => {
    if (!it.required) return false;
    const k = subKey(it.sublineage);
    return !k || k === "general" || k === pickedSub;
  };

  const renderRow = (it, field, kind) => {
    const storedName = storedFor(field, it);
    const info = subInfo(it);
    return (
      <ChoiceRow
        key={it.name}
        item={it}
        lineage={lineage}
        kind={kind}
        chosen={storedName !== undefined}
        storedName={storedName}
        resolvedLbp={resolvedLbpFor(it)}
        subLabel={info.general ? null : info.label}
        dimmed={info.offSublineage}
        requiredActive={requiredActive(it)}
        onToggle={onToggle}
        onInspect={onInspect}
        onSetChoice={onSetChoice}
        onSetRep={onSetRep}
        advantageChoices={character.advantageChoices}
      />
    );
  };

  const column = (list, field, kind) => {
    const visible = (list || []).filter((it) => matches(it, field));
    const bands = bandsOf(visible);
    const sign = kind === "challenge" ? "+" : "−";
    const earned = kind === "challenge" ? lbp.awarded : null;
    return (
      <div className={`b-lin-col b-lin-col-${kind === "challenge" ? "earn" : "spend"}`}>
        <div className="b-lin-col-head">
          <span className="b-lin-col-tot">{kind === "challenge" ? `+${lbp.awarded}` : `−${lbp.spent}`} LBP</span>
          <h3 className="b-lin-col-title">{kind === "challenge" ? "① Challenges — earn" : "② Advantages — spend"}</h3>
          <p className="b-lin-col-sub">
            {kind === "challenge" ? "Take these to build your LBP budget." : "Buy these with earned LBP."}
          </p>
        </div>
        {bands.length === 0 ? (
          <p className="b-empty">No matching {kind === "challenge" ? "challenges" : "advantages"}.</p>
        ) : (
          bands.map((b) => (
            <div key={b.value} className="b-lin-band">
              <div className="b-lin-band-head">
                <span className="b-lin-band-v">{b.value === "var" ? "Variable" : `${sign}${b.value} LBP`}</span>
                <span className="b-lin-band-line" />
              </div>
              <ul className="b-lin-list">{b.items.map((it) => renderRow(it, field, kind))}</ul>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div className="b-lin-choices">
      <div className="b-lin-choices-controls">
        <input
          className="b-lin-search"
          type="search"
          placeholder="Search challenges & advantages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search lineage options"
        />
        <div className="b-lin-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`b-lin-filter ${filter === f.id ? "is-on" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="b-lin-cols">
        {column(lin.challenges, "lineageChallenges", "challenge")}
        {column(lin.advantages, "lineageAdvantages", "advantage")}
      </div>
    </div>
  );
}
