import mongoose from "mongoose";

export type AuditAction = "BRANCH_CREATED" | "BRANCH_DRAFT_CREATED" | "BRANCH_UPDATED";
export type AuditEntityType = "BRANCH";

export interface IAuditLog extends mongoose.Document {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: mongoose.Types.ObjectId;
  performedBy: mongoose.Types.ObjectId;
  performedAt: Date;
  metadata: Record<string, unknown>;
}

const auditLogSchema = new mongoose.Schema<IAuditLog>(
  {
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    performedAt: { type: Date, default: Date.now, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: false }
);

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
