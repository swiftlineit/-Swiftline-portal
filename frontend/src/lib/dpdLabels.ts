import { apiUrl } from "@/lib/api";
import { setDateRangeParams, type DateRange } from "@/lib/dateRange";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import type { CsbType } from "@/lib/csbType";
import { toPriceChangedError } from "@/lib/shipmentCostEstimate";

export type InvoiceUpload = {
  id: string;
  businessAccountId: string;
  branchId: string;
  templateVersion: string;
  invoiceNumber: string;
  shipmentReference: string;
  originalFilename: string;
  fileChecksum: string;
  extractedData: Record<string, unknown>;
  status: "UPLOADED" | "PROCESSING" | "PARSED" | "PARSING_FAILED";
  processingErrors: string[];
  uploadedAt: string;
};

export type ShipmentAddress = {
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
};

export type ShipmentConsignorAddress = {
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
};

export const shipmentKycDocumentTypes = [
  "aadhaar",
  "pan",
  "iec",
  "gst",
  "salePurchaseAdCode",
  "lut",
  "declarationOfGoods",
  "otherCertificates",
  "hsnCode",
  // Legacy upload type, kept readable for existing shipments.
  "other"
] as const;
export type ShipmentKycDocumentType = (typeof shipmentKycDocumentTypes)[number];

