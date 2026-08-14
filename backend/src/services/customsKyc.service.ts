/**
 * Customs and compliance, account level and shipment level together.
 *
 * These were two separate stories the customer had to assemble themselves:
 * account KYC lived in the account screens, shipment customs paperwork lived
 * inside each shipment, and "what is stopping my goods" had no single answer.
 *
 * Both halves are here because both can block a shipment. Account KYC that
 * lapses stops future bookings; a customs query on a shipment already flying
 * stops that one. A page showing only the first would tell a customer
 * everything is fine while a parcel sits held at the border.
 */
import mongoose from "mongoose";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import {
  ShipmentSupportingDocument,
  shipmentSupportingDocumentLabels,
  type ShipmentSupportingDocumentType
} from "../models/shipmentSupportingDocument.model.js";
import { normalizeCsbType } from "./csbType.service.js";
import { formatShipmentStatusLabel } from "./shipmentListing.service.js";

/** What a customs-cleared shipment is expected to carry. */
const expectedCustomsDocuments: ShipmentSupportingDocumentType[] = [
  "COMMERCIAL_INVOICE",
  "PACKING_LIST"
];

export type CustomsKycOverview = {
  account: {
    businessAccountId: string;
    companyName: string;
    accountId: string;
    kycStatus: string;
    kycStatusLabel: string;
    /** Per-document verification, so a customer sees which one is outstanding. */
    checks: Array<{ key: string; label: string; status: string }>;
    gstin: string;
    gstExempt: boolean;
  } | null;
  /** Shipments needing paperwork or held by customs, most urgent first. */
  shipments: Array<{
    shipmentDraftId: string;
    awb: string;
    consignee: string;
    destination: string;
    csbType: string;
    statusLabel: string;
    /** Set when the shipment is held and customs is the reason. */
    clearanceQuery: string;
    missingDocuments: string[];
    uploadedDocuments: string[];
  }>;
  summary: {
    shipmentsNeedingDocuments: number;
    shipmentsHeldAtCustoms: number;
  };
};

const kycCheckLabels: Record<string, string> = {
  contactDetails: "Contact details",
  companyDetails: "Company details",
  gstExemption: "GST exemption",
  aadhaarCard: "Aadhaar card",
  panCard: "PAN card",
  adCertificate: "AD code certificate",
  msmeCertificate: "MSME certificate",
  tanCertificate: "TAN certificate",
  otherCertificate: "Other certificate",
  gstCertificate: "GST certificate",
  iecCertificate: "IEC certificate"
};

