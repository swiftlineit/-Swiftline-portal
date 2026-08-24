import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { bulkSaveSwiftlineRoutes, listSwiftlineRoutes } from "../controllers/swiftlineRoute.controller.js";
import { AuditLog } from "../models/auditLog.model.js";
import { CountryRateCard } from "../models/countryRateCard.model.js";
import { SwiftlineRoute } from "../models/swiftlineRoute.model.js";

const databaseName = `sl_route_bulk_${Date.now()}`;
const userId = new mongoose.Types.ObjectId();

/** The fields these tests read back off a controller response. */
type RouteOutcome = { countryCode: string; countryName: string; service: string };
type RecordedBody = {
  created?: RouteOutcome[];
  updated?: RouteOutcome[];
  skipped?: RouteOutcome[];
  coverage?: Array<{ countryCode: string; countryName: string; service: string }>;
  message?: string;
};

function responseRecorder() {
  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      payload = body;
      return response;
    }
  } as unknown as Response;
  return { response, statusCode: () => statusCode, payload: () => (payload ?? {}) as RecordedBody };
}

function request(body: unknown, query: Record<string, string> = {}) {
  return {
    user: { _id: userId, role: "admin" },
    body,
    params: {},
    query
  } as unknown as Request;
}

/** The European destinations the rate list opens, as the screen would offer them. */
const destinations = [
  { countryCode: "BE", countryName: "Belgium" },
  { countryCode: "HR", countryName: "Croatia" },
  { countryCode: "RS", countryName: "Serbia" },
  { countryCode: "ME", countryName: "Montenegro" }
];

