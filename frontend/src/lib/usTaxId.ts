// US taxpayer identification rules.
//
// KEEP IN SYNC with the backend copy (separate package, cannot share a module):
//   portal/backend/src/services/usTaxId.ts
//
// Three identifiers are accepted, all nine digits, distinguished by who holds
// them and by how they are punctuated:
//   EIN   NN-NNNNNNN    businesses
//   SSN   NNN-NN-NNNN   individuals
//   ITIN  9NN-NN-NNNN   individuals not eligible for an SSN

export const usTaxIdTypes = ["ein", "ssn", "itin"] as const;
export type UsTaxIdType = (typeof usTaxIdTypes)[number];

export const usTaxIdTypeOptions = [
  { value: "ein", label: "EIN - Employer Identification Number" },
  { value: "ssn", label: "SSN - Social Security Number" },
  { value: "itin", label: "ITIN - Individual Taxpayer Identification Number" }
];

export const usTaxIdLabels: Record<UsTaxIdType, string> = {
  ein: "US Tax ID (EIN)",
  ssn: "US Tax ID (SSN)",
  itin: "US Tax ID (ITIN)"
};

export const usTaxIdExamples: Record<UsTaxIdType, string> = {
  ein: "12-3456789",
  ssn: "123-45-6789",
  itin: "912-70-1234"
};

export const usTaxIdInfo: Record<UsTaxIdType, string> = {
  ein: "Nine-digit Employer Identification Number issued by the IRS to a business, written NN-NNNNNNN.",
  ssn: "Nine-digit Social Security Number of the individual holding the account, written NNN-NN-NNNN.",
  itin: "Nine-digit Individual Taxpayer Identification Number, issued by the IRS to individuals who are not eligible for an SSN. It always begins with 9."
};

// Groups the IRS has issued ITINs from. Used only to raise a non-blocking
// caution: the published ranges have widened over time, so a number outside
// them is suspicious rather than provably wrong.
const itinGroupRanges: [number, number][] = [[50, 65], [70, 88], [90, 92], [94, 99]];

const maskCharacter = "•";

export function isUsTaxIdType(value: string): value is UsTaxIdType {
  return (usTaxIdTypes as readonly string[]).includes(value);
}

// The type a US account defaults to. A business holds an EIN; an account with
// no company behind it is an individual, who holds an SSN or an ITIN.
export function defaultUsTaxIdType(noCompany?: boolean): UsTaxIdType {
  return noCompany ? "ssn" : "ein";
}

export function normalizeUsTaxId(value: string) {
  return value.replace(/\D/g, "").slice(0, 9);
}

// Punctuates as the user types, so the field shows the shape the IRS prints.
export function formatUsTaxId(value: string, type: UsTaxIdType) {
  const digits = normalizeUsTaxId(value);

  if (!digits) return "";

  if (type === "ein") {
    return digits.length <= 2 ? digits : `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }

  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;

  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

export function maskUsTaxId(value: string, type: UsTaxIdType) {
  const digits = normalizeUsTaxId(value);

  if (digits.length !== 9) return "";
  if (type === "ein") return formatUsTaxId(digits, "ein");

  const three = maskCharacter.repeat(3);
  const two = maskCharacter.repeat(2);

  return `${three}-${two}-${digits.slice(5)}`;
}

// True for a value the server sent back masked. Editing an account shows the
// mask, and submitting it unchanged must not overwrite the stored number.
export function isMaskedUsTaxId(value: string) {
  return value.includes(maskCharacter);
}

/**
 * Blocking problems, most specific first. Returns "" when acceptable. An empty
 * value is not this function's concern — whether the field is mandatory is
 * decided by the caller.
 *
 * The EIN campus prefix is deliberately not checked: the IRS reassigns prefixes
 * and the published list of valid ones changes, so enforcing it risks rejecting
 * legitimate numbers.
 */
export function getUsTaxIdError(value: string, type: UsTaxIdType) {
  if (isMaskedUsTaxId(value)) return "";

  const digits = normalizeUsTaxId(value);

  if (!digits) return "";

  if (digits.length !== 9) {
    return `${usTaxIdLabels[type].replace("US Tax ID ", "").replace(/[()]/g, "")} must be exactly 9 digits. You entered ${digits.length}.`;
  }

  const area = digits.slice(0, 3);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5);

  if (type === "ein") return "";

  if (type === "ssn") {
    // The 9xx range is reserved for ITINs, so that case gets a message the user
    // can act on rather than a flat rejection.
    if (Number(area) >= 900) {
      return "An SSN cannot begin with 9. Numbers in that range are ITINs — change the type to ITIN if that is what this is.";
    }
    if (area === "000" || area === "666") {
      return `An SSN cannot begin with ${area}.`;
    }
    if (group === "00") return "An SSN cannot have 00 as its middle two digits.";
    if (serial === "0000") return "An SSN cannot end in 0000.";

    return "";
  }

  if (!digits.startsWith("9")) {
    return "An ITIN always begins with 9. Change the type to SSN or EIN if that is what this is.";
  }
  if (group === "00") return "An ITIN cannot have 00 as its middle two digits.";
  if (serial === "0000") return "An ITIN cannot end in 0000.";

  return "";
}

/**
 * Non-blocking caution for an ITIN whose middle two digits fall outside the
 * ranges the IRS is known to have issued from.
 */
export function getUsTaxIdWarning(value: string, type: UsTaxIdType) {
  if (type !== "itin" || isMaskedUsTaxId(value)) return "";

  const digits = normalizeUsTaxId(value);

  if (digits.length !== 9 || getUsTaxIdError(digits, type)) return "";

  const group = Number(digits.slice(3, 5));
  const isKnownGroup = itinGroupRanges.some(([from, to]) => group >= from && group <= to);

  if (isKnownGroup) return "";

  return `${digits.slice(3, 5)} is not a range the IRS is known to issue ITINs from. Check the number against the IRS notice before submitting.`;
}

// SSN and ITIN are sensitive enough to be stored encrypted rather than in the
// clear, unlike an EIN, which is a public business identifier.
export function isSensitiveUsTaxIdType(type: UsTaxIdType) {
  return type === "ssn" || type === "itin";
}
