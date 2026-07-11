export { IdentityRail } from "./build-sheet/IdentityRail.jsx";
import { Section } from "./build-sheet/SharedUI.jsx";
import {
  LineageSummary,
  StartingChoicesSection,
  BestowedSelectionsSection,
  AgileLearnerSection,
  CraftingSection,
  SlotBlock,
  ClassifiedRows,
} from "./build-sheet/MainContent.jsx";
import { ARCHETYPES } from "../engine/data.js";
import { getClasses } from "../engine/resolver.js";
import { useBuilderState, useBuilderActions } from "./builder-context.jsx";

import ArchetypePicker from "./build-sheet/ArchetypePicker.jsx";

// ─── IDENTITY RAIL ───────────────────────────────────────────────────────────

// ─── BUILD SHEET ─────────────────────────────────────────────────────────────

export default function BuildSheet() {
  const { character, report } = useBuilderState();
  const { onPickArchetype, onStartBlank, onInspect, onOpenAdd, onSetName, onChangeArchetype } = useBuilderActions();
  if (!character.archetypeName) {
    return <ArchetypePicker onPick={onPickArchetype} onStartBlank={onStartBlank} />;
  }
  const owned = report.owned || { skills: [], bestowedSkills: [], perks: [], classPowers: [], innatePowers: [] };

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
          {character.archetypeName && character.archetypeName !== "Custom Build" ? (
            <>
              Based on <em>{character.archetypeName}</em>
              {" — "}
              {ARCHETYPES.find((a) => a.name === character.archetypeName)?.tagline}
            </>
          ) : (
            ARCHETYPES.find((a) => a.name === character.archetypeName)?.tagline
          )}
        </p>
        <button
          className="b-btn-change-archetype"
          onClick={onChangeArchetype}
          style={{
            background: "none",
            border: "none",
            color: "var(--b-amber)",
            cursor: "pointer",
            fontSize: "0.85em",
            padding: "0",
            marginTop: "0.25rem",
            textDecoration: "underline",
          }}
        >
          ‹ Change Archetype
        </button>
      </header>

      <StartingChoicesSection />
      <BestowedSelectionsSection />

      {owned.bestowedSkills?.length > 0 && (
        <Section title="Starting / Free Skills" tone="amber">
          <ClassifiedRows rows={owned.bestowedSkills} resolveType="skills" />
        </Section>
      )}

      <Section title="Purchased Skills" tone="amber" onAdd={() => onOpenAdd("skill")}>
        <ClassifiedRows rows={owned.skills} resolveType="skills" />
      </Section>

      <Section title="Perks" tone="teal" onAdd={() => onOpenAdd("perk")}>
        <ClassifiedRows rows={owned.perks} resolveType="perks" />
      </Section>

      <LineageSummary />

      {report.devotion?.chosen.length > 0 && (
        <Section
          title={`Domain Powers — ${report.devotion.chosen.join(" · ")}`}
          tone="purple"
          onAdd={report.devotion.worship ? () => onOpenAdd("domainPower") : undefined}
        >
          {!report.devotion.worship && <p className="b-empty">Take the Worship skill to purchase domain powers.</p>}
          <ClassifiedRows rows={owned.domainPowers} resolveType="powers" />
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
            <SlotBlock key={`${slot.cls}-${slot.category}`} slot={slot} />
          ))}
        </Section>
      )}

      <Section title="Flaws" tone="red" onAdd={() => onOpenAdd("flaw")}>
        <ClassifiedRows rows={owned.flaws} resolveType="flaws" />
      </Section>

      {report.crafting?.any && <CraftingSection crafting={report.crafting} onInspect={onInspect} />}
    </main>
  );
}
