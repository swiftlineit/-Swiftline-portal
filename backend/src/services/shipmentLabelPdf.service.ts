import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";

const A6_WIDTH = 283.46;
const A6_HEIGHT = 425.2;
const PAGE_MARGIN = 10;

export interface ShipmentLabelData {
  swiftlineTrackingNumber: string;
  parcelNumber: string;
  parcelIndex: number;
  parcelCount: number;
  weightKg: number;
  serviceCode: string;
  shipmentReference: string;
  customerReference?: string;
  generatedAt: Date;
  consignee: {
    name: string;
    contactName?: string;
    addressLines: string[];
    postcode: string;
    countryCode: string;
    countryName: string;
  };
  sender: {
    name: string;
    branchCode: string;
    addressLines: string[];
    phone?: string;
  };
}

function collectPdf(render: (document: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: [A6_WIDTH, A6_HEIGHT],
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

async function barcode(value: string) {
  return bwipjs.toBuffer({
    bcid: "code128",
    text: value,
    scale: 5,
    height: 12,
    includetext: false,
    backgroundcolor: "FFFFFF",
    barcolor: "000000",
    paddingwidth: 0,
    paddingheight: 0
  });
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "Not provided";
}

function fittedFontSize(value: string, large: number, medium: number, small: number) {
  if (value.length > 54) return small;
  if (value.length > 32) return medium;
  return large;
}

function dateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replace(",", "");
}

// export async function renderSwiftlineLabelPdf(data: ShipmentLabelData) {
//   const barcodeImage = await barcode(data.parcelNumber);
//   return collectPdf((document) => {
//     const width = A6_WIDTH - PAGE_MARGIN * 2;
//     document.rect(PAGE_MARGIN, PAGE_MARGIN, width, A6_HEIGHT - PAGE_MARGIN * 2).lineWidth(1.5).stroke("#0b1f46");
//     const swiftlineHeader = "SWIFTLINE CARGO AND EXPRESS";
//     document.fillColor("#0b1f46").font("Helvetica-Bold")
//       .fontSize(fittedFontSize(swiftlineHeader, 16, 14, 12))
//       .text(swiftlineHeader, 16, 25, { width: width - 12, align: "center", lineBreak: false });
//     document.moveTo(PAGE_MARGIN, 58).lineTo(A6_WIDTH - PAGE_MARGIN, 58).lineWidth(2).stroke("#0b1f46");

//     document.fillColor("#44546f").font("Helvetica-Bold").fontSize(7).text("TRACKING NUMBER", 16, 66);
//     document.fillColor("#000000").font("Helvetica-Bold").fontSize(15).text(data.parcelNumber, 16, 77, { width: width - 12 });
//     document.image(barcodeImage, 18, 101, { fit: [width - 16, 62], align: "center" });
//     document.font("Helvetica-Bold").fontSize(8).text(data.parcelNumber, 16, 165, { width: width - 12, align: "center" });

//     document.moveTo(PAGE_MARGIN, 180).lineTo(A6_WIDTH - PAGE_MARGIN, 180).lineWidth(1).stroke("#0b1f46");
//     document.fillColor("#44546f").font("Helvetica-Bold").fontSize(7).text("SERVICE", 16, 189);
//     document.fillColor("#000000").font("Helvetica-Bold").fontSize(12).text("SWIFTLINE", 16, 200);
//     document.fillColor("#44546f").font("Helvetica-Bold").fontSize(7).text("ORIGIN", 155, 189);
//     document.fillColor("#000000").font("Helvetica-Bold").fontSize(12).text(text(data.sender.branchCode), 155, 200);

//     document.moveTo(PAGE_MARGIN, 222).lineTo(A6_WIDTH - PAGE_MARGIN, 222).stroke("#0b1f46");
//     const consigneeName = text(data.consignee.name);
//     document.fillColor("#44546f").font("Helvetica-Bold").fontSize(7).text("SHIP TO", 16, 231);
//     document.fillColor("#000000").font("Helvetica-Bold")
//       .fontSize(fittedFontSize(consigneeName, 12, 10, 8.5))
//       .text(consigneeName, 16, 242, { width: width - 12, height: 21, ellipsis: true, lineGap: 1 });
//     const consigneeContact = data.consignee.contactName?.trim();
//     if (consigneeContact) {
//       document.font("Helvetica-Bold").fontSize(8.5).text(`Contact: ${consigneeContact}`, 16, 266, {
//         width: width - 12,
//         height: 11,
//         ellipsis: true
//       });
//     }
//     document.font("Helvetica").fontSize(9).text(
//       [...data.consignee.addressLines, data.consignee.postcode, data.consignee.countryName].filter(Boolean).join(", "),
//       16,
//       consigneeContact ? 281 : 267,
//       { width: width - 12, height: consigneeContact ? 23 : 37, ellipsis: true, lineGap: 1 }
//     );

//     document.moveTo(PAGE_MARGIN, 310).lineTo(A6_WIDTH - PAGE_MARGIN, 310).stroke("#0b1f46");
//     const columnWidth = width / 3;
//     for (let index = 1; index < 3; index += 1) {
//       document.moveTo(PAGE_MARGIN + columnWidth * index, 310).lineTo(PAGE_MARGIN + columnWidth * index, 374).stroke("#0b1f46");
//     }
//     const cells = [
//       ["PARCEL", `${data.parcelIndex + 1} OF ${data.parcelCount}`],
//       ["WEIGHT", `${data.weightKg.toFixed(2)} KG`],
//       ["REFERENCE", text(data.customerReference || data.shipmentReference)]
//     ];
//     cells.forEach(([label, value], index) => {
//       const x = PAGE_MARGIN + columnWidth * index;
//       document.fillColor("#44546f").font("Helvetica-Bold").fontSize(7).text(label ?? "", x + 5, 320, { width: columnWidth - 10, align: "center" });
//       document.fillColor("#000000").font("Helvetica-Bold").fontSize(index === 2 ? 8 : 11).text(value ?? "", x + 5, 342, { width: columnWidth - 10, align: "center" });
//     });
//     document.moveTo(PAGE_MARGIN, 374).lineTo(A6_WIDTH - PAGE_MARGIN, 374).stroke("#0b1f46");
//     document.fillColor("#44546f").font("Helvetica").fontSize(7).text(
//       `Internal label | ${dateTime(data.generatedAt)} | Generated by Swiftline Portal`,
//       16,
//       389,
//       { width: width - 12, align: "center" }
//     );
//   });
// }

export async function renderSwiftlineLabelPdf(data: ShipmentLabelData) {
  const barcodeImage = await barcode(data.parcelNumber);

  return collectPdf((document) => {
    const width = A6_WIDTH - PAGE_MARGIN * 2;

    document
      .rect(
        PAGE_MARGIN,
        PAGE_MARGIN,
        width,
        A6_HEIGHT - PAGE_MARGIN * 2
      )
      .lineWidth(1.5)
      .stroke("#0b1f46");

    // Keep the internal label limited to the identifiers needed for scanning.
    document
      .fillColor("#44546f")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("PARCEL BARCODE", 16, 32, { width: width - 12, align: "center" });

    document.image(barcodeImage, 18, 58, {
      fit: [width - 16, 100],
      align: "center"
    });

    document
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(data.parcelNumber, 16, 173, { width: width - 12, align: "center" });

    document
      .moveTo(PAGE_MARGIN, 210)
      .lineTo(A6_WIDTH - PAGE_MARGIN, 210)
      .stroke("#0b1f46");

    document
      .fillColor("#44546f")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("SHIPMENT REFERENCE", 16, 232, { width: width - 12, align: "center" });

    document
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .fontSize(fittedFontSize(data.swiftlineTrackingNumber, 18, 15, 12))
      .text(data.swiftlineTrackingNumber, 16, 248, { width: width - 12, align: "center" });

    document
      .fillColor("#44546f")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("PIECE", 16, 300, { width: width - 12, align: "center" });

    document
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .fontSize(18)
      .text(`${data.parcelIndex + 1} OF ${data.parcelCount}`, 16, 316, { width: width - 12, align: "center" });
  });
}

export async function renderSimulatedDpdLabelPdf(data: ShipmentLabelData) {
  const barcodeImage = await barcode(data.parcelNumber);
  return collectPdf((document) => {
    const width = A6_WIDTH - PAGE_MARGIN * 2;
    document.rect(PAGE_MARGIN, PAGE_MARGIN, width, A6_HEIGHT - PAGE_MARGIN * 2).lineWidth(1.5).stroke("#000000");
    document.rect(PAGE_MARGIN, PAGE_MARGIN, width, 24).fill("#d71920");
    document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13).text("DPD TEST LABEL", 16, 16, { width: width - 12, align: "center" });

    const consigneeName = text(data.consignee.name).toUpperCase();
    const consigneeContact = data.consignee.contactName?.trim().toUpperCase();
    document.fillColor("#000000").font("Helvetica-Bold")
      .fontSize(fittedFontSize(consigneeName, 10.5, 9, 7.5))
      .text(consigneeName, 16, 43, { width: 163, height: 20, ellipsis: true, lineGap: 1 });
    if (consigneeContact) {
      document.font("Helvetica-Bold").fontSize(7.5).text(`CONTACT  ${consigneeContact}`, 16, 67, {
        width: 163,
        height: 10,
        ellipsis: true
      });
    }
    document.font("Helvetica").fontSize(8.5).text(
      [...data.consignee.addressLines, data.consignee.postcode, data.consignee.countryName].filter(Boolean).join("\n").toUpperCase(),
      16,
      consigneeContact ? 81 : 69,
      { width: 163, height: consigneeContact ? 41 : 53, ellipsis: true, lineGap: 1 }
    );
    document.moveTo(187, 34).lineTo(187, 128).stroke("#000000");
    document.font("Helvetica-Bold").fontSize(7).text("PACKAGES", 195, 47);
    document.fontSize(13).text(`${data.parcelIndex + 1} of ${data.parcelCount}`, 195, 58);
    document.fontSize(7).text("TOTAL WEIGHT", 195, 82);
    document.fontSize(13).text(`${data.weightKg.toFixed(2)} kg`, 195, 93);

    document.moveTo(PAGE_MARGIN, 128).lineTo(A6_WIDTH - PAGE_MARGIN, 128).stroke("#000000");
    document.font("Helvetica-Bold").fontSize(7).text("CONSIGNMENT", 16, 137);
    document.fontSize(fittedFontSize(data.parcelNumber, 8.5, 7.5, 6.5))
      .text(data.parcelNumber, 16, 148, { width: 120, height: 24, ellipsis: true, lineGap: 1 });
    document.fontSize(7).text("REFERENCE", 16, 177);
    document.fontSize(8.5).text(text(data.customerReference || data.shipmentReference), 16, 188, { width: 120, height: 17, ellipsis: true });
    document.moveTo(145, 128).lineTo(145, 213).stroke("#000000");
    document.fontSize(7).text("SENDER", 153, 136);
    document.font("Helvetica").fontSize(7.5).text(
      [data.sender.name, ...data.sender.addressLines, data.sender.phone].filter(Boolean).join("\n").toUpperCase(),
      153,
      147,
      { width: 112, height: 59, ellipsis: true, lineGap: 1 }
    );

    document.moveTo(PAGE_MARGIN, 213).lineTo(A6_WIDTH - PAGE_MARGIN, 213).lineWidth(2).stroke("#000000");
    document.font("Helvetica").fontSize(10).text(data.parcelNumber.slice(-14), 16, 220);
    document.font("Helvetica-Bold").fontSize(11).text(text(data.serviceCode).toUpperCase(), 168, 220, { width: 98, align: "right" });
    const countryCode = data.consignee.countryCode.toUpperCase();
    document.font("Helvetica-Bold").fontSize(27).text(
      `${countryCode}-${data.consignee.postcode.toUpperCase()}`,
      16,
      245,
      { width: width - 12, align: "center" }
    );
    document.font("Helvetica").fontSize(9).text(`812-${countryCode} - ${data.consignee.postcode.toUpperCase()}`, 16, 279, { width: width - 12, align: "center" });
    document.fontSize(7).text(`${dateTime(data.generatedAt)} SIMULATED`, 16, 294, { width: width - 12, align: "center" });
    document.image(barcodeImage, 20, 310, { fit: [width - 20, 65], align: "center" });
    document.font("Helvetica-Bold").fontSize(7.5).text(data.parcelNumber, 16, 379, { width: width - 12, align: "center" });
    document.rect(PAGE_MARGIN, 397, width, 18).fill("#d71920");
    document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text("TEST - NOT FOR CARRIAGE", 16, 402, { width: width - 12, align: "center" });
  });
}
