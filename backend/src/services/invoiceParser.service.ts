import XLSX from "xlsx";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  dpdInvoiceTemplateFields,
  maxDpdInvoiceParcels,
  dpdInvoiceTemplateVersion,
  dpdInvoiceWorksheetName
} from "./invoiceTemplate.service.js";
import { shipmentContentTypeValues, type ShipmentContentType } from "../models/shipmentDraft.model.js";

const requiredFieldNames = dpdInvoiceTemplateFields
  .filter((field) => field.required)
  .map((field) => field.field);
const knownFieldNames = new Set(dpdInvoiceTemplateFields.map((field) => field.field));
const phoneFieldNames = new Set(["Mobile Country Code", "Mobile Number"]);
const defaultShipmentContentType: ShipmentContentType = "PARCEL";
const contentTypeAliases = new Map<string, ShipmentContentType>([
  ["DOC", "DOCUMENTS"],
  ["DOCUMENT", "DOCUMENTS"],
  ["DOCUMENTS", "DOCUMENTS"],
  ["PARCEL", "PARCEL"],
  ["PARCELS", "PARCEL"],
  ["NON DOCUMENT", "PARCEL"],
  ["NON-DOCUMENT", "PARCEL"],
  ["NON DOCUMENTS", "PARCEL"],
  ["NON-DOCUMENTS", "PARCEL"],
  ["MERCHANDISE", "MERCHANDISE"],
  ["GOODS", "MERCHANDISE"],
  ["SAMPLE", "SAMPLES"],
  ["SAMPLES", "SAMPLES"],
  ["GIFT", "GIFTS"],
  ["GIFTS", "GIFTS"],
  ["RETURN", "RETURNS"],
  ["RETURNS", "RETURNS"],
  ["OTHER", "OTHER"]
]);

export interface ParsedDpdInvoice {
  templateVersion: string;
  invoiceNumber: string;
  invoiceDate?: string;
  shipmentReference: string;
  businessAccountCode: string;
  branchCode: string;
  consignee: {
    consigneeType?: string;
    companyName?: string;
    contactPerson: string;
    email?: string;
    mobileCountryCode: string;
    mobileNumber: string;
    countryName: string;
    countryCode: "GB";
    postcode: string;
    addressLine1: string;
    addressLine2?: string;
    townOrCity: string;
    county?: string;
    deliveryInstructions?: string;
  };
  parcelCount: number;
  parcel: ParsedDpdInvoiceParcel;
  parcelList: ParsedDpdInvoiceParcel[];
  optional: {
    customerOrderNumber?: string;
    purchaseOrderNumber?: string;
    department?: string;
    internalNotes?: string;
  };
  rawFields: Record<string, string>;
}

export interface ParsedDpdInvoiceParcel {
  sequence: number;
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  shipmentContentType: ShipmentContentType;
  contentsDescription: string;
  shipmentReference1?: string;
  shipmentReference2?: string;
}

export class InvoiceParserError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
  }
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function parsePositiveNumber(fields: Record<string, string>, fieldName: string, required: boolean, issues: string[]) {
  const value = fields[fieldName];
  if (!value) {
    if (required) issues.push(`${fieldName} is required`);
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    issues.push(`${fieldName} must be greater than zero`);
    return undefined;
  }

  return parsed;
}

function parseParcelCount(fields: Record<string, string>, issues: string[]) {
  const value = fields["Number of Parcels (PCS)"];
  if (!value) return 1;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    issues.push("Number of Parcels (PCS) must be a whole number of at least 1");
    return 1;
  }

  if (parsed > maxDpdInvoiceParcels) {
    issues.push(`Number of Parcels (PCS) must be ${maxDpdInvoiceParcels} or fewer`);
    return maxDpdInvoiceParcels;
  }

  return parsed;
}

function normalizeCountry(value: string) {
  const country = value.trim();
  if (!country || ["GB", "UK", "UNITED KINGDOM", "GREAT BRITAIN"].includes(country.toUpperCase())) {
    return "United Kingdom";
  }

  return country;
}

function normalizeDialCode(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  return `+${digits}`;
}

function normalizeLocalPhoneNumber(value: string) {
  return value.replace(/[^\d]/g, "");
}

