import type { IInvoiceUpload } from "../models/invoiceUpload.model.js";
import type { IShipmentDraft } from "../models/shipmentDraft.model.js";
import type { LabelFormat } from "../models/labelDocument.model.js";
import {
  AlsPayloadError,
  buildAlsCreateDocketPayload,
  sanitizeAlsRequestSnapshot
} from "./alsPayloadMapper.service.js";
import type { DpdProviderConfiguration } from "./dpdProviderConfiguration.service.js";

export interface DpdCreateShipmentResponse {
  dpdShipmentId: string;
  dpdTransactionId: string;
  forwardingNumber: string;
  entryNumber: string;
  parcelNumbers: string[];
  labels: Array<{
    parcelNumber: string;
    format: LabelFormat;
    content: Buffer;
    filename: string;
  }>;
  requestSnapshot: Record<string, unknown>;
  rawResponse: Record<string, unknown>;
}

export class DpdApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly providerResponse: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export class DpdTimeoutError extends Error {
  constructor(message = "The result of this ALS booking request is uncertain. Do not submit it again.") {
    super(message);
  }
}

type AlsAuth = { token: string; customerId: number };

let cachedAuth: AlsAuth | null = null;
let pendingAuth: Promise<AlsAuth> | null = null;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function errorMessage(payload: Record<string, unknown>) {
  const errors = payload.errors;
  if (Array.isArray(errors)) {
    const message = errors.map((item) => stringValue(item)).filter(Boolean).join(", ");
    if (message) return message;
  }
  if (typeof errors === "string" && errors.trim()) return errors.trim();
  const dataErrors = record(payload.data).errors;
  if (Array.isArray(dataErrors)) {
    const message = dataErrors.map((item) => stringValue(item)).filter(Boolean).join(", ");
    if (message) return message;
  }
  return stringValue(payload.message) || "ALS rejected the booking request.";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return { body: {}, parsed: false };
  try {
    return { body: JSON.parse(text) as Record<string, unknown>, parsed: true };
  } catch {
    return { body: {}, parsed: false };
  }
}

async function authenticate(configuration: DpdProviderConfiguration): Promise<AlsAuth> {
  const { companyId, email, password } = configuration.als;
  if (!configuration.apiBaseUrl || !companyId || !email || !password) {
    throw new DpdApiError("ALS integration is not configured correctly. Contact an administrator.", 503);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${configuration.apiBaseUrl.replace(/\/$/, "")}/docket_api/get_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, email, password })
      }
    );
  } catch (error) {
    throw new DpdApiError("ALS authentication is temporarily unavailable.", 502, {
      message: error instanceof Error && error.name === "AbortError" ? "Authentication timed out" : "Authentication failed"
    });
  }

  const { body, parsed } = await readJson(response);
  const data = record(body.data);
  const token = stringValue(data.token);
  const customerId = Number(data.customer_id);

  if (!parsed || body.success !== true || !token || !Number.isInteger(customerId) || customerId <= 0) {
    throw new DpdApiError("ALS authentication failed. Check the configured API account.", 503, {
      status: response.status,
      errors: body.errors ?? data.errors ?? []
    });
  }

  return { token, customerId };
}

async function getAlsAuth(configuration: DpdProviderConfiguration, forceRefresh = false) {
  if (forceRefresh) {
    cachedAuth = null;
    pendingAuth = null;
  }
  if (cachedAuth) return cachedAuth;
  if (!pendingAuth) {
    pendingAuth = authenticate(configuration)
      .then((auth) => {
        cachedAuth = auth;
        return auth;
      })
      .finally(() => {
        pendingAuth = null;
      });
  }
  return pendingAuth;
}

export function resetAlsAuthCacheForTests() {
  cachedAuth = null;
  pendingAuth = null;
}

function htmlDocument(fragment: string) {
  // The carrier returns an HTML fragment with inline layout and data-URI images.
  // A restrictive CSP travels with downloaded/emailed files, while the response
  // route applies the same policy as an HTTP header for inline viewing.
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:\">",
    "<title>DPD shipment labels</title></head><body>",
    fragment,
    "</body></html>"
  ].join("");
}

function labelFormat(fileType: string): LabelFormat | null {
  const normalized = fileType.toLowerCase();
  if (normalized.includes("html")) return "HTML";
  if (normalized.includes("pdf")) return "PDF";
  if (normalized.includes("zpl") || normalized.includes("text/plain")) return "ZPL";
  return null;
}

function labelContent(value: string, format: LabelFormat) {
  if (format === "HTML") return Buffer.from(htmlDocument(value), "utf8");
  if (format === "PDF") {
    return Buffer.from(value.replace(/^data:application\/pdf;base64,/, ""), "base64");
  }
  return Buffer.from(value, "utf8");
}

