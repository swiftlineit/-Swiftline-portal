"use client";

/**
 * Central history helper for the portal-wide Back control.
 *
 * Intentionally small and dependency-free so it can be used from both the
 * button itself and any future call site that needs the same “history or
 * fallback” decision without diverging.
 */

export type PortalArea = "dashboard" | "client" | "driver" | "track" | "public";

/**
 * Area roots. Used when there is no deeper list page to return to.
 */
const AREA_FALLBACK: Record<PortalArea, string> = {
  dashboard: "/dashboard",
  client: "/client/dashboard",
  driver: "/driver",
  track: "/track",
  public: "/",
};

/**
 * Most-specific-first map: which list page backs a given subtree.
 * Keep this ordered: the first prefix that matches wins, so a longer prefix
 * must come before a shorter one that would also match.
 */
const FALLBACK_RULES: Array<{ prefix: string; fallback: string }> = [
  // Staff
  { prefix: "/dashboard/credit-accounts/", fallback: "/dashboard/credit-accounts" },
  { prefix: "/dashboard/business-accounts/", fallback: "/dashboard/business-accounts" },
  { prefix: "/dashboard/branches/", fallback: "/dashboard/branches" },
  { prefix: "/dashboard/users/", fallback: "/dashboard/users" },
  { prefix: "/dashboard/claims/", fallback: "/dashboard/claims" },
  { prefix: "/dashboard/tickets/", fallback: "/dashboard/tickets" },
  { prefix: "/dashboard/quote-requests/", fallback: "/dashboard/quote-requests" },
  { prefix: "/dashboard/shipment-manifests/", fallback: "/dashboard/shipment-manifests" },
  { prefix: "/dashboard/operations-manifests/", fallback: "/dashboard/operations-manifests" },
  { prefix: "/dashboard/shipments/", fallback: "/dashboard/shipments" },
  { prefix: "/dashboard/dpd-labels/", fallback: "/dashboard/dpd-labels" },
  { prefix: "/dashboard/shipments", fallback: "/dashboard/shipments" },
  { prefix: "/dashboard/dpd-labels", fallback: "/dashboard/dpd-labels" },
  { prefix: "/dashboard/counter-sales", fallback: "/dashboard/counter-sales" },
  { prefix: "/dashboard/pod", fallback: "/dashboard/pod" },
  // Client
  { prefix: "/client/shipments/", fallback: "/client/shipments" },
  { prefix: "/client/dpd-labels/", fallback: "/client/dpd-labels" },
  { prefix: "/client/claims/", fallback: "/client/claims" },
  { prefix: "/client/tickets/", fallback: "/client/tickets" },
  { prefix: "/client/quotes/", fallback: "/client/quotes" },
  { prefix: "/client/credit/statements/", fallback: "/client/credit/statements" },
  { prefix: "/client/credit/", fallback: "/client/credit" },
  { prefix: "/client/manifests", fallback: "/client/manifests" },
  { prefix: "/client/pods", fallback: "/client/pods" },
  { prefix: "/client/pickups", fallback: "/client/pickups" },
  { prefix: "/client/tracking", fallback: "/client/tracking" },
  { prefix: "/client/address-book", fallback: "/client/address-book" },
  // Driver (driver prefix handling is intentionally lenient; subrole drives exact)
  { prefix: "/driver/deliveries/", fallback: "/driver/deliveries" },
  { prefix: "/driver/pod", fallback: "/driver/pod" },
  { prefix: "/driver/pickups", fallback: "/driver" },
  // Public
  { prefix: "/track/", fallback: "/track" },
];

export function getPortalArea(pathname: string): PortalArea {
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/client")) return "client";
  if (pathname.startsWith("/driver")) return "driver";
  if (pathname.startsWith("/track")) return "track";
  return "public";
}

export function getFallbackForPath(pathname: string): string {
  for (const rule of FALLBACK_RULES) {
    const collectionPath = rule.prefix.replace(/\/$/, "");
    // Collection roots keep a visible Back control; deeper records fall back
    // to the collection when opened directly.
    if (pathname === collectionPath) continue;
    if (pathname.startsWith(rule.prefix)) {
      return rule.fallback;
    }
  }
  return AREA_FALLBACK[getPortalArea(pathname)] ?? "/";
}

/**
 * True when the session history can plausibly go back inside the portal.
 *
 * Covers:
 * - direct deep links (new tab / bookmark) where history.length is 1
 * - navigation that entered from an external origin (referrer host mismatch)
 */
export function shouldUseHistoryBack(): boolean {
  if (typeof window === "undefined") return false;

  // The root history tracker stamps only entries created inside this portal.
  // This avoids both false fallbacks after SPA navigation and accidentally
  // leaving the portal when the current page was opened from another origin.
  const state = window.history.state;
  if (!state || typeof state !== "object") return false;
  const marker = (state as Record<string, unknown>).__swiftlinePortalHistory;
  if (!marker || typeof marker !== "object") return false;
  const index = (marker as Record<string, unknown>).index;
  return typeof index === "number" && Number.isInteger(index) && index > 0;
}

/**
 * History-or-fallback navigation used by the portal back control.
 *
 * Separated from the component so the same safety checks are reusable from
 * imperative call sites.
 */
export function resolveBackTarget(pathname: string, explicitFallback?: string): { kind: "back" | "fallback"; href: string } {
  const fallback = explicitFallback ?? getFallbackForPath(pathname);
  // If the fallback is the current page there is nowhere to “fall back” to that
  // is distinct, so prefer history when it exists and otherwise stay put by
  // returning the same href the router will no-op on.
  if (fallback === pathname && shouldUseHistoryBack()) {
    return { kind: "back", href: fallback };
  }
  if (shouldUseHistoryBack()) {
    return { kind: "back", href: fallback };
  }
  return { kind: "fallback", href: fallback };
}

// Re-entry guard: double click or a popstate that races a click must not
// fire two prompts or two navigations. Module scope is correct – there is only
// one browser history and one dirty-form registry.
let portalNavigating = false;

export function isPortalNavigating(): boolean {
  return portalNavigating;
}

export function setPortalNavigating(value: boolean) {
  portalNavigating = value;
}