function label(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Customs-related hold reasons.
 *
 * `payment_issue` and the rest are real holds but not customs ones, and listing
 * them here would tell a customer to send paperwork that would not release
 * anything.
 */
const customsHoldReasons = new Set(["missing_documents", "customs_query", "restricted_item_check"]);

export async function buildCustomsKycOverview(input: {
  businessAccountId: mongoose.Types.ObjectId;
  branchIds?: mongoose.Types.ObjectId[];
}): Promise<CustomsKycOverview> {
  const account = await BusinessAccount.findById(input.businessAccountId)
    .select("accountId company.companyName company.gstin company.gstExempt kycReview")
    .lean()
    .exec();

  const drafts = await ShipmentDraft.find({
    businessAccountId: input.businessAccountId,
    ...(input.branchIds?.length ? { branchId: { $in: input.branchIds } } : {}),
    bookingState: "BOOKED",
    deletedAt: null
  })
    .select("consigneeEnteredAddress csbType")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean()
    .exec();

  const draftIds = drafts.map((draft) => draft._id);
  const [bookings, documents, events] = await Promise.all([
    DpdShipment.find({ shipmentDraftId: { $in: draftIds } })
      .select("shipmentDraftId swiftlineTrackingNumber")
      .lean()
      .exec(),
    ShipmentSupportingDocument.find({ shipmentDraftId: { $in: draftIds }, deletedAt: null })
      .select("shipmentDraftId documentType")
      .lean()
      .exec(),
    ShipmentEvent.find({ shipmentDraftId: { $in: draftIds } })
      .sort({ eventAt: -1, createdAt: -1 })
      .select("shipmentDraftId status holdReason note eventAt")
      .lean()
      .exec()
  ]);

  const awbByDraft = new Map(bookings.map((booking) => [String(booking.shipmentDraftId), booking.swiftlineTrackingNumber ?? ""]));
  const documentsByDraft = new Map<string, Set<string>>();
  for (const document of documents) {
    const key = String(document.shipmentDraftId);
    documentsByDraft.set(key, (documentsByDraft.get(key) ?? new Set()).add(document.documentType));
  }
  const currentEventByDraft = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const key = String(event.shipmentDraftId);
    if (!currentEventByDraft.has(key)) currentEventByDraft.set(key, event);
  }

  const shipments = drafts.map((draft) => {
    const draftId = String(draft._id);
    const held = currentEventByDraft.get(draftId);
    const uploaded = documentsByDraft.get(draftId) ?? new Set<string>();
    const consignee = draft.consigneeEnteredAddress;

    // CSB-V is the customs-cleared route, so it is the one that must carry
    // the paperwork; CSB-IV shipments are not chased for it.
    const csbType = normalizeCsbType(draft.csbType);
    const missing = csbType === "CSB_V"
      ? expectedCustomsDocuments.filter((type) => !uploaded.has(type))
      : [];

    const isCustomsHold = held?.status === "ON_HOLD" && customsHoldReasons.has(String(held.holdReason ?? ""));

    return {
      shipmentDraftId: draftId,
      awb: awbByDraft.get(draftId) ?? "",
      consignee: consignee?.companyName || consignee?.contactName || "",
      destination: [consignee?.townOrCity, consignee?.countryName || consignee?.countryCode]
        .filter(Boolean).join(", "),
      csbType,
      statusLabel: formatShipmentStatusLabel(held?.status),
      clearanceQuery: isCustomsHold
        ? held?.note?.trim() || label(String(held?.holdReason ?? ""))
        : "",
      missingDocuments: missing.map((type) => shipmentSupportingDocumentLabels[type]),
      uploadedDocuments: [...uploaded].map((type) => shipmentSupportingDocumentLabels[type as ShipmentSupportingDocumentType] ?? label(type))
    };
  })
    // Only shipments that actually need something appear. A customs page listing
    // every shipment would bury the two that are stuck.
    .filter((shipment) => shipment.missingDocuments.length || shipment.clearanceQuery)
    // Held shipments first: those are stopped, not merely incomplete.
    .sort((left, right) => Number(Boolean(right.clearanceQuery)) - Number(Boolean(left.clearanceQuery)));

  const review = account?.kycReview as { overallStatus?: string; checks?: Record<string, { status?: string }> } | undefined;

  return {
    account: account
      ? {
        businessAccountId: String(account._id),
        companyName: account.company?.companyName ?? "",
        accountId: account.accountId,
        kycStatus: review?.overallStatus ?? "documents_pending",
        kycStatusLabel: label(review?.overallStatus ?? "documents_pending"),
        checks: Object.entries(kycCheckLabels)
          .map(([key, checkLabel]) => ({
            key,
            label: checkLabel,
            status: review?.checks?.[key]?.status ?? "not_submitted"
          }))
          // Checks never started carry no information for the customer and
          // would pad the list to eleven rows of "not submitted".
          .filter((check) => check.status !== "not_submitted"),
        gstin: account.company?.gstin ?? "",
        gstExempt: Boolean(account.company?.gstExempt)
      }
      : null,
    shipments,
    summary: {
      shipmentsNeedingDocuments: shipments.filter((shipment) => shipment.missingDocuments.length).length,
      shipmentsHeldAtCustoms: shipments.filter((shipment) => shipment.clearanceQuery).length
    }
  };
}
