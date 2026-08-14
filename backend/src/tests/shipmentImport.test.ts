import assert from "node:assert/strict";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import { buildShipmentImportTemplateWorkbook } from "../services/shipmentImport/shipmentImportWorkbook.service.js";
import { parseShipmentImportWorkbook } from "../services/shipmentImport/shipmentImportParser.service.js";
import { shipmentImportSheetNames, shipmentImportTemplateVersion } from "../services/shipmentImport/shipmentImportContract.js";

async function completedWorkbook(input: { multipleParcels?: boolean; invalidContentType?: boolean } = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildShipmentImportTemplateWorkbook() as unknown as ArrayBuffer);
  const shipment = workbook.getWorksheet(shipmentImportSheetNames.shipment);
  const parcels = workbook.getWorksheet(shipmentImportSheetNames.parcels);
  const items = workbook.getWorksheet(shipmentImportSheetNames.items);
  assert.ok(shipment && parcels && items);

  const values: Record<string, string> = {
    "Template Version": shipmentImportTemplateVersion,
    "Shipment Type (Choose CSB-IV or CSB-V) *": "CSB-V",
    "Service Type (Choose Courier or Cargo) *": "Cargo",
    "Declaration Note": "Commercial samples",
    "Consignor Company": "Swiftline",
    "Consignor Contact Name *": "Aman Negi",
    "Consignor Email *": "aman@example.com",
    "Consignor Mobile Number *": "8745073206",
    "Consignor Country *": "India",
    "Pickup Address Line 1 *": "Begreen Plaza",
    "Pickup Address Line 2": "Office 204",
    "Pickup Town / City *": "New Delhi",
    "Pickup State *": "Delhi",
    "Pickup PIN Code *": "110037",
    "Pickup Instructions": "Call before pickup",
    "Consignee Company": "Drifter Co",
    "Consignee Contact Name *": "Bonny Paulson",
    "Consignee Email *": "bonny@example.com",
    "Consignee Mobile With Country Code *": "+44 7123456789",
    "Delivery Instructions": "Reception",
    "Destination Country (Choose from dropdown) *": "United Kingdom",
    "Delivery Address Line 1 *": "14 Marvell Avenue",
    "Delivery Address Line 2": "Hayes",
    "Delivery Town / City *": "London",
    "Delivery State / County": "Greater London",
    "Delivery Postcode *": "UB4 0QR"
  };
  shipment.eachRow((row) => {
    const label = String(row.getCell(1).value ?? "");
    if (label in values) row.getCell(2).value = values[label]!;
  });

  const parcelRows = [
    [1, 10, 30, 20, 15, input.invalidContentType ? "Random Goods" : "Merchandise", "REF-001"],
    ...(input.multipleParcels ? [[2, 5, 25, 20, 15, "Gifts", "REF-002"]] : [])
  ];
  parcelRows.forEach((values, index) => values.forEach((value, column) => { parcels.getCell(index + 3, column + 1).value = value; }));
  for (let row = parcelRows.length + 3; row <= 12; row += 1) {
    for (let column = 1; column <= 7; column += 1) parcels.getCell(row, column).value = "";
  }

  const itemRows = input.multipleParcels
    ? [[1, "Cotton trousers", "62034200", "Pcs", 2, 1500], [2, "Photo frames", "44140000", "Set", 2, 600]]
    : [[1, "Cotton trousers", "62034200", "Pcs", 2, 1500], [1, "Packaged snacks", "19059090", "Pkt", 5, 200]];
  itemRows.forEach((values, index) => values.forEach((value, column) => { items.getCell(index + 3, column + 1).value = value; }));
  for (let row = itemRows.length + 3; row <= 22; row += 1) {
    for (let column = 1; column <= 6; column += 1) items.getCell(row, column).value = "";
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("shipment import template", () => {
  test("contains guidance, three input sheets and hidden dropdown values", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildShipmentImportTemplateWorkbook() as unknown as ArrayBuffer);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Read Me", "Shipment", "Parcels", "Items", "_Lists"]);
    assert.equal(workbook.getWorksheet("_Lists")?.state, "veryHidden");
    const shipment = workbook.getWorksheet("Shipment") as ExcelJS.Worksheet & { sheetProtection?: { sheet?: boolean } };
    assert.equal(shipment.sheetProtection?.sheet, true);
    assert.match(String(workbook.getWorksheet("Read Me")?.getCell("B6").value), /Courier or Cargo/i);
    assert.equal(workbook.getWorksheet("Shipment")?.getCell("B4").dataValidation.type, "list");
    assert.equal(workbook.getWorksheet("Parcels")?.getCell("F3").dataValidation.type, "list");
    assert.equal(workbook.getWorksheet("Items")?.getCell("D3").dataValidation.type, "list");
  });
});

describe("shipment import parser", () => {
  test("reads one parcel with multiple items and derives no amount from user input", async () => {
    const parsed = await parseShipmentImportWorkbook(await completedWorkbook());
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.csbType, "CSB_V");
    assert.equal(parsed.serviceType, "CARGO");
    assert.equal(parsed.parcels.length, 1);
    assert.equal(parsed.parcels[0]?.items.length, 2);
    assert.equal(parsed.parcels[0]?.items[1]?.unitRate, 200);
  });

  test("maps one item to each of multiple sequential parcels", async () => {
    const parsed = await parseShipmentImportWorkbook(await completedWorkbook({ multipleParcels: true }));
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.parcels.length, 2);
    assert.equal(parsed.parcels[0]?.items[0]?.description, "Cotton trousers");
    assert.equal(parsed.parcels[1]?.items[0]?.description, "Photo frames");
  });

  test("rejects values outside controlled dropdown options", async () => {
    const parsed = await parseShipmentImportWorkbook(await completedWorkbook({ invalidContentType: true }));
    assert.ok(parsed.errors.some((issue) => issue.includes("Random Goods") && issue.includes("not accepted")));
  });

  test("never imports EXAMPLE or CHOOSE ONE placeholders", async () => {
    const parsed = await parseShipmentImportWorkbook(await buildShipmentImportTemplateWorkbook());
    assert.equal(parsed.consignor.contactName, "");
    assert.equal(parsed.consignee.contactName, "");
    assert.ok(parsed.warnings.some((issue) => issue.includes("Consignor Contact Name")));
  });
});
