import { useEffect } from "react";

// Shared modal/overlay shell. Owns the parts every panel was hand-rolling
// (and occasionally getting subtly wrong): the backdrop, click-outside-to-close,
// Escape-to-close, the dialog ARIA role, and stopPropagation on the panel so an
// inner click doesn't bubble to the backdrop's onClose.
//
// Callers supply the panel's CONTENT (their own header/body); the shell handles
// the rest. `panelClassName` selects the panel skin (b-picker / b-export /
// b-picker b-picker-dock …); `overlayClassName` adds backdrop modifiers (e.g.
// b-overlay-dock). `modal` toggles aria-modal (docked panels are non-modal).
export default function Overlay({
  onClose,
  panelClassName = "b-picker",
  overlayClassName = "",
  modal = true,
  closeOnBackdrop = true,
  ariaLabel,
  children,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`b-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`}
      role="dialog"
      aria-modal={modal}
      aria-label={ariaLabel}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div className={panelClassName} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
