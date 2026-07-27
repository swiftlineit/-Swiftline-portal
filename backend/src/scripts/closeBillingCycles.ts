import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { closeDueCreditBillingCycles, CreditBillingCycleError } from "../services/creditBillingCycle.service.js";
import { SYSTEM_ACTOR_ID } from "../utils/systemActor.js";

// Scheduled job: close every completed-but-unclosed billing period for every
// credit facility that has ever been active. Each close is idempotent and gaps
// are recovered, so a missed run self-heals on the next one.
// Recommended cadence: daily (early morning IST).
async function run() {
  await connectDatabase();
  try {
    const accounts = await BusinessCreditAccount.find({
      status: { $in: ["ACTIVE", "SUSPENDED", "EXPIRED", "CLOSED"] }
    }).select("businessAccountId").lean().exec();

    let totalClosed = 0;
    let failures = 0;

    for (const account of accounts) {
      try {
        const result = await closeDueCreditBillingCycles({
          businessAccountId: account.businessAccountId,
          createdBy: SYSTEM_ACTOR_ID
        });
        totalClosed += result.closed;
      } catch (error) {
        failures += 1;
        // A conflict (concurrent close) is expected and safe to skip; log the rest.
        if (!(error instanceof CreditBillingCycleError && error.statusCode === 409)) {
          console.error(`Failed to close billing cycles for ${String(account.businessAccountId)}.`, error);
        }
      }
    }

    console.log(`Billing close complete: ${accounts.length} account(s) scanned, ${totalClosed} statement(s) issued, ${failures} failure(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error("Billing close job failed.", error);
  process.exitCode = 1;
});
