import { CRAFTING, RITUALS } from "./data.js";

// ─── Crafting-solver shapes ─────────────────────────────────────────────────
/** An inventory: resource name → quantity on hand. */
type Inventory = Record<string, number>;
/** One step of a crafting plan: craft `qty` of `item` (in `batches`), or consume it
 *  from inventory (`source: 'inventory'`). */
interface CraftStep {
  item: string;
  qty: number;
  batches?: number;
  source: string;
  discipline?: string;
  tier?: string;
}
/** The result of solving a craft: either success (with the resulting inventory + the
 *  ordered steps) or failure. A discriminated union on `success`. */
type CraftResult = { success: true; inventory: Inventory; steps: CraftStep[] } | { success: false };
/** A missing-ingredient report row for buildCraftTree's shortfall list. */
interface Shortfall {
  name: string;
  required: number;
  available: number;
  missing: number;
}
/** A node in the craft dependency tree: what's needed, how much is on hand vs still
 *  needed, and (for a crafted node) the recipe + its child ingredient trees. */
interface CraftTree {
  name: string;
  qty: number;
  kind: "have" | "raw" | "crafted";
  have: number;
  need: number;
  children: CraftTree[];
  recipe?: unknown;
  batches?: number;
}

// Helper to normalize resource names
export function normalizeResourceName(name: string) {
  name = name.trim().replace(/\s+/g, " ");
  // Strip parentheticals
  name = name.replace(/\([^)]*\)/g, "").trim();
  // Strip annotations like "Optional:", "per Participant", "and Six Basic Resources", etc.
  name = name.replace(/^(Optional:)\s*/i, "");
  name = name.replace(/\s+per\s+.*$/i, "");
  name = name.replace(/\s+worth\s+.*$/i, "");
  // Strip volume units that aren't part of the resource name
  name = name.replace(/^(?:bags?\s+of|blocks?\s+of)\s+/i, "");

  // Plurals to singular
  if (name.toLowerCase() === "blooms") name = "Bloom";
  if (name.toLowerCase() === "hides") name = "Hide";
  if (name.toLowerCase() === "ingots") name = "Ingot";
  if (name.toLowerCase() === "night prizes") name = "Night Prize";
  if (name.toLowerCase() === "rare minerals") name = "Rare Mineral";
  if (name.toLowerCase() === "ritual powders") name = "Ritual Powder";
  if (name.toLowerCase() === "ritual wands") name = "Ritual Wand";
  if (name.toLowerCase() === "life points") name = "Life Point";
  if (name.toLowerCase() === "wealth") name = "Wealth";
  if (name.toLowerCase() === "motes of power") name = "Mote of Power";

  // Normalize casing for known resources
  const lower = name.toLowerCase();
  if (lower === "bloom") return "Bloom";
  if (lower === "hide") return "Hide";
  if (lower === "ingot") return "Ingot";
  if (lower === "night prize") return "Night Prize";
  if (lower === "harvest") return "Harvest";
  if (lower === "rare mineral") return "Rare Mineral";
  if (lower === "golden blossom") return "Golden Blossom";
  if (lower === "raw scale") return "Raw Scale";
  if (lower === "mithril bar") return "Mithril Bar";
  if (lower === "enchanted hyperium") return "Enchanted Hyperium";
  if (lower === "life point") return "Life Point";
  if (lower === "wealth") return "Wealth";
  if (lower === "ritual powder") return "Ritual Powder";
  if (lower === "ritual wand") return "Ritual Wand";
  if (lower === "mote of power") return "Mote of Power";

  return name;
}

// Parse a single simple component (e.g. "3 Night Prizes", "1+ Ritual Powder")
export function parseSingleComponent(part: string) {
  part = part.trim();
  if (!part) return null;
  const match = part.match(/^(\d+|\+?\[[a-zA-Z]\]|\d+\+)\s*(.*)$/);
  if (match) {
    const qtyStr = match[1].replace("+", "");
    let qty = parseInt(qtyStr, 10);
    if (isNaN(qty)) qty = 1;
    const name = normalizeResourceName(match[2]);
    if (!name) return null;
    return { name, qty };
  }
  const name = normalizeResourceName(part);
  if (!name) return null;
  return { name, qty: 1 };
}

