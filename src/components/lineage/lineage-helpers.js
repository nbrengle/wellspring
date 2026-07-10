// View helpers for the lineage panel. Pure presentation glue — no rules logic
// (that lives in the engine selectors: lineageChoiceSpec / lineageItemImpact /
// lineageRepOptions / cantripOptions).
import { subKey } from "../../engine/validate.js";

// Sublineage labels in the data fold a name and a parenthetical context together,
// e.g. "Accented (Any Accent Except for Void/Divine)" or "Technarchist (Civilization:
// The Unified Technarchy)". Split them so the UI can show a clean name + a subtitle.
// Also tolerates the stray "General." entry in the data.
export function parseSublineage(s) {
  const label = typeof s === "string" ? s : s?.name || "";
  const m = label.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
  const name = (m ? m[1] : label).replace(/\.$/, "").trim();
  const context = m ? m[2].trim() : "";
  return { label, name, context };
}

// Is a challenge/advantage scoped to a given sublineage (by normalized key)?
export function inSublineage(item, subLabel) {
  const k = subKey(item.sublineage);
  return subKey(subLabel) === k;
}

// Is an item "General" (available regardless of sublineage)?
export function isGeneral(item) {
  const k = subKey(item.sublineage);
  return !k || k === "general";
}

// The challenges + advantages UNIQUE to a sublineage (excludes General) — used to
// surface "what makes a <sublineage> different" the moment one is selected.
export function distinctiveFor(lin, subLabel) {
  const pick = (list) => (list || []).filter((it) => inSublineage(it, subLabel));
  return { challenges: pick(lin.challenges), advantages: pick(lin.advantages) };
}

// A short "what's distinctive" blurb for a lineage card: its sublineage names.
export function lineageTagline(lin) {
  const subs = (lin.sublineages || []).map((s) => parseSublineage(s).name).filter(Boolean);
  return subs.length ? subs.join(" · ") : "";
}

// Two kinds of sublineage: a CIVILIZATION origin (the note begins "Civilization:" —
// playable only if your character is from there) vs. a mechanical TYPE (Intervened,
// Psionic, …) that simply unlocks its options. The UI separates them.
export function isCivSublineage(s) {
  const ctx = parseSublineage(s).context || "";
  const raw = typeof s === "string" ? s : s?.note || s?.name || "";
  return /civilization:/i.test(ctx) || /civilization:/i.test(raw);
}

// The required challenges that apply RIGHT NOW for a lineage + chosen sublineage.
// General requireds always apply; a sublineage-scoped required only applies once
// that sublineage is selected (mirrors the validator's missingRequired rule, so
// auto-adding can't add something the validator wouldn't demand). Returns base names.
export function requiredChallengeNames(lin, sublineage) {
  const picked = subKey(sublineage);
  return (lin?.challenges || [])
    .filter((c) => {
      if (!c.required) return false;
      const k = subKey(c.sublineage);
      if (k && k !== "general") return k === picked; // scoped: only when its sub is chosen
      return true; // general required
    })
    .map((c) => c.baseName || c.name);
}

// Live status of a lineage's costuming requirement (parsed into lin.costume:
// { difficulty, minRepped, mustInclude, mustIncludeIf, text }). Counts the taken
// [Repped] challenges against the minimum, plus any specific challenge that must be
// included. A conditional must-include (Aewen: "if Accented, must include Elemental
// Expression") only applies when that sublineage is the picked one. Returns null if
// the lineage has no structured requirement. `takenReppedNames` is the list of
// currently-taken [Repped] challenge names; `pickedSubName` is the chosen sublineage.
export function costumeStatus(lin, takenReppedNames, pickedSubName) {
  const req = lin?.costume;
  if (!req || typeof req !== "object") return null;
  const have = takenReppedNames || [];
  // The must-include applies unconditionally, or only when its sublineage is picked.
  const mustApplies = !!req.mustInclude && (!req.mustIncludeIf || subKey(req.mustIncludeIf) === subKey(pickedSubName));
  const haveMust = !mustApplies || have.includes(req.mustInclude);
  const met = have.length >= (req.minRepped || 0) && haveMust;
  const parts = [];
  if (req.minRepped > 0) parts.push(`${have.length}/${req.minRepped} [Repped]`);
  if (mustApplies) parts.push(`${haveMust ? "✓" : "needs"} ${req.mustInclude}`);
  return { req, met, mustApplies, label: parts.join(" · ") || "no [Repped] needed" };
}
