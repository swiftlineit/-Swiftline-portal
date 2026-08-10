// Export documents a customer declares on a live quote request.
//
// These are declarations only — nothing is uploaded at the quote stage. The
// branch uses the list to see which paperwork is already in place when pricing
// the quote. Which documents apply depends on the customs route.

import { normalizeCsbType, type CsbType } from "./csbType.service.js";

export const quoteDocumentCodeValues = [
  "IEC",
  "GST",
  "PAN",
  "AADHAR",
  "SALE_PURCHASE_AD_CODE",
  "LUT",
  "DECLARATION_OF_GOODS",
  "OTHER_CERTIFICATES",
  "HSN_CODE"
] as const;

export type QuoteDocumentCode = (typeof quoteDocumentCodeValues)[number];

export const quoteDocumentLabels: Record<QuoteDocumentCode, string> = {
  IEC: "IEC",
  GST: "GST",
  PAN: "PAN",
  AADHAR: "Aadhaar",
  SALE_PURCHASE_AD_CODE: "Sale / Purchase / AD Code",
  LUT: "LUT",
  DECLARATION_OF_GOODS: "Declaration of Goods",
  OTHER_CERTIFICATES: "Other Certificates",
  HSN_CODE: "HSN Code"
};

// CSB-IV clears on the exporter's identity alone, so only these two apply. CSB-V
// is a full export filing and needs the complete set.
const csbIvDocumentCodes = new Set<QuoteDocumentCode>(["PAN", "AADHAR"]);

/**
 * The documents that apply to a customs route. Every one of them is required —
 * the list *is* the requirement, so there is no optional tier.
 *
 * Mirrored in the frontend's quoteDocuments.ts; the two live in separate
 * packages, so keep them in step by hand.
 */
export function requiredQuoteDocuments(csbType: CsbType): QuoteDocumentCode[] {
  return csbType === "CSB_V"
    ? [...quoteDocumentCodeValues]
    : quoteDocumentCodeValues.filter((code) => csbIvDocumentCodes.has(code));
}

/** The required documents a submission failed to declare, in canonical order. */
export function missingQuoteDocuments(csbType: unknown, value: unknown): QuoteDocumentCode[] {
  const selected = new Set(Array.isArray(value) ? value : []);
  return requiredQuoteDocuments(normalizeCsbType(csbType)).filter((code) => !selected.has(code));
}

/**
 * Keeps only recognised codes, de-duplicated and in the canonical order above so
 * the stored snapshot never depends on the order the checkboxes were ticked.
 *
 * Passing the customs route also drops anything that route does not ask for, so
 * a stale CSB-V tick can never be stored against a CSB-IV shipment.
 */
export function normalizeQuoteDocuments(value: unknown, csbType?: unknown): QuoteDocumentCode[] {
  const selected = new Set(Array.isArray(value) ? value : []);
  const allowed = csbType === undefined
    ? quoteDocumentCodeValues
    : requiredQuoteDocuments(normalizeCsbType(csbType));
  return allowed.filter((code) => selected.has(code));
}

export function formatQuoteDocuments(value: unknown): string {
  return normalizeQuoteDocuments(value).map((code) => quoteDocumentLabels[code]).join(", ");
}
