import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRemovableDuplicate } from "../services/shipmentEventDedupe.service.js";

const kept = { location: "" };

describe("duplicate shipment event removal", () => {
  it("removes a row carrying only the standard line for its status", () => {
    assert.equal(isRemovableDuplicate({
      status: "PARCEL_COLLECTED",
      note: "Parcel collected from the sender and on its way to the Swiftline hub.",
      location: ""
    }, kept), true);
  });

  it("removes a row with no note at all", () => {
    assert.equal(isRemovableDuplicate({ status: "WAREHOUSE_SCAN_IN", note: "", location: "" }, kept), true);
  });

  it("keeps a row an operator wrote a note on", () => {
    assert.equal(isRemovableDuplicate({
      status: "PARCEL_COLLECTED",
      note: "Second pickup after the first van was turned away.",
      location: ""
    }, kept), false);
  });

  it("keeps a row recording a location the kept event does not have", () => {
    assert.equal(isRemovableDuplicate({
      status: "FLIGHT_DEPARTED",
      note: "Departed from the origin airport.",
      location: "Delhi Hub"
    }, kept), false);
  });

  it("removes a row whose location merely repeats the kept event's", () => {
    assert.equal(isRemovableDuplicate({
      status: "FLIGHT_DEPARTED",
      note: "Departed from the origin airport.",
      location: "Delhi Hub"
    }, { location: "Delhi Hub" }), true);
  });

  it("ignores surrounding whitespace rather than treating it as operator input", () => {
    assert.equal(isRemovableDuplicate({
      status: "DELIVERED",
      note: "  Delivered to the recipient.  ",
      location: "  "
    }, kept), true);
  });
});

describe("duplicate rows left by older portal versions", () => {
  it("removes a row still carrying the string the bulk dialog used to send", () => {
    assert.equal(isRemovableDuplicate({
      status: "PARCEL_COLLECTED",
      note: "Bulk status update by Swiftline Operations",
      location: ""
    }, kept), true);
  });

  it("removes a row still carrying the string the single-shipment form used to send", () => {
    assert.equal(isRemovableDuplicate({
      status: "WAREHOUSE_SCAN_IN",
      note: "Live action updated by Swiftline Operations",
      location: ""
    }, kept), true);
  });

  it("still keeps an operator's own words on a legacy row", () => {
    assert.equal(isRemovableDuplicate({
      status: "PARCEL_COLLECTED",
      note: "Re-collected after the first attempt failed.",
      location: ""
    }, kept), false);
  });
});
