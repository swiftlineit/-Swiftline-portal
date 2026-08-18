// GSTIN rules. This is the authority: the browser mirrors these checks for
// inline feedback, but a submission is only accepted if it passes here.
//
// KEEP IN SYNC with the frontend copy (separate package, cannot share a module):
//   portal/frontend/src/lib/gstin.ts
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

function stateKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Names people actually type, mapped to the spelling the code table uses. Both
// halves of a state pair have to resolve to the same code or an intra-state
// supply is billed as inter-state.
const stateNameAliases: Record<string, string> = {
  newdelhi: "07",
  nctofdelhi: "07",
  delhinct: "07",
  orissa: "21",
  uttaranchal: "05",
  pondicherry: "34",
  jammukashmir: "01",
  andaman: "35",
  dadraandnagarhaveli: "26",
  damananddiu: "26"
};

const stateCodeByName: Record<string, string> = {
  ...Object.entries(indianStateCodes).reduce<Record<string, string>>((map, [code, name]) => {
    // 28 and 37 are both Andhra Pradesh; the first entry wins so a name always
    // resolves to one code rather than whichever happened to be iterated last.
    if (!map[stateKey(name)]) map[stateKey(name)] = code;
    return map;
  }, {}),
  ...stateNameAliases
};

/**
 * The GST state code for a party, from its GSTIN when it has one and from its
 * recorded state name otherwise.
 *
 * Both sides of the place-of-supply test must be expressed the same way. Reading
 * one side off a GSTIN ("07") and the other off a state name ("Delhi") never
 * matches, which silently bills every intra-state supply as inter-state.
 *
 * Returns "" when neither is known, which is treated as inter-state- the
 * conservative default for a place of supply nobody has recorded.
 */
export function resolveGstStateCode(gstin?: string | null, stateName?: string | null) {
  const fromGstin = (gstin ?? "").trim().slice(0, 2);
  if (indianStateCodes[fromGstin]) return fromGstin;

  return stateCodeByName[stateKey(stateName ?? "")] ?? "";
}

const panPattern = /^[A-Z]{5}\d{4}[A-Z]$/;
const gstinPattern = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normalizeGstin(value: string) {
  return value.toUpperCase().replace(/\s+/g, "");
}

// The PAN embedded at characters 3-12.
export function getGstinPan(value: string) {
  return normalizeGstin(value).slice(2, 12);
}

/**
 * Blocking problems with a GSTIN, most specific first. Returns "" when the
 * value is acceptable. An empty value is not this function's concern- whether
 * the field is mandatory is decided by the caller.
 *
 * The 15th character is a mod-36 check digit, which is deliberately NOT checked
 * here: the frontend carries an unverified implementation of that algorithm and
 * neither side enforces it until it has been validated against genuine GSTINs.
 * See portal/frontend/src/lib/gstin.ts.
 */
export function getGstinError(value: string) {
  const gstin = normalizeGstin(value);

  if (!gstin) return "";

  if (gstin.length !== GSTIN_LENGTH) {
    return `GSTIN must be exactly ${GSTIN_LENGTH} characters.`;
  }

  const stateCode = gstin.slice(0, 2);

  if (!indianStateCodes[stateCode]) {
    return `"${stateCode}" is not a valid Indian state code.`;
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

// A GSTIN is mandatory for an Indian-registered account that has a company,
// unless the account is recorded as exempt from GST registration.
export function requiresGstin(input: {
  registrationCountry: string;
  noCompany?: boolean;
  gstExempt?: boolean;
}) {
  return input.registrationCountry === "India" && !input.noCompany && !input.gstExempt;
}

// Whether the GSTIN field should be captured at all.
export function collectsGstin(input: { registrationCountry: string; noCompany?: boolean }) {
  return input.registrationCountry === "India" && !input.noCompany;
}

export const GST_EXEMPT_REASON_MIN = 10;
export const GST_EXEMPT_REASON_MAX = 300;
