// Step 1 — Browse (pain #5: discovery). A searchable/sortable gallery of lineage
// cards, each surfacing lore, the costuming cost, and its sublineages, so you can
// learn what a lineage IS before committing.
import React, { useState, useMemo } from "react";
import { LINEAGES } from "../../engine/data.js";
import { lineageTagline, parseSublineage } from "./lineage-helpers.js";

export default function LineageGallery({ onPick }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");

  const cards = useMemo(() => {
    const list = Object.entries(LINEAGES).map(([name, lin]) => ({
      name,
      lin,
      tagline: lineageTagline(lin),
      nChallenges: (lin.challenges || []).length,
      nAdvantages: (lin.advantages || []).length,
    }));
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.lin.description || "").toLowerCase().includes(q) ||
            c.tagline.toLowerCase().includes(q),
        )
      : list;
    filtered.sort((a, b) =>
      sort === "options"
        ? b.nChallenges + b.nAdvantages - (a.nChallenges + a.nAdvantages)
        : a.name.localeCompare(b.name),
    );
    return filtered;
  }, [query, sort]);

  return (
    <div className="b-lin-gallery">
      <div className="b-lin-gallery-controls">
        <input
          className="b-lin-search"
          type="search"
          placeholder="Search lineages by name, lore, or sublineage…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search lineages"
          autoFocus
        />
        <label className="b-lin-sort">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">A–Z</option>
            <option value="options">Most options</option>
          </select>
        </label>
      </div>

      <div className="b-lin-gallery-grid">
        {cards.map(({ name, lin, tagline, nChallenges, nAdvantages }) => (
          <button key={name} className="b-lin-gallery-card" onClick={() => onPick(name)}>
            <span className="b-lin-gallery-name">{name}</span>
            {tagline && <span className="b-lin-gallery-subs">{tagline}</span>}
            {lin.description && <span className="b-lin-gallery-lore">{lin.description}</span>}
            {lin.costume?.difficulty && (
              <span className="b-lin-gallery-cost">
                🎭 Costuming: {lin.costume.difficulty}
                {lin.costume.minRepped > 0 ? ` · ${lin.costume.minRepped} [Repped]` : ""}
              </span>
            )}
            <span className="b-lin-gallery-counts">
              {nChallenges} challenges · {nAdvantages} advantages
            </span>
          </button>
        ))}
        {cards.length === 0 && <p className="b-empty">No lineages match “{query}”.</p>}
      </div>
    </div>
  );
}
