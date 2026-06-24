import React, { useState, useMemo, useCallback } from "react";
import { getAllEntities, lookupEntity } from './engine/data.js';
import { cleanItemName } from "./engine/resolver.js";
import { EntityBody } from "./components/DetailPane.jsx";
import { browse, gameEffectAxes, axisApplies } from "./components/browse/browse.js";
import "./RulesExplorer.css";

const HIGH_LEVEL_GROUPS = [
  { id: "all", label: "All Rules" },
  { id: "character", label: "Abilities & Classes" },
  { id: "powers", label: "Powers & Spells" },
  { id: "crafting", label: "Crafting & Rituals" },
  { id: "rules", label: "Rules & Reference" },
];

const GROUP_TYPES = {
  character: ["skills", "perks", "flaws", "classes", "devotions", "domains"],
  powers: ["powers"],
  crafting: ["recipes", "rituals", "crafting-concepts", "ritual-concepts"],
  rules: [
    "rules-concepts", "terms", "effects", "accents", "resources", 
    "modifiers", "conditions", "defenses", "creature-types"
  ],
};

const TYPE_LABELS = {
  skills: "Skills",
  perks: "Perks",
  flaws: "Flaws",
  powers: "Powers & Spells",
  classes: "Classes & Specs",
  devotions: "Devotions",
  domains: "Divine Domains",
  recipes: "Recipes (Crafting)",
  rituals: "Rituals (Mystic)",
  "rules-concepts": "Rules Concepts",
  terms: "Glossary Terms",
  effects: "Accents & Effects",
  accents: "Accents",
  resources: "Resources",
  modifiers: "Modifiers",
  conditions: "Conditions",
  defenses: "Defenses",
  "crafting-concepts": "Crafting Concepts",
  "ritual-concepts": "Ritual Concepts",
  "creature-types": "Creature Types",
};

// The explorer's own group axes (by type / A–Z / ungrouped), plus the shared
// game-effect axes — so browsing the rules can group powers/effects by what they DO
// in play (Effect / Damage type / Condition), exactly like the power picker.
const EXPLORER_AXES = [
  { id: "type", label: "By Type", key: (e) => TYPE_LABELS[e.type] || e.type, order: (l) => l, },
  { id: "alphabetical", label: "A–Z", key: (e) => (e.name[0] || "#").toUpperCase() },
  { id: "none", label: "Ungrouped", key: () => "Results" },
  ...gameEffectAxes((e) => e.type),
];

