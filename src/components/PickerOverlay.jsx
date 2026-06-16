import React, { useState, useMemo, useEffect } from "react";
import { REFS, lookupEntity, UNLIMITED_SKILLS } from '../engine/data.js';
import { prereqStatus } from "../engine/validate.js";
import { EntityBody } from "./DetailPane.jsx";

function Tag({ label, tone = "amber" }) {
  return <span className={`b-tag b-tag-${tone}`}>{label}</span>;
}

function CostBadge({ cost }) {
  if (cost === "Var") return <Tag label="variable BP" tone="amber" />;
  if (cost) return <Tag label={`${cost} BP`} tone="indigo" />;
  return null;
}

const spellTierKey = (c) => {
  const t = c.tierList || "";
  if (/novice/i.test(t)) return "novice";
  if (/adept/i.test(t)) return "adept";
  if (/greater/i.test(t)) return "greater";
  if (/cantrip/i.test(t)) return "cantrip";
  return null;
};

const spellTierLabel = (c) => {
  const k = spellTierKey(c);
  if (k === "novice") return "Novice";
  if (k === "adept") return "Adept";
  if (k === "greater") return "Greater";
  if (k === "cantrip") return "Cantrip";
  return "";
};

const refreshBucket = (c) => {
  const r = (c.refresh || "").toLowerCase();
  if (!r || r === "none" || r === "passive") return "Passive";
  if (r.includes("long")) return "Long Rest";
  if (r.includes("short")) return "Short Rest";
  if (r.includes("immediate")) return "Immediate";
  return c.refresh;
};

function candidateEffects(c) {
  const id = `${/powers/.test(c.tierList || "") || c.tier ? "powers" : c.cat ? "skills" : "powers"}:${c.name}`;
  const refs = (REFS.mentions && (REFS.mentions[`powers:${c.name}`] || REFS.mentions[id])) || [];
  return refs.filter((t) => /^(effects|conditions|defenses):/.test(t)).map((t) => t.slice(t.indexOf(":") + 1));
}

const primaryEffect = (c) => candidateEffects(c)[0] || "—";

const SPELL_TIER_BUCKET = { noviceSpells: "Novice", adeptSpells: "Adept", greaterSpells: "Greater", cantrips: "Cantrip" };

const GROUP_AXES = {
  tier: { label: "Tier", fn: (c) => SPELL_TIER_BUCKET[c.tierList] || c.tier || "—" },
  category: { label: "Category", fn: (c) => c.cat || c.tierList || "Other" },
  refresh: { label: "Refresh", fn: refreshBucket },
  effect: { label: "Effect", fn: primaryEffect },
  alphabetical: { label: "A–Z", fn: (c) => (c.name[0] || "#").toUpperCase() },
  cost: { label: "Cost", fn: (c) => (typeof c.cost === "number" ? `${c.cost} BP` : "—") },
};

