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
