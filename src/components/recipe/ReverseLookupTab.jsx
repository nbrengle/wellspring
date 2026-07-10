// "Reverse Lookup" tab: pick an ingredient/resource, list every recipe that uses it.
import { REVERSE_LOOKUP } from "../../engine/recipe-solver.js";
import { STANDARD_RESOURCES } from "./shared.jsx";

export default function ReverseLookupTab({
  selectedReverseResource,
  setSelectedReverseResource,
  reverseLookupRecipes,
  inspectedRecipeName,
  onInspect,
}) {
  return (
    <div className="b-recipe-scrollable-content">
      <div className="b-recipe-search-bar">
        <label>Select Ingredient or Component</label>
        <select
          className="b-parameter-input b-calc-select"
          value={selectedReverseResource}
          onChange={(e) => setSelectedReverseResource(e.target.value)}
        >
          <optgroup label="Standard Resources">
            {STANDARD_RESOURCES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </optgroup>
          <optgroup label="All Ingredients">
            {Array.from(REVERSE_LOOKUP.keys())
              .filter((r) => !STANDARD_RESOURCES.includes(r))
              .sort()
              .map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
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
            {reverseLookupRecipes.map((recipe) => (
              <button
                key={recipe.name}
                className={`b-recipe-summary-card ${inspectedRecipeName === recipe.name ? "is-selected" : ""}`}
                onClick={() => onInspect(recipe.name)}
              >
                <span className="b-recipe-card-header">
                  <span className="b-recipe-card-name">{recipe.name}</span>
                  <span className="b-recipe-card-badge">
                    {recipe.discipline} • {recipe.tier}
                  </span>
                </span>
                <span className="b-recipe-card-materials">Cost: {recipe.materialsStr}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
