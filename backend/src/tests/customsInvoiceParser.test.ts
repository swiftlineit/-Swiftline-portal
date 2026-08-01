import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import ExcelJS from "exceljs";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { buildCustomsInvoiceModel } from "../services/customsInvoice/customsInvoiceModel.service.js";
import { buildCustomsInvoiceWorkbook } from "../services/customsInvoice/customsInvoiceWorkbook.service.js";
import {
  CustomsInvoiceParseError,
  parseCustomsInvoiceWorkbook
} from "../services/customsInvoice/customsInvoiceParser.service.js";
import { buildCustomsInvoiceTemplateWorkbook } from "../services/customsInvoice/customsInvoice.service.js";
import { shipmentDataSheetName } from "../services/customsInvoice/customsInvoiceSheet.js";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "swiftline-invoice-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function sampleDraft() {
  return {
    csbType: "CSB_V",
    serviceType: "CARGO",
    declarationNote: "GIFT ITEMS FOR FAMILY",
    consignorAddress: {
      contactName: "Ravi Sharma", companyName: "Ravi Exports",
      addressLine1: "9 Shitalkunj Soc", addressLine2: "JB Road",
      townOrCity: "Himatnagar", county: "Gujarat",
      countryName: "INDIA", postcode: "383215", email: "ravi@example.com",
      mobileCountryCode: "+91", mobileNumber: "7862859213", aadhaarNumber: "868801614500"
    },
    consigneeEnteredAddress: {
      contactName: "Krushnakant Vyas", companyName: "Oldham Temple",
      addressLine1: "Indian Association", addressLine2: "Schofield St",
      townOrCity: "Oldham", county: "Lancashire",
      countryName: "UNITED KINGDOM", countryCode: "GB", postcode: "OL8 1QJ",
      email: "kv@example.com", mobileCountryCode: "+44", mobileNumber: "7865449406"
    },
    parcelList: [
      {
        sequence: 1, weightKg: 25.7, lengthCm: 50, widthCm: 46, heightCm: 45,
        shipmentReference1: "REF-99",
        items: [
          { description: "Banner", hsnCode: "42034010", unitType: "Pkt", quantity: 2, unitRate: 150 },
          { description: "Duppata", hsnCode: "6117102030", unitType: "Pcs", quantity: 9, unitRate: 100 }
        ]
      },
      {
        sequence: 2, weightKg: 24.9, lengthCm: 40, widthCm: 30, heightCm: 20,
        items: [{ description: "Plastic Flowers", hsnCode: "6702102000", unitType: "Pkt", quantity: 40, unitRate: 50 }]
      }
    ]
  };
}

/** Writes a generated invoice to disk and reads it straight back. */
async function roundTrip(draft: Record<string, unknown> = sampleDraft(), name = "invoice") {
  const invoice = buildCustomsInvoiceModel({
    draft: draft as never,
    invoiceNumber: "DAT301472",
    invoiceDate: new Date("2026-07-13T00:00:00.000Z")
  });
  const file = path.join(scratch, `${name}-${Date.now()}.xlsx`);
  fs.writeFileSync(file, await buildCustomsInvoiceWorkbook(invoice));
  return { file, parsed: await parseCustomsInvoiceWorkbook(file) };
}

