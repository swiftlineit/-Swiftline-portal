import mongoose from "mongoose";

export type ShipmentType = "international_cargo" | "international_courier";
export const businessAccountStatuses = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "more_info_needed",
  "credit_limit_approved",
  "credit_limit_not_approved",
  "deposit_required",
  "deposit_received",
  "active",
  "suspended",
  "branch_assigned",
  "agreement_generated",
  "ledger_viewed"
] as const;
export type BusinessAccountStatus = (typeof businessAccountStatuses)[number];
export type DocumentType =
  | "aadhaarCard"
  | "panCard"
  | "adCertificate"
  | "msmeCertificate"
  | "tanCertificate"
  | "otherCertificate"
  | "gstCertificate"
  | "iecCertificate";
export const businessKycCheckStatuses = [
  "not_started",
  "under_review",
  "verified",
  "information_required",
  "reject"
] as const;
export type BusinessKycCheckStatus = (typeof businessKycCheckStatuses)[number];
export const businessKycOverallStatuses = [
  "documents_pending",
  "submitted",
  "under_review",
  "additional_information_required",
  "verified",
  "rejected"
] as const;
export type BusinessKycOverallStatus = (typeof businessKycOverallStatuses)[number];
export type BusinessKycCheckKey = "contactDetails" | "companyDetails" | DocumentType;

export interface IBusinessDocument {
  type: DocumentType;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedAt: Date;
}

export interface IBusinessKycCheck {
  status: BusinessKycCheckStatus;
  note?: string | null;
  reviewedAt?: Date | null;
}

export interface IBusinessKycReview {
  overallStatus: BusinessKycOverallStatus;
  checks: Partial<Record<BusinessKycCheckKey, IBusinessKycCheck>>;
  finalDecision?: "rejected" | null;
  reviewStartedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: mongoose.Types.ObjectId | null;
}

