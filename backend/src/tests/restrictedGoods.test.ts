import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  findRestrictedCategories,
  isRestrictedDescription,
  restrictedCategories
} from "../services/restrictedGoods.service.js";

describe("restricted goods matcher", () => {
  test("flags at least one keyword from every category", () => {
    for (const category of restrictedCategories) {
      for (const keyword of category.keywords) {
        const matched = findRestrictedCategories(`SNACKS, ${keyword.toUpperCase()}, CLOTHES`);
        assert.ok(
          matched.includes(category.label),
          `expected "${keyword}" to flag ${category.label}, got ${JSON.stringify(matched)}`
        );
      }
    }
  });

  test("matches inside a comma-separated description regardless of case", () => {
    assert.deepEqual(findRestrictedCategories("SNACKS,SWEETS,GOLD RING"), ["Gold / Silver / Precious Metals"]);
    assert.equal(isRestrictedDescription("bottle of Whisky"), true);
    assert.equal(isRestrictedDescription("power bank"), true);
    assert.equal(isRestrictedDescription("POWERBANK x2"), true);
  });

  test("reports multiple categories in list order, de-duplicated", () => {
    assert.deepEqual(
      findRestrictedCategories("wine, cigarettes, more wine"),
      ["Alcohol / Liquor", "Tobacco / Nicotine / Vape"]
    );
  });

  test("does not fire on words that merely contain a keyword", () => {
    // "cashew" contains "cash", "marigold" contains "gold", "seedless" contains "seed".
    for (const clean of [
      "cashew nuts",
      "marigold garland",
      "seedless grapes snacks",
      "eggplant pickle",
      "goldfish crackers"
    ]) {
      assert.deepEqual(findRestrictedCategories(clean), [], `false positive on "${clean}"`);
    }
  });

  test("treats empty or non-string input as clean", () => {
    assert.deepEqual(findRestrictedCategories(""), []);
    assert.deepEqual(findRestrictedCategories("   "), []);
    assert.deepEqual(findRestrictedCategories(null), []);
    assert.deepEqual(findRestrictedCategories(undefined), []);
    assert.deepEqual(findRestrictedCategories(42), []);
  });

  test("passes ordinary shipment contents", () => {
    for (const clean of [
      "SNACKS, SWEETS, DRYFRUITS",
      "SAREE COVER, DOORMAT, SAREES, MENS KURTA",
      "UTENSILS, SNACKS, PRESSURE COOKER",
      "LADIES WEAR, TOPS, SNACKS"
    ]) {
      assert.deepEqual(findRestrictedCategories(clean), [], `false positive on "${clean}"`);
    }
  });
});