// Parse a materials/components string into an array of alternative requirement sets
export function parseRequirements(str: string) {
  if (!str) return [];
  str = str.trim();

  // 1. Bracketed or-groups: e.g. "[3 Bloom, 1 Harvest] or [6 Bloom, 2 Harvest]"
  if (str.includes("[") && str.toLowerCase().includes("or")) {
    const bracketMatches = [...str.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    if (bracketMatches.length > 0) {
      return bracketMatches.map((groupStr) => {
        const reqs: Record<string, number> = {};
        groupStr.split(/,(?![^(]*\))/).forEach((p: string) => {
          const parsed = parseSingleComponent(p);
          if (parsed) reqs[parsed.name] = (reqs[parsed.name] || 0) + parsed.qty;
        });
        return reqs;
      });
    }
  }

  const lowerStr = str.toLowerCase();

  // 2. Clear lists of single-item alternatives:
  // e.g. "1 Bloom, 1 Night Prize, or 1 Harvest" or "1 Ingot or 1 Hide"
  if (lowerStr.includes(" or ") && !lowerStr.includes(" and ")) {
    const parts = str
      .split(/(?:,(?![^(]*\))|\s+or\s+|\s+OR\s+)+/i)
      .map((p: string) => p.trim())
      .filter(Boolean);
    const parsedParts = parts.map((p: string) => parseSingleComponent(p)).filter(Boolean);
    if (parsedParts.length === parts.length) {
      return parsedParts.map((p: { name: string; qty: number } | null) => (p ? { [p.name]: p.qty } : {}));
    }
  }

  // 3. Comma-separated list with bracketed or choices at the end:
  // e.g. "10 Hide, 10 Ingots, ... and [1 Essence - Any OR 1 Last Breath]"
  const bracketOrMatch = str.match(/^(.*?)\s*(?:,?\s*and\s*)?\[([^\]]+)\]\s*$/i);
  if (bracketOrMatch) {
    const baseStr = bracketOrMatch[1];
    const choicesStr = bracketOrMatch[2];
    const baseReqs: Record<string, number> = {};
    baseStr.split(/,(?![^(]*\))/).forEach((p: string) => {
      const parsed = parseSingleComponent(p);
      if (parsed) baseReqs[parsed.name] = (baseReqs[parsed.name] || 0) + parsed.qty;
    });

    // Parse choices
    const choices = choicesStr
      .split(/\s+or\s+/i)
      .map((c: string) => parseSingleComponent(c))
      .filter(Boolean);
    if (choices.length > 0) {
      return choices.map((c: { name: string; qty: number } | null) => {
        if (!c) return baseReqs;
        return {
          ...baseReqs,
          [c.name]: (baseReqs[c.name] || 0) + c.qty,
        };
      });
    }
  }

  // 4. Default simple split
  const parts = str.split(/,(?![^(]*\))/);
  const reqs: Record<string, number> = {};
  parts.forEach((p: string) => {
    const parsed = parseSingleComponent(p);
    if (parsed) reqs[parsed.name] = (reqs[parsed.name] || 0) + parsed.qty;
  });
  return [reqs];
}

// Parse batch yield from text
function parseYield(recipe: { usesPerBatch?: string | number; yield?: string | number }) {
  const str = String(recipe.usesPerBatch || recipe.yield || "1")
    .toLowerCase()
    .trim();
  if (str.includes("unlimited")) return 9999;
  const match = str.match(/^(\d+)/);
  if (match) return parseInt(match[1], 10);
  return 1;
}

// Initialize recipe index
export const RECIPES = new Map();

for (const r of CRAFTING || []) {
  RECIPES.set(r.name, {
    name: r.name,
    type: "crafting",
    discipline: r.discipline,
    tier: r.tier,
    yield: parseYield(r),
    materialsStr: r.materials,
    requirements: parseRequirements(r.materials),
    raw: r,
  });
}

for (const r of RITUALS || []) {
  RECIPES.set(r.name, {
    name: r.name,
    type: "ritual",
    discipline: "Ritual Magic",
    tier: r.tier,
    yield: 1,
    materialsStr: r.components,
    requirements: parseRequirements(r.components),
    raw: r,
  });
}

