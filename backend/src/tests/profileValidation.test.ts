import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidProfilePhone } from "../controllers/profile.controller.js";
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

/**
 * The staff form accepts "+91 87450 63206" and the record stores "+918745063206".
 * Before separators were stripped, the profile form refused both the readable
 * form and its own stored value, so a stale phone blocked every other edit on
 * that form- including fields the user had not touched.
 */
describe("profile phone rule", () => {
  it("accepts a number typed with separators", () => {
    assert.equal(isValidProfilePhone("+91 8745063206"), true);
    assert.equal(isValidProfilePhone("+91 87450 63206"), true);
    assert.equal(isValidProfilePhone("(011) 4567-8901"), true);
  });

  it("accepts the compact form the record already holds", () => {
    assert.equal(isValidProfilePhone("+918745063206"), true);
  });

  it("keeps the country code optional", () => {
    assert.equal(isValidProfilePhone("8799789886"), true);
  });

  it("treats an empty value as unset rather than invalid", () => {
    assert.equal(isValidProfilePhone(""), true);
    assert.equal(isValidProfilePhone("   "), true);
  });

  it("still rejects what is not a number of the right length", () => {
    assert.equal(isValidProfilePhone("12345"), false);
    assert.equal(isValidProfilePhone("+9187450632060000"), false);
    assert.equal(isValidProfilePhone("87450a63206"), false);
    assert.equal(isValidProfilePhone("+91+8745063206"), false);
  });
});
