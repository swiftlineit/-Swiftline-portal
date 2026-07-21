export type ReconciliationClassification =
  | "NO_ACTION_REQUIRED"
  | "AUTO_REPAIRED"
  | "MANUAL_REVIEW_REQUIRED";

export type ReconciliationFinding = {
  classification: ReconciliationClassification;
  message: string;
  referenceId?: string;
};

export function createNoopReconciliationFinding(): ReconciliationFinding {
  return {
    classification: "NO_ACTION_REQUIRED",
    message: "Reconciliation jobs are implemented after Razorpay integration."
  };
}
