/**
 * Every exportable table's columns, in one registry.
 *
 * Modelled on `edi/ediColumns.ts`: header, order and source live here and
 * nowhere else, so an export can never disagree with itself across formats and
 * a new column is one entry rather than an edit in four files.
 *
 * These are deliberately wider than the on-screen table. A screen has to fit a
 * viewport and drops columns to do it; a spreadsheet has no such limit, and the
 * reason someone exports is usually the column the table left out.
 */
import type { ExportColumn } from "./tableExport.service.js";

/** A row of the booked-shipments list, as its serializer emits one. */
type ShipmentRow = {
  swiftlineTrackingNumber: string;
  awbNumbers: string[];
  forwardingNumbers: string[];
  shipmentReference: string;
  businessAccountName: string;
  branch: { name: string; code: string; city: string };
  consignor: string;
  consignee: string;
  destination: string;
  destinationCountry: string;
  product: string;
  serviceInfo: string;
  route: string;
  pieces: number;
  weightKg: number;
  statusLabel: string;
  bookingStatusLabel: string;
  lastScan: { statusLabel: string; location: string; at: string | Date } | null;
  shipmentInvoice: { invoiceNumber: string; currency: string; chargeableAmountMinor: number } | null;
  createdAt: string | Date | null;
};

/** Minor units are stored as integers; a spreadsheet wants the real amount. */
function fromMinor(amountMinor: number | null | undefined) {
  return typeof amountMinor === "number" ? amountMinor / 100 : null;
}

function asDate(value: string | Date | null | undefined) {
  return value ? new Date(value) : null;
}

export const shipmentExportColumns: Array<ExportColumn<ShipmentRow>> = [
  { header: "AWB", value: (row) => row.swiftlineTrackingNumber || "", width: 20 },
  { header: "Parcel numbers", value: (row) => row.awbNumbers.join(", "), width: 26 },
  { header: "Carrier numbers", value: (row) => row.forwardingNumbers.join(", "), width: 26 },
  { header: "Customer reference", value: (row) => row.shipmentReference, width: 20 },
  { header: "Account", value: (row) => row.businessAccountName, width: 26 },
  { header: "Branch", value: (row) => (row.branch.code ? `${row.branch.name} (${row.branch.code})` : row.branch.name), width: 24 },
  { header: "Consignor", value: (row) => row.consignor, width: 24 },
  { header: "Consignee", value: (row) => row.consignee, width: 24 },
  { header: "Destination", value: (row) => row.destination, width: 28 },
  { header: "Country", value: (row) => row.destinationCountry, width: 16 },
  { header: "Route", value: (row) => row.route, width: 26 },
  { header: "Service", value: (row) => row.serviceInfo, width: 12 },
  { header: "Contents", value: (row) => row.product, width: 22 },
  { header: "Pieces", value: (row) => row.pieces, width: 8 },
  { header: "Weight (kg)", value: (row) => row.weightKg, width: 12 },
  { header: "Status", value: (row) => row.statusLabel, width: 18 },
  { header: "Booking status", value: (row) => row.bookingStatusLabel, width: 18 },
  { header: "Last scan", value: (row) => row.lastScan?.statusLabel ?? "", width: 18 },
  { header: "Last scan location", value: (row) => row.lastScan?.location ?? "", width: 20 },
  { header: "Last scan at", value: (row) => asDate(row.lastScan?.at ?? null), width: 20 },
  { header: "Invoice", value: (row) => row.shipmentInvoice?.invoiceNumber ?? "", width: 18 },
  { header: "Invoice amount", value: (row) => fromMinor(row.shipmentInvoice?.chargeableAmountMinor), width: 16 },
  { header: "Booked", value: (row) => asDate(row.createdAt), width: 20 }
];
