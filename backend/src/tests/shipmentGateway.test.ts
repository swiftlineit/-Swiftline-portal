import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveBulkTrackingGatewayCode,
  resolveTrackingGatewayCode
} from "../services/shipmentGateway.service.js";

describe("shipment gateway capture", () => {
  it("requires and normalizes an actual IATA for destination arrival", () => {
    assert.deepEqual(resolveTrackingGatewayCode({
      status: "DESTINATION_ARRIVED",
      destinationCountryCode: "US",
      gatewayCode: " jfk "
    }), { gatewayCode: "JFK", error: null });

    assert.match(resolveTrackingGatewayCode({
      status: "DESTINATION_ARRIVED",
      destinationCountryCode: "CA",
      gatewayCode: ""
    }).error ?? "", /three-letter gateway IATA/);
  });

  it("fixes UK tracking to LHR independently of manifest data", () => {
    assert.deepEqual(resolveTrackingGatewayCode({
      status: "DESTINATION_ARRIVED",
      destinationCountryCode: "GB",
      gatewayCode: ""
    }), { gatewayCode: "LHR", error: null });

    assert.match(resolveTrackingGatewayCode({
      status: "DESTINATION_ARRIVED",
      destinationCountryCode: "GB",
      gatewayCode: "JFK"
    }).error ?? "", /fixed to LHR/);
  });

  it("rejects gateway metadata on unrelated milestones", () => {
    assert.match(resolveTrackingGatewayCode({
      status: "ORIGIN_HUB_DISPATCHED",
      destinationCountryCode: "CA",
      gatewayCode: "LHR"
    }).error ?? "", /only be recorded/);
  });

  it("refuses one bulk gateway across different destination countries", () => {
    assert.match(resolveBulkTrackingGatewayCode({
      status: "DESTINATION_ARRIVED",
      destinationCountryCodes: ["US", "CA"],
      gatewayCode: "JFK"
    }).error ?? "", /one destination country/);

    assert.deepEqual(resolveBulkTrackingGatewayCode({
      status: "DESTINATION_ARRIVED",
      destinationCountryCodes: ["US", "US"],
      gatewayCode: "JFK"
    }), { gatewayCode: "JFK", error: null });
  });
});
