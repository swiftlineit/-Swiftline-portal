import { ClaimPolicyRule } from "../../models/claimPolicyRule.model.js";
import type { IClaimPolicyRule } from "../../models/claimPolicyRule.model.js";
import { claimFilingDeadline, defaultClaimDeadlines } from "../../models/claimTypes.js";
import type { ClaimCategory } from "../../models/claimTypes.js";

/**
 * Chooses the filing rule that applies to a claim, and computes its deadlines.
 *
 * The result is frozen onto the claim at submission. Revising policy next
 * quarter must not retroactively expire a claim already in flight, and a
 * reviewer looking at a two-year-old file needs to see the rules it was actually
 * judged under.
 */

export interface PolicyMatchInput {
  category: ClaimCategory;
  originCountryCode: string;
  destinationCountryCode: string;
  carrierCode?: string | null;
  businessAccountId: string;
  now?: Date;
}

/**
 * How narrowly a rule matches. Higher wins.
 *
 * A rule tied to one business account beats one tied to a carrier, which beats
 * a route rule, which beats the catch-all- so a negotiated contract term always
 * takes precedence over a general default.
 */
function specificity(rule: IClaimPolicyRule) {
  return (
    (rule.businessAccountIds.length > 0 ? 16 : 0) +
    (rule.carrierCodes.length > 0 ? 8 : 0) +
    (rule.originCountryCodes.length > 0 || rule.destinationCountryCodes.length > 0 ? 4 : 0) +
    (rule.categories.length > 0 ? 2 : 0) +
    (rule.routeScope !== "ANY" ? 1 : 0)
  );
}

/** An empty constraint list means "no constraint", not "matches nothing". */
function matchesList(list: readonly string[], value: string | null | undefined) {
  return list.length === 0 || (value ? list.includes(value) : false);
}

function matches(rule: IClaimPolicyRule, input: PolicyMatchInput) {
  const isDomestic = input.originCountryCode === input.destinationCountryCode;
  if (rule.routeScope === "DOMESTIC" && !isDomestic) return false;
  if (rule.routeScope === "INTERNATIONAL" && isDomestic) return false;

  if (!matchesList(rule.originCountryCodes, input.originCountryCode)) return false;
  if (!matchesList(rule.destinationCountryCodes, input.destinationCountryCode)) return false;
  if (!matchesList(rule.carrierCodes, input.carrierCode)) return false;
  if (rule.categories.length > 0 && !rule.categories.includes(input.category)) return false;
  if (
    rule.businessAccountIds.length > 0 &&
    !rule.businessAccountIds.some((id) => String(id) === input.businessAccountId)
  ) {
    return false;
  }

  return true;
}

/**
 * The most specific active rule in effect, or null when none is configured.
 *
 * A null result is not an error: the caller falls back to the built-in defaults,
 * so claims keep working before anyone has configured a policy.
 */
export async function selectPolicyRule(input: PolicyMatchInput) {
  const now = input.now ?? new Date();

  const candidates = await ClaimPolicyRule.find({
    isActive: true,
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }]
  })
    .sort({ version: -1 })
    .exec();

  const applicable = candidates.filter((rule) => matches(rule, input));
  if (applicable.length === 0) return null;

  return applicable.reduce((best, rule) =>
    specificity(rule) > specificity(best) ? rule : best
  );
}

export interface ComputedClaimDeadlines {
  policyRuleId: string | null;
  filingBasis: "BOOKING" | "DELIVERY";
  filingDeadlineAt: Date;
  evidenceDeadlineAt: Date;
  internalReviewDueAt: Date;
  appealDays: number;
  filedLate: boolean;
  /**
   * True when Swiftline's own window to notify the carrier has already closed.
   *
   * The client's claim stays valid- this only marks that the payout is likely
   * unrecoverable, so a reviewer knows the exposure before approving rather than
   * finance discovering it afterwards.
   */
  outsideCarrierWindow: boolean;
}

const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

/**
 * Computes every date a claim is judged against.
 *
 * The two filing windows are alternatives: once a shipment is delivered the
 * delivery clock governs and the booking clock stops applying. Applying both
 * would expire a claim on a parcel delivered near the end of the booking window
 * before the client could open the box.
 */
export function computeClaimDeadlines(input: {
  rule: IClaimPolicyRule | null;
  bookedAt: Date;
  deliveredAt?: Date | null;
  filedAt?: Date;
}): ComputedClaimDeadlines {
  const filedAt = input.filedAt ?? new Date();
  const rule = input.rule;

  const { basis, deadline } = claimFilingDeadline({
    bookedAt: input.bookedAt,
    deliveredAt: input.deliveredAt,
    bookingToClaimDays: rule?.bookingToClaimDays,
    deliveryToClaimDays: rule?.deliveryToClaimDays
  });

  const carrierWindowDays = rule?.carrierRecoveryDays ?? null;

  return {
    policyRuleId: rule ? String(rule._id) : null,
    filingBasis: basis,
    filingDeadlineAt: deadline,
    evidenceDeadlineAt: addDays(filedAt, rule?.evidenceDays ?? defaultClaimDeadlines.documentResponseDays),
    internalReviewDueAt: addDays(filedAt, rule?.internalReviewDays ?? 15),
    appealDays: rule?.appealDays ?? defaultClaimDeadlines.appealDays,
    // Flagged for staff review, never auto-rejected: carrier tracking is often
    // incomplete, and a client should not lose a valid claim to a date.
    filedLate: filedAt > deadline,
    outsideCarrierWindow:
      carrierWindowDays !== null && filedAt > addDays(input.bookedAt, carrierWindowDays)
  };
}

/** Appeal window, set when a decision is issued rather than at filing. */
export function computeAppealDeadline(decidedAt: Date, appealDays = defaultClaimDeadlines.appealDays) {
  return addDays(decidedAt, appealDays);
}