const details = {
  viaCountryCodes: [],
  transitDaysMin: 10,
  transitDaysMax: 12,
  transitBasis: "BUSINESS_DAYS",
  trackingProfile: "EUROPE",
  originHubName: "Delhi Hub",
  serviceable: true,
  cutOffTime: "16:30",
  restrictions: "",
  notes: ""
};

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName);
  await Promise.all([AuditLog.init(), CountryRateCard.init(), SwiftlineRoute.init()]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_route_bulk_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

describe("opening lanes in bulk", () => {
  test("creates a lane per destination and service in one call", async () => {
    const recorder = responseRecorder();
    await bulkSaveSwiftlineRoutes(
      request({ destinations, services: ["COURIER", "CARGO"], details, overwriteExisting: false }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 200);
    assert.equal(await SwiftlineRoute.countDocuments({}), 8);

    const belgium = await SwiftlineRoute.findOne({ destinationCountryCode: "BE", service: "COURIER" }).lean().exec();
    assert.equal(belgium?.transitDaysMin, 10);
    assert.equal(belgium?.transitDaysMax, 12);
    // The two fields the tracking work added must survive a bulk write, because
    // they are the customer-visible half of a lane.
    assert.equal(belgium?.trackingProfile, "EUROPE");
    assert.equal(belgium?.originHubName, "Delhi Hub");
    assert.equal(belgium?.cutOffTime, "16:30");
    assert.equal(belgium?.originCountryCode, "IN");
  });

  test("leaves existing lanes alone unless replacement is confirmed", async () => {
    const recorder = responseRecorder();
    await bulkSaveSwiftlineRoutes(
      request({
        destinations: [{ countryCode: "BE", countryName: "Belgium" }],
        services: ["COURIER"],
        details: { ...details, transitDaysMin: 2, transitDaysMax: 3 },
        overwriteExisting: false
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 200);
    assert.equal((recorder.payload().skipped ?? []).length, 1);
    assert.equal((recorder.payload().created ?? []).length, 0);

    const belgium = await SwiftlineRoute.findOne({ destinationCountryCode: "BE", service: "COURIER" }).lean().exec();
    assert.equal(belgium?.transitDaysMin, 10, "the original transit time should be untouched");
  });

  test("replaces the details when replacement is confirmed", async () => {
    const recorder = responseRecorder();
    await bulkSaveSwiftlineRoutes(
      request({
        destinations: [{ countryCode: "BE", countryName: "Belgium" }],
        services: ["COURIER"],
        details: { ...details, transitDaysMin: 6, transitDaysMax: 8 },
        overwriteExisting: true
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 200);
    assert.equal((recorder.payload().updated ?? []).length, 1);

    const belgium = await SwiftlineRoute.findOne({ destinationCountryCode: "BE", service: "COURIER" }).lean().exec();
    assert.equal(belgium?.transitDaysMin, 6);
    assert.equal(belgium?.transitDaysMax, 8);
    assert.equal(await SwiftlineRoute.countDocuments({ destinationCountryCode: "BE", service: "COURIER" }), 1);
  });

  test("adds only the missing lanes when a destination is half routed", async () => {
    const before = await SwiftlineRoute.countDocuments({});

    const recorder = responseRecorder();
    await bulkSaveSwiftlineRoutes(
      request({
        destinations: [
          { countryCode: "BE", countryName: "Belgium" },
          { countryCode: "PT", countryName: "Portugal" }
        ],
        services: ["COURIER"],
        details,
        overwriteExisting: false
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 200);
    assert.deepEqual((recorder.payload().created ?? []).map((entry) => entry.countryCode), ["PT"]);
    assert.deepEqual((recorder.payload().skipped ?? []).map((entry) => entry.countryCode), ["BE"]);
    assert.equal(await SwiftlineRoute.countDocuments({}), before + 1);
  });

  test("rejects a transit range that runs backwards, writing nothing", async () => {
    const before = await SwiftlineRoute.countDocuments({});

    const recorder = responseRecorder();
    await bulkSaveSwiftlineRoutes(
      request({
        destinations: [{ countryCode: "IE", countryName: "Ireland" }],
        services: ["COURIER"],
        details: { ...details, transitDaysMin: 12, transitDaysMax: 4 },
        overwriteExisting: false
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 400);
    assert.equal(await SwiftlineRoute.countDocuments({}), before, "a rejected payload must write nothing");
  });

  test("rejects a transit stop that is also the destination", async () => {
    const recorder = responseRecorder();
    await bulkSaveSwiftlineRoutes(
      request({
        destinations: [{ countryCode: "IE", countryName: "Ireland" }],
        services: ["COURIER"],
        details: { ...details, viaCountryCodes: ["IE"] },
        overwriteExisting: false
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 400);
    assert.equal(await SwiftlineRoute.countDocuments({ destinationCountryCode: "IE" }), 0);
  });

  test("rejects the same destination listed twice", async () => {
    const recorder = responseRecorder();
    await bulkSaveSwiftlineRoutes(
      request({
        destinations: [
          { countryCode: "GR", countryName: "Greece" },
          { countryCode: "GR", countryName: "Greece" }
        ],
        services: ["COURIER"],
        details,
        overwriteExisting: false
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 400);
    assert.equal(await SwiftlineRoute.countDocuments({ destinationCountryCode: "GR" }), 0);
  });

  test("records one audit entry per lane", async () => {
    const entries = await AuditLog.countDocuments({
      entityType: "SWIFTLINE_ROUTE",
      "metadata.bulk": true
    }).exec();

    assert.ok(entries >= 8, `expected an entry per lane written, found ${entries}`);
  });
});

describe("the coverage gap the screen reports", () => {
  test("lists destinations that have rates, so unrouted ones can be spotted", async () => {
    await CountryRateCard.create([
      {
        band: "BAND_A", countryCode: "PL", countryName: "Poland", service: "COURIER",
        fromKg: 0, toKg: 1, chargesPerKg: 800, maxBoxKg: 30, createdBy: userId, updatedBy: userId
      },
      {
        band: "BAND_A", countryCode: "BE", countryName: "Belgium", service: "COURIER",
        fromKg: 0, toKg: 1, chargesPerKg: 795, maxBoxKg: 30, createdBy: userId, updatedBy: userId
      }
    ]);

    const recorder = responseRecorder();
    await listSwiftlineRoutes(request({}), recorder.response);

    assert.equal(recorder.statusCode(), 200);
    const coverage = recorder.payload().coverage ?? [];

    // Poland is priced but has no lane; Belgium has both. The screen diffs these
    // against the route list to show what still needs routing.
    assert.ok(coverage.some((entry) => entry.countryCode === "PL" && entry.service === "COURIER"));
    assert.ok(coverage.some((entry) => entry.countryCode === "BE" && entry.service === "COURIER"));
    assert.equal(await SwiftlineRoute.countDocuments({ destinationCountryCode: "PL" }), 0);
  });

  test("reports one coverage row per country and service, not per slab", async () => {
    await CountryRateCard.create([
      {
        band: "BAND_A", countryCode: "PL", countryName: "Poland", service: "COURIER",
        fromKg: 1.01, toKg: 2, chargesPerKg: 700, maxBoxKg: 30, createdBy: userId, updatedBy: userId
      }
    ]);

    const recorder = responseRecorder();
    await listSwiftlineRoutes(request({}), recorder.response);

    const coverage = recorder.payload().coverage ?? [];
    const polish = coverage.filter((entry) => entry.countryCode === "PL" && entry.service === "COURIER");

    assert.equal(polish.length, 1, "two slabs for one lane must not produce two coverage rows");
  });
});
