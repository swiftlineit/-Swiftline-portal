import mongoose from "mongoose";

/**
 * Correspondence on a claim.
 *
 * Internal notes and client-facing messages share one collection so the review
 * workspace can show a single thread, with `visibility` deciding what the client
 * sees. Keeping them apart would mean two threads to reconcile and a real risk
 * of replying in the wrong one.
 */
export interface IClaimMessage extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  authorUserId: mongoose.Types.ObjectId;
  authorKind: "CLIENT" | "STAFF";
  body: string;
  /** INTERNAL is never returned by any client-facing endpoint. */
  visibility: "PUBLIC" | "INTERNAL";
  /** Documents referenced by this message, for an evidence-with-comment reply. */
  attachedDocumentIds: mongoose.Types.ObjectId[];
  readByClientAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const claimMessageSchema = new mongoose.Schema<IClaimMessage>(
  {
    claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true, index: true },
    authorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    authorKind: { type: String, enum: ["CLIENT", "STAFF"], required: true, immutable: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
    visibility: { type: String, enum: ["PUBLIC", "INTERNAL"], default: "PUBLIC", required: true, index: true },
    attachedDocumentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "ClaimDocument" }],
    readByClientAt: { type: Date, default: null }
  },
  { timestamps: true }
);

claimMessageSchema.index({ claimId: 1, createdAt: -1 });
claimMessageSchema.index({ claimId: 1, visibility: 1, createdAt: -1 });

export const ClaimMessage = mongoose.model<IClaimMessage>("ClaimMessage", claimMessageSchema);
