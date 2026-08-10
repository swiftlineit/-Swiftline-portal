import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  consignorCountryCode,
  shipmentContentTypeValues,
  type IShipmentDraft,
  type ShipmentKycDocumentType,
  type ShipmentParcel
} from "../models/shipmentDraft.model.js";
import { isValidAadhaarNumber } from "./aadhaarValidation.service.js";
import { isValidHsnCode, normalizeParcelItems } from "./parcelItems.service.js";
import { findRestrictedCategories } from "./restrictedGoods.service.js";

const ukPostcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/;
const indianPostcodePattern = /^[1-9]\d{5}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function comparableText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function comparablePhone(countryCode: unknown, number: unknown): string {
  const digits = `${typeof countryCode === "string" ? countryCode : ""}${typeof number === "string" ? number : ""}`
    .replace(/\D/g, "");
  // Compare the subscriber part so "+91 98…" and "098…" are still seen as equal.
  return digits.replace(/^0+/, "").slice(-10);
}

function validateConsignor(draft: IShipmentDraft): string[] {
  const consignor = draft.consignorAddress;
  const issues: string[] = [];

  if (!consignor) return ["Consignor details are required"];

  if (!hasText(consignor.contactName)) issues.push("Consignor contact name is required");
  if (!hasText(consignor.mobileNumber)) issues.push("Consignor mobile number is required");
  if (!hasText(consignor.email)) issues.push("Consignor email is required");
  if (hasText(consignor.email) && !emailPattern.test(consignor.email!.trim())) {
    issues.push("Enter a valid consignor email address");
  }

  const consignorPhone = parsePhoneNumberFromString(`${consignor.mobileCountryCode ?? ""}${consignor.mobileNumber ?? ""}`);
  if (hasText(consignor.mobileNumber) && !consignorPhone?.isValid()) {
    issues.push("Enter a valid Indian consignor mobile number");
  }

  // Aadhaar now lives in the KYC section (shared or per parcel), validated separately.

  if (consignor.countryCode?.trim().toUpperCase() !== consignorCountryCode) {
    issues.push("Consignor country must be India");
  }
  if (!hasText(consignor.addressLine1)) issues.push("Consignor address line 1 is required");
  if (!hasText(consignor.townOrCity)) issues.push("Consignor town or city is required");
  if (!hasText(consignor.postcode)) {
    issues.push("Consignor PIN code is required");
  } else if (!indianPostcodePattern.test(consignor.postcode.trim())) {
    issues.push("Enter a valid 6 digit consignor PIN code");
  }

  return issues;
}

function validateConsignorConsigneeAreDistinct(draft: IShipmentDraft): string[] {
  const consignor = draft.consignorAddress;
  const consignee = draft.consigneeEnteredAddress;
  const issues: string[] = [];

  if (!consignor) return issues;

  const consignorName = comparableText(consignor.contactName);
  const consigneeName = comparableText(consignee.contactName);
  if (consignorName && consignorName === consigneeName) {
    issues.push("Consignor and consignee contact names must be different");
  }

  const consignorPhone = comparablePhone(consignor.mobileCountryCode, consignor.mobileNumber);
  const consigneePhone = comparablePhone(consignee.mobileCountryCode, consignee.mobileNumber);
  if (consignorPhone && consignorPhone === consigneePhone) {
    issues.push("Consignor and consignee mobile numbers must be different");
  }

  const consignorEmail = comparableText(consignor.email);
  const consigneeEmail = comparableText(consignee.email);
  if (consignorEmail && consignorEmail === consigneeEmail) {
    issues.push("Consignor and consignee email addresses must be different");
  }

  return issues;
}

const csbIvKycDocuments: readonly ShipmentKycDocumentType[] = ["pan", "aadhaar"];
const csbVKycDocuments: readonly ShipmentKycDocumentType[] = [
  "iec",
  "gst",
  "pan",
  "aadhaar",
  "salePurchaseAdCode",
  "lut",
  "declarationOfGoods",
  "otherCertificates",
  "hsnCode"
];
const kycDocumentNames: Record<ShipmentKycDocumentType, string> = {
  aadhaar: "Aadhaar Card",
  pan: "PAN Card",
  iec: "IEC",
  gst: "GST",
  salePurchaseAdCode: "Sale / Purchase / AD Code",
  lut: "LUT",
  declarationOfGoods: "Declaration of Goods",
  otherCertificates: "Other Certificates",
  hsnCode: "HSN Code",
  other: "Other Document"
};

