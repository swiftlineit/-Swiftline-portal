const numberWordsBelowTwenty = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];

const tensWords = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsBelowThousand(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;

  if (hundreds) parts.push(`${numberWordsBelowTwenty[hundreds] ?? ""} Hundred`);
  if (rest < 20 && rest > 0) parts.push(numberWordsBelowTwenty[rest] ?? "");
  if (rest >= 20) {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    parts.push(ones ? `${tensWords[tens] ?? ""} ${numberWordsBelowTwenty[ones] ?? ""}` : tensWords[tens] ?? "");
  }

  return parts.join(" ");
}

function integerToIndianWords(value: number): string {
  if (value === 0) return "Zero";

  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];

  if (crore) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${wordsBelowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${wordsBelowThousand(thousand)} Thousand`);
  if (rest) parts.push(wordsBelowThousand(rest));

  return parts.join(" ");
}

export function amountMinorToWords(amountMinor: number, currency: string) {
  const major = Math.floor(amountMinor / 100);
  const minor = amountMinor % 100;
  const currencyLabel = currency.toUpperCase() === "INR" ? "Rupees" : currency.toUpperCase();
  const minorLabel = currency.toUpperCase() === "INR" ? "Paise" : "Cents";
  const majorWords = `${integerToIndianWords(major)} ${currencyLabel}`;

  if (!minor) return `${majorWords} Only`;

  return `${majorWords} And ${integerToIndianWords(minor)} ${minorLabel} Only`;
}
