import type mongoose from "mongoose";
import {
  BusinessAccountMember,
  type BusinessAccountMemberStatus
} from "../models/businessAccountMember.model.js";
import { BusinessAccountInvitation } from "../models/businessAccountInvitation.model.js";
import { DriverProfile, type DriverProfileStatus } from "../models/driverProfile.model.js";
import { User, type UserStatus } from "../models/user.model.js";

/**
 * A login carries two statuses: `userStatus` on the user, and the per-context
 * status on whatever record grants them access — a driver profile, a business
 * account membership. Only the first decides whether they can sign in; the second
 * is what the Delivery Team and Client Access pages actually display.
 *
 * Left unsynchronised, disabling a login from the Users page leaves those pages
 * reporting "Active" for someone who can no longer get in. These helpers keep the
 * pair in step in both directions.
 *
 * `suspended` and `disabled` both block sign-in identically. They differ in
 * intent, which is why they map to distinct downstream values rather than one:
 * suspended is a reversible hold, disabled is the end of the line.
 */

/** Whether a login status stops the account signing in at all. */
export function isBlockedUserStatus(status: UserStatus): boolean {
  return status === "suspended" || status === "disabled";
}

/**
 * The driver-profile status a login status implies, or null to leave the profile
 * alone.
 *
 * Reactivation only lifts a hold. A driver suspended before they were ever
 * approved returns to INVITED rather than ACTIVE, so approval is never skipped.
 */
export function resolveDriverProfileStatus(
  userStatus: UserStatus,
  current: DriverProfileStatus,
  hasBeenApproved: boolean
): DriverProfileStatus | null {
  if (isBlockedUserStatus(userStatus)) {
    return userStatus === "suspended" ? "SUSPENDED" : "DISABLED";
  }

  if (userStatus === "active" && (current === "SUSPENDED" || current === "DISABLED")) {
    return hasBeenApproved ? "ACTIVE" : "INVITED";
  }

  return null;
}

/**
 * The membership status a login status implies, or null to leave it alone.
 *
 * Blocking a login suspends the membership rather than removing it: removal is a
 * separate, deliberate decision that also gives up the account's history.
 */
export function resolveMemberStatusForUser(
  userStatus: UserStatus,
  current: BusinessAccountMemberStatus,
  hasActivated: boolean
): BusinessAccountMemberStatus | null {
  if (isBlockedUserStatus(userStatus)) {
    return current === "suspended" ? null : "suspended";
  }

  if (userStatus === "active" && current === "suspended") {
    // Someone who never activated their invitation goes back to awaiting it.
    return hasActivated ? "active" : "invited";
  }

  return null;
}

/** The login status a membership change implies. */
export function resolveUserStatusForMembership(
  memberStatus: BusinessAccountMemberStatus
): UserStatus {
  if (memberStatus === "removed") return "disabled";
  if (memberStatus === "suspended") return "suspended";
  if (memberStatus === "invited") return "invited";
  return "active";
}

/** Mirrors a login status change onto the records that grant the user access. */
export async function syncAccessWithUserStatus(
  userId: mongoose.Types.ObjectId | string,
  userStatus: UserStatus
): Promise<void> {
  await Promise.all([
    syncDriverProfile(userId, userStatus),
    syncBusinessMembership(userId, userStatus)
  ]);
}

async function syncDriverProfile(userId: mongoose.Types.ObjectId | string, userStatus: UserStatus) {
  const profile = await DriverProfile.findOne({ userId }).exec();
  if (!profile) return;

  const nextStatus = resolveDriverProfileStatus(userStatus, profile.status, Boolean(profile.approvedAt));
  if (!nextStatus || nextStatus === profile.status) return;

  profile.status = nextStatus;
  await profile.save();
}

async function syncBusinessMembership(userId: mongoose.Types.ObjectId | string, userStatus: UserStatus) {
  const member = await BusinessAccountMember.findOne({
    user: userId,
    status: { $in: ["invited", "active", "suspended"] }
  }).exec();
  if (!member) return;

  const user = await User.findById(userId).select("isVerified passwordHash").lean().exec();
  const nextStatus = resolveMemberStatusForUser(
    userStatus,
    member.status,
    Boolean(user?.isVerified && user.passwordHash)
  );
  if (!nextStatus || nextStatus === member.status) return;

  member.status = nextStatus;
  await member.save();

  // A pending invitation must not outlive the suspension that revoked it.
  if (nextStatus === "suspended") {
    await BusinessAccountInvitation.updateMany(
      { member: member._id, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    ).exec();
  }
}

/**
 * The reverse direction: suspending or removing someone's access to a business
 * account also stops them signing in, rather than leaving a live login that can
 * reach nothing. Restoring access restores the login with it.
 */
export async function syncUserStatusWithMembership(
  userId: mongoose.Types.ObjectId | string,
  memberStatus: BusinessAccountMemberStatus
): Promise<void> {
  const user = await User.findById(userId).exec();
  // Guarded so an internal login is never disabled as a side effect of a client
  // membership change.
  if (!user || user.role !== "client") return;

  const nextStatus = resolveUserStatusForMembership(memberStatus);
  if (user.userStatus === nextStatus) return;

  user.userStatus = nextStatus;
  if (nextStatus === "active") {
    user.lockedUntil = null;
    user.failedLoginAttempts = 0;
  }
  await user.save();
}