// CSB-IV needs PAN and Aadhaar; CSB-V needs the complete customs checklist.
// When kycUseForAllParcels is false, every parcel must carry its own set.
function validateKycDocuments(draft: IShipmentDraft): string[] {
  const issues: string[] = [];
  const requiredDocuments = draft.csbType === "CSB_V" ? csbVKycDocuments : csbIvKycDocuments;

  function appendMissingDocuments(
    documents: IShipmentDraft["kycDocuments"] | undefined,
    scope?: string
  ) {
    for (const type of requiredDocuments) {
      if (!documents?.[type]?.storedName) {
        issues.push(`${scope ? `${scope}: upload` : "Upload"} ${kycDocumentNames[type]}`);
      }
    }
  }

  if (draft.kycUseForAllParcels !== false) {
    const documents = draft.kycDocuments ?? {};
    if (!hasText(draft.consignorAddress?.aadhaarNumber)) {
      issues.push("Aadhaar number is required");
    } else if (!isValidAadhaarNumber(draft.consignorAddress.aadhaarNumber)) {
      issues.push("Enter a valid 12 digit Aadhaar number");
    }
    appendMissingDocuments(documents);
    if (documents.other?.storedName && !hasText(documents.other.documentLabel)) {
      issues.push("Name the other KYC document before booking");
    }
    return issues;
  }

  draft.parcelList.forEach((parcel, index) => {
    const label = `Parcel ${index + 1}`;
    const documents = parcel.kycDocuments ?? {};
    if (!hasText(parcel.aadhaarNumber)) {
      issues.push(`${label}: Aadhaar number is required`);
    } else if (!isValidAadhaarNumber(parcel.aadhaarNumber)) {
      issues.push(`${label}: enter a valid 12 digit Aadhaar number`);
    }
    appendMissingDocuments(documents, label);
    if (documents.other?.storedName && !hasText(documents.other.documentLabel)) {
      issues.push(`${label}: name the other KYC document before booking`);
    }
  });

  return issues;
}

function validateParcel(parcel: ShipmentParcel, index: number, requireItemHsnCodes: boolean): string[] {
  const label = `Parcel ${index + 1}`;
  const issues: string[] = [];

  if ((parcel.sequence ?? index + 1) !== index + 1) {
    issues.push(`${label}: sequence must be ${index + 1}`);
  }

  if (!Number.isFinite(parcel.weightKg) || parcel.weightKg <= 0) {
    issues.push(`${label}: weight must be greater than zero`);
  }

  for (const [fieldName, value] of [
    ["length", parcel.lengthCm],
    ["width", parcel.widthCm],
    ["height", parcel.heightCm]
  ] as const) {
    if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) {
      issues.push(`${label}: ${fieldName} must be greater than zero`);
    }
  }

  // Each parcel declares its goods as individual items so customs gets an HSN code
  // per item. Legacy parcels carry only contentsDescription and surface here as a
  // single item, which keeps them checkable without a migration.
  const items = normalizeParcelItems(parcel);
  if (!items.length) {
    issues.push(`${label}: at least one content item is required`);
  }

  items.forEach((item, itemIndex) => {
    const itemLabel = `${label} item ${itemIndex + 1}`;
    if (!hasText(item.description)) {
      issues.push(`${itemLabel}: description is required`);
    } else {
      const restricted = findRestrictedCategories(item.description);
      if (restricted.length) {
        issues.push(`${itemLabel}: ${restricted.join(", ")} is a restricted item and cannot be shipped`);
      }
    }
    // A blank HS code is only an issue where the code is required. Shipments
    // booked before HS capture existed have none, and an amendment to one of
    // those must not be blocked by a field that did not exist at booking time.
    if (!hasText(item.hsnCode)) {
      if (requireItemHsnCodes) issues.push(`${itemLabel}: HS code is required`);
    } else if (!isValidHsnCode(item.hsnCode)) {
      // A present but malformed code is always rejected, legacy or not.
      issues.push(`${itemLabel}: enter a valid 4, 6, 8 or 10 digit HS code`);
    }

    // Quantity and unit rate print on the customs invoice, so they are demanded
    // alongside the HS code and skipped on the same legacy path.
    if (requireItemHsnCodes) {
      if (!(item.quantity > 0)) issues.push(`${itemLabel}: quantity must be greater than zero`);
      if (!(item.unitRate > 0)) issues.push(`${itemLabel}: unit rate must be greater than zero`);
      if (!hasText(item.unitType)) issues.push(`${itemLabel}: unit type is required`);
    }
  });

  if (!shipmentContentTypeValues.includes(parcel.shipmentContentType)) {
    issues.push(`${label}: shipment content type is required`);
  }

  // The customer's own reference is required for new bookings; it is skipped on
  // the legacy amendment path alongside HS codes, quantity and unit rate.
  if (requireItemHsnCodes && !hasText(parcel.shipmentReference1)) {
    issues.push(`${label}: reference is required`);
  }

  return issues;
}

