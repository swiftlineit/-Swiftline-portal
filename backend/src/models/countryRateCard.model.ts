import mongoose from "mongoose";

export const countryRateServiceValues = ["COURIER", "CARGO"] as const;
export type CountryRateService = (typeof countryRateServiceValues)[number];

export interface ICountryRateCard extends mongoose.Document {
  countryCode: string;
  countryName: string;
  service: CountryRateService;
  fromKg: number;
  toKg: number;
  chargesPerKg: number;
  maxBoxKg: number;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const countryRateCardSchema = new mongoose.Schema<ICountryRateCard>(
  {
    countryCode: { type: String, uppercase: true, trim: true, required: true, minlength: 2, maxlength: 2, index: true },
    countryName: { type: String, trim: true, required: true, maxlength: 80 },
    service: { type: String, enum: countryRateServiceValues, required: true, index: true },
    fromKg: { type: Number, required: true, min: 0 },
    toKg: { type: Number, required: true, min: 0 },
    chargesPerKg: { type: Number, required: true, min: 0 },
    maxBoxKg: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

countryRateCardSchema.index({ countryCode: 1, service: 1, fromKg: 1, toKg: 1 });

export const CountryRateCard = mongoose.model<ICountryRateCard>(
  "CountryRateCard",
  countryRateCardSchema
);
