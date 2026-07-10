import { useMemo } from "react";
import { ARCHETYPES } from "../../engine/data.js";
import { getClasses } from "../../engine/resolver.js";
import Tag from "./Tag.jsx";

export default function ArchetypePicker({ onPick, onStartBlank }) {
  const byClass = useMemo(() => {
    const map = new Map();
    for (const a of ARCHETYPES) {
      // Group by the archetype's primary class (classes is the {name, level}[] shape).
      const cls = getClasses(a)[0]?.name || "Other";
      if (!map.has(cls)) map.set(cls, []);
      map.get(cls).push(a);
    }
    return [...map.entries()];
  }, []);

  return (
    <main className="b-sheet">
      <header className="b-sheet-header">
        <h1 className="b-sheet-title">Pick a starting character</h1>
        <p className="b-sheet-tagline">
          New to Wellspring? Any of these gives you a complete, legal level-4 character. You can tweak anything
          afterward — or start blank to build from scratch.
        </p>
      </header>

      <section className="b-section">
        <button className="b-blank-button" onClick={onStartBlank}>
          Start blank — I want full control
        </button>
      </section>

      {byClass.map(([cls, archetypes]) => (
        <section key={cls} className="b-section">
          <h2 className="b-section-title b-section-amber">{cls}</h2>
          <div className="b-archetype-grid">
            {archetypes.map((a) => (
              <button key={a.name} className="b-archetype-card" onClick={() => onPick(a)}>
                <span className="b-archetype-name">{a.name}</span>
                <span className="b-archetype-tagline">{a.tagline}</span>
                <span className="b-archetype-meta">
                  {a.specialization && <Tag label={a.specialization} tone="amber" />}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
