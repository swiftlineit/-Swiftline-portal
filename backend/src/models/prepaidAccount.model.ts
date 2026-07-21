import mongoose from "mongoose";
import { isMinorUnitInteger, prepaidCurrencyValues, type PrepaidCurrency } from "./financialTypes.js";

export const prepaidAccountStatusValues = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;
export type PrepaidAccountStatus = (typeof prepaidAccountStatusValues)[number];

export interface IPrepaidAccount extends mongoose.Document {
  businessAccountId: mongoose.Types.ObjectId;
  currency: PrepaidCurrency;
  cashBalanceMinor: number;
  reservedBalanceMinor: number;
  status: PrepaidAccountStatus;
  version: number;
  minimumBalanceWarningMinor: number;
  createdAt: Date;
  updatedAt: Date;
}

const prepaidAccountSchema = new mongoose.Schema<IPrepaidAccount>(
  {
    businessAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessAccount",
      required: true,
      unique: true,
      index: true
    },
    currency: { type: String, enum: prepaidCurrencyValues, default: "INR", required: true },
    cashBalanceMinor: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: isMinorUnitInteger, message: "cashBalanceMinor must be an integer minor-unit amount" }
    },
    reservedBalanceMinor: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: isMinorUnitInteger, message: "reservedBalanceMinor must be an integer minor-unit amount" }
    },
    status: { type: String, enum: prepaidAccountStatusValues, default: "ACTIVE", index: true },
    version: { type: Number, default: 0, min: 0, validate: { validator: isMinorUnitInteger, message: "version must be an integer" } },
    minimumBalanceWarningMinor: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: isMinorUnitInteger, message: "minimumBalanceWarningMinor must be an integer minor-unit amount" }
    }
  },
  { timestamps: true }
);

export const PrepaidAccount = mongoose.model<IPrepaidAccount>(
  "PrepaidAccount",
  prepaidAccountSchema
);
