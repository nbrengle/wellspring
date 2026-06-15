import React, { useState, useMemo } from "react";
import {
  ARCHETYPES, lookupEntity, ALL_SKILLS, ALL_PERKS, ALL_FLAWS,
  CLASS_POWER_SLOTS, CLASSES, DEVOTIONS, DOMAINS, LINEAGES,
  UNLIMITED_SKILLS, REFS
} from "../data/index.js";
import {
  getClasses, MAX_DOMAINS, EVENTS_TABLE, getMaxRanks, pickClass
} from "../data/validate.js";
import { bareSkill, cleanItemName } from "../data/resolver.js";
import {
  STARTING_CHOICES_CONFIG, reconcileStartingChoices
} from "../data/starting-choices.js";

const DEFAULT_WEALTH = 8;
const DEVOTION_NAMES = DEVOTIONS.map((d) => d.name);

const SLOT_FIELD = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
  cantrips: "cantrips",
  spellsKnown: "noviceSpells",
};

const SPELL_TIER_LABEL = {
  noviceSpells: "Novice", adeptSpells: "Adept", greaterSpells: "Greater", cantrips: "Cantrip",
};

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

function Tag({ label, tone = "amber" }) {
  return <span className={`b-tag b-tag-${tone}`}>{label}</span>;
}

function sourceType(name) {
  const clean = String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
  for (const t of ["powers", "perks", "skills"]) {
    if (lookupEntity(`${t}:${clean}`)) return t;
  }
  return null;
}

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

