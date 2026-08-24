import { Readable } from "node:stream";
import ExcelJS from "exceljs";

/**
 * Reads a Swiftline rate-list workbook into weights and per-zone rates.
 *
 * A rate list is not a table of records. It is a grid: one column of weights
 * down the left, and a handful of "zone" columns to the right, each headed by a
 * stack of country names that share that column's pricing. Twelve countries can
 * therefore be priced by one column of thirty numbers.
 *
 * This module only reads the grid. It deliberately knows nothing about country
 * names beyond the text in the cells, because matching those names to ISO codes
 * needs the 218-country catalogue that ships with the frontend, and duplicating
 * that list on the server is how two lists start disagreeing. The operator
 * reviews the matches and the commit endpoint receives resolved codes.
 *
 * Everything is located by anchor rather than by fixed address. Rate lists come
 * from a letterhead template whose height changes, so `B4` is a fact about one
 * file, not about the format.
 */

export const rateCardImportLimits = {
  maxBytes: 5 * 1024 * 1024,
  /** Rows and columns scanned while looking for the weight column. */
  searchRows: 25,
  searchColumns: 15,
  maxZones: 40,
  maxWeightRows: 200,
  maxSlabs: 4000
} as const;

export type RateCardImportZone = {
  /** 1-based worksheet column, quoted in messages so a person can find it. */
  column: number;
  /** Country names exactly as the workbook spells them. */
  rawNames: string[];
  /** Parallel to `weights`; null where the workbook left the cell blank. */
  rates: (number | null)[];
};

export type RateCardImportParse = {
  weights: number[];
  zones: RateCardImportZone[];
};

/** A workbook this parser cannot read. Always the operator's to fix. */
export class RateCardImportError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "RateCardImportError";
  }
}

/** Flattens the shapes ExcelJS uses for formulas, rich text and hyperlinks. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value && value.result !== undefined) return String(value.result).trim();
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    return "";
  }
  return String(value).trim();
}

/**
 * A cell read as a number, or null.
 *
 * Text cells are parsed too: a rate list exported from another system often
 * carries its numbers as strings, and rejecting those would be pedantry.
 * Anything with no digits in it stays null.
 */
function cellNumber(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const text = cellText(value).replace(/[,\s]/g, "");
  if (!text || !/^-?\d*\.?\d+$/.test(text)) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadWorksheet(contents: Buffer, extension: ".csv" | ".xlsx" | ".xls") {
  const workbook = new ExcelJS.Workbook();

  if (extension === ".csv") {
    await workbook.csv.read(Readable.from(contents));
  } else {
    await workbook.xlsx.load(contents as unknown as ArrayBuffer);
  }

  return workbook.worksheets[0] ?? null;
}

/** The cell reading "Weight", which fixes both the weight column and the header row. */
function findWeightAnchor(worksheet: ExcelJS.Worksheet) {
  const lastRow = Math.min(worksheet.rowCount, rateCardImportLimits.searchRows);
  const lastColumn = Math.min(worksheet.columnCount, rateCardImportLimits.searchColumns);

  for (let row = 1; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const text = cellText(worksheet.getRow(row).getCell(column).value).toLowerCase();
      if (text === "weight" || text === "weight (kg)" || text === "weight kg") {
        return { row, column };
      }
    }
  }

  return null;
}

