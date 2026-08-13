/**
 * Turns any portal table into a spreadsheet or a PDF.
 *
 * Every list in the portal is paginated and filtered on the server, so an
 * export built in the browser could only ever contain the page the customer
 * happened to be looking at. These writers take the full filtered result set
 * instead, which is the only reading of "export this table" that is not
 * quietly wrong.
 *
 * The two formats deliberately share one column definition. A spreadsheet the
 * customer sorts and a PDF they email to a supplier disagreeing about which
 * columns exist would be worse than having only one of them.
 */
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/** ExcelJS wants ARGB without the "#". Matches the rate card workbook. */
const BRAND = "FF0D1282";
const INK = "FF0F172A";
const MUTED = "FF64748B";
const HEADER_FILL = "FFE2E8F0";
const ZEBRA = "FFF8FAFC";

export type ExportColumn<Row> = {
  header: string;
  /**
   * The cell value. Numbers and dates stay typed so Excel can sum and sort
   * them; anything else becomes text. Returning null writes an empty cell
   * rather than the string "null".
   */
  value: (row: Row) => string | number | Date | null;
  /** Spreadsheet column width in characters. Also weights the PDF column. */
  width?: number;
};

export type TableExportInput<Row> = {
  /** Sheet name and PDF heading. Keep it short — Excel caps sheet names at 31. */
  title: string;
  columns: Array<ExportColumn<Row>>;
  rows: Row[];
  /**
   * The filters that produced these rows, printed under the heading so a saved
   * file still says what it is a month later.
   */
  appliedFilters?: Array<{ label: string; value: string }>;
  /** Shown in the footer, so an exported file can be traced to an account. */
  accountLabel?: string;
};

const DEFAULT_WIDTH = 18;

function cellText(value: string | number | Date | null) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      timeZone: "Asia/Kolkata"
    }).format(value);
  }
  return String(value);
}

function exportedAtLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Kolkata"
  }).format(new Date());
}

/**
 * A flat sheet with exactly one header row.
 *
 * No merged title banner, no decorated layout: Excel's own filter, sort and
 * pivot tools only work on a plain table, and a customer exporting to a
 * spreadsheet wants to use them. The provenance goes in the sheet's document
 * properties and a frozen header instead of eating the first five rows.
 */
export async function buildTableWorkbook<Row>(input: TableExportInput<Row>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Swiftline";
  workbook.created = new Date();
  // Excel rejects these characters in a sheet name and silently truncates at 31.
  const sheet = workbook.addWorksheet(input.title.replace(/[*?:\\/[\]]/g, " ").slice(0, 31));

  sheet.columns = input.columns.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width ?? DEFAULT_WIDTH
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: INK } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle" };
  });
  headerRow.commit();

  input.rows.forEach((row, index) => {
    const added = sheet.addRow(input.columns.map((column) => {
      const value = column.value(row);
      return value === null || value === undefined ? "" : value;
    }));
    if (index % 2 === 1) {
      added.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      });
    }
  });

  // Freeze the header and turn on autofilter so a long export stays usable.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (input.rows.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: input.columns.length }
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * The same table as a landscape PDF.
 *
 * Columns are laid out proportionally to their spreadsheet widths, so one
 * definition drives both formats. Values that do not fit are clipped rather
 * than wrapped: a row that stays one line keeps the grid readable, and anyone
 * who needs the untruncated value wants the spreadsheet.
 */
