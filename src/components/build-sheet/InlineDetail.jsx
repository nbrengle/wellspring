// R1 inline detail: when you click an owned-item row, its detail unfolds in place
// right under the row (instead of a side pane). Reuses the existing EntityBody so
// descriptions, parameter editors, and power detail all work unchanged. Height-capped
// with its own scroll so a long entity never shoves the rest of the list around.
//
// Concept links inside the body call onChase → that promotes into the right DRAWER
// (with a back-stack) for multi-step exploration. So inline = the primary glance;
// the drawer = chasing a chain of linked concepts.
import { EntityBody, useResolvedEntity } from "../DetailPane.jsx";
import { useBuilderState, useBuilderActions } from "../builder-context.jsx";

// Render the inline detail for the row identified by (item, field) IFF the current
// inline view targets it. Returns null otherwise — callers can drop it after any row.
export default function InlineDetail({ item, field }) {
  const { character, report, view } = useBuilderState();
  const { onChase, onSetChoice, onOpenChoicePicker, onUpdateParameter } = useBuilderActions();

  const isInlineHere = view?.mode === "inspect" && view.item === item && view.field === field;

  const entity = useResolvedEntity(isInlineHere ? view.item : null, view?.field, view?.resolveType);
  if (!isInlineHere) return null;

  return (
    <li className="b-inline-detail">
      <div className="b-inline-detail-head">
        <span className="b-inline-detail-name">{entity?.name || view.item}</span>
        <span className="b-inline-detail-type">{entity?.type || view.resolveType}</span>
      </div>
      <div className="b-inline-detail-body">
        <EntityBody
          entity={entity}
          view={view}
          report={report}
          choices={character.choices}
          onSetChoice={onSetChoice}
          onOpenChoicePicker={onOpenChoicePicker}
          onUpdateParameter={onUpdateParameter}
          onInspect={onChase}
        />
      </div>
    </li>
  );
}
