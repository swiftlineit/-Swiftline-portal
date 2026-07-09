import type { Request, Response } from "express";
import path from "path";
import mongoose from "mongoose";
import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  BusinessAccount,
  businessAccountStatuses,
  businessKycCheckStatuses,
  BusinessKycCheckKey,
  BusinessKycCheckStatus,
  BusinessKycOverallStatus,
  BusinessAccountStatus,
  DocumentType,
  IBusinessDocument,
  IBusinessKycReview,
  ShipmentType
} from "../models/businessAccount.model.js";
import { Branch } from "../models/branch.model.js";

const shipmentTypeSchema = z.enum(["international_cargo", "international_courier"]);
const companyTypeSchema = z.enum(["pvt_ltd", "llp", "enterprise"]).or(z.literal(""));
const registrationCountrySchema = z.enum([
  "United Kingdom",
  "United States",
  "India",
  "France",
  "Netherlands",
  "Kuwait",
  "Canada",
  "Switzerland",
  "Poland"
]);
const documentTypeSchema = z.enum([
  "aadhaarCard",
  "panCard",
  "adCertificate",
  "msmeCertificate",
  "tanCertificate",
  "otherCertificate",
  "gstCertificate",
  "iecCertificate"
]);
const businessAccountStatusSchema = z.enum(businessAccountStatuses);
const businessKycCheckKeySchema = z.enum([
  "contactDetails",
  "companyDetails",
  "aadhaarCard",
  "panCard",
  "adCertificate",
  "msmeCertificate",
  "tanCertificate",
  "otherCertificate",
  "gstCertificate",
  "iecCertificate"
]);
const businessKycCheckStatusSchema = z.enum(businessKycCheckStatuses);
const assignBranchBodySchema = z.object({
  branchId: z.string().trim().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid branch ID")
});
const allowedPersonalEmailDomains = new Set(["gmail.com", "yahoo.com", "outlook.com"]);
const reservedPersonalEmailNames = new Set(["gmail", "yahoo", "outlook", "hotmail"]);
const blockedEmailTlds = new Set(["con", "comm", "cpm", "coom", "om"]);
const emailValidationMessage = "Use gmail.com, yahoo.com, outlook.com, or a valid company email domain.";
const phoneValidationMessage = "Enter a valid phone number for the selected country code.";
const countriesWithoutRegistrationId = new Set(["United States", "Kuwait"]);
const countriesWithSecondaryRegistrationId = new Set(["France", "Netherlands"]);
const nullableCreditLimitSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.coerce.number().nonnegative().max(100000, "Requested credit limit cannot exceed 100000.").nullable().optional()
);
const fiveDigitPostalCodeCountries = new Set([
  "Saudi Arabia",
  "Germany",
  "France",
  "Italy",
  "Spain",
  "South Korea",
  "Indonesia",
  "Malaysia",
  "Thailand",
  "Vietnam",
  "Nepal",
  "Sri Lanka",
  "Mexico",
  "Kuwait"
]);
const fourDigitPostalCodeCountries = new Set([
  "Australia",
  "Belgium",
  "Switzerland",
  "Bangladesh",
  "South Africa",
  "New Zealand"
]);
const sixDigitPostalCodeCountries = new Set(["India", "Singapore", "China"]);
const postalCodeFormats: Record<string, string> = {
  India: "######",
  "United States": "##### or #####-####",
  "United Kingdom": "A9 9AA / A99 9AA / A9A 9AA / AA9 9AA / AA99 9AA / AA9A 9AA",
  Canada: "A1A 1A1",
  Australia: "####",
  "United Arab Emirates": "No standard postal code",
  "Saudi Arabia": "#####",
  Singapore: "######",
  China: "######",
  Japan: "###-####",
  Germany: "#####",
  France: "#####",
  Italy: "#####",
  Netherlands: "#### AA",
  Belgium: "####",
  Spain: "#####",
  Switzerland: "####",
  "South Korea": "#####",
  Indonesia: "#####",
  Malaysia: "#####",
  Thailand: "#####",
  Vietnam: "#####",
  Bangladesh: "####",
  Nepal: "#####",
  "Sri Lanka": "#####",
  "South Africa": "####",
  Brazil: "#####-###",
  Mexico: "#####",
  "New Zealand": "####",
  Qatar: "No standard postal code",
  Oman: "###",
  Kuwait: "#####",
  Bahrain: "### or ####",
  Other: "Country-specific"
};

