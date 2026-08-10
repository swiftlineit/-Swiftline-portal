import type mongoose from "mongoose";
import { ClaimCounter } from "../../models/claimCounter.model.js";

/**
 * Allocates `CLM/26-27/00001`.
 *
 * Only called at preliminary submission, never at draft creation — an abandoned
 * draft must not burn a number and leave a hole in the financial-year run.
 * Once allocated the number is immutable and is never reused, including after a
 * withdrawal or a rejection.
 */

/**
 * India's financial year, as `26-27`.
 *
 * Computed in IST rather than server-local time: a claim submitted at 02:00 IST
 * on 1 April belongs to the new financial year, and a UTC server would place it
 * in the old one.
 */
function getFinancialYear(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const startYear = month >= 4 ? year : year - 1;

  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

/**
 * Reserves the next number for the financial year.
 *
 * The `$inc` upsert is atomic, so two claims submitted in the same instant get
 * different sequences without a lock. Pass the surrounding transaction's session
 * when submission runs inside one.
 */
export async function allocateClaimNumber(input: { now?: Date; session?: mongoose.ClientSession } = {}) {
  const now = input.now ?? new Date();
  const financialYear = getFinancialYear(now);

  const counter = await ClaimCounter.findOneAndUpdate(
    { financialYear },
    { $inc: { sequence: 1 }, $setOnInsert: { financialYear } },
    { upsert: true, returnDocument: "after", runValidators: true, session: input.session }
  ).exec();

  if (!counter) {
    throw new Error("A claim number could not be generated. Please try again.");
  }

  return {
    financialYear,
    claimNumber: `CLM/${financialYear}/${String(counter.sequence).padStart(5, "0")}`
  };
}

export { getFinancialYear as claimFinancialYear };
