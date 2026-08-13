import assert from "node:assert/strict";
import test from "node:test";
import { publicShipmentSourceIdentity } from "../services/shipmentSourceIdentity.service.js";

test("manual shipment source identifiers stay internal", () => {
  assert.deepEqual(publicShipmentSourceIdentity({
    _id: "66f10d7f0e8725a2c9a41b11",
    parcelList: [{ shipmentReference1: "" }]
  } as never), { invoiceNumber: "", shipmentReference: "" });
});

test("walk-in source identifiers stay internal", () => {
  assert.deepEqual(publicShipmentSourceIdentity({
    _id: "66f10d7f0e8725a2c9a41b12",
    parcelList: []
  } as never), { invoiceNumber: "", shipmentReference: "" });
});

test("a customer parcel reference remains visible without inventing an invoice number", () => {
  assert.deepEqual(publicShipmentSourceIdentity({
    _id: "66f10d7f0e8725a2c9a41b13",
    parcelList: [{ shipmentReference1: " CUSTOMER-REF-18 " }]
  } as never), {
    invoiceNumber: "",
    shipmentReference: "CUSTOMER-REF-18"
  });
});
