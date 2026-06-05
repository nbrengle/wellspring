import React, { useState, useMemo } from "react";
import { 
  RECIPES, 
  REVERSE_LOOKUP, 
  solveCrafting, 
  getRecipeDeficit, 
  normalizeResourceName 
} from "./data/recipe-solver.js";
import "./RecipeChecker.css";

const STANDARD_RESOURCES = [
  "Bloom", "Hide", "Ingot", "Night Prize", "Harvest", "Rare Mineral", 
  "Golden Blossom", "Raw Scale", "Mithril Bar", "Enchanted Hyperium", "Wealth"
];

const DISCIPLINE_LABELS = {
  "Alchemy": "Alchemy",
  "Tinkering": "Tinkering",
  "Enchanting": "Enchanting",
  "Blacksmithing": "Blacksmithing",
  "Ritual Magic": "Ritual Magic"
};

export default function RecipeChecker({ onClose }) {
  // Inventory: maps name to quantity
  const [inventory, setInventory] = useState(() => {
    const initial = {};
    STANDARD_RESOURCES.forEach(r => {
      initial[r] = 0;
    });
    return initial;
  });

  // Custom resource input state
  const [customItemInput, setCustomItemInput] = useState("");
  
  // Navigation: "makeable" | "calculator" | "reverse"
  const [subTab, setSubTab] = useState("makeable");
  
  // Discipline & Tier filters for "What can I make"
  const [filterDiscipline, setFilterDiscipline] = useState("all");
  const [filterTier, setFilterTier] = useState("all");
  const [hideUncraftable, setHideUncraftable] = useState(false);

  // Calculator selected recipe
  const [selectedCalcRecipe, setSelectedCalcRecipe] = useState("");
  
  // Reverse lookup selected resource
  const [selectedReverseResource, setSelectedReverseResource] = useState("Bloom");

  // Selected recipe details (right drawer)
  const [inspectedRecipeName, setInspectedRecipeName] = useState("");

  const inspectedRecipe = useMemo(() => {
    if (!inspectedRecipeName) return null;
    return RECIPES.get(inspectedRecipeName);
  }, [inspectedRecipeName]);

  // Handle quantity change
  const handleQtyChange = (name, delta) => {
    setInventory(prev => {
      const current = prev[name] || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [name]: next };
    });
  };

  const handleQtySet = (name, value) => {
    const val = Math.max(0, parseInt(value, 10) || 0);
    setInventory(prev => ({ ...prev, [name]: val }));
  };

  // Add custom item to inventory list
  const handleAddCustomItem = (e) => {
    e.preventDefault();
    const clean = normalizeResourceName(customItemInput);
    if (!clean) return;
    setInventory(prev => {
      if (prev[clean] !== undefined) return prev; // Already exists
      return { ...prev, [clean]: 0 };
    });
    setCustomItemInput("");
  };

  // Delete custom resource from inventory list
  const handleDeleteCustomItem = (name) => {
    setInventory(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  // Get active inventory resources list (ignoring zero-count standard ones, but keeping standard keys visible)
  const inventoryKeys = useMemo(() => {
    return Object.keys(inventory).sort((a, b) => {
      const aStd = STANDARD_RESOURCES.includes(a);
      const bStd = STANDARD_RESOURCES.includes(b);
      if (aStd && !bStd) return -1;
      if (!aStd && bStd) return 1;
      return a.localeCompare(b);
    });
  }, [inventory]);

  // Solve all recipes to see what can be crafted
  const solvedRecipes = useMemo(() => {
    const craftable = [];
    const close = [];
    const others = [];

    for (const recipe of RECIPES.values()) {
      const result = solveCrafting(recipe.name, 1, inventory);
      if (result.success) {
        craftable.push({ recipe, steps: result.steps });
      } else {
        // Calculate missing ingredients
        const deficit = getRecipeDeficit(recipe, inventory);
        if (deficit.missingCount <= 2) {
          close.push({ recipe, deficit });
        } else {
          others.push({ recipe, deficit });
        }
      }
    }

    return { craftable, close, others };
  }, [inventory]);

  // Filtered lists for "What can I make?" tab
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

  // Target crafting calculator calculation
  const targetCalculation = useMemo(() => {
    if (!selectedCalcRecipe) return null;
    const recipe = RECIPES.get(selectedCalcRecipe);
    if (!recipe) return null;

    const solverResult = solveCrafting(recipe.name, 1, inventory);
    const deficitResult = getRecipeDeficit(recipe, inventory);

    return {
      recipe,
      success: solverResult.success,
      steps: solverResult.steps || [],
      deficit: deficitResult
    };
  }, [selectedCalcRecipe, inventory]);

  // Reverse lookup results
  const reverseLookupRecipes = useMemo(() => {
    const norm = normalizeResourceName(selectedReverseResource);
    return REVERSE_LOOKUP.get(norm) || [];
  }, [selectedReverseResource]);

  // Autocomplete choices for calculator search input
  const recipeSearchList = useMemo(() => {
    return Array.from(RECIPES.keys()).sort();
  }, []);

  return (
    <div className="b-explorer b-recipes">
      {/* Top Header */}
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
        {/* LEFT PANEL: Inventory Manager */}
        <div className="b-recipes-inventory">
          <h3 className="b-sidebar-title">Resource Inventory</h3>
          <div className="b-inventory-list">
            {inventoryKeys.map(name => {
              const qty = inventory[name] || 0;
              const isStd = STANDARD_RESOURCES.includes(name);
              return (
                <div key={name} className={`b-inventory-item ${qty > 0 ? "is-owned" : ""} ${!isStd ? "is-custom" : ""}`}>
                  <div className="b-inv-info">
                    <span className="b-inv-name">{name}</span>
                    {!isStd && (
                      <button 
                        className="b-inv-delete"
                        onClick={() => handleDeleteCustomItem(name)}
                        title="Remove custom resource"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="b-inv-control">
                    <button 
                      className="b-inv-btn"
                      onClick={() => handleQtyChange(name, -1)}
                      disabled={qty === 0}
                    >
                      -
                    </button>
                    <input 
                      type="number"
                      min="0"
                      className="b-inv-input"
                      value={qty}
                      onChange={(e) => handleQtySet(name, e.target.value)}
                    />
                    <button 
                      className="b-inv-btn"
                      onClick={() => handleQtyChange(name, 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <form className="b-inventory-custom-form" onSubmit={handleAddCustomItem}>
            <input 
              type="text" 
              className="b-parameter-input"
              placeholder="Add custom item/component..."
              value={customItemInput}
              onChange={(e) => setCustomItemInput(e.target.value)}
            />
            <button type="submit" className="b-combobox-toggle b-custom-add-btn">
              +
            </button>
          </form>
        </div>

        {/* CENTER PANEL: Main workspace tabs */}
        <div className="b-recipes-workspace">
          {/* Main workspace tabs selector */}
          <div className="b-recipe-tabs">
            <button 
              className={`b-recipe-tab ${subTab === "makeable" ? "is-active" : ""}`}
              onClick={() => setSubTab("makeable")}
            >
              What Can I Make?
            </button>
            <button 
              className={`b-recipe-tab ${subTab === "calculator" ? "is-active" : ""}`}
              onClick={() => setSubTab("calculator")}
            >
              Target Calculator
            </button>
            <button 
              className={`b-recipe-tab ${subTab === "reverse" ? "is-active" : ""}`}
              onClick={() => setSubTab("reverse")}
            >
              Reverse Lookup
            </button>
          </div>

          <div className="b-recipe-tab-content">
            {/* TAB 1: What can I make? */}
            {subTab === "makeable" && (
              <div className="b-recipe-scrollable-content">
                {/* Filters */}
                <div className="b-recipe-filters">
                  <div className="b-filter-group">
                    <label>Discipline</label>
                    <select 
                      value={filterDiscipline} 
                      onChange={(e) => setFilterDiscipline(e.target.value)}
                      className="b-parameter-input"
                    >
                      <option value="all">All Crafts</option>
                      {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>

                  <div className="b-filter-group">
                    <label>Tier</label>
                    <select 
                      value={filterTier} 
                      onChange={(e) => setFilterTier(e.target.value)}
                      className="b-parameter-input"
                    >
                      <option value="all">All Tiers</option>
                      <option value="apprentice">Apprentice</option>
                      <option value="journeyman">Journeyman</option>
                      <option value="master">Master</option>
                    </select>
                  </div>

                  <label className="b-filter-checkbox">
                    <input 
                      type="checkbox" 
                      checked={hideUncraftable}
                      onChange={(e) => setHideUncraftable(e.target.checked)}
                    />
                    Hide close/uncraftable
                  </label>
                </div>

                {/* Section: Craftable Recipes */}
                <div className="b-recipe-section">
                  <h4 className="b-recipe-section-title">Fully Craftable ({filteredRecipes.craftable.length})</h4>
                  {filteredRecipes.craftable.length === 0 ? (
                    <p className="b-recipe-empty-msg">No craftable recipes match your current inventory and filters.</p>
                  ) : (
                    <div className="b-recipe-cards-grid">
                      {filteredRecipes.craftable.map(({ recipe }) => (
                        <button 
                          key={recipe.name} 
                          className={`b-recipe-summary-card is-craftable ${inspectedRecipeName === recipe.name ? "is-selected" : ""}`}
                          onClick={() => setInspectedRecipeName(recipe.name)}
                        >
                          <span className="b-recipe-card-header">
                            <span className="b-recipe-card-name">{recipe.name}</span>
                            <span className="b-recipe-card-badge">{recipe.discipline} • {recipe.tier}</span>
                          </span>
                          <span className="b-recipe-card-materials">Cost: {recipe.materialsStr}</span>
                          <span className="b-recipe-card-action">Click to inspect</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section: Close to Craftable */}
                {!hideUncraftable && (
                  <div className="b-recipe-section">
                    <h4 className="b-recipe-section-title">Close to Craftable (Missing ≤ 2 Items) ({filteredRecipes.close.length})</h4>
                    {filteredRecipes.close.length === 0 ? (
                      <p className="b-recipe-empty-msg">No near-craftable recipes match.</p>
                    ) : (
                      <div className="b-recipe-cards-grid">
                        {filteredRecipes.close.map(({ recipe, deficit }) => (
                          <button 
                            key={recipe.name} 
                            className={`b-recipe-summary-card is-close ${inspectedRecipeName === recipe.name ? "is-selected" : ""}`}
                            onClick={() => setInspectedRecipeName(recipe.name)}
                          >
                            <span className="b-recipe-card-header">
                              <span className="b-recipe-card-name">{recipe.name}</span>
                              <span className="b-recipe-card-badge">{recipe.discipline} • {recipe.tier}</span>
                            </span>
                            <span className="b-recipe-card-deficit-alert">
                              Missing: {deficit.items.filter(i => i.missing > 0).map(i => `${i.missing} ${i.name}`).join(", ")}
                            </span>
                            <span className="b-recipe-card-materials">Cost: {recipe.materialsStr}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Deficit Target Calculator */}
            {subTab === "calculator" && (
              <div className="b-recipe-scrollable-content">
                <div className="b-recipe-search-bar">
                  <label>Select Target Item to Craft</label>
                  <select
                    value={selectedCalcRecipe}
                    onChange={(e) => setSelectedCalcRecipe(e.target.value)}
                    className="b-parameter-input b-calc-select"
                  >
                    <option value="">-- Choose target recipe --</option>
                    {recipeSearchList.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {targetCalculation ? (
                  <div className="b-calc-results">
                    {/* Status Banner */}
                    {targetCalculation.success ? (
                      <div className="b-calc-banner is-success">
                        <span className="b-banner-icon">✅</span>
                        <div className="b-banner-text">
                          <h5>Fully Craftable!</h5>
                          <p>You have all required resources (and intermediate crafting requirements) to make this item.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="b-calc-banner is-danger">
                        <span className="b-banner-icon">❌</span>
                        <div className="b-banner-text">
                          <h5>Missing Resources</h5>
                          <p>You need to gather or craft additional resources before making this item.</p>
                        </div>
                      </div>
                    )}

                    {/* Step-by-Step Crafting Tree */}
                    <div className="b-calc-section">
                      <h4 className="b-recipe-section-title">Ingredients Breakdown & Process</h4>
                      
                      {targetCalculation.success ? (
                        <div className="b-calc-tree">
                          <p className="b-tree-header">Follow these steps in order:</p>
                          <ol className="b-tree-list">
                            {targetCalculation.steps.map((step, idx) => {
                              if (step.source === 'inventory') {
                                return (
                                  <li key={idx} className="b-tree-step is-inv">
                                    Take <strong>{step.qty} {step.item}</strong> from your inventory.
                                  </li>
                                );
                              }
                              return (
                                <li key={idx} className="b-tree-step is-craft">
                                  Use the <strong>{step.discipline} ({step.tier})</strong> craft to build <strong>{step.qty} {step.item}</strong> ({step.batches} batch{step.batches === 1 ? "" : "es"}).
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      ) : (
                        <div className="b-calc-deficit-list">
                          <p className="b-tree-header">Missing ingredients for the closest recipe alternative:</p>
                          <table className="b-deficit-table">
                            <thead>
                              <tr>
                                <th>Ingredient</th>
                                <th>Required</th>
                                <th>Available</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {targetCalculation.deficit.items.map(item => (
                                <tr key={item.name} className={item.missing > 0 ? "row-missing" : "row-ok"}>
                                  <td>{item.name}</td>
                                  <td>{item.required}</td>
                                  <td>{item.available}</td>
                                  <td>
                                    {item.missing > 0 ? (
                                      <span className="badge-missing">Missing {item.missing}</span>
                                    ) : (
                                      <span className="badge-ok">Available</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    
                    {/* Select for right drawer view */}
                    <button 
                      className="b-calc-inspect-btn"
                      onClick={() => setInspectedRecipeName(targetCalculation.recipe.name)}
                    >
                      View Recipe Process & Description →
                    </button>
                  </div>
                ) : (
                  <p className="b-recipe-empty-msg">Select a recipe from the dropdown above to calculate the crafting sequence and deficit tree.</p>
                )}
              </div>
            )}

            {/* TAB 3: Reverse Lookup */}
            {subTab === "reverse" && (
              <div className="b-recipe-scrollable-content">
                <div className="b-recipe-search-bar">
                  <label>Select Ingredient or Component</label>
                  <select
                    className="b-parameter-input b-calc-select"
                    value={selectedReverseResource}
                    onChange={(e) => setSelectedReverseResource(e.target.value)}
                  >
                    <optgroup label="Standard Resources">
                      {STANDARD_RESOURCES.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </optgroup>
                    <optgroup label="All Ingredients">
                      {Array.from(REVERSE_LOOKUP.keys())
                        .filter(r => !STANDARD_RESOURCES.includes(r))
                        .sort()
                        .map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                    </optgroup>
                  </select>
                </div>

                <div className="b-calc-section">
                  <h4 className="b-recipe-section-title">
                    Recipes that require "{selectedReverseResource}" ({reverseLookupRecipes.length})
                  </h4>

                  {reverseLookupRecipes.length === 0 ? (
                    <p className="b-recipe-empty-msg">
                      No recipes list "{selectedReverseResource}" as an ingredient. Make sure you typed the name exactly.
                    </p>
                  ) : (
                    <div className="b-recipe-cards-grid">
                      {reverseLookupRecipes.map(recipe => (
                        <button 
                          key={recipe.name} 
                          className={`b-recipe-summary-card ${inspectedRecipeName === recipe.name ? "is-selected" : ""}`}
                          onClick={() => setInspectedRecipeName(recipe.name)}
                        >
                          <span className="b-recipe-card-header">
                            <span className="b-recipe-card-name">{recipe.name}</span>
                            <span className="b-recipe-card-badge">{recipe.discipline} • {recipe.tier}</span>
                          </span>
                          <span className="b-recipe-card-materials">Cost: {recipe.materialsStr}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Inspected Recipe Reading Pane */}
        <div className="b-recipes-reader">
          {inspectedRecipe ? (
            <div className="b-recipe-detail-pane">
              <h3 className="b-recipe-detail-name">{inspectedRecipe.name}</h3>
              <div className="b-recipe-detail-facts">
                <div className="b-fact-row">
                  <span className="b-fact-label">Type</span>
                  <span className="b-fact-value">{inspectedRecipe.type === 'crafting' ? 'Crafting Recipe' : 'Ritual'}</span>
                </div>
                <div className="b-fact-row">
                  <span className="b-fact-label">Craft/Discipline</span>
                  <span className="b-fact-value">{inspectedRecipe.discipline}</span>
                </div>
                <div className="b-fact-row">
                  <span className="b-fact-label">Required Skill Tier</span>
                  <span className="b-fact-value">{inspectedRecipe.tier}</span>
                </div>
                <div className="b-fact-row">
                  <span className="b-fact-label">Yield per Batch</span>
                  <span className="b-fact-value">
                    {inspectedRecipe.yield === 9999 ? 'Unlimited' : inspectedRecipe.yield}
                  </span>
                </div>
              </div>

              <div className="b-recipe-detail-section">
                <h4 className="b-recipe-detail-section-title">Ingredients List</h4>
                <p className="b-recipe-detail-materials">{inspectedRecipe.materialsStr}</p>
              </div>

              {inspectedRecipe.raw.description && (
                <div className="b-recipe-detail-section">
                  <h4 className="b-recipe-detail-section-title">Description</h4>
                  <p className="b-recipe-detail-description">{inspectedRecipe.raw.description}</p>
                </div>
              )}

              {inspectedRecipe.raw.effect && (
                <div className="b-recipe-detail-section">
                  <h4 className="b-recipe-detail-section-title">Effect</h4>
                  <p className="b-recipe-detail-effect">{inspectedRecipe.raw.effect}</p>
                </div>
              )}

              {inspectedRecipe.raw.process && (
                <div className="b-recipe-detail-section">
                  <h4 className="b-recipe-detail-section-title">Crafting Process</h4>
                  <p className="b-recipe-detail-process">{inspectedRecipe.raw.process}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="b-recipe-reader-empty">
              <span className="b-empty-icon">📜</span>
              <p>Select a recipe card from the workspace to read its full description, crafting process, and item effects.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
