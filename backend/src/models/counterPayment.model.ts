import mongoose from "mongoose";

/**
 * Money collected from, or refunded to, a walk-in customer for an individual
 * shipment. Those customers pay into the company's own accounts rather than
 * through the portal, so this is the portal's record of a movement that happened
 * elsewhere- it is evidence, not a payment instrument.
 *
 * Deliberately separate from `CreditPayment`, which supports the same methods but
 * is bound to a `BusinessCreditAccount` and drives credit balances. Individual
 * shipments have no credit account, and writing them through the credit models
 * would corrupt the balances of the sentinel account they are booked against.
 * Keeping them here means the credit ledger continues to mean exactly what it
 * means today.
 */
export const counterPaymentDirectionValues = ["COLLECTED", "REFUNDED"] as const;
export type CounterPaymentDirection = (typeof counterPaymentDirectionValues)[number];

export const counterPaymentMethodValues = ["CASH", "UPI", "BANK_TRANSFER", "CARD", "CHEQUE"] as const;
export type CounterPaymentMethod = (typeof counterPaymentMethodValues)[number];

export interface ICounterPayment extends mongoose.Document {
  shipmentDraftId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  direction: CounterPaymentDirection;
  /** Always positive; `direction` carries the sign. */
  amountMinor: number;
  method: CounterPaymentMethod;
  /** UTR, receipt number or cheque number, as applicable to the method. */
  reference: string;
  note: string;
  recordedBy: mongoose.Types.ObjectId;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const counterPaymentSchema = new mongoose.Schema<ICounterPayment>(
  {
    shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true, index: true },
    // Denormalised so the counter-sales report can scope by branch without
    // joining every draft.
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    direction: { type: String, enum: counterPaymentDirectionValues, required: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    method: { type: String, enum: counterPaymentMethodValues, required: true },
    reference: { type: String, trim: true, maxlength: 80, default: "" },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recordedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

// Drives the counter-sales report: a branch's takings over a date range.
counterPaymentSchema.index({ branchId: 1, recordedAt: -1 });

export const CounterPayment = mongoose.model<ICounterPayment>("CounterPayment", counterPaymentSchema);