// The strongest guarantee available here: the portal both writes and reads this
// format, so generate -> parse must return exactly what went in. Any future
// layout change breaks this test rather than a customer's upload.
describe("customs invoice round-trip", () => {
  test("recovers the shipment and customs route", async () => {
    const { parsed } = await roundTrip();
    assert.equal(parsed.invoiceNumber, "DAT301472");
    assert.equal(parsed.shipmentReference, "REF-99");
    assert.equal(parsed.csbType, "CSB_V");
    assert.equal(parsed.serviceType, "CARGO");
    assert.equal(parsed.declarationNote, "GIFT ITEMS FOR FAMILY");
    assert.deepEqual(parsed.warnings, []);
  });

  test("recovers the sender, including the Aadhaar number", async () => {
    const { parsed } = await roundTrip();
    assert.equal(parsed.consignor.contactName, "Ravi Sharma");
    assert.equal(parsed.consignor.email, "ravi@example.com");
    assert.equal(parsed.consignor.mobileNumber, "7862859213");
    assert.equal(parsed.consignor.postcode, "383215");
    assert.equal(parsed.consignor.aadhaarNumber, "868801614500");
  });

  test("recovers the consignee and destination", async () => {
    const { parsed } = await roundTrip();
    assert.equal(parsed.consignee.contactName, "KRUSHNAKANT VYAS");
    assert.equal(parsed.consignee.postcode, "OL8 1QJ");
    assert.equal(parsed.consignee.countryCode, "GB");
    assert.equal(parsed.consignee.mobileCountryCode, "+44");
    assert.equal(parsed.consignee.mobileNumber, "7865449406");
  });

  test("recovers every box with its dimensions and weight", async () => {
    const { parsed } = await roundTrip();
    assert.equal(parsed.parcels.length, 2);
    assert.deepEqual(
      [parsed.parcels[0]?.lengthCm, parsed.parcels[0]?.widthCm, parsed.parcels[0]?.heightCm],
      [50, 46, 45]
    );
    assert.equal(parsed.parcels[0]?.weightKg, 25.7);
    assert.equal(parsed.parcels[1]?.weightKg, 24.9);
  });

  test("recovers every item under the right box", async () => {
    const { parsed } = await roundTrip();
    assert.equal(parsed.parcels[0]?.items.length, 2);
    assert.equal(parsed.parcels[1]?.items.length, 1);
    // 10 digit HS codes and non-default unit types survive intact.
    assert.equal(parsed.parcels[0]?.items[1]?.hsnCode, "6117102030");
    assert.equal(parsed.parcels[0]?.items[1]?.unitType, "Pcs");
    assert.equal(parsed.parcels[0]?.items[1]?.quantity, 9);
    assert.equal(parsed.parcels[0]?.items[1]?.unitRate, 100);
  });

  test("the downloadable blank template imports cleanly", async () => {
    const file = path.join(scratch, "template.xlsx");
    fs.writeFileSync(file, await buildCustomsInvoiceTemplateWorkbook());
    const parsed = await parseCustomsInvoiceWorkbook(file);

    assert.equal(parsed.csbType, "CSB_IV");
    assert.equal(parsed.serviceType, "COURIER");
    assert.equal(parsed.parcels.length, 1);
    assert.equal(parsed.parcels[0]?.items.length, 2);
    assert.deepEqual(parsed.warnings, []);
  });

  test("an invoice with no customer reference still yields a bookable reference", async () => {
    // The REFERENCE line is optional on the form, but booking requires a shipment
    // reference (dpdPayloadValidation). The upload controller falls back to the
    // invoice number, which the printed sheet always carries.
    const draft = sampleDraft() as Record<string, unknown>;
    (draft.parcelList as Array<Record<string, unknown>>)[0]!.shipmentReference1 = "";
    const { parsed } = await roundTrip(draft, "no-reference");

    assert.equal(parsed.shipmentReference, "");
    assert.ok(parsed.invoiceNumber, "the invoice number must survive to act as the fallback");
    assert.ok(parsed.shipmentReference || parsed.invoiceNumber, "booking would have no reference");
  });

  test("the template's example contacts pass shipment validation", async () => {
    // A customer fills in the goods and uploads. If the untouched example phone,
    // PIN or email fails validation they hit an error on a field they never
    // edited — so the examples themselves must be valid. Ofcom's 07700 900xxx
    // drama range looks like a UK mobile but is reserved and fails.
    const file = path.join(scratch, "template-contacts.xlsx");
    fs.writeFileSync(file, await buildCustomsInvoiceTemplateWorkbook());
    const parsed = await parseCustomsInvoiceWorkbook(file);

    const consigneePhone = parsePhoneNumberFromString(
      `${parsed.consignee.mobileCountryCode}${parsed.consignee.mobileNumber}`
    );
    assert.ok(consigneePhone?.isValid(), `consignee example number is not valid: ${consigneePhone?.number}`);

    const consignorPhone = parsePhoneNumberFromString(`+91${parsed.consignor.mobileNumber}`);
    assert.ok(consignorPhone?.isValid(), `consignor example number is not valid: ${consignorPhone?.number}`);

    assert.ok(/^[1-9]\d{5}$/.test(parsed.consignor.postcode), "consignor example PIN code is not valid");
    for (const email of [parsed.consignor.email, parsed.consignee.email]) {
      assert.ok(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), `example email is not valid: ${email}`);
    }
  });
});

