import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTrackingJourney,
  formatTrackingEventLabel,
  resolveTrackingProfile
} from "../services/shipmentJourney.service.js";

const completedEvents = [
  "SHIPMENT_BOOKED",
  "PARCEL_COLLECTED",
  "WAREHOUSE_SCAN_IN",
  "ORIGIN_HUB_PROCESSED",
  "READY_FOR_EXPORT",
  "ORIGIN_HUB_DISPATCHED",
  "DESTINATION_ARRIVED",
  "IMPORT_CUSTOMS_CLEARANCE",
  "IMPORT_CUSTOMS_CLEARED",
  "DELIVERY_PARTNER_TRANSFERRED",
  "DELIVERY_HUB_ARRIVED",
  "OUT_FOR_DELIVERY",
  "DELIVERED"
].map((status, index) => ({
  status,
  eventAt: new Date(Date.UTC(2026, 7, 1, index)).toISOString()
}));

describe("destination-aware shipment journey", () => {
  it("selects the four configured regional flows automatically", () => {
    assert.equal(resolveTrackingProfile("GB"), "UK");
    assert.equal(resolveTrackingProfile("US"), "USA");
    assert.equal(resolveTrackingProfile("CA"), "CANADA");
    assert.equal(resolveTrackingProfile("DE"), "EUROPE");
    assert.equal(resolveTrackingProfile("AE"), "OTHER");
  });

  it("treats Turkey as a Middle East lane, not a European one", () => {
    // Swiftline sells Turkey as Middle East and the rate card groups it that
    // way, so presenting it as a European shipment told the customer two
    // different stories about the same parcel.
    assert.equal(resolveTrackingProfile("TR"), "OTHER");

    // Its European neighbours are unaffected.
    for (const code of ["GR", "BG", "CY", "RO", "HR", "RS"]) {
      assert.equal(resolveTrackingProfile(code), "EUROPE", `${code} should still be EUROPE`);
    }
  });

  it("lets a route override the automatic choice", () => {
    // AUTO is only the default. A lane pinned to a profile keeps it, which is
    // the escape hatch if Turkey should ever read as European after all.
    assert.equal(resolveTrackingProfile("TR", "EUROPE"), "EUROPE");
    assert.equal(resolveTrackingProfile("DE", "OTHER"), "OTHER");
  });

  it("names the country rather than the region on a non-regional lane", () => {
    const journey = buildTrackingJourney({
      destinationCountryCode: "TR",
      destinationCountryName: "Turkey",
      originHubName: "Delhi Hub",
      events: []
    });

    assert.equal(journey.context.profile, "OTHER");
    assert.equal(journey.context.destinationCountryName, "Turkey");
    assert.ok(
      journey.milestones.some((milestone) => milestone.label === "In Transit to Turkey"),
      "the transit milestone should name Turkey"
    );
  });

  it("always presents UK shipments through LHR and the DPD Network", () => {
    const journey = buildTrackingJourney({
      destinationCountryCode: "GB",
      destinationCountryName: "United Kingdom",
      originHubName: "Delhi Hub",
      deliveryPartnerName: "Another Partner",
      events: completedEvents
    });

    assert.deepEqual(journey.context.routeSegments, ["Delhi Hub", "LHR Gateway", "DPD Network", "Delivery"]);
    assert.equal(journey.context.deliveryPartnerCode, "DPD");
    assert.equal(formatTrackingEventLabel("DESTINATION_ARRIVED", journey), "Arrived at London Gateway (LHR)");
    assert.equal(formatTrackingEventLabel("DELIVERY_PARTNER_TRANSFERRED", journey), "Transferred to DPD Network");
    assert.equal(formatTrackingEventLabel("DELIVERY_HUB_ARRIVED", journey), "Arrived at DPD Delivery Hub");
  });

  it("uses the actual USA and Canada gateways", () => {
    const usa = buildTrackingJourney({
      destinationCountryCode: "US",
      destinationCountryName: "United States",
      deliveryPartnerName: "US Partner",
      events: completedEvents.map((event) => event.status === "DESTINATION_ARRIVED"
        ? { ...event, gatewayCode: "JFK" }
        : event)
    });
    const canada = buildTrackingJourney({
      destinationCountryCode: "CA",
      destinationCountryName: "Canada",
      events: completedEvents.map((event) => event.status === "DESTINATION_ARRIVED"
        ? { ...event, gatewayCode: "YVR" }
        : event)
    });

    assert.equal(formatTrackingEventLabel("DESTINATION_ARRIVED", usa), "Arrived at New York Gateway (JFK)");
    assert.equal(formatTrackingEventLabel("DESTINATION_ARRIVED", canada), "Arrived at Vancouver Gateway (YVR)");
  });

  it("keeps the Europe wording and includes the destination-country leg", () => {
    const journey = buildTrackingJourney({
      destinationCountryCode: "DE",
      destinationCountryName: "Germany",
      originHubName: "Delhi Hub",
      events: completedEvents.map((event) => event.status === "DESTINATION_ARRIVED"
        ? { ...event, gatewayCode: "FRA" }
        : event)
    });

    assert.equal(formatTrackingEventLabel("ORIGIN_HUB_DISPATCHED", journey), "Dispatched from Delhi Hub");
    assert.equal(journey.milestones.find((item) => item.key === "INTERNATIONAL_TRANSIT")?.label, "In Transit to Europe");
    assert.deepEqual(journey.context.routeSegments, [
      "Delhi Hub",
      "FRA Gateway",
      "Destination Country",
      "Delivery Partner",
      "Delivery"
    ]);
  });

  it("ignores gateway data attached to dispatch instead of destination arrival", () => {
    const journey = buildTrackingJourney({
      destinationCountryCode: "CA",
      destinationCountryName: "Canada",
      events: [
        { status: "ORIGIN_HUB_DISPATCHED", eventAt: "2026-08-01T08:00:00.000Z", gatewayCode: "LHR" },
        { status: "DESTINATION_ARRIVED", eventAt: "2026-08-02T08:00:00.000Z" }
      ]
    });

    assert.equal(journey.context.gatewayCode, "");
    assert.equal(formatTrackingEventLabel("DESTINATION_ARRIVED", journey), "Arrived at Canada Gateway");
  });

  it("shows collection only when it was actually recorded", () => {
    const journey = buildTrackingJourney({
      destinationCountryCode: "US",
      destinationCountryName: "United States",
      events: completedEvents.filter((event) => event.status !== "PARCEL_COLLECTED")
    });
    assert.equal(journey.milestones.some((item) => item.key === "COLLECTED"), false);
  });
});
