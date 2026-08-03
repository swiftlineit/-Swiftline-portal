import { env } from "../config/env.js";
import {
  GoogleAddressComponent,
  IndianPortalAddress,
  PortalAddress,
  mapGoogleComponentsToIndianAddress,
  mapGoogleComponentsToPortalAddress
} from "./addressMapping.service.js";

const autocompleteUrl = "https://places.googleapis.com/v1/places:autocomplete";
const placesBaseUrl = "https://places.googleapis.com/v1";

export interface AddressPrediction {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceAddressDetails {
  placeId: string;
  formattedAddress: string;
  address: PortalAddress | IndianPortalAddress;
  addressComponents: GoogleAddressComponent[];
}

export class GooglePlacesError extends Error {
  constructor(message: string, public readonly statusCode = 502) {
    super(message);
  }
}

function getPlacesApiKey() {
  if (!env.GOOGLE_PLACES_API_KEY) {
    throw new GooglePlacesError("Google Places is not configured", 503);
  }

  return env.GOOGLE_PLACES_API_KEY;
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

type PlacesRegion = {
  regionCode: string;
  languageCode: string;
  notFoundMessage: string;
};

const placesRegions = {
  gb: {
    regionCode: "gb",
    languageCode: "en-GB",
    notFoundMessage: "No matching UK address was found. Enter the address manually."
  },
  in: {
    regionCode: "in",
    languageCode: "en-IN",
    notFoundMessage: "No matching Indian address was found. Enter the address manually."
  }
} as const satisfies Record<string, PlacesRegion>;

export type PlacesRegionKey = keyof typeof placesRegions;

/**
 * Autocomplete for any country the portal supports, as opposed to the two
 * hard-coded regions the shipment flows use.
 *
 * `sessionToken` is what makes this affordable: Google bills each keystroke as
 * its own request unless the calls leading to one Place Details lookup share a
 * token, in which case the whole sequence is billed once. Callers must generate
 * one per address entry and pass the same value through to `getPlaceDetails`.
 */
export async function autocompletePlaces(
  input: string,
  countryCode: string,
  sessionToken: string
): Promise<AddressPrediction[]> {
  const apiKey = getPlacesApiKey();
  const region = countryCode.trim().toLowerCase();
  const response = await fetch(autocompleteUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey
    },
    body: JSON.stringify({
      input,
      // Bias to the country the form has selected, but do not restrict to it:
      // a company can hold an address Google files under a neighbouring region.
      ...(region ? { includedRegionCodes: [region] } : {}),
      ...(sessionToken ? { sessionToken } : {})
    })
  });
  const payload = await readGoogleJson(response);

  if (!response.ok) {
    throw new GooglePlacesError("No matching address was found. Enter the address manually.", response.status);
  }

  return readPredictions(payload);
}

export async function getPlaceDetails(placeId: string, sessionToken: string) {
  const apiKey = getPlacesApiKey();
  const url = new URL(`${placesBaseUrl}/places/${encodeURIComponent(placeId)}`);

  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,formattedAddress,addressComponents"
    }
  });
  const payload = await readGoogleJson(response);

  if (!response.ok) {
    throw new GooglePlacesError("That address could not be read. Enter the address manually.", response.status);
  }

  return {
    placeId: typeof payload.id === "string" ? payload.id : placeId,
    formattedAddress: typeof payload.formattedAddress === "string" ? payload.formattedAddress : "",
    addressComponents: Array.isArray(payload.addressComponents)
      ? payload.addressComponents as GoogleAddressComponent[]
      : []
  };
}

export async function autocompleteAddresses(
  input: string,
  region: PlacesRegionKey = "gb"
): Promise<AddressPrediction[]> {
  const apiKey = getPlacesApiKey();
  const { regionCode, languageCode, notFoundMessage } = placesRegions[region];
  const response = await fetch(autocompleteUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey
    },
    body: JSON.stringify({
      input,
      includedRegionCodes: [regionCode],
      languageCode
    })
  });
  const payload = await readGoogleJson(response);

  if (!response.ok) {
    throw new GooglePlacesError(notFoundMessage, response.status);
  }

  return readPredictions(payload);
}

function readPredictions(payload: Record<string, unknown>): AddressPrediction[] {
  const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];

  return suggestions.flatMap((suggestion) => {
    const placePrediction = typeof suggestion === "object" && suggestion !== null
      ? (suggestion as { placePrediction?: Record<string, unknown> }).placePrediction
      : undefined;
    const placeId = typeof placePrediction?.placeId === "string" ? placePrediction.placeId : "";
    const textObject = placePrediction?.text as { text?: unknown } | undefined;
    const structuredFormat = placePrediction?.structuredFormat as {
      mainText?: { text?: unknown };
      secondaryText?: { text?: unknown };
    } | undefined;

    if (!placeId) return [];

    return [{
      placeId,
      text: typeof textObject?.text === "string" ? textObject.text : "",
      mainText: typeof structuredFormat?.mainText?.text === "string" ? structuredFormat.mainText.text : "",
      secondaryText: typeof structuredFormat?.secondaryText?.text === "string" ? structuredFormat.secondaryText.text : ""
    }];
  });
}

export async function getPlaceAddressDetails(
  placeId: string,
  region: PlacesRegionKey = "gb"
): Promise<PlaceAddressDetails> {
  const apiKey = getPlacesApiKey();
  const fieldMask = "id,formattedAddress,addressComponents";
  const response = await fetch(`${placesBaseUrl}/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask
    }
  });
  const payload = await readGoogleJson(response);

  if (!response.ok) {
    throw new GooglePlacesError(placesRegions[region].notFoundMessage, response.status);
  }

  const components = Array.isArray(payload.addressComponents)
    ? payload.addressComponents as GoogleAddressComponent[]
    : [];

  return {
    placeId: typeof payload.id === "string" ? payload.id : placeId,
    formattedAddress: typeof payload.formattedAddress === "string" ? payload.formattedAddress : "",
    address: region === "in"
      ? mapGoogleComponentsToIndianAddress(components)
      : mapGoogleComponentsToPortalAddress(components),
    addressComponents: components
  };
}
