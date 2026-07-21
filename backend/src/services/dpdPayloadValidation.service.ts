import type { DpdPayloadConfiguration, DpdShipmentPayload } from "./dpdPayloadMapper.service.js";

const supportedLabelSizes = new Set(["A4", "A6"]);
const supportedPrintFormats = new Set(["PDF", "ZPL"]);
const supportedShipmentContentTypes = new Set(["DOCUMENTS", "PARCEL", "MERCHANDISE", "SAMPLES", "GIFTS", "RETURNS", "OTHER"]);
const ukPostcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/;

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function checkMaxLength(value: string | undefined, maxLength: number, label: string, issues: string[]) {
  if (value && value.length > maxLength) {
    issues.push(`${label} must be ${maxLength} characters or fewer`);
  }
}

export function validateDpdPayload(
  payload: DpdShipmentPayload,
  configuration: DpdPayloadConfiguration & { active: boolean }
): string[] {
  const issues: string[] = [];

  if (!configuration.active) issues.push("The global DPD provider is unavailable");
  if (!hasText(payload.businessUnitCode)) issues.push("DPD business unit code is required");
  if (!hasText(payload.customerId)) issues.push("DPD customer ID is required");
  if (!hasText(payload.senderAddressId)) issues.push("DPD sender address ID is required");
  if (!hasText(payload.serviceCode)) issues.push("DPD service code is required");
  if (!supportedLabelSizes.has(payload.label.size)) issues.push("DPD label size must be A4 or A6");
  if (!supportedPrintFormats.has(payload.label.format)) issues.push("DPD print format must be PDF or ZPL");
  if (payload.mode !== "printed") issues.push("DPD save mode must be printed for v1 label creation");

  if (!hasText(payload.references.invoiceNumber)) issues.push("Invoice number is required");
  if (!hasText(payload.references.shipmentReference)) issues.push("Shipment reference is required");

  checkMaxLength(payload.references.invoiceNumber, 80, "Invoice number", issues);
  checkMaxLength(payload.references.shipmentReference, 120, "Shipment reference", issues);
  checkMaxLength(payload.references.reference1, 120, "Shipment reference 1", issues);
  checkMaxLength(payload.references.reference2, 120, "Shipment reference 2", issues);

  if (!hasText(payload.consignee.contactName)) issues.push("Consignee contact name is required");
  if (!hasText(payload.consignee.phone)) issues.push("Consignee mobile number is required");
  if (!/^[A-Z]{2}$/.test(payload.consignee.countryCode)) issues.push("Consignee country code must be a two-letter ISO code");
  if (!hasText(payload.consignee.postcode)) issues.push("Consignee postcode is required");
  if (
    payload.consignee.countryCode === "GB"
    && hasText(payload.consignee.postcode)
    && !ukPostcodePattern.test(payload.consignee.postcode.toUpperCase())
  ) {
    issues.push("Consignee postcode must be a valid UK postcode");
  }
  if (!hasText(payload.consignee.addressLine1)) issues.push("Consignee address line 1 is required");
  if (!hasText(payload.consignee.townOrCity)) issues.push("Consignee town or city is required");

  checkMaxLength(payload.consignee.companyName, 120, "Consignee company name", issues);
  checkMaxLength(payload.consignee.contactName, 120, "Consignee contact name", issues);
  checkMaxLength(payload.consignee.email, 160, "Consignee email", issues);
  checkMaxLength(payload.consignee.phone, 30, "Consignee mobile number", issues);
  checkMaxLength(payload.consignee.addressLine1, 120, "Consignee address line 1", issues);
  checkMaxLength(payload.consignee.addressLine2, 120, "Consignee address line 2", issues);
  checkMaxLength(payload.consignee.townOrCity, 80, "Consignee town or city", issues);
  checkMaxLength(payload.consignee.county, 80, "Consignee county", issues);
  checkMaxLength(payload.consignee.deliveryInstructions, 500, "Delivery instructions", issues);

  if (!payload.parcels.length) {
    issues.push("At least one parcel is required");
  }

  if (payload.parcels.length > 10) {
    issues.push("Number of Parcels (PCS) must be 10 or fewer");
  }

  payload.parcels.forEach((parcel, index) => {
    const label = `Parcel ${index + 1}`;

    if (parcel.sequence !== index + 1) {
      issues.push(`${label}: sequence must be ${index + 1}`);
    }

    if (!Number.isFinite(parcel.weightKg) || parcel.weightKg <= 0) {
      issues.push(`${label}: weight must be greater than zero`);
    }

    for (const [field, value] of [
      ["length", parcel.lengthCm],
      ["width", parcel.widthCm],
      ["height", parcel.heightCm]
    ] as const) {
      if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) {
        issues.push(`${label}: ${field} must be greater than zero`);
      }
    }

    if (!hasText(parcel.contentsDescription)) issues.push(`${label}: contents description is required`);
    checkMaxLength(parcel.contentsDescription, 120, `${label}: contents description`, issues);
    if (!supportedShipmentContentTypes.has(parcel.shipmentContentType)) {
      issues.push(`${label}: shipment content type is required`);
    }
  });

  return issues;
}
