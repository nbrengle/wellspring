// Right panel: the inspected recipe's reading pane — facts, ingredient list (with
// raw/crafted badges), description/effect/process, and "add to inventory".
import { IngredientKind } from "./shared.jsx";

export default function RecipeDetail({ recipe, onInspect, onAddCrafted }) {
  if (!recipe) {
    return (
      <div className="b-recipe-reader-empty">
        <span className="b-empty-icon">📜</span>
        <p>Select a recipe card from the workspace to read its full description, crafting process, and item effects.</p>
      </div>
    );
  }
  return (
    <div className="b-recipe-detail-pane">
      <div className="b-recipe-detail-titlerow">
        <h3 className="b-recipe-detail-name">{recipe.name}</h3>
        <button
          className="b-recipe-add-inv-btn"
          onClick={() => onAddCrafted(recipe.name)}
          title={`Add ${recipe.yield === 9999 ? 1 : recipe.yield} ${recipe.name} to your inventory as a crafted intermediate`}
        >
          + Add to inventory
        </button>
      </div>
      <div className="b-recipe-detail-facts">
        <div className="b-fact-row">
          <span className="b-fact-label">Type</span>
          <span className="b-fact-value">{recipe.type === "crafting" ? "Crafting Recipe" : "Ritual"}</span>
        </div>
        <div className="b-fact-row">
          <span className="b-fact-label">Craft/Discipline</span>
          <span className="b-fact-value">{recipe.discipline}</span>
        </div>
        <div className="b-fact-row">
          <span className="b-fact-label">Required Skill Tier</span>
          <span className="b-fact-value">{recipe.tier}</span>
        </div>
        <div className="b-fact-row">
          <span className="b-fact-label">Yield per Batch</span>
          <span className="b-fact-value">{recipe.yield === 9999 ? "Unlimited" : recipe.yield}</span>
        </div>
      </div>

      <div className="b-recipe-detail-section">
        <h4 className="b-recipe-detail-section-title">Ingredients List</h4>
        <p className="b-recipe-detail-materials">{recipe.materialsStr}</p>
        {recipe.requirements?.[0] && (
          <ul className="b-ingredient-badges">
            {recipe.requirements.length > 1 && (
              <li className="b-ingredient-alt-note">
                (showing the first of {recipe.requirements.length} alternatives)
              </li>
            )}
            {Object.entries(recipe.requirements[0]).map(([ing, qty]) => (
              <li key={ing} className="b-ingredient-row">
                <span className="b-ingredient-qty">{qty}×</span>
                <span className="b-ingredient-name">{ing}</span>
                <IngredientKind name={ing} onJump={onInspect} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {recipe.raw.description && (
        <div className="b-recipe-detail-section">
          <h4 className="b-recipe-detail-section-title">Description</h4>
          <p className="b-recipe-detail-description">{recipe.raw.description}</p>
        </div>
      )}

      {recipe.raw.effect && (
        <div className="b-recipe-detail-section">
          <h4 className="b-recipe-detail-section-title">Effect</h4>
          <p className="b-recipe-detail-effect">{recipe.raw.effect}</p>
        </div>
      )}

      {recipe.raw.process && (
        <div className="b-recipe-detail-section">
          <h4 className="b-recipe-detail-section-title">Crafting Process</h4>
          <p className="b-recipe-detail-process">{recipe.raw.process}</p>
        </div>
      )}
    </div>
  );
}