function isValidBusinessContactEmail(value: string) {
  const email = value.trim().toLowerCase();
  const basicEmailPattern = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

  if (!basicEmailPattern.test(email)) return false;

  const domain = email.split("@")[1] ?? "";
  const parts = domain.split(".");
  const domainName = parts[0];
  const tld = parts.at(-1) ?? "";

  if (!domainName) return false;
  if (blockedEmailTlds.has(tld)) return false;
  if (reservedPersonalEmailNames.has(domainName)) return allowedPersonalEmailDomains.has(domain);

  // Custom company domains are allowed, while common typo TLDs such as ".con" are rejected.
  return /^[a-z]{2,24}$/.test(tld);
}

function isValidPhoneForCountryCode(countryCode: string, mobileNumber: string) {
  const phoneNumber = parsePhoneNumberFromString(`${countryCode.trim()}${mobileNumber.trim()}`);

  return Boolean(phoneNumber?.isValid());
}

function compactRegistrationId(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function getPrimaryRegistrationError(country: string, registrationId: string, registrationIdType?: string) {
  const value = compactRegistrationId(registrationId);

  if (!value) return "";

  if (country === "United Kingdom" && !/^(\d{8}|[A-Z]{2}\d{6})$/.test(value)) {
    return "Enter a valid CRID: 8 digits or 2 letters followed by 6 digits.";
  }

  if (country === "India" && !/^[A-Z]{5}\d{4}[A-Z]$/.test(value)) {
    return "Enter a valid PAN, for example ABCDE1234F.";
  }

  if (country === "France" && !/^FR\d{11}$/.test(value)) {
    return "Enter a valid French VAT number, for example FR12123456789.";
  }

  if (country === "Netherlands" && !/^(NL)?\d{9}B\d{2}$/.test(value)) {
    return "Enter a valid Dutch VAT number, for example NL123456789B01.";
  }

  if (country === "Canada") {
    const requiredLength = registrationIdType === "business_number" ? 9 : 10;
    if (!new RegExp(`^\\d{${requiredLength}}$`).test(value)) {
      return registrationIdType === "business_number"
        ? "Enter a valid CRA Business Number: exactly 9 digits."
        : "Enter a valid Canadian registration number: exactly 10 digits.";
    }
  }

  if (country === "Switzerland" && !/^CHE-\d{3}\.\d{3}\.\d{3}$/.test(value)) {
    return "Enter a valid Swiss UID, for example CHE-123.456.789.";
  }

  if (country === "Poland" && !/^(PL)?\d{10}$/.test(value)) {
    return "Enter a valid Polish VAT/NIP, for example PL1234567890 or 1234567890.";
  }

  return "";
}

function getSecondaryRegistrationError(country: string, registrationId: string) {
  const value = compactRegistrationId(registrationId);

  if (!value) return "";

  if (country === "France" && !/^\d{9}$/.test(value)) {
    return "Enter a valid SIREN: exactly 9 digits.";
  }

  if (country === "Netherlands" && !/^\d{8}$/.test(value)) {
    return "Enter a valid KVK number: exactly 8 digits.";
  }

  return "";
}

function isValidPostalCodeForCountry(country: string, postalCode: string) {
  const value = postalCode.trim().toUpperCase();

  if (!value) return false;
  if (country === "United Arab Emirates" || country === "Qatar" || country === "Other") return true;
  if (sixDigitPostalCodeCountries.has(country)) return /^\d{6}$/.test(value);
  if (fiveDigitPostalCodeCountries.has(country)) return /^\d{5}$/.test(value);
  if (fourDigitPostalCodeCountries.has(country)) return /^\d{4}$/.test(value);

  if (country === "United States") return /^\d{5}(-\d{4})?$/.test(value);
  if (country === "United Kingdom") return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(value);
  if (country === "Canada") return /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(value);
  if (country === "Japan") return /^\d{3}-\d{4}$/.test(value);
  if (country === "Netherlands") return /^\d{4}\s?[A-Z]{2}$/.test(value);
  if (country === "Brazil") return /^\d{5}-\d{3}$/.test(value);
  if (country === "Oman") return /^\d{3}$/.test(value);
  if (country === "Bahrain") return /^\d{3,4}$/.test(value);

  return true;
}

function getPostalCodeValidationMessage(country: string) {
  return `Enter a valid postal code for ${country}.`;
}

const businessAccountBodySchema = z.object({
  contact: z.object({
    title: z.enum(["mr.", "mrs.", "ms.", "dr.", "prof."]),
    firstName: z.string().trim().min(2).max(22),
    lastName: z.string().trim().min(1).max(22),
    email: z.string().trim().email().toLowerCase().refine(isValidBusinessContactEmail, emailValidationMessage),
    mobileType: z.enum(["mobile", "office"]),
    countryCode: z.string().trim().min(1).max(8),
    mobileNumber: z.string().trim().regex(/^\d{6,15}$/, "Mobile number must contain 6 to 15 digits"),
    jobTitle: z.string().trim().min(1).max(80),
    department: z.string().trim().min(1).max(80),
    shipmentTypes: z.array(shipmentTypeSchema).min(1)
  }),
  company: z.object({
    registrationCountry: registrationCountrySchema,
    registrationIdType: z.string().trim().max(80).optional().default(""),
    registrationId: z.string().trim().max(50).optional().default(""),
    secondaryRegistrationId: z.string().trim().max(50).optional().default(""),
    noCompanyRegistration: z.coerce.boolean().optional().default(false),
    noCompany: z.coerce.boolean().optional().default(false),
    companyType: companyTypeSchema.default(""),
    companyName: z.string().trim().max(160).optional().default(""),
    registeredAddress: z.string().trim().max(500).optional().default(""),
    city: z.string().trim().max(80).optional().default(""),
    stateOrProvince: z.string().trim().max(80).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
    addressCountry: z.string().trim().max(80).optional().default(""),
    useCompanyAddressAsBillingAddress: z.coerce.boolean().optional().default(true),
    operatingCountries: z.array(z.string().trim().min(1).max(80)).default([]),
    website: z.string().trim().url().optional().or(z.literal("")).or(z.null()),
    industry: z.string().trim().max(100).optional().default(""),
    monthlyShipmentVolume: z.string().trim().max(80).optional().default(""),
    requestedCreditCurrency: z.string().trim().min(3).max(3).default("INR"),
    requestedCreditLimit: nullableCreditLimitSchema
  })
}).superRefine((data, context) => {
  if (!isValidPhoneForCountryCode(data.contact.countryCode, data.contact.mobileNumber)) {
    context.addIssue({
      code: "custom",
      path: ["contact", "mobileNumber"],
      message: phoneValidationMessage
    });
  }

  const registrationId = data.company.registrationId.trim();
  const secondaryRegistrationId = data.company.secondaryRegistrationId.trim();
  const noCompany = data.company.noCompany;
  const canSkipRegistration = noCompany || data.company.noCompanyRegistration || countriesWithoutRegistrationId.has(data.company.registrationCountry);

  if (!noCompany && !data.company.companyType.trim()) {
    context.addIssue({
      code: "custom",
      path: ["company", "companyType"],
      message: "Company type is required"
    });
  }

  if (!canSkipRegistration && !registrationId) {
    context.addIssue({
      code: "custom",
      path: ["company", "registrationId"],
      message: "Registration ID is required for the selected country."
    });
  }

  const primaryRegistrationError = getPrimaryRegistrationError(data.company.registrationCountry, registrationId, data.company.registrationIdType);
  if (!canSkipRegistration && primaryRegistrationError) {
    context.addIssue({
      code: "custom",
      path: ["company", "registrationId"],
      message: primaryRegistrationError
    });
  }

  if (!canSkipRegistration && countriesWithSecondaryRegistrationId.has(data.company.registrationCountry) && !secondaryRegistrationId) {
    context.addIssue({
      code: "custom",
      path: ["company", "secondaryRegistrationId"],
      message: "Additional registration code is required for the selected country."
    });
  }

  const secondaryRegistrationError = getSecondaryRegistrationError(data.company.registrationCountry, secondaryRegistrationId);
  if (!canSkipRegistration && secondaryRegistrationError) {
    context.addIssue({
      code: "custom",
      path: ["company", "secondaryRegistrationId"],
      message: secondaryRegistrationError
    });
  }

  if (!noCompany) {
    const requiredCompanyFields: [keyof typeof data.company, string][] = [
      ["companyName", "Company name is required"],
      ["registeredAddress", "Registered address is required"],
      ["city", "City is required"],
      ["stateOrProvince", "State or province is required"],
      ["postalCode", "Postal code is required"],
      ["addressCountry", "Country is required"],
      ["industry", "Company industry is required"],
      ["monthlyShipmentVolume", "Monthly shipment volume is required"]
    ];

    for (const [field, message] of requiredCompanyFields) {
      if (!String(data.company[field] ?? "").trim()) {
        context.addIssue({
          code: "custom",
          path: ["company", field],
          message
        });
      }
    }

    if (!data.company.operatingCountries.length) {
      context.addIssue({
        code: "custom",
        path: ["company", "operatingCountries"],
        message: "Select at least one operating country"
      });
    }

    if (
      data.company.postalCode.trim()
      && data.company.addressCountry.trim()
      && !isValidPostalCodeForCountry(data.company.addressCountry, data.company.postalCode)
    ) {
      context.addIssue({
        code: "custom",
        path: ["company", "postalCode"],
        message: getPostalCodeValidationMessage(data.company.addressCountry)
      });
    }
  }
});

type BusinessAccountBody = z.infer<typeof businessAccountBodySchema>;

const businessKycReviewBodySchema = z.object({
  checks: z.partialRecord(
    businessKycCheckKeySchema,
    z.object({
      status: businessKycCheckStatusSchema,
      note: z.string().trim().max(50).optional().nullable()
    })
  ).optional(),
  finalDecision: z.enum(["rejected"]).nullable().optional(),
  startReview: z.boolean().optional()
}).superRefine((data, context) => {
  for (const [key, check] of Object.entries(data.checks ?? {}) as [BusinessKycCheckKey, { status: BusinessKycCheckStatus; note?: string | null }][]) {
    if (check.status === "information_required" && !check.note?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["checks", key, "note"],
        message: "Reason is required and must be 50 characters or less"
      });
    }

  }
});

