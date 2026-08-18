/**
 * Moves stored claim and ticket values onto the customer-facing vocabulary.
 *
 * Renames only- no record changes meaning, and every old value has exactly one
 * new one. `AWAITING_THIRD_PARTY` becomes `SUBMITTED_TO_CARRIER` rather than
 * `CARRIER_REVIEWING`: the old single state only ever recorded that the claim had
 * been sent, so claiming the carrier had picked it up would assert something the
 * data never knew.
 *
 * Ticket priorities collapse four levels into three. `LOW` folds up into
 * `NORMAL` rather than down, because nothing should become less visible as a
 * side effect of a rename.
 *
 * Dry run (default):
 *   npx tsx src/scripts/migrateClaimTicketVocabulary.ts
 * Apply:
 *   npx tsx src/scripts/migrateClaimTicketVocabulary.ts --apply
 *
 * Safe to run more than once: each pass only matches rows still holding an old
 * value, so a second run reports nothing left to do.
 */
import "dotenv/config";
import mongoose from "mongoose";

const apply = process.argv.includes("--apply");

/** Collection, field, and the old → new mapping to apply to it. */
const renames: Array<{ collection: string; field: string; map: Record<string, string> }> = [
  {
    collection: "claims",
    field: "status",
    map: {
      DOCUMENTS_REQUIRED: "DOCUMENTS_PENDING",
      AWAITING_THIRD_PARTY: "SUBMITTED_TO_CARRIER",
      SETTLEMENT_PENDING: "PAYMENT_PROCESSING"
    }
  },
  // The claim timeline stores the statuses either side of every move, so a
  // history left on old values would read as transitions that never happened.
  {
    collection: "claimevents",
    field: "fromStatus",
    map: {
      DOCUMENTS_REQUIRED: "DOCUMENTS_PENDING",
      AWAITING_THIRD_PARTY: "SUBMITTED_TO_CARRIER",
      SETTLEMENT_PENDING: "PAYMENT_PROCESSING"
    }
  },
  {
    collection: "claimevents",
    field: "toStatus",
    map: {
      DOCUMENTS_REQUIRED: "DOCUMENTS_PENDING",
      AWAITING_THIRD_PARTY: "SUBMITTED_TO_CARRIER",
      SETTLEMENT_PENDING: "PAYMENT_PROCESSING"
    }
  },
  { collection: "supporttickets", field: "priority", map: { LOW: "NORMAL", HIGH: "URGENT" } }
];

// Ticket statuses are deliberately absent: that list only gained values
// (ASSIGNED, AWAITING_CARRIER, ACTION_REQUIRED) and renamed none, so every
// stored status and every entry in `statusHistory` is already valid.

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Run this from portal/backend.");
    process.exit(1);
  }

  await mongoose.connect(uri, { family: 4 });
  console.log(`Connected to "${mongoose.connection.name}"`);
  console.log(apply ? "Mode: APPLY\n" : "Mode: DRY RUN (pass --apply to write)\n");

  let pending = 0;

  for (const { collection, field, map } of renames) {
    for (const [from, to] of Object.entries(map)) {
      const filter = { [field]: from };
      const count = await mongoose.connection.collection(collection).countDocuments(filter);
      if (!count) continue;

      pending += count;
      console.log(`${collection}.${field}: ${count} × ${from} → ${to}`);
      if (apply) {
        await mongoose.connection.collection(collection).updateMany(filter, { $set: { [field]: to } });
      }
    }
  }

  console.log(
    pending
      ? apply ? `\nUpdated ${pending} value(s).` : `\n${pending} value(s) would be updated.`
      : "\nNothing to migrate- every value is already current."
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
