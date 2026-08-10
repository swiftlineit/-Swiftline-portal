import mongoose from "mongoose";
import { env } from "../config/env.js";
import { ClaimPolicyRule } from "../models/claimPolicyRule.model.js";
import { User } from "../models/user.model.js";

/**
 * Seeds the fallback claim policy rule.
 *
 * Without one, deadline calculation falls back to the constants in
 * `claimTypes.ts` and `carrierRecoveryDays` is null — which means the
 * recovery-exposure warning never fires and staff approve payouts with no
 * signal that the carrier can no longer be billed.
 *
 * Run once per environment. Re-running updates the same named rule rather than
 * creating a second one.
 */

const ruleName = "Swiftline default claim policy";

/**
 * PROVISIONAL. Swiftline's own window to notify a carrier has not been read off
 * the DPD and partner contracts yet.
 *
 * 21 days is used as a placeholder because it sits at the shorter end of the
 * common carriage conventions, and erring short is the safe direction: a warning
 * that fires too early costs a reviewer one check against the contract, while
 * one that fires too late costs an unrecoverable payout. Replace it with the
 * real per-carrier figures — that is what `carrierCodes` on a rule is for.
 */
const provisionalCarrierRecoveryDays = 21;

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  try {
    // Attributed to an admin because the model records who created a rule and
    // a seed has no human behind it.
    const admin = await User.findOne({ role: "admin" }).select("_id").lean().exec();
    if (!admin) throw new Error("No admin user exists to attribute the policy rule to.");

    const existing = await ClaimPolicyRule.findOne({ name: ruleName }).exec();

    const values = {
      name: ruleName,
      isActive: true,
      effectiveFrom: new Date(),
      // No route, carrier, category, or account constraints: this is the
      // catch-all every claim falls back to when nothing more specific matches.
      routeScope: "ANY" as const,
      originCountryCodes: [],
      destinationCountryCodes: [],
      carrierCodes: [],
      categories: [],
      businessAccountIds: [],
      bookingToClaimDays: 35,
      deliveryToClaimDays: 7,
      evidenceDays: 7,
      appealDays: 15,
      internalReviewDays: 15,
      carrierRecoveryDays: provisionalCarrierRecoveryDays,
      // Empty means "use the category defaults" rather than "require nothing".
      requiredDocuments: [],
      createdBy: admin._id
    };

    if (existing) {
      existing.set({ ...values, version: existing.version + 1 });
      await existing.save();
      console.log(`Updated "${ruleName}" to version ${existing.version}.`);
    } else {
      await ClaimPolicyRule.create({ ...values, version: 1 });
      console.log(`Created "${ruleName}".`);
    }

    console.warn(
      `carrierRecoveryDays is set to ${provisionalCarrierRecoveryDays} as a PROVISIONAL value. ` +
        "Replace it with the real windows from the carrier contracts before relying on the " +
        "recovery-exposure warning."
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Claim policy seed failed.", error);
  process.exitCode = 1;
});
