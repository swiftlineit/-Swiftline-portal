import assert from "node:assert/strict";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import {
  parseShipmentImportUpload,
  ShipmentImportParseError
} from "../services/shipmentImport/shipmentImportParser.service.js";
import { agentInvoiceTemplateVersion } from "../services/shipmentImport/agentInvoiceParser.service.js";
import { shipmentImportSheetNames } from "../services/shipmentImport/shipmentImportContract.js";

type Cells = Record<string, string | number>;

async function invoiceBuffer(cells: Cells) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  for (const [reference, value] of Object.entries(cells)) sheet.getCell(reference).value = value;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function parse(cells: Cells, options = { allowAgentInvoice: true }) {
  return invoiceBuffer(cells).then((buffer) => parseShipmentImportUpload(buffer, options));
}

/** Everything below the consignee block, shared by every layout. */
const invoiceFooter: Cells = {
  E16: "Country of origin of goods", G16: "Country of final destination",
  E17: "INDIA", G17: "U.K",
  B19: "Country Of Origin", D19: "INDIA", E19: "BONAFIED GIFT FOR PERSONAL USE ONLY",
  B20: "Country of final destination", D20: "U.K",
  B21: "MARKS & NOS.", G21: "QTY", H21: "AMOUNT", I21: "AMOUNT",
  D23: "READY MADE GARMENTS", G23: "PCS", H23: "INR", I23: "INR"
};

/**
 * The layout most invoices use: the exporter's town line names its state, and
 * the consignee's town and postcode share one line.
 */
const inlineStateLayout: Cells = {
  B1: "INVOICE",
  B2: "EXPORTER", E2: "INVOICE NO ", G2: "INVOICE DATE",
  B3: "HARJIT SINGH", E3: "MO. 22", G3: "18/8/2026",
  B4: "S/O KARAM SINGH, MODEL TOWN,",
  B5: "SANGRUR PUNJAB- 148026", F5: "AC WT : 2.900 KG",
  B6: "PH NO. 9876543210",
  B7: "AADHAR NO. 488334212335",
  F8: "DIM : 27*21*17",
  B10: "CONSIGNEE",
  B11: "AMRIK SINGH",
  B12: "65 SILVERDALE GARDENS",
  B13: "HAYES LONDON, UB3 3LW ENGLAND",
  B14: "U.K",
  B15: "PH. + 447782377721",
  B16: "agent@example.com",
  ...invoiceFooter,
  C27: "COTTON VEST", G27: 4, H27: 100, I27: 400,
  C28: "REXINE BELT", G28: 1, H28: 300, I28: 300,
  B43: "ALL THESE GOODS ARE MADE IN INDIA", G43: "TOTAL", H43: "INR", I43: 700
};

