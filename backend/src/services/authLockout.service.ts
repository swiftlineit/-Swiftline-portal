import mongoose from "mongoose";
import { User } from "../models/user.model.js";

export const PASSWORD_LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const PASSWORD_LOGIN_LOCK_MS = 15 * 60 * 1000;

export function passwordLockDetails(lockedUntil: Date, now = new Date()) {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
  const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));

  return {
    retryAfterSeconds,
    message: `Too many unsuccessful login attempts. Try again in ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? "" : "s"}.`
  };
}

/**
 * Atomically spends one password attempt and opens the account lock on the
 * fifth failure. An aggregation update keeps concurrent requests from reading
 * and writing the same stale counter, and it avoids validating unrelated legacy
 * profile/document fields during authentication.
 */
export async function recordFailedPasswordAttempt(
  userId: mongoose.Types.ObjectId,
  now = new Date()
): Promise<Date | null> {
  const lockedUntil = new Date(now.getTime() + PASSWORD_LOGIN_LOCK_MS);
  const nextAttempt = { $add: [{ $ifNull: ["$failedLoginAttempts", 0] }, 1] };

  const state = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }]
    },
    [
      {
        $set: {
          failedLoginAttempts: {
            $cond: [
              { $gte: [nextAttempt, PASSWORD_LOGIN_MAX_FAILED_ATTEMPTS] },
              0,
              nextAttempt
            ]
          },
          lockedUntil: {
            $cond: [
              { $gte: [nextAttempt, PASSWORD_LOGIN_MAX_FAILED_ATTEMPTS] },
              lockedUntil,
              null
            ]
          }
        }
      }
    ],
    { new: true, updatePipeline: true }
  )
    .select("lockedUntil")
    .lean()
    .exec();

  if (state?.lockedUntil && state.lockedUntil > now) return state.lockedUntil;

  // A concurrent fifth attempt may have locked the account between the initial
  // password check and this update's filter. Read that winning lock so every
  // concurrent request returns the same account-specific warning.
  if (!state) {
    const current = await User.findById(userId).select("lockedUntil").lean().exec();
    if (current?.lockedUntil && current.lockedUntil > now) return current.lockedUntil;
  }

  return null;
}

export async function recordSuccessfulPasswordLogin(userId: mongoose.Types.ObjectId, now = new Date()) {
  await User.updateOne(
    { _id: userId },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLogin: now } }
  ).exec();
}
