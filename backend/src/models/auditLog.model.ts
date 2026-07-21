import mongoose from "mongoose";

export type AuditAction =
  | "BRANCH_CREATED"
  | "BRANCH_DRAFT_CREATED"
  | "BRANCH_UPDATED"
  | "DPD_CONFIGURATION_CREATED"
  | "DPD_CONFIGURATION_UPDATED"
  | "INVOICE_UPLOADED"
  | "INVOICE_PARSED"
  | "INVOICE_EXTRACTION_FAILED"
  | "SHIPMENT_DRAFT_CREATED"
  | "SHIPMENT_DRAFT_UPDATED"
  | "SHIPMENT_VALIDATION_COMPLETED"
  | "ADDRESS_SELECTED"
  | "ADDRESS_MANUALLY_MODIFIED"
  | "ADDRESS_VALIDATED"
  | "SUGGESTED_ADDRESS_ACCEPTED"
  | "SUGGESTED_ADDRESS_REJECTED"
  | "DPD_REQUEST_INITIATED"
  | "DPD_REQUEST_SUCCEEDED"
  | "DPD_REQUEST_FAILED"
  | "LABEL_DOWNLOADED"
  | "SHIPMENT_HELD"
  | "SHIPMENT_RELEASED"
  | "SHIPMENT_STATUS_UPDATED"
  | "SHIPMENT_AMENDMENT_REQUESTED"
  | "SHIPMENT_AMENDMENT_REJECTED"
  | "SHIPMENT_AMENDMENT_APPLIED"
  | "SHIPMENT_INVOICE_GENERATED"
  | "SHIPMENT_INVOICE_DOWNLOADED"
  | "SHIPMENT_CHARGE_VERIFIED"
  | "SHIPMENT_CANCELLATION_REQUESTED"
  | "SHIPMENT_CANCELLATION_REJECTED"
  | "SHIPMENT_CANCELLATION_COMPLETED"
  | "SHIPMENT_MANIFEST_GENERATED"
  | "SHIPMENT_MANIFEST_DOWNLOADED"
  | "SHIPMENT_QUOTE_REQUESTED"
  | "SHIPMENT_QUOTE_UNDER_REVIEW"
  | "SHIPMENT_QUOTE_PUBLISHED"
  | "SHIPMENT_QUOTE_DECLINED"
  | "SHIPMENT_QUOTE_CONVERTED"
  | "CREDIT_ACCOUNT_ACTIVATED"
  | "CREDIT_AGREEMENT_DRAFT_CREATED"
  | "CREDIT_AGREEMENT_GENERATED"
  | "CREDIT_AGREEMENT_VIEWED"
  | "CREDIT_AGREEMENT_SIGNED"
  | "CREDIT_BILLING_STATEMENT_ISSUED"
  | "CREDIT_BILLING_STATEMENT_DOWNLOADED"
  | "CREDIT_PAYMENT_SUBMITTED"
  | "CREDIT_PAYMENT_VERIFIED"
  | "SECURITY_DEPOSIT_RECEIVED";
export type AuditEntityType =
  | "BRANCH"
  | "DPD_CONFIGURATION"
  | "INVOICE_UPLOAD"
  | "SHIPMENT_DRAFT"
  | "DPD_SHIPMENT"
  | "LABEL_DOCUMENT"
  | "SHIPMENT_AMENDMENT"
  | "SHIPMENT_INVOICE"
  | "SHIPMENT_CANCELLATION"
  | "SHIPMENT_CREDIT_NOTE"
  | "CANCELLATION_FEE_INVOICE"
  | "SHIPMENT_MANIFEST"
  | "SHIPMENT_QUOTE"
  | "BUSINESS_ACCOUNT"
  | "BUSINESS_CREDIT_ACCOUNT"
  | "CREDIT_BILLING_STATEMENT"
  | "CREDIT_PAYMENT"
  | "CREDIT_AGREEMENT";

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
