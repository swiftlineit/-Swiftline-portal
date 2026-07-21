import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AmendmentBillingError } from "../services/amendmentBilling.service.js";
import {
  finalizeShipmentChargeVerification,
  getShipmentChargeVerificationState,
  previewShipmentChargeVerification,
  ShipmentChargeVerificationError
} from "../services/shipmentChargeVerification.service.js";

const verifiedParcelSchema = z.object({
  sequence: z.number().int().positive(),
  actualWeightKg: z.number().positive().max(10000),
  lengthCm: z.number().positive().max(10000),
  widthCm: z.number().positive().max(10000),
  heightCm: z.number().positive().max(10000)
});

const previewSchema = z.object({
  parcels: z.array(verifiedParcelSchema).min(1).max(500)
});

const finalizeSchema = previewSchema.extend({
  expectedTotalAmountMinor: z.number().int().nonnegative(),
  note: z.string().trim().max(500).optional().default("")
});

function userId(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function shipmentId(request: Request) {
  const id = typeof request.params.id === "string" ? request.params.id : "";
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function sendError(response: Response, error: unknown) {
  if (error instanceof ShipmentChargeVerificationError || error instanceof AmendmentBillingError) {
    return response.status(error.statusCode).json({ success: false, message: error.message });
  }
  throw error;
}

export async function getShipmentChargeVerification(request: Request, response: Response): Promise<Response> {
  const dpdShipmentId = shipmentId(request);
  if (!dpdShipmentId) return response.status(404).json({ success: false, message: "Shipment not found." });

  try {
    const state = await getShipmentChargeVerificationState(dpdShipmentId);
    return response.status(200).json({ success: true, ...state });
  } catch (error) {
    return sendError(response, error);
  }
}

export async function previewFinalShipmentCharge(request: Request, response: Response): Promise<Response> {
  const dpdShipmentId = shipmentId(request);
  if (!dpdShipmentId) return response.status(404).json({ success: false, message: "Shipment not found." });
  const parsed = previewSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Enter a valid final weight and all three dimensions for every parcel."
    });
  }

  try {
    const preview = await previewShipmentChargeVerification({ dpdShipmentId, parcels: parsed.data.parcels });
    return response.status(200).json({ success: true, preview });
  } catch (error) {
    return sendError(response, error);
  }
}

export async function finalizeFinalShipmentCharge(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const dpdShipmentId = shipmentId(request);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  if (!dpdShipmentId) return response.status(404).json({ success: false, message: "Shipment not found." });
  const parsed = finalizeSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Check the final parcel measurements and charge preview."
    });
  }

  try {
    const verification = await finalizeShipmentChargeVerification({
      dpdShipmentId,
      parcels: parsed.data.parcels,
      expectedTotalAmountMinor: parsed.data.expectedTotalAmountMinor,
      note: parsed.data.note,
      verifiedBy: currentUserId
    });
    return response.status(201).json({
      success: true,
      message: "Final shipment weight and charge verified.",
      verification
    });
  } catch (error) {
    return sendError(response, error);
  }
}
