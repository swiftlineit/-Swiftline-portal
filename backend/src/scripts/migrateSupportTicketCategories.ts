/**
 * Moves stored ticket categories onto the Help Desk list.
 *
 * The old list described what part of the business a ticket touched
 * ("Shipment Booking", "Label & Manifest"); the new one describes what has
 * actually gone wrong. Several old values have no single new equivalent, and
 * those become OTHER rather than a guess: a category drives whether the ticket
 * demands an AWB and whether a compensation claim can follow from it, so an
 * invented one would put a ticket on a path its author never asked for.
 *
 * The judgement calls, stated rather than buried:
 *
 * - SHIPMENT_NOT_RECEIVED → OTHER. "Not received" is exactly the ambiguity
 *   between late and lost that the new list separates; picking either side
 *   would assert something the record never knew.
 * - SHIPMENT_THEFT → LOST_SHIPMENT. The one place a meaning does shift, and
 *   deliberately: a stolen shipment is a compensable loss, and OTHER would
 *   quietly remove the customer's route to a claim.
 * - AMENDMENT_CANCELLATION → OTHER. ADDRESS_CORRECTION is only one kind of
 *   amendment, so it would narrow tickets that were about something else.
 * - CREDIT_ACCOUNT → BILLING_ISSUE, ACCOUNT_ACCESS → PORTAL_ISSUE. Both are
 *   the same subject under a different name.
 *
 * Dry run (default):
 *   npx tsx src/scripts/migrateSupportTicketCategories.ts
 * Apply:
 *   npx tsx src/scripts/migrateSupportTicketCategories.ts --apply
 *
 * Safe to run more than once: each pass only matches tickets still holding an
 * old value, so a second run reports nothing left to do.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { shipmentIssueCategoryValues } from "../models/supportTicket.model.js";

const apply = process.argv.includes("--apply");

/** Old category → new category. Every old value appears exactly once. */
const categoryMap: Record<string, string> = {
  SHIPMENT_BOOKING: "OTHER",
  TRACKING: "TRACKING_ISSUE",
  LABEL_MANIFEST: "OTHER",
  AMENDMENT_CANCELLATION: "OTHER",
  SHIPMENT_DELAYED: "DELIVERY_DELAY",
  SHIPMENT_NOT_RECEIVED: "OTHER",
  SHIPMENT_LOST: "LOST_SHIPMENT",
  SHIPMENT_THEFT: "LOST_SHIPMENT",
  SHIPMENT_DAMAGED: "DAMAGED_SHIPMENT",
  INVOICE_PAYMENT: "BILLING_ISSUE",
  CREDIT_ACCOUNT: "BILLING_ISSUE",
  ACCOUNT_ACCESS: "PORTAL_ISSUE",
  TECHNICAL: "PORTAL_ISSUE"
  // OTHER is absent because it maps to itself.
};

const shipmentRequired = new Set<string>(shipmentIssueCategoryValues);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Run this from portal/backend.");
    process.exit(1);
  }

  await mongoose.connect(uri, { family: 4 });
  console.log(`Connected to "${mongoose.connection.name}"`);
  console.log(apply ? "Mode: APPLY\n" : "Mode: DRY RUN (pass --apply to write)\n");

  const tickets = mongoose.connection.collection("supporttickets");
  let pending = 0;
  // Tickets that land in a category demanding an AWB while carrying none.
  // Nothing breaks- the rule is enforced when a ticket is raised, not when one
  // is read- but it is worth naming rather than leaving to be discovered.
  const shipmentless: string[] = [];

  for (const [from, to] of Object.entries(categoryMap)) {
    const filter = { category: from };
    const count = await tickets.countDocuments(filter);
    if (!count) continue;

    pending += count;
    console.log(`category: ${count} × ${from} → ${to}`);

    if (shipmentRequired.has(to)) {
      const orphans = await tickets
        .find({ ...filter, $or: [{ relatedShipmentDraftId: null }, { relatedShipmentDraftId: { $exists: false } }] })
        .project({ ticketNumber: 1 })
        .toArray();
      orphans.forEach((ticket) => shipmentless.push(`${ticket.ticketNumber} (${from} → ${to})`));
    }

    if (apply) await tickets.updateMany(filter, { $set: { category: to } });
  }

  if (shipmentless.length) {
    console.log(`\n${shipmentless.length} ticket(s) now sit in a category that expects a shipment but name none:`);
    shipmentless.forEach((line) => console.log(`  - ${line}`));
    console.log("  These stay readable and repliable; only newly raised tickets are held to the rule.");
  }

  console.log(
    pending
      ? apply ? `\nUpdated ${pending} ticket(s).` : `\n${pending} ticket(s) would be updated.`
      : "\nNothing to migrate- every category is already current."
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
