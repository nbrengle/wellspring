import React, { useState, useMemo } from "react";
export { IdentityRail } from "./build-sheet/IdentityRail.jsx";
import { Stat, StatWithSources, Section, CostBadge } from "./build-sheet/SharedUI.jsx";
import { LineageSummary, StartingChoicesSection, GrantedSelectionsSection, AgileLearnerSection, CraftingSection, SlotBlock, ClassifiedRows, EditableRows } from "./build-sheet/MainContent.jsx";
import {
  ARCHETYPES, lookupEntity, ALL_SKILLS, ALL_PERKS, ALL_FLAWS,
  CLASS_POWER_SLOTS, CLASSES, DEVOTIONS, DOMAINS, LINEAGES,
  UNLIMITED_SKILLS, REFS
} from '../engine/data.js';
import {
  MAX_DOMAINS, EVENTS_TABLE, getMaxRanks, pickClass
} from "../engine/validate.js";
import { bareSkill, cleanItemName, getClasses } from "../engine/resolver.js";
import { lookupCost } from "../engine/validate/cost-key.js";
import { useBuilderState, useBuilderActions } from "./builder-context.jsx";
import {
  STARTING_CHOICES_CONFIG, reconcileStartingChoices
} from '../engine/starting-choices.js';
import ArchetypePicker from "./build-sheet/ArchetypePicker.jsx";
import Tag from "./build-sheet/Tag.jsx";

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














// ─── BUILD SHEET ─────────────────────────────────────────────────────────────




export default function BuildSheet() {
  const { character, report } = useBuilderState();
  const { onPickArchetype, onStartBlank, onOpenAdd, onSetName, onChangeArchetype } = useBuilderActions();
  if (!character.archetypeName) {
    return <ArchetypePicker onPick={onPickArchetype} onStartBlank={onStartBlank} />;
  }
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
        <button className="b-btn-change-archetype" onClick={onChangeArchetype} style={{
          background: 'none', border: 'none', color: 'var(--b-amber)', cursor: 'pointer',
          fontSize: '0.85em', padding: '0', marginTop: '0.25rem', textDecoration: 'underline'
        }}>
          ‹ Change Archetype
        </button>
      </header>

      <StartingChoicesSection />
      <GrantedSelectionsSection />

      <Section title="Skills" tone="amber" onAdd={() => onOpenAdd("skill")}>
        <ClassifiedRows rows={owned.skills} resolveType="skills" />
      </Section>

      <Section title="Perks" tone="teal" onAdd={() => onOpenAdd("perk")}>
        <ClassifiedRows rows={owned.perks} resolveType="perks" />
      </Section>

      <LineageSummary />

      {report.devotion?.chosen.length > 0 && (
        <Section title={`Domain Powers — ${report.devotion.chosen.join(" · ")}`} tone="purple"
                 onAdd={report.devotion.worship ? () => onOpenAdd("domainPower") : undefined}>
          {!report.devotion.worship && (
            <p className="b-empty">Take the Worship skill to purchase domain powers.</p>
          )}
          <EditableRows items={character.domainPowers} field="domainPowers" resolveType="powers" removable={() => true} />
        </Section>
      )}

      {getClasses(character).length > 0 && (
        <Section title="Class Powers" tone="purple" onAdd={() => onOpenAdd("classPower")}>
          <ClassifiedRows rows={owned.classPowers} resolveType="powers" showClass />
        </Section>
      )}

      {owned.innatePowers && owned.innatePowers.length > 0 && (
        <Section title="Innate Powers" tone="purple">
          <ClassifiedRows rows={owned.innatePowers} resolveType="powers" showClass />
        </Section>
      )}

      {report.slots.length > 0 && (
        <Section title="Powers" tone="purple">
          <AgileLearnerSection />
          {report.slots.map((slot) => (
            <SlotBlock key={`${slot.cls}-${slot.category}`} slot={slot}
                       pickClassOf={(field, i, name) => pickClass(character, field, i, name)} />
          ))}
        </Section>
      )}

      <Section title="Flaws" tone="red" onAdd={() => onOpenAdd("flaw")}>
        <EditableRows items={character.flaws} field="flaws" resolveType="flaws" removable={() => true} />
      </Section>

      {report.crafting?.any && (
        <CraftingSection crafting={report.crafting} />
      )}
    </main>
  );
}













