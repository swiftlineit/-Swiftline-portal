import mongoose from "mongoose";

export const addressValidationStatusValues = [
  "NOT_VALIDATED",
  "VALIDATED",
  "CORRECTION_SUGGESTED",
  "INCOMPLETE",
  "UNAVAILABLE"
] as const;

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

export interface ShipmentParcel {
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

export interface IShipmentDraft extends mongoose.Document {
  invoiceUploadId: mongoose.Types.ObjectId;
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  sender: Record<string, unknown>;
  consigneeEnteredAddress: ShipmentAddressSnapshot;
  consigneeSelectedAddress?: ShipmentAddressSnapshot | null;
  consigneeValidatedAddress?: ShipmentAddressSnapshot | null;
  googlePlaceId?: string;
  addressValidationStatus: AddressValidationStatus;
  addressValidationResult: Record<string, unknown>;
  parcelCount: number;
  parcelList: ShipmentParcel[];
  serviceType: ShipmentServiceType;
  serviceCode: string;
  validationIssues: string[];
  status: ShipmentDraftStatus;
  bookingState: ShipmentDraftBookingState;
  bookingAttemptId: string;
  lockedAt?: Date | null;
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
    contentsDescription: { type: String, trim: true, maxlength: 120, default: "" },
    shipmentReference1: { type: String, trim: true, maxlength: 120, default: "" },
    shipmentReference2: { type: String, trim: true, maxlength: 120, default: "" }
  },
  { _id: false }
);

const shipmentDraftSchema = new mongoose.Schema<IShipmentDraft>(
  {
    invoiceUploadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceUpload",
      required: true,
      unique: true,
      index: true
    },
    businessAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessAccount",
      required: true,
      index: true
    },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    sender: { type: mongoose.Schema.Types.Mixed, default: {} },
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
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }
  },
  { timestamps: true }
);

shipmentDraftSchema.index({ businessAccountId: 1, branchId: 1, status: 1 });

shipmentDraftSchema.pre("validate", function syncParcelSummary() {
  this.parcelList = this.parcelList.map((parcel, index) => ({
    ...parcel,
    sequence: parcel.sequence ?? index + 1,
    shipmentContentType: parcel.shipmentContentType ?? "PARCEL"
  }));
  this.parcelCount = this.parcelList.length || 1;
});

export const ShipmentDraft = mongoose.model<IShipmentDraft>(
  "ShipmentDraft",
  shipmentDraftSchema
);
