import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type CreditAgreementStatus =
  | "DRAFT"
  | "GENERATED"
  | "SENT"
  | "VIEWED"
  | "SIGNED"
  | "DECLINED"
  | "EXPIRED"
  | "SUPERSEDED";

export type CreditAgreement = {
  id: string;
  agreementNumber: string;
  businessAccountId: string;
  creditAccountId: string;
  version: number;
  status: CreditAgreementStatus;
  termsVersion: string;
  snapshot: {
    business: {
      accountId: string;
      companyName: string;
      gstin: string;
      registrationId: string;
      registeredAddress: string;
      city: string;
      stateOrProvince: string;
      postalCode: string;
      addressCountry: string;
      contactName: string;
      contactEmail: string;
      contactJobTitle: string;
    };
    credit: {
      currency: "INR";
      approvedCreditLimitMinor: number;
      paymentTermsDays: number;
      billingCycle: "WEEKLY" | "MONTHLY";
      validFrom: string | null;
      validUntil: string | null;
      gracePeriodDays: number;
      maxOverdueDays: number;
      creditWarningThresholdPercent: number;
      securityDepositRequiredMinor: number;
    };
  };
  generatedDocument: AgreementDocumentMetadata | null;
  signedDocument: AgreementDocumentMetadata | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  expiredAt: string | null;
  supersededAt: string | null;
  signer: {
    name: string;
    email: string;
    jobTitle: string;
    userId?: string | null;
    ipAddress?: string;
    userAgent?: string;
  } | null;
  createdBy?: string;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

type AgreementDocumentMetadata = {
  originalName: string;
  mimeType: "application/pdf";
  size: number;
  checksumSha256: string;
  storedAt: string;
};

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  let token = getAccessToken() ?? await refreshAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status !== 401) return response;
  token = await refreshAccessToken();
  if (!token) return response;
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || "The credit agreement request could not be completed.");
  }
  return data as T;
}

export async function listAdminCreditAgreements(filters: { businessAccountId?: string; status?: CreditAgreementStatus } = {}) {
  const url = new URL(apiUrl("/api/v1/credit-agreements"));
  if (filters.businessAccountId) url.searchParams.set("businessAccountId", filters.businessAccountId);
  if (filters.status) url.searchParams.set("status", filters.status);
  return parse<{ success: true; agreements: CreditAgreement[] }>(await fetchWithAuth(url.toString()));
}

export async function getAdminCreditAgreement(agreementId: string) {
  return parse<{ success: true; agreement: CreditAgreement; auditHistory: Array<Record<string, unknown>> }>(
    await fetchWithAuth(apiUrl(`/api/v1/credit-agreements/${agreementId}`))
  );
}

export async function createAdminCreditAgreementDraft(businessAccountId: string) {
  return parse<{ success: true; message: string; agreement: CreditAgreement }>(
    await fetchWithAuth(apiUrl(`/api/v1/credit-agreements/business-accounts/${businessAccountId}/drafts`), { method: "POST" })
  );
}

export async function prepareAdminCreditActivationAgreement(businessAccountId: string) {
  return parse<{ success: true; message: string; agreement: CreditAgreement }>(
    await fetchWithAuth(apiUrl(`/api/v1/credit-agreements/business-accounts/${businessAccountId}/activation`), { method: "POST" })
  );
}

export async function generateAdminCreditAgreement(agreementId: string) {
  return parse<{ success: true; message: string; agreement: CreditAgreement }>(
    await fetchWithAuth(apiUrl(`/api/v1/credit-agreements/${agreementId}/generate`), { method: "POST" })
  );
}

export async function getAdminCreditAgreementPdf(agreementId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/credit-agreements/${agreementId}/pdf`));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "The credit agreement PDF could not be opened.");
  }
  return response.blob();
}

export async function listClientCreditAgreements(businessAccountId: string) {
  const url = new URL(apiUrl("/api/v1/client/credit-agreements"));
  url.searchParams.set("businessAccountId", businessAccountId);
  return parse<{ success: true; agreements: CreditAgreement[] }>(await fetchWithAuth(url.toString()));
}

export async function getClientCreditAgreement(agreementId: string) {
  return parse<{ success: true; agreement: CreditAgreement }>(
    await fetchWithAuth(apiUrl(`/api/v1/client/credit-agreements/${agreementId}`))
  );
}

export async function getClientCreditAgreementPdf(agreementId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/client/credit-agreements/${agreementId}/pdf`));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "The credit agreement PDF could not be opened.");
  }
  return response.blob();
}
