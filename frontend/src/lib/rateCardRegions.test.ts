import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { countries } from "@/lib/countries";
import { rateCardRegions, regionForCountry, REST_OF_WORLD } from "@/lib/rateCardRegions";

/**
 * Two lists in this repository answer "is this country in Europe?".
 *
 * `rateCardRegions` here decides which tile a customer clicks to find a rate.
 * `europeanCountryCodes` in the backend's `shipmentJourney.service.ts` decides
 * which tracking flow their parcel is presented with. When the two disagree, a
 * customer books through one story and tracks through another - which is
 * exactly what happened with Turkey.
 *
 * The backend list is read from source rather than imported because the two
 * packages cannot share a module. If this stops finding it, the assertion below
 * says so rather than passing silently.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const journeyServicePath = path.resolve(
  here,
  "..",
  "..",
  "..",
  "backend",
  "src",
  "services",
  "shipmentJourney.service.ts"
);

function trackingEuropeanCodes(): Set<string> {
  const source = readFileSync(journeyServicePath, "utf8");
  const match = source.match(/const europeanCountryCodes = new Set\(\[([\s\S]*?)\]\)/);

  assert.ok(
    match,
    `Could not find europeanCountryCodes in ${journeyServicePath}. If it moved or was renamed, `
    + "update this test rather than deleting it - it is the only thing keeping the two lists in step."
  );

  return new Set([...match[1]!.matchAll(/"([A-Z]{2})"/g)].map((entry) => entry[1]!));
}

/**
 * Differences that are deliberate, with the reason.
 *
 * Anything not listed here that disagrees is a drift the test should catch.
 */
const acceptedDifferences: Record<string, string> = {
  RU: "Tracked as European. Not offered as a rate-card destination at all, so no customer can reach the mismatch.",
  FO: "European destination for browsing; tracking treats the Faroes as OTHER.",
  GI: "European destination for browsing; tracking treats Gibraltar as OTHER."
};

describe("rate card regions", () => {
  test("every region code is distinct and unmistakable for a country code", () => {
    const codes = rateCardRegions.map((region) => region.code);

    assert.equal(new Set(codes).size, codes.length);
    for (const code of codes) {
      assert.ok(code.length > 2, `"${code}" could be confused with an ISO-3166 country code`);
    }
  });

  test("no country is claimed by two regions", () => {
    const seen = new Map<string, string>();

    for (const region of rateCardRegions) {
      for (const code of region.countryCodes) {
        const already = seen.get(code);
        assert.equal(already, undefined, `${code} is in both ${already} and ${region.code}`);
        seen.set(code, region.code);
      }
    }
  });

  test("an unlisted country still lands somewhere a customer can find it", () => {
    assert.equal(regionForCountry("ZZ").code, REST_OF_WORLD);
    assert.equal(regionForCountry("hr").code, "EUROPE");
  });

  test("every listed country code is a real country", () => {
    const known = new Set(countries.map((country) => country.iso2.toUpperCase()));

    for (const region of rateCardRegions) {
      for (const code of region.countryCodes) {
        assert.ok(known.has(code), `${code} in ${region.code} is not in the country catalogue`);
      }
    }
  });
});

describe("browsing and tracking tell the same story", () => {
  test("no country is European for tracking but non-European on the rate card", () => {
    const tracking = trackingEuropeanCodes();
    const browsing = new Set(
      rateCardRegions.find((region) => region.code === "EUROPE")?.countryCodes ?? []
    );

    const disagreements = [...new Set([...tracking, ...browsing])]
      .filter((code) => tracking.has(code) !== browsing.has(code))
      .filter((code) => !(code in acceptedDifferences));

    assert.deepEqual(
      disagreements,
      [],
      `These countries are grouped one way for tracking and another for the rate card: ${disagreements.join(", ")}. `
      + "Either align the lists, or add each to acceptedDifferences with the reason."
    );
  });

  test("Turkey is a Middle East lane on both sides", () => {
    assert.equal(regionForCountry("TR").code, "MIDDLE_EAST");
    assert.ok(!trackingEuropeanCodes().has("TR"), "TR should not be in the tracking European list");
  });
});
