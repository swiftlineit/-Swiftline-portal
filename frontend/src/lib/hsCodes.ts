"use client";

// HS code suggestions for a goods description, fetched from the reference API.
//
// The tariff is ~6800 entries, so none of it is bundled: the server searches it
// and returns only the handful of matches. Results are cached per query because
// a shipment often repeats the same item across parcels.

import { fetchWithAuth } from "@/lib/shipmentsList";
import { readJsonSafely } from "@/lib/auth";

export type HsCodeSuggestion = { code: string; description: string };

const cache = new Map<string, HsCodeSuggestion[]>();

/** Shortest description worth searching; below this everything matches. */
export const minHsCodeQueryLength = 3;

export async function fetchHsCodeSuggestions(query: string): Promise<HsCodeSuggestion[]> {
  const trimmed = query.trim();

  if (trimmed.length < minHsCodeQueryLength) return [];

  const key = trimmed.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const response = await fetchWithAuth(`/api/v1/reference/hs-codes?query=${encodeURIComponent(trimmed)}`);
    const payload = await readJsonSafely(response) as { success?: boolean; suggestions?: HsCodeSuggestion[] };
    const suggestions = response.ok && payload.success && Array.isArray(payload.suggestions)
      ? payload.suggestions
      : [];

    cache.set(key, suggestions);
    return suggestions;
  } catch {
    // A lookup failure must never block the form — the HS code stays typed by hand.
    return [];
  }
}
