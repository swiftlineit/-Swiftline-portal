import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { User } from "../models/user.model.js";
import { operationsBranchIds, operationsUser } from "./operationsBranchAccess.middleware.js";

/**
 * Which business accounts the caller may reach, as a Mongo filter.
 *
 * Returns `null` for admin, who reaches every account. Operations is branch
 * scoped like the rest of their pages: their own branches' accounts, plus the
 * ones still waiting on a branch that their branch raised. Without that second
 * arm a freshly created account would vanish from its author's list the moment
 * it was saved, since `assignedBranch` is only set later by the assign step.
 */
export async function businessAccountBranchFilter(request: Request): Promise<Record<string, unknown> | null> {
  const branchIds = operationsBranchIds(request);
  if (branchIds === null) return null;

  const branchObjectIds = branchIds
    .filter((branchId) => mongoose.Types.ObjectId.isValid(branchId))
    .map((branchId) => new mongoose.Types.ObjectId(branchId));

  // Colleagues are resolved from the branch list rather than stored on the
  // account, so moving a member between branches moves their pending accounts
  // with them. The caller is always included: a member carrying no branch
  // assignment still owns what they created.
  const colleagues = branchObjectIds.length
    ? await User.find({ assignedBranches: { $in: branchObjectIds } }).select("_id").lean().exec()
    : [];

  const creatorIds = [...new Set([
    ...colleagues.map((colleague) => String(colleague._id)),
    String(operationsUser(request)?._id ?? "")
  ].filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));

  return {
    $or: [
      ...(branchObjectIds.length ? [{ assignedBranch: { $in: branchObjectIds } }] : []),
      // `null` also matches accounts saved before the field existed.
      { assignedBranch: null, createdBy: { $in: creatorIds } }
    ]
  };
}

/**
 * Guards every `/:accountId` route. Out-of-scope accounts answer 404 rather than
 * 403 so the response cannot be used to probe which accounts another branch holds.
 */
export async function requireBusinessAccountBranch(request: Request, response: Response, next: NextFunction) {
  const scope = await businessAccountBranchFilter(request);
  if (!scope) return next();

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId, ...scope })
    .select("_id")
    .lean()
    .exec();

  if (!account) return response.status(404).json({ success: false, message: "Business account was not found." });

  return next();
}