describe("agent invoice import", () => {
  test("reads an invoice whose exporter line names its own state", async () => {
    const parsed = await parse(inlineStateLayout);

    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.templateVersion, agentInvoiceTemplateVersion);
    assert.equal(parsed.csbType, "CSB_IV");
    assert.equal(parsed.serviceType, "COURIER");
    assert.equal(parsed.declarationNote, "BONAFIED GIFT FOR PERSONAL USE ONLY");

    assert.equal(parsed.consignor.contactName, "HARJIT SINGH");
    // The invoice names a person, so company repeats the name.
    assert.equal(parsed.consignor.companyName, "HARJIT SINGH");
    assert.equal(parsed.consignor.addressLine1, "S/O KARAM SINGH, MODEL TOWN");
    assert.equal(parsed.consignor.townOrCity, "SANGRUR");
    assert.equal(parsed.consignor.county, "Punjab");
    assert.equal(parsed.consignor.postcode, "148026");
    assert.equal(parsed.consignor.mobileNumber, "9876543210");
    assert.equal(parsed.consignor.aadhaarNumber, "488334212335");
    assert.equal(parsed.consignor.email, "");

    assert.equal(parsed.consignee.contactName, "AMRIK SINGH");
    assert.equal(parsed.consignee.companyName, "AMRIK SINGH");
    assert.equal(parsed.consignee.addressLine1, "65 SILVERDALE GARDENS");
    assert.equal(parsed.consignee.townOrCity, "HAYES LONDON");
    assert.equal(parsed.consignee.postcode, "UB3 3LW");
    assert.equal(parsed.consignee.countryName, "United Kingdom");
    assert.equal(parsed.consignee.countryCode, "GB");
    assert.equal(parsed.consignee.mobileCountryCode, "+44");
    assert.equal(parsed.consignee.mobileNumber, "7782377721");
    assert.equal(parsed.consignee.email, "agent@example.com");

    assert.equal(parsed.parcels.length, 1);
    const parcel = parsed.parcels[0]!;
    assert.equal(parcel.weightKg, 2.9);
    assert.deepEqual([parcel.lengthCm, parcel.widthCm, parcel.heightCm], [27, 21, 17]);
    assert.equal(parcel.shipmentContentType, "PARCEL");
    assert.equal(parcel.reference, "SLC");
    assert.deepEqual(parcel.items, [
      { description: "COTTON VEST", hsnCode: "", unitType: "Pcs", quantity: 4, unitRate: 100 },
      { description: "REXINE BELT", hsnCode: "", unitType: "Pcs", quantity: 1, unitRate: 300 }
    ]);
  });

  test("reads the shorter layout, deriving the state from the town", async () => {
    // One row shorter in the exporter block, which shifts every row below it.
    // The town has no state beside it, the consignee's town sits on its own
    // line above the county, "ADHAR" loses an A and there is no email.
    const parsed = await parse({
      B1: "INVOICE",
      B2: "EXPORTER", E2: "INVOICE NO ", G2: "INVOICE DATE",
      B3: "MANJIT KAUR", E3: "MO. 2",
      B4: "H NO. 83  ST NO. 1",
      B5: "GILL COLONY LOHARA", F5: "AC WT :11.800 KG",
      B6: "LUDHIANA- 141016",
      B7: "PH. 9812345678",
      B8: "ADHAR NO. 352043382892", F8: "DIM.40*40*32",
      B10: "CONSIGNEE",
      B11: "GURPREET SINGH",
      B12: "# 6 STUBBY LANE,",
      B13: "WOLVERHAMPTON ",
      B14: "WEST MIDLANDS    WV11 3NW",
      B15: "UK",
      B16: "PH. +44 7438574524",
      ...invoiceFooter,
      C25: "TURBAN CLOTH", G25: 4, H25: 200, I25: 800,
      B43: "ALL THESE GOODS ARE MADE IN INDIA", G43: "TOTAL", H43: "INR", I43: 800
    });

    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.consignor.townOrCity, "LUDHIANA");
    // Not on the invoice; resolved from the town because it maps to one state.
    assert.equal(parsed.consignor.county, "Punjab");
    assert.equal(parsed.consignor.aadhaarNumber, "352043382892");
    assert.equal(parsed.consignor.addressLine2, "GILL COLONY LOHARA");

    assert.equal(parsed.consignee.addressLine1, "# 6 STUBBY LANE");
    assert.equal(parsed.consignee.townOrCity, "WOLVERHAMPTON");
    assert.equal(parsed.consignee.county, "WEST MIDLANDS");
    assert.equal(parsed.consignee.postcode, "WV11 3NW");
    assert.equal(parsed.consignee.email, "");
    assert.ok(parsed.warnings.some((issue) => issue.includes("Consignee Email")));

    assert.equal(parsed.parcels[0]!.weightKg, 11.8);
    assert.deepEqual(
      [parsed.parcels[0]!.lengthCm, parsed.parcels[0]!.widthCm, parsed.parcels[0]!.heightCm],
      [40, 40, 32]
    );
  });

  test("splits a multi-box invoice into one parcel per box", async () => {
    const parsed = await parse({
      ...inlineStateLayout,
      F5: "BOX.1,AC WT : 19.900 KG DIM : 45*42*41",
      F8: "BOX.2,AC WT : 16.900 KG DIM : 58*38*37",
      F10: "TOTAL WT. 36.800 KG",
      C27: "", G27: "", H27: "", I27: "",
      C28: "", G28: "", H28: "", I28: "",
      B26: "BOX-1",
      // The box weight repeats in column B beside the first item and must not
      // be mistaken for a description.
      B27: "19.900 KG",
      C29: "COTTON SUIT", G29: 28, H29: 400, I29: 11200,
      B32: "BOX-2",
      B33: "16.900 KG",
      C33: "IRON", G33: 1, H33: 1500, I33: 1500,
      C34: "TOYS", G34: 1, H34: 500, I34: 500,
      I43: 13200
    });

    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.parcels.length, 2);
    assert.deepEqual(parsed.parcels.map((parcel) => parcel.sequence), [1, 2]);
    assert.deepEqual(parsed.parcels.map((parcel) => parcel.weightKg), [19.9, 16.9]);
    assert.deepEqual(
      [parsed.parcels[1]!.lengthCm, parsed.parcels[1]!.widthCm, parsed.parcels[1]!.heightCm],
      [58, 38, 37]
    );
    assert.deepEqual(parsed.parcels.map((parcel) => parcel.items.length), [1, 2]);
    assert.equal(parsed.parcels[0]!.items[0]!.description, "COTTON SUIT");
    assert.deepEqual(
      parsed.parcels[1]!.items.map((item) => item.description),
      ["IRON", "TOYS"]
    );
    // Every parcel carries the same default reference.
    assert.deepEqual(parsed.parcels.map((parcel) => parcel.reference), ["SLC", "SLC"]);
  });

  test("warns without blocking when the item lines miss the stated total", async () => {
    const parsed = await parse({ ...inlineStateLayout, I43: 9999 });

    assert.deepEqual(parsed.errors, []);
    assert.ok(parsed.warnings.some((issue) => issue.includes("700.00") && issue.includes("9999.00")));
  });

  test("blocks a file whose declared boxes and item groups disagree", async () => {
    const parsed = await parse({
      ...inlineStateLayout,
      F5: "BOX.1,AC WT : 19.900 KG DIM : 45*42*41",
      F8: "BOX.2,AC WT : 16.900 KG DIM : 58*38*37"
      // Two boxes declared, but the items carry no BOX markers at all.
    });

    assert.ok(parsed.errors.some((issue) => issue.includes("declares 2 box")));
  });

  test("blocks a destination other than the United Kingdom", async () => {
    const parsed = await parse({
      ...inlineStateLayout,
      B13: "TORONTO, M5V 2T6",
      B14: "CANADA",
      D20: "CANADA"
    });

    assert.ok(parsed.errors.some((issue) => issue.includes("not supported")));
  });

  test("collapses the missing HS codes into one warning", async () => {
    const parsed = await parse(inlineStateLayout);
    const hsWarnings = parsed.warnings.filter((issue) => issue.includes("HS code"));

    assert.equal(hsWarnings.length, 1);
    assert.ok(hsWarnings[0]!.includes("all 2 items"));
    assert.ok(parsed.parcels[0]!.items.every((item) => item.hsnCode === ""));
    assert.ok(parsed.warnings.some((issue) => issue.includes("Consignor email")));
  });

  test("refuses the invoice format for a client upload", async () => {
    // The format is staff-only, so a client sees the template's own message.
    await assert.rejects(
      () => parse(inlineStateLayout, { allowAgentInvoice: false }),
      (error: unknown) => {
        assert.ok(error instanceof ShipmentImportParseError);
        assert.match(error.issues[0] ?? "", /Required worksheets missing/);
        return true;
      }
    );
  });

  test("never diverts a template upload to the invoice reader", async () => {
    // A workbook carrying a template worksheet takes the template path even
    // when its cells also look like an invoice.
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet(shipmentImportSheetNames.shipment);
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.getCell("B2").value = "EXPORTER";
    sheet.getCell("B10").value = "CONSIGNEE";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await assert.rejects(
      () => parseShipmentImportUpload(buffer, { allowAgentInvoice: true }),
      (error: unknown) => {
        assert.ok(error instanceof ShipmentImportParseError);
        assert.match(error.issues[0] ?? "", /Required worksheets missing: Parcels, Items/);
        return true;
      }
    );
  });
});
