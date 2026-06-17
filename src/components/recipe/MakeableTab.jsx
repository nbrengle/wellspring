// "What Can I Make?" tab: discipline/tier filters + Fully-Craftable and
// Close-to-Craftable recipe card grids.
import React from "react";
import { DISCIPLINE_LABELS } from "./shared.jsx";

export default function MakeableTab({
  filteredRecipes, filterDiscipline, setFilterDiscipline, filterTier, setFilterTier,
  hideUncraftable, setHideUncraftable, inspectedRecipeName, onInspect,
}) {
  return (
    <div className="b-recipe-scrollable-content">
      {/* Filters */}
      <div className="b-recipe-filters">
        <div className="b-filter-group">
          <label>Discipline</label>
          <select value={filterDiscipline} onChange={(e) => setFilterDiscipline(e.target.value)} className="b-parameter-input">
            <option value="all">All Crafts</option>
            {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="b-filter-group">
          <label>Tier</label>
          <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)} className="b-parameter-input">
            <option value="all">All Tiers</option>
            <option value="apprentice">Apprentice</option>
            <option value="journeyman">Journeyman</option>
            <option value="master">Master</option>
          </select>
        </div>

        <label className="b-filter-checkbox">
          <input type="checkbox" checked={hideUncraftable} onChange={(e) => setHideUncraftable(e.target.checked)} />
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
                onClick={() => onInspect(recipe.name)}
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
                  onClick={() => onInspect(recipe.name)}
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
  );
}
