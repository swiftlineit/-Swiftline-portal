/**
 * Address lookup for the account forms, available to any signed-in user.
 *
 * Provider is chosen by the country the form has selected: GB goes to Ideal
 * Postcodes, whose Royal Mail PAF data is authoritative for UK postcodes, and
 * everywhere else goes to Google Places. That mirrors the split the shipment
 * flows already use, but decided per request instead of per endpoint.
 *
 * Separate from `address.controller.ts`, which stays scoped to the operations
 * shipment flows and their draft-linked auditing.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import {
  GooglePlacesError,
  autocompletePlaces,
  getPlaceDetails
} from "../services/googlePlaces.service.js";
import {
  IdealPostcodesError,
  autocompleteUkAddresses,
  getPlaceAddressDetails as getIdealPlaceAddress
} from "../services/idealPostcodes.service.js";
import { mapGoogleComponentsToGenericAddress } from "../services/addressMapping.service.js";

const UK_COUNTRY_CODE = "GB";

const autocompleteSchema = z.object({
  // Two characters is the shortest query worth sending; anything less matches
  // most of a country and is billed for nothing useful.
  input: z.string().trim().min(2).max(200),
  countryCode: z.string().trim().length(2).toUpperCase(),
  sessionToken: z.string().trim().max(100).optional().default("")
});

const placeSchema = z.object({
  countryCode: z.string().trim().length(2).toUpperCase(),
  sessionToken: z.string().trim().max(100).optional().default("")
});

function respondToProviderError(error: unknown, response: Response) {
  if (error instanceof GooglePlacesError || error instanceof IdealPostcodesError) {
    // A lookup outage must never read as a form error: the client falls back to
    // manual entry on any non-2xx.
    return response.status(error.statusCode).json({ success: false, message: error.message });
  }

  throw error;
}

export async function autocompleteLookup(request: Request, response: Response): Promise<Response> {
  const parsed = autocompleteSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const { input, countryCode, sessionToken } = parsed.data;

  try {
    const predictions = countryCode === UK_COUNTRY_CODE
      ? await autocompleteUkAddresses(input)
      : await autocompletePlaces(input, countryCode, sessionToken);

    return response.status(200).json({ success: true, provider: countryCode === UK_COUNTRY_CODE ? "ideal" : "google", predictions });
  } catch (error) {
    return respondToProviderError(error, response);
  }
}

export async function getLookupPlace(request: Request, response: Response): Promise<Response> {
  const parsed = placeSchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const placeId = String(request.params.placeId ?? "").trim();
  if (!placeId) return response.status(400).json({ success: false, message: "Invalid place id" });

  const { countryCode, sessionToken } = parsed.data;

  try {
    if (countryCode === UK_COUNTRY_CODE) {
      const ideal = await getIdealPlaceAddress(placeId);

      return response.status(200).json({
        success: true,
        address: {
          // A PAF record can carry the premises in the organisation name with an
          // empty line 1 (a named building on its own postcode). Falling back
          // keeps the user from picking a suggestion and getting a blank field.
          addressLine1: ideal.address.addressLine1 || ideal.address.companyName || "",
          addressLine2: ideal.address.addressLine2,
          city: ideal.address.townOrCity,
          state: ideal.address.county,
          postalCode: ideal.address.postcode,
          countryCode: "GB",
          countryName: "United Kingdom"
        }
      });
    }

    const place = await getPlaceDetails(placeId, sessionToken);

    return response.status(200).json({
      success: true,
      address: mapGoogleComponentsToGenericAddress(place.addressComponents)
    });
  } catch (error) {
    return respondToProviderError(error, response);
  }
}
