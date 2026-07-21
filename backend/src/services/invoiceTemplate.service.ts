import XLSX from "xlsx";

export const dpdInvoiceTemplateVersion = "DPD-LABEL-1.0";
export const dpdInvoiceWorksheetName = "Shipment";
export const maxDpdInvoiceParcels = 10;

export interface InvoiceTemplateField {
  section: string;
  field: string;
  required: boolean;
  example: string | number;
  notes: string;
}

export const dpdInvoiceTemplateFields: InvoiceTemplateField[] = [
  { section: "Invoice metadata", field: "Template Version", required: true, example: dpdInvoiceTemplateVersion, notes: "Do not change this value." },
  { section: "Invoice metadata", field: "Invoice Number", required: true, example: "INV-10001", notes: "Customer invoice number." },
  { section: "Invoice metadata", field: "Invoice Date", required: false, example: "2026-07-10", notes: "YYYY-MM-DD." },
  { section: "Invoice metadata", field: "Shipment Reference", required: true, example: "SHIP-10001", notes: "Unique shipment reference." },
  { section: "Invoice metadata", field: "Business Account Code", required: true, example: "BA-2026-100001", notes: "Swiftline business account code." },
  { section: "Invoice metadata", field: "Branch Code", required: true, example: "LON-01", notes: "Swiftline branch code." },
  { section: "Consignee", field: "Consignee Type", required: false, example: "Business", notes: "Business or Individual." },
  { section: "Consignee", field: "Company Name", required: false, example: "Example Retail Ltd", notes: "Required for business deliveries when applicable." },
  { section: "Consignee", field: "Contact Person", required: true, example: "Asha Patel", notes: "Recipient contact name." },
  { section: "Consignee", field: "Email", required: false, example: "asha@example.co.uk", notes: "Recipient email." },
  { section: "Consignee", field: "Mobile Country Code", required: true, example: "+44", notes: "Use international dialing code." },
  { section: "Consignee", field: "Mobile Number", required: true, example: "7123456789", notes: "Digits only where possible." },
  { section: "Consignee", field: "Country", required: true, example: "United Kingdom", notes: "V1 supports UK consignee addresses." },
  { section: "Consignee", field: "Postcode", required: true, example: "SW1A 1AA", notes: "UK postcode." },
  { section: "Consignee", field: "Address Line 1", required: true, example: "10 Downing Street", notes: "Premise and street." },
  { section: "Consignee", field: "Address Line 2", required: false, example: "", notes: "Flat, unit, building, or locality." },
  { section: "Consignee", field: "Town / City", required: true, example: "London", notes: "Use postal town for UK addresses." },
  { section: "Consignee", field: "County", required: false, example: "Greater London", notes: "Optional county." },
  { section: "Consignee", field: "Delivery Instructions", required: false, example: "Leave with reception", notes: "Optional delivery note." },
  { section: "Parcel", field: "Number of Parcels (PCS)", required: false, example: 1, notes: "Defaults to 1. Increase only when extra parcel rows are completed below." },
  { section: "Parcel", field: "Parcel Weight", required: true, example: 1.5, notes: "Kilograms." },
  { section: "Parcel", field: "Length", required: false, example: 30, notes: "Centimetres." },
  { section: "Parcel", field: "Width", required: false, example: 20, notes: "Centimetres." },
  { section: "Parcel", field: "Height", required: false, example: 10, notes: "Centimetres." },
  { section: "Parcel", field: "Shipment Content Type", required: false, example: "Parcel", notes: "Documents, Parcel, Merchandise, Samples, Gifts, Returns, or Other. Defaults to Parcel." },
  { section: "Parcel", field: "Contents Description", required: true, example: "Clothing", notes: "Plain description of goods." },
  { section: "Parcel", field: "Shipment Reference 1", required: false, example: "ORDER-10001", notes: "Optional DPD/customer reference." },
  { section: "Parcel", field: "Shipment Reference 2", required: false, example: "", notes: "Optional DPD/customer reference." },
  { section: "Optional", field: "Customer Order Number", required: false, example: "ORDER-10001", notes: "Stored internally only." },
  { section: "Optional", field: "Purchase Order Number", required: false, example: "PO-10001", notes: "Stored internally only." },
  { section: "Optional", field: "Department", required: false, example: "Ecommerce", notes: "Stored internally only." },
  { section: "Optional", field: "Internal Notes", required: false, example: "", notes: "Stored internally only." }
].flatMap((field) => {
  if (field.field !== "Shipment Reference 2") return [field];

  const extraParcelFields: InvoiceTemplateField[] = [];
  for (let sequence = 2; sequence <= maxDpdInvoiceParcels; sequence += 1) {
    extraParcelFields.push(
      { section: `Parcel ${sequence}`, field: `Parcel ${sequence} Weight`, required: false, example: "", notes: "Kilograms. Complete this when PCS includes this parcel." },
      { section: `Parcel ${sequence}`, field: `Parcel ${sequence} Length`, required: false, example: "", notes: "Centimetres." },
      { section: `Parcel ${sequence}`, field: `Parcel ${sequence} Width`, required: false, example: "", notes: "Centimetres." },
      { section: `Parcel ${sequence}`, field: `Parcel ${sequence} Height`, required: false, example: "", notes: "Centimetres." },
      { section: `Parcel ${sequence}`, field: `Parcel ${sequence} Shipment Content Type`, required: false, example: "", notes: "Documents, Parcel, Merchandise, Samples, Gifts, Returns, or Other. Defaults to Parcel." },
      { section: `Parcel ${sequence}`, field: `Parcel ${sequence} Contents Description`, required: false, example: "", notes: "Plain description of goods." },
      { section: `Parcel ${sequence}`, field: `Parcel ${sequence} Reference`, required: false, example: "", notes: "Optional parcel reference." }
    );
  }

  return [field, ...extraParcelFields];
});

export function buildDpdInvoiceTemplateBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  const shipmentRows = [
    ["Section", "Field", "Value", "Required", "Notes"],
    ...dpdInvoiceTemplateFields.map((field) => [
      field.section,
      field.field,
      field.example,
      field.required ? "Yes" : "No",
      field.notes
    ])
  ];
  const instructionsRows = [
    ["Swiftline DPD invoice template"],
    ["Use only the Shipment worksheet for upload values."],
    ["Do not include DPD credentials in this invoice."],
    [`PCS defaults to 1. Extra parcel rows are supported up to ${maxDpdInvoiceParcels}.`]
  ];

  const shipmentSheet = XLSX.utils.aoa_to_sheet(shipmentRows);
  shipmentSheet["!cols"] = [
    { wch: 22 },
    { wch: 28 },
    { wch: 32 },
    { wch: 12 },
    { wch: 54 }
  ];

  XLSX.utils.book_append_sheet(workbook, shipmentSheet, dpdInvoiceWorksheetName);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructionsRows), "Instructions");

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}