type BusinessKycReviewBody = z.infer<typeof businessKycReviewBodySchema>;
type AssignBranchBody = z.infer<typeof assignBranchBodySchema>;

const statusActionMessages: Record<BusinessAccountStatus, string> = {
  draft: "Business account moved to draft.",
  pending_review: "Business account submitted for review.",
  approved: "Business account approved.",
  rejected: "Business account rejected.",
  more_info_needed: "Business account marked as needing more information.",
  credit_limit_approved: "Credit limit approved.",
  credit_limit_not_approved: "Credit limit not approved.",
  deposit_required: "Deposit required.",
  deposit_received: "Deposit received.",
  active: "Business account activated.",
  suspended: "Business account suspended.",
  branch_assigned: "Branch assignment marked.",
  agreement_generated: "Agreement generation marked.",
  ledger_viewed: "Ledger review marked."
};

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    return null;
  }

  return new mongoose.Types.ObjectId(String(id));
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseBusinessAccountBody(request: Request) {
  const body = request.body as Record<string, unknown>;

  return businessAccountBodySchema.safeParse({
    contact: parseJsonField(body.contact),
    company: parseJsonField(body.company)
  });
}

function getUploadedFiles(request: Request): Partial<Record<DocumentType, Express.Multer.File>> {
  const files = request.files as Partial<Record<DocumentType, Express.Multer.File[]>> | undefined;

  return {
    aadhaarCard: files?.aadhaarCard?.[0],
    panCard: files?.panCard?.[0],
    adCertificate: files?.adCertificate?.[0],
    msmeCertificate: files?.msmeCertificate?.[0],
    tanCertificate: files?.tanCertificate?.[0],
    otherCertificate: files?.otherCertificate?.[0],
    gstCertificate: files?.gstCertificate?.[0],
    iecCertificate: files?.iecCertificate?.[0]
  };
}

