import ExcelJS from "exceljs";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { isValidHsnCode } from "../parcelItems.service.js";
import { getCountryCodeByName } from "../reference/portalCountries.js";
import type { CsbType } from "../csbType.service.js";
import type { ShipmentContentType, ShipmentServiceType } from "../../models/shipmentDraft.model.js";
import {
  contentTypeOptions,
  destinationCountryOptions,
  isShipmentImportPlaceholder,
  normalizedImportLabel,
  shipmentImportFields,
  shipmentImportLimits,
  shipmentImportSheetNames,
  shipmentImportTemplateVersion,
  unitTypeOptions,
  type ShipmentImportFieldKey
} from "./shipmentImportContract.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const indianPostcodePattern = /^[1-9]\d{5}$/;

export type ParsedShipmentImportItem = {
  description: string;
  hsnCode: string;
  unitType: string;
  quantity: number;
  unitRate: number;
};

export type ParsedShipmentImportParcel = {
  sequence: number;
  weightKg: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  shipmentContentType: ShipmentContentType;
  reference: string;
  items: ParsedShipmentImportItem[];
};

export type ParsedShipmentImport = {
  templateVersion: string;
  csbType: CsbType;
  serviceType: ShipmentServiceType;
  declarationNote: string;
  consignor: {
    companyName: string; contactName: string; email: string; mobileNumber: string;
    addressLine1: string; addressLine2: string; townOrCity: string; county: string;
    postcode: string; pickupInstructions: string;
  };
  consignee: {
    companyName: string; contactName: string; email: string; mobileCountryCode: string;
    mobileNumber: string; countryCode: string; countryName: string; addressLine1: string;
    addressLine2: string; townOrCity: string; county: string; postcode: string;
    deliveryInstructions: string;
  };
  parcels: ParsedShipmentImportParcel[];
  warnings: string[];
  errors: string[];
};

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
  if (typeof value === "object" && "richText" in value) {
    return (value.richText as Array<{ text: string }>).map((part) => part.text).join("").trim();
  }
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  return String(value).trim();
}

function inputText(value: string) {
  return isShipmentImportPlaceholder(value) ? "" : value.trim();
}

function numeric(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function findHeader(sheet: ExcelJS.Worksheet, prefix: string) {
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const value = normalizedImportLabel(cellText(sheet.getCell(2, column))).replace(/\s*\*.*$/, "");
    if (value.startsWith(normalizedImportLabel(prefix))) return column;
  }
  return 0;
}

function readShipmentFields(sheet: ExcelJS.Worksheet) {
  const byLabel = new Map(shipmentImportFields.map((field) => [
    normalizedImportLabel(`${field.label}${field.required ? " *" : ""}`), field.key
  ]));
  const values: Partial<Record<ShipmentImportFieldKey, string>> = {};
  for (let row = 3; row <= sheet.rowCount; row += 1) {
    const key = byLabel.get(normalizedImportLabel(cellText(sheet.getCell(row, 1))));
    if (key) values[key] = inputText(cellText(sheet.getCell(row, 2)));
  }
  return values;
}

function requiredWarning(warnings: string[], value: string | undefined, label: string) {
  if (!value?.trim()) warnings.push(`${label} is missing.`);
}

export class ShipmentImportParseError extends Error {
  constructor(readonly issues: string[]) {
    super(issues[0] ?? "The shipment workbook could not be read.");
    this.name = "ShipmentImportParseError";
  }
}