export const shipmentKycDocumentLabels: Record<ShipmentKycDocumentType, string> = {
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

export const csbIvKycDocumentTypes = ["pan", "aadhaar"] as const;
export const csbVKycDocumentTypes = [
  "iec",
  "gst",
  "pan",
  "aadhaar",
  "salePurchaseAdCode",
  "lut",
  "declarationOfGoods",
  "otherCertificates",
  "hsnCode"
] as const;

export function requiredShipmentKycDocumentTypes(csbType: CsbType): readonly ShipmentKycDocumentType[] {
  return csbType === "CSB_V" ? csbVKycDocumentTypes : csbIvKycDocumentTypes;
}

export type ShipmentKycDocument = {
  type: ShipmentKycDocumentType;
  documentLabel: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type ShipmentKycDocuments = Partial<Record<ShipmentKycDocumentType, ShipmentKycDocument | null>>;

export const shipmentContentTypeOptions = [
  { value: "DOCUMENTS", label: "Documents" },
  { value: "PARCEL", label: "Parcel" },
  { value: "MERCHANDISE", label: "Merchandise" },
  { value: "SAMPLES", label: "Samples" },
  { value: "GIFTS", label: "Gifts" },
  { value: "RETURNS", label: "Returns" },
  { value: "OTHER", label: "Other" }
] as const;

export type ShipmentContentType = (typeof shipmentContentTypeOptions)[number]["value"];
export type ShipmentServiceType = "COURIER" | "CARGO";

export type ShipmentDraft = {
  _id: string;
  invoiceUploadId: string;
  businessAccountId: string;
  /**
   * INDIVIDUAL is a walk-in booked at the counter: paid in full up front, billed
   * to the person rather than a company. Absent on drafts created before the
   * field existed, which are all business shipments.
   */
  customerType?: "BUSINESS" | "INDIVIDUAL";
  branchId: string;
  consignorAddress?: ShipmentConsignorAddress;
  consignorPlaceId?: string;
  kycUseForAllParcels?: boolean;
  kycDocuments?: ShipmentKycDocuments;
  consigneeEnteredAddress: ShipmentAddress;
  consigneeSelectedAddress?: ShipmentAddress | null;
  consigneeValidatedAddress?: ShipmentAddress | null;
  addressValidationResult?: AddressValidationResult;
  addressValidationStatus: string;
  parcelCount?: number;
  parcelList: Array<{
    sequence: number;
    weightKg: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    shipmentContentType: ShipmentContentType;
    // Per-item goods with HS codes and customs-invoice values. Absent on parcels
    // stored before items existed, which fall back to contentsDescription.
    // Numeric over the wire; the forms hold these as strings while editing.
    items?: Array<{
      description: string;
      hsnCode: string;
      unitType?: string;
      quantity?: number;
      unitRate?: number;
    }>;
    declaredGoodsValueMinor?: number | null;
    contentsDescription: string;
    shipmentReference1?: string;
    shipmentReference2?: string;
    aadhaarNumber?: string;
    kycDocuments?: ShipmentKycDocuments;
  }>;
  // Customs route. Absent on drafts created before CSB selection existed.
  csbType?: CsbType;
  // Optional transit cover. Absent on drafts created before insurance existed,
  // which price as uninsured.
  insuranceOptIn?: boolean;
  // Printed as the NOTE block on the customs (shipment) invoice.
  declarationNote?: string;
  serviceType?: ShipmentServiceType;
  serviceCode: string;
  validationIssues: string[];
  status: string;
  bookingState?: "EDITABLE" | "BOOKING" | "BOOKED" | "REVIEW_REQUIRED";
  bookingAttemptId?: string;
  lockedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/** Where an uploaded-invoice draft came from, and what the import could not fill. */
export type InvoiceImportSummary = {
  originalFilename: string;
  warnings: string[];
};

export type ShipmentDraftPatch = {
  consignorAddress?: Partial<ShipmentConsignorAddress>;
  consigneeEnteredAddress?: Partial<ShipmentAddress>;
  kycUseForAllParcels?: boolean;
  parcelList?: Array<{
    sequence: number;
    weightKg: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    shipmentContentType: ShipmentContentType;
    items?: Array<{ description: string; hsnCode: string; unitType?: string; quantity?: number; unitRate?: number }>;
    contentsDescription: string;
    shipmentReference1?: string;
    shipmentReference2?: string;
    aadhaarNumber?: string;
  }>;
  csbType?: CsbType;
  insuranceOptIn?: boolean;
  declarationNote?: string;
  serviceType?: ShipmentServiceType;
  serviceCode?: string;
};

export type ShipmentAmendmentInput = {
  reason?: string;
  changes: {
    serviceType?: ShipmentServiceType;
    consigneeEnteredAddress?: Partial<ShipmentAddress>;
    parcelList?: Array<Omit<ShipmentDraft["parcelList"][number], "lengthCm" | "widthCm" | "heightCm"> & {
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
    }>;
  };
};

export type ShipmentAmendmentChange = {
  fieldName: string;
  originalValue: unknown;
  newValue: unknown;
};

export type ShipmentAmendmentPricingEstimate = {
  parcels: Array<{
    sequence: number;
    actualWeightKg: number;
    volumetricWeightKg: number;
    chargeableWeightKg: number;
    rateCardId: string | null;
    rateFromKg: number | null;
    rateToKg: number | null;
    chargesPerKg: number | null;
    maxBoxKg: number | null;
    baseAmount: number;
    exceedsMaxBoxKg: boolean;
  }>;
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  missingRate: boolean;
  exceedsMaxBoxKg: boolean;
  gstRate: number;
};

export type ShipmentAmendmentBillingAdjustment = {
  previousAmountMinor: number;
  amendedAmountMinor: number;
  deltaAmountMinor: number;
  advanceUsedMinor: number;
  creditUsedMinor: number;
  creditReducedMinor: number;
  advanceRefundedMinor: number;
  advanceAppliedMinor: number;
  creditOutstandingMinor: number;
};

export type ShipmentAmendmentFundingPreview = {
  billingMode: "BUSINESS_ACCOUNT" | "DIRECT" | "TEST";
  previousAmountMinor: number;
  amendedAmountMinor: number;
  deltaAmountMinor: number;
  availableBookingCapacityMinor: number;
  canFund: boolean;
  message: string;
  adjustment: ShipmentAmendmentBillingAdjustment | null;
};

export type ShipmentAmendmentPreview = {
  pricingImpact: {
    current: ShipmentAmendmentPricingEstimate;
    requested: ShipmentAmendmentPricingEstimate;
    deltaAmount: number;
  };
  fundingPreview: ShipmentAmendmentFundingPreview;
};

export type VerifiedShipmentParcelInput = {
  sequence: number;
  actualWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type ShipmentChargeVerification = {
  id: string;
  shipmentDraftId: string;
  dpdShipmentId: string;
  previousParcelList: Array<Record<string, unknown>>;
  verifiedParcelList: Array<Record<string, unknown>>;
  previousPricingSnapshot: ShipmentAmendmentPricingEstimate;
  verifiedPricingSnapshot: ShipmentAmendmentPricingEstimate;
  previousAmountMinor: number;
  verifiedAmountMinor: number;
  deltaAmountMinor: number;
  billingMode: "BUSINESS_ACCOUNT" | "DIRECT" | "TEST";
  billingAdjustment: ShipmentAmendmentBillingAdjustment;
  invoiceNumber: string;
  invoiceRevision: number;
  note: string;
  verifiedBy: string;
  verifiedAt: string;
};

export type ShipmentChargeVerificationState = {
  status: "PENDING" | "FINALIZED";
  eligible: boolean;
  message: string;
  verification: ShipmentChargeVerification | null;
};

export type ShipmentChargeVerificationPreview = {
  currentPricing: ShipmentAmendmentPricingEstimate;
  verifiedPricing: ShipmentAmendmentPricingEstimate;
  fundingPreview: ShipmentAmendmentFundingPreview;
  expectedTotalAmountMinor: number;
  exceedsMaxBoxKg: boolean;
};

export type ShipmentAmendment = {
  id: string;
  shipmentDraftId: string;
  dpdShipmentId: string;
  shipmentId: string;
  consignee: string;
  branch: {
    id: string;
    name: string;
    code: string;
    city: string;
  } | null;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "APPLIED";
  actorRole: "admin" | "client";
  reason: string;
  reviewNote: string;
  requestedChanges: Record<string, unknown>;
  changePreview: ShipmentAmendmentChange[];
  pricingImpact: {
    current: ShipmentAmendmentPricingEstimate;
    requested: ShipmentAmendmentPricingEstimate;
    deltaAmount: number;
  } | null;
  fundingPreview: ShipmentAmendmentFundingPreview | null;
  billingAdjustment: ShipmentAmendmentBillingAdjustment | null;
  appliedChanges: ShipmentAmendmentChange[];
  requestedAt: string;
  reviewedAt?: string | null;
  appliedAt?: string | null;
};

export type AddressPrediction = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

export type PortalAddress = {
  addressLine1: string;
  addressLine2: string;
  townOrCity: string;
  county: string;
  postcode: string;
  countryCode: string;
  countryName: string;
};

export type AddressValidationResult = {
  outcome: "VALID" | "CORRECTION_SUGGESTED" | "INCOMPLETE" | "UNAVAILABLE";
  enteredAddress: {
    addressLine1: string;
    addressLine2?: string;
    townOrCity: string;
    county?: string;
    postcode: string;
    countryCode: string;
  };
  suggestedAddress?: PortalAddress;
  missingComponents: string[];
  unconfirmedComponents: string[];
  formattedAddress?: string;
};

export type DpdShipmentHistoryItem = {
  dpdShipment: {
    id: string;
    shipmentDraftId: string;
    idempotencyKey: string;
    dpdShipmentId: string;
    dpdTransactionId: string;
    swiftlineTrackingNumber: string;
    bookingProvider: "DPD" | "SWIFTLINE";
    providerMode: "SIMULATED" | "LIVE";
    parcelNumbers: string[];
    serviceCode: string;
    status: string;
    createdAt?: string;
    updatedAt?: string;
  };
  shipmentDraft: {
    id: string;
    invoiceUploadId: string;
    branchId: string;
    consigneeName: string;
    consigneeTownOrCity: string;
    deliveryPostcode: string;
    status: string;
    addressValidationStatus: string;
  } | null;
  branch: {
    id: string;
    name: string;
    code: string;
    city: string;
  } | null;
  invoiceUpload: {
    id: string;
    invoiceNumber: string;
    shipmentReference: string;
    originalFilename: string;
  } | null;
  labels: Array<{
    id: string;
    dpdShipmentId: string;
    parcelNumber: string;
    labelType: "DPD" | "SWIFTLINE";
    providerMode: "SIMULATED" | "LIVE";
    format: string;
    labelSize: string;
    fileChecksum: string;
    generatedAt: string;
    downloadCount: number;
    lastDownloadedAt?: string | null;
  }>;
  bookingConfirmation: ShipmentBookingConfirmation | null;
  shipmentInvoice: {
    invoiceNumber: string;
    currency: string;
    totalAmountMinor: number;
    chargeableAmountMinor: number;
    status: "DRAFT" | "ISSUED";
    revision: number;
  } | null;
  currentEvent: ShipmentEvent | null;
  events: ShipmentEvent[];
};

export type ShipmentBookingConfirmation = {
  swiftlineTrackingNumber: string;
  carrierShipmentId: string;
  providerMode: "SIMULATED" | "LIVE";
  shipmentReference: string;
  customerReference: string;
  serviceType: "COURIER" | "CARGO";
  serviceCode: string;
  parcelCount: number;
  totalActualWeightKg: number;
  baseAmountMinor: number;
  gstAmountMinor: number;
  totalAmountMinor: number;
  advanceAmountMinor: number;
  creditAmountMinor: number;
};

export type ShipmentEvent = {
  id: string;
  shipmentDraftId: string;
  dpdShipmentId?: string | null;
  status: string;
  statusLabel: string;
  holdReason?: string | null;
  note: string;
  customerVisible: boolean;
  eventAt: string;
  createdBy?: string;
};

export const shipmentHoldReasonOptions = [
  { value: "missing_documents", label: "Missing documents" },
  { value: "customs_query", label: "Customs query" },
  { value: "payment_issue", label: "Payment issue" },
  { value: "customer_request", label: "Customer request" },
  { value: "address_issue", label: "Address issue" },
  { value: "restricted_item_check", label: "Restricted item check" },
  { value: "operational_delay", label: "Operational delay" },
  { value: "other", label: "Other" }
] as const;

export type ShipmentHoldReason = (typeof shipmentHoldReasonOptions)[number]["value"];

export const shipmentOperationalStatusOptions = [
  { value: "PARCEL_COLLECTED", label: "Parcel Collected" },
  { value: "WAREHOUSE_SCAN_IN", label: "Warehouse Scan In" },
  { value: "EXPORT_CUSTOMS_CLEARED", label: "Export Customs Cleared" },
  { value: "FLIGHT_ASSIGNED", label: "Flight Assigned" },
  { value: "FLIGHT_DEPARTED", label: "Flight Departed" },
  { value: "DESTINATION_ARRIVED", label: "Destination Arrived" },
  { value: "IMPORT_CUSTOMS_CLEARANCE", label: "Import Customs Clearance" },
  { value: "OUT_FOR_DELIVERY", label: "Out for Delivery" },
  { value: "DELIVERED", label: "Delivered" }
] as const;

export type ShipmentOperationalStatus = (typeof shipmentOperationalStatusOptions)[number]["value"];

export type DpdShipmentAuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  performedBy: string;
  performedAt: string;
  metadata: Record<string, unknown>;
};

function buildAuthHeaders(headers: HeadersInit | undefined, token: string | null) {
  const nextHeaders = new Headers(headers);

  if (token) {
    nextHeaders.set("Authorization", `Bearer ${token}`);
  }

  return nextHeaders;
}

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  const token = getAccessToken() ?? await refreshAccessToken();
  const response = await fetch(input, {
    ...init,
    headers: buildAuthHeaders(init.headers, token)
  });

  if (response.status !== 401) return response;

  const refreshedToken = await refreshAccessToken();
  if (!refreshedToken) return response;

  return fetch(input, {
    ...init,
    headers: buildAuthHeaders(init.headers, refreshedToken)
  });
}

function findFirstApiError(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const errors = (value as { _errors?: unknown })._errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") return errors[0];

  for (const nested of Object.values(value)) {
    const message = findFirstApiError(nested);
    if (message) return message;
  }

  return "";
}

export function formatShipmentValidationIssues(value: unknown) {
  if (!Array.isArray(value)) return "";
  const issues = [...new Set(value.filter((issue): issue is string => (
    typeof issue === "string" && Boolean(issue.trim())
  )).map((issue) => issue.trim()))];
  const priority = (issue: string) => {
    if (issue.toLowerCase() === "address has not been validated") return 0;
    if (issue.toLowerCase() === "enter a valid uk postcode") return 1;
    return 2;
  };
  return issues.sort((left, right) => priority(left) - priority(right)).join(", ");
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || !data.success) {
    const validationError = formatShipmentValidationIssues(data.validationIssues);
    const formattedError = findFirstApiError(data.errors);
    const listError = Array.isArray(data.errors) && typeof data.errors[0] === "string" ? data.errors[0] : "";
    throw new Error(validationError || data.message || formattedError || listError || "DPD label request failed");
  }

  return data as T;
}

export async function downloadDpdInvoiceTemplate() {
  const response = await fetchWithAuth(apiUrl("/api/v1/invoice-templates/dpd/download"));

  if (!response.ok) throw new Error("Unable to download invoice format.");

  return response.blob();
}

export async function uploadInvoice(input: {
  businessAccountId: string;
  branchId: string;
  file: File;
}) {
  const formData = new FormData();
  formData.append("businessAccountId", input.businessAccountId);
  formData.append("branchId", input.branchId);
  formData.append("invoiceFile", input.file);

  const response = await fetchWithAuth(apiUrl("/api/v1/invoice-uploads"), {
    method: "POST",
    body: formData
  });

  return parseApiResponse<{
    success: true;
    duplicate: boolean;
    alreadyBooked?: boolean;
    bookingState?: "EDITABLE" | "BOOKING" | "BOOKED" | "REVIEW_REQUIRED";
    message?: string;
    invoiceUpload: InvoiceUpload;
    shipmentDraft?: ShipmentDraft | null;
  }>(response);
}

export async function createManualShipmentDraft(input: {
  businessAccountId: string;
  branchId: string;
}) {
  const response = await fetchWithAuth(apiUrl("/api/v1/shipment-drafts/manual"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    shipmentDraft: ShipmentDraft;
  }>(response);
}

/**
 * Identity of a walk-in customer. Only the name is taken at the counter — every
 * other field is filled in on the draft form and enforced before booking.
 */
export type IndividualCustomerDetails = {
  contactName: string;
  mobileCountryCode?: string;
  mobileNumber?: string;
  email?: string;
  aadhaarNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  townOrCity?: string;
  county?: string;
  postcode?: string;
  pickupInstructions?: string;
};

/**
 * Opens a draft for a customer with no business account. There is no account to
 * select, so the payer's details are sent instead and stored on the draft.
 */
export async function createIndividualShipmentDraft(input: {
  branchId: string;
  customer: IndividualCustomerDetails;
}) {
  const response = await fetchWithAuth(apiUrl("/api/v1/shipment-drafts/individual"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    shipmentDraft: ShipmentDraft;
  }>(response);
}

export async function processInvoiceUpload(invoiceUploadId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/invoice-uploads/${invoiceUploadId}/process`), {
    method: "POST"
  });

  return parseApiResponse<{
    success: true;
    duplicate?: boolean;
    alreadyBooked?: boolean;
    bookingState?: "EDITABLE" | "BOOKING" | "BOOKED" | "REVIEW_REQUIRED";
    message?: string;
    invoiceUpload: InvoiceUpload;
    shipmentDraft: ShipmentDraft | null;
  }>(response);
}

export async function getShipmentDraft(shipmentDraftId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}`));

  return parseApiResponse<{
    success: true;
    shipmentDraft: ShipmentDraft;
    invoiceImport?: InvoiceImportSummary | null;
  }>(response);
}

export async function validateShipmentDraft(shipmentDraftId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}/validate`), {
    method: "POST"
  });

  return parseApiResponse<{
    success: true;
    readyForDpd: boolean;
    validationIssues: string[];
    shipmentDraft: ShipmentDraft;
  }>(response);
}

export async function updateShipmentDraft(shipmentDraftId: string, patch: ShipmentDraftPatch) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });

  return parseApiResponse<{
    success: true;
    shipmentDraft: ShipmentDraft;
  }>(response);
}

export async function createShipmentAmendment(shipmentDraftId: string, input: ShipmentAmendmentInput) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}/amendments`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    amendment: ShipmentAmendment;
  }>(response);
}