function toBusinessDocument(type: DocumentType, file: Express.Multer.File): IBusinessDocument {
  return {
    type,
    originalName: file.originalname,
    storedName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    path: file.path,
    uploadedAt: new Date()
  };
}

function buildAccountPayload(data: BusinessAccountBody) {
  return {
    contact: data.contact,
    company: {
      registrationCountry: data.company.registrationCountry,
      registrationIdType: data.company.registrationIdType,
      registrationId: data.company.registrationId,
      secondaryRegistrationId: data.company.secondaryRegistrationId,
      noCompanyRegistration: data.company.noCompanyRegistration,
      noCompany: data.company.noCompany,
      companyType: data.company.companyType,
      companyName: data.company.companyName,
      registeredAddress: data.company.registeredAddress,
      city: data.company.city,
      stateOrProvince: data.company.stateOrProvince,
      postalCode: data.company.postalCode,
      addressCountry: data.company.addressCountry,
      useCompanyAddressAsBillingAddress: data.company.useCompanyAddressAsBillingAddress,
      operatingCountries: data.company.operatingCountries,
      website: data.company.website || null,
      industry: data.company.industry,
      monthlyShipmentVolume: data.company.monthlyShipmentVolume,
      requestedCreditLimit: {
        currency: data.company.requestedCreditCurrency,
        amount: data.company.requestedCreditLimit ?? null
      }
    }
  };
}

