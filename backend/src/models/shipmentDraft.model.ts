import mongoose from "mongoose";
import { csbTypeValues, type CsbType } from "../services/csbType.service.js";
import {
  composeContentsDescription,
  defaultParcelItemUnitType,
  normalizeParcelItems
} from "../services/parcelItems.service.js";
import { defaultDeclarationNote } from "../services/customsInvoice/customsInvoiceConstants.js";

export const addressValidationStatusValues = [
  "NOT_VALIDATED",
  "VALIDATED",
  "CORRECTION_SUGGESTED",
  "INCOMPLETE",
  "UNAVAILABLE"
] as const;

/** Who the shipment is for: an onboarded business, or a walk-in individual. */
export const shipmentCustomerTypeValues = ["BUSINESS", "INDIVIDUAL"] as const;
export type ShipmentCustomerType = (typeof shipmentCustomerTypeValues)[number];

export const shipmentDraftStatusValues = [
  "NEEDS_REVIEW",
  "ADDRESS_INCOMPLETE",
  "ADDRESS_VALIDATED",
  "VALIDATION_FAILED",
  "READY_FOR_DPD"
] as const;

export const shipmentDraftBookingStateValues = [
  "EDITABLE",
  "BOOKING",
  "BOOKED",
  "REVIEW_REQUIRED"
] as const;

export type AddressValidationStatus = (typeof addressValidationStatusValues)[number];
export type ShipmentDraftStatus = (typeof shipmentDraftStatusValues)[number];
export type ShipmentDraftBookingState = (typeof shipmentDraftBookingStateValues)[number];
export const shipmentContentTypeValues = [
  "DOCUMENTS",
  "PARCEL",
  "MERCHANDISE",
  "SAMPLES",
  "GIFTS",
  "RETURNS",
  "OTHER"
] as const;
export type ShipmentContentType = (typeof shipmentContentTypeValues)[number];
export const shipmentServiceTypeValues = ["COURIER", "CARGO"] as const;
export type ShipmentServiceType = (typeof shipmentServiceTypeValues)[number];

export const shipmentKycDocumentTypeValues = ["aadhaar", "pan", "other"] as const;
export type ShipmentKycDocumentType = (typeof shipmentKycDocumentTypeValues)[number];

// Consignors are always Indian senders, so the country and dialling code are
// fixed rather than user selectable.
export const consignorCountryCode = "IN";
export const consignorCountryName = "India";
export const consignorMobileCountryCode = "+91";

export interface ShipmentAddressSnapshot {
  companyName?: string;
  contactName?: string;
  email?: string;
  mobileCountryCode?: string;
  mobileNumber?: string;
  countryCode: string;
  countryName?: string;
  postcode: string;
  addressLine1: string;
  addressLine2?: string;
  townOrCity: string;
  county?: string;
  deliveryInstructions?: string;
}

export interface ShipmentConsignorSnapshot {
  companyName?: string;
  contactName?: string;
  email?: string;
  mobileCountryCode?: string;
  mobileNumber?: string;
  aadhaarNumber?: string;
  countryCode: string;
  countryName?: string;
  postcode: string;
  addressLine1: string;
  addressLine2?: string;
  townOrCity: string;
  county?: string;
  pickupInstructions?: string;
}

export interface ShipmentKycDocument {
  type: ShipmentKycDocumentType;
  documentLabel: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedAt: Date;
  uploadedBy?: mongoose.Types.ObjectId | null;
}

// One distinct good inside a parcel. Each becomes a single line on the customs
// (shipment) invoice, so it carries the HS code, unit of measure, quantity and
// unit rate customs needs. The line amount is always derived as quantity x rate.
export interface ShipmentParcelItem {
  description: string;
  hsnCode: string;
  unitType: string;
  quantity: number;
  unitRate: number;
}

