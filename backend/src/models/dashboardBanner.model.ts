import mongoose from "mongoose";

export interface IDashboardBannerImage {
  originalName: string;
  storageKey: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

export interface IDashboardBanner extends mongoose.Document {
  image: IDashboardBannerImage;
  heading: string;
  description: string;
  order: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  active: boolean;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const dashboardBannerImageSchema = new mongoose.Schema<IDashboardBannerImage>(
  {
    originalName: { type: String, required: true, trim: true, maxlength: 200 },
    storageKey: { type: String, required: true, trim: true, maxlength: 1024 },
    mimeType: { type: String, required: true, enum: ["image/jpeg", "image/png", "image/webp"] },
    size: { type: Number, required: true, min: 1 },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const dashboardBannerSchema = new mongoose.Schema<IDashboardBanner>(
  {
    image: { type: dashboardBannerImageSchema, required: true },
    heading: { type: String, trim: true, maxlength: 120, default: "" },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    order: { type: Number, min: 0, default: 0, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

dashboardBannerSchema.index({ active: 1, startsAt: 1, endsAt: 1 });

export const DashboardBanner = mongoose.model<IDashboardBanner>("DashboardBanner", dashboardBannerSchema);
