import { lookupEntity } from "../../engine/data.js";

export const CLASS_TONES = {
  Artisan: "amber",
  Cleric: "amber-deep",
  Druid: "green",
  Fighter: "red",
  Mage: "blue",
  Rogue: "teal",
  Socialite: "purple",
  Sourcerer: "indigo",
};

export function spellTierKey(c) {
  if (!c) return null;
  if (c.tierList)
    return (
      { noviceSpells: "novice", adeptSpells: "adept", greaterSpells: "greater", cantrips: "cantrip" }[c.tierList] ||
      null
    );
  const t = (c.tier || "").toLowerCase();
  return ["novice", "adept", "greater", "cantrip"].includes(t) ? t : null;
}

export function spellTierLabel(c) {
  const k = spellTierKey(c);
  return k ? k[0].toUpperCase() + k.slice(1) : null;
}

export function sourceType(name) {
  const clean = String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  for (const t of ["powers", "perks", "skills"]) {
    if (lookupEntity(`${t}:${clean}`)) return t;
  }
  return null;
}

export function statSources(stats, key) {
  return (stats?.mods?.sources || [])
    .filter((s) => s.stat === key)
    .map((s) => ({ name: s.name, amount: s.amount, type: sourceType(s.name) }));
}

export function statTitle(stats, key, label) {
  const srcs = (stats?.mods?.sources || []).filter((s) => s.stat === key);
  if (!srcs.length) return label;
  const baseKey = key === "lifePoints" ? "baseLifePoints" : key === "spikes" ? "baseSpikes" : null;
  const base = baseKey != null ? stats[baseKey] : 0;
  const parts = srcs.map((s) => `+${s.amount} ${s.name}`);
  return `${label}: ${base ? `${base} base ` : ""}${parts.join(", ")}`;
}

export function bestowSourceRole(bestow) {
  if (!bestow?.source) return null;
  if (bestow.sourceRole) {
    return bestow.sourceRole.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const ent =
    lookupEntity(`powers:${bestow.source}`) ||
    lookupEntity(`skills:${bestow.source}`) ||
    lookupEntity(`perks:${bestow.source}`);
  if (!ent) return null;
  if (ent.type === "power") return `${ent.tier || ""} Power`.trim();
  if (ent.type === "spell") return `${ent.tier || ""} Spell`.trim();
  if (ent.type === "skill") return "Skill";
  if (ent.type === "perk") return "Perk";
  return null;
}
