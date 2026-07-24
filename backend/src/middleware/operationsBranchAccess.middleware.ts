import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { OperationsManifest } from "../models/operationsManifest.model.js";

type OperationsUser = {
  _id: mongoose.Types.ObjectId;
  role: string;
  assignedBranches?: mongoose.Types.ObjectId[];
};

export function operationsUser(request: Request) {
  return (request as Request & { user?: OperationsUser }).user;
}

export function operationsBranchIds(request: Request) {
  const user = operationsUser(request);
  if (!user || user.role === "admin") return null;
  return (user.assignedBranches ?? []).map(String);
}

function canAccessBranch(request: Request, branchId: unknown) {
  const allowedBranches = operationsBranchIds(request);
  return allowedBranches === null || allowedBranches.includes(String(branchId));
}

export function requireRequestedOperationsBranch(request: Request, response: Response, next: NextFunction) {
  const branchId = typeof request.body?.branchId === "string" ? request.body.branchId : "";
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    return response.status(400).json({ success: false, message: "Select a valid branch." });
  }
  if (!canAccessBranch(request, branchId)) {
    return response.status(403).json({ success: false, message: "You do not have access to this branch." });
  }
  return next();
}

export async function requireOperationsManifestBranch(request: Request, response: Response, next: NextFunction) {
  const manifestId = String(request.params.manifestId ?? "");
  if (!mongoose.Types.ObjectId.isValid(manifestId)) {
    return response.status(404).json({ success: false, message: "Operations manifest was not found." });
  }
  const manifest = await OperationsManifest.findById(manifestId).select("branchId").lean().exec();
  if (!manifest) return response.status(404).json({ success: false, message: "Operations manifest was not found." });
  if (!canAccessBranch(request, manifest.branchId)) {
    return response.status(403).json({ success: false, message: "You do not have access to this manifest's branch." });
  }
  return next();
}