export function buildTablePdf<Row>(input: TableExportInput<Row>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // bufferPages keeps every page open until `end()`, which is what lets the
    // footer below stamp "page N of M" once the total is finally known.
    const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    const left = document.page.margins.left;
    const usableWidth = document.page.width - left - document.page.margins.right;
    const totalWeight = input.columns.reduce((sum, column) => sum + (column.width ?? DEFAULT_WIDTH), 0);
    // Column and its drawn width together, so the two loops below never index
    // one array with the other's position.
    const layout = input.columns.map((column) => ({
      column,
      width: ((column.width ?? DEFAULT_WIDTH) / totalWeight) * usableWidth
    }));

    const ROW_HEIGHT = 18;
    const HEADER_HEIGHT = 20;

    /**
     * Draws one row of cells and returns the cursor to a known place.
     *
     * pdfkit advances `document.y` on every `text()` call, so writing a row
     * cell by cell would move the cursor once per column. Every cell is drawn
     * against a captured top instead, and the cursor is set explicitly
     * afterwards — without this a six-column table paginates six times too fast.
     */
    function drawCells(values: string[], top: number, height: number) {
      let x = left;
      layout.forEach(({ width }, index) => {
        document.text(values[index] ?? "", x + 4, top + (height - 10) / 2, {
          width: width - 8, height: 12, ellipsis: true, lineBreak: false
        });
        x += width;
      });
      document.y = top + height;
    }

    function drawHeader() {
      const top = document.y;
      document.rect(left, top, usableWidth, HEADER_HEIGHT).fill("#E2E8F0");
      document.fillColor("#0F172A").fontSize(8).font("Helvetica-Bold");
      drawCells(layout.map(({ column }) => column.header.toUpperCase()), top, HEADER_HEIGHT);
      document.font("Helvetica");
    }

    // Title block, printed once. The filters travel with the file so a PDF
    // forwarded to someone else still says what it was filtered to.
    document.fillColor("#0D1282").fontSize(15).font("Helvetica-Bold").text(input.title, left, document.y);
    document.moveDown(0.2);
    document.fillColor("#64748B").fontSize(8).font("Helvetica");
    const subtitle = [
      input.accountLabel ? `Account: ${input.accountLabel}` : "",
      `Exported ${exportedAtLabel()} IST`,
      `${input.rows.length} row${input.rows.length === 1 ? "" : "s"}`,
      ...(input.appliedFilters ?? []).map((filter) => `${filter.label}: ${filter.value}`)
    ].filter(Boolean).join("   ·   ");
    document.text(subtitle, { width: usableWidth });
    document.moveDown(0.6);

    drawHeader();

    if (!input.rows.length) {
      document.fillColor("#64748B").fontSize(9)
        .text("No rows matched the filters applied to this export.", left, document.y + 10, { width: usableWidth });
    }

    input.rows.forEach((row, rowIndex) => {
      // A new page needs its header repeated, or the columns below the fold
      // are unlabelled.
      if (document.y + ROW_HEIGHT > document.page.height - document.page.margins.bottom - 16) {
        document.addPage();
        drawHeader();
      }

      const top = document.y;
      if (rowIndex % 2 === 1) {
        document.rect(left, top, usableWidth, ROW_HEIGHT).fill("#F8FAFC");
      }

      document.fillColor("#0F172A").fontSize(8);
      drawCells(layout.map(({ column }) => cellText(column.value(row))), top, ROW_HEIGHT);
    });

    // Page numbers, added after layout so the total is known. The footer sits
    // inside the bottom margin, and pdfkit starts a new page for anything drawn
    // past it — so the margin is dropped for the stamp and put back after,
    // otherwise every export gains a trailing blank page.
    const range = document.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      document.switchToPage(page);
      const bottom = document.page.margins.bottom;
      document.page.margins.bottom = 0;
      document.fillColor("#94A3B8").fontSize(7).font("Helvetica").text(
        `Swiftline · page ${page - range.start + 1} of ${range.count}`,
        left,
        document.page.height - bottom + 8,
        { width: usableWidth, align: "right", lineBreak: false }
      );
      document.page.margins.bottom = bottom;
    }

    document.end();
  });
}

/** Content type and file name for a finished export. */
export function exportFileMeta(title: string, format: "xlsx" | "pdf") {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    fileName: `swiftline-${slug}-${stamp}.${format}`,
    contentType: format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf"
  };
}
