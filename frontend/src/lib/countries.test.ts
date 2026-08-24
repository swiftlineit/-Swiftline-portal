import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { countries, countryByCode, countryName } from "@/lib/countries";
import { findCountries, resolveCountry, toCountryCode } from "@/lib/countryLookup";

describe("the portal country catalogue", () => {
  test("covers every destination the Europe rate list names", () => {
    const wanted = [
      "BE", "AT", "HU", "EE", "BA", "IE", "FR", "CZ", "LT", "IT", "HR", "RO",
      "DE", "DK", "SK", "LV", "FI", "BG", "LU", "PL", "SI", "ES", "LI", "GR",
      "NL", "CH", "SE", "NO", "PT", "RS", "ME"
    ];

    for (const code of wanted) {
      assert.ok(countryByCode(code), `${code} is missing from the catalogue`);
    }
  });

  test("is sorted by name and free of duplicate codes", () => {
    const names = countries.map((country) => country.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.equal(new Set(countries.map((country) => country.iso2)).size, countries.length);
  });

  test("no two countries share a name", () => {
    // The source list calls both CD and CG "Congo". A shared name makes the
    // resolver answer whichever sorts first, and the backend catalogue is a
    // name-keyed object, so one would silently overwrite the other.
    const names = countries.map((country) => country.name);
    const duplicates = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];

    assert.deepEqual(duplicates, [], `add a nameOverrides entry for: ${duplicates.join(", ")}`);
  });

  test("the two Congos are told apart", () => {
    assert.equal(countryName("CD"), "Democratic Republic of the Congo");
    assert.equal(countryName("CG"), "Republic of the Congo");
  });

  test("names a stored code, and falls back to the code itself", () => {
    assert.equal(countryName("HR"), "Croatia");
    assert.equal(countryName("BA"), "Bosnia and Herzegovina");
    assert.equal(countryName("gb"), "United Kingdom");
    assert.equal(countryName("ZZ"), "ZZ");
  });
});

describe("matching what somebody typed", () => {
  test("suggests a country from a partial name", () => {
    assert.equal(findCountries("belg")[0]?.iso2, "be");
    assert.equal(findCountries("croat")[0]?.iso2, "hr");
    assert.equal(findCountries("slov")[0]?.iso2, "sk");
  });

  test("an empty query offers the whole catalogue", () => {
    assert.equal(findCountries("").length, countries.length);
    assert.equal(findCountries("   ").length, countries.length);
  });

  test("understands the abbreviations customers actually type", () => {
    assert.equal(resolveCountry("uk")?.iso2, "gb");
    assert.equal(resolveCountry("usa")?.iso2, "us");
    assert.equal(resolveCountry("uae")?.iso2, "ae");
    assert.equal(resolveCountry("dubai")?.iso2, "ae");
    assert.equal(resolveCountry("holland")?.iso2, "nl");
    assert.equal(resolveCountry("czechia")?.iso2, "cz");
  });

  test("refuses to guess an ambiguous prefix", () => {
    // Three countries begin with "United"; picking whichever sorts first would
    // silently send a shipment to the wrong one.
    assert.equal(resolveCountry("united"), null);
    assert.equal(resolveCountry("slov"), null);
  });

  /**
   * The serviceability checker submits `toCountryCode` and rejects anything
   * that is not two characters, so this is what makes a destination reachable
   * rather than reported as unrecognised.
   */
  test("resolves a destination to its ISO code for submission", () => {
    assert.equal(toCountryCode("Croatia"), "HR");
    assert.equal(toCountryCode("united kingdom"), "GB");
    assert.equal(toCountryCode("uk"), "GB");
    assert.equal(toCountryCode("hr"), "HR");
  });

  test("passes an unrecognised value straight through", () => {
    // The rate cards and routes behind these fields hold codes the catalogue
    // does not list, so a deliberately typed code is not second-guessed.
    assert.equal(toCountryCode("zz"), "ZZ");
    assert.equal(toCountryCode(""), "");
  });
});