// A partial fill must never fail the upload: a blank field is obvious on the
// review form, a wrongly filled one is not.
describe("partial and invalid values", () => {
  /** Rewrites one cell on the import sheet, simulating a customer edit. */
  async function withShipmentDataEdit(edit: (sheet: ExcelJS.Worksheet) => void, name: string) {
    const { file } = await roundTrip(sampleDraft(), name);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet(shipmentDataSheetName);
    assert.ok(sheet, "expected the import sheet");
    edit(sheet);
    const edited = path.join(scratch, `${name}-edited.xlsx`);
    await workbook.xlsx.writeFile(edited);
    return parseCustomsInvoiceWorkbook(edited);
  }

  function setField(sheet: ExcelJS.Worksheet, label: string, value: string) {
    sheet.eachRow((row) => {
      if (String(row.getCell(1).value ?? "").toUpperCase() === label.toUpperCase()) {
        row.getCell(2).value = value;
      }
    });
  }

  test("drops an invalid Aadhaar number and warns", async () => {
    const parsed = await withShipmentDataEdit(
      (sheet) => setField(sheet, "Consignor Aadhaar Number", "12345"),
      "bad-aadhaar"
    );
    assert.equal(parsed.consignor.aadhaarNumber, "");
    assert.ok(parsed.warnings.some((warning) => warning.includes("Aadhaar")));
    // The rest of the import is unaffected.
    assert.equal(parsed.consignor.contactName, "Ravi Sharma");
    assert.equal(parsed.parcels.length, 2);
  });

  test("drops an invalid PIN code and warns", async () => {
    const parsed = await withShipmentDataEdit(
      (sheet) => setField(sheet, "Consignor PIN Code", "12"),
      "bad-pin"
    );
    assert.equal(parsed.consignor.postcode, "");
    assert.ok(parsed.warnings.some((warning) => warning.includes("PIN code")));
  });

  test("drops an unrecognised shipment type rather than guessing the charge", async () => {
    // Guessing here could silently add or remove the CSB-V clearance charge.
    const parsed = await withShipmentDataEdit(
      (sheet) => setField(sheet, "Shipment Type", "CSB-9"),
      "bad-csb"
    );
    assert.equal(parsed.csbType, null);
    assert.ok(parsed.warnings.some((warning) => warning.includes("Shipment type")));
  });

  test("leaves blank fields blank without failing", async () => {
    const parsed = await withShipmentDataEdit((sheet) => {
      setField(sheet, "Consignor Email", "");
      setField(sheet, "Consignor Town / City", "");
    }, "blank-fields");
    assert.equal(parsed.consignor.email, "");
    assert.equal(parsed.consignor.townOrCity, "");
    // Boxes and items still import.
    assert.equal(parsed.parcels.length, 2);
  });

  test("still imports boxes and items when the whole import sheet is missing", async () => {
    const { file } = await roundTrip(sampleDraft(), "no-data-sheet");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    workbook.removeWorksheet(workbook.getWorksheet(shipmentDataSheetName)!.id);
    const stripped = path.join(scratch, "no-data-sheet-stripped.xlsx");
    await workbook.xlsx.writeFile(stripped);

    const parsed = await parseCustomsInvoiceWorkbook(stripped);
    assert.equal(parsed.parcels.length, 2);
    assert.equal(parsed.consignee.contactName, "KRUSHNAKANT VYAS");
    // Sender and route could not be read, so they are absent rather than guessed.
    assert.equal(parsed.csbType, null);
    assert.equal(parsed.consignor.contactName, "");
    assert.ok(parsed.warnings.some((warning) => warning.includes(shipmentDataSheetName)));
  });
});

describe("unusable files", () => {
  test("rejects a workbook that is not a Swiftline invoice", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["something", "else"]);
    const file = path.join(scratch, "not-an-invoice.xlsx");
    await workbook.xlsx.writeFile(file);

    await assert.rejects(
      () => parseCustomsInvoiceWorkbook(file),
      (error: unknown) => error instanceof CustomsInvoiceParseError
    );
  });

  test("rejects a file that is not a workbook at all", async () => {
    const file = path.join(scratch, "not-a-workbook.xlsx");
    fs.writeFileSync(file, "plain text, not a spreadsheet");

    await assert.rejects(
      () => parseCustomsInvoiceWorkbook(file),
      (error: unknown) => error instanceof CustomsInvoiceParseError
    );
  });
});