export async function previewShipmentAmendment(shipmentDraftId: string, input: ShipmentAmendmentInput) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}/amendments/preview`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    pricingImpact: ShipmentAmendmentPreview["pricingImpact"];
    fundingPreview: ShipmentAmendmentFundingPreview;
  }>(response);
}

export async function listShipmentAmendments(input: { status?: string; dateRange?: DateRange; page?: number } = {}) {
  const url = new URL(apiUrl("/api/v1/shipment-amendments"));
  if (input.status) url.searchParams.set("status", input.status);
  setDateRangeParams(url.searchParams, input.dateRange);
  url.searchParams.set("page", String(input.page ?? 1));
  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    amendments: ShipmentAmendment[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(response);
}

export async function approveShipmentAmendment(
  amendmentId: string,
  note = "",
  // Required when a walk-in's amendment changes the price: the difference is
  // collected or refunded at the counter, outside the portal.
  counterPayment?: CounterPaymentInput
) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/shipment-amendments/${amendmentId}/approve`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, ...(counterPayment ? { counterPayment } : {}) })
  });

  return parseApiResponse<{
    success: true;
    amendment: ShipmentAmendment;
    shipmentDraft: ShipmentDraft;
  }>(response);
}

export async function rejectShipmentAmendment(amendmentId: string, note = "") {
  const response = await fetchWithAuth(apiUrl(`/api/v1/shipment-amendments/${amendmentId}/reject`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note })
  });

  return parseApiResponse<{
    success: true;
    amendment: ShipmentAmendment;
  }>(response);
}