async function generateAccountId(): Promise<string> {
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sequence = Math.floor(100000 + Math.random() * 900000);
    const accountId = `BA-${year}-${sequence}`;
    const existing = await BusinessAccount.exists({ accountId });

    if (!existing) return accountId;
  }

  throw new Error("Unable to generate a unique business account ID");
}

async function hasDuplicateBusinessIdentity(
  data: BusinessAccountBody,
  accountIdToExclude?: string
): Promise<string | null> {
  const identityChecks: Record<string, string>[] = [
    { "contact.email": data.contact.email },
    { "contact.mobileNumber": data.contact.mobileNumber }
  ];

  if (data.company.registrationId.trim()) {
    identityChecks.push({ "company.registrationId": data.company.registrationId });
  }

  const duplicate = await BusinessAccount.findOne({
    _id: accountIdToExclude ? { $ne: accountIdToExclude } : { $exists: true },
    $or: identityChecks
  })
    .select("contact.email contact.mobileNumber company.registrationId")
    .lean()
    .exec();

  if (!duplicate) return null;

  if (duplicate.contact.email === data.contact.email) return "Email address already exists";
  if (duplicate.contact.mobileNumber === data.contact.mobileNumber) return "Mobile number already exists";
  if (data.company.registrationId.trim() && duplicate.company.registrationId === data.company.registrationId) {
    return "Company registration ID already exists";
  }

  return null;
}

function getDocumentRequirementError(
  shipmentTypes: ShipmentType[],
  documents: Partial<Record<DocumentType, IBusinessDocument>>
): string | null {
  if (!documents.aadhaarCard) return "Aadhaar Card is required";
  if (!documents.panCard) return "PAN Card Copy is required";

  return null;
}

function getRequiredKycCheckKeys(
  shipmentTypes: ShipmentType[],
  documents: Partial<Record<DocumentType, IBusinessDocument>>
): BusinessKycCheckKey[] {
  const keys: BusinessKycCheckKey[] = ["contactDetails", "companyDetails", "aadhaarCard", "panCard"];

  for (const optionalKey of ["adCertificate", "msmeCertificate", "tanCertificate", "otherCertificate", "gstCertificate", "iecCertificate"] as DocumentType[]) {
    if (documents[optionalKey]) keys.push(optionalKey);
  }

  return keys;
}

function getMissingRequiredDocuments(
  shipmentTypes: ShipmentType[],
  documents: Partial<Record<DocumentType, IBusinessDocument>>
) {
  const missing: DocumentType[] = [];

  if (!documents.aadhaarCard) missing.push("aadhaarCard");
  if (!documents.panCard) missing.push("panCard");

  return missing;
}

function getDefaultKycReview(): IBusinessKycReview {
  return {
    overallStatus: "documents_pending",
    checks: {},
    finalDecision: null,
    reviewStartedAt: null,
    reviewedAt: null,
    reviewedBy: null
  };
}