function splitConsigneePhone(fields: Record<string, string>) {
  const rawCountryCode = fields["Mobile Country Code"] ?? "";
  const rawMobileNumber = fields["Mobile Number"] ?? "";
  const countryCodeDigits = rawCountryCode.replace(/\D/g, "");
  const mobileNumberDigits = rawMobileNumber.replace(/\D/g, "");
  const combinedCandidates = [
    rawMobileNumber,
    rawCountryCode,
    `${rawCountryCode}${rawMobileNumber}`,
    countryCodeDigits && mobileNumberDigits ? `+${countryCodeDigits}${mobileNumberDigits.replace(/^0+/, "")}` : "",
    mobileNumberDigits ? `+${mobileNumberDigits}` : ""
  ];

  for (const candidate of combinedCandidates) {
    const compactCandidate = candidate.replace(/[^\d+]/g, "");
    if (!compactCandidate.startsWith("+")) continue;

    const parsedPhoneNumber = parsePhoneNumberFromString(compactCandidate);
    if (parsedPhoneNumber?.countryCallingCode && parsedPhoneNumber.nationalNumber) {
      return {
        mobileCountryCode: `+${parsedPhoneNumber.countryCallingCode}`,
        mobileNumber: parsedPhoneNumber.nationalNumber
      };
    }
  }

  const parsedGbMobileNumber = parsePhoneNumberFromString(rawMobileNumber, "GB");
  if (!countryCodeDigits && parsedGbMobileNumber?.countryCallingCode && parsedGbMobileNumber.nationalNumber) {
    return {
      mobileCountryCode: `+${parsedGbMobileNumber.countryCallingCode}`,
      mobileNumber: parsedGbMobileNumber.nationalNumber
    };
  }

  return {
    mobileCountryCode: normalizeDialCode(rawCountryCode),
    mobileNumber: normalizeDialCode(rawCountryCode) === "+44"
      ? normalizeLocalPhoneNumber(rawMobileNumber).replace(/^0+/, "")
      : normalizeLocalPhoneNumber(rawMobileNumber)
  };
}

function addPhoneIssues(consigneePhone: { mobileCountryCode: string; mobileNumber: string }, issues: string[]) {
  if (!consigneePhone.mobileCountryCode) {
    issues.push("Mobile Country Code is required");
  }

  if (!consigneePhone.mobileNumber) {
    issues.push("Mobile Number is required");
  }
}

function getParcelFieldName(sequence: number, fieldName: string) {
  if (sequence === 1) return fieldName;

  const extraFieldNameMap: Record<string, string> = {
    "Parcel Weight": `Parcel ${sequence} Weight`,
    Length: `Parcel ${sequence} Length`,
    Width: `Parcel ${sequence} Width`,
    Height: `Parcel ${sequence} Height`,
    "Shipment Content Type": `Parcel ${sequence} Shipment Content Type`,
    "Contents Description": `Parcel ${sequence} Contents Description`,
    "Shipment Reference 1": `Parcel ${sequence} Reference`
  };

  return extraFieldNameMap[fieldName] ?? fieldName;
}

function hasAnyParcelFields(fields: Record<string, string>, sequence: number) {
  return [
    "Parcel Weight",
    "Length",
    "Width",
    "Height",
    "Shipment Content Type",
    "Contents Description",
    "Shipment Reference 1"
  ].some((fieldName) => Boolean(fields[getParcelFieldName(sequence, fieldName)]));
}

function normalizeShipmentContentType(value: string, fieldName: string, issues: string[]): ShipmentContentType {
  if (!value.trim()) return defaultShipmentContentType;

  const normalized = value.trim().replace(/[_/]+/g, " ").replace(/\s+/g, " ").toUpperCase();
  const mappedValue = contentTypeAliases.get(normalized) ?? contentTypeAliases.get(normalized.replace(/\s+/g, "-"));

  if (mappedValue) return mappedValue;

  issues.push(`${fieldName} must be one of: ${shipmentContentTypeValues.join(", ")}`);
  return defaultShipmentContentType;
}

function parseParcel(
  fields: Record<string, string>,
  sequence: number,
  required: boolean,
  issues: string[]
): ParsedDpdInvoiceParcel | null {
  if (!required && !hasAnyParcelFields(fields, sequence)) return null;

  const weightFieldName = getParcelFieldName(sequence, "Parcel Weight");
  const contentsFieldName = getParcelFieldName(sequence, "Contents Description");
  const contentTypeFieldName = getParcelFieldName(sequence, "Shipment Content Type");
  const weightKg = parsePositiveNumber(fields, weightFieldName, required, issues);
  const lengthCm = parsePositiveNumber(fields, getParcelFieldName(sequence, "Length"), false, issues);
  const widthCm = parsePositiveNumber(fields, getParcelFieldName(sequence, "Width"), false, issues);
  const heightCm = parsePositiveNumber(fields, getParcelFieldName(sequence, "Height"), false, issues);
  const shipmentContentType = normalizeShipmentContentType(fields[contentTypeFieldName] ?? "", contentTypeFieldName, issues);
  const contentsDescription = fields[contentsFieldName] ?? "";

  if (required && !contentsDescription) {
    issues.push(`${contentsFieldName} is required`);
  }

  if (!weightKg) return null;

  return {
    sequence,
    weightKg,
    lengthCm,
    widthCm,
    heightCm,
    shipmentContentType,
    contentsDescription,
    shipmentReference1: fields[getParcelFieldName(sequence, "Shipment Reference 1")] || undefined,
    shipmentReference2: sequence === 1 ? fields["Shipment Reference 2"] || undefined : undefined
  };
}