export function parseAlsCreateDocketResponse(
  payload: Record<string, unknown>,
  requestSnapshot: Record<string, unknown>
): DpdCreateShipmentResponse {
  const data = record(payload.data);
  const dpdShipmentId = stringValue(data.awb_no || data.entry_number);
  const dpdTransactionId = stringValue(data.docket_id);
  const forwardingNumber = stringValue(data.forwording_no || data.forwarding_no);
  const entryNumber = stringValue(data.entry_number);
  const parcels = Array.isArray(payload.parcels) ? payload.parcels.map(record) : [];
  const parcelNumbers = parcels
    .map((parcel) => stringValue(parcel.parcel_no || parcel.parcelNumber))
    .filter(Boolean);
  const rawLabels = Array.isArray(payload.labels) ? payload.labels.map(record) : [];
  const labels = rawLabels.flatMap((label, index) => {
    const value = stringValue(label.label || label.content || label.data);
    const format = labelFormat(stringValue(label.file_type || label.content_type || label.format));
    if (!value || !format) return [];

    const oneLabelPerParcel = rawLabels.length === parcelNumbers.length && rawLabels.length > 1;
    return [{
      parcelNumber: oneLabelPerParcel ? parcelNumbers[index] ?? dpdShipmentId : dpdShipmentId,
      format,
      content: labelContent(value, format),
      filename: stringValue(label.filename) || `dpd-label-${dpdShipmentId}.${format.toLowerCase()}`
    }];
  });

  return {
    dpdShipmentId,
    dpdTransactionId,
    forwardingNumber,
    entryNumber,
    parcelNumbers,
    labels,
    requestSnapshot,
    rawResponse: {
      success: payload.success === true,
      errors: payload.errors ?? [],
      data,
      labels: rawLabels.map((label) => ({
        file_type: label.file_type,
        filename: label.filename,
        content: "[stored-separately]"
      })),
      parcels
    }
  };
}

async function submitDocket(params: {
  configuration: DpdProviderConfiguration;
  auth: AlsAuth;
  draft: IShipmentDraft;
  invoiceUpload: IInvoiceUpload;
  trackingNumber: string;
  bookedAt: Date;
}) {
  let requestPayload;
  try {
    requestPayload = buildAlsCreateDocketPayload({
      draft: params.draft,
      invoiceUpload: params.invoiceUpload,
      configuration: params.configuration,
      customerId: params.auth.customerId,
      trackingNumber: params.trackingNumber,
      bookedAt: params.bookedAt
    });
  } catch (error) {
    if (error instanceof AlsPayloadError) throw new DpdApiError(error.message, 400);
    throw error;
  }
  const requestSnapshot = sanitizeAlsRequestSnapshot(requestPayload);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${params.configuration.apiBaseUrl.replace(/\/$/, "")}/docket_api/create_docket`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.auth.token}`
        },
        body: JSON.stringify(requestPayload)
      }
    );
  } catch {
    throw new DpdTimeoutError();
  }

  const { body, parsed } = await readJson(response);
  if (!parsed) {
    throw new DpdTimeoutError("ALS returned an unreadable booking response. Do not submit it again.");
  }
  if (body.success === true) {
    return parseAlsCreateDocketResponse(body, requestSnapshot);
  }

  const message = errorMessage(body);
  if (message.toUpperCase().includes("AUTH TOKEN EXPIRED")) {
    return { tokenExpired: true as const };
  }
  const friendlyMessage = message.toLowerCase().includes("freight amount is 0")
    ? "ALS could not resolve a freight rate for DPD UK NEXTDAY. Contact Swiftline Operations."
    : "ALS rejected some carrier-required shipment information.";
  throw new DpdApiError(friendlyMessage, response.ok ? 400 : response.status, {
    status: response.status,
    errors: body.errors ?? record(body.data).errors ?? []
  });
}

export async function createDpdShipment(
  configuration: DpdProviderConfiguration,
  draft: IShipmentDraft,
  invoiceUpload: IInvoiceUpload,
  trackingNumber: string,
  bookedAt: Date
): Promise<DpdCreateShipmentResponse> {
  if (configuration.mode !== "LIVE" || !configuration.apiBaseUrl) {
    throw new DpdApiError("Live ALS integration is not configured correctly.", 503);
  }

  const auth = await getAlsAuth(configuration);
  const first = await submitDocket({ configuration, auth, draft, invoiceUpload, trackingNumber, bookedAt });
  if (!("tokenExpired" in first)) return first;

  // An explicit expired-token response means ALS rejected the booking before it
  // was created. Refreshing once is therefore the only safe automatic retry.
  const refreshedAuth = await getAlsAuth(configuration, true);
  const second = await submitDocket({ configuration, auth: refreshedAuth, draft, invoiceUpload, trackingNumber, bookedAt });
  if ("tokenExpired" in second) {
    throw new DpdApiError("ALS authentication expired again. Contact an administrator.", 503);
  }
  return second;
}