// Resolve an ingredient/target NAME to its recipe, if any. Match order:
//   1. exact (case-insensitive) — "Essence Infusion"
//   2. parameterized — strip a trailing " - <variant>" and retry, so an ingredient
//      reference like "Essence Infusion - Energy" resolves to the "Essence Infusion"
//      recipe. (The data also contains fused artifacts like "Essence Infusion -
//      Thought 5 Hide"; the leading-recipe match still works and we don't crash.)
// Returns the recipe object from RECIPES, or null when the name is a raw resource.
export function resolveRecipe(name: string) {
  if (!name) return null;
  const want = name.trim().toLowerCase();
  let key = Array.from(RECIPES.keys()).find((k) => k.toLowerCase() === want);
  if (key) return RECIPES.get(key);
  // Parameterized form: take the segment before the first " - " / " – " dash.
  const base = name
    .split(/\s+[-–]\s+/)[0]
    .trim()
    .toLowerCase();
  if (base && base !== want) {
    key = Array.from(RECIPES.keys()).find((k) => k.toLowerCase() === base);
    if (key) return RECIPES.get(key);
  }
  return null;
}

// Classify an ingredient as a raw resource (gathered) or a crafted intermediate
// (made from a recipe). `recipe` is the resolved recipe for crafted ingredients.
export function classifyIngredient(name: string) {
  const recipe = resolveRecipe(name);
  return recipe
    ? { kind: "crafted", recipe, canonical: recipe.name }
    : { kind: "raw", recipe: null, canonical: normalizeResourceName(name) };
}

// Build list of reverse lookups (which recipes use each resource as an ingredient)
export const REVERSE_LOOKUP = new Map();
for (const recipe of RECIPES.values()) {
  const seenIngredients = new Set();
  for (const reqSet of recipe.requirements) {
    for (const ingName of Object.keys(reqSet)) {
      seenIngredients.add(ingName);
    }
  }
  for (const ingName of seenIngredients) {
    if (!REVERSE_LOOKUP.has(ingName)) {
      REVERSE_LOOKUP.set(ingName, []);
    }
    REVERSE_LOOKUP.get(ingName).push(recipe);
  }
}

// Recursive solver to check if we can craft target item
export function solveCrafting(
  targetName: string,
  targetQty: number,
  inventory: Inventory,
  path: string[] = [],
): CraftResult {
  const currentInv = { ...inventory };
  const targetLower = targetName.toLowerCase();

  // Find matching key in inventory (case insensitive)
  const invKey = Object.keys(currentInv).find((k) => k.toLowerCase() === targetLower);
  const available = invKey ? currentInv[invKey] : 0;

  if (available >= targetQty) {
    if (invKey) currentInv[invKey] -= targetQty;
    return {
      success: true,
      inventory: currentInv,
      steps: [{ item: targetName, qty: targetQty, source: "inventory" }],
    };
  }

  // We need to craft the remaining quantity
  const needed = targetQty - available;

  // Find recipe for target (exact OR a parameterized "- variant" form, so an
  // ingredient like "Essence Infusion - Energy" recurses into its recipe).
  const recipe = resolveRecipe(targetName);

  if (!recipe || path.includes(recipe.name)) {
    return { success: false };
  }

  // Deduct whatever was available from inventory first
  if (invKey && available > 0) {
    currentInv[invKey] = 0;
  }

  // We need Math.ceil(needed / yield) batches
  const batchYield = recipe.yield;
  const batches = batchYield === 9999 ? 1 : Math.ceil(needed / batchYield);

  // Try each alternative requirement set
  for (const reqSet of recipe.requirements) {
    let success = true;
    let tempInv = { ...currentInv };
    const subSteps: CraftStep[] = [];

    for (const [reqName, reqQty] of Object.entries(reqSet as Record<string, number>)) {
      const totalReqQty = reqQty * batches;
      const subResult = solveCrafting(reqName, totalReqQty, tempInv, [...path, recipe.name]);
      if (subResult.success) {
        tempInv = subResult.inventory;
        subSteps.push(...subResult.steps);
      } else {
        success = false;
        break;
      }
    }

    if (success) {
      // Crafting succeeded! Add leftover yield to inventory
      const totalCreated = batchYield === 9999 ? needed : batches * batchYield;
      const leftover = totalCreated - needed;
      if (leftover > 0) {
        tempInv[recipe.name] = (tempInv[recipe.name] || 0) + leftover;
      }

      return {
        success: true,
        inventory: tempInv,
        steps: [
          ...subSteps,
          {
            item: recipe.name,
            qty: needed,
            batches,
            source: "crafting",
            discipline: recipe.discipline,
            tier: recipe.tier,
          },
        ],
      };
    }
  }

  return { success: false };
}

