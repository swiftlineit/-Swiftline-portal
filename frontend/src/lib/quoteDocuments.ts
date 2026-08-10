// Export documents a customer declares on a live quote request. Frontend mirror
// of the backend's quoteDocuments.service.ts — keep the two in step.
//
// Declarations only: nothing is uploaded at the quote stage. Which documents
// apply, and therefore which must be declared, depends on the customs route.

import type { CsbType } from "@/lib/csbType";

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
 * the list *is* the requirement, so there is no optional tier. Returns an empty
 * list until a route is chosen, because nothing can be asked for before then.
 */
export function requiredQuoteDocuments(csbType: CsbType | ""): QuoteDocumentCode[] {
  if (!csbType) return [];
  return csbType === "CSB_V"
    ? [...quoteDocumentCodeValues]
    : quoteDocumentCodeValues.filter((code) => csbIvDocumentCodes.has(code));
}

/** The required documents not yet declared, in canonical order. */
export function missingQuoteDocuments(
  csbType: CsbType | "",
  selected: readonly QuoteDocumentCode[]
): QuoteDocumentCode[] {
  return requiredQuoteDocuments(csbType).filter((code) => !selected.includes(code));
}

/**
 * Keeps only known codes, de-duplicated and in canonical order. Passing the
 * customs route also drops anything that route does not ask for, so switching
 * from CSB-V to CSB-IV cannot leave stale ticks behind in the payload.
 */
export function normalizeQuoteDocuments(value: unknown, csbType?: CsbType | ""): QuoteDocumentCode[] {
  const selected = new Set(Array.isArray(value) ? value : []);
  const allowed = csbType === undefined ? quoteDocumentCodeValues : requiredQuoteDocuments(csbType);
  return allowed.filter((code) => selected.has(code));
}

export function formatQuoteDocuments(value: unknown): string {
  return normalizeQuoteDocuments(value).map((code) => quoteDocumentLabels[code]).join(", ");
}
