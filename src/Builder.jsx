// Builder — single-page character creator. State lives in the URL so any
// character is shareable / bookmarkable. Three panes side-by-side on desktop:
// identity (left), build sheet (center), detail (right). On narrow screens
// the detail pane becomes an overlay.
//
// Powers are built through SLOTS, not flat lists: a class grants N positions per
// tier (2 Utility, 2 Basic, …). Each slot is a fixed row — filled rows show the
// chosen power, empty rows invite a pick. Picking happens in the detail pane,
// which doubles as the entity inspector so you can follow a power's links
// (prereqs / unlocks / mentions) while deciding.

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ARCHETYPES, REFS, lookupEntity, LEVEL_TABLE,
  eligiblePowers, ALL_SKILLS, ALL_PERKS, ALL_FLAWS,
  CLASS_POWER_SLOTS, CLASSES, DEVOTIONS, DOMAINS, LINEAGES, META,
  CLASS_POWERS,
} from "./data/index.js";
import { validate, characterLevel, prereqStatus, pickClass, getClasses, MAX_DOMAINS, subKey, EVENTS_TABLE } from "./data/validate.js";
import { formatCharacterSheet, parseCharacterSheet } from "./data/sheet.js";
import "./Builder.css";

// ─── CHARACTER STATE ────────────────────────────────────────────────────────
// A character is a flat object that mirrors the archetype shape so loading
// from an archetype is a direct copy. Anything missing means "no choice yet".

// Default starting Wealth (MegaDoc: "all characters start with 8 Wealth").
const DEFAULT_WEALTH = 8;

const BASE_STARTING_SKILLS = {
  Artisan: ["Basic Martial Weapons", "Short Weapons", "Basic Armor"],
  Cleric: ["Basic Faith", "Worship", "Basic Martial Weapons", "Basic Armor"],
  Druid: ["Basic Martial Weapons", "Profession - Apprentice (your choice)", "Basic Faith"],
  Fighter: ["Basic Martial Weapons", "Basic Shields", "Basic Armor", "Light Armor"],
  Mage: ["Basic Arcane", "Library Use", "Bookcaster", "Bookcaster"],
  Rogue: ["Basic Martial Weapons", "Thrown Weapons", "Basic Armor", "Light Armor"],
  Socialite: ["Basic Martial Weapons", "Library Use", "Poisoner", "Basic Armor"],
  Sourcerer: ["Basic Arcane", "Warcaster"]
};
const PARAMETER_SUGGESTIONS = {
  "Lore": ["Historical", "Nature", "Noble", "Religious", "Ritual", "Shadow", "Arcane"],
  "Worship": ["The Mother", "The Steed", "Senri, Voice of Mercy", "Dorne, Bringer of Law", "Filian, Keeper of the Hearth", "Mille, Muse of Creation", "The Song in Iron", "Dave", "The Great Mind", "Druidism", "The Howl at the End", "The Divine Bloom", "The Witch of Webs", "The Pale Star", "Devourer", "The Librarian", "Wildfire", "The Dancer"],
  "Patron": ["The Mother", "The Steed", "Senri, Voice of Mercy", "Dorne, Bringer of Law", "Filian, Keeper of the Hearth", "Mille, Muse of Creation", "The Song in Iron", "Dave", "The Great Mind", "Druidism", "The Howl at the End", "The Divine Bloom", "The Witch of Webs", "The Pale Star", "Devourer", "The Librarian", "Wildfire", "The Dancer"],
  "Profession - Apprentice": ["Smith", "Carpenter", "Tailor", "Mason", "Hunter", "Scribe", "Herbalist", "Undertaker", "Merchant", "Charlatan", "Chirurgeon", "Teacher", "Soldier", "Sailor", "Wagoneer"],
  "Profession - Journeyman": ["Smith", "Carpenter", "Tailor", "Mason", "Hunter", "Scribe", "Herbalist", "Undertaker", "Merchant", "Charlatan", "Chirurgeon", "Teacher", "Soldier", "Sailor", "Wagoneer"],
  "Profession - Master": ["Smith", "Carpenter", "Tailor", "Mason", "Hunter", "Scribe", "Herbalist", "Undertaker", "Merchant", "Charlatan", "Chirurgeon", "Teacher", "Soldier", "Sailor", "Wagoneer"],
  "Chronic Hobbyist": ["Cooking", "Brewing", "Gardening", "Smith", "Carpenter", "Tailor", "Mason", "Hunter", "Scribe", "Herbalist", "Undertaker", "Merchant", "Charlatan", "Chirurgeon", "Teacher", "Soldier", "Sailor", "Wagoneer"],
  "Bookcaster": ["Magekey", "Mask Aura", "Identify", "Cancel", "Stop", "Mageskin"],
  "Favored Form": ["Hunting Panther", "Hulking Bear", "Striking Serpent"]
};

function formatParameterizedName(baseName, parameter, originalName) {
  if (!parameter) return baseName;
  if (originalName) {
    if (originalName.includes(" - ")) {
      return `${baseName} - ${parameter}`;
    }
    if (originalName.includes("(")) {
      return `${baseName} (${parameter})`;
    }
  }
  return `${baseName} (${parameter})`;
}

function applyClassStartingAbilities(character, className, level = 1) {
  const isPrimary = character.classes?.[0]?.name === className;
  const skillsToAdd = isPrimary ? (BASE_STARTING_SKILLS[className] || []) : [];
  const nextStarting = [...(character.startingSkills || [])];
  for (const s of skillsToAdd) {
    if (!nextStarting.includes(s)) nextStarting.push(s);
  }

  // Gather active innate powers from ALL classes on the character
  const activeInnateNames = new Set();
  for (const c of character.classes || []) {
    const innate = CLASS_POWERS[c.name]?.innate || [];
    for (const p of innate) {
      const reqMatch = String(p.requirement || p.tier || '').match(/\b(?:L|level)\s*(\d+)\b/i)
        || String(p.prereq || p.prerequisites || '').match(/\b(?:L|level)\s*(\d+)\b/i);
      const reqLvl = reqMatch ? parseInt(reqMatch[1], 10) : 1;
      const effectiveLvl = c.name === className ? level : c.level;
      if (effectiveLvl >= reqLvl) {
        activeInnateNames.add(p.name);
      }
    }
  }

  const allClassInnateNames = new Set(
    (character.classes || []).flatMap(c => (CLASS_POWERS[c.name]?.innate || []).map(p => p.name))
  );

  // Keep user-added innate powers (which are not class-innate)
  // and add all active class-innate powers.
  const nextInnate = (character.innatePowers || []).filter(name => !allClassInnateNames.has(name));
  for (const name of activeInnateNames) {
    if (!nextInnate.includes(name)) {
      nextInnate.push(name);
    }
  }

  return {
    ...character,
    startingSkills: nextStarting,
    innatePowers: nextInnate,
  };
}

const EMPTY_CHARACTER = {
  name: "",
  archetypeName: null,       // which archetype this was loaded from (for the badge)
  classLevels: null,         // "Cleric 4" — single class for now
  specialization: null,      // "Mystic" / "Crafter" / "Artificer" — only for Artisan
  lineage: null,             // "Human" / "Aewen" / ...
  sublineage: null,
  devotion: null,            // for clerics: "The Mother" / "Senri" / ...
  lifePoints: null,
  armorPoints: null,
  spikes: null,
  wealth: null,              // null → DEFAULT_WEALTH (8); perks/sheet may set it
  resources: null,           // free-form, from the sheet
  startingSkills: [],
  purchasedSkills: [],
  purchasedPerks: [],
  flaws: [],
  innatePowers: [], utilityPowers: [], basicPowers: [],
  advancedPowers: [], veteranPowers: [], classPowers: [],
  rightHandPowers: [], cantrips: [],
  noviceSpells: [], adeptSpells: [], greaterSpells: [], bookSpells: [],
  domainPowers: [], formPowers: [],
};

// Load an archetype into character state — straight copy of the relevant
// fields, plus the archetypeName badge so the UI can show "Based on X".
function loadArchetype(archetype) {
  const c = { ...EMPTY_CHARACTER, archetypeName: archetype.name };
  for (const k of Object.keys(EMPTY_CHARACTER)) {
    if (k === "archetypeName") continue;
    if (archetype[k] !== undefined) c[k] = archetype[k];
  }
  // Preserve the parser's grant / effectiveBP sidecars so the validator can
  // honor them; they aren't part of EMPTY_CHARACTER but ride along untouched.
  if (archetype.grants) c.grants = archetype.grants;
  if (archetype.effectiveBP) c.effectiveBP = archetype.effectiveBP;
  if (archetype.ranks) c.ranks = archetype.ranks;
  return c;
}

// ─── URL STATE ──────────────────────────────────────────────────────────────
// Character is base64-encoded JSON in the URL hash. Hash (not query) so the
// server never sees it and reloads stay client-side. encodeURIComponent
// handles slashes / quotes in entity names.

function readFromHash() {
  const h = window.location.hash.slice(1);
  if (!h) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(h))));
  } catch {
    return null;
  }
}

function writeToHash(character) {
  // Only write if there's meaningful state — otherwise leave the URL clean.
  if (!character.archetypeName && !character.name && character.startingSkills.length === 0) {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    return;
  }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(character))));
  window.history.replaceState(null, "", `${window.location.pathname}#${encoded}`);
}

// ─── SLOT MODEL ──────────────────────────────────────────────────────────────
// Map a validator slot category to the character field that stores its picks and
// a human label. Order controls how slot blocks appear in the build sheet.
const SLOT_FIELD = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
  cantrips: "cantrips",
  // spellsKnown picks land in noviceSpells for now (level-4 casters only learn
  // novice); higher tiers are out of scope for this pass.
  spellsKnown: "noviceSpells",
};

// Level bounds for the stepper. We don't ENFORCE a ceiling — the user can push
// levels up freely — but the validator FLAGS a total level above 10, since 10 is
// the current play cap (past 10 needs Advanced Classes, not yet published, and
// base progression tables stop at 10). The stepper goes down to level 1 for
// from-scratch builds; below the documented floor (4) the build is flagged.
const MAX_LEVEL = LEVEL_TABLE.length ? Math.max(...LEVEL_TABLE.map((l) => l.level)) : 15;
const MIN_LEVEL = 1;
const LEVEL_CAP = 10; // current total-level cap (flagged, not enforced)

// Human-readable list of why a build is illegal/flagged, drawn from the validator
// report. Empty when the build is clean. Shared by the import preview, top bar,
// and anywhere a "why isn't this legal?" explanation is useful.
function validityReasons(report) {
  if (!report) return [];
  const out = [];
  if (report.belowFloor) out.push(`Below the level-${report.legalMinLevel} minimum`);
  if (report.aboveCap) out.push(`Above the level-${report.levelCap} cap (Advanced Classes pending)`);
  if (report.overBudget) out.push(`Over budget by ${report.spend.net - report.budget} BP`);
  for (const s of report.slots || []) {
    if (s.over) out.push(`${s.label}: ${s.used}/${s.allowed} (over by ${s.used - s.allowed})`);
  }
  for (const iss of report.prereqs?.issues || []) {
    // Tier/level-gate issues carry a ready `text` ("tier 2 requires character
    // level 5") with no missing-skill lists; prereq issues carry missing/anyOf.
    if (iss.text && !iss.missing) { out.push(`${iss.item}: ${iss.text}`); continue; }
    const need = [
      ...(iss.missing || []).map((m) => m.name),
      ...(iss.anyOf || []).map((g) => g.map((m) => m.name).join(" or ")),
    ].join(", ");
    out.push(`${iss.item} needs: ${need}`);
  }
  const lbp = report.lbp;
  if (lbp) {
    if (lbp.overspent) out.push(`Lineage: ${lbp.spent - lbp.awarded} LBP overspent`);
    if (lbp.mixedSublineage) out.push("Lineage: items from more than one sublineage");
    if (lbp.needsSublineage) out.push(`Lineage: select the ${lbp.requiredSublineages.join("/")} sublineage to take its items`);
    if (lbp.missingRequired?.length) out.push(`Lineage: missing required ${lbp.missingRequired.map((c) => c.baseName).join(", ")}`);
  }
  return out;
}

