import mongoose from "mongoose";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { InvoiceUpload } from "../models/invoiceUpload.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { ShipmentManifest } from "../models/shipmentManifest.model.js";
import { normalizeCsbType } from "./csbType.service.js";
import { readShipmentBookingSnapshot } from "./shipmentBookingSnapshot.service.js";

export type ShipmentListingFilter = {
  businessAccountIds?: mongoose.Types.ObjectId[];
  branchIds?: mongoose.Types.ObjectId[];
  status?: string;
  date?: string;
  page: number;
  limit: number;
  /** Manifest assignments are per actor role, so eligibility is role-scoped. */
  actorRole: "admin" | "client";
};

export function formatShipmentStatusLabel(value?: string | null) {
  if (!value) return "Shipment Booked";
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function joinPlace(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))].join(", ");
}

/**
 * The booked shipments a Shipments page shows. "Booked" means the carrier
 * returned labels, which is also the point a shipment becomes manifestable.
 */
export async function listBookedShipments(filter: ShipmentListingFilter) {
  const draftFilter: Record<string, unknown> = {};
  if (filter.businessAccountIds) draftFilter.businessAccountId = { $in: filter.businessAccountIds };
  if (filter.branchIds) draftFilter.branchId = { $in: filter.branchIds };
  if (filter.date) {
    const selectedDate = new Date(filter.date);
    if (!Number.isNaN(selectedDate.getTime())) {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      draftFilter.createdAt = { $gte: start, $lt: end };
    }
  }

  const bookedDraftIds = await DpdShipment.find({ status: "LABEL_RECEIVED" })
    .select("shipmentDraftId")
    .lean()
    .exec();
  const candidateFilter = { ...draftFilter, _id: { $in: bookedDraftIds.map((item) => item.shipmentDraftId) } };

  // The listed status is the newest customer-visible event, so filtering by
  // status means keeping drafts whose newest event matches.
  let matchingIds: mongoose.Types.ObjectId[] | null = null;
  if (filter.status) {
    const candidates = await ShipmentDraft.find(candidateFilter).select("_id").lean().exec();
    const latest = await ShipmentEvent.aggregate<{ _id: mongoose.Types.ObjectId; status: string }>([
      { $match: { shipmentDraftId: { $in: candidates.map((draft) => draft._id) }, customerVisible: true } },
      { $sort: { eventAt: -1, createdAt: -1 } },
      { $group: { _id: "$shipmentDraftId", status: { $first: "$status" } } },
      { $match: { status: filter.status } }
    ]).exec();
    matchingIds = latest.map((item) => item._id);
  }

  const query = matchingIds ? { ...candidateFilter, _id: { $in: matchingIds } } : candidateFilter;
  const total = await ShipmentDraft.countDocuments(query).exec();
  const totalPages = Math.max(1, Math.ceil(total / filter.limit));
  const page = Math.min(Math.max(1, filter.page), totalPages);
  const drafts = await ShipmentDraft.find(query)
    .sort({ updatedAt: -1, _id: -1 })
    .skip((page - 1) * filter.limit)
    .limit(filter.limit)
    .lean()
    .exec();

  const draftIds = drafts.map((draft) => draft._id);
  const [bookings, events, branches, accounts, uploads, manifests, invoices] = await Promise.all([
    DpdShipment.find({ shipmentDraftId: { $in: draftIds } }).lean().exec(),
    ShipmentEvent.find({ shipmentDraftId: { $in: draftIds }, customerVisible: true })
      .sort({ eventAt: -1, createdAt: -1 })
      .select("shipmentDraftId status eventAt")
      .lean()
      .exec(),
    Branch.find({ _id: { $in: drafts.map((draft) => draft.branchId) } }).select("name code address").lean().exec(),
    BusinessAccount.find({ _id: { $in: drafts.map((draft) => draft.businessAccountId) } })
      .select("accountId company.companyName")
      .lean()
      .exec(),
    InvoiceUpload.find({ _id: { $in: drafts.map((draft) => draft.invoiceUploadId) } })
      .select("invoiceNumber shipmentReference")
      .lean()
      .exec(),
    ShipmentManifest.find({ shipmentDraftIds: { $in: draftIds }, actorRole: filter.actorRole })
      .select("manifestNumber shipmentDraftIds")
      .lean()
      .exec(),
    ShipmentInvoice.find({ shipmentDraftId: { $in: draftIds } })
      .select("shipmentDraftId invoiceNumber currency totalAmountMinor status revision")
      .lean()
      .exec()
  ]);

  const bookingByDraft = new Map(bookings.map((booking) => [String(booking.shipmentDraftId), booking]));
  const branchById = new Map(branches.map((branch) => [String(branch._id), branch]));
  const accountById = new Map(accounts.map((account) => [String(account._id), account]));
  const uploadById = new Map(uploads.map((upload) => [String(upload._id), upload]));
  const invoiceByDraft = new Map(invoices.map((invoice) => [String(invoice.shipmentDraftId), invoice]));
  const currentEventByDraft = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const key = String(event.shipmentDraftId);
    if (!currentEventByDraft.has(key)) currentEventByDraft.set(key, event);
  }
  const manifestByDraft = new Map<string, (typeof manifests)[number]>();
  for (const manifest of manifests) {
    for (const draftId of manifest.shipmentDraftIds) manifestByDraft.set(String(draftId), manifest);
  }
  // A cancelled shipment keeps its label, so cancellation is what makes it
  // unmanifestable rather than the carrier status.
  const cancelledDraftIds = new Set(events
    .filter((event) => event.status === "SHIPMENT_CANCELLED")
    .map((event) => String(event.shipmentDraftId)));

  const shipments = drafts.map((draft) => {
    const draftId = String(draft._id);
    const booking = bookingByDraft.get(draftId);
    const snapshot = booking
      ? readShipmentBookingSnapshot(booking.currentShipmentSnapshot) ?? readShipmentBookingSnapshot(booking.bookingSnapshot)
      : null;
    const branch = branchById.get(String(draft.branchId));
    const account = accountById.get(String(draft.businessAccountId));
    const upload = uploadById.get(String(draft.invoiceUploadId));
    const currentEvent = currentEventByDraft.get(draftId);
    const manifest = manifestByDraft.get(draftId);
    const consignee = draft.consigneeValidatedAddress ?? draft.consigneeEnteredAddress;
    const parcels = snapshot?.parcels ?? [];

    return {
      id: draftId,
      businessAccountId: String(draft.businessAccountId),
      businessAccountName: account?.company?.companyName ?? "",
      businessAccountCode: account?.accountId ?? "",
      branchId: String(draft.branchId),
      branch: {
        name: branch?.name ?? "",
        code: branch?.code ?? "",
        city: branch?.address?.city ?? ""
      },
      shipmentReference: upload?.shipmentReference ?? "",
      invoiceNumber: upload?.invoiceNumber ?? "",
      swiftlineTrackingNumber: booking?.swiftlineTrackingNumber ?? "",
      awbNumbers: parcels.map((parcel) => parcel.swiftlineParcelNumber).filter(Boolean),
      forwardingNumbers: parcels.map((parcel) => parcel.carrierParcelNumber).filter(Boolean),
      consignor: snapshot?.consignor?.companyName || snapshot?.consignor?.contactName || account?.company?.companyName || "",
      consignee: consignee?.companyName || consignee?.contactName || "",
      destination: joinPlace([consignee?.townOrCity, consignee?.countryName || consignee?.countryCode]),
      destinationCountry: consignee?.countryName || consignee?.countryCode || "",
      product: [...new Set(draft.parcelList.map((parcel) => parcel.shipmentContentType).filter(Boolean))].join(", "),
      // The Swiftline service the customer bought, as the manifest shows it.
      serviceInfo: draft.serviceType,
      // Customs route, shown under the shipment reference in the list.
      csbType: normalizeCsbType(draft.csbType),
      route: `${branch?.address?.city || branch?.name || "Origin Not Set"} to `
        + `${consignee?.townOrCity || consignee?.postcode || "Destination Not Set"}`,
      shipmentInvoice: (() => {
        const invoice = invoiceByDraft.get(draftId);
        return invoice ? {
          invoiceNumber: invoice.invoiceNumber,
          currency: invoice.currency,
          chargeableAmountMinor: invoice.totalAmountMinor,
          status: invoice.status,
          revision: invoice.revision
        } : null;
      })(),
      pieces: parcels.length || draft.parcelList.length,
      weightKg: Number((parcels.length
        ? parcels.reduce((sum, parcel) => sum + parcel.actualWeightKg, 0)
        : draft.parcelList.reduce((sum, parcel) => sum + (parcel.weightKg || 0), 0)).toFixed(3)),
      status: currentEvent?.status ?? "SHIPMENT_BOOKED",
      statusLabel: formatShipmentStatusLabel(currentEvent?.status),
      manifest: manifest ? { id: String(manifest._id), manifestNumber: manifest.manifestNumber } : null,
      manifestEligible: !manifest && Boolean(snapshot) && cancelledDraftIds.has(draftId) === false,
      createdAt: draft.createdAt ?? null,
      updatedAt: draft.updatedAt ?? null
    };
  });

  return { shipments, pagination: { page, limit: filter.limit, total, totalPages } };
}
