// Left panel: the resource inventory — raw materials and crafted intermediates,
// each with qty steppers, plus a free-text "add custom item" form.
import { STANDARD_RESOURCES } from "./shared.jsx";

export default function InventoryPanel({
  inventory,
  inventoryGroups,
  customItemInput,
  setCustomItemInput,
  onQtyChange,
  onQtySet,
  onDeleteItem,
  onAddCustomItem,
}) {
  // One inventory row. `kind`: 'raw' (standard, no delete) | 'custom' (deletable) |
  // 'crafted' (deletable intermediate, distinct styling).
  const renderInvItem = (name, kind) => {
    const qty = inventory[name] || 0;
    const deletable = kind !== "raw";
    return (
      <div
        key={name}
        className={`b-inventory-item ${qty > 0 ? "is-owned" : ""} ${kind === "crafted" ? "is-crafted" : kind === "custom" ? "is-custom" : ""}`}
      >
        <div className="b-inv-info">
          <span className="b-inv-name">{name}</span>
          {deletable && (
            <button className="b-inv-delete" onClick={() => onDeleteItem(name)} title="Remove from inventory">
              ✕
            </button>
          )}
        </div>
        <div className="b-inv-control">
          <button className="b-inv-btn" onClick={() => onQtyChange(name, -1)} disabled={qty === 0}>
            -
          </button>
          <input
            type="number"
            min="0"
            className="b-inv-input"
            value={qty}
            onChange={(e) => onQtySet(name, e.target.value)}
          />
          <button className="b-inv-btn" onClick={() => onQtyChange(name, 1)}>
            +
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="b-recipes-inventory">
      <h3 className="b-sidebar-title">Resource Inventory</h3>
      <div className="b-inventory-list">
        <p className="b-inv-group-label">
          🌿 Raw Materials <span className="b-inv-group-hint">(gathered)</span>
        </p>
        {inventoryGroups.raw.map((name) => {
          const isStd = STANDARD_RESOURCES.includes(name);
          return renderInvItem(name, isStd ? "raw" : "custom");
        })}

        {inventoryGroups.crafted.length > 0 && (
          <>
            <p className="b-inv-group-label">
              🔨 Crafted / Intermediate <span className="b-inv-group-hint">(made from recipes)</span>
            </p>
            {inventoryGroups.crafted.map((name) => renderInvItem(name, "crafted"))}
          </>
        )}
      </div>

      <form className="b-inventory-custom-form" onSubmit={onAddCustomItem}>
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
  );
}
