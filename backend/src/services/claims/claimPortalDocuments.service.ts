import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import { ClaimDocument } from "../../models/claimDocument.model.js";
import { ClaimEvent } from "../../models/claimEvent.model.js";
import { DpdShipment } from "../../models/dpdShipment.model.js";
import { InvoiceUpload } from "../../models/invoiceUpload.model.js";
import { LabelDocument } from "../../models/labelDocument.model.js";
import { ShipmentDraft } from "../../models/shipmentDraft.model.js";
import type { IClaim } from "../../models/claim.model.js";
import { checksumOf, claimDocumentKey, putObject } from "../storage/storage.service.js";

/**
 * Attaches documents Swiftline already holds for the shipment.
 *
 * Asking a client to upload the commercial invoice they gave us at booking is
 * the kind of thing that makes a claims process feel adversarial, and it is the
 * commonest reason a checklist sits incomplete.
 *
 * The bytes are *copied* into the claim's own storage prefix rather than
 * referenced where they sit. Two reasons: the source modules still store local
 * filesystem paths rather than storage keys, so a reference would not survive
 * their S3 conversion; and a claim is a legal record kept for eight years, which
 * must not depend on another module's retention decisions.
 */

interface PortalSource {
  category: "VALUE_PROOF" | "OTHER";
  label: string;
  filename: string;
  mimeType: string;
  absolutePath: string;
}

const uploadsRoot = path.resolve(process.cwd(), "private_uploads");

/** Source modules store bare filenames or absolute paths depending on age. */
function resolveSourcePath(storagePath: string, subdirectory: string) {
  if (path.isAbsolute(storagePath)) return storagePath;
  return path.resolve(uploadsRoot, subdirectory, storagePath);
}

async function collectSources(shipmentDraftId: mongoose.Types.ObjectId) {
  const sources: PortalSource[] = [];

  const shipment = await ShipmentDraft.findById(shipmentDraftId)
    .select("invoiceUploadId")
    .lean()
    .exec();

  if (shipment?.invoiceUploadId) {
    const invoice = await InvoiceUpload.findById(shipment.invoiceUploadId)
      .select("originalFilename storagePath")
      .lean()
      .exec();

    if (invoice?.storagePath) {
      sources.push({
        category: "VALUE_PROOF",
        label: "commercial invoice from booking",
        filename: invoice.originalFilename || "invoice.pdf",
        mimeType: invoice.originalFilename?.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "application/octet-stream",
        absolutePath: resolveSourcePath(invoice.storagePath, "invoices")
      });
    }
  }

  // Labels hang off the booking rather than the draft, so this is a second hop.
  const booking = await DpdShipment.findOne({ shipmentDraftId }).select("_id").lean().exec();
  if (booking) {
    const label = await LabelDocument.findOne({ dpdShipmentId: booking._id, voidedAt: null })
      .sort({ createdAt: -1 })
      .select("storagePath format parcelNumber")
      .lean()
      .exec();

    // ZPL is printer control code, not a document a reviewer can read.
    if (label?.storagePath && label.format === "PDF") {
      sources.push({
        category: "OTHER",
        label: "shipping label",
        filename: `label-${label.parcelNumber || "parcel"}.pdf`,
        mimeType: "application/pdf",
        absolutePath: resolveSourcePath(label.storagePath, "labels")
      });
    }
  }

  return sources;
}

/**
 * Links whatever is available. Never throws.
 *
 * Called during submission, where a missing or unreadable source file must not
 * cost a client their filing date. Anything that cannot be copied is simply not
 * attached, and the client is asked for it as normal.
 */
export async function attachPortalDocuments(claim: IClaim, actorUserId: mongoose.Types.ObjectId) {
  const attached: string[] = [];

  for (const source of await collectSources(claim.shipmentDraftId)) {
    try {
      // Never displace something the client uploaded themselves.
      const existing = await ClaimDocument.exists({
        claimId: claim._id,
        category: source.category,
        deletedAt: null
      });
      if (existing) continue;

      const contents = await fs.readFile(source.absolutePath);
      if (contents.length === 0) continue;

      const storageKey = claimDocumentKey({
        claimId: String(claim._id),
        documentType: "evidence",
        originalName: source.filename
      });

      await putObject({
        key: storageKey,
        body: contents,
        contentType: source.mimeType,
        originalName: source.filename
      });

      await ClaimDocument.create({
        claimId: claim._id,
        category: source.category,
        storageKey,
        originalName: source.filename,
        mimeType: source.mimeType,
        size: contents.length,
        // Hashed from the copy actually stored, not carried over from the source.
        sha256: checksumOf(contents),
        uploadedBy: actorUserId,
        uploadedByKind: "STAFF",
        // Shows on the checklist as "On file" rather than "Uploaded", so a
        // reviewer can tell our evidence from the client's at a glance.
        sourcedFromPortal: true,
        // Already vetted once when it entered the portal.
        reviewState: "ACCEPTED",
        visibility: "PUBLIC"
      });

      attached.push(source.label);
    } catch (error) {
      console.error("A portal document could not be attached to the claim.", {
        claimId: String(claim._id),
        category: source.category,
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  if (attached.length > 0) {
    await ClaimEvent.create({
      claimId: claim._id,
      type: "DOCUMENT_UPLOADED",
      actorUserId,
      actorKind: "SYSTEM",
      visibility: "PUBLIC",
      reason: `Attached from your Swiftline records: ${attached.join(", ")}.`,
      metadata: { sourcedFromPortal: true, attached }
    });
  }

  return attached;
}
