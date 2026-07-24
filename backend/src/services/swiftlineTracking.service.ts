import { SwiftlineStationCounter } from "../models/swiftlineStationCounter.model.js";

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
    displayDate: `${value("day")}${value("month")}${value("year").slice(-2)}`,
    dateKey: `${value("year")}${value("month")}${value("day")}`
  };
}

export function normalizeStationCode(stationCode: string) {
  const normalized = stationCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("STATION_CODE_REQUIRED");
  }
  return normalized;
}

export function resolveStationCode(stationCode: string | undefined, branchCode: string) {
  if (stationCode?.trim()) {
    try {
      return normalizeStationCode(stationCode);
    } catch {
      // Older branches may still have a two-character label code. Their
      // branch code remains a safe fallback until the station code is updated.
    }
  }

  const prefix = branchCode.split("-")[0]?.trim().toUpperCase() ?? "";
  return normalizeStationCode(prefix);
}

export function formatSwiftlineTrackingNumber(input: {
  stationCode: string;
  date: Date;
  sequence: number;
}) {
  const { displayDate } = indiaDateParts(input.date);
  return `SLC${normalizeStationCode(input.stationCode)}${displayDate}${String(input.sequence).padStart(3, "0")}`;
}

export function formatSwiftlineParcelNumber(trackingNumber: string, parcelIndex: number) {
  return `${trackingNumber}-${String(parcelIndex + 1).padStart(2, "0")}`;
}

export async function allocateSwiftlineTrackingNumber(input: {
  stationCode: string;
  date?: Date;
}) {
  const date = input.date ?? new Date();
  const { dateKey } = indiaDateParts(date);
  const stationCode = normalizeStationCode(input.stationCode);
  const counter = await SwiftlineStationCounter.findOneAndUpdate(
    { stationCode, dateKey },
    {
      $inc: { sequence: 1 },
      $setOnInsert: { stationCode, dateKey }
    },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).exec();

  if (!counter) throw new Error("SWIFTLINE_TRACKING_ALLOCATION_FAILED");
  return formatSwiftlineTrackingNumber({
    stationCode: input.stationCode,
    date,
    sequence: counter.sequence
  });
}
