import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitInclusiveQuoteAmountMinor } from "./shipmentQuotes";

describe("GST-inclusive quote preview", () => {
  it("uses the same 18 over 118 split as the server", () => {
    assert.deepEqual(splitInclusiveQuoteAmountMinor(400_000, 0.18), {
      taxableMinor: 338_983,
      gstMinor: 61_017,
      totalMinor: 400_000
    });
  });

  it("keeps the commercial total unchanged for no-GST pricing", () => {
    assert.deepEqual(splitInclusiveQuoteAmountMinor(400_000, 0), {
      taxableMinor: 400_000,
      gstMinor: 0,
      totalMinor: 400_000
    });
  });
});
