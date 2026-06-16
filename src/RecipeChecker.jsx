import React, { useState, useMemo } from "react";
import resourcesJson from "./data/resources.json";
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

const STANDARD_RESOURCES = [
  ...resourcesJson.map(r => normalizeResourceName(r.name)),
  "Wealth"
];

const DISCIPLINE_LABELS = {
  "Alchemy": "Alchemy",
  "Tinkering": "Tinkering",
  "Enchanting": "Enchanting",
  "Blacksmithing": "Blacksmithing",
  "Ritual Magic": "Ritual Magic"
};

// A small badge marking an ingredient as a raw material (🌿 gathered) or a
// craftable intermediate (🔨 made from a recipe). For craftable ingredients the
// badge is a button that jumps to that recipe's detail.
function IngredientKind({ name, onJump }) {
  const c = classifyIngredient(name);
  if (c.kind === 'crafted') {
    return (
      <button
        type="button"
        className="b-ing-kind is-crafted"
        title={`Craftable — made via the "${c.recipe.name}" recipe. Click to view.`}
        onClick={(e) => { e.stopPropagation(); onJump && onJump(c.recipe.name); }}
      >
        🔨 Craftable
      </button>
    );
  }
  return <span className="b-ing-kind is-raw" title="Raw material — must be gathered">🌿 Raw</span>;
}

