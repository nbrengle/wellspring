// The ONE sub-selection control. Across the builder a player makes several kinds of
// "pick one" choice — a build chooseOne power (Way of the Blade), a class starting
// specialty, a granted selection (devotion accent / granted power), a lineage
// sub-choice (cantrip / flavor). Each used its own widget (inline radios, bare
// <select>s). This standardizes them onto one chip control:
//
//   • every option is a visible chip (the real option counts top out ~8, so chips
//     never get unwieldy — no dropdown/search needed)
//   • a chosen chip is highlighted; clicking it again clears (when allowClear)
//   • options that grant something free show a "free" hint
//   • when nothing is chosen yet, a "Choose" badge makes the unmade pick obvious —
//     the key gap outside character creation, where these are easy to miss
//
// Options: [{ value, label?, free?, hint? }] (or plain strings). `value` is what's
// stored; `label` defaults to it.
import React, { useState } from "react";

function normalize(opts) {
  return (opts || []).map((o) => (typeof o === "string" ? { value: o, label: o } : { label: o.value, ...o }));
}

export default function SubSelect({
  options,
  value,
  onChange,
  prompt,
  // Show the amber "Choose" badge while unmade (default on — that's the point).
  showBadge = true,
  // Re-clicking the chosen chip clears it.
  allowClear = true,
  // Above this many options, chips become a wall — fall back to a searchable list
  // (cantrip pools are 18–33). Real option counts are otherwise ≤8, so chips stay.
  searchAbove = 12,
  className = "",
}) {
  const opts = normalize(options);
  const chosen = value || null;
  const [q, setQ] = useState("");
  const searchable = opts.length > searchAbove;
  const shown = searchable && q
    ? opts.filter((o) => (o.label ?? o.value).toLowerCase().includes(q.toLowerCase()))
    : opts;

  return (
    <div className={`b-subselect ${chosen ? "is-made" : "is-unmade"} ${className}`}>
      {prompt && (
        <div className="b-subselect-prompt">
          <span>{prompt}</span>
          {showBadge && (chosen
            ? <span className="b-subselect-made">✓ chosen</span>
            : <span className="b-subselect-badge">Choose</span>)}
        </div>
      )}
      {searchable && (
        <input
          className="b-subselect-search"
          type="text"
          placeholder={chosen ? `${chosen} — search to change…` : `Search ${opts.length} options…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <div className={`b-subselect-chips ${searchable ? "is-scroll" : ""}`}>
        {shown.map((o) => {
          const isOn = chosen === o.value;
          return (
            <button
              key={o.value}
              type="button"
              className={`b-subselect-chip ${isOn ? "is-on" : ""}`}
              aria-pressed={isOn}
              onClick={() => onChange(isOn && allowClear ? null : o.value)}
            >
              {o.label ?? o.value}
              {o.free && <span className="b-subselect-free">free</span>}
              {o.hint && <span className="b-subselect-hint">{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
