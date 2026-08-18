import type { BusinessAccountMemberRole } from "../../models/businessAccountMember.model.js";
import type { Role } from "../../models/user.model.js";

/**
 * Who may do what to a claim.
 *
 * Two separate matrices, because internal staff and business-account members are
 * different populations with different risks. A client's operations member can
 * assemble a claim but must not be able to accept a settlement on the company's
 * behalf; a Swiftline delivery user can read claims for their branch but must
 * not touch money.
 *
 * Pure functions over role strings- no database access- so the matrix can be
 * tested exhaustively and so authorisation cannot depend on request shape.
 */

export const claimActionValues = [
  "VIEW",
  "VIEW_FINANCIALS",
  "CREATE",
  "EDIT_DRAFT",
  "UPLOAD_DOCUMENT",
  "SEND_MESSAGE",
  "WITHDRAW",
  "ACCEPT_SETTLEMENT",
  "SUBMIT_APPEAL",
  "MANAGE_BANK_DETAILS",
  "ASSIGN",
  "INVESTIGATE",
  "INTERNAL_NOTE",
  "DECIDE",
  "REVIEW_DOCUMENT",
  "WAIVE_DOCUMENT",
  "VERIFY_BENEFICIARY",
  "RECORD_PAYMENT",
  "MANAGE_RECOVERY",
  "CLOSE",
  "REOPEN",
  "MANAGE_LEGAL_HOLD"
] as const;

export type ClaimAction = (typeof claimActionValues)[number];

/**
 * Business-account members.
 *
 * Only an owner or admin may accept a settlement, appeal, or touch bank details.
 * Those three commit the company to money, and an operations login is far more
 * widely shared than an owner's.
 */
const clientMatrix: Record<BusinessAccountMemberRole, readonly ClaimAction[]> = {
  account_owner: [
    "VIEW",
    "VIEW_FINANCIALS",
    "CREATE",
    "EDIT_DRAFT",
    "UPLOAD_DOCUMENT",
    "SEND_MESSAGE",
    "WITHDRAW",
    "ACCEPT_SETTLEMENT",
    "SUBMIT_APPEAL",
    "MANAGE_BANK_DETAILS"
  ],
  account_admin: [
    "VIEW",
    "VIEW_FINANCIALS",
    "CREATE",
    "EDIT_DRAFT",
    "UPLOAD_DOCUMENT",
    "SEND_MESSAGE",
    "WITHDRAW",
    "ACCEPT_SETTLEMENT",
    "SUBMIT_APPEAL",
    "MANAGE_BANK_DETAILS"
  ],
  // Prepares and runs the claim day to day, but cannot settle or bind the company.
  operations: [
    "VIEW",
    "VIEW_FINANCIALS",
    "CREATE",
    "EDIT_DRAFT",
    "UPLOAD_DOCUMENT",
    "SEND_MESSAGE",
    "WITHDRAW"
  ],
  finance: ["VIEW", "VIEW_FINANCIALS"],
  // Deliberately without VIEW_FINANCIALS: status only, no amounts, no bank data.
  /**
   * Booking, not compensation. A booking user can see that a claim exists
   * against a shipment they created, and nothing more- the same visibility a
   * tracking login has.
   */
  booking_user: ["VIEW"],
  /**
   * Runs claims end to end, but does not commit the company to money.
   *
   * VIEW_FINANCIALS is included because the amount is the claim: a claims
   * handler who cannot see what was requested cannot do the job. Accepting a
   * settlement and setting bank details stay with an owner or admin, for the
   * same reason they do for operations- those two decide where money goes.
   */
  claims_user: [
    "VIEW",
    "VIEW_FINANCIALS",
    "CREATE",
    "EDIT_DRAFT",
    "UPLOAD_DOCUMENT",
    "SEND_MESSAGE",
    "WITHDRAW",
    "SUBMIT_APPEAL"
  ],
  tracking_only: ["VIEW"]
};

/**
 * Internal staff.
 *
 * There is no amount-based approval threshold and no two-person rule on payment:
 * the same authorised user may approve and pay. That is a business decision, and
 * the compensating control is that every step is audited and a payment cannot
 * exist without a bank reference and proof.
 */
const staffMatrix: Record<Role, readonly ClaimAction[]> = {
  admin: [...claimActionValues],
  operations: [
    "VIEW",
    "VIEW_FINANCIALS",
    "SEND_MESSAGE",
    "ASSIGN",
    "INVESTIGATE",
    "INTERNAL_NOTE",
    "DECIDE",
    "REVIEW_DOCUMENT",
    "WAIVE_DOCUMENT",
    "VERIFY_BENEFICIARY",
    "RECORD_PAYMENT",
    "MANAGE_RECOVERY",
    "CLOSE",
    "REOPEN"
  ],
  // Pays and reconciles. Cannot decide the claim it is paying.
  finance: [
    "VIEW",
    "VIEW_FINANCIALS",
    "INTERNAL_NOTE",
    "VERIFY_BENEFICIARY",
    "RECORD_PAYMENT",
    "MANAGE_RECOVERY"
  ],
  delivery: ["VIEW"],
  hr: [],
  // `client` is not a staff role; business-account members are authorised
  // through the client matrix instead.
  client: []
};

export function clientCan(role: BusinessAccountMemberRole, action: ClaimAction) {
  return clientMatrix[role]?.includes(action) ?? false;
}

export function staffCan(role: Role, action: ClaimAction) {
  return staffMatrix[role]?.includes(action) ?? false;
}

/**
 * Branch scoping.
 *
 * Admins see every branch. Everyone else sees only their assigned branches, and
 * a member with no assignment sees nothing- an empty list means no access, not
 * unrestricted access. Getting that default backwards is the classic way this
 * check fails open.
 */
export function canAccessBranch(input: {
  role: Role | BusinessAccountMemberRole;
  assignedBranchIds: readonly string[];
  claimBranchId: string;
}) {
  if (input.role === "admin") return true;
  return input.assignedBranchIds.includes(input.claimBranchId);
}

/** Actions that expose amounts, decisions, or settlement details. */
export function canSeeFinancials(input:
  | { kind: "CLIENT"; role: BusinessAccountMemberRole }
  | { kind: "STAFF"; role: Role }) {
  return input.kind === "CLIENT"
    ? clientCan(input.role, "VIEW_FINANCIALS")
    : staffCan(input.role, "VIEW_FINANCIALS");
}
