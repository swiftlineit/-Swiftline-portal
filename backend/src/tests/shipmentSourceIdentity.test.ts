import assert from "node:assert/strict";
import test from "node:test";
import { publicShipmentSourceIdentity } from "../services/shipmentSourceIdentity.service.js";

test("manual shipment source identifiers stay internal", () => {
  assert.deepEqual(publicShipmentSourceIdentity({
    templateVersion: "MANUAL-1.0",
    extractedData: { creationSource: "MANUAL" },
    invoiceNumber: "MANUAL-INV-E1C6B60E5D8C4CB0",
    shipmentReference: "MANUAL-SHIP-E1C6B60E5D8C4CB0"
  } as never), { invoiceNumber: "", shipmentReference: "" });
});

test("walk-in source identifiers stay internal even when older metadata is incomplete", () => {
  assert.deepEqual(publicShipmentSourceIdentity({
    templateVersion: "INDIVIDUAL-1.0",
    extractedData: {},
    invoiceNumber: "IND-INV-1234",
    shipmentReference: "IND-SHIP-1234"
  } as never), { invoiceNumber: "", shipmentReference: "" });
});

test("genuine uploaded invoice identifiers remain customer-visible references", () => {
  assert.deepEqual(publicShipmentSourceIdentity({
    templateVersion: "DPD-LABEL-1.0",
    extractedData: { creationSource: "UPLOAD" },
    invoiceNumber: "CUSTOMER-INV-74",
    shipmentReference: "CUSTOMER-REF-18"
  } as never), {
    invoiceNumber: "CUSTOMER-INV-74",
    shipmentReference: "CUSTOMER-REF-18"
  });
});
