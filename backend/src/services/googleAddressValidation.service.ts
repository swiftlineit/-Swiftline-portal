import { env } from "../config/env.js";
import {
  GoogleAddressComponent,
  PortalAddress,
  formatPortalAddressLines,
  mapGoogleComponentsToPortalAddress
} from "./addressMapping.service.js";

const validateAddressUrl = "https://addressvalidation.googleapis.com/v1:validateAddress";

export type AddressValidationOutcome =
  | "VALID"
  | "CORRECTION_SUGGESTED"
  | "INCOMPLETE"
  | "UNAVAILABLE";

export interface AddressToValidate {
  addressLine1: string;
  addressLine2?: string;
  townOrCity: string;
  county?: string;
  postcode: string;
  countryCode: "GB";
}

export interface AddressValidationResponse {
  outcome: AddressValidationOutcome;
  enteredAddress: AddressToValidate;
  suggestedAddress?: PortalAddress;
  missingComponents: string[];
  unconfirmedComponents: string[];
  formattedAddress?: string;
  providerResult: Record<string, unknown>;
}

export class GoogleAddressValidationError extends Error {
  constructor(message: string, public readonly statusCode = 502) {
    super(message);
  }
}

function getValidationApiKey() {
  if (!env.GOOGLE_ADDRESS_VALIDATION_API_KEY) {
    throw new GoogleAddressValidationError("Address validation is temporarily unavailable.", 503);
  }

  return env.GOOGLE_ADDRESS_VALIDATION_API_KEY;
}

async function readGoogleJson(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function getValidationComponents(payload: Record<string, unknown>) {
  const result = payload.result as { address?: { addressComponents?: unknown } } | undefined;
  const components = result?.address?.addressComponents;

  return Array.isArray(components)
    ? components as Array<GoogleAddressComponent & {
      componentName?: { text?: string };
      confirmationLevel?: string;
      inferred?: boolean;
      spellCorrected?: boolean;
      replaced?: boolean;
      unexpected?: boolean;
    }>
    : [];
}

function getSuggestedAddress(payload: Record<string, unknown>) {
  const result = payload.result as {
    address?: {
      formattedAddress?: string;
      postalAddress?: { addressLines?: unknown; locality?: unknown; administrativeArea?: unknown; postalCode?: unknown };
      addressComponents?: unknown;
    };
  } | undefined;
  const components = getValidationComponents(payload);
  const mappedAddress = mapGoogleComponentsToPortalAddress(components);
  const postalAddress = result?.address?.postalAddress;

  return {
    formattedAddress: result?.address?.formattedAddress,
    address: {
      ...mappedAddress,
      addressLine1: mappedAddress.addressLine1 || (Array.isArray(postalAddress?.addressLines) ? String(postalAddress.addressLines[0] ?? "") : ""),
      addressLine2: mappedAddress.addressLine2 || (Array.isArray(postalAddress?.addressLines) ? String(postalAddress.addressLines[1] ?? "") : ""),
      townOrCity: mappedAddress.townOrCity || String(postalAddress?.locality ?? ""),
      county: mappedAddress.county || String(postalAddress?.administrativeArea ?? ""),
      postcode: mappedAddress.postcode || String(postalAddress?.postalCode ?? "").toUpperCase()
    }
  };
}

function getMissingComponents(payload: Record<string, unknown>) {
  const verdict = (payload.result as { verdict?: Record<string, unknown> } | undefined)?.verdict;
  const missingFromVerdict = verdict?.missingComponentTypes;

  if (Array.isArray(missingFromVerdict)) {
    return missingFromVerdict.filter((component): component is string => typeof component === "string");
  }

  return getValidationComponents(payload)
    .filter((component) => component.confirmationLevel === "UNCONFIRMED_AND_SUSPICIOUS")
    .map((component) => component.componentName?.text ?? component.types?.[0] ?? "address component")
    .filter(Boolean);
}

function getUnconfirmedComponents(payload: Record<string, unknown>) {
  return getValidationComponents(payload)
    .filter((component) => component.confirmationLevel && component.confirmationLevel !== "CONFIRMED")
    .map((component) => component.componentName?.text ?? component.types?.[0] ?? "address component")
    .filter(Boolean);
}

function hasSuggestedCorrection(payload: Record<string, unknown>) {
  return getValidationComponents(payload).some((component) =>
    Boolean(component.inferred || component.spellCorrected || component.replaced)
  );
}

function isAddressComplete(payload: Record<string, unknown>, missingComponents: string[]) {
  const verdict = (payload.result as { verdict?: Record<string, unknown> } | undefined)?.verdict;
  const addressComplete = verdict?.addressComplete;

  return addressComplete === true && missingComponents.length === 0;
}

export async function validateGoogleAddress(address: AddressToValidate): Promise<AddressValidationResponse> {
  const apiKey = getValidationApiKey();
  const response = await fetch(`${validateAddressUrl}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      address: {
        regionCode: address.countryCode,
        addressLines: formatPortalAddressLines(address),
        locality: address.townOrCity,
        administrativeArea: address.county ?? "",
        postalCode: address.postcode
      },
      enableUspsCass: false
    })
  });
  const payload = await readGoogleJson(response);

  if (!response.ok) {
    throw new GoogleAddressValidationError("Address validation is temporarily unavailable.", response.status);
  }

  const missingComponents = getMissingComponents(payload);
  const unconfirmedComponents = getUnconfirmedComponents(payload);
  const suggested = getSuggestedAddress(payload);
  const complete = isAddressComplete(payload, missingComponents);
  const correctionSuggested = hasSuggestedCorrection(payload);
  const outcome: AddressValidationOutcome = !complete
    ? "INCOMPLETE"
    : correctionSuggested
      ? "CORRECTION_SUGGESTED"
      : "VALID";

  return {
    outcome,
    enteredAddress: address,
    suggestedAddress: suggested.address,
    missingComponents,
    unconfirmedComponents,
    formattedAddress: suggested.formattedAddress,
    providerResult: payload
  };
}