function deriveKycOverallStatus(
  shipmentTypes: ShipmentType[],
  documents: Partial<Record<DocumentType, IBusinessDocument>>,
  review: IBusinessKycReview
): BusinessKycOverallStatus {
  const missingDocuments = getMissingRequiredDocuments(shipmentTypes, documents);
  if (missingDocuments.length) return "documents_pending";
  if (review.finalDecision === "rejected") return "rejected";

  const requiredKeys = getRequiredKycCheckKeys(shipmentTypes, documents);
  const statuses = requiredKeys.map((key) => review.checks?.[key]?.status ?? "not_started");
  const infoRequiredStatuses: BusinessKycCheckStatus[] = ["information_required"];

  if (statuses.some((status) => status === "reject")) {
    return "rejected";
  }

  if (statuses.some((status) => infoRequiredStatuses.includes(status))) {
    return "additional_information_required";
  }

  if (statuses.every((status) => status === "verified")) {
    return "verified";
  }

  if (!review.reviewStartedAt && statuses.every((status) => status === "not_started")) {
    return "submitted";
  }

  return "under_review";
}

function normalizeKycCheckStatus(status: string): BusinessKycCheckStatus {
  if (status === "failed") return "reject";
  if (status === "replacement_required" || status === "mismatched" || status === "unclear") return "information_required";
  if (businessKycCheckStatuses.includes(status as BusinessKycCheckStatus)) {
    return status as BusinessKycCheckStatus;
  }

  return "not_started";
}

function getSanitizedKycReview(currentReview?: IBusinessKycReview): IBusinessKycReview {
  const review: IBusinessKycReview = {
    ...getDefaultKycReview(),
    finalDecision: currentReview?.finalDecision ?? null,
    reviewStartedAt: currentReview?.reviewStartedAt ?? null,
    reviewedAt: currentReview?.reviewedAt ?? null,
    reviewedBy: currentReview?.reviewedBy ?? null,
    checks: {}
  };

  for (const [key, check] of Object.entries(currentReview?.checks ?? {}) as [BusinessKycCheckKey, { status?: string; note?: string | null; reviewedAt?: Date | null } | null | undefined][]) {
    if (!businessKycCheckKeySchema.safeParse(key).success || !check) continue;

    review.checks[key] = {
      status: normalizeKycCheckStatus(check.status ?? "not_started"),
      note: check.note ? check.note.slice(0, 50) : null,
      reviewedAt: check.reviewedAt ?? null
    };
  }

  return review;
}

function applyKycReviewUpdate(
  currentReview: IBusinessKycReview | undefined,
  data: BusinessKycReviewBody,
  userId: mongoose.Types.ObjectId
) {
  const now = new Date();
  const nextReview = getSanitizedKycReview(currentReview);

  if (data.startReview && !nextReview.reviewStartedAt) {
    nextReview.reviewStartedAt = now;
  }

  let hasNonRejectCheckUpdate = false;

  for (const [key, check] of Object.entries(data.checks ?? {}) as [BusinessKycCheckKey, { status: BusinessKycCheckStatus; note?: string | null }][]) {
    if (check.status !== "not_started" && !nextReview.reviewStartedAt) {
      nextReview.reviewStartedAt = now;
    }

    if (check.status !== "reject") {
      hasNonRejectCheckUpdate = true;
    }

    nextReview.checks[key] = {
      status: check.status,
      note: check.note || null,
      reviewedAt: check.status === "not_started" ? null : now
    };
  }

  if ("finalDecision" in data) {
    nextReview.finalDecision = data.finalDecision ?? null;
    if (data.finalDecision === "rejected" && !nextReview.reviewStartedAt) {
      nextReview.reviewStartedAt = now;
    }
  } else if (hasNonRejectCheckUpdate) {
    nextReview.finalDecision = null;
  }

  nextReview.reviewedBy = userId;
  return nextReview;
}

function applyDerivedKycStatus(account: { contact: { shipmentTypes: ShipmentType[] }; documents?: Partial<Record<DocumentType, IBusinessDocument>>; kycReview?: IBusinessKycReview }) {
  const review = getSanitizedKycReview(account.kycReview);

  review.overallStatus = deriveKycOverallStatus(account.contact.shipmentTypes, account.documents ?? {}, review);
  review.reviewedAt = ["verified", "rejected"].includes(review.overallStatus) ? new Date() : null;

  return review;
}

