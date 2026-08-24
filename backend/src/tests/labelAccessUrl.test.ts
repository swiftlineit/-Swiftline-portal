import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import { buildAbsoluteUrl } from "../controllers/dpdShipment.controller.js";

describe("shipment label access URLs", () => {
  it("uses Express's proxy-aware public host", () => {
    const request = {
      protocol: "https",
      host: "api-tunnel.example.test",
    } as Pick<Request, "protocol" | "host">;

    assert.equal(
      buildAbsoluteUrl(request, "/api/v1/dpd-shipments/123/label-file?token=signed"),
      "https://api-tunnel.example.test/api/v1/dpd-shipments/123/label-file?token=signed",
    );
  });

  it("keeps direct local HTTP links local", () => {
    const request = {
      protocol: "http",
      host: "localhost:5000",
    } as Pick<Request, "protocol" | "host">;

    assert.equal(
      buildAbsoluteUrl(request, "/api/v1/dpd-shipments/123/label-file"),
      "http://localhost:5000/api/v1/dpd-shipments/123/label-file",
    );
  });
});
