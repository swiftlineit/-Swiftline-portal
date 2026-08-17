import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";

// A6 (105 x 148 mm) — standard courier label stock.
const A6_WIDTH = 283.46;
const A6_HEIGHT = 425.2;
const PAGE_MARGIN = 8;
const CONTENT_LEFT = PAGE_MARGIN;
const CONTENT_RIGHT = A6_WIDTH - PAGE_MARGIN;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
// Every caption and value hangs off this inset, so the whole label reads as one
// left-aligned column rather than a stack of independently centred blocks.
const CELL_PADDING = 8;
const TEXT_LEFT = CONTENT_LEFT + CELL_PADDING;
const TEXT_WIDTH = CONTENT_WIDTH - CELL_PADDING * 2;

// The horizontal rules that divide the label into its squared sections.
const ROW_HEADER = PAGE_MARGIN;
const ROW_BARCODE = 62;
const ROW_GRID = 196;
const ROW_GRID_MID = 252;
const ROW_CONSIGNEE = 308;
const LABEL_BOTTOM = A6_HEIGHT - PAGE_MARGIN;

// The routing grid is three columns wide. Origin and piece stack in the first,
// destination and weight in the second; the third is one merged cell holding the
// service, which is why the middle rule stops short of it.
const GRID_COL_1 = CONTENT_LEFT + CONTENT_WIDTH * 0.30;
const GRID_COL_2 = CONTENT_LEFT + CONTENT_WIDTH * 0.70;

const INK = "#000000";

/** Printed on every label regardless of the booked service. */
const SERVICE_NAME = "EXPRESS WORLDWIDE";
const COMPANY_NAME = "SWIFTLINE CARGO ";
export interface ShipmentLabelData {
  parcelNumber: string;
  parcelIndex: number;
  parcelCount: number;
  weightKg: number;
  generatedAt: Date;
  /** The lodging station the shipment starts from. */
  origin: {
    stationCode: string;
    city: string;
  };
  /**
   * Where the shipment is going, as the route line prints it.
   *
   * Carried separately rather than read off the end of `consignee.addressLines`,
   * which is a street on a single-line address.
   */
  destination: {
    city: string;
    countryCode: string;
    countryName: string;
  };
  consignee: {
    name: string;
    contactName?: string;
    addressLines: string[];
    postcode: string;
    countryCode: string;
    countryName: string;
    email?: string;
  };
}

function collectPdf(
  render: (document: PDFKit.PDFDocument) => void,
  size: [number, number] = [A6_WIDTH, A6_HEIGHT]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size,
      margin: 0,
      info: { Creator: "Swiftline Portal", Producer: "Swiftline Portal" }
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    render(document);
    document.end();
  });
}