function attachUploadedDocuments(
  documents: Partial<Record<DocumentType, IBusinessDocument>>,
  files: Partial<Record<DocumentType, Express.Multer.File>>
) {
  for (const type of ["aadhaarCard", "panCard", "adCertificate", "msmeCertificate", "tanCertificate", "otherCertificate", "gstCertificate", "iecCertificate"] as DocumentType[]) {
    const file = files[type];
    if (file) documents[type] = toBusinessDocument(type, file);
  }
}

export async function validateBusinessAccountUniqueness(request: Request, response: Response): Promise<Response> {
  const email = typeof request.query.email === "string" ? request.query.email.trim().toLowerCase() : "";
  const mobileNumber = typeof request.query.mobileNumber === "string" ? request.query.mobileNumber.trim() : "";
  const registrationId = typeof request.query.registrationId === "string" ? request.query.registrationId.trim() : "";
  const excludeAccountId = typeof request.query.excludeAccountId === "string" ? request.query.excludeAccountId.trim() : "";

  const checks: Record<string, boolean> = {
    email: false,
    mobileNumber: false,
    registrationId: false
  };

  const baseFilter = excludeAccountId ? { accountId: { $ne: excludeAccountId } } : {};

  const [emailMatch, mobileMatch, registrationMatch] = await Promise.all([
    email ? BusinessAccount.exists({ ...baseFilter, "contact.email": email }) : null,
    mobileNumber ? BusinessAccount.exists({ ...baseFilter, "contact.mobileNumber": mobileNumber }) : null,
    registrationId ? BusinessAccount.exists({ ...baseFilter, "company.registrationId": registrationId }) : null
  ]);

  checks.email = Boolean(emailMatch);
  checks.mobileNumber = Boolean(mobileMatch);
  checks.registrationId = Boolean(registrationMatch);

  return response.status(200).json({ success: true, conflicts: checks });
}

export async function listBusinessAccounts(request: Request, response: Response): Promise<Response> {
  const { status, search, branchId } = request.query;
  const filters: Record<string, unknown> = {};

  if (typeof status === "string" && status) {
    filters.status = status;
  }

  if (typeof branchId === "string" && mongoose.Types.ObjectId.isValid(branchId)) {
    filters.assignedBranch = new mongoose.Types.ObjectId(branchId);
  }

  if (typeof search === "string" && search.trim()) {
    const pattern = new RegExp(search.trim(), "i");
    filters.$or = [
      { accountId: pattern },
      { "company.companyName": pattern },
      { "contact.firstName": pattern },
      { "contact.lastName": pattern },
      { "contact.email": pattern },
      { "contact.mobileNumber": pattern },
      { "company.registrationId": pattern }
    ];
  }

  const accounts = await BusinessAccount.find(filters)
    .populate("createdBy", "email name")
    .populate("assignedBranch", "name code status")
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  return response.status(200).json({ success: true, accounts });
}

export async function createBusinessAccount(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = parseBusinessAccountBody(request);
  if (!parsed.success) {
    return response.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const duplicateMessage = await hasDuplicateBusinessIdentity(parsed.data);
  if (duplicateMessage) return response.status(409).json({ success: false, message: duplicateMessage });

  const files = getUploadedFiles(request);
  const documents: Partial<Record<DocumentType, IBusinessDocument>> = {};
  attachUploadedDocuments(documents, files);

  const account = await BusinessAccount.create({
    accountId: await generateAccountId(),
    status: "draft",
    ...buildAccountPayload(parsed.data),
    documents,
    createdBy: userId,
    updatedBy: userId
  });

  return response.status(201).json({ success: true, account });
}

export async function getBusinessAccount(request: Request, response: Response): Promise<Response> {
  const account = await BusinessAccount.findOne({ accountId: request.params.accountId })
    .populate("createdBy", "email name")
    .populate("assignedBranch", "name code status")
    .lean()
    .exec();

  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  return response.status(200).json({ success: true, account });
}

export async function updateBusinessAccount(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  const parsed = parseBusinessAccountBody(request);
  if (!parsed.success) {
    return response.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const duplicateMessage = await hasDuplicateBusinessIdentity(parsed.data, String(account._id));
  if (duplicateMessage) return response.status(409).json({ success: false, message: duplicateMessage });

  const files = getUploadedFiles(request);
  const documents = account.documents ?? {};
  attachUploadedDocuments(documents, files);

  account.set({
    ...buildAccountPayload(parsed.data),
    documents,
    updatedBy: userId
  });
  account.kycReview = applyDerivedKycStatus(account);

  await account.save();

  return response.status(200).json({ success: true, account });
}

export async function submitBusinessAccount(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });
  if (account.status !== "draft") {
    return response.status(409).json({ success: false, message: "Only draft accounts can be submitted" });
  }

  const requirementError = getDocumentRequirementError(account.contact.shipmentTypes, account.documents ?? {});
  if (requirementError) {
    return response.status(400).json({ success: false, message: requirementError });
  }

  account.status = "pending_review";
  account.submittedAt = new Date();
  account.updatedBy = userId;
  account.kycReview = applyDerivedKycStatus(account);
  await account.save();

  return response.status(200).json({
    success: true,
    message: "Business account created successfully and submitted for review.",
    account
  });
}

