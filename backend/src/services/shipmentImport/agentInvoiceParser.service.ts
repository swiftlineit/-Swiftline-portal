/**
 * Reads the agent invoice workbook: the hand-typed customs invoice that walk-in
 * agents hand over with a box, as opposed to the Swiftline import template.
 *
 * Nothing here is shared with the template reader. The two formats have nothing
 * in common beyond the shipment they describe, and the template path must keep
 * behaving exactly as it did, so this file is entered only after
 * `shipmentImportParser` has ruled the template out.
 *
 * The invoice is typed by hand, so no value is read from a fixed cell address.
 * Every block is found by its own label (`EXPORTER`, `CONSIGNEE`, `QTY`,
 * `TOTAL`) and the lines inside it are classified by shape. Across the sample
 * set the exporter block varies in length, which shifts every row below it, and
 * labels vary in spelling ("ADHAR"/"AADHAR", "PH."/"PH NO.", "DIM."/"DIM :").
 */
import ExcelJS from "exceljs";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getCities, getStates } from "../reference/geography.service.js";
import { shipmentImportLimits } from "./shipmentImportContract.js";
import type { CsbType } from "../csbType.service.js";
import type { ShipmentContentType, ShipmentServiceType } from "../../models/shipmentDraft.model.js";
import type {
  ParsedShipmentImport,
  ParsedShipmentImportItem,
  ParsedShipmentImportParcel
} from "./shipmentImportParser.service.js";

/**
 * Stamped into `parsedData` so an imported entry can be told apart from a
 * template one later without re-reading the uploaded file.
 */
export const agentInvoiceTemplateVersion = "AGENT-INVOICE-1.0";

// The invoice carries none of these, and the operator confirms them on the
// draft. They are constants rather than guesses read from the sheet.
const invoiceCsbType: CsbType = "CSB_IV";
const invoiceServiceType: ShipmentServiceType = "COURIER";
const invoiceContentType: ShipmentContentType = "PARCEL";
// The sheet's own quantity column is headed "PCS", so the unit follows it
// rather than the model-wide "Pkt" default.
const invoiceUnitType = "Pcs";
const invoiceParcelReference = "SLC";

// Only the United Kingdom is supported. Every sample is UK-bound and the
// address block is split using UK postcode shape, so any other destination is
// refused rather than parsed by a rule that has never been seen to hold.
const supportedDestinationName = "United Kingdom";
const supportedDestinationCode = "GB";
const unitedKingdomAliases = new Set([
  "UK", "UNITEDKINGDOM", "GREATBRITAIN", "GB",
  "ENGLAND", "SCOTLAND", "WALES", "NORTHERNIRELAND"
]);

const ukPostcodePattern = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})\b/i;
const homeNationPattern = /\b(ENGLAND|SCOTLAND|WALES|NORTHERN\s+IRELAND)\b/i;
// The exporter's town line ends "<TOWN> [STATE]- <PIN>".
const indianPinLinePattern = /-\s*([1-9][0-9]{5})\s*$/;
// Spelled "ADHAR", "AADHAR" and "AADHAAR" across the sample set.
const aadhaarLabelPattern = /\bA{1,2}DHA{1,2}R\b/i;
const phoneLabelPattern = /^PH\b/i;
// Anchored for the column-B item grouping marker, unanchored for the header
// cells, where the box number prefixes the weight: "BOX.1,AC WT : 19.900 KG".
const boxMarkerPattern = /^BOX\s*[-.\s]?\s*(\d+)/i;
const boxNumberPattern = /BOX\s*[-.\s]?\s*(\d+)/i;
const weightPattern = /AC\s*WT\s*[:.]?\s*([\d.]+)\s*KG/i;
const dimensionPattern = /DIM\s*[:.]?\s*(\d+(?:\.\d+)?)\s*[*xX]\s*(\d+(?:\.\d+)?)\s*[*xX]\s*(\d+(?:\.\d+)?)/i;
const totalWeightPattern = /TOTAL\s*WT\s*[:.]?\s*([\d.]+)\s*KG/i;

type InvoiceGrid = string[][];

type InvoiceBox = {
  sequence: number;
  weightKg: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
};

