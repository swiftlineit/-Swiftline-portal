import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type ShipmentType = "international_cargo" | "international_courier";
export const businessAccountStatuses = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "active",
  "suspended"
] as const;
export type BusinessAccountStatus = (typeof businessAccountStatuses)[number];

// Allowed lifecycle transitions, mirroring the backend state machine so the UI
// only ever offers actions the API will accept.
export const businessAccountStatusTransitions: Record<BusinessAccountStatus, BusinessAccountStatus[]> = {
  draft: ["pending_review"],
  pending_review: ["approved", "rejected"],
  approved: ["active", "rejected"],
  active: ["suspended"],
  suspended: ["active"],
  rejected: []
};

export type BusinessAccountOperationalAction =
  | "deposit_required"
  | "deposit_received"
  | "ledger_viewed";
export type CreditLimitStatus = "not_reviewed" | "approved" | "not_approved";
export type DepositStatus = "not_required" | "required" | "received";
export type AgreementStatus = "not_generated" | "generated" | "signed";
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
export type BusinessKycOverallStatus =
  | "documents_pending"
  | "submitted"
  | "under_review"
  | "additional_information_required"
  | "verified"
  | "rejected";
export type BusinessKycCheckKey = "contactDetails" | "companyDetails" | DocumentType;

export type BusinessDocument = {
  type: DocumentType;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type BusinessAccount = {
  _id: string;
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
    gstin?: string;
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
    operatingCountry?: string;
    website?: string | null;
    industry: string;
    monthlyShipmentVolume: string;
    requestedCreditLimit: {
      currency: string;
      amount: number | null;
    };
  };
  documents?: Partial<Record<DocumentType, BusinessDocument>>;
  kycReview?: {
    overallStatus: BusinessKycOverallStatus;
    checks?: Partial<Record<BusinessKycCheckKey, {
      status: BusinessKycCheckStatus;
      note?: string | null;
      reviewedAt?: string | null;
    }>>;
    finalDecision?: "rejected" | null;
    reviewStartedAt?: string | null;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
  };
  creditLimitStatus?: CreditLimitStatus;
  depositStatus?: DepositStatus;
  agreementStatus?: AgreementStatus;
  ledgerViewedAt?: string | null;
  assignedBranch?: {
    _id: string;
    name: string;
    code: string;
    status?: string;
  } | string | null;
  createdBy?: { email?: string; name?: string };
  createdAt: string;
  submittedAt?: string | null;
};

export type BusinessAccountFormData = {
  contact: BusinessAccount["contact"];
  company: Omit<BusinessAccount["company"], "requestedCreditLimit"> & {
    requestedCreditCurrency: string;
    requestedCreditLimit: string;
  };
};

export type BusinessAccountFiles = Partial<Record<DocumentType, File | null>>;

export type BusinessAccountUniqueCheck = {
  email?: string;
  mobileNumber?: string;
  countryCode?: string;
  registrationId?: string;
  excludeAccountId?: string;
};

export type BusinessKycReviewUpdate = {
  checks?: Partial<Record<BusinessKycCheckKey, {
    status: BusinessKycCheckStatus;
    note?: string | null;
  }>>;
  finalDecision?: "rejected" | null;
  startReview?: boolean;
};

export const businessAccountMemberRoles = [
  "account_owner",
  "account_admin",
  "operations",
  "finance",
  "tracking_only"
] as const;
export type BusinessAccountMemberRole = (typeof businessAccountMemberRoles)[number];
export type BusinessAccountMemberStatus = "invited" | "active" | "suspended" | "removed";

export type BusinessAccountMember = {
  _id: string;
  role: BusinessAccountMemberRole;
  status: BusinessAccountMemberStatus;
  joinedAt?: string | null;
  createdAt: string;
  user: {
    _id: string;
    firstName: string;
    lastName: string;
    name: string;
    email: string;
    phone: string;
    userStatus: "invited" | "active" | "suspended" | "disabled";
    lastLogin?: string | null;
  };
  assignedBranches: Array<{
    _id: string;
    name: string;
    code: string;
  }>;
  invitation?: {
    expiresAt: string;
    acceptedAt?: string | null;
    revokedAt?: string | null;
  } | null;
};

export type CreateClientAccessInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: BusinessAccountMemberRole;
  assignedBranches: string[];
  sendInvitationEmail: boolean;
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

function appendPayload(formData: FormData, data: BusinessAccountFormData, files: BusinessAccountFiles) {
  formData.append("contact", JSON.stringify(data.contact));
  const requestedCreditLimit = data.company.requestedCreditLimit.trim();

  formData.append("company", JSON.stringify({
    ...data.company,
    requestedCreditLimit: requestedCreditLimit ? Number(requestedCreditLimit) : null,
    website: data.company.website ?? ""
  }));

  for (const [key, file] of Object.entries(files)) {
    if (file) formData.append(key, file);
  }
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || !data.success) {
    const formattedError = findFirstApiError(data.errors);
    throw new Error(data.message || formattedError || "Business account request failed");
  }

  return data as T;
}

