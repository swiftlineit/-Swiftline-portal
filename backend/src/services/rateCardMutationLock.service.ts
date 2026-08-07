import { randomUUID } from "node:crypto";
import { RateCardMutationLock } from "../models/rateCardMutationLock.model.js";
import type { CountryRateService, RateCardBand } from "../models/countryRateCard.model.js";

const LOCK_LEASE_MS = 30_000;

export class RateCardRouteBusyError extends Error {
  readonly code = "RATE_CARD_ROUTE_BUSY";
  readonly statusCode = 409;

  constructor() {
    super("This route is being changed by another user. Please try again.");
    this.name = "RateCardRouteBusyError";
  }
}

export async function acquireRateCardRouteLock(input: {
  band: RateCardBand;
  countryCode: string;
  service: CountryRateService;
}) {
  const key = [input.band, input.countryCode, input.service].join(":");
  const owner = randomUUID();
  const now = new Date();

  try {
    const lock = await RateCardMutationLock.findOneAndUpdate(
      {
        _id: key,
        $or: [
          { lockedUntil: { $lte: now } },
          { owner }
        ]
      },
      {
        $set: {
          owner,
          lockedUntil: new Date(now.getTime() + LOCK_LEASE_MS)
        }
      },
      { upsert: true, returnDocument: "after" }
    ).lean().exec();

    if (!lock || lock.owner !== owner) throw new RateCardRouteBusyError();
  } catch (error) {
    if (error instanceof RateCardRouteBusyError) throw error;
    if ((error as { code?: number }).code === 11000) throw new RateCardRouteBusyError();
    throw error;
  }

  return async () => {
    await RateCardMutationLock.deleteOne({ _id: key, owner }).exec();
  };
}
