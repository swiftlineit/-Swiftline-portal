/**
 * Populates `company.registrationIdKey` on accounts created before it existed.
 *
 * The uniqueness index is keyed on it, so without this every existing account
 * has a blank key, falls outside the partial index, and duplicate registration
 * IDs go on being accepted.
 *
 *   npm run backfill:registration-id-keys
 *
 * Safe to run repeatedly: it only writes accounts whose key is missing, and it
 * derives the value from data already on the record.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { compactRegistrationId } from "../services/businessAccountRules.js";
import { isMaskedUsTaxId } from "../services/usTaxId.js";

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const accounts = await BusinessAccount
    .find({ $or: [{ "company.registrationIdKey": { $exists: false } }, { "company.registrationIdKey": "" }] })
    .select("accountId company.registrationId company.registrationIdKey")
    .lean()
    .exec();

  console.log(`${accounts.length} account(s) without a registration ID key.`);

  let updated = 0;
  let skippedMasked = 0;
  let skippedEmpty = 0;

  for (const account of accounts) {
    const registrationId = account.company?.registrationId ?? "";

    if (!registrationId.trim()) {
      skippedEmpty += 1;
      continue;
    }

    // A masked tax ID cannot be compared, so it stays keyless and outside the
    // uniqueness index by design.
    if (isMaskedUsTaxId(registrationId)) {
      skippedMasked += 1;
      continue;
    }

    await BusinessAccount.updateOne(
      { _id: account._id },
      { $set: { "company.registrationIdKey": compactRegistrationId(registrationId) } }
    ).exec();

    updated += 1;
  }

  console.log(`Updated ${updated}; skipped ${skippedEmpty} with no registration ID and ${skippedMasked} masked tax ID(s).`);
  console.log("Now run `npm run check:duplicate-accounts` before deploying.");

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Backfill failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
