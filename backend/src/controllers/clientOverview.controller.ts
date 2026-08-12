import type { Request, Response } from "express";
import mongoose from "mongoose";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { canAccessCreditFinancials } from "../services/creditAccount.service.js";
import { buildClientOverview } from "../services/clientOverview.service.js";
import { collectClientAttention } from "../services/clientAttention.service.js";

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

type ResolvedScope =
  | {
      ok: true;
      businessAccountId: mongoose.Types.ObjectId;
      branchIds: mongoose.Types.ObjectId[];
      canViewFinancials: boolean;
    }
  | { ok: false; status: number; message: string };

/**
 * Resolves the account and branches this caller may read, from the account they
 * asked for.
 *
 * Branch scoping matters as much as account scoping: a member restricted to one
 * branch must not see another branch's exceptions on their dashboard, and the
 * dashboard is the one screen nobody navigates to deliberately.
 */
async function resolveScope(request: Request): Promise<ResolvedScope> {
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

/** Every figure and list the client dashboard renders, in one call. */
export async function getClientOverview(request: Request, response: Response): Promise<Response> {
  const scope = await resolveScope(request);
  if (!scope.ok) {
    return response.status(scope.status).json({ success: false, message: scope.message });
  }

  const overview = await buildClientOverview(scope);
  return response.status(200).json({ success: true, ...overview });
}

/** The Exceptions centre. The same engine, without the dashboard's summary. */
export async function listClientExceptions(request: Request, response: Response): Promise<Response> {
  const scope = await resolveScope(request);
  if (!scope.ok) {
    return response.status(scope.status).json({ success: false, message: scope.message });
  }

  const { exceptions, exceptionCountsByType } = await collectClientAttention(scope);
  return response.status(200).json({ success: true, exceptions, exceptionCountsByType });
}

/** The Action Required page. */
export async function listClientActions(request: Request, response: Response): Promise<Response> {
  const scope = await resolveScope(request);
  if (!scope.ok) {
    return response.status(scope.status).json({ success: false, message: scope.message });
  }

  const { actions } = await collectClientAttention(scope);
  return response.status(200).json({ success: true, actions });
}
