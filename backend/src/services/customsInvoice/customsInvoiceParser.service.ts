// Reads a Swiftline shipment invoice workbook back into shipment-form values.
//
// Two sources inside the one file:
//   "Invoice"       — the printed grid. Consignee, boxes and items are recovered
//                     by walking it, so those values are never stated twice.
//   "Shipment Data" — Field | Value pairs for what the printed sheet cannot carry
//                     machine-readably: CSB route, service, consignor, Aadhaar.
//
// Deliberately NOT all-or-nothing. Unlike a strict template import, a missing or
// malformed field never fails the upload: it is left blank and reported as a
// warning, because a blank field is obvious on the review form while a wrongly
// filled one is not. Only a file that is not a Swiftline invoice at all fails.

import ExcelJS from "exceljs";
import { isValidAadhaarNumber, normalizeAadhaarNumber } from "../aadhaarValidation.service.js";
import { normalizeCsbType, type CsbType } from "../csbType.service.js";
import { defaultParcelItemUnitType, isValidHsnCode } from "../parcelItems.service.js";
import {
  customsInvoiceSheetName,
  shipmentDataFields,
  shipmentDataSheetName,
  type ShipmentDataFieldKey
} from "./customsInvoiceSheet.js";

export class CustomsInvoiceParseError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues[0] ?? "The invoice could not be read.");
    this.name = "CustomsInvoiceParseError";
  }
}

export type ParsedInvoiceItem = {
  description: string;
  hsnCode: string;
  unitType: string;
  quantity: number;
  unitRate: number;
};

export type ParsedInvoiceParcel = {
  sequence: number;
  weightKg: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  items: ParsedInvoiceItem[];
};

export type ParsedCustomsInvoice = {
  invoiceNumber: string;
  shipmentReference: string;
  csbType: CsbType | null;
  serviceType: "COURIER" | "CARGO" | null;
  declarationNote: string;
  consignor: {
    contactName: string;
    companyName: string;
    email: string;
    mobileNumber: string;
    addressLine1: string;
    addressLine2: string;
    townOrCity: string;
    county: string;
    postcode: string;
    aadhaarNumber: string;
  };
  consignee: {
    contactName: string;
    companyName: string;
    email: string;
    mobileCountryCode: string;
    mobileNumber: string;
    addressLine1: string;
    addressLine2: string;
    townOrCity: string;
    county: string;
    postcode: string;
    countryCode: string;
    countryName: string;
  };
  parcels: ParsedInvoiceParcel[];
  /** Fields that were absent or unusable. Surfaced on the review form. */
  warnings: string[];
};

const indianPinPattern = /^[1-9]\d{5}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cellText(sheet: ExcelJS.Worksheet, row: number, column: number): string {
  const value = sheet.getCell(row, column).value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value) {
    return (value.richText as Array<{ text: string }>).map((part) => part.text).join("").trim();
  }
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
  return String(value).trim();
}

function numberFrom(value: string): number {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function positiveOrNull(value: number): number | null {
  return value > 0 ? value : null;
}

/** Pulls "LABEL : value" out of a block of lines, matching on the label prefix. */
function afterLabel(block: string, label: string): string {
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    if (!upper.startsWith(label.toUpperCase())) continue;
    return trimmed.slice(label.length).replace(/^\s*:\s*/, "").trim();
  }
  return "";
}

/**
 * Recovers a party from its printed block. The block is written by
 * customsInvoiceWorkbook's partyBlock(), so the shapes mirror each other:
 *   NAME
 *   COMPANY NAME :...
 *   ADDRESS : line1, line2, town, county
 *   Country, Postcode
 *   EMAIL ...
 *   PHONE NUMBER : +cc number
 */
