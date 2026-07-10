import { createContext, useContext } from "react";

// Two contexts so the builder's components stop prop-drilling. Split on purpose:
//
//   BuilderState   — character / report / view / isFocused. Changes on nearly every
//                    keystroke; only components that DISPLAY state subscribe to it.
//   BuilderActions — the handler bundle (onSetName, onOpenAdd, …). Stable across
//                    renders, so action-only components don't re-render when state
//                    changes. Kept SEPARATE from state for exactly that reason.
//
// Builder.jsx owns the values and wraps the tree in <BuilderProvider>; descendants
// pull what they need via useBuilderState() / useBuilderActions() instead of
// receiving a dozen props threaded through two or three intermediate components.

const BuilderStateContext = createContext(null);
const BuilderActionsContext = createContext(null);

export function BuilderProvider({ state, actions, children }) {
  return (
    <BuilderActionsContext.Provider value={actions}>
      <BuilderStateContext.Provider value={state}>{children}</BuilderStateContext.Provider>
    </BuilderActionsContext.Provider>
  );
}

export function useBuilderState() {
  const ctx = useContext(BuilderStateContext);
  if (ctx === null) throw new Error("useBuilderState must be used within <BuilderProvider>");
  return ctx;
}

export function useBuilderActions() {
  const ctx = useContext(BuilderActionsContext);
  if (ctx === null) throw new Error("useBuilderActions must be used within <BuilderProvider>");
  return ctx;
}
