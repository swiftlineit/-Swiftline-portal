import type { IInvoiceUpload } from "../models/invoiceUpload.model.js";

type ShipmentSourceIdentity = Pick<
  IInvoiceUpload,
  "templateVersion" | "extractedData" | "invoiceNumber" | "shipmentReference"
>;

/**
 * Manual and walk-in drafts use an InvoiceUpload-shaped record only to keep the
 * existing shipment chain linked. Its generated values are internal source IDs,
 * not customer invoice or shipment references.
 */
export function isSyntheticShipmentSource(source: ShipmentSourceIdentity | null | undefined) {
  if (!source) return false;
  const creationSource = typeof source.extractedData?.creationSource === "string"
    ? source.extractedData.creationSource.trim().toUpperCase()
    : "";
  const templateVersion = source.templateVersion.trim().toUpperCase();

  return creationSource === "MANUAL"
    || creationSource === "INDIVIDUAL"
    || templateVersion === "MANUAL-1.0"
    || templateVersion === "INDIVIDUAL-1.0";
}

export function publicShipmentSourceIdentity(source: ShipmentSourceIdentity | null | undefined) {
  const synthetic = isSyntheticShipmentSource(source);
  return {
    invoiceNumber: synthetic ? "" : source?.invoiceNumber?.trim() ?? "",
    shipmentReference: synthetic ? "" : source?.shipmentReference?.trim() ?? ""
  };
}
