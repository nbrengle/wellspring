import { ALLERGEN_AWARDS, allergenAward, lookupEntity } from "../../engine/data.js";
import { EFFECT_EXTRACTORS } from "../extractors.js";
import { paramInfo, paramReusable } from "../param-domain.js";
import { bareSkill, cleanItemName, getClasses } from "../resolver.js";
import { startingSkillGrants } from "../starting-choices.js";
import type { CharacterChoice, CharacterState, Effect, Entity, EntitySource, GraphItem } from "../types.js";
import { Source, isPurchased, isStarting, sourceClass } from "../types.js";
import { characterLevel, getMaxRanks } from "../validate/core.js";
import { CharacterGraphModel, extractParam, idPrefix } from "./model.js";

export function normalizeCharacter(character: CharacterState): CharacterState {
  const classes = getClasses(character);
  const powers = [...(character.powers || [])];
  const owned = new Set(powers.map((p) => p.entityId));
  for (const c of classes) {
    const clsDef = lookupEntity(`classes:${c.name}`);
    for (const p of (clsDef?.type === "class" ? clsDef.innate : []) || []) {
      if (c.level >= (p.requiredLevel || 1) && !owned.has(p.name)) {
        owned.add(p.name);
        powers.push({ entityId: p.name, source: Source.innate(), ranks: 1, costField: "innatePowers" });
      }
    }
  }

  const devotions = [...(character.devotions || [])];
  if (character.devotion && !devotions.some((d) => d.entityId === `devotions:${character.devotion}`)) {
    devotions.push({ entityId: `devotions:${character.devotion}`, source: Source.purchased() });
  }

  return { ...character, classes, powers, devotions };
}

