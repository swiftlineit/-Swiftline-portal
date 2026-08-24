import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrackingJourney } from "../services/shipmentJourney.service.js";
import { buildTrackingPosition } from "../services/shipmentPosition.service.js";

function journey(countryCode: string, countryName: string, gatewayCode = "") {
  return buildTrackingJourney({
    destinationCountryCode: countryCode,
    destinationCountryName: countryName,
    events: gatewayCode
      ? [{ status: "DESTINATION_ARRIVED", eventAt: at(10), gatewayCode }]
      : []
  });
}

function at(hour: number) { return new Date(Date.UTC(2026, 7, 22, hour)); }

describe("shipment current position", () => {
  it("describes a booked shipment honestly when no operational scan exists", () => {
    assert.deepEqual(buildTrackingPosition({ events: [], journey: journey("GB", "United Kingdom") }), {
      label: "Awaiting collection from sender",
      source: "PENDING",
      basisStatus: "SHIPMENT_BOOKED",
      holdReasonLabel: ""
    });
  });

  it("uses a real entered hub location for a stationary hub scan", () => {
    const position = buildTrackingPosition({
      events: [{ status: "WAREHOUSE_SCAN_IN", eventAt: at(8), location: "Delhi Export Hub" }],
      journey: journey("GB", "United Kingdom")
    });
    assert.equal(position.label, "Delhi Export Hub");
    assert.equal(position.source, "RECORDED");
  });

  it("does not reuse an old hub location after a UK departure", () => {
    const position = buildTrackingPosition({
      events: [
        { status: "WAREHOUSE_SCAN_IN", eventAt: at(8), location: "Delhi Export Hub" },
        { status: "ORIGIN_HUB_DISPATCHED", eventAt: at(9), location: "" }
      ],
      journey: journey("GB", "United Kingdom")
    });
    assert.equal(position.label, "In Transit to United Kingdom");
    assert.equal(position.source, "INFERRED");
  });

  it("keeps the agreed Europe transit wording", () => {
    const position = buildTrackingPosition({
      events: [{ status: "ORIGIN_HUB_DISPATCHED", eventAt: at(9), location: "" }],
      journey: journey("DE", "Germany")
    });
    assert.equal(position.label, "In Transit to Europe");
  });

  it("uses LHR for UK but does not invent a USA gateway", () => {
    const uk = buildTrackingPosition({
      events: [{ status: "DESTINATION_ARRIVED", eventAt: at(10), location: "" }],
      journey: journey("GB", "United Kingdom")
    });
    const usa = buildTrackingPosition({
      events: [{ status: "DESTINATION_ARRIVED", eventAt: at(10), location: "" }],
      journey: journey("US", "United States")
    });
    assert.match(uk.label, /LHR/);
    assert.equal(usa.label, "USA Gateway");
  });

  it("uses an actual USA gateway when one is assigned", () => {
    const position = buildTrackingPosition({
      events: [{ status: "DESTINATION_ARRIVED", eventAt: at(10), location: "" }],
      journey: journey("US", "United States", "JFK")
    });
    assert.match(position.label, /JFK/);
  });

  it("keeps the last meaningful position on hold and varies the reason by audience", () => {
    const events = [
      { status: "WAREHOUSE_SCAN_IN", eventAt: at(8), location: "Delhi Export Hub" },
      { status: "ON_HOLD", eventAt: at(9), location: "", holdReason: "payment_issue" }
    ];
    const publicPosition = buildTrackingPosition({
      events,
      journey: journey("GB", "United Kingdom"),
      audience: "PUBLIC"
    });
    const authenticatedPosition = buildTrackingPosition({
      events,
      journey: journey("GB", "United Kingdom"),
      audience: "AUTHENTICATED"
    });
    assert.equal(publicPosition.label, "Delhi Export Hub");
    assert.equal(publicPosition.holdReasonLabel, "Sender action required");
    assert.equal(authenticatedPosition.holdReasonLabel, "Payment issue");
  });
});
