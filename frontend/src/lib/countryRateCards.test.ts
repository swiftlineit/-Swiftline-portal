import assert from "node:assert/strict";
import test from "node:test";
import { rateCardDisplay } from "@/lib/countryRateCards";

test("rate-card GST display keeps the entered amount when GST is included", () => {
  assert.deepEqual(
    rateCardDisplay({ chargesPerKg: 420, gstTreatment: "INCLUDED", gstRatePercent: 18 }),
    { amount: 420, label: "GST included (18%)" },
  );
});

test("rate-card GST display keeps the entered amount when GST is excluded", () => {
  assert.deepEqual(
    rateCardDisplay({ chargesPerKg: 420, gstTreatment: "EXCLUDED", gstRatePercent: 18 }),
    { amount: 420, label: "GST excluded" },
  );
});