type InvoiceItemGroup = {
  sequence: number;
  items: ParsedShipmentImportItem[];
};

export class AgentInvoiceParseError extends Error {
  constructor(readonly issues: string[]) {
    super(issues[0] ?? "The agent invoice could not be read.");
    this.name = "AgentInvoiceParseError";
  }
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
  if (typeof value === "object" && "richText" in value) {
    return (value.richText as Array<{ text: string }>).map((part) => part.text).join("").trim();
  }
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  return String(value).trim();
}

function readGrid(sheet: ExcelJS.Worksheet): InvoiceGrid {
  const grid: InvoiceGrid = [];
  // The invoice occupies columns B..I. `columnCount` can under-report on a
  // sheet whose trailing columns are empty, so the read is floored at I.
  const lastColumn = Math.max(sheet.columnCount, 9);
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const line: string[] = [];
    for (let column = 1; column <= lastColumn; column += 1) {
      line[column] = cellText(sheet.getCell(row, column));
    }
    grid[row] = line;
  }
  return grid;
}

const at = (grid: InvoiceGrid, row: number, column: number) => grid[row]?.[column] ?? "";
const rowText = (grid: InvoiceGrid, row: number) => (grid[row] ?? []).filter(Boolean).join(" ").trim();

/** First row at or after `from` whose column `column` matches. */
function findRowByColumn(grid: InvoiceGrid, column: number, pattern: RegExp, from = 1) {
  for (let row = from; row < grid.length; row += 1) {
    if (pattern.test(at(grid, row, column))) return row;
  }
  return 0;
}

/** First row at or after `from` where any cell matches. */
function findRowAnywhere(grid: InvoiceGrid, pattern: RegExp, from = 1) {
  for (let row = from; row < grid.length; row += 1) {
    if (pattern.test(rowText(grid, row))) return row;
  }
  return 0;
}

/** Non-empty column-B lines of a block, in sheet order. */
function blockLines(grid: InvoiceGrid, startRow: number, endRow: number) {
  const lines: string[] = [];
  for (let row = startRow; row < endRow; row += 1) {
    const value = at(grid, row, 2).trim();
    if (value) lines.push(value);
  }
  return lines;
}

function numeric(value: string) {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function tidy(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

function comparableCountry(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, "");
}

/**
 * State for an Indian town, used when the exporter's address names the town but
 * not the state. Only an unambiguous hit is returned: 99 of the dataset's 4,079
 * Indian town names occur in more than one state, and guessing between them
 * would put a wrong state on a customs document.
 */
let indianStateByCity: Map<string, string | null> | null = null;
function findIndianStateByCity(city: string) {
  const key = city.trim().toLowerCase();
  if (!key) return "";
  if (!indianStateByCity) {
    // Built once. `getCities` reads and caches the whole country file on its
    // first call, so the states loop costs one file read overall.
    indianStateByCity = new Map();
    for (const state of getStates("IN")) {
      for (const name of getCities("IN", state.code)) {
        const cityKey = name.trim().toLowerCase();
        // A second state claiming the same name marks it unusable.
        indianStateByCity.set(cityKey, indianStateByCity.has(cityKey) ? null : state.name);
      }
    }
  }
  return indianStateByCity.get(key) ?? "";
}

function findIndianStateInText(value: string) {
  const upper = value.toUpperCase();
  // Longest first so "Himachal Pradesh" is not shadowed by a shorter name.
  const states = [...getStates("IN")].sort((left, right) => right.name.length - left.name.length);
  return states.find((state) => upper.endsWith(state.name.toUpperCase()))?.name ?? "";
}

type ExporterBlock = {
  name: string;
  addressLines: string[];
  townOrCity: string;
  state: string;
  postcode: string;
  mobileNumber: string;
  aadhaarNumber: string;
};

function readExporterBlock(grid: InvoiceGrid, startRow: number, endRow: number): ExporterBlock {
  const block: ExporterBlock = {
    name: "", addressLines: [], townOrCity: "", state: "",
    postcode: "", mobileNumber: "", aadhaarNumber: ""
  };

  for (const line of blockLines(grid, startRow, endRow)) {
    // Aadhaar is tested before the phone label: "AADHAR NO." also carries "NO.".
    if (aadhaarLabelPattern.test(line)) {
      block.aadhaarNumber = line.replace(/\D/g, "");
      continue;
    }
    if (phoneLabelPattern.test(line)) {
      block.mobileNumber = line.replace(/\D/g, "");
      continue;
    }
    if (!block.name) {
      block.name = tidy(line);
      continue;
    }
    const pin = line.match(indianPinLinePattern);
    if (pin) {
      block.postcode = pin[1] ?? "";
      let head = tidy(line.replace(indianPinLinePattern, ""));
      const state = findIndianStateInText(head);
      if (state) {
        block.state = state;
        head = tidy(head.slice(0, head.length - state.length));
      }
      block.townOrCity = head;
      continue;
    }
    block.addressLines.push(tidy(line));
  }

  // The town line names the state on some invoices and not others; derive it
  // from the town when it was left out.
  if (block.townOrCity && !block.state) block.state = findIndianStateByCity(block.townOrCity);
  return block;
}

type ConsigneeBlock = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  townOrCity: string;
  county: string;
  postcode: string;
  countryText: string;
  mobile: string;
  email: string;
};

