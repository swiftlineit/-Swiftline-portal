import mongoose from "mongoose";

export const deliveryPartnerStatusValues = ["ACTIVE", "SUSPENDED", "DISABLED"] as const;

export interface IDeliveryPartner extends mongoose.Document {
  name: string;
  code: string;
  countries: string[];
  contactName: string;
  email: string;
  phone: string;
  contractReference: string;
  podSlaHours: number;
  status: (typeof deliveryPartnerStatusValues)[number];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<IDeliveryPartner>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 24, unique: true, index: true },
  countries: [{ type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2 }],
  contactName: { type: String, trim: true, maxlength: 120, default: "" },
  email: { type: String, trim: true, lowercase: true, maxlength: 160, default: "" },
  phone: { type: String, trim: true, maxlength: 30, default: "" },
  contractReference: { type: String, trim: true, maxlength: 80, default: "" },
  podSlaHours: { type: Number, min: 1, max: 720, default: 48 },
  status: { type: String, enum: deliveryPartnerStatusValues, default: "ACTIVE", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }
}, { timestamps: true });

schema.index({ status: 1, name: 1 });
export const DeliveryPartner = mongoose.model<IDeliveryPartner>("DeliveryPartner", schema);
