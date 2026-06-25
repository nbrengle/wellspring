// The ONE sub-selection control. Across the builder a player makes several kinds of
// "pick one" choice — a build chooseOne power (Way of the Blade), a class starting
// specialty, a granted selection (devotion accent / granted power), a lineage
// sub-choice (cantrip / flavor), and skill parameters (Weapon Specialization, Lore,
// Extensive Training's class, a Bookcaster spell). All standardized onto chips:
//
//   • every option is a visible chip (no buried dropdown)
//   • a chosen chip is highlighted; clicking it again clears (when allowClear)
//   • options that grant something free show a "free" hint
//   • an unmade pick shows an amber "Choose" badge so it's obvious
//   • allowCustom adds a "type your own" chip → inline text entry, so free-text and
//     suggested-but-typeable params (Lore, Profession) are still chips
//   • big pools (cantrip/spell lists, 18–65) fall back to a search box + scroll
//   • options may be grouped ([{ label, options }]) — Bookcaster's known/other
//
// Options: [{ value, label?, free?, hint? }] or plain strings; or grouped:
// [{ label, options: [...] }]. `value` is what's stored.
import React, { useState } from "react";

const normOpt = (o) => (typeof o === "string" ? { value: o, label: o } : { label: o.value, ...o });

// Accept flat options OR grouped [{label, options}]; return [{label, options:[norm]}].
function normalizeGroups(options) {
  if (!options?.length) return [];
  if (options[0] && typeof options[0] === "object" && "options" in options[0]) {
    return options.map((g) => ({ label: g.label, options: (g.options || []).map(normOpt) }));
  }
  return [{ label: null, options: options.map(normOpt) }];
}

export default function SubSelect({
  options,
  value,
  onChange,
  prompt,
  showBadge = true,
  allowClear = true,
  // Add a "type your own" chip → inline input. The current value still shows as a
  // selected custom chip even if it isn't in the option list.
  allowCustom = false,
  customLabel = "Type your own…",
  // Above this many options, chips become a wall → search box + scroll.
  searchAbove = 12,
  className = "",
}) {
  const groups = normalizeGroups(options);
  const allOpts = groups.flatMap((g) => g.options);
  const total = allOpts.length;
  const chosen = value || null;
  const [q, setQ] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const searchable = total > searchAbove;

  // A chosen value not present in the option list is a custom entry — surface it as a
  // selected chip so it's visible and clearable.
  const chosenIsListed = allOpts.some((o) => o.value === chosen);
  const customChosen = allowCustom && chosen && !chosenIsListed;

  const filt = (opts) =>
    searchable && q ? opts.filter((o) => (o.label ?? o.value).toLowerCase().includes(q.toLowerCase())) : opts;

  const Chip = (o) => {
    const isOn = chosen === o.value;
    return (
      <button key={o.value} type="button" aria-pressed={isOn}
        className={`b-subselect-chip ${isOn ? "is-on" : ""}`}
        onClick={() => onChange(isOn && allowClear ? null : o.value)}>
        {o.label ?? o.value}
        {o.free && <span className="b-subselect-free">free</span>}
        {o.hint && <span className="b-subselect-hint">{o.hint}</span>}
      </button>
    );
  };

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
        <input className="b-subselect-search" type="text"
          placeholder={chosen ? `${chosen} — search to change…` : `Search ${total} options…`}
          value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <div className={`b-subselect-chips ${searchable ? "is-scroll" : ""}`}>
        {groups.map((g, gi) => {
          const opts = filt(g.options);
          if (!opts.length) return null;
          return (
            <React.Fragment key={g.label || gi}>
              {g.label && <span className="b-subselect-grouplabel">{g.label}</span>}
              {opts.map(Chip)}
            </React.Fragment>
          );
        })}

        {/* The current value, when it's a custom (non-listed) entry. */}
        {customChosen && Chip({ value: chosen, label: chosen })}

        {/* "Type your own" — a chip that opens an inline input. */}
        {allowCustom && (customOpen ? (
          <input className="b-subselect-custom-input" type="text" autoFocus
            placeholder={customLabel}
            defaultValue={customChosen ? chosen : ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") { const v = e.target.value.trim(); if (v) onChange(v); setCustomOpen(false); }
              if (e.key === "Escape") setCustomOpen(false);
            }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v) onChange(v); setCustomOpen(false); }} />
        ) : (
          <button type="button" className="b-subselect-chip is-custom" onClick={() => setCustomOpen(true)}>
            ✎ {customLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
