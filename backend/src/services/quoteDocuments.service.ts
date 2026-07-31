// Export documents a customer can declare on a live quote request.
//
// These are declarations only — nothing is uploaded at the quote stage. The
// branch uses the list to see which paperwork is already in place when pricing
// the quote. At least one must be selected.

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

/**
 * Keeps only recognised codes, de-duplicated and in the canonical order above so
 * the stored snapshot never depends on the order the checkboxes were ticked.
 */
export function normalizeQuoteDocuments(value: unknown): QuoteDocumentCode[] {
  const selected = new Set(Array.isArray(value) ? value : []);
  return quoteDocumentCodeValues.filter((code) => selected.has(code));
}

export function formatQuoteDocuments(value: unknown): string {
  return normalizeQuoteDocuments(value).map((code) => quoteDocumentLabels[code]).join(", ");
}