function grantSourceRole(grant) {
  if (!grant?.source) return null;
  if (grant.sourceRole) {
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

// ─── IDENTITY RAIL ───────────────────────────────────────────────────────────
export function IdentityRail({ character, report, onClickField, onRestart,
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

      {/* Lineage card */}
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
          const sources = [];
          if (phys > 0) sources.push({ name: "Physical armor", n: phys, note: type === "physical" ? "in use" : "not in use" });
          for (const s of natSrcRows) sources.push({ ...s, note: `natural${type === "natural" ? ", in use" : ""}` });
          for (const n of natNotes) sources.push({ name: n.name, n: 0, note: "natural, variable", type: sourceType(n.name) });
          return <StatWithSources label="Armor" title={tip} value={value} sources={sources} onInspect={onInspect} />;
        })()}
        {(() => {
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
function LineageSummary({ character, report, onInspect, onOpenLineage }) {
  if (!character.lineage) return null;
  const lbp = report.lbp;
  const chosen = lbp?.chosenAdvantages || [];
  const grantedBySource = {};
  for (const g of (report.grantedAbilities?.list || [])) {
    if (g.sourceKind !== "advantage") continue;
    (grantedBySource[g.source] = grantedBySource[g.source] || []).push(g);
  }
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

function StartingChoicesSection({ character, onSetSpecialty }) {
  const primary = getClasses(character)[0]?.name;
  const configs = (primary && STARTING_CHOICES_CONFIG[primary]) || [];
  const selected = useMemo(() => {
    if (!primary || !configs.length) return {};
    const have = character.startingChoices && Object.keys(character.startingChoices).length;
    return have ? character.startingChoices : reconcileStartingChoices(character, primary);
  }, [character.startingChoices, character.startingSkills, character.ranks?.startingSkills, primary, configs.length]);

  if (!primary || !configs.length) return null;

  return (
    <Section title="Starting Choices" tone="amber">
      <p className="b-spec-hint">
        Your {primary} made {configs.length > 1 ? `${configs.length} choices` : "a choice"} at
        character creation. Change one to swap the free abilities it grants.
      </p>
      <ul className="b-spec-list">
        {configs.map((conf) => (
          <li key={conf.id} className="b-spec-row">
            <label className="b-spec-label" htmlFor={`spec-${conf.id}`}>{conf.label}</label>
            <select
              id={`spec-${conf.id}`}
              className="b-spec-select"
              value={selected[conf.id] ?? conf.options[0]?.label ?? ""}
              onChange={(e) => onSetSpecialty(conf.id, e.target.value)}
            >
              {conf.options.map((opt) => (
                <option key={opt.label} value={opt.label}>{opt.label}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function BuildSheet({ character, report, view, onPickArchetype, onStartBlank, onInspect, onOpenSlot, onOpenAdd, onRemoveEntity, onSetName, onOpenLineage, onSetRank, onSetSpecialty }) {
  if (!character.archetypeName) {
    return <ArchetypePicker onPick={onPickArchetype} onStartBlank={onStartBlank} />;
  }
  const isFocused = (item, field) =>
    view?.mode === "inspect" && view.item === item && view.field === field;

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

      <StartingChoicesSection character={character} onSetSpecialty={onSetSpecialty} />

      <Section title="Skills" tone="amber" onAdd={() => onOpenAdd("skill")}>
        <ClassifiedRows rows={owned.skills} resolveType="skills" report={report}
          onClick={onInspect} isFocused={isFocused} onRemove={onRemoveEntity} onSetRank={onSetRank} character={character} />
      </Section>

      <Section title="Perks" tone="teal" onAdd={() => onOpenAdd("perk")}>
        <ClassifiedRows rows={owned.perks} resolveType="perks" report={report}
          onClick={onInspect} isFocused={isFocused} onRemove={onRemoveEntity} onSetRank={onSetRank} character={character} />
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
            removable={() => true} onRemove={(i) => onRemoveEntity("domainPowers", i)} onSetRank={onSetRank} character={character} />
        </Section>
      )}

      {getClasses(character).length > 0 && (
        <Section title="Class Powers" tone="purple" onAdd={() => onOpenAdd("classPower")}>
          <ClassifiedRows rows={owned.classPowers} resolveType="powers" report={report}
            onClick={onInspect} isFocused={isFocused} onRemove={onRemoveEntity} showClass onSetRank={onSetRank} character={character} />
        </Section>
      )}

      {owned.innatePowers && owned.innatePowers.length > 0 && (
        <Section title="Innate Powers" tone="purple">
          <ClassifiedRows rows={owned.innatePowers} resolveType="powers" report={report}
            onClick={onInspect} isFocused={isFocused} onRemove={onRemoveEntity} showClass onSetRank={onSetRank} character={character} />
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
          removable={() => true} onRemove={(i) => onRemoveEntity("flaws", i)} onSetRank={onSetRank} character={character} />
      </Section>

      {report.crafting?.any && (
        <CraftingSection crafting={report.crafting} onInspect={onInspect} />
      )}
    </main>
  );
}

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

function SlotBlock({ slot, character, onInspect, onOpenSlot, isFocused, pickClassOf }) {
  const fields = slot.category === "spellsKnown"
    ? ["noviceSpells", "adeptSpells", "greaterSpells"]
    : [SLOT_FIELD[slot.category]];
  const granted = slot.granted || [];
  const grantedSet = new Set(granted);
  const myPicks = fields.flatMap((field) =>
    (character[field] || [])
      .map((name, flatIndex) => ({ name, flatIndex, field }))
      .filter((p) => pickClassOf(field, p.flatIndex, p.name) === slot.cls && !grantedSet.has(p.name)));

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
        {granted.map((name) => (
          <li key={`granted-${name}`} className="b-slot-row is-filled is-granted">
            <span className="b-slot-num" title="Granted by class">★</span>
            <button className="b-slot-pick" onClick={() => onInspect(name, fields[0], "powers")}>{name}</button>
            <span className="b-slot-tier b-slot-granted-tag">innate</span>
          </li>
        ))}
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

function ClassifiedRows({ rows, resolveType, report, onClick, isFocused, onRemove, showClass, onSetRank, character }) {
  if (!rows || rows.length === 0) return <p className="b-empty">none</p>;
  return (
    <ul className="b-rows">
      {rows.map((row) => {
        const { name, field, index, source, grantedBy, cls, refundedBP, specialty, floor } = row;
        const costKey = field === 'startingSkills' ? `${field}:${index}:${name}` : `${field}:${name}`;
        const cost = report?.spend.byItem[costKey];
        const fromClass = source === "class";
        const canRemove = !fromClass && index >= 0;
        const rank = cost?.rank || (index >= 0 ? character.ranks?.[field]?.[index] : null) || 1;

        const baseName = bareSkill(cleanItemName(name));
        const maxR = getMaxRanks(name, field, character);
        const grantedFloor = floor || 0;
        const canBuyUp = fromClass && grantedFloor > 0 && maxR > grantedFloor
          && !UNLIMITED_SKILLS.has(baseName);
        const rankFloor = canBuyUp ? grantedFloor : 1;
        const hasRanks = (canRemove || canBuyUp) && maxR > 1 && !UNLIMITED_SKILLS.has(baseName);

        return (
          <li key={`${field}-${index}-${name}-${grantedBy || cls || ''}`} className={`b-row ${isFocused(name, field) ? "is-focused" : ""}`}>
            <button className="b-row-name" onClick={() => onClick(name, field, resolveType, null, index)}>
              {name}{rank > 1 && !hasRanks && <span className="b-row-rank">×{rank}</span>}
            </button>
            {showClass && cls && !fromClass && <span className="b-row-badge b-badge-class">{cls.toUpperCase()}</span>}
            {fromClass
              ? (() => {
                  const src = grantedBy || cls;
                  return (
                    <>
                      {src && (
                        <span className="b-row-badge b-badge-granted"
                              title={specialty ? `Granted free by your ${src}'s "${specialty}" starting choice`
                                : grantedBy ? `Granted free by your ${grantedBy} multi-class`
                                : `Granted free by your ${src} class`}>
                          {src.toUpperCase()}{specialty && <span className="b-badge-spec"> · {specialty}</span>}
                        </span>
                      )}
                      {refundedBP ? (
                        <span className="b-row-badge b-badge-refund" title="Redundant grant refunded as free BP">
                          +{refundedBP} BP
                        </span>
                      ) : null}
                      {canBuyUp && cost?.paidRanks > 0 && <CostBadge cost={cost} />}
                    </>
                  );
                })()
              : <CostBadge cost={cost} />}
            {hasRanks && onSetRank && (
              <div className="b-row-rank-adjust">
                <button className="b-rank-btn" type="button" onClick={() => onSetRank(field, index, rank - 1)} disabled={rank <= rankFloor}>-</button>
                <span className="b-rank-val">{rank}</span>
                <button className="b-rank-btn" type="button" onClick={() => onSetRank(field, index, rank + 1)} disabled={rank >= maxR}>+</button>
              </div>
            )}
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

function EditableRows({ items, field, onClick, isFocused, resolveType, report, removable, onRemove, onSetRank, character }) {
  if (!items || items.length === 0) {
    return <p className="b-empty">none</p>;
  }
  return (
    <ul className="b-rows">
      {items.map((item, i) => {
        const cost = report?.spend.byItem[`${field}:${item}`];
        const canRemove = removable ? removable(i) : false;
        const rank = cost?.rank || 1;

        const baseName = bareSkill(cleanItemName(item));
        const maxR = getMaxRanks(item, field, character);
        const hasRanks = canRemove && maxR > 1 && !UNLIMITED_SKILLS.has(baseName);

        return (
          <li key={`${field}-${i}-${item}`} className={`b-row ${isFocused(item, field) ? "is-focused" : ""}`}>
            <button className="b-row-name" onClick={() => onClick(item, field, resolveType, null, i)}>
              {item}{rank > 1 && !hasRanks && <span className="b-row-rank">×{rank}</span>}
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
