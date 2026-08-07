import mongoose from "mongoose";

export const deliverySubroleValues = ["DRIVER", "DELIVERY_PERSON", "SUPERVISOR"] as const;
export const driverEngagementTypeValues = ["INTERNAL", "DIRECT_CONTRACTOR", "VENDOR"] as const;
export const driverProfileStatusValues = ["INVITED", "PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "DISABLED"] as const;

export type DeliverySubrole = (typeof deliverySubroleValues)[number];
export type DriverEngagementType = (typeof driverEngagementTypeValues)[number];
export type DriverProfileStatus = (typeof driverProfileStatusValues)[number];

export interface IDriverProfile extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  deliverySubrole: DeliverySubrole;
  engagementType: DriverEngagementType;
  status: DriverProfileStatus;
  licenceNumber?: string;
  licenceExpiry?: Date | null;
  approvedVehicleTypes: string[];
  vendorId?: mongoose.Types.ObjectId | null;
  deliveryPartnerId?: mongoose.Types.ObjectId | null;
  notes?: string;
  createdBy: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId | null;
  approvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const driverProfileSchema = new mongoose.Schema<IDriverProfile>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    deliverySubrole: { type: String, enum: deliverySubroleValues, required: true, index: true },
    engagementType: { type: String, enum: driverEngagementTypeValues, required: true, index: true },
    status: { type: String, enum: driverProfileStatusValues, default: "INVITED", required: true, index: true },
    licenceNumber: { type: String, trim: true, uppercase: true, maxlength: 80, default: "" },
    licenceExpiry: { type: Date, default: null },
    approvedVehicleTypes: [{ type: String, trim: true, maxlength: 60 }],
    // Reserved for the vendor-driver phase. Internal and direct-contractor
    // profiles intentionally keep this null.
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryVendor", default: null, index: true },
    // Destination delivery personnel can belong to an overseas partner. Swiftline
    // internal and direct-contractor profiles intentionally keep this null.
    deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryPartner", default: null, index: true },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

driverProfileSchema.index({ status: 1, engagementType: 1, createdAt: -1 });

export const DriverProfile = mongoose.model<IDriverProfile>("DriverProfile", driverProfileSchema);
