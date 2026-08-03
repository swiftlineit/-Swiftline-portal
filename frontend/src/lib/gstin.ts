// GSTIN rules, shared by the business account wizard and the branch form.
//
// KEEP IN SYNC with the backend copy (separate package, cannot share a module):
//   portal/backend/src/services/gstin.ts
//
// A GSTIN is 15 characters: SS PPPPPPPPPP E Z C
//   SS          state code (2 digits)
//   PPPPPPPPPP  the holder's PAN (10 characters)
//   E           entity number for that PAN within the state (1-9 or A-Z)
//   Z           fixed letter Z for ordinary taxpayers
//   C           check digit (0-9 or A-Z)

export const GSTIN_LENGTH = 15;
export const GSTIN_EXAMPLE = "27ABCDE1234F1Z5";

// Codes 25 and 28 belong to jurisdictions that have since been merged or
// bifurcated. Registrations issued before those changes are still valid and in
// use, so both stay accepted rather than rejecting a legitimate old GSTIN.
export const indianStateCodes: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction"
};

const panPattern = /^[A-Z]{5}\d{4}[A-Z]$/;
const gstinPattern = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const checkDigitAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Uppercases and removes the spaces people paste in from certificates.
export function normalizeGstin(value: string) {
  return value.toUpperCase().replace(/\s+/g, "");
}

export function getGstinStateCode(value: string) {
  return normalizeGstin(value).slice(0, 2);
}

export function getGstinStateName(value: string) {
  return indianStateCodes[getGstinStateCode(value)] ?? "";
}

// The PAN embedded at characters 3-12.
export function getGstinPan(value: string) {
  return normalizeGstin(value).slice(2, 12);
}

/**
 * The GSTIN's 15th character is a mod-36 check digit over the first 14.
 *
 * NOT WIRED INTO `getGstinError` YET, deliberately. The implementation follows
 * the published GSTN algorithm, but it has not been checked against a GSTIN
 * confirmed to be genuine. If any detail is wrong it would reject every real
 * number and make Indian accounts impossible to create, so it stays out of the
 * blocking path until it can be verified against known-good registrations.
 * Verify first, then call it from `getGstinError`.
 */
export function hasValidGstinCheckDigit(value: string) {
  const gstin = normalizeGstin(value);

  if (gstin.length !== GSTIN_LENGTH) return false;

  let factor = 2;
  let sum = 0;

  for (let index = GSTIN_LENGTH - 2; index >= 0; index -= 1) {
    const codePoint = checkDigitAlphabet.indexOf(gstin[index]);

    if (codePoint < 0) return false;

    const product = codePoint * factor;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(product / checkDigitAlphabet.length) + (product % checkDigitAlphabet.length);
  }

  const expected = checkDigitAlphabet[(checkDigitAlphabet.length - (sum % checkDigitAlphabet.length)) % checkDigitAlphabet.length];

  return expected === gstin[GSTIN_LENGTH - 1];
}

/**
 * Blocking problems with a GSTIN, most specific first so the message points at
 * the part that is actually wrong instead of restating the whole format.
 * Returns "" when the value is acceptable. An empty value is not this
 * function's concern — whether the field is mandatory is decided by the caller.
 */
export function getGstinError(value: string) {
  const gstin = normalizeGstin(value);

  if (!gstin) return "";

  if (gstin.length !== GSTIN_LENGTH) {
    return `GSTIN must be exactly ${GSTIN_LENGTH} characters. You entered ${gstin.length}.`;
  }

  const stateCode = gstin.slice(0, 2);

  if (!indianStateCodes[stateCode]) {
    return `"${stateCode}" is not a valid Indian state code. The GSTIN must begin with the code of the registering state.`;
  }

  if (!panPattern.test(gstin.slice(2, 12))) {
    return "Characters 3-12 of the GSTIN must be a valid PAN: 5 letters, 4 digits, then 1 letter.";
  }

  if (!gstinPattern.test(gstin)) {
    return `Enter a valid GSTIN, for example ${GSTIN_EXAMPLE}.`;
  }

  return "";
}

export function isValidGstin(value: string) {
  const gstin = normalizeGstin(value);

  return Boolean(gstin) && !getGstinError(gstin);
}

/**
 * Non-blocking notice when the PAN inside the GSTIN differs from the PAN
 * captured separately. Usually a director's PAN typed into the company field,
 * but a related legal entity is possible, so this warns rather than blocks.
 */
export function getGstinPanMismatchWarning(gstin: string, pan: string) {
  const embeddedPan = getGstinPan(gstin);
  const companyPan = pan.trim().toUpperCase();

  if (!panPattern.test(embeddedPan) || !panPattern.test(companyPan)) return "";
  if (embeddedPan === companyPan) return "";

  return `The PAN inside this GSTIN (${embeddedPan}) differs from the PAN entered above (${companyPan}). Confirm both belong to this company.`;
}