/** How a walk-in paid. Required when booking an individual shipment. */
export type CounterPaymentInput = {
  method: "CASH" | "UPI" | "BANK_TRANSFER" | "CARD" | "CHEQUE";
  reference?: string;
  note?: string;
};

async function createShipmentBooking(
  shipmentDraftId: string,
  action: "create-dpd-label" | "create-swiftline-shipment",
  counterPayment?: CounterPaymentInput,
  acceptedPricingHash?: string
) {
  const body = { ...(counterPayment ?? {}), ...(acceptedPricingHash ? { acceptedPricingHash } : {}) };
  const response = await fetchWithAuth(apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}/${action}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  // A refusal because the price moved carries the new breakdown, so it is raised
  // as a typed error the booking page can render as a comparison rather than as
  // an opaque message.
  if (response.status === 409) {
    const data = await response.clone().json().catch(() => ({}));
    const priceChanged = toPriceChangedError(data);
    if (priceChanged) throw priceChanged;
  }

  return parseApiResponse<{
    success: true;
    reused: boolean;
    dpdShipment: {
      id: string;
      dpdShipmentId: string;
      dpdTransactionId: string;
      swiftlineTrackingNumber: string;
      bookingProvider: "DPD" | "SWIFTLINE";
      providerMode: "SIMULATED" | "LIVE";
      parcelNumbers: string[];
      serviceCode: string;
      status: string;
      createdAt?: string;
    };
    labels: Array<{
      id: string;
      parcelNumber: string;
      labelType: "DPD" | "SWIFTLINE";
      providerMode: "SIMULATED" | "LIVE";
      format: string;
      labelSize: string;
      generatedAt: string;
    }>;
    bookingConfirmation: ShipmentBookingConfirmation | null;
    shipmentInvoice: {
      id: string;
      invoiceNumber: string;
      currency: string;
      totalAmountMinor: number;
      revision: number;
      status: "DRAFT" | "ISSUED";
    } | null;
  }>(response);
}

