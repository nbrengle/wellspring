// "Target Calculator" tab: pick a target recipe, see craftable/missing status, the
// full nested crafting tree, and a deficit table for the closest alternative.
import { CraftTreeNode, IngredientKind } from "./shared.jsx";

export default function CalculatorTab({
  recipeSearchList,
  selectedCalcRecipe,
  setSelectedCalcRecipe,
  targetCalculation,
  onInspect,
}) {
  return (
    <div className="b-recipe-scrollable-content">
      <div className="b-recipe-search-bar">
        <label>Select Target Item to Craft</label>
        <select
          value={selectedCalcRecipe}
          onChange={(e) => setSelectedCalcRecipe(e.target.value)}
          className="b-parameter-input b-calc-select"
        >
          <option value="">-- Choose target recipe --</option>
          {recipeSearchList.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
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

          {/* Nested dependency tree: the full stack from the target down to raw
              leaves, each node marked raw vs crafted, have vs needed. */}
          <div className="b-calc-section">
            <h4 className="b-recipe-section-title">Crafting Tree</h4>
            <p className="b-tree-legend">
              <span className="b-ing-kind is-raw">🌿 Raw</span> gather ·
              <span className="b-ing-kind is-crafted"> 🔨 Craftable</span> make from a recipe ·
              <span className="b-tree-have-tag"> 📦 In inventory</span>
            </p>
            <CraftTreeNode node={targetCalculation.tree} onJump={onInspect} depth={0} />
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
                  {targetCalculation.deficit.items.map((item) => (
                    <tr key={item.name} className={item.missing > 0 ? "row-missing" : "row-ok"}>
                      <td>
                        {item.name} <IngredientKind name={item.name} onJump={onInspect} />
                      </td>
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
          <button className="b-calc-inspect-btn" onClick={() => onInspect(targetCalculation.recipe.name)}>
            View Recipe Process & Description →
          </button>
        </div>
      ) : (
        <p className="b-recipe-empty-msg">
          Select a recipe from the dropdown above to calculate the crafting sequence and deficit tree.
        </p>
      )}
    </div>
  );
}
