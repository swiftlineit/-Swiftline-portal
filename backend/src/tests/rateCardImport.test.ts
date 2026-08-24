import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import {
  buildSlabs,
  parseRateCardWorkbook,
  RateCardImportError
} from "../services/rateCardImport.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// portal/backend/src/tests -> the repository root, where the rate lists live.
const realWorkbook = path.resolve(here, "../../../..", "SWIFTLINE ERUOPE RATELIST.xlsx");

type SheetSpec = {
  /** Rows of letterhead above the header, to prove the anchor is not a fixed cell. */
  letterhead?: number;
  weightHeader?: string;
  zones: Array<{ names: string[]; rates: Array<number | null> }>;
  weights: number[];
  /** Prose written below the grid, as every real rate list carries. */
  terms?: string[];
};

async function buildWorkbook(spec: SheetSpec) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  const letterhead = spec.letterhead ?? 0;

  for (let index = 0; index < letterhead; index += 1) {
    sheet.getRow(index + 1).getCell(2).value = "SWIFTLINE CARGO & EXPRESS LOGISTICS";
  }

  const headerRow = letterhead + 1;
  sheet.getRow(headerRow).getCell(2).value = spec.weightHeader ?? "Weight";
  spec.zones.forEach((zone, zoneIndex) => {
    zone.names.forEach((name, nameIndex) => {
      sheet.getRow(headerRow + nameIndex).getCell(3 + zoneIndex).value = name;
    });
  });

  const tallestZone = Math.max(1, ...spec.zones.map((zone) => zone.names.length));
  const firstDataRow = headerRow + tallestZone + 1;

  spec.weights.forEach((weight, weightIndex) => {
    const row = sheet.getRow(firstDataRow + weightIndex);
    row.getCell(2).value = weight;
    spec.zones.forEach((zone, zoneIndex) => {
      const rate = zone.rates[weightIndex];
      if (rate !== null && rate !== undefined) row.getCell(3 + zoneIndex).value = rate;
    });
  });

  (spec.terms ?? []).forEach((line, index) => {
    sheet.getRow(firstDataRow + spec.weights.length + index).getCell(2).value = line;
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const simpleSpec: SheetSpec = {
  letterhead: 3,
  zones: [
    { names: ["BELGIUM", "FRANCE"], rates: [2240, 1340, 998] },
    { names: ["AUSTRIA"], rates: [2240, 1350, 1040] }
  ],
  weights: [1, 2, 3],
  terms: ["TERMS AND CONDITIONS : -", "* 18% GST will be applicable for GST BILL."]
};

describe("rate card workbook parsing", () => {
  test("reads zones, weights and rates from a letterheaded sheet", async () => {
    const parsed = await parseRateCardWorkbook(await buildWorkbook(simpleSpec), ".xlsx");

    assert.deepEqual(parsed.weights, [1, 2, 3]);
    assert.equal(parsed.zones.length, 2);
    assert.deepEqual(parsed.zones[0]?.rawNames, ["BELGIUM", "FRANCE"]);
    assert.deepEqual(parsed.zones[0]?.rates, [2240, 1340, 998]);
    assert.deepEqual(parsed.zones[1]?.rawNames, ["AUSTRIA"]);
  });

  test("finds the weight column wherever the letterhead pushes it", async () => {
    const shallow = await parseRateCardWorkbook(await buildWorkbook({ ...simpleSpec, letterhead: 0 }), ".xlsx");
    const deep = await parseRateCardWorkbook(await buildWorkbook({ ...simpleSpec, letterhead: 9 }), ".xlsx");

    assert.deepEqual(shallow.weights, deep.weights);
    assert.deepEqual(shallow.zones[0]?.rawNames, deep.zones[0]?.rawNames);
  });

  test("stops at the terms block rather than reading prose as rates", async () => {
    const parsed = await parseRateCardWorkbook(await buildWorkbook(simpleSpec), ".xlsx");
    assert.equal(parsed.weights.length, 3);
  });

  test("keeps a blank rate blank rather than pricing it at zero", async () => {
    const parsed = await parseRateCardWorkbook(
      await buildWorkbook({
        ...simpleSpec,
        zones: [{ names: ["BELGIUM"], rates: [2240, null, 998] }]
      }),
      ".xlsx"
    );

    assert.deepEqual(parsed.zones[0]?.rates, [2240, null, 998]);
  });

  test("rejects a sheet with no weight column", async () => {
    const buffer = await buildWorkbook({ ...simpleSpec, weightHeader: "Kilos" });
    await assert.rejects(
      () => parseRateCardWorkbook(buffer, ".xlsx"),
      (error: unknown) => error instanceof RateCardImportError && /Weight/.test(error.message)
    );
  });

  test("rejects weights that do not increase", async () => {
    const buffer = await buildWorkbook({ ...simpleSpec, weights: [1, 3, 2] });
    await assert.rejects(
      () => parseRateCardWorkbook(buffer, ".xlsx"),
      (error: unknown) => error instanceof RateCardImportError && /increase/.test(error.message)
    );
  });

  test("rejects a sheet with no zone columns", async () => {
    const buffer = await buildWorkbook({ ...simpleSpec, zones: [] });
    await assert.rejects(
      () => parseRateCardWorkbook(buffer, ".xlsx"),
      (error: unknown) => error instanceof RateCardImportError && /zone columns/.test(error.message)
    );
  });

  test("rejects a sheet whose weight column has no numbers", async () => {
    const buffer = await buildWorkbook({ ...simpleSpec, weights: [] });
    await assert.rejects(
      () => parseRateCardWorkbook(buffer, ".xlsx"),
      (error: unknown) => error instanceof RateCardImportError && /no numeric rows/.test(error.message)
    );
  });
});

describe("weight rows to weight slabs", () => {
  test("lays slabs end to end from zero", () => {
    const slabs = buildSlabs([1, 2, 3, 30], [2240, 1340, 998, 525], 30);

    assert.deepEqual(slabs[0], { fromKg: 0, toKg: 1, chargesPerKg: 2240, maxBoxKg: 30 });
    assert.deepEqual(slabs[1], { fromKg: 1.01, toKg: 2, chargesPerKg: 1340, maxBoxKg: 30 });
    assert.deepEqual(slabs[3], { fromKg: 3.01, toKg: 30, chargesPerKg: 525, maxBoxKg: 30 });
  });

  test("leaves no overlap between neighbouring slabs", () => {
    const weights = Array.from({ length: 30 }, (_, index) => index + 1);
    const slabs = buildSlabs(weights, weights.map(() => 500), 30);

    assert.equal(slabs.length, 30);
    for (let index = 1; index < slabs.length; index += 1) {
      assert.ok(
        slabs[index]!.fromKg > slabs[index - 1]!.toKg,
        `slab ${index} starts at ${slabs[index]!.fromKg}, on or before ${slabs[index - 1]!.toKg}`
      );
    }
  });

  test("no whole kilogram falls between two slabs", () => {
    const weights = Array.from({ length: 30 }, (_, index) => index + 1);
    const slabs = buildSlabs(weights, weights.map(() => 500), 30);

    // Pricing rounds chargeable weight up to a whole kilogram before looking a
    // slab up, so only whole kilograms have to be covered.
    for (let kilogram = 1; kilogram <= 30; kilogram += 1) {
      const match = slabs.filter((slab) => kilogram >= slab.fromKg && kilogram <= slab.toKg);
      assert.equal(match.length, 1, `${kilogram} kg matched ${match.length} slabs`);
    }
  });

  test("skips blank rates instead of writing them as free freight", () => {
    const slabs = buildSlabs([1, 2, 3], [2240, null, 998], 30);

    assert.equal(slabs.length, 2);
    assert.deepEqual(slabs.map((slab) => slab.toKg), [1, 3]);
  });
});

describe("the real Europe rate list", { skip: existsSync(realWorkbook) ? false : "workbook not present" }, () => {
  test("reads six zones, thirty weights and thirty country names", async () => {
    const parsed = await parseRateCardWorkbook(await readFile(realWorkbook), ".xlsx");

    assert.equal(parsed.zones.length, 6);
    assert.equal(parsed.weights.length, 30);
    assert.deepEqual(parsed.weights[0], 1);
    assert.deepEqual(parsed.weights[29], 30);

    const names = parsed.zones.flatMap((zone) => zone.rawNames);
    assert.equal(names.length, 30);
    assert.ok(names.includes("SERBIA & MONTENEGRO"));
    assert.ok(names.includes("SLOVANIA"));
  });

  test("prices Belgium at the published rates", async () => {
    const parsed = await parseRateCardWorkbook(await readFile(realWorkbook), ".xlsx");
    const belgium = parsed.zones.find((zone) => zone.rawNames.includes("BELGIUM"));
    assert.ok(belgium);

    const slabs = buildSlabs(parsed.weights, belgium.rates, 30);
    assert.equal(slabs.length, 30);
    assert.equal(slabs[0]?.chargesPerKg, 2240);
    // A 5 kg parcel bills at the fifth row.
    assert.equal(slabs.find((slab) => 5 >= slab.fromKg && 5 <= slab.toKg)?.chargesPerKg, 795);
    assert.equal(slabs[29]?.chargesPerKg, 525);
  });

  test("does not read the terms block as rates", async () => {
    const parsed = await parseRateCardWorkbook(await readFile(realWorkbook), ".xlsx");
    for (const zone of parsed.zones) {
      assert.equal(zone.rates.length, parsed.weights.length);
    }
  });
});