export default function PickerOverlay({ spec, character, onClose }) {
  const { entityType, title, subtitle, candidates, taken, onChoose } = spec;

  const [query, setQuery] = useState("");
  const [hideLocked, setHideLocked] = useState(false);
  const [selected, setSelected] = useState(candidates[0]?.name || null);
  const isSpells = candidates.some((c) => c.tierList && SPELL_TIER_BUCKET[c.tierList]);
  const hasRefresh = candidates.some((c) => c.refresh && c.refresh !== "None");
  const [groupMode, setGroupMode] = useState(isSpells ? "tier" : hasRefresh ? "refresh" : "category");
  const [sortMode, setSortMode] = useState("name");
  const [readStack, setReadStack] = useState([]);

  const lockedOf = (name) => !prereqStatus(character, `${entityType}:${name}`).met;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = candidates;
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.desc || "").toLowerCase().includes(q));
    const decorated = list.map((c) => ({ ...c, locked: lockedOf(c.name) }));
    const keyFn = (GROUP_AXES[groupMode] || GROUP_AXES.category).fn;
    const buckets = new Map();
    for (const c of decorated) {
      const k = keyFn(c);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
    let entries = [...buckets.entries()];
    if (hideLocked) entries = entries.map(([g, cs]) => [g, cs.filter((c) => !c.locked)]).filter(([, cs]) => cs.length);
    const cmp = sortMode === "cost"
      ? (a, b) => (a.cost ?? 999) - (b.cost ?? 999) || a.name.localeCompare(b.name)
      : sortMode === "effect"
        ? (a, b) => candidateEffects(b).length - candidateEffects(a).length || a.name.localeCompare(b.name)
        : (a, b) => a.name.localeCompare(b.name);
    for (const [, cs] of entries) cs.sort(cmp);
    if (groupMode === "alphabetical") entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  }, [candidates, query, hideLocked, character, entityType, groupMode, sortMode]);

  const readingEntity = useMemo(() => {
    if (readStack.length) return lookupEntity(readStack[readStack.length - 1]);
    return selected ? lookupEntity(`${entityType}:${selected}`) : null;
  }, [readStack, selected, entityType]);

  const selectCandidate = (name) => { setSelected(name); setReadStack([]); };
  const followLink = (name, _field, type) => setReadStack((s) => [...s, `${type}:${name}`]);
  const readBack = () => setReadStack((s) => s.slice(0, -1));
  const isFollowing = readStack.length > 0;
  const selectedLocked = selected && lockedOf(selected);
  const selectedTaken = selected && taken.has(selected) && !UNLIMITED_SKILLS.has(selected);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="b-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="b-picker" onClick={(e) => e.stopPropagation()}>
        <header className="b-picker-head">
          <div>
            <h2 className="b-picker-title">{title}</h2>
            <p className="b-picker-sub">{subtitle}</p>
          </div>
          <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="b-picker-cols">
          <div className="b-picker-browse">
            <div className="b-picker-controls">
              <input className="b-picker-search" type="text" aria-label="Search" placeholder="Search…"
                     value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
              <div className="b-picker-sortrow">
                <label className="b-picker-sortlabel">Group
                  <select className="b-picker-sortsel" value={groupMode} onChange={(e) => setGroupMode(e.target.value)}>
                    {Object.entries(GROUP_AXES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                <label className="b-picker-sortlabel">Sort
                  <select className="b-picker-sortsel" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                    <option value="name">A–Z</option>
                    <option value="cost">Cost</option>
                    <option value="effect">Effect richness</option>
                  </select>
                </label>
                <label className="b-picker-toggle">
                  <input type="checkbox" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />
                  Hide locked
                </label>
              </div>
            </div>
            <div className="b-picker-groups">
              {groups.length === 0 && <p className="b-detail-missing">Nothing matches.</p>}
              {groups.map(([group, items]) => (
                <div key={group} className="b-picker-group">
                  <h3 className="b-picker-group-label">{group}</h3>
                  <ul className="b-picker-names">
                    {items.map((c) => {
                      const isTaken = taken.has(c.name);
                      return (
                        <li key={c.name}>
                          <button
                            className={`b-picker-row ${selected === c.name ? "is-selected" : ""} ${c.locked ? "is-locked" : ""} ${isTaken ? "is-taken" : ""}`}
                            onClick={() => selectCandidate(c.name)}>
                            <span className="b-picker-row-name">{c.name}</span>
                            {spellTierKey(c) && <span className={`b-picker-row-tier b-tier-${spellTierKey(c)}`}>{spellTierLabel(c)}</span>}
                            {typeof c.cost === "number" && c.cost > 0 && <span className="b-picker-row-cost">{c.cost} BP</span>}
                            {typeof c.cost === "string" && /^var/i.test(c.cost) && <span className="b-picker-row-cost">Var BP</span>}
                            {typeof c.bp === "number" && c.bp > 0 && <span className="b-picker-row-cost is-award">+{c.bp} BP</span>}
                            {c.locked && <span className="b-picker-row-tag b-locked">locked</span>}
                            {isTaken && <span className="b-picker-row-tag b-chosen">chosen</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="b-picker-read">
            {readingEntity ? (
              <>
                <header className="b-read-head">
                  {isFollowing && <button className="b-detail-back" onClick={readBack}>‹ back to {selected}</button>}
                  <h2 className="b-read-title">{readingEntity.name}</h2>
                  <p className="b-detail-type">{readingEntity.type}{readingEntity.tier ? ` · ${readingEntity.tier}` : ""}</p>
                </header>
                <div className="b-read-body">
                  <EntityBody entity={readingEntity} onInspect={followLink} />
                </div>
                {!isFollowing && (
                  <footer className="b-read-foot">
                    {selectedLocked && (
                      <p className="b-read-warn">Prereqs not met — you can still choose it, but the build won't be legal.</p>
                    )}
                    <button className="b-read-choose" disabled={selectedTaken}
                            onClick={() => onChoose(selected)}>
                      {selectedTaken ? "Already chosen" : `Choose ${selected}`}
                    </button>
                  </footer>
                )}
              </>
            ) : (
              <p className="b-detail-hint">Select an option on the left to read it.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
