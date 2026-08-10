import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Claim } from "../models/claim.model.js";
import {
  notifyClaimAppealWindowClosing,
  notifyClaimSlaDue
} from "../services/claims/claimNotification.service.js";

/**
 * Daily sweep for claim deadlines that nothing else triggers.
 *
 * Every other claim notification hangs off an action someone took. These two do
 * not: an appeal window closes and a review target passes because time moved,
 * so without a scheduled pass nobody would ever be told.
 *
 * Run once a day. The notification idempotency keys are day-stamped, so a second
 * run on the same day is harmless and a claim that stays overdue is re-notified
 * tomorrow rather than falling silent after the first warning.
 */

/** Days before an appeal window closes that we warn the client. */
const appealWarningDays = [7, 3, 1];

function daysBetween(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

async function sweepAppealWindows(now: Date) {
  const claims = await Claim.find({
    status: "DECIDED",
    appealState: "NONE",
    // A client who already accepted has nothing left to appeal.
    acceptanceState: { $ne: "ACCEPTED" },
    "deadlines.appealDeadlineAt": { $gt: now }
  }).exec();

  let warned = 0;
  for (const claim of claims) {
    const deadline = claim.deadlines?.appealDeadlineAt;
    if (!deadline) continue;

    const daysLeft = daysBetween(now, deadline);
    if (!appealWarningDays.includes(daysLeft)) continue;

    await notifyClaimAppealWindowClosing(claim, daysLeft);
    warned += 1;
  }
  return warned;
}

async function sweepReviewTargets(now: Date) {
  const claims = await Claim.find({
    status: { $nin: ["DRAFT", "SETTLED", "CLOSED", "WITHDRAWN"] },
    "deadlines.internalReviewDueAt": { $lte: now }
  }).exec();

  for (const claim of claims) {
    const due = claim.deadlines?.internalReviewDueAt;
    if (!due) continue;
    // Same-day is "due"; anything earlier is genuinely overdue.
    await notifyClaimSlaDue(claim, daysBetween(due, now) > 0);
  }
  return claims.length;
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const now = new Date();

  try {
    const [appeals, reviews] = await Promise.all([
      sweepAppealWindows(now),
      sweepReviewTargets(now)
    ]);
    console.log(
      `Claim deadline sweep complete: ${appeals} appeal reminder(s), ${reviews} review reminder(s).`
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Claim deadline sweep failed.", error);
  process.exitCode = 1;
});