function readConsigneeBlock(grid: InvoiceGrid, startRow: number, endRow: number): ConsigneeBlock {
  const block: ConsigneeBlock = {
    name: "", addressLine1: "", addressLine2: "", townOrCity: "",
    county: "", postcode: "", countryText: "", mobile: "", email: ""
  };
  const remaining: string[] = [];

  for (const line of blockLines(grid, startRow, endRow)) {
    if (line.includes("@")) {
      block.email = line.trim();
      continue;
    }
    if (phoneLabelPattern.test(line)) {
      // Written as "PH. + 447782377721"; the country code is already in it.
      block.mobile = `+${line.replace(/\D/g, "")}`;
      continue;
    }
    if (!block.name) {
      block.name = tidy(line);
      continue;
    }
    remaining.push(line);
  }

  // The country sits on a line of its own, usually but not always last.
  const countryIndex = remaining.findIndex((line) => unitedKingdomAliases.has(comparableCountry(line)));
  if (countryIndex >= 0) block.countryText = (remaining.splice(countryIndex, 1)[0] ?? "").trim();

  const postcodeIndex = remaining.findIndex((line) => ukPostcodePattern.test(line));
  const postcodeLine = postcodeIndex >= 0 ? remaining[postcodeIndex] ?? "" : "";
  if (postcodeLine) {
    const match = postcodeLine.match(ukPostcodePattern);
    block.postcode = `${match?.[1] ?? ""} ${match?.[2] ?? ""}`.trim().toUpperCase();
    // Whatever precedes the postcode on that line is the town, sometimes with
    // the county run onto it and a home nation trailing after the postcode.
    const head = tidy(postcodeLine.replace(ukPostcodePattern, "").replace(homeNationPattern, ""));
    const addressLines = remaining.slice(0, postcodeIndex).map(tidy);
    if (addressLines.length > 1) {
      // An extra line before the postcode line is the town, which makes the
      // postcode line's own head the county.
      block.county = head;
      block.townOrCity = addressLines.pop() ?? "";
    } else {
      block.townOrCity = head;
    }
    block.addressLine1 = addressLines.shift() ?? "";
    block.addressLine2 = addressLines.join(", ");
  } else {
    const addressLines = remaining.map(tidy);
    block.addressLine1 = addressLines.shift() ?? "";
    block.addressLine2 = addressLines.join(", ");
  }

  return block;
}

/**
 * Weight and dimensions per box, read from the header cells beside the exporter
 * block. A single-box invoice writes them unlabelled; a multi-box one prefixes
 * each with "BOX.n" and adds a "TOTAL WT" line.
 */
