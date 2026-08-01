import mongoose from "mongoose";
import { env } from "../config/env.js";
import type { IShipmentManifest } from "../models/shipmentManifest.model.js";
import { notifyActiveAdmins } from "./portalNotification.service.js";

type ManifestNotificationInput = {
  manifest: IShipmentManifest;
  businessAccountName: string;
  generatedBy: string;
};

// Manifests have no detail route: the list page is where staff review and act on
// them, so the link resolves to that manifest's row.
function manifestHref(manifest: IShipmentManifest) {
  return `/dashboard/shipment-manifests#manifest-${String(manifest._id)}`;
}

/**
 * Tells staff a client sealed a manifest: an in-portal notification plus an email
 * carrying the manifest PDF, both raised by the same call. Best effort — the
 * manifest is already committed by the time this runs, so a failure here is
 * logged rather than thrown.
 */
export async function notifyAdminsOfClientManifest(input: ManifestNotificationInput) {
  const { manifest } = input;
  const shipmentCount = manifest.lineSnapshots.length;

  try {
    await notifyActiveAdmins({
      type: "SHIPMENT_MANIFEST_GENERATED",
      title: "Client generated a shipment manifest",
      message: `${input.businessAccountName || "A client"} generated manifest ${manifest.manifestNumber} `
        + `with ${shipmentCount} ${shipmentCount === 1 ? "shipment" : "shipments"}.`,
      href: manifestHref(manifest),
      idempotencyKey: `SHIPMENT_MANIFEST_GENERATED:${String(manifest._id)}`,
      businessAccountId: manifest.businessAccountId,
      metadata: {
        manifestId: manifest._id,
        manifestNumber: manifest.manifestNumber,
        shipmentCount,
        totalPieces: manifest.totalPieces,
        totalWeightKg: manifest.totalWeightKg
      },
      email: {
        payload: {
          generatedBy: input.generatedBy,
          generatedAt: manifest.generatedAt
        },
        attachmentRefs: [{
          kind: "SHIPMENT_MANIFEST_PDF",
          refId: manifest._id as mongoose.Types.ObjectId,
          revision: null,
          filename: `MANIFEST-${manifest.manifestNumber}.pdf`
        }],
        // Keeps the shared operations inbox on the distribution list; it has no
        // portal user behind it and so resolves to no in-app notification.
        extraRecipients: env.ADMIN_EMAIL
          ? [{ userId: null, email: env.ADMIN_EMAIL, name: "Swiftline Operations" }]
          : []
      }
    });
  } catch (error) {
    console.error("Manifest admin notification failed.", { manifestNumber: manifest.manifestNumber, error });
  }
}
