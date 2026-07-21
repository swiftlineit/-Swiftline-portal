import mongoose from "mongoose";
import { SwiftlineTrackingCounter } from "../models/swiftlineTrackingCounter.model.js";

function indiaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    displayDate: `${value("day")}${value("month")}${value("year")}`,
    dateKey: `${value("year")}${value("month")}${value("day")}`
  };
}

export function normalizeBranchLabelCode(labelCode: string) {
  const normalized = labelCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(normalized)) {
    throw new Error("BRANCH_LABEL_CODE_REQUIRED");
  }
  return normalized;
}

export function resolveBranchLabelCode(labelCode: string | undefined, branchCode: string) {
  if (labelCode?.trim()) return normalizeBranchLabelCode(labelCode);

  const prefix = branchCode.split("-")[0]?.replace(/[^A-Z0-9]/gi, "").toUpperCase() ?? "";
  if (prefix.length >= 3) return normalizeBranchLabelCode(`${prefix[0]}${prefix[prefix.length - 1]}`);
  return normalizeBranchLabelCode(prefix);
}

export function formatSwiftlineTrackingNumber(input: {
  branchLabelCode: string;
  date: Date;
  sequence: number;
}) {
  const { displayDate } = indiaDateParts(input.date);
  return `SL${normalizeBranchLabelCode(input.branchLabelCode)}${displayDate}${String(input.sequence).padStart(6, "0")}`;
}

export function formatSwiftlineParcelNumber(trackingNumber: string, parcelIndex: number, parcelCount: number) {
  return parcelCount === 1
    ? trackingNumber
    : `${trackingNumber}P${String(parcelIndex + 1).padStart(2, "0")}`;
}

export async function allocateSwiftlineTrackingNumber(input: {
  branchId: mongoose.Types.ObjectId;
  branchLabelCode: string;
  date?: Date;
}) {
  const date = input.date ?? new Date();
  const { dateKey } = indiaDateParts(date);
  const counter = await SwiftlineTrackingCounter.findOneAndUpdate(
    { branchId: input.branchId, dateKey },
    {
      $inc: { sequence: 1 },
      $setOnInsert: { branchId: input.branchId, dateKey }
    },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).exec();

  if (!counter) throw new Error("SWIFTLINE_TRACKING_ALLOCATION_FAILED");
  return formatSwiftlineTrackingNumber({
    branchLabelCode: input.branchLabelCode,
    date,
    sequence: counter.sequence
  });
}
