import { apiUrl } from "@/lib/api";
import type { BusinessAccount, BusinessAccountFormData, BusinessAccountFiles } from "@/lib/businessAccounts";

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

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || !data.success) {
    const formattedError = findFirstApiError(data.errors);
    throw new Error(data.message || formattedError || "Request failed");
  }
  return data as T;
}

export type PublicBusinessAccountUniqueCheck = {
  email?: string;
  mobileNumber?: string;
  countryCode?: string;
  registrationId?: string;
  registrationIdType?: string;
};

export async function validatePublicBusinessAccountUnique(check: PublicBusinessAccountUniqueCheck) {
  const url = new URL(apiUrl("/api/v1/public/business-accounts/validate-unique"));
  for (const [key, value] of Object.entries(check)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString());
  return parseApiResponse<{ success: true; conflicts: { email: boolean; mobileNumber: boolean; registrationId: boolean } }>(response);
}

export async function requestPublicEmailOtp(input: { email: string; recaptchaToken?: string }) {
  const response = await fetch(apiUrl("/api/v1/public/business-accounts/email-otp/request"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parseApiResponse<{ success: true; message: string; expiresInSeconds: number; resendInSeconds: number }>(response);
}

export async function verifyPublicEmailOtp(input: { email: string; code: string; recaptchaToken?: string }) {
  const response = await fetch(apiUrl("/api/v1/public/business-accounts/email-otp/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parseApiResponse<{ success: true; message: string; verificationToken: string; verifiedEmail: string; expiresInSeconds: number }>(response);
}

function appendPayload(formData: FormData, data: BusinessAccountFormData, files: BusinessAccountFiles, verificationToken: string, recaptchaToken?: string) {
  formData.append("contact", JSON.stringify(data.contact));
  const requestedCreditLimit = data.company.requestedCreditLimit.trim();
  formData.append("company", JSON.stringify({
    ...data.company,
    requestedCreditLimit: requestedCreditLimit ? Number(requestedCreditLimit) : null,
    website: data.company.website ?? ""
  }));
  formData.append("verificationToken", verificationToken);
  if (recaptchaToken) formData.append("recaptchaToken", recaptchaToken);
  for (const [key, file] of Object.entries(files)) {
    if (file) formData.append(key, file);
  }
}

export function createPublicIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function createPublicBusinessAccount(
  data: BusinessAccountFormData,
  files: BusinessAccountFiles,
  verificationToken: string,
  recaptchaToken?: string,
  idempotencyKey?: string
) {
  const formData = new FormData();
  appendPayload(formData, data, files, verificationToken, recaptchaToken);
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (verificationToken) headers["X-Verification-Token"] = verificationToken;
  const response = await fetch(apiUrl("/api/v1/public/business-accounts"), {
    method: "POST",
    body: formData,
    headers
  });
  return parseApiResponse<{ success: true; account: BusinessAccount; message: string }>(response);
}