export function createDpdLabel(
  shipmentDraftId: string,
  counterPayment?: CounterPaymentInput,
  acceptedPricingHash?: string
) {
  return createShipmentBooking(shipmentDraftId, "create-dpd-label", counterPayment, acceptedPricingHash);
}

export function createSwiftlineShipment(
  shipmentDraftId: string,
  counterPayment?: CounterPaymentInput,
  acceptedPricingHash?: string
) {
  return createShipmentBooking(shipmentDraftId, "create-swiftline-shipment", counterPayment, acceptedPricingHash);
}

export async function reconcileDpdShipmentDocuments(dpdShipmentId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/dpd-shipments/${dpdShipmentId}/reconcile-documents`), {
    method: "POST"
  });

  return parseApiResponse<{
    success: true;
    message: string;
  }>(response);
}

export async function downloadDpdLabel(dpdShipmentId: string, labelId: string) {
  const access = await getDpdLabelAccessUrl(dpdShipmentId, labelId, "attachment");
  const response = await fetch(access.url);

  if (!response.ok) throw new Error("Unable to download DPD label.");

  return response.blob();
}

export async function getDpdLabelAccessUrl(
  dpdShipmentId: string,
  labelId: string,
  disposition: "inline" | "attachment" = "inline"
) {
  const url = new URL(apiUrl(`/api/v1/dpd-shipments/${dpdShipmentId}/label-access`));
  url.searchParams.set("labelId", labelId);
  url.searchParams.set("disposition", disposition);
  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    url: string;
    expiresAt: string;
    label: {
      id: string;
      parcelNumber: string;
      labelType: "DPD" | "SWIFTLINE";
      providerMode: "SIMULATED" | "LIVE";
      format: string;
      labelSize: string;
      generatedAt: string;
    };
  }>(response);
}

export async function listDpdShipments(limit = 25, trackingNumber = "") {
  const url = new URL(apiUrl("/api/v1/dpd-shipments"));
  url.searchParams.set("limit", String(limit));
  if (trackingNumber.trim()) url.searchParams.set("trackingNumber", trackingNumber.trim());
  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    shipments: DpdShipmentHistoryItem[];
  }>(response);
}

export async function holdDpdShipment(input: {
  dpdShipmentId: string;
  reason: ShipmentHoldReason;
  note: string;
}) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/dpd-shipments/${input.dpdShipmentId}/hold`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: input.reason, note: input.note })
  });

  return parseApiResponse<{
    success: true;
    message: string;
    event: ShipmentEvent;
  }>(response);
}

