import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { FlightLinehaul } from "../models/flightLinehaul.model.js";
import { allowedBranchIds } from "./branchAccess.middleware.js";

export function flightBranchIds(request: Request) {
  return allowedBranchIds(request);
}

function canAccessBranch(request: Request, branchId: unknown) {
  const allowed = flightBranchIds(request);
  return allowed === null || allowed.includes(String(branchId));
}

export function requireRequestedFlightBranch(request: Request, response: Response, next: NextFunction) {
  const branchId = typeof request.body?.branchId === "string" ? request.body.branchId : "";
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    return response.status(400).json({ success: false, message: "Select a valid branch." });
  }
  if (!canAccessBranch(request, branchId)) {
    return response.status(403).json({ success: false, message: "You do not have access to this branch." });
  }
  return next();
}

export async function requireFlightBranch(request: Request, response: Response, next: NextFunction) {
  const flightId = String(request.params.flightId ?? "");
  if (!mongoose.Types.ObjectId.isValid(flightId)) {
    return response.status(404).json({ success: false, message: "Flight was not found." });
  }
  const flight = await FlightLinehaul.findById(flightId).select("branchId").lean().exec();
  if (!flight) return response.status(404).json({ success: false, message: "Flight was not found." });
  if (!canAccessBranch(request, flight.branchId)) {
    return response.status(403).json({ success: false, message: "You do not have access to this flight's branch." });
  }
  return next();
}
