// Mirrors the server-side Verhoeff check in aadhaarValidation.service.ts so a
// typo is caught in the form instead of on submit.
const multiplicationTable: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const permutationTable: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

export function normalizeAadhaarNumber(value: string) {
  return value.replace(/\D/g, "").slice(0, 12);
}

/** Displays as "1234 5678 9012" while the raw digits stay the stored value. */
export function formatAadhaarNumber(value: string) {
  const digits = normalizeAadhaarNumber(value);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function isValidAadhaarNumber(value: string) {
  const digits = normalizeAadhaarNumber(value);

  // UIDAI never issues a number starting with 0 or 1.
  if (!/^[2-9]\d{11}$/.test(digits)) return false;

  let checksum = 0;
  [...digits].reverse().forEach((digit, index) => {
    checksum = multiplicationTable[checksum][permutationTable[index % 8][Number(digit)]];
  });

  return checksum === 0;
}
