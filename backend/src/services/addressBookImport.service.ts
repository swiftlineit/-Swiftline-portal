import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import {
  addressBookInputSchema,
  normalizeImportedCountry,
  type AddressBookInput
} from "./addressBook.service.js";

export const addressBookImportHeaders = [
  "Type",
  "Label",
  "Favourite",
  "Company Name",
  "Contact Name",
  "Email",
  "Mobile Country Code",
  "Mobile Number",
  "Country",
  "Address Line 1",
  "Address Line 2",
  "Town / City",
  "State / County",
  "Postal Code",
  "Instructions"
] as const;

export const addressBookImportLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 500
} as const;

export type AddressBookImportPreviewRow = {
  rowNumber: number;
  data: AddressBookInput | null;
  errors: string[];
};

function cellText(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value && value.result !== undefined) return String(value.result).trim();
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
  }
  return String(value).trim();
}

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function friendlyIssues(error: import("zod").ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`);
}

function parseBoolean(value: string) {
  return ["yes", "true", "1", "y"].includes(value.trim().toLowerCase());
}

function parseType(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "SENDER" || normalized === "CONSIGNOR") return "SENDER";
  if (normalized === "RECIPIENT" || normalized === "CONSIGNEE") return "RECIPIENT";
  return normalized;
}

async function loadWorksheet(contents: Buffer, extension: ".csv" | ".xlsx") {
  const workbook = new ExcelJS.Workbook();
  if (extension === ".csv") {
    await workbook.csv.read(Readable.from(contents));
  } else {
    await workbook.xlsx.load(contents as unknown as ArrayBuffer);
  }
  return workbook.getWorksheet("Addresses") ?? workbook.worksheets[0] ?? null;
}

export async function parseAddressBookImport(contents: Buffer, extension: ".csv" | ".xlsx") {
  const worksheet = await loadWorksheet(contents, extension);
  if (!worksheet) return { rows: [] as AddressBookImportPreviewRow[], errors: ["The file does not contain a worksheet."] };

  const headerIndexes = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, column) => {
    headerIndexes.set(normalizedHeader(cellText(cell.value)), column);
  });
  const missingHeaders = addressBookImportHeaders.filter((header) => !headerIndexes.has(normalizedHeader(header)));
  if (missingHeaders.length) {
    return {
      rows: [] as AddressBookImportPreviewRow[],
      errors: [`Missing required columns: ${missingHeaders.join(", ")}. Download and use the Swiftline template.`]
    };
  }

  const rows: AddressBookImportPreviewRow[] = [];
  const lastRow = Math.min(worksheet.rowCount, addressBookImportLimits.maxRows + 1);
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const read = (header: typeof addressBookImportHeaders[number]) => {
      const column = headerIndexes.get(normalizedHeader(header));
      return column ? cellText(row.getCell(column).value) : "";
    };
    if (addressBookImportHeaders.every((header) => !read(header))) continue;

    const country = normalizeImportedCountry(read("Country"));
    const candidate = {
      type: parseType(read("Type")),
      label: read("Label"),
      isFavourite: parseBoolean(read("Favourite")),
      companyName: read("Company Name"),
      contactName: read("Contact Name"),
      email: read("Email"),
      mobileCountryCode: read("Mobile Country Code"),
      mobileNumber: read("Mobile Number"),
      countryCode: country?.countryCode ?? "",
      countryName: country?.countryName ?? read("Country"),
      addressLine1: read("Address Line 1"),
      addressLine2: read("Address Line 2"),
      townOrCity: read("Town / City"),
      county: read("State / County"),
      postcode: read("Postal Code"),
      instructions: read("Instructions"),
      providerPlaceId: ""
    };
    const parsed = addressBookInputSchema.safeParse(candidate);
    rows.push(parsed.success
      ? { rowNumber, data: parsed.data, errors: [] }
      : { rowNumber, data: null, errors: friendlyIssues(parsed.error) });
  }

  const errors = worksheet.rowCount > addressBookImportLimits.maxRows + 1
    ? [`Only the first ${addressBookImportLimits.maxRows} address rows were read.`]
    : [];
  return { rows, errors };
}

export async function buildAddressBookTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Swiftline Cargo and Express Logistics";
  const instructions = workbook.addWorksheet("Read Me");
  instructions.addRows([
    ["Swiftline Address Book Import"],
    ["Use one row per saved address. Sender addresses must be in India."],
    ["Type accepts Sender or Recipient. Favourite accepts Yes or No."],
    ["Do not include Aadhaar numbers, KYC documents or payment data."]
  ]);
  instructions.getColumn(1).width = 95;
  instructions.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF0D1282" } };

  const sheet = workbook.addWorksheet("Addresses", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...addressBookImportHeaders]);
  sheet.addRow([
    "Recipient", "London Office", "Yes", "EXAMPLE LTD", "JANE SMITH", "jane@example.com",
    "+44", "7911123456", "United Kingdom", "14 MARVELL AVENUE", "", "LONDON",
    "GREATER LONDON", "UB4 0QR", "DELIVER AT RECEPTION"
  ]);
  sheet.columns = addressBookImportHeaders.map((header) => ({ header, key: normalizedHeader(header), width: Math.max(16, header.length + 3) }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D1282" } };
  sheet.autoFilter = { from: "A1", to: `O${Math.max(sheet.rowCount, 2)}` };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildAddressBookTemplateCsv() {
  const example = [
    "Recipient", "London Office", "Yes", "EXAMPLE LTD", "JANE SMITH", "jane@example.com",
    "+44", "7911123456", "United Kingdom", "14 MARVELL AVENUE", "", "LONDON",
    "GREATER LONDON", "UB4 0QR", "DELIVER AT RECEPTION"
  ];
  return Buffer.from([
    addressBookImportHeaders.map(csvCell).join(","),
    example.map(csvCell).join(",")
  ].join("\r\n"), "utf8");
}
