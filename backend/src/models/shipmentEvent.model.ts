import mongoose from "mongoose";

export const shipmentEventStatusValues = [
  "SHIPMENT_CREATED",
  "SHIPMENT_BOOKED",
  "SHIPMENT_CANCELLED",
  "ON_HOLD",
  "RELEASED_FROM_HOLD",
  "PARCEL_COLLECTED",
  "WAREHOUSE_SCAN_IN",
  "EXPORT_CUSTOMS_CLEARED",
  "FLIGHT_ASSIGNED",
  "FLIGHT_DEPARTED",
  "DESTINATION_ARRIVED",
  "IMPORT_CUSTOMS_CLEARANCE",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURNED",
  "LOST",
  "DAMAGED"
] as const;

export const shipmentOperationalStatusValues = [
  "PARCEL_COLLECTED",
  "WAREHOUSE_SCAN_IN",
  "EXPORT_CUSTOMS_CLEARED",
  "FLIGHT_ASSIGNED",
  "FLIGHT_DEPARTED",
  "DESTINATION_ARRIVED",
  "IMPORT_CUSTOMS_CLEARANCE",
  "OUT_FOR_DELIVERY",
  "DELIVERED"
] as const;

export const shipmentHoldReasonValues = [
  "missing_documents",
  "customs_query",
  "payment_issue",
  "customer_request",
  "address_issue",
  "restricted_item_check",
  "operational_delay",
  // A shipment that missed its flight or road connection. Recorded as a hold so
  // the client is told why it stopped moving, rather than left to infer it from
  // a gap between "flight assigned" and the next scan.
  "missed_connection",
  "other"
] as const;

export type ShipmentEventStatus = (typeof shipmentEventStatusValues)[number];
export type ShipmentHoldReason = (typeof shipmentHoldReasonValues)[number];

export interface IShipmentEvent extends mongoose.Document {
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId?: mongoose.Types.ObjectId | null;
  status: ShipmentEventStatus;
  holdReason?: ShipmentHoldReason | null;
  note: string;
  /**
   * Where the scan happened, as Operations typed it- "Delhi Hub",
   * "Heathrow, London", "Dubai Customs".
   *
   * Optional on purpose. It is free text keyed in alongside the event, so most
   * historical events have none and some new ones will not either. Readers show
   * the newest event that has one as the shipment's current location and treat
   * an empty string as "not recorded", never as "nowhere".
   */
  location: string;
  customerVisible: boolean;
  createdBy: mongoose.Types.ObjectId;
  eventAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const shipmentEventSchema = new mongoose.Schema<IShipmentEvent>(
  {
    shipmentDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShipmentDraft",
      required: true,
      index: true
    },
    dpdShipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DpdShipment",
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: shipmentEventStatusValues,
      required: true,
      index: true
    },
    holdReason: {
      type: String,
      enum: [...shipmentHoldReasonValues, null],
      default: null
    },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    location: { type: String, trim: true, maxlength: 120, default: "" },
    customerVisible: { type: Boolean, default: true, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    eventAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

shipmentEventSchema.index({ shipmentDraftId: 1, eventAt: -1 });
shipmentEventSchema.index({ dpdShipmentId: 1, eventAt: -1 });

export const ShipmentEvent = mongoose.model<IShipmentEvent>(
  "ShipmentEvent",
  shipmentEventSchema
);
