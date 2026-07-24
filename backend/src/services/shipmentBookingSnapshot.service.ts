import type { IBranch } from "../models/branch.model.js";
import type { IBusinessAccount } from "../models/businessAccount.model.js";
import type { IInvoiceUpload } from "../models/invoiceUpload.model.js";
import type { IShipmentDraft } from "../models/shipmentDraft.model.js";
import type { ShipmentPricingEstimate } from "./shipmentPricing.service.js";
import type { ShipmentLabelData } from "./shipmentLabelPdf.service.js";
import { formatSwiftlineParcelNumber } from "./swiftlineTracking.service.js";

export type ShipmentBookingSnapshot = {
  version: 1;
  bookedAt: string;
  source: {
    invoiceNumber: string;
    shipmentReference: string;
  };
  account: Record<string, unknown>;
  sender: Record<string, unknown>;
  consignee: IShipmentDraft["consigneeEnteredAddress"];
  service: {
    type: string;
    code: string;
  };
  tracking: {
    swiftlineTrackingNumber: string;
    carrierShipmentId: string;
    carrierTransactionId: string;
    providerMode: string;
  };
  parcels: Array<Record<string, unknown> & {
    sequence: number;
    actualWeightKg: number;
    carrierParcelNumber: string;
    swiftlineParcelNumber: string;
  }>;
  pricing: ShipmentPricingEstimate;
  payment: {
    currency: "INR";
    totalAmountMinor: number;
    advanceAmountMinor: number;
    creditAmountMinor: number;
  };
};

export function readShipmentBookingSnapshot(value: unknown): ShipmentBookingSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ShipmentBookingSnapshot>;
  if (
    candidate.version !== 1
    || !candidate.source
    || !candidate.tracking
    || !candidate.payment
    || !candidate.pricing
    || !Array.isArray(candidate.parcels)
  ) {
    return null;
  }
  return candidate as ShipmentBookingSnapshot;
}

