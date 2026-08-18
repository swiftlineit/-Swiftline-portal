import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { reconcileAllCreditAccounts } from "../services/creditReconciliation.service.js";
import { notifyActiveAdmins } from "../services/portalNotification.service.js";

// Scheduled job: read-only reconciliation of every credit account against the
// ledger, statements, and reservations. It corrects nothing- it surfaces drift
// (to the console and to admins) so a human can resolve it with the write-off /
// adjust tools. Recommended cadence: nightly.
async function run() {
  await connectDatabase();
  try {
    const { scanned, drifted } = await reconcileAllCreditAccounts();

    if (!drifted.length) {
      console.log(`Credit reconciliation complete: ${scanned} account(s) scanned, no drift found.`);
      return;
    }

    console.error(`Credit reconciliation found drift in ${drifted.length} of ${scanned} account(s):`);
    for (const entry of drifted) {
      console.error(`  ${entry.businessAccountId}: ${entry.issues.join(" ")}`);
    }

    // Alert admins once per run so drift is actioned, not just logged.
    const runKey = new Date().toISOString().slice(0, 16);
    await notifyActiveAdmins({
      type: "CREDIT_RECONCILIATION_ALERT",
      title: "Credit reconciliation drift detected",
      message: `${drifted.length} credit account(s) have balance drift. Review the reconciliation log and resolve before further billing.`,
      href: "/dashboard/credit-accounts",
      idempotencyKey: `CREDIT_RECONCILIATION:${runKey}`,
      metadata: { driftedCount: drifted.length, scanned }
    });
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error("Credit reconciliation job failed.", error);
  process.exitCode = 1;
});
