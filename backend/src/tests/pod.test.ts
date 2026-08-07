import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canReassignPod, podEvidenceRequirements, podParcelsBelongToAssignment, podRetentionUntil } from "../services/podRules.service.js";

describe("international POD production rules", () => {
  it("allows multiple parcels only from the same assignment", () => {
    assert.equal(podParcelsBelongToAssignment(["P1", "P2", "P3"], ["P1", "P3"]), true);
    assert.equal(podParcelsBelongToAssignment(["P1", "P2"], ["P1", "OTHER"]), false);
    assert.equal(podParcelsBelongToAssignment(["P1"], ["P1", "P1"]), false);
  });
  it("requires a photo and a signature or approved exception", () => {
    assert.deepEqual(podEvidenceRequirements([{ type: "PHOTO" }, { type: "SIGNATURE" }], "NONE"), { hasPhoto: true, hasSignature: true });
    assert.deepEqual(podEvidenceRequirements([{ type: "PHOTO" }], "APPROVED"), { hasPhoto: true, hasSignature: true });
    assert.deepEqual(podEvidenceRequirements([{ type: "SIGNATURE" }], "NONE"), { hasPhoto: false, hasSignature: true });
  });
  it("preserves closed assignments and freezes eight-year retention", () => {
    assert.equal(canReassignPod("OUT_FOR_DELIVERY"), true);
    assert.equal(canReassignPod("DELIVERED"), false);
    assert.equal(podRetentionUntil(new Date("2026-08-07T00:00:00.000Z")).toISOString(), "2034-08-07T00:00:00.000Z");
  });
});
