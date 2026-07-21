import { parsePhoneNumberFromString } from "libphonenumber-js";
import { shipmentContentTypeValues, type IShipmentDraft, type ShipmentParcel } from "../models/shipmentDraft.model.js";

const ukPostcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/;

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validateParcel(parcel: ShipmentParcel, index: number): string[] {
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

  if (!hasText(parcel.contentsDescription)) {
    issues.push(`${label}: contents description is required`);
  }

  if (!shipmentContentTypeValues.includes(parcel.shipmentContentType)) {
    issues.push(`${label}: shipment content type is required`);
  }

  return issues;
}

export function validateShipmentDraftFields(
  draft: IShipmentDraft,
  options: { requireValidatedAddress?: boolean } = {}
): string[] {
  const issues: string[] = [];
  const address = draft.consigneeEnteredAddress;

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
  if (hasText(email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
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
    issues.push(...validateParcel(parcel, index));
  });

  if (options.requireValidatedAddress && draft.addressValidationStatus !== "VALIDATED") {
    issues.push("Address has not been validated");
  }

  return issues;
}
