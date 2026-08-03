"use client";

import { useCallback, useEffect, useId } from "react";

export const unsavedChangesMessage = "You have unsaved changes. Leave this page?";

/**
 * Which forms currently hold unsaved edits.
 *
 * Deliberately module state rather than React context. The guard is read by the
 * sidebar and written by whichever form happens to be open, and those two sit in
 * different parts of the tree; with a context provider, any mismatch in where
 * the provider is mounted makes the guard silently pass instead of prompting.
 * There is exactly one instance of this module, so a plain Set cannot get out of
 * sync with itself.
 *
 * Safe under SSR because entries are only ever added from an effect, which does
 * not run on the server.
 */
const dirtyFormIds = new Set<string>();

/** Exposed for the confirm dialog and for tests; prefer `useConfirmLeave`. */
export function hasUnsavedWork() {
  return dirtyFormIds.size > 0;
}

/**
 * Declares that a form currently holds unsaved edits.
 *
 * Covers the browser's own unload (tab close, reload, external navigation) and
 * registers the form so in-app navigation is guarded too. Callers pass a
 * changing boolean; nothing else is required of them.
 */
export function useUnsavedChanges(hasUnsavedChanges: boolean) {
  // Stable across renders, unique per component instance, and safe to read
  // while rendering — unlike a ref.
  const formId = useId();

  useEffect(() => {
    if (!hasUnsavedChanges) {
      // Covers the form being saved: the flag flips to false and the entry must
      // go, or the next navigation prompts about work that is already stored.
      dirtyFormIds.delete(formId);
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      // Browsers show their own wording; assigning returnValue is what actually
      // triggers the prompt.
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    dirtyFormIds.add(formId);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      dirtyFormIds.delete(formId);
    };
  }, [hasUnsavedChanges, formId]);
}

/**
 * Guard for in-app navigation. Returns true when it is safe to leave.
 *
 * Used by the sidebar through `<Link onNavigate>`, which exposes
 * `preventDefault()`, and before any `router.push` that would abandon a form.
 */
export function useConfirmLeave() {
  return useCallback(() => confirmLeave(hasUnsavedWork()), []);
}

// Standalone variant for a component that already knows its own dirty state and
// is not going through the registry.
export function confirmLeave(hasUnsavedChanges: boolean) {
  return !hasUnsavedChanges || window.confirm(unsavedChangesMessage);
}
