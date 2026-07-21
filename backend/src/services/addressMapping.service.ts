export interface PortalAddress {
  addressLine1: string;
  addressLine2: string;
  townOrCity: string;
  county: string;
  postcode: string;
  countryCode: "GB";
  countryName: string;
}

export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

function findComponent(components: GoogleAddressComponent[], type: string) {
  return components.find((component) => component.types?.includes(type));
}

function getLongText(components: GoogleAddressComponent[], type: string) {
  return findComponent(components, type)?.longText?.trim() ?? "";
}

function getShortText(components: GoogleAddressComponent[], type: string) {
  return findComponent(components, type)?.shortText?.trim() ?? "";
}

export function mapGoogleComponentsToPortalAddress(components: GoogleAddressComponent[]): PortalAddress {
  const subpremise = getLongText(components, "subpremise");
  const premise = getLongText(components, "premise");
  const streetNumber = getLongText(components, "street_number");
  const route = getLongText(components, "route");
  const postalTown = getLongText(components, "postal_town");
  const locality = getLongText(components, "locality");
  const county = getLongText(components, "administrative_area_level_2");
  const countryCode = getShortText(components, "country").toUpperCase();
  const postcode = getLongText(components, "postal_code").toUpperCase();
  const line1Parts = [streetNumber, route].filter(Boolean);
  const line2Parts = [subpremise, premise].filter(Boolean);

  return {
    addressLine1: line1Parts.length ? line1Parts.join(" ") : premise || route,
    addressLine2: line2Parts.join(", "),
    townOrCity: postalTown || locality || county,
    county,
    postcode,
    countryCode: countryCode === "GB" ? "GB" : "GB",
    countryName: "United Kingdom"
  };
}

export function formatPortalAddressLines(address: {
  addressLine1: string;
  addressLine2?: string;
  townOrCity: string;
  county?: string;
  postcode: string;
}) {
  return [
    address.addressLine1,
    address.addressLine2 ?? "",
    address.townOrCity,
    address.county ?? "",
    address.postcode
  ].filter(Boolean);
}