export async function parseShipmentImportWorkbook(contents: Buffer): Promise<ParsedShipmentImport> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(contents as unknown as ArrayBuffer);
  } catch {
    throw new ShipmentImportParseError(["The file could not be opened. Upload the Swiftline Shipment Import .xlsx template."]);
  }

  const shipmentSheet = workbook.getWorksheet(shipmentImportSheetNames.shipment);
  const parcelSheet = workbook.getWorksheet(shipmentImportSheetNames.parcels);
  const itemSheet = workbook.getWorksheet(shipmentImportSheetNames.items);
  const missingSheets = [
    !shipmentSheet ? shipmentImportSheetNames.shipment : "",
    !parcelSheet ? shipmentImportSheetNames.parcels : "",
    !itemSheet ? shipmentImportSheetNames.items : ""
  ].filter(Boolean);
  if (missingSheets.length || !shipmentSheet || !parcelSheet || !itemSheet) {
    throw new ShipmentImportParseError([`Required worksheet${missingSheets.length === 1 ? "" : "s"} missing: ${missingSheets.join(", ")}.`]);
  }

  const values = readShipmentFields(shipmentSheet);
  if (values.templateVersion !== shipmentImportTemplateVersion) {
    throw new ShipmentImportParseError([`Unsupported template version. Download the current ${shipmentImportTemplateVersion} template.`]);
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const shipmentType = (values.shipmentType ?? "").toUpperCase().replace(/[\s_]/g, "-");
  const csbType: CsbType = shipmentType === "CSB-V" ? "CSB_V" : "CSB_IV";
  if (shipmentType && shipmentType !== "CSB-IV" && shipmentType !== "CSB-V") {
    errors.push(`Shipment Type "${values.shipmentType}" is not accepted. Choose CSB-IV or CSB-V.`);
  }
  requiredWarning(warnings, values.shipmentType, "Shipment Type");

  const serviceValue = (values.serviceType ?? "").toUpperCase();
  const serviceType: ShipmentServiceType = serviceValue === "CARGO" ? "CARGO" : "COURIER";
  if (serviceValue && serviceValue !== "COURIER" && serviceValue !== "CARGO") {
    errors.push(`Service Type "${values.serviceType}" is not accepted. Choose Courier or Cargo.`);
  }
  requiredWarning(warnings, values.serviceType, "Service Type");

  const destinationCountry = values.destinationCountry ?? "";
  const destinationCode = getCountryCodeByName(destinationCountry);
  if (destinationCountry && !destinationCountryOptions.includes(destinationCountry)) {
    errors.push(`Destination Country "${destinationCountry}" is not accepted. Choose a country from the dropdown.`);
  }

  const phone = parsePhoneNumberFromString(values.consigneeMobile ?? "");
  const consigneeCountryCode = phone?.countryCallingCode ? `+${phone.countryCallingCode}` : "";
  const consigneeMobileNumber = phone?.nationalNumber ?? (values.consigneeMobile ?? "").replace(/\D/g, "");

  for (const [value, label] of [
    [values.consignorContactName, "Consignor Contact Name"], [values.consignorEmail, "Consignor Email"],
    [values.consignorMobileNumber, "Consignor Mobile Number"], [values.pickupAddressLine1, "Pickup Address Line 1"],
    [values.pickupTownOrCity, "Pickup Town / City"], [values.pickupState, "Pickup State"],
    [values.pickupPinCode, "Pickup PIN Code"], [values.consigneeContactName, "Consignee Contact Name"],
    [values.consigneeEmail, "Consignee Email"], [values.consigneeMobile, "Consignee Mobile"],
    [values.destinationCountry, "Destination Country"], [values.deliveryAddressLine1, "Delivery Address Line 1"],
    [values.deliveryTownOrCity, "Delivery Town / City"], [values.deliveryPostcode, "Delivery Postcode"]
  ] as const) requiredWarning(warnings, value, label);
  if (values.consignorEmail && !emailPattern.test(values.consignorEmail)) warnings.push("Consignor Email is invalid.");
  if (values.consigneeEmail && !emailPattern.test(values.consigneeEmail)) warnings.push("Consignee Email is invalid.");
  if (values.consignorMobileNumber && !parsePhoneNumberFromString(`+91${values.consignorMobileNumber.replace(/\D/g, "")}`)?.isValid()) {
    warnings.push("Consignor Mobile Number is invalid.");
  }
  if (values.consigneeMobile && !phone?.isValid()) warnings.push("Consignee Mobile is invalid. Include its country code.");
  if (values.pickupPinCode && !indianPostcodePattern.test(values.pickupPinCode)) warnings.push("Pickup PIN Code must contain 6 digits.");

  const parcelColumns = {
    sequence: findHeader(parcelSheet, "Parcel No."), weight: findHeader(parcelSheet, "Actual Weight KG"),
    length: findHeader(parcelSheet, "Length CM"), width: findHeader(parcelSheet, "Width CM"),
    height: findHeader(parcelSheet, "Height CM"), contentType: findHeader(parcelSheet, "Content Type"),
    reference: findHeader(parcelSheet, "Reference")
  };
  if (Object.values(parcelColumns).some((column) => !column)) errors.push("The Parcels worksheet headings were changed or removed.");

  const parcels: ParsedShipmentImportParcel[] = [];
  if (!errors.length) {
    for (let row = 3; row <= parcelSheet.rowCount; row += 1) {
      const raw = Object.fromEntries(
        Object.entries(parcelColumns).map(([key, column]) => [key, inputText(cellText(parcelSheet.getCell(row, column)))])
      ) as Record<keyof typeof parcelColumns, string>;
      if (!Object.values(raw).some(Boolean)) continue;
      const sequence = numeric(raw.sequence);
      if (!Number.isInteger(sequence) || sequence <= 0) {
        errors.push(`Parcels row ${row}: Parcel No. must be a positive whole number.`);
        continue;
      }
      const content = contentTypeOptions.find((option) => option.label.toUpperCase() === raw.contentType.toUpperCase());
      if (raw.contentType && !content) errors.push(`Parcel ${sequence}: Content Type "${raw.contentType}" is not accepted. Choose from the dropdown.`);
      const parcel: ParsedShipmentImportParcel = {
        sequence, weightKg: numeric(raw.weight), lengthCm: numeric(raw.length) || null,
        widthCm: numeric(raw.width) || null, heightCm: numeric(raw.height) || null,
        shipmentContentType: content?.value ?? "PARCEL", reference: raw.reference, items: []
      };
      if (!parcel.weightKg) warnings.push(`Parcel ${sequence}: Actual Weight KG is missing or zero.`);
      if (!parcel.lengthCm || !parcel.widthCm || !parcel.heightCm) warnings.push(`Parcel ${sequence}: one or more dimensions are missing or zero.`);
      if (!raw.contentType) warnings.push(`Parcel ${sequence}: Content Type is missing.`);
      if (!parcel.reference) warnings.push(`Parcel ${sequence}: Reference is missing.`);
      parcels.push(parcel);
    }
  }

  const sortedSequences = parcels.map((parcel) => parcel.sequence).sort((a, b) => a - b);
  if (!parcels.length) errors.push("Add at least one parcel on the Parcels worksheet.");
  if (parcels.length > shipmentImportLimits.parcelsPerShipment) errors.push(`A shipment can contain at most ${shipmentImportLimits.parcelsPerShipment} parcels.`);
  if (new Set(sortedSequences).size !== sortedSequences.length) errors.push("Parcel numbers must not be duplicated.");
  if (sortedSequences.some((sequence, index) => sequence !== index + 1)) errors.push("Parcel numbers must be sequential: 1, 2, 3...");

  const itemColumns = {
    parcel: findHeader(itemSheet, "Parcel No."), description: findHeader(itemSheet, "Description"),
    hsnCode: findHeader(itemSheet, "HS Code"), unitType: findHeader(itemSheet, "Unit Type"),
    quantity: findHeader(itemSheet, "Quantity"), unitRate: findHeader(itemSheet, "Unit Rate")
  };
  if (Object.values(itemColumns).some((column) => !column)) errors.push("The Items worksheet headings were changed or removed.");

  if (Object.values(itemColumns).every(Boolean)) {
    for (let row = 3; row <= itemSheet.rowCount; row += 1) {
      const raw = Object.fromEntries(
        Object.entries(itemColumns).map(([key, column]) => [key, inputText(cellText(itemSheet.getCell(row, column)))])
      ) as Record<keyof typeof itemColumns, string>;
      if (!Object.values(raw).some(Boolean)) continue;
      const sequence = numeric(raw.parcel);
      const parcel = parcels.find((candidate) => candidate.sequence === sequence);
      if (!parcel) {
        errors.push(`Items row ${row}: Parcel No. ${raw.parcel || "is missing"} does not match a parcel.`);
        continue;
      }
      const unitType = unitTypeOptions.find((option) => option.toUpperCase() === raw.unitType.toUpperCase());
      if (raw.unitType && !unitType) errors.push(`Parcel ${sequence}, items row ${row}: Unit Type "${raw.unitType}" is not accepted. Choose from the dropdown.`);
      const item = {
        description: raw.description,
        hsnCode: raw.hsnCode.replace(/\D/g, ""),
        unitType: unitType ?? "Pkt",
        quantity: numeric(raw.quantity),
        unitRate: numeric(raw.unitRate)
      };
      const label = `Parcel ${sequence}, items row ${row}`;
      if (!item.description) warnings.push(`${label}: Description is missing.`);
      if (!item.hsnCode || !isValidHsnCode(item.hsnCode)) warnings.push(`${label}: enter a valid 4, 6, 8 or 10 digit HS Code.`);
      if (!raw.unitType) warnings.push(`${label}: Unit Type is missing.`);
      if (!(item.quantity > 0)) warnings.push(`${label}: Quantity is missing or zero.`);
      if (!(item.unitRate > 0)) warnings.push(`${label}: Unit Rate is missing or zero.`);
      parcel.items.push(item);
    }
  }

  for (const parcel of parcels) {
    if (!parcel.items.length) warnings.push(`Parcel ${parcel.sequence}: add at least one item.`);
    if (parcel.items.length > shipmentImportLimits.itemsPerParcel) errors.push(`Parcel ${parcel.sequence} can contain at most ${shipmentImportLimits.itemsPerParcel} items.`);
  }
  if (parcels.every((parcel) => parcel.items.length === 0)) {
    errors.push("Add at least one item on the Items worksheet.");
  }

  return {
    templateVersion: shipmentImportTemplateVersion,
    csbType,
    serviceType,
    declarationNote: values.declarationNote ?? "",
    consignor: {
      companyName: values.consignorCompany ?? "", contactName: values.consignorContactName ?? "",
      email: values.consignorEmail ?? "", mobileNumber: (values.consignorMobileNumber ?? "").replace(/\D/g, ""),
      addressLine1: values.pickupAddressLine1 ?? "", addressLine2: values.pickupAddressLine2 ?? "",
      townOrCity: values.pickupTownOrCity ?? "", county: values.pickupState ?? "",
      postcode: values.pickupPinCode ?? "", pickupInstructions: values.pickupInstructions ?? ""
    },
    consignee: {
      companyName: values.consigneeCompany ?? "", contactName: values.consigneeContactName ?? "",
      email: values.consigneeEmail ?? "", mobileCountryCode: consigneeCountryCode,
      mobileNumber: consigneeMobileNumber, countryCode: destinationCode, countryName: destinationCountry,
      addressLine1: values.deliveryAddressLine1 ?? "", addressLine2: values.deliveryAddressLine2 ?? "",
      townOrCity: values.deliveryTownOrCity ?? "", county: values.deliveryStateOrCounty ?? "",
      postcode: values.deliveryPostcode ?? "", deliveryInstructions: values.deliveryInstructions ?? ""
    },
    parcels,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)]
  };
}
