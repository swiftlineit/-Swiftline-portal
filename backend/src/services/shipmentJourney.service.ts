import mongoose from "mongoose";
import { DeliveryPartner } from "../models/deliveryPartner.model.js";
import { DeliveryAssignment } from "../models/pod.model.js";
import type { ISwiftlineRoute, TrackingProfileSetting } from "../models/swiftlineRoute.model.js";
import { findRoute } from "./swiftlineRoute.service.js";
import { formatShipmentEventLabel } from "./shipmentStatusSequence.service.js";

export type TrackingProfile = Exclude<TrackingProfileSetting, "AUTO">;

export type JourneyEvent = {
  status: string;
  eventAt: Date | string;
  gatewayCode?: string | null;
  gatewayName?: string | null;
  partnerName?: string | null;
  partnerCode?: string | null;
};

export type TrackingJourneyContext = {
  profile: TrackingProfile;
  originHubName: string;
  destinationCountryName: string;
  gatewayCode: string;
  gatewayName: string;
  gatewayLabel: string;
  deliveryPartnerName: string;
  deliveryPartnerCode: string;
  routeSegments: string[];
};

export type TrackingJourneyMilestone = {
  key: string;
  label: string;
  reachedAt: string | null;
  isCurrent: boolean;
};

export type TrackingJourney = {
  version: 2;
  context: TrackingJourneyContext;
  stages: TrackingJourneyMilestone[];
  milestones: TrackingJourneyMilestone[];
};

/**
 * Destinations the EUROPE tracking flow describes.
 *
 * Turkey is deliberately absent. Swiftline sells it as a Middle East lane, and
 * `lib/rateCardRegions.ts` on the frontend groups it that way for customers, so
 * presenting it as a European shipment while it is browsed under Middle East
 * told the customer two different stories about the same parcel. Falling
 * through to OTHER also reads better: "In Transit to Turkey" rather than "In
 * Transit to Europe". A Turkish lane can still be pinned to EUROPE explicitly
 * on its route record if that ever changes.
 */
const europeanCountryCodes = new Set([
  "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE",
  "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "XK", "LV", "LI", "LT",
  "LU", "MT", "MD", "MC", "ME", "NL", "MK", "NO", "PL", "PT", "RO", "RU",
  "SM", "RS", "SK", "SI", "ES", "SE", "CH", "UA", "VA"
]);

const gatewayNames: Record<string, string> = {
  LHR: "London",
  JFK: "New York",
  ORD: "Chicago",
  LAX: "Los Angeles",
  MIA: "Miami",
  YYZ: "Toronto",
  YVR: "Vancouver",
  AMS: "Amsterdam",
  FRA: "Frankfurt",
  CDG: "Paris"
};

const milestoneDefinitions: Array<{ key: string; statuses: readonly string[] }> = [
  { key: "BOOKED", statuses: ["SHIPMENT_BOOKED", "SHIPMENT_CREATED"] },
  { key: "COLLECTED", statuses: ["PARCEL_COLLECTED"] },
  { key: "ORIGIN_RECEIVED", statuses: ["WAREHOUSE_SCAN_IN"] },
  { key: "ORIGIN_PROCESSED", statuses: ["ORIGIN_HUB_PROCESSED"] },
  { key: "EXPORT_READY", statuses: ["READY_FOR_EXPORT", "EXPORT_CUSTOMS_CLEARED", "FLIGHT_ASSIGNED"] },
  { key: "ORIGIN_DISPATCHED", statuses: ["ORIGIN_HUB_DISPATCHED", "FLIGHT_DEPARTED"] },
  // International transit is the active phase established by departure. It is
  // customer-visible without asking Operations to record a duplicate scan.
  { key: "INTERNATIONAL_TRANSIT", statuses: ["ORIGIN_HUB_DISPATCHED", "FLIGHT_DEPARTED", "IN_TRANSIT"] },
  { key: "GATEWAY_ARRIVED", statuses: ["DESTINATION_ARRIVED"] },
  { key: "CUSTOMS_IN_PROGRESS", statuses: ["IMPORT_CUSTOMS_CLEARANCE"] },
  { key: "CUSTOMS_CLEARED", statuses: ["IMPORT_CUSTOMS_CLEARED"] },
  { key: "PARTNER_TRANSFERRED", statuses: ["DELIVERY_PARTNER_TRANSFERRED"] },
  { key: "DELIVERY_HUB", statuses: ["DELIVERY_HUB_ARRIVED"] },
  { key: "OUT_FOR_DELIVERY", statuses: ["OUT_FOR_DELIVERY"] },
  { key: "DELIVERED", statuses: ["DELIVERED"] }
];

