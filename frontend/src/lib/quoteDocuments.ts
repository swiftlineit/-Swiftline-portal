// Export documents a customer can declare on a live quote request. Frontend
// mirror of the backend's quoteDocuments.service.ts — keep the two in step.
//
// Declarations only: nothing is uploaded at the quote stage. At least one must
// be selected before a live quote can be requested.

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

/** Codes in canonical display order, for rendering the checkbox grid. */
export const quoteDocumentOptions = quoteDocumentCodeValues.map((code) => ({
  value: code,
  label: quoteDocumentLabels[code]
}));

/** Keeps only known codes, de-duplicated and in canonical order. */
export function normalizeQuoteDocuments(value: unknown): QuoteDocumentCode[] {
  const selected = new Set(Array.isArray(value) ? value : []);
  return quoteDocumentCodeValues.filter((code) => selected.has(code));
}

export function formatQuoteDocuments(value: unknown): string {
  return normalizeQuoteDocuments(value).map((code) => quoteDocumentLabels[code]).join(", ");
}
