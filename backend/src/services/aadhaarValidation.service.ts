// UIDAI Aadhaar numbers carry a Verhoeff check digit, so a typo is rejected here
// instead of surfacing later as a failed KYC match.
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

export function normalizeAadhaarNumber(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

export function formatAadhaarNumber(value: unknown): string {
  const digits = normalizeAadhaarNumber(value);
  return digits.length === 12 ? `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}` : digits;
}

export function maskAadhaarNumber(value: unknown): string {
  const digits = normalizeAadhaarNumber(value);
  return digits.length === 12 ? `XXXX XXXX ${digits.slice(8)}` : "";
}

function hasValidVerhoeffChecksum(digits: string): boolean {
  let checksum = 0;

  [...digits].reverse().forEach((digit, index) => {
    const permuted = permutationTable[index % 8]![Number(digit)]!;
    checksum = multiplicationTable[checksum]![permuted]!;
  });

  return checksum === 0;
}

export function isValidAadhaarNumber(value: unknown): boolean {
  const digits = normalizeAadhaarNumber(value);

  // UIDAI never issues a number starting with 0 or 1.
  if (!/^[2-9]\d{11}$/.test(digits)) return false;

  return hasValidVerhoeffChecksum(digits);
}