export async function updateBusinessAccountStatus(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = businessAccountStatusSchema.safeParse((request.body as { status?: unknown }).status);
  if (!parsed.success) {
    return response.status(400).json({ success: false, message: "Invalid business account status" });
  }

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  if (parsed.data === "pending_review" && !account.submittedAt) {
    const requirementError = getDocumentRequirementError(account.contact.shipmentTypes, account.documents ?? {});
    if (requirementError) {
      return response.status(400).json({ success: false, message: requirementError });
    }

    account.submittedAt = new Date();
  }

  account.status = parsed.data;
  account.updatedBy = userId;
  account.kycReview = applyDerivedKycStatus(account);
  await account.save();

  return response.status(200).json({
    success: true,
    message: statusActionMessages[parsed.data],
    account
  });
}

export async function assignBusinessAccountBranch(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = assignBranchBodySchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  const branchId = new mongoose.Types.ObjectId((parsed.data as AssignBranchBody).branchId);
  const branch = await Branch.findOne({ _id: branchId, status: "ACTIVE" }).select("_id").lean().exec();
  if (!branch) return response.status(404).json({ success: false, message: "Active branch not found" });

  // Assignment is its own workflow step; the account status reflects that the branch link is now real.
  account.assignedBranch = branchId;
  account.status = "branch_assigned";
  account.updatedBy = userId;
  account.kycReview = applyDerivedKycStatus(account);
  await account.save();

  const updatedAccount = await BusinessAccount.findOne({ accountId: account.accountId })
    .populate("createdBy", "email name")
    .populate("assignedBranch", "name code status")
    .lean()
    .exec();

  return response.status(200).json({
    success: true,
    message: "Branch assigned successfully.",
    account: updatedAccount
  });
}

export async function viewBusinessAccountDocument(request: Request, response: Response): Promise<void | Response> {
  const parsed = documentTypeSchema.safeParse(request.params.documentType);
  if (!parsed.success) {
    return response.status(400).json({ success: false, message: "Invalid document type" });
  }

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).lean().exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  const document = account.documents?.[parsed.data];
  if (!document) return response.status(404).json({ success: false, message: "Document not found" });

  const absolutePath = path.resolve(document.path);
  response.setHeader("Content-Type", document.mimeType);
  response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.originalName)}"`);

  return response.sendFile(absolutePath);
}

export async function updateBusinessAccountKycReview(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = businessKycReviewBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  try {
    const nextReview = applyKycReviewUpdate(account.kycReview, parsed.data, userId);
    nextReview.overallStatus = deriveKycOverallStatus(account.contact.shipmentTypes, account.documents ?? {}, nextReview);
    nextReview.reviewedAt = ["verified", "rejected"].includes(nextReview.overallStatus) ? new Date() : null;

    account.kycReview = nextReview;
    account.updatedBy = userId;
    await account.save();
  } catch (error) {
    console.error("KYC review update failed:", error);
    return response.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Unable to update KYC review"
    });
  }

  return response.status(200).json({
    success: true,
    account,
    kycReview: account.kycReview
  });
}
