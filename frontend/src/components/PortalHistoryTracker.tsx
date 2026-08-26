"use client";

import { useEffect } from "react";

/**
 * Adds a small, portal-owned index to the App Router's history entries.
 *
 * `history.length` and `document.referrer` cannot tell us whether the entry
 * immediately before the current one belongs to this SPA. Next stores its own
 * state in each entry, so this tracker always merges its marker instead of
 * replacing that state.
 */
export const portalHistoryStateKey = "__swiftlinePortalHistory";

function readIndex(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[portalHistoryStateKey];
  if (!value || typeof value !== "object") return null;
  const index = (value as Record<string, unknown>).index;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : null;
}

function withIndex(state: unknown, index: number) {
  const base = state && typeof state === "object" ? state : {};
  return {
    ...(base as Record<string, unknown>),
    [portalHistoryStateKey]: { index },
  };
}

export default function PortalHistoryTracker() {
  useEffect(() => {
    const history = window.history;
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    const currentIndex = readIndex(history.state) ?? 0;
    if (readIndex(history.state) === null) {
      originalReplaceState(withIndex(history.state, currentIndex), "", window.location.href);
    }

    history.pushState = ((state: unknown, title: string, url?: string | URL | null) => {
      const index = (readIndex(history.state) ?? currentIndex) + 1;
      originalPushState(withIndex(state, index), title, url);
    }) as History["pushState"];

    history.replaceState = ((state: unknown, title: string, url?: string | URL | null) => {
      const index = readIndex(history.state) ?? currentIndex;
      originalReplaceState(withIndex(state, index), title, url);
    }) as History["replaceState"];

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  return null;
}

export function canPortalHistoryGoBack() {
  if (typeof window === "undefined") return false;
  const index = readIndex(window.history.state);
  return index !== null && index > 0;
}
