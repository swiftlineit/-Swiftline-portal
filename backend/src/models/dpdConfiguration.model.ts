import mongoose from "mongoose";

export const dpdEnvironmentValues = ["TEST", "PRODUCTION"] as const;
export const dpdLabelSizeValues = ["A4", "A6"] as const;
export const dpdPrintFormatValues = ["PDF", "ZPL"] as const;

export type DpdEnvironment = (typeof dpdEnvironmentValues)[number];
export type DpdLabelSize = (typeof dpdLabelSizeValues)[number];
export type DpdPrintFormat = (typeof dpdPrintFormatValues)[number];

export interface IDpdConfiguration extends mongoose.Document {
  branchId: mongoose.Types.ObjectId;
  environment: DpdEnvironment;
  businessUnitCode: string;
  customerId: string;
  senderAddressId: string;
  depotCode: string;
  defaultServiceCode: string;
  defaultLabelSize: DpdLabelSize;
  defaultPrintFormat: DpdPrintFormat;
  encryptedCredentials: string;
  active: boolean;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const dpdConfigurationSchema = new mongoose.Schema<IDpdConfiguration>(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true
    },
    environment: { type: String, enum: dpdEnvironmentValues, required: true, index: true },
    businessUnitCode: { type: String, required: true, trim: true, maxlength: 80 },
    customerId: { type: String, required: true, trim: true, maxlength: 80 },
    senderAddressId: { type: String, required: true, trim: true, maxlength: 80 },
    depotCode: { type: String, trim: true, maxlength: 40, default: "" },
    defaultServiceCode: { type: String, required: true, trim: true, maxlength: 40 },
    defaultLabelSize: { type: String, enum: dpdLabelSizeValues, default: "A6" },
    defaultPrintFormat: { type: String, enum: dpdPrintFormatValues, default: "PDF" },
    encryptedCredentials: { type: String, required: true, select: false },
    active: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

dpdConfigurationSchema.index({ branchId: 1, environment: 1 }, { unique: true });
dpdConfigurationSchema.index(
  { branchId: 1, environment: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

export const DpdConfiguration = mongoose.model<IDpdConfiguration>(
  "DpdConfiguration",
  dpdConfigurationSchema
);