// Recursively render a buildCraftTree node as an indented tree. Each node shows its
// quantity, a raw/crafted/have marker, and (for crafted nodes) expands its children
// down to raw leaves — so the whole dependency stack is visible at a glance.
function CraftTreeNode({ node, onJump, depth }) {
  const icon = node.kind === 'have' ? '📦' : node.kind === 'crafted' ? '🔨' : '🌿';
  const cls = node.kind === 'have' ? 'is-have' : node.kind === 'crafted' ? 'is-crafted' : 'is-raw';
  const craftable = node.kind === 'crafted';
  return (
    <div className="b-craft-tree-node" style={{ marginLeft: depth ? 18 : 0 }}>
      <div className={`b-craft-tree-row ${cls}`}>
        <span className="b-craft-tree-icon">{icon}</span>
        <span className="b-craft-tree-qty">{node.qty}×</span>
        {craftable ? (
          <button type="button" className="b-craft-tree-name is-link"
                  title={`Craftable via "${node.recipe.name}"${node.batches ? ` — ${node.batches} batch${node.batches === 1 ? '' : 'es'}` : ''}. Click to view.`}
                  onClick={() => onJump && onJump(node.recipe.name)}>
            {node.name}
          </button>
        ) : (
          <span className="b-craft-tree-name">{node.name}</span>
        )}
        <span className="b-craft-tree-tag">
          {node.kind === 'have' ? 'in inventory'
            : node.kind === 'crafted' ? `craft${node.have > 0 ? ` (${node.have} on hand)` : ''}`
            : `gather${node.have > 0 ? ` (${node.have} on hand, need ${node.need})` : ''}`}
        </span>
      </div>
      {node.children && node.children.length > 0 && (
        <div className="b-craft-tree-children">
          {node.children.map((child, i) => (
            <CraftTreeNode key={`${child.name}-${i}`} node={child} onJump={onJump} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

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

  // Add a CRAFTED recipe output to inventory as a possessed intermediate. Keyed by
  // the recipe's canonical name so solveCrafting credits it (and higher recipes that
  // need it light up). One click adds a full batch yield.
  const handleAddCrafted = (recipeName) => {
    const recipe = RECIPES.get(recipeName);
    if (!recipe) return;
    const add = recipe.yield && recipe.yield !== 9999 ? recipe.yield : 1;
    setInventory(prev => ({ ...prev, [recipe.name]: (prev[recipe.name] || 0) + add }));
  };

  // Split inventory into RAW resources (standard + custom non-recipe items) and
  // CRAFTED intermediates (keys that match a recipe), so the UI groups them. Within
  // raw, standard resources sort first.
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
    const tree = buildCraftTree(recipe.name, 1, inventory);

    return {
      recipe,
      success: solverResult.success,
      steps: solverResult.steps || [],
      deficit: deficitResult,
      tree
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

  // One inventory row. `kind`: 'raw' (standard, no delete) | 'custom' (deletable) |
  // 'crafted' (deletable intermediate, distinct styling).
  const renderInvItem = (name, kind) => {
    const qty = inventory[name] || 0;
    const deletable = kind !== "raw";
    return (
      <div key={name} className={`b-inventory-item ${qty > 0 ? "is-owned" : ""} ${kind === "crafted" ? "is-crafted" : kind === "custom" ? "is-custom" : ""}`}>
        <div className="b-inv-info">
          <span className="b-inv-name">{name}</span>
          {deletable && (
            <button className="b-inv-delete" onClick={() => handleDeleteCustomItem(name)} title="Remove from inventory">✕</button>
          )}
        </div>
        <div className="b-inv-control">
          <button className="b-inv-btn" onClick={() => handleQtyChange(name, -1)} disabled={qty === 0}>-</button>
          <input type="number" min="0" className="b-inv-input" value={qty} onChange={(e) => handleQtySet(name, e.target.value)} />
          <button className="b-inv-btn" onClick={() => handleQtyChange(name, 1)}>+</button>
        </div>
      </div>
    );
  };

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
            <p className="b-inv-group-label">🌿 Raw Materials <span className="b-inv-group-hint">(gathered)</span></p>
            {inventoryGroups.raw.map(name => {
              const isStd = STANDARD_RESOURCES.includes(name);
              return renderInvItem(name, isStd ? "raw" : "custom");
            })}

            {inventoryGroups.crafted.length > 0 && (
              <>
                <p className="b-inv-group-label">🔨 Crafted / Intermediate <span className="b-inv-group-hint">(made from recipes)</span></p>
                {inventoryGroups.crafted.map(name => renderInvItem(name, "crafted"))}
              </>
            )}
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

                    {/* Nested dependency tree: the full stack from the target down to
                        raw leaves, each node marked raw vs crafted, have vs needed. */}
                    <div className="b-calc-section">
                      <h4 className="b-recipe-section-title">Crafting Tree</h4>
                      <p className="b-tree-legend">
                        <span className="b-ing-kind is-raw">🌿 Raw</span> gather ·
                        <span className="b-ing-kind is-crafted"> 🔨 Craftable</span> make from a recipe ·
                        <span className="b-tree-have-tag"> 📦 In inventory</span>
                      </p>
                      <CraftTreeNode node={targetCalculation.tree} onJump={setInspectedRecipeName} depth={0} />
                    </div>

                    {/* Missing-ingredient summary for the closest alternative. */}
                    {!targetCalculation.success && (
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
                                  <td>{item.name} <IngredientKind name={item.name} onJump={setInspectedRecipeName} /></td>
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
              <div className="b-recipe-detail-titlerow">
                <h3 className="b-recipe-detail-name">{inspectedRecipe.name}</h3>
                <button
                  className="b-recipe-add-inv-btn"
                  onClick={() => handleAddCrafted(inspectedRecipe.name)}
                  title={`Add ${inspectedRecipe.yield === 9999 ? 1 : inspectedRecipe.yield} ${inspectedRecipe.name} to your inventory as a crafted intermediate`}
                >
                  + Add to inventory
                </button>
              </div>
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
                {(inspectedRecipe.requirements?.[0]) && (
                  <ul className="b-ingredient-badges">
                    {inspectedRecipe.requirements.length > 1 && (
                      <li className="b-ingredient-alt-note">(showing the first of {inspectedRecipe.requirements.length} alternatives)</li>
                    )}
                    {Object.entries(inspectedRecipe.requirements[0]).map(([ing, qty]) => (
                      <li key={ing} className="b-ingredient-row">
                        <span className="b-ingredient-qty">{qty}×</span>
                        <span className="b-ingredient-name">{ing}</span>
                        <IngredientKind name={ing} onJump={setInspectedRecipeName} />
                      </li>
                    ))}
                  </ul>
                )}
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
