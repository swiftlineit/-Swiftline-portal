import mongoose from "mongoose";
import { env } from "../config/env.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { ensureShipmentInvoiceForDraft } from "../services/shipmentInvoice.service.js";

async function run() {
  await mongoose.connect(env.MONGODB_URI, { family: 4 });

  const bookedShipments = await DpdShipment.find({
    status: { $in: ["DPD_CREATED", "LABEL_RECEIVED"] }
  }).select("_id shipmentDraftId").lean().exec();
  let created = 0;
  let skipped = 0;

  for (const shipment of bookedShipments) {
    const exists = await ShipmentInvoice.exists({ shipmentDraftId: shipment.shipmentDraftId });
    if (exists) {
      skipped += 1;
      continue;
    }

    const draft = await ShipmentDraft.findById(shipment.shipmentDraftId).select("createdBy").lean().exec();
    if (!draft?.createdBy) {
      console.warn(`Skipped ${String(shipment.shipmentDraftId)}: booking actor is unavailable.`);
      skipped += 1;
      continue;
    }

    try {
      await ensureShipmentInvoiceForDraft({
        shipmentDraftId: shipment.shipmentDraftId,
        dpdShipmentId: shipment._id,
        userId: draft.createdBy
      });
      created += 1;
    } catch (error) {
      console.warn(`Skipped ${String(shipment.shipmentDraftId)}: ${error instanceof Error ? error.message : "invoice generation failed"}`);
      skipped += 1;
    }
  }

  console.log(`Shipment invoice backfill complete. Created: ${created}. Skipped: ${skipped}.`);
}

run()
  .catch((error) => {
    console.error("Shipment invoice backfill failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
