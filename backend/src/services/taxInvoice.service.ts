import { TaxInvoiceCounter } from "../models/taxInvoiceCounter.model.js";
import type { ITaxInvoiceBox, ITaxInvoiceTaxSummary } from "../models/taxInvoice.model.js";

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

export async function getNextTaxInvoiceNumber() {
  const counter = await TaxInvoiceCounter.findOneAndUpdate(
    { counterType: "TAX_INVOICE" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).exec();

  return `DAT${String(counter.seq).padStart(6, "0")}`;
}

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

export function computeTaxInvoiceAmounts(boxes: ITaxInvoiceBox[], taxSummary: ITaxInvoiceTaxSummary[]) {
  let subTotalMinor = 0;

  const computedBoxes = boxes.map((box, boxIndex) => ({
    ...box,
    boxNumber: box.boxNumber || String(boxIndex + 1),
    items: box.items.map((item) => {
      const quantity = Math.max(0, Math.trunc(Number(item.quantity) || 0));
      const unitRateMinor = Math.max(0, Math.trunc(Number(item.unitRateMinor) || 0));
      const amountMinor = quantity * unitRateMinor;
      subTotalMinor += amountMinor;

      return {
        ...item,
        quantity,
        unitRateMinor,
        amountMinor
      };
    })
  }));

  const computedTaxSummary = taxSummary.map((row) => {
    const taxableValueMinor = Math.max(0, Math.trunc(Number(row.taxableValueMinor) || 0));
    const gstRatePercent = Math.max(0, Number(row.gstRatePercent) || 0);
    const taxAmountMinor = Math.round(taxableValueMinor * gstRatePercent / 100);

    return {
      hsnSac: row.hsnSac,
      gstType: row.gstType || "IGST",
      taxableValueMinor,
      gstRatePercent,
      igstAmountMinor: taxAmountMinor,
      totalTaxAmountMinor: taxAmountMinor
    };
  });
  const totalTaxAmountMinor = computedTaxSummary.reduce((total, row) => total + row.totalTaxAmountMinor, 0);

  return {
    boxes: computedBoxes,
    taxSummary: computedTaxSummary,
    subTotalMinor,
    totalTaxAmountMinor,
    totalAmountMinor: subTotalMinor + totalTaxAmountMinor
  };
}
