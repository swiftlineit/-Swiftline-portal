import mongoose from "mongoose";
import { regulatoryRegionCodes } from "../services/reference/regulatoryRegions.js";

/**
 * A customs or regulatory change published to clients: a duty threshold moving,
 * a new document a destination demands, a customs system outage.
 *
 * Deliberately a separate collection from `OperationalCalendarEntry`. A holiday
 * is a date the network is shut; a regulatory update is a rule that applies
 * over a window and tells a client what to *do* about it. Mixing them would
 * force one form to ask for both a cut-off time and a duty threshold.
 */

export const regulatoryUpdateCategoryValues = [
  "CUSTOMS_RULE_CHANGE",
  "DUTY_VAT_CHANGE",
  "DOCUMENTATION_REQUIREMENT",
  "RESTRICTED_PROHIBITED_GOODS",
  "CLEARANCE_REQUIREMENT",
  "SECURITY_ENS_REQUIREMENT",
  "DE_MINIMIS_LOW_VALUE_CHANGE",
  "CUSTOMS_SYSTEM_DISRUPTION",
  "REGULATORY_NOTICE",
  "ECCS_NOT_RESPONDED",
  "HIGH_ALERT_IGI_AIRPORT",
  "OTHER"
] as const;

export const regulatoryUpdateStatusValues = ["UPCOMING", "ACTIVE", "EXPIRED"] as const;

/** Which leg of the journey the rule bites on. */
export const regulatoryShipmentDirectionValues = ["ALL", "IMPORT", "EXPORT"] as const;

export const regulatoryShipmentTypeValues = ["ALL", "DOCUMENTS", "PARCELS", "CARGO", "COURIER"] as const;

export type RegulatoryUpdateCategory = (typeof regulatoryUpdateCategoryValues)[number];
export type RegulatoryUpdateStatus = (typeof regulatoryUpdateStatusValues)[number];
export type RegulatoryShipmentDirection = (typeof regulatoryShipmentDirectionValues)[number];
export type RegulatoryShipmentType = (typeof regulatoryShipmentTypeValues)[number];

export interface IRegulatoryUpdate extends mongoose.Document {
  /** One or more country/region codes from `regulatoryRegions`. Never empty. */
  regions: string[];
  category: RegulatoryUpdateCategory;
  title: string;
  /**
   * When the rule takes effect. Null means "to be confirmed"- governments
   * routinely announce a reform months before naming a date, and clients still
   * need to see it, so the date is optional while `effectiveFromTbc` records
   * that the gap is intentional rather than a half-filled form.
   */
  effectiveFrom?: Date | null;
  effectiveFromTbc: boolean;
  /** Optional end. Null means the rule runs until withdrawn. */
  effectiveUntil?: Date | null;
  /**
   * Normally null: status is derived from the dates so an entry can never sit
   * stale as "Active" after its window closes. Set only to pin a status the
   * dates cannot express- typically an Upcoming reform with no date yet.
   */
  statusOverride?: RegulatoryUpdateStatus | null;
  affectedShipments: RegulatoryShipmentDirection[];
  shipmentTypes: RegulatoryShipmentType[];
  /** Free text, not a number: real thresholds read "£135 and below". */
  valueThreshold?: string | null;
  customerImpact: string;
  actionRequired?: string;
  /** Link to the issuing authority's notice (HMRC, CBIC, CBP...). */
  sourceUrl?: string | null;
  /** Only active updates reach clients. This is the "Publish" switch. */
  active: boolean;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const regulatoryUpdateSchema = new mongoose.Schema<IRegulatoryUpdate>(
  {
    regions: {
      type: [{ type: String, enum: regulatoryRegionCodes, uppercase: true, trim: true }],
      required: true,
      index: true,
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length > 0,
        message: "Choose at least one country or region."
      }
    },
    category: { type: String, enum: regulatoryUpdateCategoryValues, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    effectiveFrom: { type: Date, default: null, index: true },
    effectiveFromTbc: { type: Boolean, default: false },
    effectiveUntil: { type: Date, default: null },
    statusOverride: { type: String, enum: [...regulatoryUpdateStatusValues, null], default: null },
    affectedShipments: {
      type: [{ type: String, enum: regulatoryShipmentDirectionValues }],
      default: ["ALL"]
    },
    shipmentTypes: {
      type: [{ type: String, enum: regulatoryShipmentTypeValues }],
      default: ["ALL"]
    },
    valueThreshold: { type: String, trim: true, maxlength: 80, default: null },
    customerImpact: { type: String, required: true, trim: true, maxlength: 800 },
    actionRequired: { type: String, trim: true, maxlength: 800, default: "" },
    sourceUrl: { type: String, trim: true, maxlength: 500, default: null },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

// Both the client list and the admin table read published updates newest-window
// first, so the compound index matches that sort exactly.
regulatoryUpdateSchema.index({ active: 1, effectiveFrom: -1, createdAt: -1 });

/**
 * The status a client sees. Derived rather than stored so an update that ran
 * out yesterday reads "Expired" today without anyone editing it; an explicit
 * `statusOverride` still wins for the cases the dates cannot express.
 */
export function deriveRegulatoryUpdateStatus(
  update: Pick<IRegulatoryUpdate, "effectiveFrom" | "effectiveUntil" | "statusOverride">,
  now: Date = new Date()
): RegulatoryUpdateStatus {
  if (update.statusOverride) return update.statusOverride;

  const reference = now.getTime();
  const until = update.effectiveUntil ? new Date(update.effectiveUntil).getTime() : null;
  if (until !== null && until < reference) return "EXPIRED";

  // No start date means the reform is announced but undated: upcoming until
  // someone fills the date in or pins a status.
  if (!update.effectiveFrom) return "UPCOMING";

  return new Date(update.effectiveFrom).getTime() <= reference ? "ACTIVE" : "UPCOMING";
}

export const RegulatoryUpdate = mongoose.model<IRegulatoryUpdate>(
  "RegulatoryUpdate",
  regulatoryUpdateSchema
);