function parsePartyBlock(block: string) {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const contactName = lines[0] ?? "";
  const companyName = afterLabel(block, "COMPANY NAME") || contactName;
  const address = afterLabel(block, "ADDRESS");
  const email = afterLabel(block, "EMAIL");
  const phone = afterLabel(block, "PHONE NUMBER");

  // The country/postcode line is the one that is neither labelled nor the name.
  const countryLine = lines.slice(1).find((line) => !/^(COMPANY NAME|ADDRESS|EMAIL|PHONE NUMBER)/i.test(line)) ?? "";
  const countryParts = countryLine.split(",").map((part) => part.trim()).filter(Boolean);
  const postcode = countryParts.length > 1 ? countryParts.at(-1) ?? "" : "";
  const countryName = countryParts.length > 1 ? countryParts.slice(0, -1).join(", ") : countryLine;

  // "ADDRESS : line1, line2, town, county" — the tail is town/county where present.
  const addressParts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const addressLine1 = addressParts[0] ?? "";
  const county = addressParts.length >= 4 ? addressParts.at(-1) ?? "" : "";
  const townOrCity = addressParts.length >= 3 ? addressParts.at(county ? -2 : -1) ?? "" : "";
  const middle = addressParts.slice(1, addressParts.length - (county ? 2 : 1));
  const addressLine2 = middle.join(", ");

  const phoneMatch = /^(\+\d{1,4})?\s*(.*)$/.exec(phone);
  return {
    contactName,
    companyName,
    email,
    mobileCountryCode: phoneMatch?.[1] ?? "",
    mobileNumber: (phoneMatch?.[2] ?? "").replace(/\s+/g, ""),
    addressLine1,
    addressLine2,
    townOrCity,
    county,
    postcode,
    countryName
  };
}

/** Reads the Field | Value import sheet, when the workbook carries one. */
function readShipmentDataSheet(workbook: ExcelJS.Workbook): Partial<Record<ShipmentDataFieldKey, string>> {
  const sheet = workbook.getWorksheet(shipmentDataSheetName);
  if (!sheet) return {};

  const byLabel = new Map<string, ShipmentDataFieldKey>(
    (Object.keys(shipmentDataFields) as ShipmentDataFieldKey[])
      .map((key) => [shipmentDataFields[key].toUpperCase(), key])
  );

  const values: Partial<Record<ShipmentDataFieldKey, string>> = {};
  sheet.eachRow((row) => {
    const label = cellText(sheet, row.number, 1).toUpperCase();
    const key = byLabel.get(label);
    if (key) values[key] = cellText(sheet, row.number, 2);
  });
  return values;
}

const boxHeaderPattern = /^BOX NO:\s*(\d+)/i;
const dimensionsPattern = /DIMENSIONS \(CMS\)\s*([\d.]+)\s*\*\s*([\d.]+)\s*\*\s*([\d.]+)/i;
const weightPattern = /ACTUAL WEIGHT\s*-\s*([\d.]+)\s*KG/i;

/**
 * Walks the printed sheet and rebuilds parcels and their items.
 *
 * Row positions are found by their markers rather than fixed indexes, so the
 * layout can gain or lose a header row without breaking the import.
 */
/**
 * Parses a customs invoice workbook from its bytes.
 *
 * Takes a buffer rather than a path because invoices live in object storage
 * now: the caller reads the object once and passes it here, instead of this
 * function assuming there is a local file to open.
 */
