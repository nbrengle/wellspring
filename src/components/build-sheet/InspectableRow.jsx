// The ONE row primitive for every inspectable item in the build sheet (skills,
// perks, flaws, powers, lineage advantages, recipes, …). It owns the whole pattern
// that used to be hand-wired at each list site:
//   • the row chrome + focus highlight (keyed off the current inline `view`)
//   • the name button → opens the item's detail INLINE (click again to close)
//   • the inline detail rendered underneath (reusing EntityBody)
//
// A list site just provides the item's identity + its trailing content:
//
//   <InspectableRow item={name} field={field} resolveType="powers" index={i}>
//     {badges}{costBadge}{removeButton}
//   </InspectableRow>
//
// So "make this list expand inline" is automatic — no site picks inline-vs-chase,
// re-implements isFocused, or injects an InlineDetail. Chasing concept links from
// within the detail body still routes to the drawer (handled by EntityBody's
// onInspect = onChase, wired once in InlineDetail).
import { useBuilderState, useBuilderActions } from "../builder-context.jsx";
import InlineDetail from "./InlineDetail.jsx";

export default function InspectableRow({
  item,
  field,
  resolveType,
  index = null,
  slot = null,
  // Optional label override (defaults to `item`); e.g. a name with a ×rank suffix.
  label,
  // Extra class on the <li> (e.g. "b-lin-adv-row" / "b-slot-row").
  className = "",
  // The trailing row content — badges, cost, rank steppers, remove button, etc.
  children,
}) {
  const { view } = useBuilderState();
  const { onInspect } = useBuilderActions();
  const isFocused = view?.mode === "inspect" && view.item === item && view.field === field;

  return (
    <>
      <li className={`b-row ${className} ${isFocused ? "is-focused" : ""}`}>
        <button className="b-row-name" onClick={() => onInspect(item, field, resolveType, slot, index)}>
          {label ?? item}
        </button>
        {children}
      </li>
      <InlineDetail item={item} field={field} />
    </>
  );
}
