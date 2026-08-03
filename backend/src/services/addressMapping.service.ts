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

export interface GenericPortalAddress {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  countryName: string;
}

/**
 * Country-agnostic mapping, for the address lookup the account forms use.
 *
 * The UK and Indian mappers below stay as they are: they serve the shipment
 * flows, where the shape of the record and the fallbacks differ. This one has
 * to work for anywhere, so it walks the administrative levels from most to
 * least specific and takes the first that is present.
 */
export function mapGoogleComponentsToGenericAddress(
  components: GoogleAddressComponent[]
): GenericPortalAddress {
  const subpremise = getLongText(components, "subpremise");
  const premise = getLongText(components, "premise");
  const streetNumber = getLongText(components, "street_number");
  const route = getLongText(components, "route");
  const sublocality = getLongText(components, "sublocality_level_1") || getLongText(components, "sublocality");
  const neighborhood = getLongText(components, "neighborhood");
  const postalTown = getLongText(components, "postal_town");
  const locality = getLongText(components, "locality");
  const district = getLongText(components, "administrative_area_level_2");
  const state = getLongText(components, "administrative_area_level_1");

  const line1Parts = [streetNumber, route].filter(Boolean);
  const line2Parts = [subpremise, premise].filter(Boolean);

  return {
    addressLine1: line1Parts.length ? line1Parts.join(" ") : premise || route || sublocality,
    // Only ever a suggestion: the form keeps whatever the user typed here, so
    // their building or floor is never overwritten by a lookup.
    addressLine2: line2Parts.join(", "),
    city: postalTown || locality || sublocality || neighborhood || district,
    state,
    postalCode: getLongText(components, "postal_code").toUpperCase(),
    countryCode: getShortText(components, "country").toUpperCase(),
    countryName: getLongText(components, "country")
  };
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

export interface IndianPortalAddress {
  addressLine1: string;
  addressLine2: string;
  townOrCity: string;
  county: string;
  postcode: string;
  countryCode: "IN";
  countryName: "India";
}

/**
 * Indian addresses rarely carry `postal_town`, and the district/state split lands
 * on different administrative levels than in the UK, so consignor addresses get
 * their own mapping rather than reusing the UK one.
 */
export function mapGoogleComponentsToIndianAddress(components: GoogleAddressComponent[]): IndianPortalAddress {
  const subpremise = getLongText(components, "subpremise");
  const premise = getLongText(components, "premise");
  const streetNumber = getLongText(components, "street_number");
  const route = getLongText(components, "route");
  const sublocality = getLongText(components, "sublocality_level_1") || getLongText(components, "sublocality");
  const neighborhood = getLongText(components, "neighborhood");
  const locality = getLongText(components, "locality");
  const district = getLongText(components, "administrative_area_level_3")
    || getLongText(components, "administrative_area_level_2");
  const state = getLongText(components, "administrative_area_level_1");
  const postcode = getLongText(components, "postal_code").replace(/\D/g, "");
  const line1Parts = [subpremise, premise, streetNumber, route].filter(Boolean);
  const line2Parts = [sublocality, neighborhood].filter(Boolean);

  return {
    addressLine1: line1Parts.join(", ") || locality,
    addressLine2: line2Parts.join(", "),
    townOrCity: locality || district || sublocality,
    county: state,
    postcode,
    countryCode: "IN",
    countryName: "India"
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
