import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { expireLapsedCreditAccounts, notifyCreditUtilizationWarnings } from "../services/creditAccount.service.js";
import { markOverdueCreditStatements } from "../services/creditOverdue.service.js";

// Scheduled job: flag due-passed statements as OVERDUE and expire credit
// facilities whose validity window has closed, so restrictions apply on time
// rather than only when a page lazily triggers the same check.
// Recommended cadence: hourly (or at least once daily).
async function run() {
  await connectDatabase();
  try {
    const now = new Date();
    const overdue = await markOverdueCreditStatements(now);
    const expired = await expireLapsedCreditAccounts(now);
    const warnings = await notifyCreditUtilizationWarnings(now);
    console.log(`Credit maintenance complete: ${overdue.markedOverdue} statement(s) marked overdue, ${expired.expired} facility(ies) expired, ${warnings.notified} utilization warning(s) sent.`);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error("Credit overdue/expiry job failed.", error);
  process.exitCode = 1;
});
