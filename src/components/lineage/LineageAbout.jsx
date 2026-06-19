// "About this lineage" — a home for the lineage's own lore, collapsed to a one-line
// peek by default (so it doesn't crowd the workspace) and expandable to the full
// text. When the lineage carries a structured costuming requirement, its live
// met/unmet status shows here too. Both lore and costumeReq hide cleanly when the
// data lacks them (costumeReq isn't in the data yet — a parser follow-up).
import React from "react";

export default function LineageAbout({ name, description, costume }) {
  // Strip the "Costuming Challenge: …" sentence from the lore — we render the
  // costuming requirement separately (structured, below), so leaving it in the
  // description showed the text twice (e.g. Chimera).
  const lore = (description || "")
    .replace(/\s*Costuming Challenge:[\s\S]*$/i, "")
    .trim();
  if (!lore && !costume) return null;
  const peek = lore.replace(/\s+/g, " ").slice(0, 80);

  return (
    <details className="b-lin-about">
      <summary>
        <span className="b-lin-about-caret">▶</span>
        <span className="b-lin-about-title">About the {name}</span>
        {peek && <span className="b-lin-about-peek">— {peek}…</span>}
      </summary>
      {lore && <p className="b-lin-about-full">{lore}</p>}
      {costume && (
        <p className={`b-lin-about-cost ${costume.met ? "is-met" : "is-unmet"}`}>
          🎭 Costuming{costume.req.difficulty ? ` (${costume.req.difficulty})` : ""}: {costume.req.text}{" "}
          <span className="b-lin-about-cost-state">{costume.met ? "✓ met" : `— ${costume.label}`}</span>
        </p>
      )}
    </details>
  );
}
