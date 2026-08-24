import type { ShipmentOperationalStatus } from "./shipmentStatusSequence.service.js";

export const gatewayArrivalStatus: ShipmentOperationalStatus = "DESTINATION_ARRIVED";

export type GatewayCodeResolution =
  | { gatewayCode: string; error: null }
  | { gatewayCode: ""; error: string };

/**
 * Resolves the structured IATA value allowed on a tracking milestone.
 *
 * Gateway data belongs to destination arrival, never to a manifest dispatch or
 * another shipment status. UK tracking follows the agreed LHR route, while all
 * other destinations must state the actual three-letter gateway Operations
 * scanned. Keeping this rule server-side prevents an API caller from bypassing
 * the conditional staff form.
 */
export function resolveTrackingGatewayCode(input: {
  status: ShipmentOperationalStatus;
  destinationCountryCode?: string | null;
  gatewayCode?: string | null;
}): GatewayCodeResolution {
  const supplied = String(input.gatewayCode ?? "").trim().toUpperCase();

  if (input.status !== gatewayArrivalStatus) {
    return supplied
      ? { gatewayCode: "", error: "Gateway IATA can only be recorded with Arrived at Destination Gateway." }
      : { gatewayCode: "", error: null };
  }

  if (String(input.destinationCountryCode ?? "").trim().toUpperCase() === "GB") {
    return supplied && supplied !== "LHR"
      ? { gatewayCode: "", error: "United Kingdom gateway tracking is fixed to LHR." }
      : { gatewayCode: "LHR", error: null };
  }

  return /^[A-Z]{3}$/.test(supplied)
    ? { gatewayCode: supplied, error: null }
    : { gatewayCode: "", error: "Enter the actual three-letter gateway IATA code before recording destination arrival." };
}

/** One bulk arrival scan cannot truthfully assign one gateway across countries. */
export function resolveBulkTrackingGatewayCode(input: {
  status: ShipmentOperationalStatus;
  destinationCountryCodes: readonly string[];
  gatewayCode?: string | null;
}): GatewayCodeResolution {
  const countries = [...new Set(input.destinationCountryCodes.map((code) => code.trim().toUpperCase()))];
  if (input.status === gatewayArrivalStatus && countries.length > 1) {
    return {
      gatewayCode: "",
      error: "A destination-arrival bulk update can only cover one destination country. Split this selection before assigning its gateway IATA."
    };
  }

  return resolveTrackingGatewayCode({
    status: input.status,
    destinationCountryCode: countries[0] ?? "",
    gatewayCode: input.gatewayCode
  });
}
