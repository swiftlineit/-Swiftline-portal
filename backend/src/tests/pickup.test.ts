import assert from "node:assert/strict";
import { describe, test } from "node:test";
import mongoose from "mongoose";
import { DriverProfile } from "../models/driverProfile.model.js";
import { PickupAttempt } from "../models/pickupAttempt.model.js";
import { pickupAddressFingerprint } from "../services/pickup.service.js";

describe("pickup request invariants", () => {
  test("normalizes equivalent pickup addresses to one selection fingerprint", () => {
    const first = pickupAddressFingerprint({
      countryCode: "in",
      postcode: "110001",
      addressLine1: " 12   Cargo Road ",
      townOrCity: "new delhi"
    });
    const second = pickupAddressFingerprint({
      countryCode: "IN",
      postcode: "110001",
      addressLine1: "12 CARGO ROAD",
      townOrCity: "NEW DELHI"
    });

    assert.equal(first, second);
  });

  test("accepts direct-contractor and internal driver identities", async () => {
    const userId = new mongoose.Types.ObjectId();
    await new DriverProfile({ userId, deliverySubrole: "DRIVER", engagementType: "DIRECT_CONTRACTOR", status: "INVITED", createdBy: userId }).validate();
    await new DriverProfile({ userId: new mongoose.Types.ObjectId(), deliverySubrole: "SUPERVISOR", engagementType: "INTERNAL", status: "INVITED", createdBy: userId }).validate();
  });

  test("rejects GPS evidence outside valid coordinate bounds", async () => {
    const attempt = new PickupAttempt({
      pickupRequestId: new mongoose.Types.ObjectId(),
      sequence: 1,
      status: "ARRIVED",
      scheduledWindow: { startAt: new Date("2026-08-06T08:00:00.000Z"), endAt: new Date("2026-08-06T10:00:00.000Z"), timezone: "Asia/Kolkata" },
      arrivalLocation: { latitude: 120, longitude: 77.2, accuracy: 10, capturedAt: new Date() }
    });

    await assert.rejects(() => attempt.validate(), /latitude/);
  });
});
