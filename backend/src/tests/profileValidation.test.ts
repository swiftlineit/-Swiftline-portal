import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isHttpOrHttpsUrl, isValidBusinessContactEmail, isValidPhoneForCountryCode, isValidPostalCodeForCountry
} from "../services/businessAccountRules.js";

/**
 * The profile page edits a subset of business-account fields. These assert the
 * shared rule helpers reject the values the loose first version of the profile
 * schema would have stored, so profile edits cannot diverge from account
 * creation.
 */
describe("profile edits reuse the business account rules", () => {
  it("rejects websites that are not http(s), including javascript: payloads", () => {
    assert.equal(isHttpOrHttpsUrl("javascript:alert(1)"), false);
    assert.equal(isHttpOrHttpsUrl("data:text/html,<script>alert(1)</script>"), false);
    assert.equal(isHttpOrHttpsUrl("ftp://example.com"), false);
    assert.equal(isHttpOrHttpsUrl("https://swiftlineindia.com"), true);
  });

  it("rejects typo and reserved contact email domains", () => {
    assert.equal(isValidBusinessContactEmail("someone@gmail.con"), false);
    assert.equal(isValidBusinessContactEmail("someone@gmail.co.uk"), false, "reserved personal name on a non-allowed domain");
    assert.equal(isValidBusinessContactEmail("not-an-email"), false);
    assert.equal(isValidBusinessContactEmail("someone@gmail.com"), true);
    assert.equal(isValidBusinessContactEmail("ops@swiftlineindia.com"), true);
  });

  it("rejects a phone that does not fit its country code", () => {
    assert.equal(isValidPhoneForCountryCode("+91", "12345"), false);
    assert.equal(isValidPhoneForCountryCode("+91", "7027606600"), true);
  });

  it("rejects a postal code that does not fit the account's country", () => {
    assert.equal(isValidPostalCodeForCountry("India", "1100"), false);
    assert.equal(isValidPostalCodeForCountry("India", "110001"), true);
    assert.equal(isValidPostalCodeForCountry("United Kingdom", "999999"), false);
    assert.equal(isValidPostalCodeForCountry("United Kingdom", "SW1A 2AA"), true);
  });
});
