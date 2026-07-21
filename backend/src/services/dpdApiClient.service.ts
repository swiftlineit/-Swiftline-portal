import type { DpdProviderConfiguration } from "./dpdProviderConfiguration.service.js";
import type { DpdShipmentPayload } from "./dpdPayloadMapper.service.js";

export interface DpdCredentials {
  username?: string;
  password?: string;
  apiToken?: string;
  accountNumber?: string;
}

export interface DpdCreateShipmentResponse {
  dpdShipmentId: string;
  dpdTransactionId: string;
  parcelNumbers: string[];
  labels: Array<{ parcelNumber: string; labelBase64: string }>;
  labelBase64: string;
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
  constructor() {
    super("The result of this request is uncertain. Do not submit it again.");
  }
}

function getAuthorizationHeader(credentials: DpdCredentials) {
  if (credentials.apiToken) return `Bearer ${credentials.apiToken}`;
  if (credentials.username && credentials.password) {
    return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
  }

  throw new DpdApiError("DPD integration is not configured correctly. Contact an administrator.", 503);
}

function getNestedString(value: unknown, paths: string[][]): string {
  for (const path of paths) {
    let cursor = value;

    for (const segment of path) {
      if (!cursor || typeof cursor !== "object") {
        cursor = undefined;
        break;
      }

      cursor = (cursor as Record<string, unknown>)[segment];
    }

    if (typeof cursor === "string" && cursor.trim()) return cursor.trim();
    if (typeof cursor === "number") return String(cursor);
  }

  return "";
}

function getParcelNumbers(payload: Record<string, unknown>) {
  const candidates = [
    payload.parcelNumbers,
    payload.parcels,
    (payload.shipment as Record<string, unknown> | undefined)?.parcels
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    const numbers = candidate.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!item || typeof item !== "object") return [];

      const record = item as Record<string, unknown>;
      return [
        record.parcelNumber,
        record.number,
        record.trackingNumber,
        record.id
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    });

    if (numbers.length) return numbers;
  }

  return [];
}

function getLabelBase64(payload: Record<string, unknown>) {
  const label = getNestedString(payload, [
    ["label"],
    ["labelBase64"],
    ["labelData"],
    ["labels", "0", "data"],
    ["labels", "0", "content"],
    ["shipment", "label"],
    ["shipment", "labelBase64"]
  ]);

  return label.replace(/^data:application\/pdf;base64,/, "");
}

function getLabels(payload: Record<string, unknown>, parcelNumbers: string[]) {
  const candidates = [
    payload.labels,
    (payload.shipment as Record<string, unknown> | undefined)?.labels
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    const labels = candidate.flatMap((item, index) => {
      if (typeof item === "string") {
        const labelBase64 = item.replace(/^data:application\/pdf;base64,/, "");
        return labelBase64 ? [{ parcelNumber: parcelNumbers[index] ?? "", labelBase64 }] : [];
      }
      if (!item || typeof item !== "object") return [];

      const record = item as Record<string, unknown>;
      const labelBase64 = getNestedString(record, [
        ["data"],
        ["content"],
        ["labelBase64"],
        ["label"]
      ]).replace(/^data:application\/pdf;base64,/, "");
      if (!labelBase64) return [];

      const parcelNumber = getNestedString(record, [
        ["parcelNumber"],
        ["trackingNumber"],
        ["number"],
        ["id"]
      ]) || parcelNumbers[index] || "";
      return [{ parcelNumber, labelBase64 }];
    });

    if (labels.length) return labels;
  }

  const labelBase64 = getLabelBase64(payload);
  return labelBase64
    ? [{ parcelNumber: parcelNumbers[0] ?? "", labelBase64 }]
    : [];
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

export async function createDpdShipment(
  configuration: DpdProviderConfiguration,
  payload: DpdShipmentPayload,
  idempotencyKey: string
): Promise<DpdCreateShipmentResponse> {
  if (configuration.mode !== "LIVE" || !configuration.apiBaseUrl) {
    throw new DpdApiError("Live DPD integration is not configured correctly.", 503);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${configuration.apiBaseUrl.replace(/\/$/, "")}/shipments`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: getAuthorizationHeader(configuration.credentials),
        "Idempotency-Key": idempotencyKey,
        "X-Customer-ID": configuration.customerId,
        "X-Business-Unit": configuration.businessUnitCode
      },
      body: JSON.stringify(payload)
    });
    const responsePayload = await readJson(response);

    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "DPD integration is not configured correctly. Contact an administrator."
        : "Some shipment information was rejected by DPD. Review the highlighted fields.";

      throw new DpdApiError(message, response.status, responsePayload);
    }

    const parcelNumbers = getParcelNumbers(responsePayload);
    const labels = getLabels(responsePayload, parcelNumbers);
    return {
      dpdShipmentId: getNestedString(responsePayload, [["shipmentId"], ["id"], ["shipment", "id"]]),
      dpdTransactionId: getNestedString(responsePayload, [["transactionId"], ["shipment", "transactionId"]]),
      parcelNumbers,
      labels,
      labelBase64: labels[0]?.labelBase64 ?? "",
      rawResponse: responsePayload
    };
  } catch (error) {
    if (error instanceof DpdApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new DpdTimeoutError();

    throw new DpdApiError("DPD is temporarily unavailable.", 502, {
      message: error instanceof Error ? error.message : "Unknown DPD error"
    });
  } finally {
    clearTimeout(timeout);
  }
}
