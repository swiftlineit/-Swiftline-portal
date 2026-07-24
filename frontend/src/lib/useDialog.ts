import { useEffect, useRef } from "react";

// Accessibility helper for modal dialogs. While the dialog is open it:
//   - moves focus into the dialog,
//   - closes on Escape,
//   - traps Tab focus within the dialog,
//   - restores focus to the previously focused element on close.
//
// Attach the returned ref to the dialog container and pair it with
// role="dialog" and aria-modal="true".
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);

  // Keep the latest onClose without re-running the open/focus effect.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    function focusableElements() {
      return Array.from(
        node!.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
    }

    (focusableElements()[0] ?? node).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const elements = focusableElements();
      if (!elements.length) return;

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    node.addEventListener("keydown", handleKeyDown);

    return () => {
      node.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return ref;
}