// Build a NESTED dependency tree for a target, for visualization. Unlike
// solveCrafting (which returns a flat, ordered build list), this preserves the
// stack shape: a crafted node's `children` are the ingredients of its first
// requirement set, recursing down to raw leaves.
//
// Each node: { name, qty, kind, recipe?, batches?, have, need, children: [] }
//   kind: 'have'    — fully covered by inventory (no crafting needed)
//         'raw'     — a raw resource that must be gathered (shortfall in `need`)
//         'crafted' — an intermediate that must be crafted (children expanded)
// `inventory` is consumed greedily as the tree is walked so a resource shared by
// two branches isn't double-counted. Cycles are guarded via `path`.
export function buildCraftTree(
  name: string,
  qty: number,
  inventory: Inventory,
  path: string[] = [],
  inv: Inventory | null = null,
): CraftTree {
  const stock = inv || { ...inventory };
  const invKey = Object.keys(stock).find((k) => k.toLowerCase() === name.toLowerCase());
  const available = invKey ? stock[invKey] : 0;
  const fromStock = Math.min(available, qty);
  if (invKey && fromStock > 0) stock[invKey] -= fromStock;
  const need = qty - fromStock;

  // Fully covered by inventory.
  if (need <= 0) {
    return { name, qty, kind: "have", have: qty, need: 0, children: [] };
  }

  const recipe = resolveRecipe(name);
  if (!recipe || path.includes(recipe.name)) {
    // Raw resource (or an unresolvable / cyclic recipe): a leaf shortfall.
    return { name, qty, kind: "raw", have: fromStock, need, children: [] };
  }

  const batchYield = recipe.yield === 9999 ? need : recipe.yield;
  const batches = recipe.yield === 9999 ? 1 : Math.ceil(need / batchYield);
  const reqSet = recipe.requirements[0] || {};
  const children = Object.entries(reqSet as Record<string, number>).map(([reqName, reqQty]) =>
    buildCraftTree(reqName, reqQty * batches, stock, [...path, recipe.name], stock),
  );
  return {
    name,
    qty,
    kind: "crafted",
    recipe,
    batches,
    have: fromStock,
    need,
    children,
  };
}

// Calculate details for a target recipe that cannot be made
// (Shows exactly what materials are missing and how much is available/needed)
export function getRecipeDeficit(recipe: { requirements: Record<string, number>[] }, inventory: Inventory) {
  let closestDeficit: Shortfall[] | null = null;
  let minMissingCount = Infinity;

  for (const reqSet of recipe.requirements) {
    const deficitItems: Shortfall[] = [];
    let missingCount = 0;

    for (const [name, reqQty] of Object.entries(reqSet as Record<string, number>)) {
      const targetLower = name.toLowerCase();
      // Look up availability in inventory, or see if it can be crafted
      const invKey = Object.keys(inventory).find((k) => k.toLowerCase() === targetLower);
      const available = invKey ? inventory[invKey] : 0;

      if (available < reqQty) {
        const missing = reqQty - available;
        missingCount += missing;
        deficitItems.push({
          name,
          required: reqQty,
          available,
          missing,
        });
      } else {
        deficitItems.push({
          name,
          required: reqQty,
          available,
          missing: 0,
        });
      }
    }

    if (missingCount < minMissingCount) {
      minMissingCount = missingCount;
      closestDeficit = deficitItems;
    }
  }

  return {
    missingCount: minMissingCount,
    items: closestDeficit || [],
  };
}
