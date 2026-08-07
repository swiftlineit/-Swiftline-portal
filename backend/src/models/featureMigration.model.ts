import mongoose from "mongoose";

interface IFeatureMigration {
  _id: string;
  appliedAt: Date;
  report: Record<string, unknown>;
}

const featureMigrationSchema = new mongoose.Schema<IFeatureMigration>({
  _id: { type: String, required: true },
  appliedAt: { type: Date, required: true },
  report: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { versionKey: false });

export const FeatureMigration = mongoose.model<IFeatureMigration>(
  "FeatureMigration",
  featureMigrationSchema
);