/** Pixel dimensions from a PNG's IHDR, so a fitted image's drawn height is known. */
function pngSize(buffer: Buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function barcode(value: string, options: { scale?: number; height?: number } = {}) {
  return bwipjs.toBuffer({
    bcid: "code128",
    text: value,
    // `scale` is the raster resolution, not the printed size — the PDF box
    // decides that. Rendering above the printed size and letting it downsample
    // is what keeps the bars crisp instead of soft-edged.
    scale: options.scale ?? 5,
    height: options.height ?? 12,
    includetext: false,
    backgroundcolor: "FFFFFF",
    barcolor: "000000",
    paddingwidth: 0,
    paddingheight: 0
  });
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * The SLC mark, pre-cropped and downsampled for label stock.
 *
 * Resolved once: the original brand asset carries ~56% transparent padding and
 * is measured in megabytes, which would be embedded into every parcel's PDF and
 * every booking email.
 */
const logoPath = path.resolve(process.cwd(), "assets", "swiftline-label-logo.png");

/** Largest size at or below `start` that fits `value` on one line. */
function fitOneLine(
  document: PDFKit.PDFDocument,
  value: string,
  width: number,
  start: number,
  minimum: number
) {
  let size = start;
  while (size > minimum && document.fontSize(size).widthOfString(value) > width) {
    size -= 0.5;
  }
  return size;
}

function caption(document: PDFKit.PDFDocument, value: string, x: number, y: number, width: number) {
  document
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(6)
    .text(value, x, y, { width, characterSpacing: 0.8, lineBreak: false });
}

function rule(document: PDFKit.PDFDocument, y: number, lineWidth = 1, right = CONTENT_RIGHT) {
  document.moveTo(CONTENT_LEFT, y).lineTo(right, y).lineWidth(lineWidth).stroke(INK);
}

/**
 * Largest size at or below `start` whose wrapped block fits `maxHeight`.
 *
 * Used where the value may legitimately need more than one line, so it is
 * measured as the block it becomes rather than as a single line — sizing on one
 * line would shrink a two-line value far smaller than it needs to be.
 */
function fitBlock(
  document: PDFKit.PDFDocument,
  value: string,
  width: number,
  maxHeight: number,
  start: number,
  minimum: number
) {
  let size = start;
  while (size > minimum && document.fontSize(size).heightOfString(value, { width }) > maxHeight) {
    size -= 0.5;
  }
  return size;
}

/** How much vertical room a wrapping grid value has before the next rule. */
const CELL_VALUE_HEIGHT = 30;

/**
 * A captioned value inside one grid cell, left-aligned to the cell's inset.
 *
 * `wrap` is for values that may legitimately need a second or third line — the
 * destination, whose town name is the one field with no length ceiling. The
 * codes and measurements never need it and stay on one line.
 */
function cell(
  document: PDFKit.PDFDocument,
  input: { label: string; value: string; left: number; width: number; top: number; wrap?: boolean }
) {
  caption(document, input.label, input.left, input.top, input.width);
  document.fillColor(INK).font("Helvetica-Bold");
  const size = input.wrap
    ? fitBlock(document, input.value, input.width, CELL_VALUE_HEIGHT, 15, 6)
    : fitOneLine(document, input.value, input.width, 15, 7);
  document
    .fontSize(size)
    .text(input.value, input.left, input.top + 13, {
      width: input.width,
      lineBreak: Boolean(input.wrap),
      ...(input.wrap ? { height: CELL_VALUE_HEIGHT, ellipsis: true } : {})
    });
}

/**
 * The Swiftline shipment label.
 *
 * Every parcel carries one. The barcode encodes the parcel number — the value
 * the warehouse scanners read — and the rest of the label is what a handler
 * needs to route the piece without looking it up: where it came from, where it
 * is going, how many pieces the shipment has, and who receives it.
 */
export async function renderSwiftlineLabelPdf(data: ShipmentLabelData) {
  // Rendered well above its printed size: an under-sampled barcode is what
  // scanners fail on. The 24mm height is chosen so a typical parcel number fills
  // the band rather than leaving dead space above the route rule.
  const barcodeImage = await barcode(data.parcelNumber, { scale: 8, height: 24 });

  return collectPdf((document) => {
    document.rect(CONTENT_LEFT, PAGE_MARGIN, CONTENT_WIDTH, LABEL_BOTTOM - PAGE_MARGIN)
      .lineWidth(1.5)
      .stroke(INK);

    // --- Header: SLC mark and the company it ships under -------------------
    if (fs.existsSync(logoPath)) {
      document.image(logoPath, TEXT_LEFT, ROW_HEADER + 11, { fit: [54, 22] });
    }
    const companyLeft = TEXT_LEFT + 62;
    const companyWidth = CONTENT_RIGHT - CELL_PADDING - companyLeft;
    document
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(fitOneLine(document, COMPANY_NAME, companyWidth, 13, 7))
      .text(COMPANY_NAME, companyLeft, ROW_HEADER + 17, { width: companyWidth, lineBreak: false });
    rule(document, ROW_BARCODE, 1.5);

    // --- Barcode and the tracking number it encodes ------------------------
    // `fit` preserves the barcode's aspect ratio, so its drawn height depends on
    // how long the parcel number is. Measuring it keeps the number tight under
    // the bars instead of floating below a variable gap.
    const barcodeTop = ROW_BARCODE + 9;
    const barcodeBox = ROW_GRID - barcodeTop - 32;
    const source = pngSize(barcodeImage);
    const barcodeHeight = Math.min(barcodeBox, (TEXT_WIDTH * source.height) / source.width);
    document.image(barcodeImage, TEXT_LEFT, barcodeTop, {
      fit: [TEXT_WIDTH, barcodeBox],
      align: "center"
    });
    document.font("Helvetica-Bold");
    document
      .fillColor(INK)
      .fontSize(fitOneLine(document, data.parcelNumber, TEXT_WIDTH, 20, 7))
      .text(data.parcelNumber, TEXT_LEFT, barcodeTop + barcodeHeight + 7, {
        width: TEXT_WIDTH,
        align: "center",
        lineBreak: false
      });
    rule(document, ROW_GRID, 1.5);

    // --- Routing grid: origin | destination | service ----------------------
    // The middle rule stops at the third column because the service cell is
    // merged across both rows.
    rule(document, ROW_GRID_MID, 1, GRID_COL_2);
    for (const x of [GRID_COL_1, GRID_COL_2]) {
      document.moveTo(x, ROW_GRID).lineTo(x, ROW_CONSIGNEE).lineWidth(1).stroke(INK);
    }

    const col1Width = GRID_COL_1 - CONTENT_LEFT - CELL_PADDING * 2;
    const col2Left = GRID_COL_1 + CELL_PADDING;
    const col2Width = GRID_COL_2 - GRID_COL_1 - CELL_PADDING * 2;

    // Uppercased here rather than trusted from the snapshot: these are the lines
    // a handler routes the piece on, and they must not change case with the source.
    const destination = [
      text(data.destination.city) || text(data.destination.countryName),
      text(data.destination.countryCode)
    ].filter(Boolean).join(", ").toUpperCase();
    const origin = (text(data.origin.stationCode) || text(data.origin.city) || "-").toUpperCase();

    cell(document, { label: "ORIGIN", value: origin, left: TEXT_LEFT, width: col1Width, top: ROW_GRID + 10 });
    cell(document, {
      label: "DESTINATION",
      value: destination || "-",
      left: col2Left,
      width: col2Width,
      top: ROW_GRID + 10,
      wrap: true
    });
    cell(document, {
      label: "PIECE",
      value: `${data.parcelIndex + 1} OF ${data.parcelCount}`,
      left: TEXT_LEFT,
      width: col1Width,
      top: ROW_GRID_MID + 10
    });
    cell(document, {
      label: "WEIGHT",
      value: `${data.weightKg.toFixed(2)} KG`,
      left: col2Left,
      width: col2Width,
      top: ROW_GRID_MID + 10
    });

    // Service fills the merged third column, so its caption and value are
    // centred against the whole cell rather than either row.
    const serviceLeft = GRID_COL_2 + CELL_PADDING;
    const serviceWidth = CONTENT_RIGHT - CELL_PADDING - serviceLeft;
    const serviceWords = SERVICE_NAME.split(" ");
    const serviceSize = Math.min(
      ...serviceWords.map((word) => fitOneLine(document.font("Helvetica-Bold"), word, serviceWidth, 13, 6))
    );
    const serviceTop = (ROW_GRID + ROW_CONSIGNEE) / 2 - (8 + serviceWords.length * (serviceSize + 1.5)) / 2;
    caption(document, "SERVICE", serviceLeft, serviceTop, serviceWidth);
    serviceWords.forEach((word, index) => {
      document
        .fillColor(INK)
        .font("Helvetica-Bold")
        .fontSize(serviceSize)
        .text(word, serviceLeft, serviceTop + 12 + index * (serviceSize + 1.5), {
          width: serviceWidth,
          lineBreak: false
        });
    });
    rule(document, ROW_CONSIGNEE, 1.5);

    // --- Consignee ---------------------------------------------------------
    caption(document, "CONSIGNEE", TEXT_LEFT, ROW_CONSIGNEE + 7, TEXT_WIDTH);
    // Wrapped over two lines rather than shrunk onto one: a trading name long
    // enough to overflow is also long enough that the truncated half stops
    // identifying the receiver.
    const name = text(data.consignee.name) || text(data.consignee.contactName);
    document
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(name, TEXT_LEFT, ROW_CONSIGNEE + 17, {
        // Two 11pt lines measure 26.18pt; anything less silently clips to one,
        // and anything past 39pt would let a third line run into the address.
        width: TEXT_WIDTH,
        height: 27,
        ellipsis: true
      });

    // One component per line, the way a delivery address is normally written.
    // Duplicates are dropped because the town often repeats across the street,
    // town and county fields on an imported address.
    const addressLines = [...new Set(data.consignee.addressLines.map(text).filter(Boolean))];
    document
      .font("Helvetica")
      .fontSize(8.5)
      .text(addressLines.join("\n"), TEXT_LEFT, ROW_CONSIGNEE + 44, {
        // Three 8.5pt lines measure 33.3pt — enough for street, town and county
        // without letting a fourth reach the postcode below.
        width: TEXT_WIDTH,
        height: 34,
        ellipsis: true,
        lineGap: 1
      });

    // Bold and on its own line: the postcode is what the delivery depot sorts on.
    const postcode = [text(data.consignee.postcode), text(data.consignee.countryCode)]
      .filter(Boolean)
      .join("  ");
    document
      .font("Helvetica-Bold")
      .fontSize(fitOneLine(document, postcode, TEXT_WIDTH, 14, 9))
      .text(postcode, TEXT_LEFT, ROW_CONSIGNEE + 80, { width: TEXT_WIDTH, lineBreak: false });

    const email = text(data.consignee.email);
    if (email) {
      document
        .font("Helvetica")
        .fontSize(fitOneLine(document, email, TEXT_WIDTH, 8.5, 6))
        .text(email, TEXT_LEFT, ROW_CONSIGNEE + 97, { width: TEXT_WIDTH, lineBreak: false });
    }
  });
}
