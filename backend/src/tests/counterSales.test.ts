import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { counterSalesTotalsPipeline } from "../controllers/counterSales.controller.js";

describe("counter sales totals query", () => {
  it("aggregates totals independently from the 500-row activity limit", () => {
    const filters = { branchId: "branch-1", direction: "COLLECTED" };
    const pipeline = counterSalesTotalsPipeline(filters);

    assert.deepEqual(pipeline[0], { $match: filters });
    assert.equal(JSON.stringify(pipeline).includes("$limit"), false);
    assert.deepEqual(pipeline[1], {
      $group: {
        _id: null,
        collectedMinor: { $sum: { $cond: [{ $eq: ["$direction", "COLLECTED"] }, "$amountMinor", 0] } },
        refundedMinor: { $sum: { $cond: [{ $eq: ["$direction", "REFUNDED"] }, "$amountMinor", 0] } }
      }
    });
  });
});