export async function releaseDpdShipment(input: {
  dpdShipmentId: string;
  note: string;
}) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/dpd-shipments/${input.dpdShipmentId}/release`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: input.note })
  });

  return parseApiResponse<{
    success: true;
    message: string;
    event: ShipmentEvent;
  }>(response);
}

export async function updateDpdShipmentOperationalStatus(input: {
  dpdShipmentId: string;
  status: ShipmentOperationalStatus;
  note?: string;
}) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/dpd-shipments/${input.dpdShipmentId}/status-events`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: input.status, note: input.note })
  });

  return parseApiResponse<{
    success: true;
    message: string;
    event: ShipmentEvent;
  }>(response);
}

export async function getShipmentChargeVerification(dpdShipmentId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/dpd-shipments/${dpdShipmentId}/charge-verification`));

  return parseApiResponse<{ success: true } & ShipmentChargeVerificationState>(response);
}

export async function previewFinalShipmentCharge(
  dpdShipmentId: string,
  parcels: VerifiedShipmentParcelInput[]
) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/dpd-shipments/${dpdShipmentId}/charge-verification/preview`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parcels })
  });

  return parseApiResponse<{
    success: true;
    preview: ShipmentChargeVerificationPreview;
  }>(response);
}

export async function finalizeFinalShipmentCharge(input: {
  dpdShipmentId: string;
  parcels: VerifiedShipmentParcelInput[];
  expectedTotalAmountMinor: number;
  note?: string;
}) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/dpd-shipments/${input.dpdShipmentId}/charge-verification/finalize`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parcels: input.parcels,
      expectedTotalAmountMinor: input.expectedTotalAmountMinor,
      note: input.note ?? ""
    })
  });

  return parseApiResponse<{
    success: true;
    message: string;
    verification: ShipmentChargeVerification;
  }>(response);
}

export async function listDpdShipmentAudit(shipmentDraftId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/dpd-shipments/drafts/${shipmentDraftId}/audit`));

  return parseApiResponse<{
    success: true;
    auditLogs: DpdShipmentAuditLog[];
  }>(response);
}

