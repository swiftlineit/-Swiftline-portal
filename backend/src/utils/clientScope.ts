import type { Request } from "express";
import mongoose from "mongoose";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { canAccessCreditFinancials } from "../services/creditAccount.service.js";

/**
 * What one client request is allowed to read.
 *
 * Shared because every client-wide surface — the dashboard, exceptions, actions,
 * global search — has to answer the same question, and answering it in four
 * places is how one of them ends up disagreeing. Branch scoping matters as much
 * as account scoping: a member restricted to one branch must not meet another
 * branch's shipments through a search box.
 */
export type ClientScope =
  | {
      ok: true;
      businessAccountId: mongoose.Types.ObjectId;
      branchIds: mongoose.Types.ObjectId[];
      canViewFinancials: boolean;
    }
  | { ok: false; status: number; message: string };

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

export async function resolveClientScope(request: Request): Promise<ClientScope> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return { ok: false, status: 401, message: "Unauthorized" };

  const businessAccountId = typeof request.query.businessAccountId === "string"
    ? request.query.businessAccountId
    : "";
  if (!mongoose.Types.ObjectId.isValid(businessAccountId)) {
    return { ok: false, status: 400, message: "Select a valid business account." };
  }

  const membership = await BusinessAccountMember.findOne({
    user: userId,
    businessAccount: new mongoose.Types.ObjectId(businessAccountId),
    status: "active"
  })
    .select("businessAccount role creditPermissions assignedBranches")
    .lean()
    .exec();

  if (!membership) {
    return { ok: false, status: 404, message: "Business account access is not available." };
  }

  // Members with no explicit branches inherit the account's assigned branch,
  // matching how the shipment listings already scope.
  let branchIds = (membership.assignedBranches ?? []) as mongoose.Types.ObjectId[];
  if (!branchIds.length) {
    const account = await BusinessAccount.findById(membership.businessAccount)
      .select("assignedBranch")
      .lean()
      .exec();
    branchIds = account?.assignedBranch ? [account.assignedBranch as mongoose.Types.ObjectId] : [];
  }

  const requestedBranchId = typeof request.query.branchId === "string" ? request.query.branchId : "";
  if (requestedBranchId) {
    if (!mongoose.Types.ObjectId.isValid(requestedBranchId)
      || !branchIds.some((id) => String(id) === requestedBranchId)) {
      return { ok: false, status: 403, message: "This branch is not assigned to your login." };
    }
    branchIds = [new mongoose.Types.ObjectId(requestedBranchId)];
  }

  return {
    ok: true,
    businessAccountId: membership.businessAccount as mongoose.Types.ObjectId,
    branchIds,
    canViewFinancials: canAccessCreditFinancials(membership.role)
  };
}
