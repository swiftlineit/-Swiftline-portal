// Fixed values the customs EDI carries on every row. Kept in one place so a policy
// change (e.g. a new default pay type) is a single edit. Verified against the sample
// EDI, where each was constant across all 63 rows.

export const EDI_PAY_TYPE = "N";
export const EDI_BOND = "NA";
export const EDI_IGST_PAID = 0;
export const EDI_GSTIN_TYPE = "Aadhaar Number";
export const EDI_CURRENCY = "INR";
// AD Code is not captured yet; the column is intentionally left blank.
export const EDI_AD_CODE = "";