export async function autocompleteAddress(input: string) {
  const response = await fetchWithAuth(apiUrl("/api/v1/addresses/autocomplete"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  });

  return parseApiResponse<{
    success: true;
    predictions: AddressPrediction[];
  }>(response);
}

export async function getPlaceAddress(placeId: string, shipmentDraftId: string) {
  const url = new URL(apiUrl(`/api/v1/addresses/places/${encodeURIComponent(placeId)}`));
  url.searchParams.set("shipmentDraftId", shipmentDraftId);
  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    place: {
      placeId: string;
      formattedAddress: string;
      address: PortalAddress;
    };
  }>(response);
}

// Consignor pickup addresses are Indian, so they search Google Places while the
// consignee delivery address stays on the Ideal Postcodes UK lookup above.
export async function autocompleteConsignorAddress(input: string) {
  const response = await fetchWithAuth(apiUrl("/api/v1/addresses/consignor/autocomplete"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  });

  return parseApiResponse<{
    success: true;
    predictions: AddressPrediction[];
  }>(response);
}

export async function getConsignorPlaceAddress(placeId: string, shipmentDraftId: string) {
  const url = new URL(apiUrl(`/api/v1/addresses/consignor/places/${encodeURIComponent(placeId)}`));
  url.searchParams.set("shipmentDraftId", shipmentDraftId);
  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    place: {
      placeId: string;
      formattedAddress: string;
      address: PortalAddress;
    };
  }>(response);
}

