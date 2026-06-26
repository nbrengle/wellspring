// Shared bits for the Recipe Explorer's panels: the raw/crafted ingredient badge,
// the recursive craft-tree node, and the resource/discipline constants. Extracted
// from RecipeChecker.jsx so the inventory panel, the three tabs, and the detail
// drawer can each be their own component.
import resourcesJson from "../../data/resources.json";
import { classifyIngredient, normalizeResourceName } from "../../engine/recipe-solver.js";

export const STANDARD_RESOURCES = [
  ...resourcesJson.map(r => normalizeResourceName(r.name)),
  "Wealth"
];

export const DISCIPLINE_LABELS = {
  "Alchemy": "Alchemy",
  "Tinkering": "Tinkering",
  "Enchanting": "Enchanting",
  "Blacksmithing": "Blacksmithing",
  "Ritual Magic": "Ritual Magic"
};

// A small badge marking an ingredient as a raw material (🌿 gathered) or a
// craftable intermediate (🔨 made from a recipe). For craftable ingredients the
// badge is a button that jumps to that recipe's detail.
export function IngredientKind({ name, onJump }) {
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
export function CraftTreeNode({ node, onJump, depth }) {
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
