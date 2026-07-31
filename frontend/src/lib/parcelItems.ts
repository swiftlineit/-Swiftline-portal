// Per-parcel content items and their HSN codes. Frontend mirror of the backend's
// parcelItems.service.ts — keep the two in step by hand.
//
// A parcel holds one or more distinct goods, each needing an HSN code for customs.
// `contentsDescription` remains the derived single-line summary that the EDI
// export, operations manifest, DPD payload and labels all read, so none of those
// formats change.

// Indian HSN codes are declared at 4, 6 or 8 digit precision.
const hsnCodePattern = /^\d{4}(?:\d{2}(?:\d{2})?)?$/;

export const contentsDescriptionMaxLength = 120;
export const maxParcelItems = 20;

export type ParcelItem = {
  description: string;
  hsnCode: string;
};

export function isValidHsnCode(value: unknown): boolean {
  return typeof value === "string" && hsnCodePattern.test(value.trim());
}

/**
 * Validation message for a single HSN code, or "" when it is acceptable.
 * `required` is false on shipments booked before HSN capture existed.
 */
export function getHsnCodeError(value: string, required = true): string {
  const trimmed = value.trim();
  if (!trimmed) return required ? "HSN code is required." : "";
  return isValidHsnCode(trimmed) ? "" : "Enter a valid 4, 6 or 8 digit HSN code.";
}

/**
 * Joins item descriptions into the summary stored in `contentsDescription`,
 * truncating on an item boundary so the result always fits the 120 char column.
 */
export function composeContentsDescription(items: ParcelItem[]): string {
  const descriptions = items.map((item) => item.description.trim()).filter(Boolean);
  if (!descriptions.length) return "";

  const parts: string[] = [];
  for (const description of descriptions) {
    const candidate = [...parts, description].join(", ");
    if (candidate.length > contentsDescriptionMaxLength) break;
    parts.push(description);
  }

  if (!parts.length) return (descriptions[0] ?? "").slice(0, contentsDescriptionMaxLength);
  return parts.join(", ");
}

/**
 * Rebuilds a parcel's items from whatever the API returned. Parcels stored before
 * items existed carry only `contentsDescription` and surface as a single item
 * with a blank HSN code, so old drafts open without a migration.
 */
export function normalizeParcelItems(parcel: {
  items?: Array<{ description?: string | null; hsnCode?: string | null }> | null;
  contentsDescription?: string | null;
}): ParcelItem[] {
  const items = (Array.isArray(parcel.items) ? parcel.items : [])
    .map((item) => ({
      description: (item.description ?? "").trim(),
      hsnCode: (item.hsnCode ?? "").trim()
    }))
    .filter((item) => item.description || item.hsnCode);

  if (items.length) return items;

  const legacy = (parcel.contentsDescription ?? "").trim();
  return legacy ? [{ description: legacy, hsnCode: "" }] : [{ description: "", hsnCode: "" }];
}