const stageDefinitions: Array<{ key: string; label: string; milestoneKeys: readonly string[] }> = [
  { key: "ORIGIN", label: "Origin", milestoneKeys: ["BOOKED", "COLLECTED", "ORIGIN_RECEIVED", "ORIGIN_PROCESSED"] },
  { key: "EXPORT", label: "Export", milestoneKeys: ["EXPORT_READY", "ORIGIN_DISPATCHED"] },
  { key: "INTERNATIONAL", label: "International Transit", milestoneKeys: ["INTERNATIONAL_TRANSIT"] },
  { key: "GATEWAY_CUSTOMS", label: "Gateway & Customs", milestoneKeys: ["GATEWAY_ARRIVED", "CUSTOMS_IN_PROGRESS", "CUSTOMS_CLEARED"] },
  { key: "LAST_MILE", label: "Last Mile", milestoneKeys: ["PARTNER_TRANSFERRED", "DELIVERY_HUB", "OUT_FOR_DELIVERY"] },
  { key: "DELIVERED", label: "Delivered", milestoneKeys: ["DELIVERED"] }
];

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function resolveTrackingProfile(
  destinationCountryCode: string,
  configured: TrackingProfileSetting = "AUTO"
): TrackingProfile {
  if (configured !== "AUTO") return configured;
  const code = destinationCountryCode.toUpperCase();
  if (code === "GB") return "UK";
  if (code === "US") return "USA";
  if (code === "CA") return "CANADA";
  if (europeanCountryCodes.has(code)) return "EUROPE";
  return "OTHER";
}

function profileDestinationName(profile: TrackingProfile, supplied: string) {
  if (profile === "UK") return "United Kingdom";
  if (profile === "USA") return "United States";
  if (profile === "CANADA") return "Canada";
  return supplied || "Destination";
}

function fallbackGatewayLabel(profile: TrackingProfile) {
  if (profile === "UK") return "London Gateway (LHR)";
  if (profile === "USA") return "USA Gateway";
  if (profile === "CANADA") return "Canada Gateway";
  if (profile === "EUROPE") return "European Gateway";
  return "Destination Gateway";
}

function gatewayLabel(profile: TrackingProfile, code: string, suppliedName: string) {
  if (!code) return fallbackGatewayLabel(profile);
  const name = suppliedName || gatewayNames[code] || "";
  return name ? `${titleCase(name)} Gateway (${code})` : `Gateway (${code})`;
}

function transitLabel(profile: TrackingProfile, destinationCountryName: string) {
  if (profile === "UK") return "In Transit to United Kingdom";
  if (profile === "USA") return "In Transit to United States";
  if (profile === "CANADA") return "In Transit to Canada";
  if (profile === "EUROPE") return "In Transit to Europe";
  return `In Transit to ${destinationCountryName || "Destination"}`;
}

function milestoneLabel(key: string, context: TrackingJourneyContext) {
  const labels: Record<string, string> = {
    BOOKED: "Booking Confirmed",
    COLLECTED: "Shipment Collected",
    ORIGIN_RECEIVED: `Shipment Received at ${context.originHubName}`,
    ORIGIN_PROCESSED: `Shipment Processed at ${context.originHubName}`,
    EXPORT_READY: "Ready for Export",
    ORIGIN_DISPATCHED: `Dispatched from ${context.originHubName}`,
    INTERNATIONAL_TRANSIT: transitLabel(context.profile, context.destinationCountryName),
    GATEWAY_ARRIVED: `Arrived at ${context.gatewayLabel}`,
    CUSTOMS_IN_PROGRESS: "Customs Clearance in Progress",
    CUSTOMS_CLEARED: "Customs Cleared",
    PARTNER_TRANSFERRED: context.profile === "UK"
      ? "Transferred to DPD Network"
      : `Transferred to ${context.deliveryPartnerName}`,
    DELIVERY_HUB: context.profile === "UK"
      ? "Arrived at DPD Delivery Hub"
      : context.profile === "EUROPE"
        ? "Arrived at Destination Delivery Hub"
        : context.deliveryPartnerName === "Delivery Partner"
          ? "Arrived at Local Delivery Hub"
          : `Arrived at ${context.deliveryPartnerName} Delivery Hub`,
    OUT_FOR_DELIVERY: "Out for Delivery",
    DELIVERED: "Delivered"
  };
  return labels[key] ?? key;
}