function findFirstApiError(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const errors = (value as { _errors?: unknown })._errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") {
    return errors[0];
  }

  for (const nested of Object.values(value)) {
    const message = findFirstApiError(nested);
    if (message) return message;
  }

  return "";
}

// Pagination is opt-in: pass a page to receive a bounded window plus the total
// count; omit it (e.g. branch detail) to receive every matching account.
// `status` narrows the count the API reports, so a caller that only needs a
// tally (the dashboard KPIs) can ask for page 1 of 1 and read `total`.
export async function listBusinessAccounts(search = "", branchId = "", page?: number, pageSize?: number, status?: BusinessAccountStatus) {
  const url = new URL(apiUrl("/api/v1/business-accounts"));
  if (search) url.searchParams.set("search", search);
  if (branchId) url.searchParams.set("branchId", branchId);
  if (page) url.searchParams.set("page", String(page));
  if (pageSize) url.searchParams.set("pageSize", String(pageSize));
  if (status) url.searchParams.set("status", status);

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    accounts: BusinessAccount[];
    total?: number;
    page?: number;
    pageSize?: number;
  }>(response);
}

export async function getBusinessAccount(accountId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}`));

  return parseApiResponse<{ success: true; account: BusinessAccount }>(response);
}

export async function validateBusinessAccountUnique(check: BusinessAccountUniqueCheck) {
  const url = new URL(apiUrl("/api/v1/business-accounts/validate-unique"));

  for (const [key, value] of Object.entries(check)) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    conflicts: {
      email: boolean;
      mobileNumber: boolean;
      registrationId: boolean;
    };
  }>(response);
}

export async function createBusinessAccount(data: BusinessAccountFormData, files: BusinessAccountFiles) {
  const formData = new FormData();
  appendPayload(formData, data, files);

  const response = await fetchWithAuth(apiUrl("/api/v1/business-accounts"), {
    method: "POST",
    body: formData
  });

  return parseApiResponse<{ success: true; account: BusinessAccount }>(response);
}

export async function updateBusinessAccount(
  accountId: string,
  data: BusinessAccountFormData,
  files: BusinessAccountFiles
) {
  const formData = new FormData();
  appendPayload(formData, data, files);

  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}`), {
    method: "PATCH",
    body: formData
  });

  return parseApiResponse<{ success: true; account: BusinessAccount }>(response);
}

export async function submitBusinessAccount(accountId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/submit`), {
    method: "POST"
  });

  return parseApiResponse<{ success: true; account: BusinessAccount; message: string }>(response);
}

export async function updateBusinessAccountStatus(accountId: string, status: BusinessAccountStatus) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/status`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });

  return parseApiResponse<{ success: true; account: BusinessAccount; message: string }>(response);
}

export async function updateBusinessAccountOperationalAction(accountId: string, action: BusinessAccountOperationalAction) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/operational-action`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });

  return parseApiResponse<{ success: true; account: BusinessAccount; message: string }>(response);
}

export async function assignBusinessAccountBranch(accountId: string, branchId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/assign-branch`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branchId })
  });

  return parseApiResponse<{ success: true; account: BusinessAccount; message: string }>(response);
}

export async function getBusinessAccountDocument(accountId: string, documentType: DocumentType) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/documents/${documentType}`));

  if (!response.ok) {
    throw new Error("Unable to open business account document.");
  }

  return response.blob();
}

export async function updateBusinessAccountKycReview(accountId: string, update: BusinessKycReviewUpdate) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/kyc-review`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });

  return parseApiResponse<{ success: true; account: BusinessAccount }>(response);
}

export async function listBusinessAccountMembers(accountId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/members`));

  return parseApiResponse<{ success: true; members: BusinessAccountMember[] }>(response);
}

export async function createBusinessAccountClientAccess(accountId: string, input: CreateClientAccessInput) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/client-access`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    member: BusinessAccountMember;
    emailQueued: boolean;
    emailSent: boolean;
    emailSkipped: boolean;
    emailError?: string;
  }>(response);
}

export async function resendBusinessAccountInvitation(accountId: string, memberId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/members/${memberId}/resend-invitation`), {
    method: "POST"
  });

  return parseApiResponse<{ success: true; emailSent: boolean; emailSkipped: boolean; emailError?: string }>(response);
}

// Regenerate and fetch the activation link on demand (for manual delivery). The
// raw token is only requested when the admin explicitly asks to copy the link.
export async function getBusinessAccountInvitationLink(accountId: string, memberId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/members/${memberId}/invitation-link`), {
    method: "POST"
  });

  return parseApiResponse<{ success: true; activationUrl: string }>(response);
}

export async function updateBusinessAccountMemberStatus(
  accountId: string,
  memberId: string,
  status: Exclude<BusinessAccountMemberStatus, "invited">
) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/business-accounts/${accountId}/members/${memberId}/status`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });

  return parseApiResponse<{ success: true; member: BusinessAccountMember }>(response);
}
