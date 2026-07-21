import { env } from "../config/env.js";
import type { PortalAddress } from "./addressMapping.service.js";

const idealBaseUrl = "https://api.ideal-postcodes.co.uk/v1";
const maxPostcodeLookupPages = 10;

export interface AddressPrediction {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
}

export interface IdealAddressDetails {
  placeId: string;
  formattedAddress: string;
  address: PortalAddress & {
    companyName?: string;
  };
  provider: "ideal_postcodes";
  udprn: string;
}

type IdealAddress = {
  udprn?: number | string;
  organisation_name?: string;
  department_name?: string;
  line_1?: string;
  line_2?: string;
  line_3?: string;
  post_town?: string;
  county?: string;
  administrative_county?: string;
  traditional_county?: string;
  postcode?: string;
};

export class IdealPostcodesError extends Error {
  constructor(message: string, public readonly statusCode = 502) {
    super(message);
  }
}

function getIdealPostcodesApiKey() {
  if (!env.IDEAL_POSTCODES_API_KEY) {
    throw new IdealPostcodesError("Ideal Postcodes is not configured", 503);
  }

  return env.IDEAL_POSTCODES_API_KEY;
}

async function readIdealJson(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function getResultAddresses(payload: Record<string, unknown>) {
  return Array.isArray(payload.result) ? payload.result as IdealAddress[] : [];
}

function getTotalResultCount(payload: Record<string, unknown>) {
  const total = payload.total;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

function formatPostcode(postcode: string) {
  return postcode.trim().toUpperCase().replace(/\s+/g, " ");
}

function compactJoin(parts: Array<string | undefined>, separator = ", ") {
  return parts.map((part) => part?.trim() ?? "").filter(Boolean).join(separator);
}

function distinctAddressParts(parts: Array<string | undefined>) {
  const seen = new Set<string>();
  return parts.map((part) => part?.trim() ?? "").filter((part) => {
    const normalized = normalizeAddressValue(part);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function getAddressCounty(address: IdealAddress) {
  return address.county?.trim()
    || address.administrative_county?.trim()
    || address.traditional_county?.trim()
    || "";
}

function mapIdealAddressToPortalAddress(address: IdealAddress): IdealAddressDetails["address"] {
  const companyName = compactJoin([address.organisation_name, address.department_name]);
  const addressLines = distinctAddressParts([address.line_1, address.line_2, address.line_3])
    .filter((line) => normalizeAddressValue(line) !== normalizeAddressValue(companyName));

  return {
    companyName,
    addressLine1: addressLines[0] ?? "",
    addressLine2: compactJoin(addressLines.slice(1)),
    townOrCity: address.post_town?.trim() ?? "",
    county: getAddressCounty(address),
    postcode: formatPostcode(address.postcode ?? ""),
    countryCode: "GB",
    countryName: "United Kingdom"
  };
}

function getFormattedAddress(address: IdealAddress) {
  return compactJoin(distinctAddressParts([
    address.organisation_name,
    address.department_name,
    address.line_1,
    address.line_2,
    address.line_3,
    address.post_town,
    formatPostcode(address.postcode ?? "")
  ]));
}

function getPlaceId(address: IdealAddress) {
  const udprn = String(address.udprn ?? "").trim();
  return udprn ? `ideal:udprn:${udprn}` : "";
}

function parseIdealPlaceId(placeId: string) {
  const match = /^ideal:udprn:(\d+)$/.exec(placeId);
  const udprn = match?.[1];
  if (!udprn) {
    throw new IdealPostcodesError("Invalid Ideal Postcodes address id.", 400);
  }

  return udprn;
}

async function getIdealResponse(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${idealBaseUrl}${path}`);
  url.searchParams.set("api_key", getIdealPostcodesApiKey());

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  const payload = await readIdealJson(response);

  return { response, payload };
}

export async function autocompleteUkAddresses(input: string): Promise<AddressPrediction[]> {
  const postcode = formatPostcode(input);
  const addresses: IdealAddress[] = [];

  for (let page = 0; page < maxPostcodeLookupPages; page += 1) {
    const { response, payload } = await getIdealResponse(`/postcodes/${encodeURIComponent(postcode)}`, {
      page: String(page)
    });

    if (response.status === 404) return [];

    if (!response.ok) {
      throw new IdealPostcodesError("No matching UK address was found. Enter the address manually.", response.status);
    }

    const pageAddresses = getResultAddresses(payload);
    addresses.push(...pageAddresses);

    const total = getTotalResultCount(payload);
    if (!total || addresses.length >= total || pageAddresses.length === 0) break;
  }

  return addresses.flatMap((address) => {
    const placeId = getPlaceId(address);
    if (!placeId) return [];

    const formattedAddress = getFormattedAddress(address);

    return [{
      placeId,
      text: formattedAddress,
      mainText: compactJoin([address.organisation_name, address.line_1]) || formattedAddress,
      secondaryText: compactJoin([address.line_2, address.line_3, address.post_town, formatPostcode(address.postcode ?? "")])
    }];
  });
}

export async function getPlaceAddressDetails(placeId: string): Promise<IdealAddressDetails> {
  const udprn = parseIdealPlaceId(placeId);
  const { response, payload } = await getIdealResponse(`/udprn/${encodeURIComponent(udprn)}`);

  if (!response.ok) {
    throw new IdealPostcodesError("No matching UK address was found. Enter the address manually.", response.status);
  }

  const result = payload.result;
  if (!result || typeof result !== "object") {
    throw new IdealPostcodesError("No matching UK address was found. Enter the address manually.", 404);
  }

  const address = result as IdealAddress;

  return {
    placeId,
    formattedAddress: getFormattedAddress(address),
    address: mapIdealAddressToPortalAddress(address),
    provider: "ideal_postcodes",
    udprn
  };
}

function normalizeAddressValue(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function predictionScore(prediction: AddressPrediction, address: {
  addressLine1: string;
  townOrCity: string;
  postcode: string;
}) {
  const predictionText = normalizeAddressValue(prediction.text);
  const line = normalizeAddressValue(address.addressLine1);
  const town = normalizeAddressValue(address.townOrCity);
  const postcode = normalizeAddressValue(address.postcode);

  return (line && predictionText.includes(line) ? 6 : 0)
    + (town && predictionText.includes(town) ? 2 : 0)
    + (postcode && predictionText.includes(postcode) ? 2 : 0);
}

export async function validateUkAddressWithPaf(address: {
  addressLine1: string;
  addressLine2?: string;
  townOrCity: string;
  county?: string;
  postcode: string;
  countryCode: "GB";
}) {
  const predictions = await autocompleteUkAddresses(address.postcode);
  const bestMatch = predictions
    .map((prediction) => ({ prediction, score: predictionScore(prediction, address) }))
    .sort((left, right) => right.score - left.score)[0];

  if (!bestMatch || bestMatch.score < 6) {
    return {
      outcome: "INCOMPLETE" as const,
      enteredAddress: address,
      missingComponents: ["building or street"],
      unconfirmedComponents: [],
      providerResult: { provider: "ideal_postcodes", matchFound: false }
    };
  }

  const details = await getPlaceAddressDetails(bestMatch.prediction.placeId);
  const lineMatches = normalizeAddressValue(details.address.addressLine1) === normalizeAddressValue(address.addressLine1);
  const townMatches = normalizeAddressValue(details.address.townOrCity) === normalizeAddressValue(address.townOrCity);
  const postcodeMatches = normalizeAddressValue(details.address.postcode) === normalizeAddressValue(address.postcode);

  return {
    outcome: lineMatches && townMatches && postcodeMatches ? "VALID" as const : "CORRECTION_SUGGESTED" as const,
    enteredAddress: address,
    suggestedAddress: details.address,
    missingComponents: [],
    unconfirmedComponents: [],
    formattedAddress: details.formattedAddress,
    providerResult: {
      provider: "ideal_postcodes",
      matchFound: true,
      udprn: details.udprn
    }
  };
}
