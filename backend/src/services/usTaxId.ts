// US taxpayer identification rules. This is the authority: the browser mirrors
// these checks for inline feedback, but a submission is only accepted if it
// passes here.
//
// KEEP IN SYNC with the frontend copy (separate package, cannot share a module):
//   portal/frontend/src/lib/usTaxId.ts
//
//   EIN   NN-NNNNNNN    businesses
//   SSN   NNN-NN-NNNN   individuals
//   ITIN  9NN-NN-NNNN   individuals not eligible for an SSN

export const usTaxIdTypes = ["ein", "ssn", "itin"] as const;
export type UsTaxIdType = (typeof usTaxIdTypes)[number];

const maskCharacter = "•";

export function isUsTaxIdType(value: string): value is UsTaxIdType {
  return (usTaxIdTypes as readonly string[]).includes(value);
}

export function normalizeUsTaxId(value: string) {
  return value.replace(/\D/g, "").slice(0, 9);
}

export function formatUsTaxId(value: string, type: UsTaxIdType) {
  const digits = normalizeUsTaxId(value);

  if (digits.length !== 9) return digits;
  if (type === "ein") return `${digits.slice(0, 2)}-${digits.slice(2)}`;

  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

export function maskUsTaxId(value: string, type: UsTaxIdType) {
  const digits = normalizeUsTaxId(value);

  if (digits.length !== 9) return "";
  if (type === "ein") return formatUsTaxId(digits, "ein");

  return `${maskCharacter.repeat(3)}-${maskCharacter.repeat(2)}-${digits.slice(5)}`;
}

// True for a value that came back from this server already masked. An edit that
// leaves the field untouched submits the mask, and must not overwrite the
// stored number with it.
export function isMaskedUsTaxId(value: string) {
  return value.includes(maskCharacter);
}

/**
 * Blocking problems, most specific first. Returns "" when acceptable.
 *
 * The EIN campus prefix is deliberately not checked: the IRS reassigns prefixes
 * and the published list changes, so enforcing it risks rejecting legitimate
 * numbers.
 */
export function getUsTaxIdError(value: string, type: UsTaxIdType) {
  if (isMaskedUsTaxId(value)) return "";

  const digits = normalizeUsTaxId(value);

  if (!digits) return "";

  if (digits.length !== 9) {
    return `${type.toUpperCase()} must be exactly 9 digits.`;
  }

  const area = digits.slice(0, 3);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5);

  if (type === "ein") return "";

  if (type === "ssn") {
    if (Number(area) >= 900) {
      return "An SSN cannot begin with 9. Numbers in that range are ITINs.";
    }
    if (area === "000" || area === "666") return `An SSN cannot begin with ${area}.`;
    if (group === "00") return "An SSN cannot have 00 as its middle two digits.";
    if (serial === "0000") return "An SSN cannot end in 0000.";

    return "";
  }

  if (!digits.startsWith("9")) return "An ITIN always begins with 9.";
  if (group === "00") return "An ITIN cannot have 00 as its middle two digits.";
  if (serial === "0000") return "An ITIN cannot end in 0000.";

  return "";
}

// SSN and ITIN identify a person and are stored encrypted. An EIN is a public
// business identifier and is stored in the clear like any other registration ID.
export function isSensitiveUsTaxIdType(type: UsTaxIdType) {
  return type === "ssn" || type === "itin";
}

export function defaultUsTaxIdType(noCompany?: boolean): UsTaxIdType {
  return noCompany ? "ssn" : "ein";
}