export function serializeShipmentBookingConfirmation(value: unknown) {
  const snapshot = readShipmentBookingSnapshot(value);
  if (!snapshot) return null;

  const customerReference = snapshot.parcels.find((parcel) => (
    typeof parcel.reference === "string" && Boolean(parcel.reference.trim())
  ))?.reference;

  return {
    swiftlineTrackingNumber: snapshot.tracking.swiftlineTrackingNumber,
    carrierShipmentId: snapshot.tracking.carrierShipmentId,
    providerMode: snapshot.tracking.providerMode,
    shipmentReference: snapshot.source.shipmentReference,
    customerReference: typeof customerReference === "string" ? customerReference : "",
    serviceType: snapshot.service.type,
    serviceCode: snapshot.service.code,
    parcelCount: snapshot.parcels.length,
    totalActualWeightKg: snapshot.parcels.reduce((total, parcel) => total + parcel.actualWeightKg, 0),
    baseAmountMinor: Math.round(snapshot.pricing.baseAmount * 100),
    gstAmountMinor: Math.round(snapshot.pricing.gstAmount * 100),
    totalAmountMinor: snapshot.payment.totalAmountMinor,
    advanceAmountMinor: snapshot.payment.advanceAmountMinor,
    creditAmountMinor: snapshot.payment.creditAmountMinor
  };
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildShipmentBookingSnapshot(input: {
  draft: IShipmentDraft;
  invoiceUpload: IInvoiceUpload;
  account: IBusinessAccount;
  branch: IBranch;
  pricing: ShipmentPricingEstimate;
  serviceCode: string;
  bookedAt: Date;
  swiftlineTrackingNumber: string;
  carrierShipmentId: string;
  carrierTransactionId: string;
  carrierParcelNumbers: string[];
  providerMode: string;
  advanceAmountMinor?: number;
  creditAmountMinor?: number;
}): ShipmentBookingSnapshot {
  const consignee = input.draft.consigneeValidatedAddress ?? input.draft.consigneeEnteredAddress;
  return plain({
    version: 1,
    bookedAt: input.bookedAt.toISOString(),
    source: {
      invoiceNumber: input.invoiceUpload.invoiceNumber,
      shipmentReference: input.invoiceUpload.shipmentReference
    },
    account: {
      id: input.account._id,
      accountId: input.account.accountId,
      contact: input.account.contact,
      company: input.account.company
    },
    sender: {
      branchId: input.branch._id,
      name: input.branch.name,
      code: input.branch.code,
      gstin: input.branch.gstin ?? "",
      invoiceSacCode: input.branch.invoiceSacCode ?? "",
      baseCurrency: input.branch.baseCurrency ?? "INR",
      address: input.branch.address,
      contact: input.branch.contact
    },
    consignee,
    service: {
      type: input.draft.serviceType,
      code: input.serviceCode
    },
    tracking: {
      swiftlineTrackingNumber: input.swiftlineTrackingNumber,
      carrierShipmentId: input.carrierShipmentId,
      carrierTransactionId: input.carrierTransactionId,
      providerMode: input.providerMode
    },
    parcels: input.draft.parcelList.map((parcel, index) => ({
      sequence: index + 1,
      actualWeightKg: parcel.weightKg,
      lengthCm: parcel.lengthCm ?? null,
      widthCm: parcel.widthCm ?? null,
      heightCm: parcel.heightCm ?? null,
      shipmentContentType: parcel.shipmentContentType,
      contentsDescription: parcel.contentsDescription,
      reference: parcel.shipmentReference1 ?? "",
      carrierParcelNumber: input.carrierParcelNumbers[index] ?? "",
      swiftlineParcelNumber: formatSwiftlineParcelNumber(input.swiftlineTrackingNumber, index)
    })),
    pricing: input.pricing,
    payment: {
      currency: "INR",
      totalAmountMinor: Math.round(input.pricing.totalAmount * 100),
      advanceAmountMinor: input.advanceAmountMinor ?? 0,
      creditAmountMinor: input.creditAmountMinor ?? Math.round(input.pricing.totalAmount * 100)
    }
  });
}

export function buildRevisedShipmentSnapshot(input: {
  previousSnapshot: ShipmentBookingSnapshot;
  draft: IShipmentDraft;
  pricing: ShipmentPricingEstimate;
  advanceAmountMinor: number;
  creditAmountMinor: number;
}): ShipmentBookingSnapshot {
  if (input.draft.parcelList.length !== input.previousSnapshot.parcels.length) {
    throw new Error("AMENDED_PARCEL_COUNT_MISMATCH");
  }

  const consignee = input.draft.consigneeValidatedAddress ?? input.draft.consigneeEnteredAddress;
  return plain({
    ...input.previousSnapshot,
    consignee,
    service: {
      ...input.previousSnapshot.service,
      type: input.draft.serviceType
    },
    parcels: input.draft.parcelList.map((parcel, index) => ({
      sequence: index + 1,
      actualWeightKg: parcel.weightKg,
      lengthCm: parcel.lengthCm ?? null,
      widthCm: parcel.widthCm ?? null,
      heightCm: parcel.heightCm ?? null,
      shipmentContentType: parcel.shipmentContentType,
      contentsDescription: parcel.contentsDescription,
      reference: parcel.shipmentReference1 ?? "",
      carrierParcelNumber: input.previousSnapshot.parcels[index]?.carrierParcelNumber ?? "",
      swiftlineParcelNumber: formatSwiftlineParcelNumber(
        input.previousSnapshot.tracking.swiftlineTrackingNumber,
        index
      )
    })),
    pricing: input.pricing,
    payment: {
      currency: "INR",
      totalAmountMinor: Math.round(input.pricing.totalAmount * 100),
      advanceAmountMinor: input.advanceAmountMinor,
      creditAmountMinor: input.creditAmountMinor
    }
  });
}

function compactAddressLines(values: unknown[]) {
  return values.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

export function bookingSnapshotToLabelData(
  snapshot: ShipmentBookingSnapshot,
  parcelIndex: number,
  labelType: "DPD" | "SWIFTLINE"
): ShipmentLabelData {
  const parcel = snapshot.parcels[parcelIndex];
  const sender = snapshot.sender as {
    name?: string;
    code?: string;
    address?: Record<string, unknown>;
    contact?: Record<string, unknown>;
  };
  const consignee = snapshot.consignee;
  const senderAddress = sender.address ?? {};

  return {
    swiftlineTrackingNumber: snapshot.tracking.swiftlineTrackingNumber,
    parcelNumber: labelType === "DPD"
      ? parcel?.carrierParcelNumber ?? ""
      : parcel?.swiftlineParcelNumber ?? "",
    parcelIndex,
    parcelCount: snapshot.parcels.length,
    weightKg: parcel?.actualWeightKg ?? 0,
    serviceCode: snapshot.service.code,
    shipmentReference: snapshot.source.shipmentReference,
    customerReference: typeof parcel?.reference === "string" ? parcel.reference : "",
    generatedAt: new Date(snapshot.bookedAt),
    consignee: {
      name: String(consignee.companyName || consignee.contactName || "Consignee"),
      contactName: String(consignee.contactName || ""),
      addressLines: compactAddressLines([
        consignee.addressLine1,
        consignee.addressLine2,
        consignee.townOrCity,
        consignee.county
      ]),
      postcode: String(consignee.postcode || ""),
      countryCode: String(consignee.countryCode || ""),
      countryName: String(consignee.countryName || consignee.countryCode || "")
    },
    sender: {
      name: sender.name || "Swiftline Cargo and Express Logistics Pvt. Ltd.",
      branchCode: sender.code || "",
      addressLines: compactAddressLines([
        senderAddress.address,
        senderAddress.city,
        senderAddress.stateOrProvince,
        senderAddress.postalCode,
        senderAddress.countryName
      ]),
      phone: typeof sender.contact?.phone === "string" ? sender.contact.phone : undefined
    }
  };
}