// A short, clear label for what KIND of thing a grant source is, so "free ·
// Linked Armor" can read "free · Linked Armor (Utility Power)". Prefers the role
// the archetype note stated; otherwise resolves the source entity's type/tier.
function grantSourceRole(grant) {
  if (!grant?.source) return null;
  if (grant.sourceRole) {
    // Title-case the stated role ("utility power" → "Utility Power").
    return grant.sourceRole.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const ent = lookupEntity(`powers:${grant.source}`)
    || lookupEntity(`skills:${grant.source}`)
    || lookupEntity(`perks:${grant.source}`);
  if (!ent) return null;
  if (ent.type === "powers") return `${ent.tier || ""} Power`.trim();
  if (ent.type === "skills") return "Skill";
  if (ent.type === "perks") return "Perk";
  return null;
}

// Short spell-tier label for a candidate/entity (Novice / Adept / Greater /
// Cantrip), derived from the tierList field or the entity's tier. Returns null
// for non-spell things so the badge only appears on spells.
const SPELL_TIER_LABEL = {
  noviceSpells: "Novice", adeptSpells: "Adept", greaterSpells: "Greater", cantrips: "Cantrip",
};
// Tier key ("novice"/"adept"/"greater"/"cantrip") for color-coding, or null.
function spellTierKey(c) {
  if (!c) return null;
  if (c.tierList) return { noviceSpells: "novice", adeptSpells: "adept", greaterSpells: "greater", cantrips: "cantrip" }[c.tierList] || null;
  const t = (c.tier || "").toLowerCase();
  return ["novice", "adept", "greater", "cantrip"].includes(t) ? t : null;
}
function spellTierLabel(c) {
  const k = spellTierKey(c);
  return k ? k[0].toUpperCase() + k.slice(1) : null;
}

// ─── UI PRIMITIVES ──────────────────────────────────────────────────────────

function Tag({ label, tone = "amber" }) {
  return <span className={`b-tag b-tag-${tone}`}>{label}</span>;
}

// ─── IDENTITY RAIL ───────────────────────────────────────────────────────────
// Shows class/lineage/devotion as cards, stats as a strip, plus the live BP
// budget meter so spend is always visible.
function IdentityRail({ character, report, onClickField, onRestart,
                       onSetClassLevel, onRemoveClass, onAddClass,
                       onPickDevotion, onToggleDomain, onClearDevotion, onOpenLineage,
                       onToggleBackstory, onInspect, onSetEvent, onSetExtraBP }) {
  const classes = getClasses(character);
  return (
    <aside className="b-rail b-rail-left">
      <header className="b-rail-header">
        <h2 className="b-rail-title">Identity</h2>
        {character.archetypeName && (
          <p className="b-rail-sub">Based on <em>{character.archetypeName}</em></p>
        )}
      </header>

      {/* Event Selector card */}
      <div className="b-id-card is-set">
        <span className="b-id-icon">📅</span>
        <span className="b-id-body">
          <span className="b-id-label">Active Campaign Event</span>
          <select
            className="b-event-select"
            value={character.currentEvent || 1}
            onChange={(e) => onSetEvent && onSetEvent(parseInt(e.target.value, 10))}
          >
            {EVENTS_TABLE.map((evt) => (
              <option key={evt.event} value={evt.event}>
                Event {evt.event} (Level Floor {evt.level})
              </option>
            ))}
          </select>
        </span>
      </div>

      <ClassCard classes={classes} spec={character.specialization}
                 onSetLevel={onSetClassLevel} onRemove={onRemoveClass} onAdd={onAddClass}
                 onInspect={() => onClickField("class")} />

      {/* Lineage card — opens the lineage panel (challenges/advantages/LBP). */}
      <button className={`b-id-card ${character.lineage ? "is-set" : "is-empty"}`} onClick={onOpenLineage}>
        <span className="b-id-icon">🧬</span>
        <span className="b-id-body">
          <span className="b-id-label">Lineage</span>
          <span className="b-id-value">{character.lineage || <em>+ choose a lineage</em>}</span>
          {character.sublineage && <span className="b-id-sub">{character.sublineage}</span>}
          {report.lbp && (report.lbp.chosenChallenges.length > 0 || report.lbp.chosenAdvantages.length > 0) && (
            <span className={`b-id-sub ${report.lbp.valid ? "" : "b-lbp-warn"}`}
                  title={`${report.lbp.awarded} LBP earned from challenges − ${report.lbp.spent} spent on advantages`}>
              {report.lbp.remaining} LBP left
            </span>
          )}
        </span>
      </button>

      <DevotionCard character={character} devotion={report.devotion}
                    onPick={onPickDevotion} onToggleDomain={onToggleDomain}
                    onClear={onClearDevotion} onInspect={() => onClickField("devotion")} />

      <div className="b-stat-strip">
        <StatWithSources label="Life" title={statTitle(report.stats, "lifePoints", "Life Points")}
              value={report.stats?.lifePoints ?? character.lifePoints ?? "—"}
              base={report.stats?.baseLifePoints} baseLabel={`level ${report.level} base`}
              sources={statSources(report.stats, "lifePoints")} onInspect={onInspect} />
        <StatWithSources label="Spikes" title={statTitle(report.stats, "spikes", "Maximum Spikes")}
              value={report.stats?.spikes ?? character.spikes ?? "—"}
              base={report.stats?.baseSpikes} baseLabel={`level ${report.level} base`}
              sources={statSources(report.stats, "spikes")} onInspect={onInspect} />
        {(() => {
          // Per the Stacking Armor rule, physical / summoned / natural armor do NOT
          // stack — a character with more than one type must CHOOSE one to benefit
          // from; the rest grant 0. So show the BEST usable value (not a sum) with
          // its type, and break down both options in the popover.
          const physStr = character.armorPoints ? String(character.armorPoints) : "";
          const phys = parseInt(physStr.match(/^\s*(\d+)/)?.[1] ?? "0", 10);
          const natFixed = report.stats?.naturalArmor || 0;
          const natNotes = (report.stats?.mods?.notes || []).filter((n) => n.stat === "naturalArmor");
          const natSrcRows = statSources(report.stats, "naturalArmor");
          const hasNat = natFixed > 0 || natNotes.length > 0;
          let value, type;
          if (hasNat && (natFixed > phys || (natNotes.length && phys === 0))) {
            value = natFixed > 0 ? String(natFixed) : "※"; type = "natural";
          } else {
            value = String(phys); type = phys > 0 ? "physical" : "—";
          }
          const tip = hasNat
            ? `Armor doesn't stack — pick one. Showing best (${type}).`
            : (physStr || "Physical Armor Points");
          // Breakdown rows: physical (when any) + each natural-armor source +
          // variable-natural notes. Headline shows the best; the list shows all.
          const sources = [];
          if (phys > 0) sources.push({ name: "Physical armor", n: phys, note: type === "physical" ? "in use" : "not in use" });
          for (const s of natSrcRows) sources.push({ ...s, note: `natural${type === "natural" ? ", in use" : ""}` });
          for (const n of natNotes) sources.push({ name: n.name, n: 0, note: "natural, variable", type: sourceType(n.name) });
          return <StatWithSources label="Armor" title={tip} value={value} sources={sources} onInspect={onInspect} />;
        })()}
        {(() => {
          // Wealth = point-in-time total at the FIRST event: starting Wealth plus
          // per-game/event income and one-time first-event grants (report.wealth).
          const w = report.wealth || { base: character.wealth ?? DEFAULT_WEALTH, income: 0, total: character.wealth ?? DEFAULT_WEALTH, sources: [] };
          const tip = w.income > 0
            ? `Wealth at your first event: ${w.base} starting + ${w.income} from sources = ${w.total}.`
            : "Wealth at your first event (default 8 starting; perks/professions add income).";
          return <StatWithSources label="Wealth" title={tip}
                       value={w.income > 0 ? `${w.total}` : w.base}
                       base={w.base} baseLabel="starting"
                       sources={w.sources.map((s) => ({ name: s.name, n: s.n, note: s.note, type: sourceType(s.name) }))}
                       onInspect={onInspect} />;
        })()}
        {character.resources && (
          <Stat label="Resources"
                title="Resources available to the character (free-form; from the sheet)."
                value={character.resources} />
        )}
      </div>

      {report.spellSlots && <SpellSlotStrip slots={report.spellSlots} />}

      <BudgetMeter report={report} character={character} onToggleBackstory={onToggleBackstory} onSetExtraBP={onSetExtraBP} />

      <button className="b-restart" onClick={onRestart}>
        <span className="b-restart-icon">↺</span> Start over
      </button>
    </aside>
  );
}

// Interactive class card: one row per class with a per-class level stepper and a
// remove control (when multiclassed), plus "+ add class". The first class is the
// primary (grants Starting Skills); additional classes grant Multi-Class Skills.
function ClassCard({ classes, spec, onSetLevel, onRemove, onAdd, onInspect }) {
  return (
    <div className="b-id-card b-class-card is-set">
      <span className="b-id-icon">⚔</span>
      <span className="b-id-body">
        <span className="b-id-label">{classes.length > 1 ? "Classes" : "Class"}</span>
        {classes.length === 0 && <span className="b-id-value"><em>not set</em></span>}
        {classes.map((c, i) => (
          <span key={c.name} className="b-class-row">
            <button className="b-class-name" onClick={() => onInspect(c.name)} title="Inspect class">
              {c.name}{i === 0 && spec ? ` (${spec})` : ""}
            </button>
            <span className="b-class-lvl">
              <button className="b-level-btn" disabled={c.level <= 1} aria-label={`Lower ${c.name} level`}
                      onClick={() => onSetLevel(c.name, c.level - 1)}>−</button>
              <strong>{c.level}</strong>
              <button className="b-level-btn" aria-label={`Raise ${c.name} level`}
                      onClick={() => onSetLevel(c.name, c.level + 1)}>+</button>
            </span>
            {classes.length > 1 && (
              <button className="b-class-remove" title="Remove class" aria-label={`Remove ${c.name}`}
                      onClick={() => onRemove(c.name)}>×</button>
            )}
          </span>
        ))}
        <button className="b-class-add" onClick={onAdd}>+ add class</button>
      </span>
    </div>
  );
}

// Devotion card: pick a devotion (any character may), then toggle up to 2 of its
// divine domains (which unlock domain-power purchasing). Flags when a devotion is
// set without the Worship skill, since domain powers need it.
function DevotionCard({ character, devotion, onPick, onToggleDomain, onClear, onInspect }) {
  if (!character.devotion || !devotion) {
    return (
      <button className="b-id-card is-empty" onClick={onPick}>
        <span className="b-id-icon">🌟</span>
        <span className="b-id-body">
          <span className="b-id-label">Devotion</span>
          <span className="b-id-value"><em>+ choose a devotion</em></span>
        </span>
      </button>
    );
  }
  const { available, chosen, worship } = devotion;
  return (
    <div className="b-id-card b-devotion-card is-set">
      <span className="b-id-icon">🌟</span>
      <span className="b-id-body">
        <span className="b-id-label">Devotion</span>
        <span className="b-devotion-head">
          <button className="b-class-name" onClick={onInspect} title="Inspect devotion">{character.devotion}</button>
          <button className="b-class-remove" title="Clear devotion" aria-label="Clear devotion" onClick={onClear}>×</button>
        </span>
        {available.length > 0 && (
          <>
            <span className="b-devotion-sub">Domains ({chosen.length}/{MAX_DOMAINS}):</span>
            <span className="b-domain-chips">
              {available.map((d) => {
                const on = chosen.includes(d);
                const full = chosen.length >= MAX_DOMAINS && !on;
                return (
                  <button key={d} disabled={full}
                          className={`b-domain-chip ${on ? "is-on" : ""}`}
                          onClick={() => onToggleDomain(d)}
                          title={full ? `Pick up to ${MAX_DOMAINS} domains` : on ? "Remove domain" : "Add domain"}>
                    {d}
                  </button>
                );
              })}
            </span>
          </>
        )}
        {!worship && <span className="b-devotion-flag">⚑ needs Worship skill to buy domain powers</span>}
        <button className="b-class-add" onClick={onPick}>change devotion</button>
      </span>
    </div>
  );
}

function Stat({ label, value, title }) {
  return (
    <div className="b-stat" title={title}>
      <span className="b-stat-val">{value}</span>
      <span className="b-stat-label">{label}</span>
    </div>
  );
}

// A stat with a clickable source breakdown. When `sources` is non-empty the tile
// becomes a button that toggles a popover listing each contributing source (base
// + each modifier), every named source clickable to inspect it in the detail
// pane. Falls back to a plain Stat (with the title tooltip) when there's nothing
// to break down. `sources` is [{ name, n, note?, type? }]; `base` is the unmodified
// starting value shown as the first line.
function StatWithSources({ label, value, title, base, baseLabel = "base", sources = [], onInspect }) {
  const [open, setOpen] = useState(false);
  const hasBreakdown = sources.length > 0;
  if (!hasBreakdown) return <Stat label={label} value={value} title={title} />;
  return (
    <div className={`b-stat b-stat-interactive ${open ? "is-open" : ""}`}>
      <button className="b-stat-btn" onClick={() => setOpen((o) => !o)}
              title={title} aria-expanded={open} aria-label={`${label} breakdown`}>
        <span className="b-stat-val">{value}</span>
        <span className="b-stat-label">{label} <span className="b-stat-caret">ⓘ</span></span>
      </button>
      {open && (
        <div className="b-stat-pop" role="dialog" aria-label={`${label} sources`}>
          <button className="b-stat-pop-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          <h4 className="b-stat-pop-title">{label} breakdown</h4>
          <ul className="b-stat-pop-list">
            {base != null && (
              <li className="b-stat-pop-row">
                <span className="b-stat-pop-name">{baseLabel}</span>
                <span className="b-stat-pop-n">{base}</span>
              </li>
            )}
            {sources.map((s, i) => (
              <li key={`${s.name}-${i}`} className="b-stat-pop-row">
                {s.type && onInspect
                  ? <button className="b-stat-pop-link" onClick={() => { onInspect(s.name, null, s.type); setOpen(false); }}>{s.name}</button>
                  : <span className="b-stat-pop-name">{s.name}</span>}
                <span className="b-stat-pop-n">{s.n >= 0 ? `+${s.n}` : s.n}{s.note ? <span className="b-stat-pop-note"> {s.note}</span> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Caster-only spell-slot capacity per tier (Novice / Adept / Greater). Read-only
// — slots are per-rest capacity, not build-time choices. Tiers with 0 slots are
// dimmed rather than hidden so the progression is legible.
function SpellSlotStrip({ slots }) {
  const tiers = [
    { key: "novice", label: "Novice" },
    { key: "adept", label: "Adept" },
    { key: "greater", label: "Greater" },
  ];
  return (
    <div className="b-spellslots">
      <span className="b-spellslots-label">Spell Slots (per rest)</span>
      <div className="b-spellslots-row">
        {tiers.map((t) => (
          <div key={t.key} className={`b-spellslot b-tier-${t.key} ${slots[t.key] ? "" : "is-zero"}`}>
            <span className="b-spellslot-val">{slots[t.key]}</span>
            <span className="b-spellslot-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Live BP meter: a bar that fills with spend and turns red when over budget.
function BudgetMeter({ report, character, onToggleBackstory, onSetExtraBP }) {
  const { spend, budget, remaining, overBudget } = report;
  const pct = budget ? Math.min(100, (spend.net / budget) * 100) : 0;

  const refundsByClass = {};
  if (report.multiclassGrants?.freeBPItems) {
    for (const item of report.multiclassGrants.freeBPItems) {
      const clsName = item.source;
      refundsByClass[clsName] = (refundsByClass[clsName] || 0) + item.bp;
    }
  }

  return (
    <div className={`b-budget ${overBudget ? "is-over" : ""}`}>
      <div className="b-budget-head">
        <span className="b-budget-label">Build Points</span>
        <span className="b-budget-nums">
          <strong>{spend.net}</strong> / {budget}
          {spend.awarded > 0 && <span className="b-budget-flaws"> (+{spend.awarded} from flaws{spend.flawCapped ? ", capped at 5" : ""})</span>}
          {Object.entries(refundsByClass).map(([clsName, amount]) => (
            amount > 0 && <span key={clsName} className="b-budget-flaws"> +{amount} {clsName}</span>
          ))}
          {report.backstoryBP > 0 && <span className="b-budget-flaws"> +{report.backstoryBP} backstory</span>}
          {character.extraMaxBP > 0 && <span className="b-budget-flaws"> +{character.extraMaxBP} extra</span>}
        </span>
      </div>
      <div className="b-budget-bar"><div className="b-budget-fill" style={{ width: `${pct}%` }} /></div>
      <p className="b-budget-foot">
        {overBudget
          ? `${-remaining} BP over budget`
          : `${remaining} BP remaining`}
      </p>
      <div className="b-budget-extra-row">
        {onToggleBackstory && (
          <label className="b-budget-backstory" title="Approved backstories grant +2 BP (submit to the plot team).">
            <input type="checkbox" checked={!!character?.backstoryApproved} onChange={onToggleBackstory} />
            <span>Approved backstory <span className="b-budget-flaws">+2 BP</span></span>
          </label>
        )}
        {onSetExtraBP && (
          <div className="b-budget-extra-control" title="Add extra Build Points (e.g. from service points, NPC shifts, or donations).">
            <span>Extra BP:</span>
            <input
              type="number"
              className="b-extra-bp-input"
              value={character.extraMaxBP || 0}
              min="0"
              max="100"
              onChange={(e) => onSetExtraBP(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BUILD SHEET ─────────────────────────────────────────────────────────────

// Lineage at a glance on the main sheet: the lineage + sublineage, each chosen
// advantage, and — nested under the advantage that grants it — any granted
// ability (a perk/power/skill the advantage gives for free). Clicking the lineage
// header opens the full LineagePanel; clicking an advantage or granted ability
// inspects it in the detail pane. Surfaces what was previously buried in the panel.
function LineageSummary({ character, report, onInspect, onOpenLineage }) {
  if (!character.lineage) return null;
  const lbp = report.lbp;
  const chosen = lbp?.chosenAdvantages || [];
  // Granted abilities grouped by their source advantage name, for the sub-rows.
  const grantedBySource = {};
  for (const g of (report.grantedAbilities?.list || [])) {
    if (g.sourceKind !== "advantage") continue;
    (grantedBySource[g.source] = grantedBySource[g.source] || []).push(g);
  }
  // Chosen Challenges (lineage Flaws that AWARD LBP) — previously only shown in
  // the lineage panel, never on the sheet (#3). Surface them here alongside the
  // Advantages they pay for.
  const challenges = lbp?.chosenChallenges || [];
  const title = `Lineage — ${character.lineage}${character.sublineage ? ` · ${character.sublineage}` : ""}`;
  return (
    <Section title={title} tone="green" onAdd={onOpenLineage}>
      {challenges.length === 0 && chosen.length === 0 && (
        <p className="b-empty">No challenges or advantages chosen yet.</p>
      )}
      {challenges.length > 0 && (
        <>
          <h3 className="b-lin-subhead">Challenges <span className="b-lin-subhead-note">award LBP</span></h3>
          <ul className="b-rows">
            {challenges.map((ch, i) => {
              const name = ch.baseName || ch.name;
              return (
                <li key={`ch-${i}-${name}`} className="b-row b-lin-adv-row">
                  <button className="b-row-name" onClick={() => onInspect(name, "lineageChallenges", "flaws")}>{name}</button>
                  {ch.required && <span className="b-row-badge b-badge-granted">required</span>}
                  <span className="b-row-bp is-award">+{ch.lbp} LBP</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {chosen.length > 0 && (
        <h3 className="b-lin-subhead">Advantages <span className="b-lin-subhead-note">spend LBP</span></h3>
      )}
      <ul className="b-rows">
        {chosen.map((adv, i) => {
          const name = adv.baseName || adv.name;
          const grants = grantedBySource[name] || [];
          return (
            <li key={`adv-${i}-${name}`} className="b-lin-adv-group">
              <div className="b-row b-lin-adv-row">
                <button className="b-row-name" onClick={() => onInspect(name, "lineageAdvantages", "perks")}>{name}</button>
                <span className="b-row-bp is-cost">−{adv.lbp} LBP</span>
              </div>
              {grants.map((g) => (
                <div key={g.ability} className="b-row b-lin-grant-row">
                  <button className="b-row-name" onClick={() => onInspect(g.abilityName, g.abilityType, g.abilityType)}>
                    ↳ {g.abilityName}
                  </button>
                  <span className="b-row-bp is-free" title={`Granted by ${g.source}`}>free · {g.source}</span>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function BuildSheet({ character, report, view, onPickArchetype, onStartBlank, onInspect, onOpenSlot, onOpenAdd, onRemoveEntity, onSetName, onOpenLineage }) {
  if (!character.archetypeName) {
    return <ArchetypePicker onPick={onPickArchetype} onStartBlank={onStartBlank} />;
  }
  const isFocused = (item, field) =>
    view?.mode === "inspect" && view.item === item && view.field === field;

  // Items are rendered by their RESOLVED kind (report.owned), not by the storage
  // field they happen to sit in — so a perk filed under startingSkills (Socialite's
  // Contact) shows under Perks, and a class power filed under purchasedSkills shows
  // under Class Powers (and isn't buyable twice). Provenance drives the badge:
  // class-granted items are free + non-removable; purchased ones cost BP.
  const owned = report.owned || { skills: [], perks: [], classPowers: [], innatePowers: [] };

  return (
    <main className="b-sheet">
      <header className="b-sheet-header">
        <input
          className="b-sheet-name"
          value={character.name || ""}
          placeholder={character.archetypeName || "Name your character"}
          aria-label="Character name"
          onChange={(e) => onSetName(e.target.value)}
        />
        <p className="b-sheet-tagline">
          {character.archetypeName && character.archetypeName !== "Custom Build"
            ? <>Based on <em>{character.archetypeName}</em>{" — "}
                {ARCHETYPES.find((a) => a.name === character.archetypeName)?.tagline}</>
            : ARCHETYPES.find((a) => a.name === character.archetypeName)?.tagline}
        </p>
      </header>

      <Section title="Skills" tone="amber" onAdd={() => onOpenAdd("skill")}>
        <ClassifiedRows rows={owned.skills} resolveType="skills" report={report}
          onClick={onInspect} isFocused={isFocused} onRemove={onRemoveEntity} />
      </Section>

      <Section title="Perks" tone="teal" onAdd={() => onOpenAdd("perk")}>
        <ClassifiedRows rows={owned.perks} resolveType="perks" report={report}
          onClick={onInspect} isFocused={isFocused} onRemove={onRemoveEntity} />
      </Section>

      <LineageSummary character={character} report={report} onInspect={onInspect} onOpenLineage={onOpenLineage} />

      {report.devotion?.chosen.length > 0 && (
        <Section title={`Domain Powers — ${report.devotion.chosen.join(" · ")}`} tone="purple"
                 onAdd={report.devotion.worship ? () => onOpenAdd("domainPower") : undefined}>
          {!report.devotion.worship && (
            <p className="b-empty">Take the Worship skill to purchase domain powers.</p>
          )}
          <EditableRows
            items={character.domainPowers} field="domainPowers" resolveType="powers" report={report}
            onClick={onInspect} isFocused={isFocused}
            removable={() => true} onRemove={(i) => onRemoveEntity("domainPowers", i)} />
        </Section>
      )}

      {/* Class Powers — BP-bought class abilities ("Class Skills"), available from
          any class the character has levels in (like Domain Powers, but class-gated).
          Rows come from report.owned.classPowers, which unions the dedicated
          classPowers field with any class powers misfiled into the skill lists. */}
      {getClasses(character).length > 0 && (
        <Section title="Class Powers" tone="purple" onAdd={() => onOpenAdd("classPower")}>
          <ClassifiedRows rows={owned.classPowers} resolveType="powers" report={report}
            onClick={onInspect} isFocused={isFocused} onRemove={onRemoveEntity} showClass />
        </Section>
      )}

      {/* Innate Powers — free class features granted automatically by class levels. */}
      {owned.innatePowers && owned.innatePowers.length > 0 && (
        <Section title="Innate Powers" tone="purple">
          <ClassifiedRows rows={owned.innatePowers} resolveType="powers" report={report}
            onClick={onInspect} isFocused={isFocused} onRemove={onRemoveEntity} showClass />
        </Section>
      )}

      {report.slots.length > 0 && (
        <Section title="Powers" tone="purple">
          {report.slots.map((slot) => (
            <SlotBlock key={`${slot.cls}-${slot.category}`} slot={slot} character={character}
                       onInspect={onInspect} onOpenSlot={onOpenSlot} isFocused={isFocused}
                       pickClassOf={(field, i, name) => pickClass(character, field, i, name)} />
          ))}
        </Section>
      )}

      <Section title="Flaws" tone="red" onAdd={() => onOpenAdd("flaw")}>
        <EditableRows
          items={character.flaws} field="flaws" resolveType="flaws" report={report}
          onClick={onInspect} isFocused={isFocused}
          removable={() => true} onRemove={(i) => onRemoveEntity("flaws", i)} />
      </Section>

      {report.crafting?.any && (
        <CraftingSection crafting={report.crafting} onInspect={onInspect} />
      )}
    </main>
  );
}

// What the character can MAKE, derived from their crafting / Ritual Magic skills
// (report.crafting). Read-only: each discipline lists every recipe it unlocks
// (highest owned tier subsumes lower), grouped by tier; each recipe opens its full
// detail (materials, process, effect) in the inspector. No book needed.
function CraftingSection({ crafting, onInspect }) {
  const groups = [
    ...crafting.crafting.map((c) => ({
      key: c.discipline, label: `${c.discipline} — ${c.tier}`,
      resolveType: "recipes", recipes: c.recipes,
    })),
    ...(crafting.rituals ? [{
      key: "Rituals", label: `Rituals — ${crafting.rituals.tier} Ritual Magic`,
      resolveType: "rituals", recipes: crafting.rituals.recipes,
    }] : []),
  ];
  return (
    <Section title="Can Craft" tone="teal">
      {groups.map((g) => (
        <div key={g.key} className="b-craft-group">
          <h3 className="b-craft-head">{g.label} <span className="b-craft-count">{g.recipes.length}</span></h3>
          <ul className="b-craft-list">
            {g.recipes.map((r) => (
              <li key={r.name} className="b-craft-row">
                <button className="b-row-name" onClick={() => onInspect(r.name, null, g.resolveType)}>{r.name}</button>
                <span className="b-craft-tier">{r.tier}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

function Section({ title, tone = "amber", onAdd, children }) {
  return (
    <section className="b-section">
      <h2 className={`b-section-title b-section-${tone}`}>
        {title}
        {onAdd && <button className="b-section-add" onClick={onAdd} title={`Add ${title.toLowerCase()}`}>+ add</button>}
      </h2>
      <div className="b-section-body">{children}</div>
    </section>
  );
}

// A tier's slots as fixed rows: `allowed` positions, filled by the character's
// picks in order, the rest shown as empty "choose" rows. The header shows
// used/allowed and goes green when exactly filled, red when over.
function SlotBlock({ slot, character, onInspect, onOpenSlot, isFocused, pickClassOf }) {
  // Spells-known spans three tier fields; every other category is a single field.
  const fields = slot.category === "spellsKnown"
    ? ["noviceSpells", "adeptSpells", "greaterSpells"]
    : [SLOT_FIELD[slot.category]];
  // Picks belonging to THIS class's slots, across the relevant field(s), each
  // carrying its field + flat index so clear/swap target the right element.
  const myPicks = fields.flatMap((field) =>
    (character[field] || [])
      .map((name, flatIndex) => ({ name, flatIndex, field }))
      .filter((p) => pickClassOf(field, p.flatIndex, p.name) === slot.cls));

  const rowCount = Math.max(slot.allowed, myPicks.length);
  const rows = Array.from({ length: rowCount }, (_, i) => myPicks[i] ?? null);
  const state = slot.over ? "is-over" : slot.used === slot.allowed && slot.allowed > 0 ? "is-full" : "";

  return (
    <div className={`b-slot-block ${state}`}>
      <div className="b-slot-head">
        <h3 className="b-slot-label">{slot.label}</h3>
        <span className="b-slot-count">{slot.used} / {slot.allowed}</span>
      </div>
      <ol className="b-slot-rows">
        {rows.map((pick, i) => {
          const over = i >= slot.allowed;
          if (pick) {
            return (
              <li key={i} className={`b-slot-row is-filled ${over ? "is-over" : ""} ${isFocused(pick.name, pick.field) ? "is-focused" : ""}`}>
                <span className="b-slot-num">{i + 1}</span>
                <button className="b-slot-pick" onClick={() => onInspect(pick.name, pick.field, "powers")}>{pick.name}</button>
                {slot.category === "spellsKnown" && spellTierKey({ tierList: pick.field }) && (
                  <span className={`b-slot-tier b-tier-${spellTierKey({ tierList: pick.field })}`}>
                    {SPELL_TIER_LABEL[pick.field]}
                  </span>
                )}
                <button className="b-slot-action" title="Swap" aria-label={`Swap ${pick.name}`} onClick={() => onOpenSlot(slot, pick.flatIndex, false, pick.field)}>✎</button>
                <button className="b-slot-action" title="Clear" aria-label={`Clear ${pick.name}`} onClick={() => onOpenSlot(slot, pick.flatIndex, true, pick.field)}>✕</button>
              </li>
            );
          }
          return (
            <li key={i} className="b-slot-row is-empty">
              <span className="b-slot-num">{i + 1}</span>
              <button className="b-slot-add" onClick={() => onOpenSlot(slot, -1)}>
                + choose a {slot.label} power
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// The BP cost / award / free-grant / discount badge for one item's resolved cost
// entry (report.spend.byItem[...]). Shared by EditableRows and ClassifiedRows so
// every list annotates cost identically.
function CostBadge({ cost }) {
  if (!cost) return null;
  if (cost.cost < 0) return <span className="b-row-bp is-award">+{-cost.cost} BP</span>;
  if (!(cost.base > 0)) return null;
  if (cost.cost === 0 && cost.grant?.source) {
    const role = grantSourceRole(cost.grant);
    return (
      <span className="b-row-bp is-free" title={`Granted by ${cost.grant.source}${role ? ` (${role})` : ""}`}>
        free · {cost.grant.source}{role && <span className="b-row-role"> ({role})</span>}
      </span>
    );
  }
  if (cost.discount) {
    return (
      <span className="b-row-bp is-discounted"
            title={`${cost.base} BP, discounted ${cost.discount.amount} by ${cost.discount.source}`}>
        {cost.cost} BP <span className="b-row-disc">−{cost.discount.amount} · {cost.discount.source}</span>
      </span>
    );
  }
  return <span className={`b-row-bp ${cost.cost === 0 ? "is-free" : ""}`}>{cost.cost === 0 ? "free" : `${cost.cost} BP`}</span>;
}

// Render pre-classified rows (report.owned.skills / perks / classPowers). Each row
// carries its own backing { name, field, index, source, grantedBy, cls } so it
// inspects, costs, and removes against the RIGHT storage field regardless of which
// section it's shown in. Class-granted rows (source 'class') get a "from class"
// badge (#5) and aren't removable; rows with index < 0 are derived (multiclass
// grants) and aren't stored, so also non-removable.
function ClassifiedRows({ rows, resolveType, report, onClick, isFocused, onRemove, showClass }) {
  if (!rows || rows.length === 0) return <p className="b-empty">none</p>;
  return (
    <ul className="b-rows">
      {rows.map((row) => {
        const { name, field, index, source, grantedBy, cls, refundedBP } = row;
        const cost = report?.spend.byItem[`${field}:${name}`];
        const fromClass = source === "class";
        const canRemove = !fromClass && index >= 0;
        const rank = cost?.rank || 1;
        return (
          <li key={`${field}-${index}-${name}-${grantedBy || cls || ''}`} className={`b-row ${isFocused(name, field) ? "is-focused" : ""}`}>
            <button className="b-row-name" onClick={() => onClick(name, field, resolveType)}>
              {name}{rank > 1 && <span className="b-row-rank">×{rank}</span>}
            </button>
            {showClass && cls && !fromClass && <span className="b-row-badge b-badge-class">{cls.toUpperCase()}</span>}
            {fromClass
              ? (() => {
                  const src = grantedBy || cls;
                  return (
                    <>
                      {src && (
                        <span className="b-row-badge b-badge-granted"
                              title={grantedBy ? `Granted free by your ${grantedBy} multi-class`
                                : `Granted free by your ${src} class`}>
                          {src.toUpperCase()}
                        </span>
                      )}
                      {refundedBP ? (
                        <span className="b-row-badge b-badge-refund" title="Redundant grant refunded as free BP">
                          +{refundedBP} BP
                        </span>
                      ) : null}
                    </>
                  );
                })()
              : <CostBadge cost={cost} />}
            {canRemove && (
              <button className="b-row-remove" title="Remove" aria-label={`Remove ${name}`}
                      onClick={() => onRemove(field, index)}>×</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Render items as full-width rows (matching the power slot rows): click the name
// to inspect, a BP cost / award badge, and a remove (×) on removable items.
// `removable(i)` / `onRemove(i)` operate on the rendered index; the parent maps
// that to the right backing list.
function EditableRows({ items, field, onClick, isFocused, resolveType, report, removable, onRemove }) {
  if (!items || items.length === 0) {
    return <p className="b-empty">none</p>;
  }
  return (
    <ul className="b-rows">
      {items.map((item, i) => {
        const cost = report?.spend.byItem[`${field}:${item}`];
        const canRemove = removable ? removable(i) : false;
        const rank = cost?.rank || 1;
        return (
          <li key={`${field}-${i}-${item}`} className={`b-row ${isFocused(item, field) ? "is-focused" : ""}`}>
            <button className="b-row-name" onClick={() => onClick(item, field, resolveType)}>
              {item}{rank > 1 && <span className="b-row-rank">×{rank}</span>}
            </button>
            <CostBadge cost={cost} />
            {canRemove && (
              <button className="b-row-remove" title="Remove" aria-label={`Remove ${item}`} onClick={() => onRemove(i)}>×</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Initial archetype picker — shown when no character is loaded yet.
function ArchetypePicker({ onPick, onStartBlank }) {
  const byClass = useMemo(() => {
    const map = new Map();
    for (const a of ARCHETYPES) {
      const cls = a.classLevels?.split(" ")[0] || "Other";
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
          New to Wellspring? Any of these gives you a complete, legal level-4 character.
          You can tweak anything afterward — or hit "Start blank" to build from scratch.
        </p>
      </header>

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
                  <span className="b-archetype-stats">LP {a.lifePoints} · Sp {a.spikes}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="b-section">
        <button className="b-blank-button" onClick={onStartBlank}>
          Start blank — I want full control
        </button>
      </section>
    </main>
  );
}

// ─── DETAIL PANE ─────────────────────────────────────────────────────────────
// Dual-mode right pane. INSPECT shows one entity with its description, facts, and
// followable links. PICK lists the eligible powers for a slot, each inspectable
// (with links) and choosable. Both modes share the entity-card renderer.

function DetailPane({ view, report, choices, onSetChoice, onUpdateParameter, onInspect, onBack, onClose }) {
  if (!view) {
    return (
      <aside className="b-rail b-rail-right">
        <div className="b-detail-empty">
          <p className="b-detail-hint">Click any item to see what it does, or click an empty power slot to choose one.</p>
        </div>
      </aside>
    );
  }
  return <EntityDetail view={view} report={report} choices={choices} onSetChoice={onSetChoice} onUpdateParameter={onUpdateParameter} onInspect={onInspect} onBack={onBack} onClose={onClose} />;
}

// ─── PICKER OVERLAY ───────────────────────────────────────────────────────────
// Full-screen two-pane picker, driven by a `spec` so it serves powers, skills,
// perks, and flaws alike. Left: searchable, grouped, prereq-aware candidate list.
// Right: the full reading view for the highlighted candidate (description, facts,
// followable sub-links) — following a link here is "just reading" via a local nav
// stack and never commits. Choose commits.
//
// A spec is:
//   { kind, entityType, title, subtitle, candidates: [{name, desc, cat, ...}],
//     taken: Set, onChoose(name) }
// Grouping/sorting is driven by GROUP_AXES + the picker's mode, not the spec.

// Build a picker spec for filling a power SLOT.
function powerPickerSpec(slot, character) {
  const { category, index, label, cls } = slot;
  const field = SLOT_FIELD[category];
  // Candidates are drawn from the SLOT'S class only — slots are class-specific.
  // Spells-known is NOT gated by spell-slots: per the rules, a caster learns "one
  // known Spell of any Tier" each level — Known Spells are which spells you CAN
  // cast, Spell-Slots are how many times. So all learnable tiers are offered.
  const candidates = eligiblePowers(cls, category);
  // For spells-known, a pick is stored in the field matching its OWN tier
  // (noviceSpells/adeptSpells/greaterSpells), not a single field — so the right
  // tier's count is tracked. Map candidate name → its tier field.
  const fieldFor = (name) => {
    if (category !== "spellsKnown") return field;
    const c = candidates.find((x) => x.name === name);
    return c?.tierList || "noviceSpells";
  };
  // "taken" spans every tier field for spells-known so chosen spells are marked.
  const takenFields = category === "spellsKnown"
    ? ["noviceSpells", "adeptSpells", "greaterSpells"] : [field];
  return {
    kind: "power", entityType: "powers",
    title: `Choose a ${label} power`,
    subtitle: `${candidates.length} options for ${cls}`,
    candidates,
    taken: new Set(takenFields.flatMap((f) => character[f] || [])),
    onChoose: (name) => slot.onChoose(name, fieldFor(name)),
  };
}

// Build a picker spec for ADDING a skill / perk / flaw. Grouped by category.
// Flaws award BP rather than cost it, reflected in the choose-button label.
function entityPickerSpec({ kind, entityType, candidates, title, taken, onChoose }) {
  return {
    kind, entityType, title,
    subtitle: `${candidates.length} options`,
    candidates,
    taken, onChoose,
  };
}

// Alternate group-by axes available in any picker, on top of the spec's default.
// Each maps a candidate → a bucket label. "Default" uses the spec's own grouping
// (refresh for martials, tier for spells, category for skills/perks).
const refreshBucket = (c) => {
  const r = (c.refresh || "").toLowerCase();
  if (!r || r === "none" || r === "passive") return "Passive";
  if (r.includes("long")) return "Long Rest";
  if (r.includes("short")) return "Short Rest";
  if (r.includes("immediate")) return "Immediate";
  return c.refresh;
};
// The effect-ish entities (effects / conditions / defenses) a candidate invokes,
// from the reference graph — what the ability actually DOES. Used to group/sort
// abilities by effect (e.g. "show me everything that Heals / Protects / Counters").
function candidateEffects(c) {
  const id = `${/powers/.test(c.tierList || "") || c.tier ? "powers" : c.cat ? "skills" : "powers"}:${c.name}`;
  const refs = (REFS.mentions && (REFS.mentions[`powers:${c.name}`] || REFS.mentions[id])) || [];
  return refs.filter((t) => /^(effects|conditions|defenses):/.test(t)).map((t) => t.slice(t.indexOf(":") + 1));
}
const primaryEffect = (c) => candidateEffects(c)[0] || "—";

// Tooltip for a stat: the base plus any modifiers and where they came from, so a
// boosted value (e.g. Life 4 from level + Toughness) explains itself on hover.
// Resolve the entity type of a stat/wealth source name (perk / power / skill /
// advantage) so its breakdown row can be made clickable. Returns null when the
// name doesn't resolve (then the row renders as plain text).
function sourceType(name) {
  const clean = String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
  for (const t of ["powers", "perks", "skills"]) {
    if (lookupEntity(`${t}:${clean}`)) return t;
  }
  return null;
}
// Decorate stat-mod sources for one stat key with a clickable type.
function statSources(stats, key) {
  return (stats?.mods?.sources || [])
    .filter((s) => s.stat === key)
    .map((s) => ({ name: s.name, n: s.n, type: sourceType(s.name) }));
}

function statTitle(stats, key, label) {
  const srcs = (stats?.mods?.sources || []).filter((s) => s.stat === key);
  if (!srcs.length) return label;
  const baseKey = key === "lifePoints" ? "baseLifePoints" : key === "spikes" ? "baseSpikes" : null;
  const base = baseKey != null ? stats[baseKey] : 0;
  const parts = srcs.map((s) => `+${s.n} ${s.name}`);
  return `${label}: ${base ? `${base} base ` : ""}${parts.join(", ")}`;
}

const SPELL_TIER_BUCKET = { noviceSpells: "Novice", adeptSpells: "Adept", greaterSpells: "Greater", cantrips: "Cantrip" };
const GROUP_AXES = {
  tier: { label: "Tier", fn: (c) => SPELL_TIER_BUCKET[c.tierList] || c.tier || "—" },
  category: { label: "Category", fn: (c) => c.cat || c.tierList || "Other" },
  refresh: { label: "Refresh", fn: refreshBucket },
  effect: { label: "Effect", fn: primaryEffect },
  alphabetical: { label: "A–Z", fn: (c) => (c.name[0] || "#").toUpperCase() },
  cost: { label: "Cost", fn: (c) => (typeof c.cost === "number" ? `${c.cost} BP` : "—") },
};

function PickerOverlay({ spec, character, onClose }) {
  const { entityType, title, subtitle, candidates, taken, onChoose } = spec;

  const [query, setQuery] = useState("");
  const [hideLocked, setHideLocked] = useState(false);
  const [selected, setSelected] = useState(candidates[0]?.name || null);
  // Group/sort controls. Default grouping is context-aware (the old separate
  // "Default" option just duplicated this): spells group by TIER, other powers by
  // REFRESH cadence, skills/perks (no refresh) by category.
  const isSpells = candidates.some((c) => c.tierList && SPELL_TIER_BUCKET[c.tierList]);
  const hasRefresh = candidates.some((c) => c.refresh && c.refresh !== "None");
  const [groupMode, setGroupMode] = useState(isSpells ? "tier" : hasRefresh ? "refresh" : "category");
  const [sortMode, setSortMode] = useState("name"); // "name" | "cost"
  // Local reading stack: empty → reading the selected candidate; pushing an
  // entity id lets the user follow links without leaving the picker.
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
    // Sort items within each group.
    const cmp = sortMode === "cost"
      ? (a, b) => (a.cost ?? 999) - (b.cost ?? 999) || a.name.localeCompare(b.name)
      : sortMode === "effect"
        ? (a, b) => candidateEffects(b).length - candidateEffects(a).length || a.name.localeCompare(b.name)
        : (a, b) => a.name.localeCompare(b.name);
    for (const [, cs] of entries) cs.sort(cmp);
    // Alphabetical group-by also sorts the group headers A–Z.
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
  const selectedTaken = selected && taken.has(selected);

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
          {/* LEFT: browse */}
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

          {/* RIGHT: read */}
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

// INSPECT mode: one entity, its facts, and followable links.
function EntityDetail({ view, report, choices, onSetChoice, onUpdateParameter, onInspect, onBack, onClose }) {
  const entity = useResolvedEntity(view.item, view.field, view.resolveType);
  const { item, resolveType } = view;

  return (
    <aside className="b-rail b-rail-right">
      <header className="b-detail-header">
        <div className="b-detail-nav">
          {onBack
            ? <button className="b-detail-back" onClick={onBack}>‹ back</button>
            : <span />}
          <button className="b-detail-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <h2 className="b-detail-title">{entity?.name || item}</h2>
        <p className="b-detail-type">{entity?.type || resolveType}</p>
      </header>
      <div className="b-detail-body">
        <EntityBody entity={entity} view={view} report={report} choices={choices} onSetChoice={onSetChoice} onUpdateParameter={onUpdateParameter} onInspect={onInspect} />
      </div>
    </aside>
  );
}

// Build the set of referenced game-concept TERMS for an entity, from its
// reference graph (REFS.mentions + prereqs + unlocks). Each term is { name, id,
// type, summary } where summary is a short blurb for the hover tooltip. Sorted
// longest-name-first so multi-word terms ("Long Rest") win over substrings
// ("Rest") when matching. Self-references and overly generic 1-char names are
// dropped. (#13)
function conceptTerms(entity) {
  if (!entity?.id) return [];
  const ids = new Set([
    ...(REFS.mentions[entity.id] || []),
    ...((REFS.prereqs[entity.id]?.skills) || []),
    ...((REFS.prereqs[entity.id]?.anyOf || []).flat()),
    ...(REFS.unlocks[entity.id] || []),
  ]);
  const terms = [];
  for (const id of ids) {
    if (id === entity.id) continue;
    const ent = lookupEntity(id);
    if (!ent?.name || ent.name.length < 3) continue;
    if (ent.name.toLowerCase() === (entity.name || "").toLowerCase()) continue;
    const summary = ent.summary || ent.description || ent.definition || "";
    terms.push({ name: ent.name, id, type: id.slice(0, id.indexOf(":")), summary: String(summary).slice(0, 240) });
  }
  // De-dupe by lowercased name (different ids, same display term), longest first.
  const seen = new Set();
  return terms
    .sort((a, b) => b.name.length - a.name.length)
    .filter((t) => { const k = t.name.toLowerCase(); return seen.has(k) ? false : seen.add(k); });
}

// Render text with referenced concept names turned into hoverable + clickable
// chips (#13). `terms` come from conceptTerms(entity). A match is wrapped in a
// <button> carrying the term's summary as a native tooltip and inspecting the
// concept on click. Matching is case-insensitive on word boundaries, longest
// term first, each distinct term linked only on its FIRST occurrence to keep the
// prose readable. Returns an array of strings + elements for inline rendering.
function linkifyConcepts(text, terms, onInspect, keyPrefix) {
  if (!terms.length || !onInspect) return [text];
  // One alternation of all term names, escaped, longest-first (terms already
  // sorted that way). Capture group so split keeps the matches.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(${terms.map((t) => esc(t.name)).join("|")})\\b`, "gi");
  const byName = new Map(terms.map((t) => [t.name.toLowerCase(), t]));
  const linked = new Set();
  const out = [];
  let last = 0, m, n = 0;
  while ((m = re.exec(text))) {
    const term = byName.get(m[0].toLowerCase());
    if (!term) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    if (linked.has(term.name.toLowerCase())) {
      out.push(m[0]); // already linked once — leave subsequent mentions plain
    } else {
      linked.add(term.name.toLowerCase());
      out.push(
        <button key={`${keyPrefix}-${n++}`} className="b-concept"
                title={term.summary ? `${term.name} — ${term.summary}` : term.name}
                onClick={() => onInspect(term.name, null, term.type)}>
          {m[0]}
        </button>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Render a description legibly: split off any "• " bullet list into a real list,
// and break the prose into paragraphs at natural boundaries ("Note:",
// "Enhancement:", "Spike:", numbered/lettered sub-points) so it doesn't read as one
// dense block. Referenced concepts are linkified (hover for a blurb, click to
// inspect) when `terms` + `onInspect` are supplied.
function DescriptionBlock({ text, terms = [], onInspect }) {
  const [lead, ...bulletParts] = String(text).split(/\s*•\s+/);
  const bullets = bulletParts.map((b) => b.trim()).filter(Boolean);
  // Break the lead prose before inline labels that start a new idea.
  const paras = lead
    .split(/(?=\b(?:Note|Enhancement|Spike|Special|Cost|Restriction|Requirement|Prerequisite)s?:)/)
    .map((s) => s.trim()).filter(Boolean);
  return (
    <div className="b-detail-desc">
      {paras.map((p, i) => <p key={i} className="b-detail-para">{linkifyConcepts(p, terms, onInspect, `p${i}`)}</p>)}
      {bullets.length > 0 && (
        <ul className="b-detail-bullets">
          {bullets.map((b, i) => <li key={i}>{linkifyConcepts(b, terms, onInspect, `b${i}`)}</li>)}
        </ul>
      )}
    </div>
  );
}

// The shared reading body for an entity — description, facts, forward + back
// links. Used by both the rail inspector and the picker's reading pane so the
// content (and link-following) is identical everywhere.
function ParameterEditor({ baseName, entity, view, onUpdateParameter }) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState(entity.parameter || "");
  const containerRef = useRef(null);

  useEffect(() => {
    setFilter(entity.parameter || "");
  }, [entity.parameter]);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const suggestions = PARAMETER_SUGGESTIONS[baseName] || [];
  const isSearching = isOpen && filter !== entity.parameter;
  const filtered = isSearching
    ? suggestions.filter(opt => opt.toLowerCase().includes(filter.toLowerCase()))
    : suggestions;

  return (
    <div className="b-detail-section b-parameter-editor" ref={containerRef}>
      <h3 className="b-detail-section-title">
        {baseName === "Lore" ? "Customize Area" : "Customize Choice"}
      </h3>
      <div className="b-combobox">
        <div className="b-combobox-input-wrapper">
          <input
            type="text"
            className="b-parameter-input"
            placeholder={baseName === "Lore" ? "Enter area..." : "Enter choice..."}
            value={filter}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              const val = e.target.value;
              setFilter(val);
              const newName = formatParameterizedName(baseName, val, entity.name);
              onUpdateParameter(view.field, entity.name, newName);
            }}
          />
          <button
            type="button"
            className="b-combobox-toggle"
            aria-label="Toggle suggestions"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? "▲" : "▼"}
          </button>
        </div>
        {isOpen && filtered.length > 0 && (
          <ul className="b-combobox-list">
            {filtered.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  className="b-combobox-option"
                  onClick={() => {
                    setFilter(opt);
                    const newName = formatParameterizedName(baseName, opt, entity.name);
                    onUpdateParameter(view.field, entity.name, newName);
                    setIsOpen(false);
                  }}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EntityBody({ entity, view, report, choices, onSetChoice, onUpdateParameter, onInspect }) {
  if (!entity) {
    return <p className="b-detail-missing">No detail available — this item may be unresolved.</p>;
  }
  // Domains carry no prose in the source — only an accent and a powers list. Show
  // those as content instead of an empty "no description" so the link is useful.
  const domainPowers = entity.type === "domains" ? (entity.powers || []) : null;
  // Per-level benefits (Adept Ritualist): show each tier with active/locked state
  // derived from the live report when the character owns it; otherwise list them
  // by their gating level so the reader sees the progression.
  const activeBenefits = entity.levelBenefits
    ? (report?.powerBenefits?.find((b) => b.power === entity.name)?.benefits || entity.levelBenefits)
    : null;
  // Referenced concepts to linkify inside the description (#13).
  const terms = conceptTerms(entity);
  const baseName = entity.baseName || entity.name;
  const isParamEditable = !!(onUpdateParameter && view?.field && view.field !== "multiclassGrant" && PARAMETER_SUGGESTIONS[baseName]);
  const grantedSubPowers = useMemo(() => {
    if (!entity?.id) return [];
    const targets = REFS.grants?.[entity.id] || [];
    return targets
      .map((id) => lookupEntity(id))
      .filter((sub) => sub && sub.tier === "SubPower");
  }, [entity]);
  return (
    <>
      {entity.description
        ? <DescriptionBlock text={entity.description} terms={terms} onInspect={onInspect} />
        : domainPowers
          ? <p className="b-detail-desc">A divine domain{entity.accent ? ` (${entity.accent} accent)` : ""} granting {domainPowers.length} power{domainPowers.length === 1 ? "" : "s"}.</p>
          : <p className="b-detail-missing">No description on record.</p>}
      <DetailFacts entity={entity} isEditable={isParamEditable} />
      {isParamEditable && (
        <ParameterEditor
          baseName={baseName}
          entity={entity}
          view={view}
          onUpdateParameter={onUpdateParameter}
        />
      )}
      {activeBenefits && (
        <div className="b-detail-section">
          <h3 className="b-detail-section-title">Benefits by {entity.levelBenefitClass || "class"} level</h3>
          <ul className="b-level-benefits">
            {activeBenefits.map((b) => (
              <li key={b.level} className={`b-level-benefit ${b.active === false ? "is-locked" : b.active ? "is-active" : ""}`}>
                <span className="b-level-tag">Lv {b.level}</span>
                <span className="b-level-text">{b.text}</span>
                {b.active === false && <span className="b-level-locked">locked</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {entity.chooseOne && (() => {
        const co = entity.chooseOne;
        const powerId = `powers:${entity.name}`;
        const chosen = choices?.[powerId];
        const build = co.kind === "build";
        return (
          <div className="b-detail-section">
            <h3 className="b-detail-section-title">
              {build ? "Choose one (free)" : "Choose one when used"}
            </h3>
            <ul className="b-choose-list">
              {co.options.map((o, i) => {
                const key = o.grantsSkill || o.text;
                const sel = build && (chosen === key);
                return (
                  <li key={i} className={`b-choose-opt ${build ? "is-selectable" : ""} ${sel ? "is-chosen" : ""}`}>
                    {build && onSetChoice
                      ? <button className="b-choose-btn" onClick={() => onSetChoice(powerId, key)}>
                          <span className="b-choose-mark">{sel ? "●" : "○"}</span> {o.text}
                          {o.grantsSkill && <span className="b-choose-free"> · free</span>}
                        </button>
                      : <span className="b-choose-text">• {o.text}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}
      {domainPowers && domainPowers.length > 0 && (
        <LinkList title="Domain powers" tone="purple" onInspect={onInspect}
                  ids={domainPowers.map((p) => `powers:${p.name}`)} />
      )}
      {grantedSubPowers.length > 0 && (
        <div className="b-detail-subpowers">
          {grantedSubPowers.map((sub) => {
            const subTerms = conceptTerms(sub);
            return (
              <div key={sub.id} className="b-detail-section b-detail-subpower-inline">
                <h3 className="b-detail-section-title">Granted Power: {sub.name}</h3>
                <DetailFacts entity={sub} isEditable={false} />
                {sub.description && (
                  <DescriptionBlock text={sub.description} terms={subTerms} onInspect={onInspect} />
                )}
              </div>
            );
          })}
        </div>
      )}
      <ForwardLinks entity={entity} onInspect={onInspect} />
      <BackLinks entity={entity} onInspect={onInspect} />
    </>
  );
}

// The labeled fact rows (cost / prereq / tier / call / effect), shown compactly.
function DetailFacts({ entity, isEditable }) {
  if (!entity) return null;
  const facts = [];
  // Parameterized skills (Lore (Historical), Profession (Smith)) resolve to the
  // base skill; surface the chosen area so the reader sees what was picked.
  if (entity.parameter && !isEditable) facts.push([entity.baseName === "Lore" ? "Area" : "Choice", entity.parameter]);
  if (typeof entity.cost === "number") facts.push(["Cost", `${entity.cost} BP`]);
  else if (entity.cost && /^var/i.test(String(entity.cost))) facts.push(["Cost", "Variable"]);
  if (entity.prereq && entity.prereq !== "None") facts.push(["Prereq", entity.prereq]);
  if (entity.prerequisites && entity.prerequisites !== "None") facts.push(["Prereq", entity.prerequisites]);
  if (entity.tier) facts.push(["Tier", entity.tier]);
  if (entity.discipline) facts.push(["Discipline", entity.discipline]);
  if (entity.materials) facts.push(["Materials", entity.materials]);
  if (entity.application) facts.push(["Application", entity.application]);
  if (entity.components) facts.push(["Components", entity.components]);
  if (entity.ritualists) facts.push(["Ritualists", String(entity.ritualists)]);
  if (entity.refresh && entity.refresh !== "None") facts.push(["Refresh", entity.refresh]);
  if (entity.call && entity.call !== "None") facts.push(["Call", entity.call]);
  if (entity.effect) facts.push(["Effect", entity.effect]);
  if (facts.length === 0) return null;
  return (
    <dl className="b-facts">
      {facts.map(([k, v]) => (
        <div key={k} className="b-fact">
          <dt className="b-fact-label">{k}</dt>
          <dd className="b-fact-val">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// A clickable list of related entities. `ids` are entity ids; each resolves to a
// name and navigates the inspector when clicked. Unresolvable ids are skipped.
function LinkList({ title, ids, tone, onInspect }) {
  const links = useMemo(() => {
    const seen = new Set();
    return (ids || []).filter((id) => !seen.has(id) && seen.add(id))
      .map((id) => ({ id, ent: lookupEntity(id), type: id.slice(0, id.indexOf(":")), name: id.slice(id.indexOf(":") + 1) }))
      // Only show links that actually resolve, so none dead-end.
      .filter((l) => l.ent);
  }, [ids]);
  if (links.length === 0) return null;
  return (
    <div className="b-links">
      {title && <h3 className={`b-links-title b-links-${tone}`}>{title}</h3>}
      <ul className="b-links-list">
        {links.map((l) => (
          <li key={l.id}>
            <button className="b-link" onClick={() => onInspect(l.name, null, l.type)}>
              {l.name}
              <span className="b-link-type">{l.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Forward links: what this entity requires (prereqs), enables (unlocks), and
// references (mentions). These are the "follow the thread" links.
function ForwardLinks({ entity, onInspect }) {
  const pr = REFS.prereqs[entity.id];
  const prereqIds = pr ? [...(pr.skills || []), ...((pr.anyOf || []).flat())] : [];
  const unlockIds = REFS.unlocks[entity.id] || [];
  const mentionIds = REFS.mentions[entity.id] || [];
  return (
    <>
      <LinkList title="Requires" ids={prereqIds} tone="red" onInspect={onInspect} />
      <LinkList title="Unlocks" ids={unlockIds} tone="green" onInspect={onInspect} />
      <LinkList title="References" ids={mentionIds} tone="blue" onInspect={onInspect} />
    </>
  );
}

// Backlinks: archetypes that pick this entity (followable to nothing useful yet,
// so rendered as plain labels) and other entities that mention it.
function BackLinks({ entity, onInspect }) {
  const mb = REFS.mentionedBy[entity.id] || [];
  const archetypes = mb.filter((id) => id.startsWith("archetypes:"));
  const others = mb.filter((id) => !id.startsWith("archetypes:"));
  if (archetypes.length === 0 && others.length === 0) return null;
  return (
    <>
      {archetypes.length > 0 && (
        <div className="b-links">
          <h3 className="b-links-title b-links-dim">Picked by archetypes</h3>
          <ul className="b-links-list">
            {archetypes.map((id) => <li key={id} className="b-link-static">{id.slice("archetypes:".length)}</li>)}
          </ul>
        </div>
      )}
      {/* "Mentioned by" is low-signal, so it's collapsed behind a disclosure. */}
      {others.length > 0 && (
        <details className="b-mentioned">
          <summary className="b-mentioned-summary">Mentioned by {others.length} other{others.length > 1 ? "s" : ""}</summary>
          <LinkList ids={others} tone="dim" onInspect={onInspect} />
        </details>
      )}
    </>
  );
}

// Resolve the entity an item refers to, using name-based lookup.
function useResolvedEntity(item, field, resolveType) {
  return useMemo(() => {
    if (!item) return null;
    let type = resolveType;
    if (!type && field) {
      if (field === 'flaws') type = 'flaws';
      else if (field.endsWith('Skills')) type = 'skills';
      else if (field.endsWith('Perks')) type = 'perks';
      else type = 'powers';
    }
    const resolved = type ? lookupEntity(`${type}:${item}`) : null;
    if (resolved) {
      return { ...resolved, name: item };
    }
    return null;
  }, [item, field, resolveType]);
}

// ─── LINEAGE PANEL ────────────────────────────────────────────────────────────
// Full-screen panel for the lineage build economy: pick a lineage + sublineage,
// then take Challenges (which AWARD Lineage Build Points, capped at MAX_LBP) and
// spend that LBP on Advantages. Items scoped to "General" or the chosen
// sublineage. Live LBP meter + validity (overspend / required / mixed sublineage).
function LineagePanel({ character, report, onSetLineage, onSetSublineage, onToggle, onInspect, onClose }) {
  const lbp = report.lbp;
  const lin = character.lineage ? LINEAGES[character.lineage] : null;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Items selectable given the chosen sublineage: always "General"; before a
  // sublineage is picked, show all (so you can browse); after, only that
  // sublineage's items (matched on the normalized sublineage key, since the data
  // tags it inconsistently).
  const picked = character.sublineage ? subKey(character.sublineage) : null;
  const visible = (items) => (items || []).filter((it) => {
    const k = subKey(it.sublineage);
    return !k || k === "general" || !picked || k === picked;
  });

  const Row = ({ it, field, kind }) => {
    const chosen = (character[field] || []).includes(it.name);
    // Named abilities this item grants (advantages mostly): resolve the build-time
    // grant edge so the picker shows "grants: Magical Resilience" before you take it.
    const srcId = `${kind === "challenge" ? "challenges" : "advantages"}:${character.lineage} - ${it.baseName || it.name}`;
    const grantIds = (REFS.grants || {})[srcId] || [];
    return (
      <li className={`b-lin-row ${chosen ? "is-on" : ""}`}>
        <div className="b-lin-row-head">
          <button className="b-lin-toggle" onClick={() => onToggle(field, it.name)}
                  title={chosen ? "Remove" : "Take"}>{chosen ? "✓" : "+"}</button>
          <button className="b-lin-name" onClick={() => onInspect(it.name, field, kind === "challenge" ? "flaws" : "perks")}>
            {it.baseName || it.name}
            {it.required && <span className="b-lin-req">required</span>}
            {it.repped && <span className="b-lin-repped">repped</span>}
          </button>
          <span className={`b-lin-lbp ${kind === "challenge" ? "is-award" : "is-cost"}`}>
            {kind === "challenge" ? `+${it.lbp}` : `−${it.lbp}`} LBP
          </span>
        </div>
        {(it.desc || it.description) && <p className="b-lin-desc">{it.desc || it.description}</p>}
        {grantIds.length > 0 && (
          <p className="b-lin-grants">
            grants:{" "}
            {grantIds.map((id, i) => {
              const ent = lookupEntity(id);
              const type = id.slice(0, id.indexOf(":"));
              return (
                <button key={id} className="b-lin-grant-link"
                        onClick={() => onInspect(ent?.name || id.slice(id.indexOf(":") + 1), type, type)}>
                  {ent?.name || id.slice(id.indexOf(":") + 1)}{i < grantIds.length - 1 ? ", " : ""}
                </button>
              );
            })}
          </p>
        )}
      </li>
    );
  };

  return (
    // Docked as a right-side sheet (not a centered modal) so the main character
    // view stays scrollable beside it while you pick — aria-modal is false since
    // the background remains usable.
    <div className="b-overlay b-overlay-dock" role="dialog" aria-modal="false" aria-label="Lineage">
      <div className="b-picker b-picker-dock" onClick={(e) => e.stopPropagation()}>
        <header className="b-picker-head">
          <div>
            <h2 className="b-picker-title">Lineage</h2>
            <p className="b-picker-sub">
              {lin ? `${character.lineage} · ${lbp.remaining} LBP left (${lbp.awarded} earned − ${lbp.spent} spent)${lbp.capped ? ", capped at 10" : ""}`
                   : "Choose your ancestry"}
            </p>
          </div>
          <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        {/* Initial chooser: a card per lineage (name + flavor + sublineages) so you
            can see what each ancestry is before committing. */}
        {!lin && (
          <div className="b-lin-cards">
            {Object.entries(LINEAGES).map(([name, l]) => (
              <button key={name} className="b-lin-card" onClick={() => onSetLineage(name)}>
                <span className="b-lin-card-name">{name}</span>
                {l.description && <span className="b-lin-card-desc">{l.description}</span>}
                {l.sublineages?.length > 0 && (
                  <span className="b-lin-card-subs">
                    {l.sublineages.map((s) => (
                      <span key={typeof s === "string" ? s : s.name} className="b-lin-card-sub">
                        {typeof s === "string" ? s : s.name}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Once chosen: a compact lineage switcher + sublineage chips. */}
        {lin && (
          <div className="b-lin-selectors">
            <select className="b-lin-select" value={character.lineage || ""}
                    onChange={(e) => onSetLineage(e.target.value)}>
              <option value="">— choose a lineage —</option>
              {Object.keys(LINEAGES).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {lin?.sublineages?.length > 0 && (
              <div className="b-domain-chips">
                {lin.sublineages.map((s) => {
                  const label = typeof s === "string" ? s : s.name;
                  const on = character.sublineage === label;
                  return (
                    <button key={label} className={`b-domain-chip ${on ? "is-on" : ""}`}
                            onClick={() => onSetSublineage(label)}>{label}</button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {lin && (
          <>
            {/* validity hints */}
            {!lbp.valid && (
              <p className="b-lin-flag">
                {lbp.overspent && `Over by ${lbp.spent - lbp.awarded} LBP. `}
                {lbp.mixedSublineage && "Items from more than one sublineage. "}
                {lbp.needsSublineage && `Select the ${lbp.requiredSublineages.join("/")} sublineage above to take its Challenges/Advantages. `}
                {lbp.missingRequired.length > 0 && `Required: ${lbp.missingRequired.map((c) => c.baseName).join(", ")}.`}
              </p>
            )}
            <div className="b-export-cols">
              <div className="b-export-half">
                <h3 className="b-export-label">Challenges — award LBP</h3>
                <ul className="b-lin-list">
                  {visible(lin.challenges).map((it) => <Row key={it.name} it={it} field="lineageChallenges" kind="challenge" />)}
                </ul>
              </div>
              <div className="b-export-half">
                <h3 className="b-export-label">Advantages — spend {lbp.remaining} LBP left</h3>
                <ul className="b-lin-list">
                  {visible(lin.advantages).map((it) => <Row key={it.name} it={it} field="lineageAdvantages" kind="advantage" />)}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── EXPORT / IMPORT PANEL ────────────────────────────────────────────────────
// Overlay with two halves: EXPORT (the current character as plain text, in the
// archetype sheet format, with copy + download) and IMPORT (paste a sheet → parse
// → preview validity → load). The text format round-trips with the export.
function ExportImportPanel({ character, report, onImport, onClose }) {
  const exported = useMemo(() => formatCharacterSheet(character, report), [character, report]);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  // A parsed character from an uploaded .xlsx (takes precedence over pasted text).
  const [xlsx, setXlsx] = useState(null);  // { parsed } | { error } | null

  // Read + parse an uploaded .xlsx Basic Sheet into a character (lazy-load the
  // parser so the xlsx lib isn't pulled in until someone actually uploads).
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const { parseXlsxCharacter } = await import("./data/xlsx-import.js");
      setXlsx({ parsed: parseXlsxCharacter(buf) });
    } catch (err) {
      setXlsx({ error: String(err.message || err) });
    }
  };

  // Live preview: an uploaded spreadsheet wins; otherwise the pasted text.
  const preview = useMemo(() => {
    if (xlsx?.error) return { error: xlsx.error };
    if (xlsx?.parsed) return { parsed: xlsx.parsed, report: validate(xlsx.parsed) };
    const text = draft.trim();
    if (!text) return null;
    try {
      const parsed = parseCharacterSheet(text);
      return { parsed, report: validate(parsed) };
    } catch (e) {
      return { error: String(e) };
    }
  }, [draft, xlsx]);

  const copy = () => {
    navigator.clipboard?.writeText(exported);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  const [xlsxError, setXlsxError] = useState(null);
  const safeName = (ext) => `${(character.name || character.archetypeName || "character").replace(/[^\w]+/g, "-")}.${ext}`;
  const downloadBlob = (data, type, ext) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = safeName(ext); a.click();
    URL.revokeObjectURL(url);
  };
  const download = () => downloadBlob(exported, "text/plain", "txt");
  // Export an .xlsx Basic Sheet (lazy-load the xlsx lib only when used, matching
  // the import path). Round-trips back through the .xlsx importer.
  const downloadXlsx = async () => {
    try {
      setXlsxError(null);
      const { buildXlsxCharacter } = await import("./data/xlsx-import.js");
      downloadBlob(buildXlsxCharacter(character, report),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
    } catch (err) {
      setXlsxError(String(err.message || err));
    }
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="b-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="b-export" onClick={(e) => e.stopPropagation()}>
        <header className="b-picker-head">
          <h2 className="b-picker-title">Export / Import</h2>
          <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="b-export-cols">
          {/* EXPORT */}
          <div className="b-export-half">
            <div className="b-export-head">
              <h3 className="b-export-label">Export</h3>
              <div className="b-export-actions">
                <button className="b-topbar-btn" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
                <button className="b-topbar-btn" onClick={download}>Download .txt</button>
                <button className="b-topbar-btn" onClick={downloadXlsx}>Download .xlsx</button>
              </div>
            </div>
            {xlsxError && <p className="b-export-err">Couldn’t build .xlsx: {xlsxError}</p>}
            <textarea className="b-export-text" readOnly aria-label="Exported character sheet" value={exported} />
          </div>
          {/* IMPORT */}
          <div className="b-export-half">
            <div className="b-export-head">
              <h3 className="b-export-label">Import</h3>
              {preview && !preview.error && (
                <span className={`b-export-status ${preview.report.valid ? "is-valid" : "is-invalid"}`}>
                  {preview.report.valid ? "✓ legal" : "⚠ check"} · BP {preview.report.spend.net}/{preview.report.budget} · L{preview.report.level}
                </span>
              )}
            </div>
            {preview && !preview.error && !preview.report.valid && (
              <ul className="b-import-reasons">
                {validityReasons(preview.report).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            <label className="b-import-file">
              <input type="file" accept=".xlsx" onChange={onFile} />
              ⬆ Upload an .xlsx character sheet
            </label>
            {xlsx?.parsed && <p className="b-import-filenote">Loaded from spreadsheet — clear the field below to re-upload.</p>}
            <textarea className="b-export-text" placeholder="…or paste a character sheet — plain text, the HTML export, or a spreadsheet copy…"
                      value={draft} onChange={(e) => { setDraft(e.target.value); if (xlsx) setXlsx(null); }} />
            {preview?.error && <p className="b-export-err">Couldn’t parse: {preview.error}</p>}
            <button className="b-read-choose" disabled={!preview || preview.error}
                    onClick={() => onImport(preview.parsed)}>
              Load this character
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT COMPONENT ─────────────────────────────────────────────────────────

export default function Builder() {
  const [character, setCharacter] = useState(() => readFromHash() || EMPTY_CHARACTER);
  // view: null | {mode:'inspect', item, field, resolveType, archetypeName, category?, index?, choosable?}
  // The rail detail pane is inspect-only now; picking happens in a full-screen
  // overlay tracked separately by `picking`.
  const [view, setView] = useState(null);
  const [picking, setPicking] = useState(null); // null | picker spec
  const [exportOpen, setExportOpen] = useState(false);
  // Navigation history for the inspector so link-following has a back button.
  const [history, setHistory] = useState([]);

  const report = useMemo(() => validate(character), [character]);

  useEffect(() => { writeToHash(character); }, [character]);

  useEffect(() => {
    const onHashChange = () => {
      const next = readFromHash();
      if (next) setCharacter(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handlePickArchetype = useCallback((archetype) => {
    setCharacter(loadArchetype(archetype));
    setView(null); setHistory([]);
  }, []);

  const handleSetName = useCallback((name) => {
    setCharacter((c) => ({ ...c, name }));
  }, []);

  // ─── DEVOTION ────────────────────────────────────────────────────────────
  // Open the devotion picker (any character may follow a devotion). Choosing one
  // sets character.devotion and resets domain choices to those still valid.
  const handlePickDevotion = useCallback(() => {
    const candidates = DEVOTIONS.map((d) => ({
      name: d.name, desc: d.lore || (d.tenets || []).join(" "),
      cat: d.locality || "Devotion",
    }));
    setPicking(entityPickerSpec({
      kind: "devotion", entityType: "devotions", candidates, title: "Choose a devotion",
      taken: new Set(character.devotion ? [character.devotion] : []),
      onChoose: (name) => {
        const dev = DEVOTIONS.find((d) => d.name === name);
        setCharacter((c) => {
          const updateWorship = (list) => {
            return list.map(s => {
              if (/^worship\b/i.test(s)) {
                return formatParameterizedName("Worship", name, s);
              }
              return s;
            });
          };
          return {
            ...c,
            devotion: name,
            divineDomains: (c.divineDomains || []).filter((dn) => dev?.domains.includes(dn)),
            startingSkills: updateWorship(c.startingSkills || []),
            purchasedSkills: updateWorship(c.purchasedSkills || []),
          };
        });
        setPicking(null);
      },
    }));
  }, [character.devotion]);

  // Toggle a divine domain on/off (cap MAX_DOMAINS). Removing a domain drops the
  // domain powers purchased from it.
  const handleToggleDomain = useCallback((domain) => {
    setCharacter((c) => {
      const cur = c.divineDomains || [];
      if (cur.includes(domain)) {
        const nextDomains = cur.filter((d) => d !== domain);
        // Drop domain powers that belonged to the removed domain.
        const domPowers = (DOMAINS.find((x) => x.name === domain)?.powers || []).map((p) => p.name);
        return {
          ...c, divineDomains: nextDomains,
          domainPowers: (c.domainPowers || []).filter((p) => !domPowers.includes(p.replace(/\s*\(.+\)$/, "")) && !domPowers.includes(p)),
        };
      }
      if (cur.length >= MAX_DOMAINS) return c;
      return { ...c, divineDomains: [...cur, domain] };
    });
  }, []);

  const handleClearDevotion = useCallback(() => {
    setCharacter((c) => {
      const clearWorship = (list) => {
        return list.map(s => {
          if (/^worship\b/i.test(s)) {
            return "Worship";
          }
          return s;
        });
      };
      return {
        ...c,
        devotion: null,
        divineDomains: [],
        domainPowers: [],
        startingSkills: clearWorship(c.startingSkills || []),
        purchasedSkills: clearWorship(c.purchasedSkills || []),
      };
    });
  }, []);

  const handleToggleBackstory = useCallback(() => {
    setCharacter((c) => ({ ...c, backstoryApproved: !c.backstoryApproved }));
  }, []);

  const handleSetEvent = useCallback((eventNum) => {
    setCharacter((c) => {
      const next = { ...c, currentEvent: eventNum };
      const levelFloor = EVENTS_TABLE.find((e) => e.event === eventNum)?.level || 4;
      const classes = getClasses(next);
      if (classes.length === 1) {
        // Character is single-classed, so we can cleanly level them up to the floor!
        const primary = classes[0];
        if (primary.level < levelFloor) {
          const nextClasses = [{ name: primary.name, level: levelFloor }];
          let updated = { ...next, classes: nextClasses };
          updated = applyClassStartingAbilities(updated, primary.name, levelFloor);
          return updated;
        }
      }
      return next;
    });
  }, []);

  const handleSetExtraBP = useCallback((bp) => {
    setCharacter((c) => ({ ...c, extraMaxBP: bp }));
  }, []);

  // ─── LINEAGE ─────────────────────────────────────────────────────────────
  const [lineageOpen, setLineageOpen] = useState(false);

  // Set the lineage. Clears sublineage + chosen challenges/advantages that don't
  // belong to the new lineage (simplest: reset them on lineage change).
  const handleSetLineage = useCallback((name) => {
    setCharacter((c) => name === c.lineage ? c
      : { ...c, lineage: name, sublineage: null, lineageChallenges: [], lineageAdvantages: [] });
  }, []);

  const handleSetSublineage = useCallback((sub) => {
    setCharacter((c) => ({ ...c, sublineage: c.sublineage === sub ? null : sub }));
  }, []);

  // Record (or clear) a build-time choose-one selection, keyed by power id.
  const handleSetChoice = useCallback((powerId, option) => {
    setCharacter((c) => {
      const choices = { ...(c.choices || {}) };
      if (option == null || choices[powerId] === option) delete choices[powerId];
      else choices[powerId] = option;
      return { ...c, choices };
    });
  }, []);

  // Toggle a lineage challenge or advantage by its display name.
  const handleToggleLineageItem = useCallback((field, name) => {
    setCharacter((c) => {
      const cur = c[field] || [];
      return { ...c, [field]: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] };
    });
  }, []);

  // Start a blank build: pick a class first (a character with no class has no
  // slots and nothing to build), then land in a buildable empty character at the
  // starter level with that class.
  const handleStartBlank = useCallback(() => {
    const candidates = Object.keys(CLASS_POWER_SLOTS).map((name) => ({
      name, desc: CLASSES[name]?.description || "", cat: CLASSES[name]?.type || "Class",
    }));
    setPicking(entityPickerSpec({
      kind: "class", entityType: "classes", candidates,
      title: "Start blank — choose your class", taken: new Set(),
      onChoose: (name) => {
        const char = {
          ...EMPTY_CHARACTER,
          archetypeName: "Custom Build",
          classes: [{ name, level: 1 }],
        };
        setCharacter(applyClassStartingAbilities(char, name, 1));
        setView(null); setHistory([]); setPicking(null);
      },
    }));
  }, []);

  // Inspect an entity. `slot` (optional) carries the pick context so the
  // inspector can offer "Choose this power". Pushes current view onto history.
  const handleInspect = useCallback((item, field, resolveType, slot = null) => {
    setView((cur) => {
      if (cur) setHistory((h) => [...h, cur]);
      return {
        mode: "inspect", item, field, resolveType,
        archetypeName: character.archetypeName,
        category: slot?.category, index: slot?.index, choosable: !!slot,
      };
    });
  }, [character.archetypeName]);

  const handleUpdateParameter = useCallback((field, oldName, newName) => {
    setCharacter((c) => {
      const list = c[field] || [];
      const idx = list.indexOf(oldName);
      if (idx < 0) return c;
      const next = [...list];
      next[idx] = newName;
      
      let nextChar = { ...c, [field]: next };

      // Two-way sync: if we are updating a Worship skill parameter, update character devotion
      let baseName = "";
      let paramVal = "";
      let paramMatch = newName.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      if (!paramMatch) {
        const dashIdx = newName.indexOf(' - ');
        if (dashIdx > 0) {
          baseName = newName.slice(0, dashIdx).trim();
          paramVal = newName.slice(dashIdx + 3).trim();
        } else {
          baseName = newName.trim();
        }
      } else {
        baseName = paramMatch[1].trim();
        paramVal = paramMatch[2].trim();
      }

      if (baseName === "Worship") {
        if (!paramVal) {
          nextChar.devotion = null;
          nextChar.divineDomains = [];
          nextChar.domainPowers = [];
        } else {
          const dev = DEVOTIONS.find(d =>
            d.name.toLowerCase() === paramVal.toLowerCase() ||
            d.name.toLowerCase().startsWith(paramVal.toLowerCase()) ||
            paramVal.toLowerCase().startsWith(d.name.toLowerCase())
          );
          const canonicalDevName = dev ? dev.name : paramVal;
          nextChar.devotion = canonicalDevName;
          if (dev) {
            nextChar.divineDomains = (c.divineDomains || []).filter((dn) => dev.domains.includes(dn));
            // Keep only domain powers of remaining domains
            const remainingDomains = nextChar.divineDomains;
            nextChar.domainPowers = (c.domainPowers || []).filter((p) => {
              const basePower = p.replace(/\s*\(.+\)$/, "");
              return remainingDomains.some(dn => {
                const dom = DOMAINS.find(x => x.name === dn);
                return dom?.powers.some(x => x.name === basePower || x.name === p);
              });
            });
          }
        }
      }

      return nextChar;
    });
    setView((v) => v ? { ...v, item: newName } : null);
  }, []);

  // Commit a power pick, tagged with the slot's class. When flatIndex >= 0 it
  // replaces (swap); otherwise it appends. `fieldOverride` lets the spells-known
  // picker route a pick to its actual tier field (noviceSpells/adeptSpells/
  // greaterSpells) rather than the single SLOT_FIELD mapping.
  // powerClass[field][i] records the owning class so per-class slots stay sorted.
  const setSlotPick = useCallback((slot, flatIndex, powerName, fieldOverride) => {
    const field = fieldOverride || SLOT_FIELD[slot.category];
    setCharacter((c) => {
      const next = [...(c[field] || [])];
      const pc = { ...(c.powerClass || {}) };
      pc[field] = [...(pc[field] || [])];
      const at = flatIndex >= 0 ? flatIndex : next.length;
      next[at] = powerName;
      pc[field][at] = slot.cls;
      return { ...c, [field]: next, powerClass: pc };
    });
    setPicking(null);
  }, []);

  // Open a power slot for picking; clear=true removes the pick at flatIndex.
  // `fieldHint` targets the pick's actual field (needed for spells-known, whose
  // picks live across noviceSpells/adeptSpells/greaterSpells).
  const handleOpenSlot = useCallback((slot, flatIndex, clear = false, fieldHint) => {
    const field = fieldHint || SLOT_FIELD[slot.category];
    if (clear) {
      setCharacter((c) => {
        const next = [...(c[field] || [])];
        next.splice(flatIndex, 1);
        const pc = { ...(c.powerClass || {}) };
        if (pc[field]) { pc[field] = [...pc[field]]; pc[field].splice(flatIndex, 1); }
        return { ...c, [field]: next, powerClass: pc };
      });
      return;
    }
    setPicking(powerPickerSpec(
      { ...slot, onChoose: (name, fieldOverride) => setSlotPick(slot, flatIndex, name, fieldOverride) },
      character,
    ));
  }, [character, setSlotPick]);

  // Append a skill / perk / flaw to its list (purchasedSkills / purchasedPerks /
  // flaws). De-duped; closes the picker after.
  const handleAddEntity = useCallback((field, name) => {
    setCharacter((c) => {
      const list = c[field] || [];
      if (list.includes(name)) return c;
      return { ...c, [field]: [...list, name] };
    });
    setPicking(null);
  }, []);

  // Remove a purchased skill / perk / flaw by index.
  const handleRemoveEntity = useCallback((field, index) => {
    setCharacter((c) => {
      const next = [...(c[field] || [])];
      next.splice(index, 1);
      return { ...c, [field]: next };
    });
  }, []);

  // Change the character's level by rewriting the number in classLevels
  // ("Fighter 4" → "Fighter 5"). Budget and slot caps follow automatically via
  // the validator; existing picks are kept (the user prunes if a level-down puts
  // them over a cap, which the validator flags).
  const handleLevelChange = useCallback((next) => {
    const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, next));
    setCharacter((c) => {
      if (!c.classLevels) return c;
      return { ...c, classLevels: c.classLevels.replace(/\d+/, String(level)) };
    });
  }, []);

  // ─── CLASS MANAGEMENT (multi-class) ──────────────────────────────────────
  // Migrate a character onto the canonical `classes` array form (from the legacy
  // classLevels string) so class edits have a stable shape to mutate.
  const toClassesForm = (c) => {
    if (Array.isArray(c.classes) && c.classes.length) return c;
    const classes = getClasses(c);
    return { ...c, classes, classLevels: undefined };
  };

  // Set a single class's level (clamped so total level stays within table bounds).
  const handleSetClassLevel = useCallback((className, level) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      const others = c.classes.filter((x) => x.name !== className)
        .reduce((n, x) => n + x.level, 0);
      const lvl = Math.max(1, Math.min(MAX_LEVEL - others, level));
      const nextClasses = c.classes.map((x) => x.name === className ? { ...x, level: lvl } : x);
      let updated = { ...c, classes: nextClasses };
      const primary = nextClasses[0];
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      return updated;
    });
  }, []);

  // Add a class. Its Multi-Class Skills + redundant-grant free BP are DERIVED from
  // the class list by the validator (multiclassGrants), not materialized here —
  // so the handler only records the user's intent: which class, at level 1.
  const handleAddClass = useCallback((className) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      if (c.classes.some((x) => x.name === className)) return c0;
      const nextClasses = [...c.classes, { name: className, level: 1 }];
      let updated = { ...c, classes: nextClasses };
      const primary = nextClasses[0];
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      updated = applyClassStartingAbilities(updated, className, 1);
      return updated;
    });
    setPicking(null);
  }, []);

  // Remove a class and its attributed power picks. Multiclass-granted skills and
  // free BP are derived, so removing the class drops them automatically — only the
  // class's POWER picks (real stored state) need cleaning up here.
  const handleRemoveClass = useCallback((className) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      if (c.classes.length <= 1) return c0; // keep at least one class
      const classes = c.classes.filter((x) => x.name !== className);
      const next = { ...c, classes };
      // Drop power picks tagged to the removed class.
      for (const field of Object.values(SLOT_FIELD)) {
        const picks = c[field]; if (!picks) continue;
        const keep = picks.map((name, i) => ({ name, i }))
          .filter(({ name, i }) => pickClass(c, field, i, name) !== className);
        next[field] = keep.map((k) => k.name);
        if (c.powerClass?.[field]) {
          next.powerClass = { ...(next.powerClass || c.powerClass) };
          next.powerClass[field] = keep.map((k) => c.powerClass[field][k.i]);
        }
      }
      const primary = classes[0];
      let updated = next;
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      return updated;
    });
  }, []);

  // Open the class picker. Classes already taken are marked.
  const handleOpenClassPicker = useCallback(() => {
    const taken = new Set(getClasses(character).map((c) => c.name));
    const candidates = Object.keys(CLASS_POWER_SLOTS).map((name) => ({
      name, desc: CLASSES[name]?.description || "", cat: CLASSES[name]?.type || "Class",
    }));
    setPicking(entityPickerSpec({
      kind: "class", entityType: "classes", candidates,
      title: "Add a class", taken, onChoose: handleAddClass,
    }));
  }, [character, handleAddClass]);

  // Open the add-picker for skills / perks / flaws.
  const handleOpenAdd = useCallback((kind) => {
    // Domain powers are dynamic — drawn from the devotion's chosen domains, each
    // tagged with its domain for grouping. Built here rather than from a static list.
    if (kind === "domainPower") {
      const eligible = (report.devotion?.eligiblePowers || []).map((p) => ({
        name: p.name, desc: p.description || p.desc || "", cat: p.domain, cost: p.cost,
      }));
      setPicking(entityPickerSpec({
        kind: "domainPower", entityType: "powers", candidates: eligible, title: "Add a domain power",
        taken: new Set(character.domainPowers || []),
        onChoose: (name) => handleAddEntity("domainPowers", name),
      }));
      return;
    }
    if (kind === "classPower") {
      // Class Skills from every class the character has levels in (rule: "Class
      // Skills from any Class you have taken levels in"), tagged by class.
      const eligible = getClasses(character).flatMap((c) =>
        (eligiblePowers(c.name, "classSkills") || []).map((p) => ({
          name: p.name, desc: p.description || p.desc || "", cat: c.name,
          cost: p.cost, refresh: p.refresh,
        })));
      setPicking(entityPickerSpec({
        kind: "classPower", entityType: "powers", candidates: eligible, title: "Add a class power",
        // Mark taken from the classified bucket so a class power misfiled into the
        // skill lists still reads as already-owned and can't be bought twice (#4).
        taken: new Set((report.owned?.classPowers || []).map((r) => r.name)),
        onChoose: (name) => handleAddEntity("classPowers", name),
      }));
      return;
    }
    // Taken-sets read from the classified buckets (report.owned), not the raw
    // fields, so items resolve to their true kind across mis-filed storage.
    const config = {
      skill: { field: "purchasedSkills", entityType: "skills", candidates: ALL_SKILLS, title: "Add a skill",
               taken: (report.owned?.skills || []).map((r) => r.name) },
      perk:  { field: "purchasedPerks", entityType: "perks", candidates: ALL_PERKS, title: "Add a perk",
               taken: (report.owned?.perks || []).map((r) => r.name) },
      flaw:  { field: "flaws", entityType: "flaws", candidates: ALL_FLAWS, title: "Add a flaw",
               taken: (character.flaws || []) },
    }[kind];
    setPicking(entityPickerSpec({
      kind, entityType: config.entityType, candidates: config.candidates, title: config.title,
      taken: new Set(config.taken),
      onChoose: (name) => handleAddEntity(config.field, name),
    }));
  }, [character, handleAddEntity, report.devotion, report.owned]);

  const handleBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) { setView(null); return h; }
      const prev = h[h.length - 1];
      setView(prev);
      return h.slice(0, -1);
    });
  }, []);

  const handleClose = useCallback(() => { setView(null); setHistory([]); }, []);

  const handleRestart = useCallback(() => {
    if (window.confirm("Discard this character and start over?")) {
      setCharacter(EMPTY_CHARACTER);
      setView(null); setHistory([]);
    }
  }, []);

  const handleClickIdentityField = useCallback((field) => {
    if (field === "class") {
      const primary = getClasses(character)[0]?.name;
      if (primary) handleInspect(primary, null, "classes");
      return;
    }
    const item = character[field];
    if (item) handleInspect(item, null, field);
  }, [character, handleInspect]);

  return (
    <div className="b-root">
      <BTopBar character={character} report={report} onLevelChange={handleLevelChange}
               onExport={() => setExportOpen(true)} />
      <div className="b-cols">
        <IdentityRail character={character} report={report}
                      onClickField={handleClickIdentityField} onRestart={handleRestart}
                      onSetClassLevel={handleSetClassLevel} onRemoveClass={handleRemoveClass}
                      onAddClass={handleOpenClassPicker}
                      onPickDevotion={handlePickDevotion} onToggleDomain={handleToggleDomain}
                      onClearDevotion={handleClearDevotion} onOpenLineage={() => setLineageOpen(true)}
                      onToggleBackstory={handleToggleBackstory} onInspect={handleInspect}
                      onSetEvent={handleSetEvent} onSetExtraBP={handleSetExtraBP} />
        <BuildSheet character={character} report={report} view={view}
                    onPickArchetype={handlePickArchetype} onStartBlank={handleStartBlank}
                    onInspect={handleInspect} onOpenSlot={handleOpenSlot}
                    onOpenAdd={handleOpenAdd} onRemoveEntity={handleRemoveEntity}
                    onSetName={handleSetName} onOpenLineage={() => setLineageOpen(true)} />
        <DetailPane view={view} report={report}
                    choices={character.choices} onSetChoice={handleSetChoice}
                    onUpdateParameter={handleUpdateParameter}
                    onInspect={handleInspect}
                    onBack={history.length ? handleBack : null} onClose={handleClose} />
      </div>
      {picking && (
        <PickerOverlay spec={picking} character={character} onClose={() => setPicking(null)} />
      )}
      {exportOpen && (
        <ExportImportPanel
          character={character} report={report}
          onImport={(c) => { setCharacter(c); setExportOpen(false); setView(null); setHistory([]); }}
          onClose={() => setExportOpen(false)} />
      )}
      {lineageOpen && (
        <LineagePanel character={character} report={report} onInspect={handleInspect}
          onSetLineage={handleSetLineage} onSetSublineage={handleSetSublineage}
          onToggle={handleToggleLineageItem} onClose={() => setLineageOpen(false)} />
      )}
      <SiteFooter />
    </div>
  );
}

// Public provenance footer: the alpha app version + the MegaDoc sync date the
// data was generated from, so players know how current the rules data is.
function SiteFooter() {
  return (
    <footer className="b-footer">
      <span className="b-footer-alpha">Alpha</span>
      <span className="b-footer-ver">v{META.appVersion}</span>
      <span className="b-footer-sep">·</span>
      <span className="b-footer-sync">
        Rules data synced from the {META.sourceDoc} ({META.sourceVersion}) on {META.sourceSyncedLabel}
      </span>
      <span className="b-footer-sep">·</span>
      <span className="b-footer-note">Unofficial fan tool — verify against the current rules.</span>
    </footer>
  );
}

function BTopBar({ character, report, onLevelChange, onExport }) {
  const level = character.archetypeName ? characterLevel(character) : null;
  const [linkCopied, setLinkCopied] = useState(false);
  const copyShareLink = () => {
    navigator.clipboard?.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  };
  return (
    <header className="b-topbar">
      <div className="b-topbar-brand">
        <span className="b-topbar-title">Wellspring</span>
        <span className="b-topbar-sub">Character Builder</span>
      </div>
      <div className="b-topbar-stats">
        {level && (
          <>
            <span className="b-topbar-stat b-level">
              Level
              <button className="b-level-btn" disabled={level <= MIN_LEVEL} aria-label="Level down"
                      onClick={() => onLevelChange(level - 1)} title="Level down">−</button>
              <strong aria-live="polite">{level}</strong>
              <button className="b-level-btn" disabled={level >= MAX_LEVEL} aria-label="Level up"
                      onClick={() => onLevelChange(level + 1)} title="Level up">+</button>
            </span>
            <span className="b-topbar-stat">Budget <strong>{report.budget} BP</strong></span>
            <span className={`b-topbar-stat ${report.valid ? "is-valid" : "is-invalid"}`}
                  title={report.valid ? "" : validityReasons(report).join("\n")}>
              {report.valid ? "✓ legal build"
                : report.belowFloor ? `⚠ below level ${report.legalMinLevel}`
                : "⚠ check build"}
            </span>
            {report.aboveCap && (
              <span className="b-topbar-stat is-note" title={`Total level ${report.level} exceeds the current cap of ${report.levelCap}. Advancing past ${report.levelCap} requires Advanced Classes, which aren't published yet; slots/stats are frozen at level ${report.levelCap}.`}>
                ⚑ above level {report.levelCap} cap (Advanced Classes pending)
              </span>
            )}
          </>
        )}
      </div>
      <div className="b-topbar-actions">
        <button className="b-topbar-btn" onClick={onExport}>Export / Import</button>
        <button className={`b-topbar-btn ${linkCopied ? "is-copied" : ""}`} onClick={copyShareLink}>
          {linkCopied ? "Link copied!" : "Copy share link"}
        </button>
      </div>
    </header>
  );
}