export async function parseRateCardWorkbook(
  contents: Buffer,
  extension: ".csv" | ".xlsx" | ".xls"
): Promise<RateCardImportParse> {
  const worksheet = await loadWorksheet(contents, extension);
  if (!worksheet) throw new RateCardImportError("The file does not contain a worksheet.");

  const anchor = findWeightAnchor(worksheet);
  if (!anchor) {
    throw new RateCardImportError(
      "Could not find a \"Weight\" column. The first sheet must have a column headed Weight, with the zone columns to its right."
    );
  }

  // The first row below the anchor whose weight cell holds a number. Everything
  // between the two is the header block, however many rows of country names the
  // tallest zone happens to need.
  let firstDataRow = 0;
  for (let row = anchor.row + 1; row <= worksheet.rowCount; row += 1) {
    const weight = cellNumber(worksheet.getRow(row).getCell(anchor.column).value);
    if (weight !== null && weight > 0) {
      firstDataRow = row;
      break;
    }
  }

  if (!firstDataRow) {
    throw new RateCardImportError("The Weight column has no numeric rows beneath it, so there are no rates to read.");
  }

  const zoneColumns: number[] = [];
  const anchorRow = worksheet.getRow(anchor.row);
  for (let column = anchor.column + 1; column <= worksheet.columnCount; column += 1) {
    if (cellText(anchorRow.getCell(column).value)) zoneColumns.push(column);
  }

  if (!zoneColumns.length) {
    throw new RateCardImportError("No zone columns were found to the right of the Weight column.");
  }
  if (zoneColumns.length > rateCardImportLimits.maxZones) {
    throw new RateCardImportError(`This file has ${zoneColumns.length} zone columns, more than the ${rateCardImportLimits.maxZones} supported.`);
  }

  // Weights run until they stop: the row after the last rate is where the terms
  // and conditions begin, and those must not be read as rates.
  const weights: number[] = [];
  const dataRows: number[] = [];
  for (let row = firstDataRow; row <= worksheet.rowCount; row += 1) {
    const weight = cellNumber(worksheet.getRow(row).getCell(anchor.column).value);
    if (weight === null) break;

    if (weight <= 0) {
      throw new RateCardImportError(`Row ${row} has a weight of ${weight}. Weights must be greater than zero.`);
    }

    const lastWeight = weights[weights.length - 1];
    if (lastWeight !== undefined && weight <= lastWeight) {
      throw new RateCardImportError(
        `Row ${row} has a weight of ${weight}, which does not come after ${lastWeight}. Weights must increase down the column.`
      );
    }
    if (weights.length >= rateCardImportLimits.maxWeightRows) {
      throw new RateCardImportError(`This file has more than ${rateCardImportLimits.maxWeightRows} weight rows.`);
    }

    weights.push(weight);
    dataRows.push(row);
  }

  const zones: RateCardImportZone[] = zoneColumns.map((column) => {
    const rawNames: string[] = [];
    for (let row = anchor.row; row < firstDataRow; row += 1) {
      const text = cellText(worksheet.getRow(row).getCell(column).value);
      if (text) rawNames.push(text);
    }

    const rates = dataRows.map((row) => {
      const rate = cellNumber(worksheet.getRow(row).getCell(column).value);
      if (rate === null) return null;
      if (rate < 0) {
        throw new RateCardImportError(`Row ${row}, column ${column} has a negative rate of ${rate}.`);
      }
      return rate;
    });

    return { column, rawNames, rates };
  });

  const named = zones.filter((zone) => zone.rawNames.length);
  if (!named.length) {
    throw new RateCardImportError("No country names were found above the rates. Each zone column needs at least one country name in its header.");
  }

  const totalSlabs = named.reduce(
    (running, zone) => running + zone.rawNames.length * zone.rates.filter((rate) => rate !== null).length,
    0
  );
  if (totalSlabs > rateCardImportLimits.maxSlabs) {
    throw new RateCardImportError(
      `This file would create ${totalSlabs} rate rows, more than the ${rateCardImportLimits.maxSlabs} allowed in one import.`
    );
  }

  return { weights, zones: named };
}

/**
 * Turns the workbook's discrete weights into the ranges the rate card stores.
 *
 * A rate list prices whole kilograms: the row for 5 is what a 5 kg parcel
 * costs. The rate card stores ranges, and pricing rounds chargeable weight up
 * to a whole kilogram before looking one up, so a row for weight *W* is the
 * price for anything landing on *W*. Ranges are therefore laid end to end -
 * `0-1`, `1.01-2`, `2.01-3` - which leaves no reachable gap, because no
 * chargeable weight is ever fractional.
 */
export function buildSlabs(weights: number[], rates: (number | null)[], maxBoxKg: number) {
  const slabs: Array<{ fromKg: number; toKg: number; chargesPerKg: number; maxBoxKg: number }> = [];

  weights.forEach((weight, index) => {
    const chargesPerKg = rates[index];
    // A blank cell means the zone does not price that weight. Writing it as
    // zero would quietly offer free freight.
    if (chargesPerKg === null || chargesPerKg === undefined) return;

    const previous = weights[index - 1] ?? 0;
    const fromKg = index === 0 ? 0 : Number((previous + 0.01).toFixed(2));

    slabs.push({ fromKg, toKg: weight, chargesPerKg, maxBoxKg });
  });

  return slabs;
}
