import { env } from "../config/env.js";
import type { IShipmentManifest } from "../models/shipmentManifest.model.js";
import { User } from "../models/user.model.js";
import { sendManifestGeneratedEmail } from "./mail.service.js";
import { notifyActiveAdmins } from "./portalNotification.service.js";
import { buildShipmentManifestPdf } from "./shipmentManifestPdf.service.js";

type ManifestNotificationInput = {
  manifest: IShipmentManifest;
  businessAccountName: string;
  generatedBy: string;
};

function manifestHref(manifest: IShipmentManifest) {
  return `/dashboard/shipment-manifests/${String(manifest._id)}`;
}

/**
 * Tells staff a client sealed a manifest: an in-portal notification plus an email
 * carrying the manifest PDF. Both are best effort — the manifest is already
 * committed by the time this runs, so a mail or PDF failure is logged, not thrown.
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
      }
    });
  } catch (error) {
    console.error("Manifest admin notification failed.", { manifestNumber: manifest.manifestNumber, error });
  }

  try {
    const admins = await User.find({ role: "admin", userStatus: "active" }).select("email").lean().exec();
    const recipients = [...admins.map((admin) => admin.email), env.ADMIN_EMAIL ?? ""];
    await sendManifestGeneratedEmail({
      to: recipients,
      manifestNumber: manifest.manifestNumber,
      businessAccountName: input.businessAccountName,
      generatedBy: input.generatedBy,
      generatedAt: manifest.generatedAt,
      shipmentCount,
      totalPieces: manifest.totalPieces,
      totalWeightKg: manifest.totalWeightKg,
      manifestUrl: `${env.CLIENT_URL}${manifestHref(manifest)}`,
      pdf: await buildShipmentManifestPdf(manifest)
    });
  } catch (error) {
    console.error("Manifest admin email failed.", { manifestNumber: manifest.manifestNumber, error });
  }
}
