import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { ShipmentManifestCounter } from "../models/shipmentManifestCounter.model.js";
import type { IShipmentManifest, ShipmentManifestLineSnapshot } from "../models/shipmentManifest.model.js";
import type { ShipmentBookingSnapshot } from "./shipmentBookingSnapshot.service.js";

export class ShipmentManifestServiceError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
  }
}

export type ManifestHeaderInput = {
  destinationAgent: string;
  flightNumber: string;
  departureDate: string;
  mawbNumber: string;
  originIataCode: string;
  destinationIataCode: string;
  valueType: string;
};

export type ManifestLineInput = {
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId: mongoose.Types.ObjectId;
  snapshot: ShipmentBookingSnapshot;
  declaredValueMinor: number;
  bagNumber: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function compact(values: unknown[]) {
  return values.map(text).filter(Boolean);
}

function formatPersonAddress(value: unknown, includePhone = false) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const lines = compact([
    source.companyName,
    source.contactName,
    source.addressLine1,
    source.addressLine2,
    source.townOrCity,
    source.county,
    source.postcode,
    source.countryName || source.countryCode
  ]);
  const phone = `${text(source.mobileCountryCode)}${text(source.mobileNumber)}`;
  if (includePhone && phone) lines.push(`TEL-${phone}`);
  return lines.join("\n");
}

function formatConsignor(snapshot: ShipmentBookingSnapshot) {
  const account = snapshot.account as { company?: Record<string, unknown>; contact?: Record<string, unknown> };
  const company = account.company ?? {};
  const contact = account.contact ?? {};
  const contactName = compact([contact.title, contact.firstName, contact.lastName]).join(" ");
  return compact([
    company.companyName,
    contactName,
    company.registeredAddress,
    company.city,
    company.stateOrProvince || company.state,
    company.postalCode,
    company.addressCountry,
    `${text(contact.countryCode)}${text(contact.mobileNumber)}`
      ? `TEL-${text(contact.countryCode)}${text(contact.mobileNumber)}`
      : ""
  ]).join("\n");
}

export function formatManifestOrigin(senderValue: unknown) {
  const sender = senderValue && typeof senderValue === "object"
    ? senderValue as Record<string, unknown>
    : {};
  const address = sender.address && typeof sender.address === "object"
    ? sender.address as Record<string, unknown>
    : {};
  return compact([
    sender.name,
    address.address,
    address.city,
    address.stateOrProvince || address.state,
    address.postalCode,
    address.countryName || address.countryCode
  ]).join("\n");
}

export function buildManifestLine(input: ManifestLineInput): ShipmentManifestLineSnapshot {
  const descriptions = [...new Set(input.snapshot.parcels
    .map((parcel) => text(parcel.contentsDescription))
    .filter(Boolean))];

  return {
    shipmentDraftId: input.shipmentDraftId,
    dpdShipmentId: input.dpdShipmentId,
    consignmentNumber: input.snapshot.tracking.swiftlineTrackingNumber,
    pieces: input.snapshot.parcels.length,
    weightKg: Number(input.snapshot.parcels.reduce((total, parcel) => total + parcel.actualWeightKg, 0).toFixed(3)),
    consignor: { formatted: formatConsignor(input.snapshot) },
    consignee: { formatted: formatPersonAddress(input.snapshot.consignee, true) },
    description: descriptions.join(", ") || "Shipment contents",
    declaredValueMinor: input.declaredValueMinor,
    currency: "INR",
    bagNumber: input.bagNumber,
    serviceInfo: input.snapshot.service.type === "CARGO" ? "CARGO" : "EXP"
  };
}

export async function allocateShipmentManifestNumber(session?: mongoose.ClientSession) {
  const counter = await ShipmentManifestCounter.findOneAndUpdate(
    { _id: "shipment-manifest" },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: "after", session }
  ).exec();
  if (!counter) throw new ShipmentManifestServiceError("Manifest number could not be allocated.", 500);
  return `SLC-${String(counter.sequence).padStart(3, "0")}`;
}

export function serializeShipmentManifest(manifest: IShipmentManifest) {
  const header = manifest.headerSnapshot as Record<string, unknown>;
  return {
    id: String(manifest._id),
    manifestNumber: manifest.manifestNumber,
    businessAccountId: String(manifest.businessAccountId),
    branchId: String(manifest.branchId),
    shipmentDraftIds: manifest.shipmentDraftIds.map(String),
    destinationAgent: text(header.destinationAgent),
    flightNumber: text(header.flightNumber),
    departureDate: text(header.departureDate),
    mawbNumber: text(header.mawbNumber),
    originIataCode: text(header.originIataCode),
    destinationIataCode: text(header.destinationIataCode),
    totalPieces: manifest.totalPieces,
    totalWeightKg: manifest.totalWeightKg,
    totalBags: manifest.totalBags,
    shipmentCount: manifest.lineSnapshots.length,
    actorRole: manifest.actorRole,
    generatedAt: manifest.generatedAt
  };
}