export function validateShipmentDraftFields(
  draft: IShipmentDraft,
  options: {
    requireValidatedAddress?: boolean;
    requireConsignorDetails?: boolean;
    requireItemHsnCodes?: boolean;
  } = {}
): string[] {
  const issues: string[] = [];
  const address = draft.consigneeEnteredAddress;

  // Amendments run against shipments booked before consignor capture existed, so
  // the caller opts out rather than blocking those with retroactive issues.
  if (options.requireConsignorDetails !== false) {
    issues.push(...validateConsignor(draft));
    issues.push(...validateConsignorConsigneeAreDistinct(draft));
    issues.push(...validateKycDocuments(draft));
  }

  if (!hasText(address.contactName)) issues.push("Contact name is required");
  if (!hasText(address.mobileCountryCode)) issues.push("Mobile country code is required");
  if (!hasText(address.mobileNumber)) issues.push("Mobile number is required");
  if (!hasText(address.countryCode)) issues.push("Country is required");
  if (hasText(address.countryCode) && !/^[A-Z]{2}$/.test(address.countryCode.trim().toUpperCase())) {
    issues.push("Select a valid destination country");
  }
  if (!hasText(address.postcode)) issues.push("Postcode is required");
  if (
    address.countryCode?.trim().toUpperCase() === "GB"
    && hasText(address.postcode)
    && !ukPostcodePattern.test(address.postcode.trim().toUpperCase())
  ) {
    issues.push("Enter a valid UK postcode");
  }
  if (!hasText(address.addressLine1)) issues.push("Address line 1 is required");
  if (!hasText(address.townOrCity)) issues.push("Town or city is required");

  const phoneNumber = parsePhoneNumberFromString(`${address.mobileCountryCode}${address.mobileNumber}`);
  if (hasText(address.mobileCountryCode) && hasText(address.mobileNumber) && !phoneNumber?.isValid()) {
    issues.push("Enter a valid mobile number including its country code");
  }

  const email = address.email ?? "";
  if (!hasText(email)) {
    issues.push("Email is required");
  } else if (!emailPattern.test(email.trim())) {
    issues.push("Enter a valid email address");
  }

  if (!draft.parcelList.length) {
    issues.push("At least one parcel is required");
  }

  if (draft.parcelList.length > 10) {
    issues.push("Number of Parcels (PCS) must be 10 or fewer");
  }

  if ((draft.parcelCount ?? draft.parcelList.length) !== draft.parcelList.length) {
    issues.push("Number of Parcels (PCS) must match the number of parcel records");
  }

  const sequences = new Set<number>();
  draft.parcelList.forEach((parcel) => {
    const sequence = parcel.sequence ?? sequences.size + 1;
    if (sequences.has(sequence)) issues.push(`Parcel sequence ${sequence} is duplicated`);
    sequences.add(sequence);
  });

  draft.parcelList.forEach((parcel, index) => {
    issues.push(...validateParcel(parcel, index, options.requireItemHsnCodes !== false));
  });

  if (options.requireValidatedAddress && draft.addressValidationStatus !== "VALIDATED") {
    issues.push("Address has not been validated");
  }

  return issues;
}