function readBoxes(grid: InvoiceGrid, endRow: number) {
  const boxes = new Map<number, InvoiceBox>();
  let statedTotalWeight: number | null = null;

  for (let row = 1; row < endRow; row += 1) {
    for (const cell of grid[row] ?? []) {
      if (!cell) continue;
      const total = cell.match(totalWeightPattern);
      if (total) {
        statedTotalWeight = numeric(total[1] ?? "");
        continue;
      }
      const weight = cell.match(weightPattern);
      const dimensions = cell.match(dimensionPattern);
      if (!weight && !dimensions) continue;
      // An unlabelled weight belongs to the only box there is.
      const sequence = Number(cell.match(boxNumberPattern)?.[1] ?? 1);
      const box = boxes.get(sequence) ?? {
        sequence, weightKg: 0, lengthCm: null, widthCm: null, heightCm: null
      };
      if (weight) box.weightKg = numeric(weight[1] ?? "");
      if (dimensions) {
        box.lengthCm = numeric(dimensions[1] ?? "") || null;
        box.widthCm = numeric(dimensions[2] ?? "") || null;
        box.heightCm = numeric(dimensions[3] ?? "") || null;
      }
      boxes.set(sequence, box);
    }
  }

  return {
    boxes: [...boxes.values()].sort((left, right) => left.sequence - right.sequence),
    statedTotalWeight
  };
}

/**
 * Item lines, grouped by the "BOX-n" markers in column B. An invoice without
 * markers is a single parcel holding every line.
 */
function readItems(grid: InvoiceGrid, headerRow: number, totalRow: number) {
  const groups: InvoiceItemGroup[] = [];
  let current: InvoiceItemGroup | null = null;

  for (let row = headerRow + 1; row < totalRow; row += 1) {
    const marker = at(grid, row, 2).match(boxMarkerPattern);
    if (marker) {
      current = { sequence: Number(marker[1]), items: [] };
      groups.push(current);
      continue;
    }
    const quantity = numeric(at(grid, row, 7));
    const unitRate = numeric(at(grid, row, 8));
    if (!(quantity > 0) || !(unitRate > 0)) continue;
    // The description sits in column C, but the category heading above the
    // lines sits in D, so the first filled cell from C rightwards is taken.
    // Column B is skipped: on a multi-box invoice it carries the box weight.
    const description = [3, 4, 5, 6].map((column) => at(grid, row, column)).find((value) => value.trim());
    if (!description) continue;
    if (!current) {
      current = { sequence: 1, items: [] };
      groups.push(current);
    }
    current.items.push({
      description: tidy(description).slice(0, 120),
      hsnCode: "",
      unitType: invoiceUnitType,
      quantity,
      unitRate
    });
  }

  return groups;
}

/**
 * True when the workbook looks like an agent invoice. Deliberately loose: a
 * file that carries both labels is treated as this format so its own faults are
 * reported, rather than falling through to "unsupported file".
 */
export function isAgentInvoiceWorkbook(workbook: ExcelJS.Workbook) {
  const sheet = workbook.worksheets[0];
  if (!sheet) return false;
  const grid = readGrid(sheet);
  return Boolean(
    findRowByColumn(grid, 2, /^EXPORTER\b/i) && findRowByColumn(grid, 2, /^CONSIGNEE\b/i)
  );
}