function firstReachedAt(events: readonly JourneyEvent[], statuses: readonly string[]) {
  const times = events
    .filter((event) => statuses.includes(event.status))
    .map((event) => new Date(event.eventAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  return times[0]?.toISOString() ?? null;
}

function latestEventValue(events: readonly JourneyEvent[], field: "gatewayCode" | "gatewayName" | "partnerName" | "partnerCode") {
  return [...events]
    .sort((left, right) => new Date(right.eventAt).getTime() - new Date(left.eventAt).getTime())
    .map((event) => String(event[field] ?? "").trim())
    .find(Boolean) ?? "";
}

function latestGatewayValue(events: readonly JourneyEvent[], field: "gatewayCode" | "gatewayName") {
  return latestEventValue(
    events.filter((event) => event.status === "DESTINATION_ARRIVED"),
    field
  );
}

export function buildTrackingJourney(input: {
  destinationCountryCode: string;
  destinationCountryName: string;
  configuredProfile?: TrackingProfileSetting;
  originHubName?: string;
  deliveryPartnerName?: string;
  deliveryPartnerCode?: string;
  events: readonly JourneyEvent[];
}): TrackingJourney {
  const profile = resolveTrackingProfile(input.destinationCountryCode, input.configuredProfile);
  const destinationCountryName = profileDestinationName(profile, input.destinationCountryName);
  const eventGatewayCode = latestGatewayValue(input.events, "gatewayCode").toUpperCase();
  const resolvedGatewayCode = (eventGatewayCode || (profile === "UK" ? "LHR" : "")).toUpperCase();
  const resolvedGatewayName = latestGatewayValue(input.events, "gatewayName")
    || gatewayNames[resolvedGatewayCode]
    || "";
  const eventPartnerName = latestEventValue(input.events, "partnerName");
  const eventPartnerCode = latestEventValue(input.events, "partnerCode");
  const deliveryPartnerName = profile === "UK"
    ? "DPD Network"
    : eventPartnerName || input.deliveryPartnerName || "Delivery Partner";
  const deliveryPartnerCode = profile === "UK"
    ? "DPD"
    : eventPartnerCode || input.deliveryPartnerCode || "";
  const originHubName = input.originHubName?.trim() || "Origin Hub";
  const resolvedGatewayLabel = gatewayLabel(profile, resolvedGatewayCode, resolvedGatewayName);
  const gatewaySegment = resolvedGatewayCode
    ? `${resolvedGatewayCode} Gateway`
    : profile === "EUROPE"
      ? "European Gateway"
      : `${profile === "OTHER" ? "Destination" : profile} Gateway`;

  const routeSegments = profile === "EUROPE"
    ? [originHubName, gatewaySegment, "Destination Country", deliveryPartnerName, "Delivery"]
    : [originHubName, gatewaySegment, deliveryPartnerName, "Delivery"];

  const context: TrackingJourneyContext = {
    profile,
    originHubName,
    destinationCountryName,
    gatewayCode: resolvedGatewayCode,
    gatewayName: resolvedGatewayName,
    gatewayLabel: resolvedGatewayLabel,
    deliveryPartnerName,
    deliveryPartnerCode,
    routeSegments
  };

  const rawMilestones = milestoneDefinitions
    // Collection is conditional; it appears once it actually happened and is
    // never shown as a required pending step for a counter drop-off.
    .filter((definition) => definition.key !== "COLLECTED" || firstReachedAt(input.events, definition.statuses))
    .map((definition) => ({
      key: definition.key,
      label: milestoneLabel(definition.key, context),
      reachedAt: firstReachedAt(input.events, definition.statuses),
      isCurrent: false
    }));
  const currentMilestoneIndex = rawMilestones.reduce(
    (latest, milestone, index) => (milestone.reachedAt ? index : latest),
    -1
  );
  const milestones = rawMilestones.map((milestone, index) => ({
    ...milestone,
    isCurrent: index === currentMilestoneIndex
  }));

  const rawStages = stageDefinitions.map((definition) => {
    const reached = milestones
      .filter((milestone) => definition.milestoneKeys.includes(milestone.key) && milestone.reachedAt)
      .map((milestone) => milestone.reachedAt as string)
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
    return { key: definition.key, label: definition.label, reachedAt: reached[0] ?? null, isCurrent: false };
  });
  const currentStageIndex = rawStages.reduce(
    (latest, stage, index) => (stage.reachedAt ? index : latest),
    -1
  );

  return {
    version: 2,
    context,
    stages: rawStages.map((stage, index) => ({ ...stage, isCurrent: index === currentStageIndex })),
    milestones
  };
}

export function formatTrackingEventLabel(status: string, journey: TrackingJourney) {
  const definition = milestoneDefinitions.find((item) => item.statuses.includes(status));
  return definition ? milestoneLabel(definition.key, journey.context) : formatShipmentEventLabel(status);
}

/**
 * Loads only the shipment route and delivery facts tracking needs. Manifest
 * routing is deliberately absent: its IATA fields describe a freight movement,
 * which may later contain shipments for several final destinations.
 */
export async function loadShipmentJourney(input: {
  shipmentDraftId: string | mongoose.Types.ObjectId;
  destinationCountryCode: string;
  destinationCountryName: string;
  service: "COURIER" | "CARGO";
  events: readonly JourneyEvent[];
  route?: ISwiftlineRoute | null;
  originHubFallback?: string;
}) {
  const route = input.route === undefined
    ? await findRoute({ destinationCountryCode: input.destinationCountryCode, service: input.service })
    : input.route;

  const assignment = await DeliveryAssignment.findOne({ shipmentDraftId: input.shipmentDraftId })
    .select("deliveryPartnerId")
    .lean()
    .exec();
  const partner = assignment?.deliveryPartnerId
    ? await DeliveryPartner.findById(assignment.deliveryPartnerId).select("name code").lean().exec()
    : null;

  return buildTrackingJourney({
    destinationCountryCode: input.destinationCountryCode,
    destinationCountryName: route?.destinationCountryName || input.destinationCountryName,
    configuredProfile: route?.trackingProfile ?? "AUTO",
    originHubName: route?.originHubName
      || input.originHubFallback
      || "Origin Hub",
    deliveryPartnerName: partner?.name ?? "",
    deliveryPartnerCode: partner?.code ?? "",
    events: input.events
  });
}