export interface ShipmentParcel {
  sequence: number;
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  shipmentContentType: ShipmentContentType;
  // Individual goods with their HSN codes. `contentsDescription` below is the
  // derived single-line summary of these, kept so the EDI export, operations
  // manifest, DPD payload and labels keep reading the same field as before.
  // Optional on the type because parcels stored before items existed have none;
  // the pre-validate hook backfills them from contentsDescription on save.
  items?: ShipmentParcelItem[];
  contentsDescription: string;
  shipmentReference1?: string;
  shipmentReference2?: string;
  // Per-parcel KYC, used only when the shipment does not share one KYC set
  // across all parcels (see kycUseForAllParcels).
  aadhaarNumber?: string;
  kycDocuments?: Partial<Record<ShipmentKycDocumentType, ShipmentKycDocument>>;
}

export interface IShipmentDraft extends mongoose.Document {
  invoiceUploadId: mongoose.Types.ObjectId;
  businessAccountId: mongoose.Types.ObjectId;
  /**
   * INDIVIDUAL marks a walk-in shipment booked at the counter. Those drafts point
   * `businessAccountId` at the system sentinel rather than a real customer, and
   * the payer's identity lives in `consignorAddress`. Billing skips the credit
   * system entirely — see `individualCustomer.service.ts`.
   */
  customerType: ShipmentCustomerType;
  branchId: mongoose.Types.ObjectId;
  sender: Record<string, unknown>;
  consignorAddress: ShipmentConsignorSnapshot;
  consignorPlaceId?: string;
  // When true, the draft-level aadhaarNumber + kycDocuments apply to every parcel.
  // When false, each parcel carries its own aadhaarNumber + kycDocuments.
  kycUseForAllParcels: boolean;
  kycDocuments: Partial<Record<ShipmentKycDocumentType, ShipmentKycDocument>>;
  consigneeEnteredAddress: ShipmentAddressSnapshot;
  consigneeSelectedAddress?: ShipmentAddressSnapshot | null;
  consigneeValidatedAddress?: ShipmentAddressSnapshot | null;
  googlePlaceId?: string;
  addressValidationStatus: AddressValidationStatus;
  addressValidationResult: Record<string, unknown>;
  parcelCount: number;
  parcelList: ShipmentParcel[];
  // Customs route for the whole shipment. CSB-V attracts a flat clearance charge
  // once per shipment (see csbType.service.ts).
  csbType: CsbType;
  /**
   * Whether the customer bought optional transit cover. The premium is priced from
   * the route configuration against the declared goods value — see
   * countryRouteCharge.model.ts. Off by default: cover is never added to a
   * shipment the customer did not ask for it on.
   */
  insuranceOptIn: boolean;
  // Printed as the NOTE / NOTES block on the customs (shipment) invoice. Kept
  // separate from consignee deliveryInstructions, which go to the carrier.
  declarationNote: string;
  serviceType: ShipmentServiceType;
  serviceCode: string;
  validationIssues: string[];
  status: ShipmentDraftStatus;
  bookingState: ShipmentDraftBookingState;
  bookingAttemptId: string;
  lockedAt?: Date | null;
  /**
   * Set when an unbooked draft is deleted. Deletion is soft because a draft is
   * referenced by its InvoiceUpload, its KYC files on disk, and its AuditLog
   * rows, and because a rejected carrier booking leaves a DpdShipment pointing
   * at a draft that is once again EDITABLE.
   *
   * Every query for a live draft must filter `deletedAt: null` — including
   * lookups by `invoiceUploadId`, which stop being one-to-one once a draft has
   * been deleted and the same invoice re-uploaded.
   */
  deletedAt?: Date | null;
  deletedBy?: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const addressSnapshotSchema = new mongoose.Schema<ShipmentAddressSnapshot>(
  {
    companyName: { type: String, trim: true, maxlength: 120, default: "" },
    contactName: { type: String, trim: true, maxlength: 120, default: "" },
    email: { type: String, lowercase: true, trim: true, maxlength: 160, default: "" },
    mobileCountryCode: { type: String, trim: true, maxlength: 8, default: "" },
    mobileNumber: { type: String, trim: true, maxlength: 30, default: "" },
    // Drafts created without an invoice are intentionally incomplete until review.
    countryCode: { type: String, uppercase: true, trim: true, maxlength: 2, default: "" },
    countryName: { type: String, trim: true, maxlength: 80, default: "" },
    postcode: { type: String, uppercase: true, trim: true, maxlength: 20, default: "" },
    addressLine1: { type: String, trim: true, maxlength: 120, default: "" },
    addressLine2: { type: String, trim: true, maxlength: 120, default: "" },
    townOrCity: { type: String, trim: true, maxlength: 80, default: "" },
    county: { type: String, trim: true, maxlength: 80, default: "" },
    deliveryInstructions: { type: String, trim: true, maxlength: 500, default: "" }
  },
  { _id: false }
);

const consignorSnapshotSchema = new mongoose.Schema<ShipmentConsignorSnapshot>(
  {
    companyName: { type: String, trim: true, maxlength: 120, default: "" },
    contactName: { type: String, trim: true, maxlength: 120, default: "" },
    email: { type: String, lowercase: true, trim: true, maxlength: 160, default: "" },
    mobileCountryCode: { type: String, trim: true, maxlength: 8, default: consignorMobileCountryCode },
    mobileNumber: { type: String, trim: true, maxlength: 30, default: "" },
    // Stored as 12 digits without separators so KYC lookups stay comparable.
    aadhaarNumber: { type: String, trim: true, maxlength: 12, default: "" },
    countryCode: { type: String, uppercase: true, trim: true, maxlength: 2, default: consignorCountryCode },
    countryName: { type: String, trim: true, maxlength: 80, default: consignorCountryName },
    postcode: { type: String, uppercase: true, trim: true, maxlength: 20, default: "" },
    addressLine1: { type: String, trim: true, maxlength: 120, default: "" },
    addressLine2: { type: String, trim: true, maxlength: 120, default: "" },
    townOrCity: { type: String, trim: true, maxlength: 80, default: "" },
    county: { type: String, trim: true, maxlength: 80, default: "" },
    pickupInstructions: { type: String, trim: true, maxlength: 500, default: "" }
  },
  { _id: false }
);

const kycDocumentSchema = new mongoose.Schema<ShipmentKycDocument>(
  {
    type: { type: String, enum: shipmentKycDocumentTypeValues, required: true },
    documentLabel: { type: String, trim: true, maxlength: 80, default: "" },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    path: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { _id: false }
);

const parcelItemSchema = new mongoose.Schema<ShipmentParcelItem>(
  {
    description: { type: String, trim: true, maxlength: 120, default: "" },
    // 4, 6, 8 or 10 digit HS code. Format is enforced in validation rather than
    // here so partially completed drafts can still be saved.
    hsnCode: { type: String, trim: true, maxlength: 10, default: "" },
    unitType: { type: String, trim: true, maxlength: 12, default: defaultParcelItemUnitType },
    quantity: { type: Number, min: 0, default: 0 },
    // Per-unit declared value in the shipment currency. Line amount is derived.
    unitRate: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const parcelSchema = new mongoose.Schema<ShipmentParcel>(
  {
    sequence: { type: Number, required: true, min: 1 },
    weightKg: { type: Number, required: true, min: 0 },
    lengthCm: { type: Number, min: 0, default: null },
    widthCm: { type: Number, min: 0, default: null },
    heightCm: { type: Number, min: 0, default: null },
    shipmentContentType: {
      type: String,
      enum: shipmentContentTypeValues,
      default: "PARCEL",
      required: true
    },
    items: { type: [parcelItemSchema], default: [] },
    contentsDescription: { type: String, trim: true, maxlength: 120, default: "" },
    shipmentReference1: { type: String, trim: true, maxlength: 120, default: "" },
    shipmentReference2: { type: String, trim: true, maxlength: 120, default: "" },
    // Stored as 12 digits without separators, mirroring the consignor field.
    aadhaarNumber: { type: String, trim: true, maxlength: 12, default: "" },
    kycDocuments: {
      aadhaar: { type: kycDocumentSchema },
      pan: { type: kycDocumentSchema },
      other: { type: kycDocumentSchema }
    }
  },
  { _id: false }
);

const shipmentDraftSchema = new mongoose.Schema<IShipmentDraft>(
  {
    // Deliberately carries no `index: true`. The partial unique index declared
    // below covers this field, and declaring both makes Mongoose build a second,
    // plain `invoiceUploadId_1` that collides with it by name.
    invoiceUploadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceUpload",
      required: true
    },
    businessAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessAccount",
      required: true,
      index: true
    },
    // Defaults to BUSINESS so every existing draft keeps its meaning untouched.
    customerType: {
      type: String,
      enum: shipmentCustomerTypeValues,
      default: "BUSINESS",
      required: true,
      index: true
    },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    sender: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Drafts created before consignor capture existed keep an empty snapshot and
    // are completed during review.
    consignorAddress: { type: consignorSnapshotSchema, default: () => ({}) },
    consignorPlaceId: { type: String, trim: true, maxlength: 255, default: "" },
    kycUseForAllParcels: { type: Boolean, default: true },
    kycDocuments: {
      aadhaar: { type: kycDocumentSchema },
      pan: { type: kycDocumentSchema },
      other: { type: kycDocumentSchema }
    },
    consigneeEnteredAddress: { type: addressSnapshotSchema, required: true },
    consigneeSelectedAddress: { type: addressSnapshotSchema, default: null },
    consigneeValidatedAddress: { type: addressSnapshotSchema, default: null },
    googlePlaceId: { type: String, trim: true, maxlength: 255, default: "" },
    addressValidationStatus: {
      type: String,
      enum: addressValidationStatusValues,
      default: "NOT_VALIDATED",
      index: true
    },
    addressValidationResult: { type: mongoose.Schema.Types.Mixed, default: {} },
    parcelCount: { type: Number, required: true, min: 1, default: 1 },
    parcelList: { type: [parcelSchema], default: [] },
    // Drafts created before CSB selection existed default to CSB-IV so their
    // pricing is unchanged on any later reprice.
    csbType: { type: String, enum: csbTypeValues, default: "CSB_IV", required: true, index: true },
    // Drafts created before insurance existed read as false, so repricing one
    // never introduces a premium it was not booked with.
    insuranceOptIn: { type: Boolean, default: false, required: true },
    declarationNote: { type: String, trim: true, maxlength: 500, default: defaultDeclarationNote },
    serviceType: { type: String, enum: shipmentServiceTypeValues, default: "COURIER", index: true },
    serviceCode: { type: String, trim: true, maxlength: 40, default: "" },
    validationIssues: [{ type: String, trim: true, maxlength: 500 }],
    status: { type: String, enum: shipmentDraftStatusValues, default: "NEEDS_REVIEW", index: true },
    bookingState: {
      type: String,
      enum: shipmentDraftBookingStateValues,
      default: "EDITABLE",
      required: true,
      index: true
    },
    bookingAttemptId: { type: String, trim: true, maxlength: 80, default: "" },
    lockedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }
  },
  { timestamps: true }
);

shipmentDraftSchema.index({ businessAccountId: 1, branchId: 1, status: 1 });

// One live draft per invoice upload. Deleted drafts are excluded so the same
// invoice can be uploaded again after its draft was discarded; the earlier
// drafts stay on the record as history.
shipmentDraftSchema.index(
  { invoiceUploadId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

// The consignor is always an Indian sender, so these stay fixed no matter what
// a client, an import, or an older draft supplied.
shipmentDraftSchema.pre("validate", function pinConsignorCountry() {
  if (!this.consignorAddress) return;

  this.consignorAddress.countryCode = consignorCountryCode;
  this.consignorAddress.countryName = consignorCountryName;
  this.consignorAddress.mobileCountryCode = consignorMobileCountryCode;
});

shipmentDraftSchema.pre("validate", function syncParcelSummary() {
  this.parcelList = this.parcelList.map((parcel, index) => {
    const items = normalizeParcelItems(parcel);
    return {
      ...parcel,
      sequence: parcel.sequence ?? index + 1,
      shipmentContentType: parcel.shipmentContentType ?? "PARCEL",
      items,
      // Derived from the items so every existing consumer of contentsDescription
      // (EDI, manifest, DPD payload, labels, invoices) keeps working unchanged.
      // Parcels with no items keep whatever description they already had.
      contentsDescription: items.length
        ? composeContentsDescription(items)
        : parcel.contentsDescription ?? ""
    };
  });
  this.parcelCount = this.parcelList.length || 1;
});

export const ShipmentDraft = mongoose.model<IShipmentDraft>(
  "ShipmentDraft",
  shipmentDraftSchema
);