export function parseAgentInvoiceWorkbook(workbook: ExcelJS.Workbook): ParsedShipmentImport {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AgentInvoiceParseError(["The invoice workbook has no worksheet."]);
  const grid = readGrid(sheet);

  const exporterRow = findRowByColumn(grid, 2, /^EXPORTER\b/i);
  const consigneeRow = findRowByColumn(grid, 2, /^CONSIGNEE\b/i);
  if (!exporterRow || !consigneeRow || consigneeRow <= exporterRow) {
    throw new AgentInvoiceParseError([
      "The invoice is missing its EXPORTER or CONSIGNEE block, so no shipment could be read from it."
    ]);
  }

  // The consignee block ends at the column-B "Country Of Origin" label. The
  // matching caption in column E shares a row with the consignee's email, so
  // anchoring on the whole row would drop the last lines of the block.
  const originRow = findRowByColumn(grid, 2, /^Country\s*Of\s*Origin/i, consigneeRow + 1);
  const headerRow = findRowAnywhere(grid, /\bQTY\b/i, consigneeRow + 1);
  if (!headerRow) {
    throw new AgentInvoiceParseError(["The invoice has no item table: its QTY heading was not found."]);
  }
  const totalRow = findRowAnywhere(grid, /\bTOTAL\b/i, headerRow + 1) || grid.length;

  const warnings: string[] = [];
  const errors: string[] = [];

  const exporter = readExporterBlock(grid, exporterRow + 1, consigneeRow);
  const consignee = readConsigneeBlock(grid, consigneeRow + 1, originRow || headerRow);

  // The declaration shares the "Country Of Origin" row, to the right of the
  // country value itself.
  const declarationNote = originRow
    ? tidy([5, 6, 7, 8, 9].map((column) => at(grid, originRow, column)).find((value) => value.trim()) ?? "")
    : "";

  // The consignee block names the destination; the labelled summary line below
  // it is the fallback when that line was left off.
  const destinationRow = findRowByColumn(grid, 2, /^Country\s*of\s*final\s*destination/i, consigneeRow + 1);
  const destinationText = consignee.countryText || (destinationRow ? at(grid, destinationRow, 4) : "");
  if (!unitedKingdomAliases.has(comparableCountry(destinationText))) {
    errors.push(
      destinationText
        ? `Destination "${tidy(destinationText)}" is not supported by the invoice upload. Only United Kingdom shipments can be imported from this format.`
        : "The invoice does not name a destination country. Only United Kingdom shipments can be imported from this format."
    );
  }

  const { boxes, statedTotalWeight } = readBoxes(grid, consigneeRow + 1);
  const groups = readItems(grid, headerRow, totalRow);

  if (!groups.length || groups.every((group) => !group.items.length)) {
    errors.push("No item lines were found on the invoice.");
  }

  // A declared box that no item names, or an item group naming a box that was
  // never declared, means the split between parcels is unknown. Guessing would
  // put goods on the wrong parcel's customs paperwork, so it stops here.
  // Checked whenever either side claims more than one box, so two declared
  // boxes whose items carry no BOX markers is caught as well as the reverse.
  if (Math.max(boxes.length, groups.length) > 1 && boxes.length !== groups.length) {
    errors.push(
      `The invoice declares ${boxes.length} box${boxes.length === 1 ? "" : "es"} but groups its items into ${groups.length}. Correct the BOX headings so the two agree.`
    );
  }

  const sequences = groups.map((group) => group.sequence).sort((left, right) => left - right);
  if (sequences.some((sequence, index) => sequence !== index + 1)) {
    errors.push("The invoice's BOX numbers must run 1, 2, 3... without gaps or repeats.");
  }
  if (groups.length > shipmentImportLimits.parcelsPerShipment) {
    errors.push(`A shipment can contain at most ${shipmentImportLimits.parcelsPerShipment} parcels.`);
  }

  const parcels: ParsedShipmentImportParcel[] = groups.map((group) => {
    const box = boxes.find((candidate) => candidate.sequence === group.sequence)
      ?? (boxes.length === 1 && groups.length === 1 ? boxes[0] : undefined);
    const label = groups.length > 1 ? `Box ${group.sequence}` : "The parcel";
    if (!box?.weightKg) warnings.push(`${label}: no actual weight was found on the invoice.`);
    if (!box?.lengthCm || !box?.widthCm || !box?.heightCm) {
      warnings.push(`${label}: one or more dimensions were not found on the invoice.`);
    }
    if (group.items.length > shipmentImportLimits.itemsPerParcel) {
      errors.push(`${label} holds ${group.items.length} items; at most ${shipmentImportLimits.itemsPerParcel} are allowed.`);
    }
    return {
      sequence: group.sequence,
      weightKg: box?.weightKg ?? 0,
      lengthCm: box?.lengthCm ?? null,
      widthCm: box?.widthCm ?? null,
      heightCm: box?.heightCm ?? null,
      shipmentContentType: invoiceContentType,
      reference: invoiceParcelReference,
      items: group.items
    };
  });

  // Both figures the invoice states about itself are checked against what was
  // read, because a silently dropped line would under-declare the shipment.
  const statedTotalValue = numeric(at(grid, totalRow, 9));
  const readTotalValue = parcels.reduce(
    (total, parcel) => total + parcel.items.reduce((sum, item) => sum + item.quantity * item.unitRate, 0),
    0
  );
  if (statedTotalValue > 0 && Math.abs(statedTotalValue - readTotalValue) >= 0.01) {
    warnings.push(
      `The item lines read from this invoice total ${readTotalValue.toFixed(2)} but the invoice states ${statedTotalValue.toFixed(2)}. An item may be missing or mistyped - check the item list before booking.`
    );
  }
  const readTotalWeight = parcels.reduce((total, parcel) => total + parcel.weightKg, 0);
  if (statedTotalWeight !== null && Math.abs(statedTotalWeight - readTotalWeight) >= 0.001) {
    warnings.push(
      `The box weights read from this invoice total ${readTotalWeight.toFixed(3)} KG but the invoice states ${statedTotalWeight.toFixed(3)} KG.`
    );
  }

  // One line for the whole file. Warning per item would bury every other issue
  // under a dozen copies of the same sentence.
  const itemCount = parcels.reduce((total, parcel) => total + parcel.items.length, 0);
  if (itemCount) {
    warnings.push(`HS codes are not on this invoice: all ${itemCount} item${itemCount === 1 ? "" : "s"} need one before booking.`);
  }
  warnings.push("Consignor email is not on this invoice and is required before booking.");

  if (!exporter.name) warnings.push("Consignor Contact Name was not found on the invoice.");
  if (!exporter.addressLines.length) warnings.push("Pickup Address Line 1 was not found on the invoice.");
  if (!exporter.townOrCity) warnings.push("Pickup Town / City was not found on the invoice.");
  if (!exporter.state) warnings.push("Pickup State was not found on the invoice and could not be derived from the town.");
  if (!exporter.postcode) warnings.push("Pickup PIN Code was not found on the invoice.");
  if (exporter.mobileNumber && !parsePhoneNumberFromString(`+91${exporter.mobileNumber}`)?.isValid()) {
    warnings.push("Consignor Mobile Number read from the invoice is not a valid Indian number.");
  } else if (!exporter.mobileNumber) {
    warnings.push("Consignor Mobile Number was not found on the invoice.");
  }
  if (exporter.aadhaarNumber && exporter.aadhaarNumber.length !== 12) {
    warnings.push("Aadhaar number read from the invoice is not 12 digits.");
  }

  if (!consignee.name) warnings.push("Consignee Contact Name was not found on the invoice.");
  if (!consignee.addressLine1) warnings.push("Delivery Address Line 1 was not found on the invoice.");
  if (!consignee.townOrCity) warnings.push("Delivery Town / City was not found on the invoice.");
  if (!consignee.postcode) warnings.push("Delivery Postcode was not found on the invoice.");
  if (!consignee.email) warnings.push("Consignee Email was not found on the invoice.");

  const phone = consignee.mobile ? parsePhoneNumberFromString(consignee.mobile) : null;
  if (!consignee.mobile) warnings.push("Consignee Mobile was not found on the invoice.");
  else if (!phone?.isValid()) warnings.push("Consignee Mobile read from the invoice is not a valid number.");

  return {
    templateVersion: agentInvoiceTemplateVersion,
    csbType: invoiceCsbType,
    serviceType: invoiceServiceType,
    declarationNote,
    consignor: {
      // The invoice names a person, not a business. Company repeats the name so
      // the customs paperwork and the carrier payload both carry it.
      companyName: exporter.name,
      contactName: exporter.name,
      email: "",
      mobileNumber: exporter.mobileNumber,
      aadhaarNumber: exporter.aadhaarNumber,
      addressLine1: exporter.addressLines[0] ?? "",
      addressLine2: exporter.addressLines.slice(1).join(", "),
      townOrCity: exporter.townOrCity,
      county: exporter.state,
      postcode: exporter.postcode,
      pickupInstructions: ""
    },
    consignee: {
      companyName: consignee.name,
      contactName: consignee.name,
      email: consignee.email,
      mobileCountryCode: phone?.countryCallingCode ? `+${phone.countryCallingCode}` : "",
      mobileNumber: phone?.nationalNumber ?? consignee.mobile.replace(/\D/g, ""),
      countryCode: supportedDestinationCode,
      countryName: supportedDestinationName,
      addressLine1: consignee.addressLine1,
      addressLine2: consignee.addressLine2,
      townOrCity: consignee.townOrCity,
      county: consignee.county,
      postcode: consignee.postcode,
      deliveryInstructions: ""
    },
    parcels,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)]
  };
}