export default function RulesExplorer({ onClose }) {
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [selectedTypes, setSelectedTypes] = useState([]);
  
  // Navigation stack for back button support
  const [history, setHistory] = useState([]);
  
  // Selected entity ID
  const [selectedId, setSelectedId] = useState("rules-concepts:Introduction");
  
  // Sort and Group controls
  const [sortMode, setSortMode] = useState("name"); // "name" | "type"
  const [groupMode, setGroupMode] = useState("type"); // "none" | "type" | "alphabetical"

  // Fetch all entities
  const allEntities = useMemo(() => getAllEntities(), []);

  // Drill-down types based on the selected high-level group
  const availableTypes = useMemo(() => {
    if (activeGroup === "all") {
      return Object.keys(TYPE_LABELS);
    }
    return GROUP_TYPES[activeGroup] || [];
  }, [activeGroup]);

  // Handle high-level group change
  const handleGroupChange = (groupId) => {
    setActiveGroup(groupId);
    setSelectedTypes([]);
  };

  // Toggle type filter checkbox
  const handleTypeToggle = (type) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // Navigation handlers
  const handleInspect = useCallback((name, field, type) => {
    // Resolve the clean name / entity
    const cleanName = cleanItemName(name);
    const resolved = lookupEntity(`${type}:${cleanName}`) 
      || lookupEntity(`skills:${cleanName}`)
      || lookupEntity(`perks:${cleanName}`)
      || lookupEntity(`powers:${cleanName}`)
      || lookupEntity(`rules-concepts:${cleanName}`);
      
    if (resolved) {
      setHistory((prev) => [...prev, selectedId]);
      setSelectedId(resolved.id);
    }
  }, [selectedId]);

  const handleBack = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      setSelectedId(prev[prev.length - 1]);
      return prev.slice(0, -1);
    });
  };

  const handleSelectEntity = (id) => {
    setHistory([]);
    setSelectedId(id);
  };

  // The candidates after the sidebar's group/type filters (search + grouping/sorting
  // is then handled by the shared browse() engine).
  const candidates = useMemo(() => {
    let list = allEntities;
    if (activeGroup !== "all") {
      const allowedTypes = GROUP_TYPES[activeGroup] || [];
      list = list.filter((e) => allowedTypes.includes(e.type));
    }
    if (selectedTypes.length > 0) {
      list = list.filter((e) => selectedTypes.includes(e.type));
    }
    return list;
  }, [allEntities, activeGroup, selectedTypes]);

  // Only offer a game-effect group axis when some visible entity carries that facet.
  const availableAxes = useMemo(
    () => EXPLORER_AXES.filter((a) => axisApplies(a, candidates)),
    [candidates],
  );

  const { groups: groupedEntities } = useMemo(
    () => browse({
      items: candidates,
      axes: availableAxes,
      groupBy: groupMode,
      query,
      matches: (e, q) =>
        e.name.toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q) ||
        (e.summary || "").toLowerCase().includes(q),
      sort: sortMode,
      compare: (a, b, s) =>
        s === "type"
          ? (TYPE_LABELS[a.type] || a.type).localeCompare(TYPE_LABELS[b.type] || b.type) ||
            a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    }),
    [candidates, availableAxes, groupMode, query, sortMode],
  );

  // Resolved entity to display on the right
  const currentEntity = useMemo(() => {
    return lookupEntity(selectedId);
  }, [selectedId]);

  return (
    <div className="b-explorer">
      {/* Search and Navigation Panel */}
      <div className="b-explorer-layout">
        
        {/* SIDEBAR: Filters */}
        <aside className="b-explorer-sidebar">
          <div className="b-sidebar-section">
            <h3 className="b-sidebar-title">Categories</h3>
            <div className="b-group-tabs">
              {HIGH_LEVEL_GROUPS.map((g) => (
                <button
                  key={g.id}
                  className={`b-group-tab ${activeGroup === g.id ? "is-active" : ""}`}
                  onClick={() => handleGroupChange(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="b-sidebar-section">
            <h3 className="b-sidebar-title">Filter by Type</h3>
            <div className="b-type-filters">
              {availableTypes.map((type) => (
                <label key={type} className="b-type-checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(type)}
                    onChange={() => handleTypeToggle(type)}
                  />
                  <span>{TYPE_LABELS[type]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="b-sidebar-section">
            <h3 className="b-sidebar-title">Display Options</h3>
            <div className="b-explorer-sortrow">
              <label className="b-explorer-sortlabel">Group
                <select
                  className="b-explorer-sortsel"
                  value={groupMode}
                  onChange={(e) => setGroupMode(e.target.value)}
                >
                  {availableAxes.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </label>
              <label className="b-explorer-sortlabel">Sort
                <select
                  className="b-explorer-sortsel"
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value)}
                >
                  <option value="name">Alphabetical</option>
                  <option value="type">By Type</option>
                </select>
              </label>
            </div>
          </div>
        </aside>

        {/* MIDDLE: List of entities */}
        <div className="b-explorer-browse">
          <div className="b-explorer-search-bar">
            <input
              className="b-explorer-search"
              type="text"
              placeholder="Search concepts, skills, powers, rules..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button className="b-search-clear" onClick={() => setQuery("")}>×</button>
            )}
          </div>

          <div className="b-explorer-list-container">
            {groupedEntities.length === 0 && (
              <p className="b-explorer-empty">No rules found matching that search or filter.</p>
            )}
            {groupedEntities.map(({ key: groupName, items }) => (
              <div key={groupName} className="b-explorer-group">
                <h4 className="b-explorer-group-label">{groupName}</h4>
                <ul className="b-explorer-items">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        className={`b-explorer-row ${selectedId === item.id ? "is-selected" : ""}`}
                        onClick={() => handleSelectEntity(item.id)}
                      >
                        <span className="b-explorer-row-name">{item.name}</span>
                        <span className="b-explorer-row-badge">{TYPE_LABELS[item.type] || item.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Detail reader */}
        <div className="b-explorer-read">
          {currentEntity ? (
            <div className="b-explorer-detail-container">
              <header className="b-explorer-detail-head">
                <div className="b-detail-nav">
                  {history.length > 0 ? (
                    <button className="b-detail-back" onClick={handleBack}>
                      ‹ back to {lookupEntity(history[history.length - 1])?.name || "previous"}
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                <h2 className="b-explorer-detail-title">{currentEntity.name}</h2>
                <div className="b-explorer-detail-badges">
                  <span className="b-explorer-detail-type-badge">
                    {TYPE_LABELS[currentEntity.type] || currentEntity.type}
                  </span>
                  {currentEntity.tier && (
                    <span className="b-explorer-detail-tier-badge">{currentEntity.tier}</span>
                  )}
                </div>
              </header>
              <div className="b-explorer-detail-body">
                <EntityBody
                  entity={currentEntity}
                  view={{ item: currentEntity.name, field: null, resolveType: currentEntity.type }}
                  report={null}
                  choices={null}
                  onSetChoice={null}
                  onUpdateParameter={null}
                  onInspect={handleInspect}
                />
              </div>
            </div>
          ) : (
            <div className="b-explorer-detail-empty">
              <p className="b-detail-hint">Select a rule or concept from the list to read it.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
