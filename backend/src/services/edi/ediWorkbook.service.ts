import ExcelJS from "exceljs";
import type { ManifestDocumentParcelRow } from "../../types/manifestDocument.js";
import { EDI_COLUMNS, EDI_HEADERS, type EdiColumn, type EdiContext } from "./ediColumns.js";

// The customs EDI is a single flat sheet, headers on row 1, one row per parcel. It is
// written as .xlsx (via ExcelJS) so it can carry the requested styling: 8pt font, bold
// headers, upper-cased content, and readable column widths. The writer is column-
// agnostic- it walks EDI_COLUMNS and never needs to know what a column is.

const AADHAAR_COLUMN = EDI_COLUMNS.findIndex((column) => column.header === "GSTINNumber");
const HEADER_HEIGHT = 20;
const ROW_HEIGHT = 17;
const FONT_SIZE = 8;

// Content is upper-cased except for columns explicitly marked preserveCase (the
// title-cased state, the "Aadhaar Number" label). Numbers pass straight through.
function cellValue(column: EdiColumn, row: ManifestDocumentParcelRow, ctx: EdiContext): string | number | null {
  const value = column.value(row, ctx);
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "string") return column.preserveCase ? value : value.toUpperCase();
  return value;
}

/** Builds the EDI .xlsx as a Buffer from the shared per-parcel rows. */
export async function buildEdiWorkbookBuffer(rows: ManifestDocumentParcelRow[], ctx: EdiContext): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Swiftline Portal";
  const worksheet = workbook.addWorksheet("Sheet1");

  const headerRow = worksheet.addRow([...EDI_HEADERS]);
  headerRow.height = HEADER_HEIGHT;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: FONT_SIZE };
    cell.alignment = { vertical: "middle" };
  });

  for (const row of rows) {
    const dataRow = worksheet.addRow(EDI_COLUMNS.map((column) => cellValue(column, row, ctx)));
    dataRow.height = ROW_HEIGHT;
    dataRow.eachCell((cell) => {
      cell.font = { size: FONT_SIZE };
      cell.alignment = { vertical: "middle" };
    });
    // Show the 12-digit Aadhaar in full rather than in scientific notation.
    if (AADHAAR_COLUMN >= 0) {
      const aadhaarCell = dataRow.getCell(AADHAAR_COLUMN + 1);
      if (typeof aadhaarCell.value === "number") aadhaarCell.numFmt = "0";
    }
  }

  // Size every column to its widest value so all content is visible on open.
  EDI_COLUMNS.forEach((column, index) => {
    const widest = rows.reduce((max, row) => {
      const value = cellValue(column, row, ctx);
      return Math.max(max, value === null ? 0 : String(value).length);
    }, column.header.length);
    worksheet.getColumn(index + 1).width = Math.min(60, Math.max(10, widest + 2));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