export async function uploadShipmentKycDocument(input: {
  shipmentDraftId: string;
  type: ShipmentKycDocumentType;
  file: File;
  documentLabel?: string;
}) {
  const formData = new FormData();
  formData.append("document", input.file);
  if (input.documentLabel) formData.append("documentLabel", input.documentLabel);

  const response = await fetchWithAuth(
    apiUrl(`/api/v1/shipment-drafts/${input.shipmentDraftId}/kyc-documents/${input.type}`),
    { method: "POST", body: formData }
  );

  return parseApiResponse<{
    success: true;
    kycDocuments: ShipmentKycDocuments;
    validationIssues: string[];
  }>(response);
}

export async function deleteShipmentKycDocument(shipmentDraftId: string, type: ShipmentKycDocumentType) {
  const response = await fetchWithAuth(
    apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}/kyc-documents/${type}`),
    { method: "DELETE" }
  );

  return parseApiResponse<{
    success: true;
    kycDocuments: ShipmentKycDocuments;
    validationIssues: string[];
  }>(response);
}

export async function openShipmentKycDocument(shipmentDraftId: string, type: ShipmentKycDocumentType) {
  const response = await fetchWithAuth(
    apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}/kyc-documents/${type}`)
  );

  if (!response.ok) throw new Error("Unable to open this KYC document.");

  return response.blob();
}

export async function uploadShipmentParcelKycDocument(input: {
  shipmentDraftId: string;
  sequence: number;
  type: ShipmentKycDocumentType;
  file: File;
  documentLabel?: string;
}) {
  const formData = new FormData();
  formData.append("document", input.file);
  if (input.documentLabel) formData.append("documentLabel", input.documentLabel);

  const response = await fetchWithAuth(
    apiUrl(`/api/v1/shipment-drafts/${input.shipmentDraftId}/parcels/${input.sequence}/kyc-documents/${input.type}`),
    { method: "POST", body: formData }
  );

  return parseApiResponse<{
    success: true;
    parcelSequence: number;
    kycDocuments: ShipmentKycDocuments;
    validationIssues: string[];
  }>(response);
}

export async function deleteShipmentParcelKycDocument(shipmentDraftId: string, sequence: number, type: ShipmentKycDocumentType) {
  const response = await fetchWithAuth(
    apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}/parcels/${sequence}/kyc-documents/${type}`),
    { method: "DELETE" }
  );

  return parseApiResponse<{
    success: true;
    parcelSequence: number;
    kycDocuments: ShipmentKycDocuments;
    validationIssues: string[];
  }>(response);
}

export async function openShipmentParcelKycDocument(shipmentDraftId: string, sequence: number, type: ShipmentKycDocumentType) {
  const response = await fetchWithAuth(
    apiUrl(`/api/v1/shipment-drafts/${shipmentDraftId}/parcels/${sequence}/kyc-documents/${type}`)
  );

  if (!response.ok) throw new Error("Unable to open this KYC document.");

  return response.blob();
}

export async function validateAddress(input: {
  shipmentDraftId: string;
  address: {
    addressLine1: string;
    addressLine2?: string;
    townOrCity: string;
    county?: string;
    postcode: string;
    countryCode: string;
    countryName?: string;
  };
}) {
  const response = await fetchWithAuth(apiUrl("/api/v1/addresses/validate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    validation: AddressValidationResult;
  }>(response);
}

export async function confirmAddress(input: {
  shipmentDraftId: string;
  decision: "USE_SUGGESTED" | "KEEP_ENTERED";
}) {
  const response = await fetchWithAuth(apiUrl("/api/v1/addresses/confirm"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    shipmentDraft: ShipmentDraft;
  }>(response);
}
