// Per-parcel content items.
//
// A parcel can hold several distinct goods ("cookies", "clothes"), and Indian
// customs needs an HSN code for each one. Those items live in `parcel.items`.
//
// `parcel.contentsDescription` is kept as the DERIVED single-line summary of those
// items. Every downstream consumer — the customs EDI export, the operations
// manifest, the DPD carrier payload, shipment labels and the existing GST invoice
// — keeps reading `contentsDescription` exactly as before, so none of those
// formats change. The per-item HSN codes are stored for the shipment (customs)
// invoice that will be built on top of them later.

// Indian HSN codes are declared at 4, 6 or 8 digit precision.
const hsnCodePattern = /^\d{4}(?:\d{2}(?:\d{2})?)?$/;

// Must stay <= the `contentsDescription` maxlength in shipmentDraft.model.ts and
// the length the DPD payload validator enforces.
export const contentsDescriptionMaxLength = 120;
export const maxParcelItems = 20;

export type ParcelItemInput = {
  description?: unknown;
  hsnCode?: unknown;
};

export function isValidHsnCode(value: unknown): boolean {
  return typeof value === "string" && hsnCodePattern.test(value.trim());
}

/**
 * Joins item descriptions into the single-line summary stored in
 * `contentsDescription`. Truncation happens on an item boundary so the summary
 * never ends mid-word, and the result always fits the 120 char column.
 */
export function composeContentsDescription(items: ParcelItemInput[]): string {
  const descriptions = items
    .map((item) => (typeof item.description === "string" ? item.description.trim() : ""))
    .filter(Boolean);
  if (!descriptions.length) return "";

  const parts: string[] = [];
  for (const description of descriptions) {
    const candidate = [...parts, description].join(", ");
    if (candidate.length > contentsDescriptionMaxLength) break;
    parts.push(description);
  }

  // A single first item longer than the limit still has to be represented, so it
  // is hard-cut rather than dropped entirely.
  if (!parts.length) return (descriptions[0] ?? "").slice(0, contentsDescriptionMaxLength);
  return parts.join(", ");
}

/**
 * Rebuilds a parcel's items from whatever is stored. Drafts created before items
 * existed carry only `contentsDescription`, so they surface as a single item with
 * an empty HSN code — no migration required.
 */
export function normalizeParcelItems(parcel: {
  items?: Array<{ description?: unknown; hsnCode?: unknown }> | null;
  contentsDescription?: unknown;
}): Array<{ description: string; hsnCode: string }> {
  const stored = Array.isArray(parcel.items) ? parcel.items : [];
  const items = stored
    .map((item) => ({
      description: typeof item.description === "string" ? item.description.trim() : "",
      hsnCode: typeof item.hsnCode === "string" ? item.hsnCode.trim() : ""
    }))
    .filter((item) => item.description || item.hsnCode);

  if (items.length) return items;

  const legacy = typeof parcel.contentsDescription === "string" ? parcel.contentsDescription.trim() : "";
  return legacy ? [{ description: legacy, hsnCode: "" }] : [];
}
