import type {
  IShipmentDraft,
  ShipmentAddressSnapshot,
  ShipmentConsignorSnapshot,
  ShipmentParcel
} from "../models/shipmentDraft.model.js";
import {
  getDeclaredGoodsValue,
  getParcelItemAmount,
  isValidHsnCode,
  normalizeParcelItems
} from "./parcelItems.service.js";
import type { DpdProviderConfiguration } from "./dpdProviderConfiguration.service.js";

export interface AlsDocketItem {
  actual_weight: string;
  length: string;
  width: string;
  height: string;
  number_of_boxes: "1";
}

export interface AlsFreeFormLineItem {
  total: string;
  no_of_packages: string;
  box_no: string;
  rate: string;
  hscode: string;
  description: string;
  unit_of_measurement: string;
  unit_weight: string;
  igst_amount: "0.00";
}

export interface AlsCreateDocketPayload {
  tracking_no: string;
  customer_id: number;
  origin_code: "IN";
  destination_code: string;
  product_code: "NONDOX";
  booking_date: string;
  booking_time: string;
  pcs: string;
  shipment_value: string;
  shipment_value_currency: "GBP";
  actual_weight: string;
  shipment_invoice_no: string;
  shipment_invoice_date: string;
  shipment_content: string;
  remark: string;
  entry_type: 2;
  api_service_code: string;
  new_docket_free_form_invoice: "1";
  free_form_invoice_type_id: "1";
  free_form_currency: "GBP";
  terms_of_trade: "CFR";
  free_form_note_master_code: 0;
  shipper_name: string;
  shipper_company_name: string;
  shipper_contact_no: string;
  shipper_email: string;
  shipper_address_line_1: string;
  shipper_address_line_2: string;
  shipper_address_line_3: string;
  shipper_city: string;
  shipper_state: string;
  shipper_country: "IN";
  shipper_zip_code: string;
  shipper_gstin_type: string;
  shipper_gstin_no: string;
  consignee_name: string;
  consignee_company_name: string;
  consignee_contact_no: string;
  consignee_email: string;
  consignee_address_line_1: string;
  consignee_address_line_2: string;
  consignee_address_line_3: string;
  consignee_city: string;
  consignee_state: string;
  consignee_country: string;
  consignee_zip_code: string;
  consignee_gstin_type: string;
  consignee_gstin_no: string;
  docket_items: AlsDocketItem[];
  free_form_line_items: AlsFreeFormLineItem[];
}

export class AlsPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlsPayloadError";
  }
}

function required(value: string | undefined, label: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new AlsPayloadError(`${label} is required for ALS booking.`);
  return normalized;
}

function truncate(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

function digitsOnly(...parts: Array<string | undefined>) {
  return parts.join("").replace(/\D/g, "");
}

function decimal(value: number) {
  return value.toFixed(2);
}

function alsUnitOfMeasurement(value: string) {
  const units: Record<string, string> = {
    Pkt: "PKT",
    Pcs: "PC",
    Set: "SET",
    Box: "BOX",
    Kg: "KG",
    Pair: "PAIR"
  };
  return units[value] ?? value.trim().toUpperCase();
}

function freeFormLineItems(parcels: ShipmentParcel[], inrPerGbp: number): AlsFreeFormLineItem[] {
  return parcels.flatMap((parcel, parcelIndex) => {
    const items = normalizeParcelItems(parcel);
    if (!items.length) {
      throw new AlsPayloadError(`Parcel ${parcelIndex + 1} requires at least one goods item for the ALS shipment invoice.`);
    }

    const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isFinite(totalUnits) || totalUnits <= 0) {
      throw new AlsPayloadError(`Parcel ${parcelIndex + 1} item quantities must be greater than zero for the ALS shipment invoice.`);
    }
    const unitWeight = parcel.weightKg / totalUnits;

    return items.map((item, itemIndex) => {
      const itemLabel = `Parcel ${parcelIndex + 1} item ${itemIndex + 1}`;
      if (!item.description.trim()) throw new AlsPayloadError(`${itemLabel} description is required for the ALS shipment invoice.`);
      if (!isValidHsnCode(item.hsnCode)) throw new AlsPayloadError(`${itemLabel} requires a valid HS code for the ALS shipment invoice.`);
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new AlsPayloadError(`${itemLabel} quantity must be greater than zero for the ALS shipment invoice.`);
      if (!Number.isFinite(item.unitRate) || item.unitRate <= 0) throw new AlsPayloadError(`${itemLabel} unit value must be greater than zero for the ALS shipment invoice.`);
      if (!item.unitType.trim()) throw new AlsPayloadError(`${itemLabel} unit type is required for the ALS shipment invoice.`);

      return {
        total: decimal(getParcelItemAmount(item) / inrPerGbp),
        no_of_packages: String(item.quantity),
        box_no: String(parcel.sequence || parcelIndex + 1),
        rate: decimal(item.unitRate / inrPerGbp),
        hscode: item.hsnCode,
        description: truncate(item.description, 120),
        unit_of_measurement: truncate(alsUnitOfMeasurement(item.unitType), 12),
        unit_weight: decimal(unitWeight),
        igst_amount: "0.00" as const
      };
    });
  });
}

function indiaDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ""
  );

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}:${part("second")}`
  };
}

function consigneeAddress(draft: IShipmentDraft): ShipmentAddressSnapshot {
  return draft.consigneeValidatedAddress ?? draft.consigneeEnteredAddress;
}

function shipperFields(shipper: ShipmentConsignorSnapshot) {
  const contactName = required(shipper.contactName || shipper.companyName, "Shipper name");
  const companyName = required(shipper.companyName || shipper.contactName, "Shipper company name");
  const city = required(shipper.townOrCity, "Shipper city");
  const aadhaar = (shipper.aadhaarNumber ?? "").replace(/\D/g, "");

  return {
    shipper_name: truncate(contactName, 120),
    shipper_company_name: truncate(companyName, 120),
    shipper_contact_no: required(
      digitsOnly(shipper.mobileCountryCode, shipper.mobileNumber),
      "Shipper phone number"
    ),
    shipper_email: truncate(required(shipper.email, "Shipper email"), 160),
    shipper_address_line_1: truncate(required(shipper.addressLine1, "Shipper address line 1"), 120),
    shipper_address_line_2: truncate(shipper.addressLine2 || city, 120),
    shipper_address_line_3: "",
    shipper_city: truncate(city, 80),
    shipper_state: truncate(shipper.county || city, 80),
    shipper_country: "IN" as const,
    shipper_zip_code: truncate(required(shipper.postcode, "Shipper postcode"), 20),
    shipper_gstin_type: aadhaar ? "Aadhaar Number" : "",
    shipper_gstin_no: aadhaar
  };
}

function consigneeFields(consignee: ShipmentAddressSnapshot) {
  const contactName = required(consignee.contactName || consignee.companyName, "Consignee name");
  const companyName = required(consignee.companyName || consignee.contactName, "Consignee company name");
  const city = required(consignee.townOrCity, "Consignee city");

  return {
    consignee_name: truncate(contactName, 120),
    consignee_company_name: truncate(companyName, 120),
    consignee_contact_no: required(
      digitsOnly(consignee.mobileCountryCode, consignee.mobileNumber),
      "Consignee phone number"
    ),
    consignee_email: truncate(required(consignee.email, "Consignee email"), 160),
    consignee_address_line_1: truncate(required(consignee.addressLine1, "Consignee address line 1"), 120),
    consignee_address_line_2: truncate(consignee.addressLine2 || city, 120),
    consignee_address_line_3: "",
    consignee_city: truncate(city, 80),
    consignee_state: truncate(consignee.county || city, 80),
    consignee_country: required(consignee.countryCode, "Consignee country code").toUpperCase(),
    consignee_zip_code: truncate(required(consignee.postcode, "Consignee postcode"), 20),
    consignee_gstin_type: "",
    consignee_gstin_no: ""
  };
}

export function buildAlsCreateDocketPayload(input: {
  draft: IShipmentDraft;
  configuration: DpdProviderConfiguration;
  customerId: number;
  trackingNumber: string;
  bookedAt: Date;
}): AlsCreateDocketPayload {
  const { draft, configuration, customerId, trackingNumber, bookedAt } = input;
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new AlsPayloadError("ALS authentication did not return a valid customer ID.");
  }
  if (configuration.als.serviceCode !== "DPD UK NEXTDAY") {
    throw new AlsPayloadError("ALS service must be configured as DPD UK NEXTDAY for this release.");
  }

  const inrPerGbp = configuration.als.inrPerGbp ?? 0;
  if (!Number.isFinite(inrPerGbp) || inrPerGbp <= 0) {
    throw new AlsPayloadError("ALS_INR_PER_GBP must be configured before live booking.");
  }

  const declaredGoodsValueInr = getDeclaredGoodsValue(draft.parcelList);
  if (declaredGoodsValueInr <= 0) {
    throw new AlsPayloadError("Declared goods value must be greater than zero for ALS booking.");
  }

  const declaredGoodsValueGbp = Math.max(0.01, declaredGoodsValueInr / inrPerGbp);
  const totalWeight = draft.parcelList.reduce((sum, parcel) => sum + parcel.weightKg, 0);
  const booking = indiaDateParts(bookedAt);
  const invoiceDate = indiaDateParts(bookedAt).date;
  const descriptions = [...new Set(draft.parcelList
    .map((parcel) => parcel.contentsDescription.trim())
    .filter(Boolean))];
  const consignee = consigneeAddress(draft);
  const invoiceLineItems = freeFormLineItems(draft.parcelList, inrPerGbp);

  return {
    tracking_no: required(trackingNumber, "Swiftline tracking number"),
    customer_id: customerId,
    origin_code: "IN",
    destination_code: required(consignee.countryCode, "Destination country").toUpperCase(),
    product_code: "NONDOX",
    booking_date: booking.date,
    booking_time: booking.time,
    pcs: String(draft.parcelList.length),
    shipment_value: decimal(declaredGoodsValueGbp),
    shipment_value_currency: "GBP",
    actual_weight: decimal(totalWeight),
    // ALS requires an invoice/reference number even though Swiftline issues its
    // own INR invoice after booking. The master tracking number is unique and
    // avoids coupling the carrier request to that later accounting document.
    shipment_invoice_no: truncate(required(trackingNumber, "Shipment invoice reference"), 80),
    shipment_invoice_date: invoiceDate,
    shipment_content: truncate(required(descriptions.join(", "), "Shipment contents"), 250),
    remark: truncate(consignee.deliveryInstructions || "", 250),
    entry_type: 2,
    api_service_code: configuration.als.serviceCode,
    // ALS requires customs invoice data for this India-to-UK service. Swiftline
    // still creates and stores its separate customer/accounting invoice in INR.
    new_docket_free_form_invoice: "1",
    free_form_invoice_type_id: "1",
    free_form_currency: "GBP",
    terms_of_trade: "CFR",
    free_form_note_master_code: 0,
    ...shipperFields(draft.consignorAddress),
    ...consigneeFields(consignee),
    docket_items: draft.parcelList.map((parcel, index) => {
      if (!parcel.lengthCm || !parcel.widthCm || !parcel.heightCm) {
        throw new AlsPayloadError(`Parcel ${index + 1} dimensions are required for ALS booking.`);
      }

      return {
        actual_weight: decimal(parcel.weightKg),
        length: decimal(parcel.lengthCm),
        width: decimal(parcel.widthCm),
        height: decimal(parcel.heightCm),
        number_of_boxes: "1" as const
      };
    }),
    free_form_line_items: invoiceLineItems
  };
}

export function sanitizeAlsRequestSnapshot(payload: AlsCreateDocketPayload): Record<string, unknown> {
  return {
    ...payload,
    shipper_contact_no: payload.shipper_contact_no ? "[redacted-phone]" : "",
    shipper_email: payload.shipper_email ? "[redacted-email]" : "",
    shipper_gstin_no: payload.shipper_gstin_no ? "[redacted-id]" : "",
    consignee_contact_no: payload.consignee_contact_no ? "[redacted-phone]" : "",
    consignee_email: payload.consignee_email ? "[redacted-email]" : ""
  };
}