export interface IBusinessAccount extends mongoose.Document {
  accountId: string;
  status: BusinessAccountStatus;
  contact: {
    title: string;
    firstName: string;
    lastName: string;
    email: string;
    mobileType: "mobile" | "office";
    countryCode: string;
    mobileNumber: string;
    jobTitle: string;
    department: string;
    shipmentTypes: ShipmentType[];
  };
  company: {
    registrationCountry: string;
    registrationIdType?: string;
    registrationId: string;
    secondaryRegistrationId?: string;
    noCompanyRegistration?: boolean;
    noCompany?: boolean;
    companyType: string;
    companyName: string;
    registeredAddress: string;
    city: string;
    stateOrProvince: string;
    postalCode: string;
    addressCountry?: string;
    useCompanyAddressAsBillingAddress?: boolean;
    operatingCountries: string[];
    website?: string | null;
    industry: string;
    monthlyShipmentVolume: string;
    requestedCreditLimit: {
      currency: string;
      amount: number | null;
    };
  };
  documents: Partial<Record<DocumentType, IBusinessDocument>>;
  kycReview: IBusinessKycReview;
  assignedBranch?: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  submittedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const businessDocumentSchema = new mongoose.Schema<IBusinessDocument>(
  {
    type: {
      type: String,
      enum: ["aadhaarCard", "panCard", "adCertificate", "msmeCertificate", "tanCertificate", "otherCertificate", "gstCertificate", "iecCertificate"],
      required: true
    },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    path: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const businessKycCheckSchema = new mongoose.Schema<IBusinessKycCheck>(
  {
    status: {
      type: String,
      enum: businessKycCheckStatuses,
      default: "not_started",
      required: true
    },
    note: { type: String, default: null, maxlength: 50, trim: true },
    reviewedAt: { type: Date, default: null }
  },
  { _id: false }
);

const businessKycReviewSchema = new mongoose.Schema<IBusinessKycReview>(
  {
    overallStatus: {
      type: String,
      enum: businessKycOverallStatuses,
      default: "documents_pending",
      index: true
    },
    checks: {
      contactDetails: { type: businessKycCheckSchema },
      companyDetails: { type: businessKycCheckSchema },
      aadhaarCard: { type: businessKycCheckSchema },
      panCard: { type: businessKycCheckSchema },
      adCertificate: { type: businessKycCheckSchema },
      msmeCertificate: { type: businessKycCheckSchema },
      tanCertificate: { type: businessKycCheckSchema },
      otherCertificate: { type: businessKycCheckSchema },
      gstCertificate: { type: businessKycCheckSchema },
      iecCertificate: { type: businessKycCheckSchema }
    },
    finalDecision: {
      type: String,
      enum: ["rejected", null],
      default: null
    },
    reviewStartedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { _id: false }
);

const businessAccountSchema = new mongoose.Schema<IBusinessAccount>(
  {
    accountId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: businessAccountStatuses,
      default: "draft",
      index: true
    },
    contact: {
      title: { type: String, enum: ["mr.", "mrs.", "ms.", "dr.", "prof."], required: true, trim: true },
      firstName: { type: String, required: true, trim: true },
      lastName: { type: String, required: true, trim: true },
      email: { type: String, required: true, lowercase: true, trim: true, index: true },
      mobileType: { type: String, enum: ["mobile", "office"], required: true, default: "mobile", trim: true },
      countryCode: { type: String, required: true, trim: true },
      mobileNumber: { type: String, required: true, trim: true, index: true },
      jobTitle: { type: String, required: true, trim: true },
      department: { type: String, required: true, trim: true },
      shipmentTypes: {
        type: [String],
        enum: ["international_cargo", "international_courier"],
        required: true,
        validate: {
          validator: (value: ShipmentType[]) => value.length > 0,
          message: "At least one shipment type is required"
        }
      }
    },
    company: {
      registrationCountry: { type: String, required: true, trim: true },
      registrationIdType: { type: String, default: "", trim: true },
      registrationId: { type: String, default: "", trim: true, index: true },
      secondaryRegistrationId: { type: String, default: "", trim: true },
      noCompanyRegistration: { type: Boolean, default: false },
      noCompany: { type: Boolean, default: false },
      companyType: { type: String, enum: ["", "pvt_ltd", "llp", "enterprise"], default: "", trim: true },
      companyName: { type: String, default: "", trim: true },
      registeredAddress: { type: String, default: "", trim: true },
      city: { type: String, default: "", trim: true },
      stateOrProvince: { type: String, default: "", trim: true },
      postalCode: { type: String, default: "", trim: true },
      addressCountry: { type: String, default: "", trim: true },
      useCompanyAddressAsBillingAddress: { type: Boolean, default: true },
      operatingCountries: {
        type: [String],
        required: true,
        validate: {
          validator: (value: string[]) => value.length > 0,
          message: "At least one operating country is required"
        }
      },
      website: { type: String, default: null, trim: true },
      industry: { type: String, default: "", trim: true },
      monthlyShipmentVolume: { type: String, default: "", trim: true },
      requestedCreditLimit: {
        currency: { type: String, default: "INR", trim: true },
        amount: { type: Number, default: null }
      }
    },
    documents: {
      aadhaarCard: { type: businessDocumentSchema },
      panCard: { type: businessDocumentSchema },
      adCertificate: { type: businessDocumentSchema },
      msmeCertificate: { type: businessDocumentSchema },
      tanCertificate: { type: businessDocumentSchema },
      otherCertificate: { type: businessDocumentSchema },
      gstCertificate: { type: businessDocumentSchema },
      iecCertificate: { type: businessDocumentSchema }
    },
    kycReview: {
      type: businessKycReviewSchema,
      default: () => ({
        overallStatus: "documents_pending",
        checks: {}
      })
    },
    assignedBranch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const BusinessAccount = mongoose.model<IBusinessAccount>(
  "BusinessAccount",
  businessAccountSchema
);
