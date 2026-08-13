import type { IShipmentDraft, ShipmentAddressSnapshot } from "../models/shipmentDraft.model.js";
import { carrierShipmentSourceIdentity } from "./shipmentSourceIdentity.service.js";

export interface DpdPayloadConfiguration {
  businessUnitCode: string;
  customerId: string;
  senderAddressId: string;
  depotCode?: string;
  defaultServiceCode: string;
  defaultLabelSize: "A4" | "A6";
  defaultPrintFormat: "PDF" | "ZPL";
}

export interface DpdShipmentPayload {
  mode: "printed";
  businessUnitCode: string;
  customerId: string;
  senderAddressId: string;
  depotCode?: string;
  serviceCode: string;
  label: {
    size: string;
    format: string;
  };
  references: {
    invoiceNumber: string;
    shipmentReference?: string;
    reference1?: string;
    reference2?: string;
  };
  consignee: {
    companyName?: string;
    contactName: string;
    email?: string;
    phone: string;
    countryCode: string;
    postcode: string;
    addressLine1: string;
    addressLine2?: string;
    townOrCity: string;
    county?: string;
    deliveryInstructions?: string;
  };
  parcels: Array<{
    sequence: number;
    weightKg: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    shipmentContentType: string;
    contentsDescription: string;
  }>;
}

function getConsigneeAddress(draft: IShipmentDraft): ShipmentAddressSnapshot {
  return draft.consigneeValidatedAddress ?? draft.consigneeEnteredAddress;
}

export function mapShipmentDraftToDpdPayload(
  draft: IShipmentDraft,
  configuration: DpdPayloadConfiguration
): DpdShipmentPayload {
  const address = getConsigneeAddress(draft);
  const firstParcel = draft.parcelList[0];
  // The customer's reference entered on the shipment form is forwarded to DPD
  // when supplied; carrierShipmentSourceIdentity provides a stable fallback.
  const customerReference = firstParcel?.shipmentReference1?.trim() || undefined;
  const sourceIdentity = carrierShipmentSourceIdentity(draft);

  return {
    mode: "printed",
    businessUnitCode: configuration.businessUnitCode,
    customerId: configuration.customerId,
    senderAddressId: configuration.senderAddressId,
    depotCode: configuration.depotCode || undefined,
    serviceCode: draft.serviceCode || configuration.defaultServiceCode,
    label: {
      size: configuration.defaultLabelSize,
      format: configuration.defaultPrintFormat
    },
    references: {
      invoiceNumber: sourceIdentity.invoiceNumber,
      shipmentReference: sourceIdentity.shipmentReference,
      reference1: customerReference,
      reference2: undefined
    },
    consignee: {
      companyName: address.companyName || undefined,
      contactName: address.contactName ?? "",
      email: address.email || undefined,
      phone: `${address.mobileCountryCode ?? ""}${address.mobileNumber ?? ""}`,
      countryCode: address.countryCode.trim().toUpperCase(),
      postcode: address.postcode,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 || undefined,
      townOrCity: address.townOrCity,
      county: address.county || undefined,
      deliveryInstructions: address.deliveryInstructions || undefined
    },
    parcels: draft.parcelList.map((parcel, index) => ({
      sequence: parcel.sequence ?? index + 1,
      weightKg: parcel.weightKg,
      lengthCm: parcel.lengthCm,
      widthCm: parcel.widthCm,
      heightCm: parcel.heightCm,
      shipmentContentType: parcel.shipmentContentType,
      contentsDescription: parcel.contentsDescription
    }))
  };
}

export function sanitizeDpdRequestSnapshot(payload: DpdShipmentPayload): Record<string, unknown> {
  return {
    ...payload,
    consignee: {
      ...payload.consignee,
      email: payload.consignee.email ? "[redacted-email]" : undefined,
      phone: payload.consignee.phone ? "[redacted-phone]" : undefined
    }
  };
}
