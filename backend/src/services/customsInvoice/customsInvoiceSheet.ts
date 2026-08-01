// Field names on the workbook's "Shipment Data" sheet — the import side of the
// customs invoice. Shared by the writer (customsInvoiceWorkbook.service.ts) and
// the reader (customsInvoiceParser.service.ts) so the two can never disagree.
//
// Consignee, boxes and items are NOT here: they are read back off the printed
// "Invoice" sheet, so the same values can't be stated twice and contradict.

export const shipmentDataSheetName = "Shipment Data";
export const customsInvoiceSheetName = "Invoice";
export const shipmentDataTemplateVersion = "SWIFTLINE-SHIPMENT-1.0";

export const shipmentDataFields = {
  templateVersion: "Template Version",
  shipmentType: "Shipment Type",
  serviceType: "Service Type",
  consignorContactName: "Consignor Contact Name",
  consignorCompanyName: "Consignor Company Name",
  consignorEmail: "Consignor Email",
  consignorMobileNumber: "Consignor Mobile Number",
  consignorAddressLine1: "Consignor Address Line 1",
  consignorAddressLine2: "Consignor Address Line 2",
  consignorTownOrCity: "Consignor Town / City",
  consignorState: "Consignor State",
  consignorPinCode: "Consignor PIN Code",
  consignorAadhaarNumber: "Consignor Aadhaar Number",
  declarationNote: "Declaration Note"
} as const;

export type ShipmentDataFieldKey = keyof typeof shipmentDataFields;

/** Guidance printed beside each field so the sheet is self-explanatory. */
export const shipmentDataFieldNotes: Record<ShipmentDataFieldKey, string> = {
  templateVersion: "Do not change this value.",
  shipmentType: "CSB-IV or CSB-V. CSB-V adds a flat clearance charge plus GST.",
  serviceType: "Courier or Cargo.",
  consignorContactName: "Sender's contact name.",
  consignorCompanyName: "Sender's company name, if any.",
  consignorEmail: "Sender's email address.",
  consignorMobileNumber: "Indian mobile number, digits only.",
  consignorAddressLine1: "Premise and street.",
  consignorAddressLine2: "Flat, unit, building or locality.",
  consignorTownOrCity: "Sender's town or city.",
  consignorState: "Sender's state.",
  consignorPinCode: "6 digit Indian PIN code.",
  consignorAadhaarNumber: "12 digit Aadhaar number. The Aadhaar card itself is uploaded on the shipment form.",
  declarationNote: "Optional note printed on the shipment invoice."
};
