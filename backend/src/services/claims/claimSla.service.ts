import { ClaimEvent } from "../../models/claimEvent.model.js";
import type { IClaim } from "../../models/claim.model.js";

/**
 * How long a claim has taken, and whose fault the wait is.
 *
 * Total elapsed time is the number a client feels, but it is the wrong number to
 * judge a team on: a claim can sit for three weeks because nobody chased the
 * evidence, or because the client took three weeks to send it. Splitting the
 * clock is what makes the SLA answerable rather than merely alarming.
 *
 * Computed from the event trail rather than stored, so a claim whose history is
 * corrected reports corrected timings, and no field can drift out of step with
 * what the timeline says happened.
 */

/** Statuses in which the ball is with the client, not with Swiftline. */
const waitingOnClient = new Set(["DRAFT", "DOCUMENTS_PENDING", "NEEDS_INFORMATION"]);

/** Statuses in which everyone is waiting on someone outside the portal. */
const waitingOnThirdParty = new Set(["SUBMITTED_TO_CARRIER", "CARRIER_REVIEWING"]);

/** Statuses in which the claim is finished and the clock has stopped. */
const stopped = new Set(["SETTLED", "CLOSED", "WITHDRAWN"]);

export interface ClaimSlaTiming {
  /** Wall-clock hours since the claim was filed. */
  totalHours: number;
  /** Hours the claim spent waiting on Swiftline. */
  swiftlineHours: number;
  /** Hours spent waiting for the client to supply something. */
  clientHours: number;
  /** Hours spent waiting on a carrier, insurer, or surveyor. */
  thirdPartyHours: number;
  /** True once the internal review target has passed on a live claim. */
  breached: boolean;
  /** Negative once overdue. */
  hoursUntilReviewDue: number | null;
}

const hoursBetween = (from: Date, to: Date) =>
  Math.max(0, (to.getTime() - from.getTime()) / (60 * 60 * 1000));

export async function computeClaimSla(claim: IClaim, now = new Date()): Promise<ClaimSlaTiming> {
  const start = claim.submittedAt ?? claim.createdAt;

  // The clock stops at the outcome rather than running forever on a settled
  // claim, so a closed case does not keep accruing time in reports.
  const end = stopped.has(claim.status)
    ? (claim.settledAt ?? claim.closedAt ?? claim.withdrawnAt ?? now)
    : now;

  const transitions = await ClaimEvent.find({
    claimId: claim._id,
    toStatus: { $ne: null },
    createdAt: { $gte: start }
  })
    .select("toStatus createdAt")
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  let clientHours = 0;
  let thirdPartyHours = 0;

  // Walk the trail in order, charging each interval to whoever held the claim
  // during it. The status *entering* an interval is what decides, so the final
  // open interval is charged to whoever holds it now.
  let cursor = start;
  let status = "SUBMITTED";

  for (const event of transitions) {
    const at = event.createdAt > end ? end : event.createdAt;
    const span = hoursBetween(cursor, at);

    if (waitingOnClient.has(status)) clientHours += span;
    else if (waitingOnThirdParty.has(status)) thirdPartyHours += span;

    cursor = at;
    status = String(event.toStatus);
    if (cursor >= end) break;
  }

  const tail = hoursBetween(cursor, end);
  if (waitingOnClient.has(status)) clientHours += tail;
  else if (waitingOnThirdParty.has(status)) thirdPartyHours += tail;

  const totalHours = hoursBetween(start, end);
  // Swiftline owns whatever is left over — the safer attribution, since an
  // unclassified wait is far more likely to be ours than the client's.
  const swiftlineHours = Math.max(0, totalHours - clientHours - thirdPartyHours);

  const due = claim.deadlines?.internalReviewDueAt ?? null;

  return {
    totalHours: Math.round(totalHours * 10) / 10,
    swiftlineHours: Math.round(swiftlineHours * 10) / 10,
    clientHours: Math.round(clientHours * 10) / 10,
    thirdPartyHours: Math.round(thirdPartyHours * 10) / 10,
    breached: Boolean(due && !stopped.has(claim.status) && now > due),
    hoursUntilReviewDue: due ? Math.round(hoursBetween(now, due) * 10) / 10 * (now > due ? -1 : 1) : null
  };
}
