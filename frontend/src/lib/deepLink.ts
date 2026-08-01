// Portal notifications carry a `#section` fragment so opening one lands on the
// exact panel that needs attention rather than the top of the page.
//
// The browser cannot resolve those fragments on its own here: every dashboard
// page renders inside the shell's own scroll container, and the sections are
// drawn only after their data request settles. `DeepLinkTarget` therefore waits
// for the element and scrolls it into view itself.
export const deepLinkEventName = "swiftline:deep-link";

export const deepLinkHighlightClass = "deep-link-highlight";

// Router pushes that only change the fragment do not fire `hashchange`, so a
// caller navigating within the current page announces the change explicitly.
// Deferred by a tick so the router has committed the new URL first.
export function announceDeepLink() {
  window.setTimeout(() => window.dispatchEvent(new Event(deepLinkEventName)), 0);
}