function parseParcels(fields: Record<string, string>, parcelCount: number, issues: string[]) {
  const parcels: ParsedDpdInvoiceParcel[] = [];

  for (let sequence = 1; sequence <= maxDpdInvoiceParcels; sequence += 1) {
    // PCS is controlled by parcel rows: if a sequence is within PCS it is required,
    // and any filled row above PCS is still imported so the review screen stays faithful to the invoice.
    const required = sequence <= parcelCount;
    const parcel = parseParcel(fields, sequence, required, issues);
    if (parcel) parcels.push(parcel);
  }

  if (parcels.length !== parcelCount) {
    issues.push("Number of Parcels (PCS) must match the completed parcel records");
  }

  return parcels;
}

export function parseDpdInvoiceWorkbook(filePath: string): ParsedDpdInvoice {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[dpdInvoiceWorksheetName];

  if (!sheet) {
    throw new InvoiceParserError([`Required worksheet "${dpdInvoiceWorksheetName}" was not found`]);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const fields: Record<string, string> = {};
  const issues: string[] = [];

  for (const row of rows) {
    const fieldName = stringifyCell(row.Field);
    if (!fieldName) continue;
    if (!knownFieldNames.has(fieldName)) continue;

    fields[fieldName] = stringifyCell(row.Value);
  }

  for (const fieldName of requiredFieldNames) {
    if (!(fieldName in fields)) {
      issues.push(`Required field identifier "${fieldName}" was not found`);
    }
  }

  if (issues.length) throw new InvoiceParserError(issues);

  if (fields["Template Version"] !== dpdInvoiceTemplateVersion) {
    issues.push(`Template Version must be ${dpdInvoiceTemplateVersion}`);
  }

  const consigneePhone = splitConsigneePhone(fields);

  for (const fieldName of requiredFieldNames) {
    if (phoneFieldNames.has(fieldName)) continue;

    if (!fields[fieldName]) {
      issues.push(`${fieldName} is required`);
    }
  }

  const countryName = normalizeCountry(fields.Country ?? "");
  if (countryName !== "United Kingdom") {
    issues.push("Only United Kingdom consignee addresses are supported in v1");
  }

  addPhoneIssues(consigneePhone, issues);

  const parcelCount = parseParcelCount(fields, issues);
  const parcelList = parseParcels(fields, parcelCount, issues);

  const firstParcel = parcelList[0];
  if (issues.length || !firstParcel) {
    throw new InvoiceParserError(issues);
  }

  return {
    templateVersion: fields["Template Version"] ?? "",
    invoiceNumber: fields["Invoice Number"] ?? "",
    invoiceDate: fields["Invoice Date"] || undefined,
    shipmentReference: fields["Shipment Reference"] ?? "",
    businessAccountCode: fields["Business Account Code"] ?? "",
    branchCode: fields["Branch Code"] ?? "",
    consignee: {
      consigneeType: fields["Consignee Type"] || undefined,
      companyName: fields["Company Name"] || undefined,
      contactPerson: fields["Contact Person"] ?? "",
      email: fields.Email || undefined,
      mobileCountryCode: consigneePhone.mobileCountryCode,
      mobileNumber: consigneePhone.mobileNumber,
      countryName,
      countryCode: "GB",
      postcode: (fields.Postcode ?? "").toUpperCase(),
      addressLine1: fields["Address Line 1"] ?? "",
      addressLine2: fields["Address Line 2"] || undefined,
      townOrCity: fields["Town / City"] ?? "",
      county: fields.County || undefined,
      deliveryInstructions: fields["Delivery Instructions"] || undefined
    },
    parcelCount,
    parcel: firstParcel,
    parcelList,
    optional: {
      customerOrderNumber: fields["Customer Order Number"] || undefined,
      purchaseOrderNumber: fields["Purchase Order Number"] || undefined,
      department: fields.Department || undefined,
      internalNotes: fields["Internal Notes"] || undefined
    },
    rawFields: fields
  };
}