export function resolveCharacterGraph(charInput: CharacterState): CharacterGraphModel {
  const character = normalizeCharacter(charInput);
  const items: GraphItem[] = [];
  const charLevel = characterLevel(character);
  const classes = getClasses(character);
  const addItem = (choice: CharacterChoice) => {
    // The ENTITY is choice.entityId (bare — "Lore", never "Lore (Historical)"): all
    // rules data (REFS grants/prereqs/discounts, cost) is keyed on the bare id, so we
    // look THAT up. The `parameter` FIELD is used only to (a) build the display name
    // and (b) distinguish instances for dedupe — never to resolve the entity.
    let ent = lookupEntity(choice.entityId);
    const rawName = choice.entityId.replace(/^[a-z]+:/i, "");
    const cleanName = cleanItemName(rawName);
    const bareName = bareSkill(cleanName);

    // Fallback if entityId wasn't fully qualified
    if (!ent) {
      ent =
        lookupEntity(`skills:${bareName}`) || lookupEntity(`perks:${cleanName}`) || lookupEntity(`powers:${cleanName}`);
    }

    // Display form = the entity's name + the chosen parameter (the FIELD). Derived
    // for the row's label / instance key; NOT an entity lookup key. Only a real
    // stored `choice.parameter` reconstructs the name — we must NOT re-append a param
    // scraped from the id string, or a name that merely contains " - " (e.g. a
    // lineage-qualified "Underkin - Iron Touch") would be mangled. `param` (used for
    // dedup) still falls back to extractParam for any legacy inline-param data.
    const baseDisplay = ent?.name || cleanName;
    const displayName =
      choice.parameter && !/\(/.test(baseDisplay) ? `${baseDisplay} (${choice.parameter})` : baseDisplay;
    const param = choice.parameter ?? extractParam(rawName);

    const rank = choice.ranks || 1;
    const effects: Effect[] = [];

    // Extract Base Cost
    let baseCost = 0;
    if (Array.isArray(ent?.tiers) && ent.tiers.length) {
      const n = Math.min(rank, ent.tiers.length);
      baseCost = ent.tiers.slice(0, n).reduce((s, t) => s + (t.cost || 0), 0);
    } else {
      baseCost = (typeof ent?.cost === "number" ? ent.cost : ent?.lbp || 0) * rank;
    }

    const entityId = ent?.id || choice.entityId;
    for (const extractor of EFFECT_EXTRACTORS) {
      effects.push(...extractor(ent, character, entityId));
    }

    // The node model's internal sourceType string, derived from the structured
    // source's `type`. `starting` maps to 'class' (a starting skill was the old
    // 'Class:Starting' string → sourceType 'class'); `granted` → 'grant'.
    const src: EntitySource = choice.source || Source.purchased();
    const SOURCE_TYPE: Record<EntitySource["type"], string> = {
      purchased: "purchased",
      class: "class",
      starting: "class",
      innate: "innate",
      granted: "grant",
      lineage: "lineage",
      flaw: "flaw",
    };
    const sourceType = SOURCE_TYPE[src.type] || "purchased";

    // Determine the field based on the entity prefix or fallback
    let field = choice.entityId.split(":")[0];
    if (["skills", "perks", "powers", "flaws"].indexOf(field) === -1) {
      if (ent?.id) field = ent.id.split(":")[0];
      else field = "unknown";
    }

    // Node id is the PARAMETER-PRESERVING instance key used for the BP ledger,
    // prereq issue ids, and dedupe — NOT ent.id (the param-stripped BASE), so it keys
    // off the display form (base + param) to keep two Lores distinct. Its prefix is
    // the ORIGINATING character field: flat-path buckets carry it as `choice.costField`
    // (e.g. 'classPowers'); native skills have none, so they key under their entity
    // collection ('skills'). Falls back to the entity id.
    const idPrefixName = choice.costField || (ent?.type ? idPrefix(ent) : null);
    const nodeId = idPrefixName ? `${idPrefixName}:${displayName}` : entityId;
    items.push({
      id: nodeId,
      entityId: entityId,
      name: displayName,
      rawString: displayName,
      param,
      field,
      sourceType,
      cls: sourceClass(src),
      rank: choice.ranks || 1,
      index: choice.originalIndex,
      baseCost: baseCost,
      authoredCost: choice.costOverride,
      entity: ent,
      effects,
      specialty: null,
      floor: 0,
      choiceData: choice,
    });
  };
  let purchasedSkillIdx = 0;
  let startingSkillIdx = 0;
  for (const choice of character.skills || []) {
    if (isPurchased(choice.source)) {
      addItem({ ...choice, originalIndex: choice.originalIndex ?? purchasedSkillIdx++ });
    } else if (isStarting(choice.source)) {
      addItem({ ...choice, originalIndex: startingSkillIdx++ });
    } else {
      addItem(choice);
    }
  }

  for (const choice of character.perks || []) addItem(choice);
  const powerIdxByField: Record<string, number> = {};
  const addPurchasablePower = (choice: CharacterChoice) => {
    if (isPurchased(choice.source) && choice.costField) {
      const idx = powerIdxByField[choice.costField] || 0;
      powerIdxByField[choice.costField] = idx + 1;
      addItem({ ...choice, originalIndex: idx });
    } else {
      addItem(choice);
    }
  };
  for (const choice of character.powers || []) addPurchasablePower(choice);
  for (const choice of character.domainPowers || []) addPurchasablePower(choice);
  for (const choice of character.spells || []) addItem(choice);
  for (const choice of character.devotions || []) addItem(choice);
  for (const field of ["lineageAdvantages", "lineageChallenges"] as const) {
    for (const name of character[field] || []) {
      const type = field === "lineageAdvantages" ? "advantages" : "challenges";
      let entityId = `${type}:${name}`;
      if (name === "Pick and Choose" && character.advantageChoices?.["Pick and Choose"]) {
        entityId = `advantages:${character.advantageChoices["Pick and Choose"]}`;
      }
      const choice = { entityId, ranks: 1, source: Source.lineage() };
      addItem(choice);
    }
  }

  for (const choice of character.flaws || []) {
    const rawName = choice.entityId.replace(/^flaws:/i, "");
    const cleanName = cleanItemName(rawName);
    const ent = lookupEntity(`flaws:${cleanName}`);
    // Param is the FIELD (fallback to any inline "(value)" in legacy data). The award
    // for a parameterized flaw (Mild Allergy → substance) is keyed on the chosen value.
    const param = choice.parameter ?? extractParam(rawName);
    let bp = 0;
    if (ent) {
      const allergenBase = ent.baseName || ent.name;
      const allergenTable = allergenBase ? ALLERGEN_AWARDS[allergenBase] : undefined;
      if (allergenTable) {
        const chosen = allergenAward(allergenBase, param);
        bp = chosen != null ? chosen : Math.min(...Object.values(allergenTable));
      } else {
        bp = typeof ent.bp === "number" ? ent.bp : parseInt(String(ent.bp), 10) || 0;
      }
    }
    items.push({
      id: ent?.id || `flaws:${cleanName}`,
      name: param && ent?.name && !/\(/.test(ent.name) ? `${ent.name} (${param})` : ent?.name || cleanName,
      rawString: param && ent?.name ? `${ent.name} (${param})` : choice.entityId,
      param,
      field: "flaws",
      sourceType: "flaw",
      index: character.flaws?.indexOf(choice),
      rank: 1,
      baseCost: -bp,
      entity: ent,
      effects: [{ type: "FLAW_AWARD", amount: bp }],
      choiceData: choice,
    });
  }

  const getIdentity = (rawName: string, ent: Entity | null | undefined, param?: string | null) => {
    const clean = cleanItemName(rawName);
    const entityId = ent?.id || rawName;
    const cap = getMaxRanks(entityId);
    const info = paramInfo(ent);
    const reusable = paramReusable(ent, entityId);
    const baseName = (ent?.baseName || ent?.name || bareSkill(clean)).toLowerCase();

    // Take-once entities (cap 1) have ONE identity regardless of parameter — the
    // param is flavor on the single instance, not a distinguisher. e.g. Weapon
    // Specialization (Swords) and (Axes) are the SAME identity, so a second one is
    // redundant (free BP). Without this, a parameterized cap-1 entity keyed by
    // base|param wrongly kept both. (Param distinguishes only when cap > 1.)
    if (cap <= 1) return { key: baseName, cap };

    // No param, or param is payload (reusable) → identity is the base; the cap
    // governs how many total takings are kept.
    if (!info || reusable) return { key: baseName, cap };

    // Parameterized, multi-rank, not reusable (Lore, …) → param distinguishes
    // distinct instances, each capped at one. Read the structured node.param,
    // falling back to the entity's param label only if absent.
    const paramValue = (param ?? ent?.parameter ?? "unknown").toLowerCase();
    return { key: `${baseName}|${paramValue}`, cap: 1 };
  };
  const itemIdentities = new Map<string, { cap: number; nodes: GraphItem[] }>();
  for (const it of items) {
    if (it.sourceType === "lineage") continue;
    const { key, cap } = getIdentity(it.rawString || it.name, it.entity, it.param);
    if (!itemIdentities.has(key)) itemIdentities.set(key, { cap, nodes: [] });
    itemIdentities.get(key)!.nodes.push(it);
  }

  for (const group of itemIdentities.values()) {
    const purchases = group.nodes.filter((n) => n.sourceType === "purchased");
    if (purchases.length > group.cap) {
      for (const surplus of purchases.slice(group.cap)) {
        surplus.effects = surplus.effects || [];
        surplus.effects.push({ type: "OVER_CAP", cap: group.cap });
      }
    }
  }

  for (const node of [...items]) {
    for (const eff of node.effects) {
      if (eff.type !== "GRANT_SOURCE") continue;
      for (const gid of eff.grants) {
        let ent = lookupEntity(gid);
        const gType = gid.slice(0, gid.indexOf(":"));
        const rawGidName = gid.slice(gid.indexOf(":") + 1);
        if (!ent) {
          const clean = cleanItemName(rawGidName);
          ent = lookupEntity(`skills:${clean}`) || lookupEntity(`powers:${clean}`) || lookupEntity(`perks:${clean}`);
        }

        const gName = ent?.name || rawGidName;
        const { key, cap } = getIdentity(gName, ent, extractParam(rawGidName));

        let group = itemIdentities.get(key);
        if (!group) {
          group = { cap, nodes: [] };
          itemIdentities.set(key, group);
        }

        // Check if we are at cap with grants + purchases
        const grantCount = group.nodes.filter((n) => n.sourceType === "grant").length;
        const purchaseCount = group.nodes.filter((n) => n.sourceType === "purchased").length;

        if (grantCount + purchaseCount >= cap) {
          // We are at cap. Grant wins, so refund a purchase if one exists
          const purchasedNode = group.nodes.find(
            (n) => n.sourceType === "purchased" && !n.effects?.some((e) => e.type === "REFUND_GRANT"),
          );
          if (purchasedNode) {
            purchasedNode.effects = purchasedNode.effects || [];
            purchasedNode.effects.push({ type: "REFUND_GRANT", source: node.name });
          }
          // At cap: the grant is redundant and is dropped (not added as a node).
          // This is correct for cost — a grant's baseCost is 0, so "free BP equal to
          // its cost" is 0; there's no BP to recover. If a PURCHASE shared the key it
          // was refunded above (grant wins, purchase becomes free). With no purchase
          // (e.g. two classes granting the same skill) the duplicate simply collapses
          // to the single kept node.
          continue;
        }

        const newGrant: GraphItem = {
          id: ent?.id || gid,
          name: gName,
          rawString: gName,
          param: extractParam(gName),
          field: `${gType}Grant`,
          sourceType: "grant",
          grantedBy: node.name,
          grantKind: node.sourceType,
          cls: node.cls ?? node.entity?.parentClass ?? null,
          rank: 1,
          baseCost: 0,
          entity: ent,
          effects: [],
          specialty: null,
          floor: 0,
          index: -1,
        };
        items.push(newGrant);
        group.nodes.push(newGrant);
      }
    }
  }

  const hasTaxEvasion = items.some((i) => i.name === "Tax Evasion");
  if (hasTaxEvasion) {
    const profRanks = items.filter((i) => /^\bProfession\b/i.test(i.name)).length;
    let bonus = profRanks * 3;
    if (items.some((i) => i.name === "Manse")) bonus += 2;
    if (items.some((i) => i.name === "Income")) bonus += 2;
    if (bonus > 0) {
      items.push({
        id: "synthetic:Tax Evasion Wealth",
        name: "Tax Evasion Bonus",
        rawString: "Tax Evasion Bonus",
        field: "synthetic",
        sourceType: "synthetic",
        rank: 1,
        baseCost: 0,
        effects: [{ type: "WEALTH", amount: bonus, note: "from Profession/Manse/Income" }],
      });
    }
  }

  const grants = startingSkillGrants(character);
  let startingNodeIdx = 0;
  for (const node of items) {
    if (node.field === "skills" && node.sourceType === "class") {
      if (grants.specialty[startingNodeIdx] != null) node.specialty = grants.specialty[startingNodeIdx];
      if (grants.floor[startingNodeIdx] != null) node.floor = grants.floor[startingNodeIdx];
      startingNodeIdx++;
    }
  }

  return new CharacterGraphModel(character, items, charLevel, classes);
}
