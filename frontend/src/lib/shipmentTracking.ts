/**
 * Shapes the tracking pages share.
 *
 * Client and staff tracking read two different endpoints but render one page,
 * so these live apart from either lib- a field added to one payload and not
 * the other is exactly the drift that left staff without a delivery estimate.
 */

/** The shipment's own facts, as the tracking details panel lists them. */
export type TrackingSummary = {
  serviceType: string;
  serviceCode: string;
  carrierName: string;
  pieces: number;
  actualWeightKg: number;
  chargeableWeightKg: number;
  customerReference: string;
  lastUpdateAt: string | null;
};

/** Something the customer has to do before the shipment can move on. */
export type TrackingAttention = {
  label: string;
  detail: string;
  holdReason: string;
};

/** The best customer-safe answer to where the shipment is now. */
export type TrackingPosition = {
  label: string;
  source: "RECORDED" | "INFERRED" | "PENDING";
  basisStatus: string;
  holdReasonLabel: string;
};