const manifestColours = {
  border: "FF222222",
  text: "FF111111",
  labelFill: "FFF2F2F2",
  white: "FFFFFFFF"
};

const manifestBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: manifestColours.border } },
  left: { style: "thin", color: { argb: manifestColours.border } },
  bottom: { style: "thin", color: { argb: manifestColours.border } },
  right: { style: "thin", color: { argb: manifestColours.border } }
};

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function formatManifestDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function styleRange(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
  style: {
    font?: Partial<ExcelJS.Font>;
    fill?: ExcelJS.Fill;
    alignment?: Partial<ExcelJS.Alignment>;
    border?: Partial<ExcelJS.Borders>;
    numberFormat?: string;
  }
) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const cell = worksheet.getCell(row, column);
      if (style.font) cell.font = style.font;
      if (style.fill) cell.fill = style.fill;
      if (style.alignment) cell.alignment = style.alignment;
      if (style.border) cell.border = style.border;
      if (style.numberFormat) cell.numFmt = style.numberFormat;
    }
  }
}

function splitManifestLines(value: unknown, maximum = 8) {
  return text(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, maximum);
}

export async function buildShipmentManifestWorkbook(manifest: IShipmentManifest): Promise<Buffer> {
  const header = manifest.headerSnapshot as Record<string, unknown>;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Swiftline Portal";
  workbook.company = "Swiftline Cargo and Express Logistics";
  workbook.subject = `Courier manifest ${manifest.manifestNumber}`;
  workbook.created = manifest.generatedAt;

  const worksheet = workbook.addWorksheet("Manifest", {
    views: [{ state: "frozen", ySplit: 12, activeCell: "A13", showGridLines: false, zoomScale: 85 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printTitlesRow: "12:12",
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
    },
    properties: { defaultRowHeight: 20 }
  });

  worksheet.columns = [
    { key: "serial", width: 7 },
    { key: "consignment", width: 25 },
    { key: "pieces", width: 9 },
    { key: "weight", width: 13 },
    { key: "consignor", width: 32 },
    { key: "consignee", width: 36 },
    { key: "description", width: 32 },
    { key: "value", width: 14 },
    { key: "currency", width: 11 },
    { key: "bag", width: 12 },
    { key: "service", width: 14 }
  ];

  worksheet.mergeCells("A1:K1");
  worksheet.getCell("A1").value = "Courier Manifest";
  worksheet.getRow(1).height = 28;
  styleRange(worksheet, 1, 1, 1, 11, {
    font: { bold: true, size: 14, color: { argb: manifestColours.text } },
    fill: solidFill(manifestColours.white),
    alignment: { horizontal: "center", vertical: "middle" },
    border: manifestBorder
  });

  styleRange(worksheet, 2, 1, 10, 11, {
    font: { size: 10, color: { argb: manifestColours.text } },
    fill: solidFill(manifestColours.white),
    alignment: { vertical: "middle", horizontal: "left", wrapText: true },
    border: manifestBorder
  });
  for (let row = 2; row <= 10; row += 1) worksheet.getRow(row).height = 20;

  worksheet.getCell("E2").value = "FROM *";
  worksheet.getCell("F2").value = "TO *";
  const originLines = splitManifestLines(header.originAddress || header.originBranch);
  const destinationLines = splitManifestLines(header.destinationAgent);
  originLines.forEach((line, index) => { worksheet.getCell(3 + index, 5).value = line; });
  destinationLines.forEach((line, index) => { worksheet.getCell(3 + index, 6).value = line; });

  const manifestDetails: Array<[string, string | number]> = [
    ["Manifest Number", manifest.manifestNumber],
    ["FLIGHT NUMBER", text(header.flightNumber)],
    ["FLIGHT DEPARTURE DATE", formatManifestDate(text(header.departureDate))],
    ["MAWB NO. *", text(header.mawbNumber)],
    ["MAWB ORIGIN (IATA Code) *", text(header.originIataCode)],
    ["MAWB DESTINATION (IATA Code) *", text(header.destinationIataCode)],
    ["TOTAL BAGS *", manifest.totalBags],
    ["TOTAL WEIGHT (kg) *", manifest.totalWeightKg],
    ["VALUE TYPE (HV, LV, TS, Docs)", text(header.valueType)]
  ];
  manifestDetails.forEach(([label, value], index) => {
    const row = 2 + index;
    const labelCell = worksheet.getCell(row, 7);
    const valueCell = worksheet.getCell(row, 8);
    labelCell.value = label;
    valueCell.value = value;
    labelCell.font = { bold: true, size: 10, color: { argb: manifestColours.text } };
    labelCell.fill = solidFill(manifestColours.labelFill);
    valueCell.font = { bold: true, size: 10, color: { argb: manifestColours.text } };
  });
  for (let row = 2; row <= 10; row += 1) {
    const wrappedLineCount = Math.max(
      1,
      Math.ceil(text(worksheet.getCell(row, 5).value).length / 30),
      Math.ceil(text(worksheet.getCell(row, 6).value).length / 34),
      Math.ceil(text(worksheet.getCell(row, 7).value).length / 30),
      Math.ceil(text(worksheet.getCell(row, 8).value).length / 16)
    );
    worksheet.getRow(row).height = Math.max(20, Math.min(48, wrappedLineCount * 15));
  }
  worksheet.getCell("E2").font = { bold: true, size: 10, color: { argb: manifestColours.text } };
  worksheet.getCell("F2").font = { bold: true, size: 10, color: { argb: manifestColours.text } };
  if (originLines.length) worksheet.getCell("E3").font = { bold: true, size: 10, color: { argb: manifestColours.text } };
  if (destinationLines.length) worksheet.getCell("F3").font = { bold: true, size: 10, color: { argb: manifestColours.text } };
  worksheet.getCell("H9").numFmt = "0.000";

  worksheet.getRow(11).height = 10;

  const headings = ["S.No *", "Consignment No. *", "Pieces *", "Weight (kg)", "Consignor *", "Consignee *", "Description *", "Value *", "Currency *", "Bag No *", "Service Info"];
  const headingRow = worksheet.getRow(12);
  headingRow.values = headings;
  headingRow.height = 32;
  styleRange(worksheet, 12, 1, 12, 11, {
    font: { bold: true, size: 10, color: { argb: manifestColours.text } },
    fill: solidFill(manifestColours.white),
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: manifestBorder
  });

  manifest.lineSnapshots.forEach((line, index) => {
    const consignorLines = splitManifestLines(line.consignor.formatted, 10);
    const consigneeLines = splitManifestLines(line.consignee.formatted, 10);
    const blockSize = Math.max(7, consignorLines.length, consigneeLines.length);
    const firstRowNumber = worksheet.rowCount + 1;

    for (let offset = 0; offset < blockSize; offset += 1) {
      const row = worksheet.addRow([]);
      row.height = offset === 0 ? 26 : 18;
      if (offset === 0) {
        row.values = [
          index + 1,
          line.consignmentNumber,
          line.pieces,
          line.weightKg,
          consignorLines[0] ?? "",
          consigneeLines[0] ?? "",
          line.description,
          line.declaredValueMinor / 100,
          line.currency,
          line.bagNumber,
          line.serviceInfo
        ];
      } else {
        row.getCell(5).value = consignorLines[offset] ?? "";
        row.getCell(6).value = consigneeLines[offset] ?? "";
      }

      for (let column = 1; column <= 11; column += 1) {
        const cell = row.getCell(column);
        cell.font = { size: 10, color: { argb: manifestColours.text } };
        cell.fill = solidFill(manifestColours.white);
        cell.border = {
          top: { style: offset === 0 ? "medium" : "thin", color: { argb: manifestColours.border } },
          left: { style: "thin", color: { argb: manifestColours.border } },
          bottom: { style: offset === blockSize - 1 ? "medium" : "thin", color: { argb: manifestColours.border } },
          right: { style: "thin", color: { argb: manifestColours.border } }
        };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      }
    }

    worksheet.getCell(firstRowNumber, 2).font = { bold: true, size: 10, color: { argb: manifestColours.text } };
    worksheet.getCell(firstRowNumber, 4).numFmt = "0.000";
    worksheet.getCell(firstRowNumber, 8).numFmt = "#,##0.00";
  });

  const lastRow = Math.max(12, worksheet.rowCount);
  worksheet.pageSetup.printArea = `A1:K${lastRow}`;
  worksheet.headerFooter.oddFooter = "Swiftline Portal | Computer Generated Manifest | Page &P of &N";

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
