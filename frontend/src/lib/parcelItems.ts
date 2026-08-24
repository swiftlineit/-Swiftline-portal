// Per-parcel content items and their HSN codes. Frontend mirror of the backend's
// parcelItems.service.ts- keep the two in step by hand.
//
// A parcel holds one or more distinct goods, each needing an HSN code for customs.
// `contentsDescription` remains the derived single-line summary that the EDI
// export, operations manifest, booking payload and labels all read, so none of those
// formats change.

// HS codes are declared at 4, 6, 8 or 10 digit precision.
const hsnCodePattern = /^\d{4}(?:\d{2}(?:\d{2}(?:\d{2})?)?)?$/;

export const contentsDescriptionMaxLength = 120;
export const maxParcelItems = 20;

// Unit of measure per item line on the customs (shipment) invoice.
export const parcelItemUnitTypeValues = ["Pkt", "Pcs", "Set", "Box", "Kg", "Pair"] as const;
export type ParcelItemUnitType = (typeof parcelItemUnitTypeValues)[number];
export const defaultParcelItemUnitType: ParcelItemUnitType = "Pkt";

export type ParcelItem = {
  description: string;
  hsnCode: string;
  unitType: string;
  // Held as strings so a partially typed value does not fight the input.
  quantity: string;
  unitRate: string;
};

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Line amount for an item row: quantity x unit rate. Always derived. */
export function getParcelItemAmount(item: { quantity: string; unitRate: string }): number {
  return roundMoney(numeric(item.quantity) * numeric(item.unitRate));
}

/** Declared goods value across every parcel, shown as the invoice total. */
export function getDeclaredGoodsValue(parcels: Array<{ items: ParcelItem[] }>): number {
  return roundMoney(parcels.reduce(
    (total, parcel) => total + parcel.items.reduce((sum, item) => sum + getParcelItemAmount(item), 0),
    0
  ));
}

/**
 * An item description as it is allowed to be stored: no digits.
 *
 * Customs reads the description as the *name* of the good- "COTTON SHIRTS"- while
 * quantity and unit rate carry every number the invoice needs. A "500" typed into
 * the description only ever restated one of those fields, so digits are dropped as
 * they are typed rather than rejected after the fact.
 */
export function sanitizeParcelItemDescription(value: string): string {
  return value.replace(/[0-9]/g, "");
}

export function isValidHsnCode(value: unknown): boolean {
  return typeof value === "string" && hsnCodePattern.test(value.trim());
}

/**
 * Validation message for a single HSN code, or "" when it is acceptable.
 *
 * `required` is false on CSB-IV, which does not ask for a code per line, and on
 * shipments booked before HSN capture existed. A code that IS entered is
 * format-checked either way.
 */
export function getHsnCodeError(value: string, required = true): string {
  const trimmed = value.trim();
  if (!trimmed) return required ? "HS code is required." : "";
  return isValidHsnCode(trimmed) ? "" : "Enter a valid 4, 6, 8 or 10 digit HS code.";
}

/** Validation message for a quantity or unit rate, or "" when acceptable. */
export function getPositiveNumberError(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return `${label} must be greater than zero.`;
  return "";
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
export function createEmptyParcelItem(): ParcelItem {
  return { description: "", hsnCode: "", unitType: defaultParcelItemUnitType, quantity: "", unitRate: "" };
}

export function normalizeParcelItems(parcel: {
  items?: Array<{
    description?: string | null;
    hsnCode?: string | null;
    unitType?: string | null;
    quantity?: number | string | null;
    unitRate?: number | string | null;
  }> | null;
  contentsDescription?: string | null;
}): ParcelItem[] {
  const items = (Array.isArray(parcel.items) ? parcel.items : [])
    .map((item) => ({
      description: (item.description ?? "").trim(),
      hsnCode: (item.hsnCode ?? "").trim(),
      unitType: (item.unitType ?? "").trim() || defaultParcelItemUnitType,
      // Zero reads as blank so an untouched legacy row shows an empty input.
      quantity: item.quantity ? String(item.quantity) : "",
      unitRate: item.unitRate ? String(item.unitRate) : ""
    }))
    .filter((item) => item.description || item.hsnCode);

  if (items.length) return items;

  const legacy = (parcel.contentsDescription ?? "").trim();
  const empty = createEmptyParcelItem();
  return legacy ? [{ ...empty, description: legacy }] : [empty];
}
