import mongoose from "mongoose";
import { env } from "../config/env.js";
import { purgeExpiredClaimDocuments } from "../services/claims/claimRetention.service.js";

/**
 * Destroys claim evidence past its eight-year retention period.
 *
 * Reports by default and only deletes when passed `--apply`, matching the other
 * destructive scripts in this project. Nothing here removes a claim record-
 * the claim, its timeline, and its decisions remain readable. What expires is
 * the right to keep the loss photographs and bank proofs behind them.
 *
 * Claims and documents under legal hold are skipped and counted, never deleted.
 */
async function main() {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(env.MONGODB_URI);

  try {
    const result = await purgeExpiredClaimDocuments({ dryRun: !apply });

    console.log(
      [
        apply ? "Purge applied." : "Dry run- nothing was deleted. Pass --apply to act.",
        `Claims past retention: ${result.examined}`,
        `Claims processed:      ${result.purgedClaims}`,
        `Documents ${apply ? "deleted" : "that would be deleted"}: ${result.purgedDocuments}`,
        `Skipped under legal hold: ${result.skippedUnderHold}`
      ].join("\n")
    );

    if (result.skippedUnderHold > 0) {
      console.warn(
        `${result.skippedUnderHold} item(s) are past retention but held. They stay until the hold is lifted.`
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Claim retention purge failed.", error);
  process.exitCode = 1;
});
