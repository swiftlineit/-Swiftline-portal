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

/** A row of the support ticket list, as `serializeSupportTicket` emits one. */
type TicketRow = {
  ticketNumber: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  account: { companyName: string; accountId: string } | null;
  branch: { name: string; code: string } | null;
  creator: { name: string; email: string } | null;
  assignee: { name: string } | null;
  relatedShipment: { awb: string } | null;
  sla: { firstResponseDueAt: string | Date; firstRespondedAt: string | Date | null; breached: boolean } | null;
  lastMessageAt: string | Date;
  resolvedAt: string | Date | null;
  closedAt: string | Date | null;
  createdAt: string | Date;
};

/** Stored enum values read as SCREAMING_SNAKE; a reader wants words. */
function words(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const ticketExportColumns: Array<ExportColumn<TicketRow>> = [
  { header: "Ticket", value: (row) => row.ticketNumber, width: 20 },
  { header: "Subject", value: (row) => row.subject, width: 34 },
  { header: "Category", value: (row) => words(row.category), width: 20 },
  { header: "Priority", value: (row) => words(row.priority), width: 12 },
  { header: "Status", value: (row) => words(row.status), width: 20 },
  { header: "Account", value: (row) => row.account ? `${row.account.companyName} (${row.account.accountId})` : "", width: 28 },
  { header: "Branch", value: (row) => row.branch ? `${row.branch.name} (${row.branch.code})` : "", width: 22 },
  { header: "Raised by", value: (row) => row.creator?.name ?? "", width: 22 },
  { header: "Raised by email", value: (row) => row.creator?.email ?? "", width: 26 },
  { header: "Assigned to", value: (row) => row.assignee?.name ?? "Unassigned", width: 22 },
  { header: "AWB", value: (row) => row.relatedShipment?.awb ?? "", width: 20 },
  { header: "First response due", value: (row) => asDate(row.sla?.firstResponseDueAt ?? null), width: 20 },
  { header: "First responded", value: (row) => asDate(row.sla?.firstRespondedAt ?? null), width: 20 },
  // Plain words rather than TRUE/FALSE: this column is read, not computed on.
  { header: "SLA", value: (row) => row.sla ? (row.sla.breached ? "Exceeded" : "Met") : "", width: 12 },
  { header: "Raised", value: (row) => asDate(row.createdAt), width: 20 },
  { header: "Last message", value: (row) => asDate(row.lastMessageAt), width: 20 },
  { header: "Resolved", value: (row) => asDate(row.resolvedAt), width: 20 },
  { header: "Closed", value: (row) => asDate(row.closedAt), width: 20 }
];
