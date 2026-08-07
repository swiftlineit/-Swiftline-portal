import "dotenv/config";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import { listShipmentCancellations } from "./src/controllers/shipmentCancellation.controller.js";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI ?? "");
  let body: any;
  const res = { status() { return res; }, json(p: any) { body = p; return res; } } as unknown as Response;
  const req = { user: { _id: new mongoose.Types.ObjectId(), role: "admin" }, query: {}, params: {}, body: {} } as unknown as Request;

  await listShipmentCancellations(req, res);
  for (const row of (body?.cancellations ?? []).slice(0, 3)) {
    console.log(row.shipmentReference, "| customerType:", row.customerType,
      "| account:", row.businessAccount?.companyName, "| refundable:", row.refundableAmountMinor);
  }
  await mongoose.disconnect();
}
void main();
