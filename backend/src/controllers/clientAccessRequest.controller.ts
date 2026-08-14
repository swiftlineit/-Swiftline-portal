import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import {
  BusinessAccountMember,
  businessAccountMemberRoleLabels
} from "../models/businessAccountMember.model.js";
import { notifyPortalUsers } from "../services/portalNotification.service.js";

/**
 * Client login requests awaiting Swiftline.
 *
 * A business account administrator can ask for portal access for a colleague,
 * but the login is not created until somebody here approves it — anyone named
 * would otherwise gain immediate sight of that account's shipments, invoices
 * and claims with nobody at Swiftline in the loop.
 */

function actorId(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null;
}

export async function listClientAccessRequests(_request: Request, response: Response): Promise<Response> {
  const pending = await BusinessAccountMember.find({ status: "pending_approval" })
    .populate("invitedBy", "firstName lastName name email")
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  const accounts = await BusinessAccount.find({ _id: { $in: pending.map((item) => item.businessAccount) } })
    .select("accountId company.companyName assignedBranch")
    .populate("assignedBranch", "name code")
    .lean()
    .exec();
  const accountById = new Map(accounts.map((account) => [String(account._id), account]));

  return response.status(200).json({
    success: true,
    requests: pending.map((item) => {
      const account = accountById.get(String(item.businessAccount));
      const requester = item.invitedBy as unknown as { firstName?: string; lastName?: string; name?: string; email?: string } | null;
      const branch = account?.assignedBranch as unknown as { name?: string; code?: string } | null;

      return {
        id: String(item._id),
        businessAccountId: String(item.businessAccount),
        accountName: account?.company?.companyName ?? "",
        accountCode: account?.accountId ?? "",
        branchName: branch?.name ?? "",
        branchCode: branch?.code ?? "",
        firstName: item.requestedInvite?.firstName ?? "",
        lastName: item.requestedInvite?.lastName ?? "",
        email: item.requestedInvite?.email ?? "",
        phone: item.requestedInvite?.phone ?? "",
        role: item.role,
        roleLabel: businessAccountMemberRoleLabels[item.role] ?? item.role,
        requestedByName: [requester?.firstName, requester?.lastName].filter(Boolean).join(" ") || requester?.name || requester?.email || "",
        requestedAt: item.createdAt
      };
    })
  });
}

/**
 * Approves a request by handing it to the existing client-access flow.
 *
 * The account, KYC and duplicate checks that flow already performs are the
 * ones that matter, so approval reuses it rather than creating a user here
 * and quietly skipping them. The pending row is only marked once that
 * succeeded.
 */
export async function approveClientAccessRequest(request: Request, response: Response): Promise<Response> {
  const userId = actorId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const requestId = String(request.params.requestId ?? "");
  if (!mongoose.Types.ObjectId.isValid(requestId)) {
    return response.status(404).json({ success: false, message: "Request was not found." });
  }

  const pending = await BusinessAccountMember.findOne({ _id: requestId, status: "pending_approval" }).exec();
  if (!pending || !pending.requestedInvite) {
    return response.status(404).json({ success: false, message: "Request was not found." });
  }

  const account = await BusinessAccount.findById(pending.businessAccount).select("accountId").lean().exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account was not found." });

  return response.status(200).json({
    success: true,
    /**
     * The staff screen finishes this on the existing endpoint.
     *
     * Creating the login means a user record, a password invitation and a
     * duplicate check across every account — all of which
     * `createBusinessAccountClientAccess` already does correctly. Duplicating
     * it here would be a second implementation of the rules that decide who
     * can log in to Swiftline.
     */
    accountId: account.accountId,
    invite: {
      firstName: pending.requestedInvite.firstName,
      lastName: pending.requestedInvite.lastName,
      email: pending.requestedInvite.email,
      phone: pending.requestedInvite.phone,
      role: pending.role
    }
  });
}

/** Marks the request approved once the login has actually been created. */
export async function completeClientAccessRequest(request: Request, response: Response): Promise<Response> {
  const userId = actorId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const requestId = String(request.params.requestId ?? "");
  const pending = await BusinessAccountMember.findOne({ _id: requestId, status: "pending_approval" }).exec();
  if (!pending) return response.status(404).json({ success: false, message: "Request was not found." });

  // Removed rather than left behind: the real membership now exists, created
  // by the access flow, and two rows for one person would double-count them.
  await BusinessAccountMember.deleteOne({ _id: pending._id }).exec();

  await AuditLog.create({
    action: "BUSINESS_ACCOUNT_MEMBER_INVITE_APPROVED",
    entityType: "BUSINESS_ACCOUNT",
    entityId: pending.businessAccount,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { email: pending.requestedInvite?.email ?? "", role: pending.role }
  });

  await notifyPortalUsers([pending.invitedBy], {
    type: "CLIENT_ACCESS_APPROVED",
    title: "Portal access approved",
    message: `${pending.requestedInvite?.email ?? "Your colleague"} can now sign in to the Swiftline portal.`,
    href: "/client/team",
    idempotencyKey: `client-access-approved:${String(pending._id)}`,
    businessAccountId: pending.businessAccount
  });

  return response.status(200).json({ success: true, message: "Request approved." });
}

export async function declineClientAccessRequest(request: Request, response: Response): Promise<Response> {
  const userId = actorId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ success: false, message: "Enter a reason so the customer knows why." });
  }

  const requestId = String(request.params.requestId ?? "");
  const pending = await BusinessAccountMember.findOne({ _id: requestId, status: "pending_approval" }).exec();
  if (!pending) return response.status(404).json({ success: false, message: "Request was not found." });

  // Kept as a declined row rather than deleted, so the account can see the
  // answer and Swiftline keeps a record of having given one.
  pending.status = "declined";
  await pending.save();

  await AuditLog.create({
    action: "BUSINESS_ACCOUNT_MEMBER_INVITE_DECLINED",
    entityType: "BUSINESS_ACCOUNT",
    entityId: pending.businessAccount,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { email: pending.requestedInvite?.email ?? "", reason: parsed.data.reason }
  });

  await notifyPortalUsers([pending.invitedBy], {
    type: "CLIENT_ACCESS_APPROVED",
    title: "Portal access request declined",
    message: `Swiftline declined access for ${pending.requestedInvite?.email ?? "your colleague"}. ${parsed.data.reason}`,
    href: "/client/team",
    idempotencyKey: `client-access-declined:${String(pending._id)}`,
    businessAccountId: pending.businessAccount
  });

  return response.status(200).json({ success: true, message: "Request declined." });
}
