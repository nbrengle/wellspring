import React, { useState, useMemo } from "react";
import {
  RECIPES,
  REVERSE_LOOKUP,
  solveCrafting,
  getRecipeDeficit,
  normalizeResourceName,
  classifyIngredient,
  buildCraftTree
} from "./engine/recipe-solver.js";
import "./RecipeChecker.css";
import { STANDARD_RESOURCES } from "./components/recipe/shared.jsx";
import InventoryPanel from "./components/recipe/InventoryPanel.jsx";
import MakeableTab from "./components/recipe/MakeableTab.jsx";
import CalculatorTab from "./components/recipe/CalculatorTab.jsx";
import ReverseLookupTab from "./components/recipe/ReverseLookupTab.jsx";
import RecipeDetail from "./components/recipe/RecipeDetail.jsx";

// Recipe Explorer & Calculator. This component owns the inventory + UI state and
// the derived memos (what's craftable, the target calc, reverse lookup); the
// 3-panel layout — inventory, the tabbed workspace, and the detail drawer — is
// composed from focused components in components/recipe/.
export default function RecipeChecker({ onClose }) {
  // Inventory: maps name to quantity
  const [inventory, setInventory] = useState(() => {
    const initial = {};
    STANDARD_RESOURCES.forEach(r => { initial[r] = 0; });
    return initial;
  });

  const [customItemInput, setCustomItemInput] = useState("");
  const [subTab, setSubTab] = useState("makeable"); // "makeable" | "calculator" | "reverse"

  // "What can I make?" filters
  const [filterDiscipline, setFilterDiscipline] = useState("all");
  const [filterTier, setFilterTier] = useState("all");
  const [hideUncraftable, setHideUncraftable] = useState(false);

  const [selectedCalcRecipe, setSelectedCalcRecipe] = useState("");
  const [selectedReverseResource, setSelectedReverseResource] = useState("Bloom");
  const [inspectedRecipeName, setInspectedRecipeName] = useState("");

  const inspectedRecipe = useMemo(() => {
    if (!inspectedRecipeName) return null;
    return RECIPES.get(inspectedRecipeName);
  }, [inspectedRecipeName]);

  // ─── INVENTORY HANDLERS ───────────────────────────────────────────────────
  const handleQtyChange = (name, delta) => {
    setInventory(prev => {
      const current = prev[name] || 0;
      return { ...prev, [name]: Math.max(0, current + delta) };
    });
  };

  const handleQtySet = (name, value) => {
    const val = Math.max(0, parseInt(value, 10) || 0);
    setInventory(prev => ({ ...prev, [name]: val }));
  };

  const handleAddCustomItem = (e) => {
    e.preventDefault();
    const clean = normalizeResourceName(customItemInput);
    if (!clean) return;
    setInventory(prev => (prev[clean] !== undefined ? prev : { ...prev, [clean]: 0 }));
    setCustomItemInput("");
  };

  const handleDeleteCustomItem = (name) => {
    setInventory(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  // Add a CRAFTED recipe output to inventory as a possessed intermediate. Keyed by
  // the recipe's canonical name so solveCrafting credits it (and higher recipes
  // that need it light up). One click adds a full batch yield.
  const handleAddCrafted = (recipeName) => {
    const recipe = RECIPES.get(recipeName);
    if (!recipe) return;
    const add = recipe.yield && recipe.yield !== 9999 ? recipe.yield : 1;
    setInventory(prev => ({ ...prev, [recipe.name]: (prev[recipe.name] || 0) + add }));
  };

  // ─── DERIVED ──────────────────────────────────────────────────────────────
  // Split inventory into RAW resources (standard + custom non-recipe items) and
  // CRAFTED intermediates (keys that match a recipe). Within raw, standard first.
  const inventoryGroups = useMemo(() => {
    const raw = [];
    const crafted = [];
    for (const name of Object.keys(inventory)) {
      (classifyIngredient(name).kind === 'crafted' ? crafted : raw).push(name);
    }
    raw.sort((a, b) => {
      const aStd = STANDARD_RESOURCES.includes(a);
      const bStd = STANDARD_RESOURCES.includes(b);
      if (aStd && !bStd) return -1;
      if (!aStd && bStd) return 1;
      return a.localeCompare(b);
    });
    crafted.sort((a, b) => a.localeCompare(b));
    return { raw, crafted };
  }, [inventory]);

  // Solve all recipes to bucket them by craftability.
  const solvedRecipes = useMemo(() => {
    const craftable = [];
    const close = [];
    const others = [];
    for (const recipe of RECIPES.values()) {
      const result = solveCrafting(recipe.name, 1, inventory);
      if (result.success) {
        craftable.push({ recipe, steps: result.steps });
      } else {
        const deficit = getRecipeDeficit(recipe, inventory);
        (deficit.missingCount <= 2 ? close : others).push({ recipe, deficit });
      }
    }
    return { craftable, close, others };
  }, [inventory]);

  const filteredRecipes = useMemo(() => {
    const matchesFilter = (recipe) => {
      const discMatch = filterDiscipline === "all" || recipe.discipline === filterDiscipline;
      const tierMatch = filterTier === "all" || recipe.tier.toLowerCase() === filterTier.toLowerCase();
      return discMatch && tierMatch;
    };
    return {
      craftable: solvedRecipes.craftable.filter(x => matchesFilter(x.recipe)),
      close: solvedRecipes.close.filter(x => matchesFilter(x.recipe)),
      others: solvedRecipes.others.filter(x => matchesFilter(x.recipe))
    };
  }, [solvedRecipes, filterDiscipline, filterTier]);

  const targetCalculation = useMemo(() => {
    if (!selectedCalcRecipe) return null;
    const recipe = RECIPES.get(selectedCalcRecipe);
    if (!recipe) return null;
    const solverResult = solveCrafting(recipe.name, 1, inventory);
    return {
      recipe,
      success: solverResult.success,
      steps: solverResult.steps || [],
      deficit: getRecipeDeficit(recipe, inventory),
      tree: buildCraftTree(recipe.name, 1, inventory)
    };
  }, [selectedCalcRecipe, inventory]);

  const reverseLookupRecipes = useMemo(() => {
    const norm = normalizeResourceName(selectedReverseResource);
    return REVERSE_LOOKUP.get(norm) || [];
  }, [selectedReverseResource]);

  const recipeSearchList = useMemo(() => Array.from(RECIPES.keys()).sort(), []);

  return (
    <div className="b-explorer b-recipes">
      <div className="b-explorer-header">
        <div className="b-explorer-header-left">
          <h2 className="b-explorer-title">Recipe Explorer & Calculator</h2>
          <p className="b-explorer-subtitle">Verify craftability, track missing components, and explore ingredient trees</p>
        </div>
        <button className="b-explorer-close-btn" onClick={onClose} aria-label="Return to character creator">
          ✕ Return
        </button>
      </div>

      <div className="b-explorer-layout">
        {/* LEFT: inventory */}
        <InventoryPanel
          inventory={inventory}
          inventoryGroups={inventoryGroups}
          customItemInput={customItemInput}
          setCustomItemInput={setCustomItemInput}
          onQtyChange={handleQtyChange}
          onQtySet={handleQtySet}
          onDeleteItem={handleDeleteCustomItem}
          onAddCustomItem={handleAddCustomItem}
        />

        {/* CENTER: tabbed workspace */}
        <div className="b-recipes-workspace">
          <div className="b-recipe-tabs">
            <button className={`b-recipe-tab ${subTab === "makeable" ? "is-active" : ""}`} onClick={() => setSubTab("makeable")}>
              What Can I Make?
            </button>
            <button className={`b-recipe-tab ${subTab === "calculator" ? "is-active" : ""}`} onClick={() => setSubTab("calculator")}>
              Target Calculator
            </button>
            <button className={`b-recipe-tab ${subTab === "reverse" ? "is-active" : ""}`} onClick={() => setSubTab("reverse")}>
              Reverse Lookup
            </button>
          </div>

          <div className="b-recipe-tab-content">
            {subTab === "makeable" && (
              <MakeableTab
                filteredRecipes={filteredRecipes}
                filterDiscipline={filterDiscipline} setFilterDiscipline={setFilterDiscipline}
                filterTier={filterTier} setFilterTier={setFilterTier}
                hideUncraftable={hideUncraftable} setHideUncraftable={setHideUncraftable}
                inspectedRecipeName={inspectedRecipeName} onInspect={setInspectedRecipeName}
              />
            )}
            {subTab === "calculator" && (
              <CalculatorTab
                recipeSearchList={recipeSearchList}
                selectedCalcRecipe={selectedCalcRecipe} setSelectedCalcRecipe={setSelectedCalcRecipe}
                targetCalculation={targetCalculation} onInspect={setInspectedRecipeName}
              />
            )}
            {subTab === "reverse" && (
              <ReverseLookupTab
                selectedReverseResource={selectedReverseResource} setSelectedReverseResource={setSelectedReverseResource}
                reverseLookupRecipes={reverseLookupRecipes}
                inspectedRecipeName={inspectedRecipeName} onInspect={setInspectedRecipeName}
              />
            )}
          </div>
        </div>

        {/* RIGHT: inspected recipe */}
        <div className="b-recipes-reader">
          <RecipeDetail recipe={inspectedRecipe} onInspect={setInspectedRecipeName} onAddCrafted={handleAddCrafted} />
        </div>
      </div>
    </div>
  );
}
