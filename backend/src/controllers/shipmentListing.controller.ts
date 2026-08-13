import type { Request, Response } from "express";
import mongoose from "mongoose";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import {
  allShipmentStatuses,
  bookedShipmentStatuses,
  listBookedShipments
} from "../services/shipmentListing.service.js";
import { dateRangeParams } from "../utils/dateRangeFilter.js";

function getUserId(request: Request) {
  const value = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return value && mongoose.Types.ObjectId.isValid(String(value))
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function objectIdParam(request: Request, key: string) {
  const value = typeof request.query[key] === "string" ? request.query[key] : "";
  return value && mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}

function pagination(request: Request) {
  return {
    page: Math.max(1, Number.parseInt(String(request.query.page ?? "1"), 10) || 1),
    limit: Math.min(100, Math.max(1, Number.parseInt(String(request.query.limit ?? "20"), 10) || 20))
  };
}

export async function listAdminBookedShipments(request: Request, response: Response) {
  const businessAccountId = objectIdParam(request, "businessAccountId");
  const branchId = objectIdParam(request, "branchId");

  const result = await listBookedShipments({
    ...pagination(request),
    actorRole: "admin",
    status: typeof request.query.status === "string" ? request.query.status : "",
    search: typeof request.query.search === "string" ? request.query.search.slice(0, 80) : "",
    ...dateRangeParams(request.query),
    businessAccountIds: businessAccountId ? [businessAccountId] : undefined,
    branchIds: branchId ? [branchId] : undefined,
    // Staff see every booking that reached the carrier, so this table and the DPD
    // labels panel no longer disagree about which shipments exist.
    bookingStatuses: allShipmentStatuses
  });

  return response.status(200).json({ success: true, ...result });
}

export async function listClientBookedShipments(request: Request, response: Response) {
  const userId = getUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const memberships = await BusinessAccountMember.find({ user: userId, status: "active" })
    .select("businessAccount assignedBranches")
    .lean()
    .exec();
  if (!memberships.length) {
    return response.status(200).json({
      success: true,
      shipments: [],
      pagination: { page: 1, limit: pagination(request).limit, total: 0, totalPages: 1 }
    });
  }

  const requestedAccountId = objectIdParam(request, "businessAccountId");
  const allowedAccountIds = memberships.map((membership) => membership.businessAccount);
  if (requestedAccountId && !allowedAccountIds.some((id) => String(id) === String(requestedAccountId))) {
    return response.status(403).json({ success: false, message: "This business account is not available for your login." });
  }
  const businessAccountIds = requestedAccountId ? [requestedAccountId] : allowedAccountIds;

  // Members restricted to specific branches only see those branches. Members with
  // no explicit branches fall back to their account's assigned branch.
  const scoped = memberships.filter((membership) => businessAccountIds
    .some((id) => String(id) === String(membership.businessAccount)));
  const explicitBranchIds = scoped.flatMap((membership) => membership.assignedBranches ?? []);
  let branchIds = explicitBranchIds;
  if (!branchIds.length) {
    const accounts = await BusinessAccount.find({ _id: { $in: businessAccountIds } })
      .select("assignedBranch")
      .lean()
      .exec();
    branchIds = accounts.map((account) => account.assignedBranch).filter(Boolean) as typeof branchIds;
  }
  const requestedBranchId = objectIdParam(request, "branchId");
  if (requestedBranchId && !branchIds.some((id) => String(id) === String(requestedBranchId))) {
    return response.status(403).json({ success: false, message: "This branch is not assigned to your login." });
  }

  const result = await listBookedShipments({
    ...pagination(request),
    actorRole: "client",
    status: typeof request.query.status === "string" ? request.query.status : "",
    search: typeof request.query.search === "string" ? request.query.search.slice(0, 80) : "",
    ...dateRangeParams(request.query),
    businessAccountIds,
    branchIds: requestedBranchId ? [requestedBranchId] : branchIds,
    // Customers only ever see shipments that completed. A booking still being
    // reconciled with the carrier is internal.
    bookingStatuses: bookedShipmentStatuses
  });

  return response.status(200).json({ success: true, ...result });
}