export async function parseCustomsInvoiceWorkbook(contents: Buffer): Promise<ParsedCustomsInvoice> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(contents as unknown as ArrayBuffer);
  } catch {
    throw new CustomsInvoiceParseError(["The file could not be opened. Upload a Swiftline shipment invoice (.xlsx)."]);
  }

  const sheet = workbook.getWorksheet(customsInvoiceSheetName);
  if (!sheet) {
    throw new CustomsInvoiceParseError([
      `This file is not a Swiftline shipment invoice: a worksheet named "${customsInvoiceSheetName}" was not found.`
    ]);
  }

  const warnings: string[] = [];
  const data = readShipmentDataSheet(workbook);
  if (!workbook.getWorksheet(shipmentDataSheetName)) {
    warnings.push(
      `The "${shipmentDataSheetName}" sheet is missing, so sender details, shipment type and service could not be read.`
    );
  }

  // --- Printed sheet: locate the marker rows -------------------------------
  let metaRow = 0;
  let partyRow = 0;
  let noteRow = 0;
  let headingRow = 0;

  sheet.eachRow((row) => {
    const first = cellText(sheet, row.number, 1).toUpperCase();
    if (!metaRow && first.startsWith("INVOICE NO.")) metaRow = row.number;
    if (!partyRow && first === "SHIPPER") partyRow = row.number + 1;
    if (!noteRow && first === "NOTE") noteRow = row.number;
    if (!headingRow && first.replace(/\s+/g, "") === "SR.NO.") headingRow = row.number;
  });

  if (!headingRow) {
    throw new CustomsInvoiceParseError([
      "This file is not a Swiftline shipment invoice: the item table could not be found."
    ]);
  }

  // --- Invoice number and customer reference -------------------------------
  const metaText = metaRow ? cellText(sheet, metaRow, 1) : "";
  const invoiceNumber = /INVOICE NO\.\s*:?\s*([^\s]+)/i.exec(metaText)?.[1] ?? "";
  const referenceBlock = metaRow ? cellText(sheet, metaRow, 6) : "";
  const shipmentReference = afterLabel(referenceBlock, "REFERENCE");

  // --- Parties -------------------------------------------------------------
  const consigneeBlock = partyRow ? cellText(sheet, partyRow, 6) : "";
  const consignee = parsePartyBlock(consigneeBlock);
  if (!consignee.contactName) warnings.push("Consignee contact name was not found on the invoice.");

  // DESTINATION holds the ISO country code the shipment is going to.
  let destinationCode = "";
  sheet.eachRow((row) => {
    if (cellText(sheet, row.number, 1).toUpperCase() === "COUNTRY OF ORIGIN") {
      destinationCode = cellText(sheet, row.number, 9).toUpperCase();
    }
  });

  // --- Boxes and items -----------------------------------------------------
  const parcels: ParsedInvoiceParcel[] = [];
  let current: ParsedInvoiceParcel | null = null;

  sheet.eachRow((row) => {
    if (row.number <= headingRow) return;
    const first = cellText(sheet, row.number, 1);
    const upper = first.toUpperCase();

    // The totals block ends the item table.
    if (upper.startsWith("AMOUNT CHARGEABLE") || upper === "NOTES") {
      current = null;
      return;
    }

    const boxMatch = boxHeaderPattern.exec(first);
    if (boxMatch) {
      const dimensions = dimensionsPattern.exec(first);
      const weight = weightPattern.exec(first);
      current = {
        sequence: Number(boxMatch[1]) || parcels.length + 1,
        weightKg: weight ? numberFrom(weight[1]!) : 0,
        lengthCm: dimensions ? positiveOrNull(numberFrom(dimensions[1]!)) : null,
        widthCm: dimensions ? positiveOrNull(numberFrom(dimensions[2]!)) : null,
        heightCm: dimensions ? positiveOrNull(numberFrom(dimensions[3]!)) : null,
        items: []
      };
      parcels.push(current);
      if (!weight) warnings.push(`Box ${current.sequence}: actual weight could not be read.`);
      if (!dimensions) warnings.push(`Box ${current.sequence}: dimensions could not be read.`);
      return;
    }

    // Item rows sit under a box header and start with a serial number.
    if (!current || !/^\d+$/.test(first)) return;

    const description = cellText(sheet, row.number, 2);
    if (!description) return;

    const hsCode = cellText(sheet, row.number, 6).replace(/\D/g, "");
    const quantity = numberFrom(cellText(sheet, row.number, 8));
    const unitRate = numberFrom(cellText(sheet, row.number, 10));
    const label = `Box ${current.sequence}, "${description}"`;

    // A malformed HS code is dropped rather than imported wrong; the review form
    // then shows it as missing, which the user must fix before booking.
    if (hsCode && !isValidHsnCode(hsCode)) {
      warnings.push(`${label}: HS code "${hsCode}" is not a valid 4, 6, 8 or 10 digit code and was not imported.`);
    }
    if (!quantity) warnings.push(`${label}: quantity is missing or zero.`);
    if (!unitRate) warnings.push(`${label}: unit rate is missing or zero.`);

    current.items.push({
      description,
      hsnCode: hsCode && isValidHsnCode(hsCode) ? hsCode : "",
      unitType: cellText(sheet, row.number, 7) || defaultParcelItemUnitType,
      quantity,
      unitRate
    });
  });

  if (!parcels.length) {
    throw new CustomsInvoiceParseError(["No boxes were found on the invoice."]);
  }

  // --- Import sheet values, each validated before being trusted -------------
  const csbRaw = (data.shipmentType ?? "").toUpperCase().replace(/[\s-]/g, "");
  let csbType: CsbType | null = null;
  if (csbRaw === "CSBIV" || csbRaw === "CSB4") csbType = "CSB_IV";
  else if (csbRaw === "CSBV" || csbRaw === "CSB5") csbType = "CSB_V";
  else if (data.shipmentType) {
    warnings.push(`Shipment type "${data.shipmentType}" was not recognised. Choose CSB-IV or CSB-V on the form.`);
  }

  const serviceRaw = (data.serviceType ?? "").toUpperCase();
  const serviceType = serviceRaw.includes("CARGO")
    ? "CARGO" as const
    : serviceRaw.includes("COURIER") ? "COURIER" as const : null;
  if (data.serviceType && !serviceType) {
    warnings.push(`Service type "${data.serviceType}" was not recognised. Choose Courier or Cargo on the form.`);
  }

  const aadhaarRaw = normalizeAadhaarNumber(data.consignorAadhaarNumber ?? "");
  let aadhaarNumber = "";
  if (aadhaarRaw && isValidAadhaarNumber(aadhaarRaw)) {
    aadhaarNumber = aadhaarRaw;
  } else if (aadhaarRaw) {
    warnings.push("The Aadhaar number on the invoice is not a valid 12 digit number and was not imported.");
  }

  const pinCode = (data.consignorPinCode ?? "").trim();
  let consignorPostcode = "";
  if (pinCode && indianPinPattern.test(pinCode)) {
    consignorPostcode = pinCode;
  } else if (pinCode) {
    warnings.push(`Sender PIN code "${pinCode}" is not a valid 6 digit code and was not imported.`);
  }

  const consignorEmail = (data.consignorEmail ?? "").trim();
  if (consignorEmail && !emailPattern.test(consignorEmail)) {
    warnings.push(`Sender email "${consignorEmail}" is not valid and was not imported.`);
  }

  return {
    invoiceNumber,
    shipmentReference,
    csbType,
    serviceType,
    declarationNote: data.declarationNote ?? "",
    consignor: {
      contactName: (data.consignorContactName ?? "").trim(),
      companyName: (data.consignorCompanyName ?? "").trim(),
      email: consignorEmail && emailPattern.test(consignorEmail) ? consignorEmail : "",
      mobileNumber: (data.consignorMobileNumber ?? "").replace(/\s+/g, ""),
      addressLine1: (data.consignorAddressLine1 ?? "").trim(),
      addressLine2: (data.consignorAddressLine2 ?? "").trim(),
      townOrCity: (data.consignorTownOrCity ?? "").trim(),
      county: (data.consignorState ?? "").trim(),
      postcode: consignorPostcode,
      aadhaarNumber
    },
    consignee: {
      contactName: consignee.contactName,
      companyName: consignee.companyName,
      email: consignee.email,
      mobileCountryCode: consignee.mobileCountryCode,
      mobileNumber: consignee.mobileNumber,
      addressLine1: consignee.addressLine1,
      addressLine2: consignee.addressLine2,
      townOrCity: consignee.townOrCity,
      county: consignee.county,
      postcode: consignee.postcode,
      countryCode: destinationCode,
      countryName: consignee.countryName
    },
    parcels,
    warnings
  };
}
