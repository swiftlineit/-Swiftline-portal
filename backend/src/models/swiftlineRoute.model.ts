import mongoose from "mongoose";
import { countryRateServiceValues, type CountryRateService } from "./countryRateCard.model.js";

/**
 * One lane Swiftline operates, and how long it takes.
 *
 * A route is origin country + destination country + service — "India → United
 * Kingdom, Courier". Today every shipment leaves India (`consignorCountryCode`
 * in shipmentDraft.model.ts is fixed to "IN"), but the origin is stored rather
 * than assumed so opening a second gateway later is a data change, not a schema
 * change.
 *
 * This is deliberately NOT the same record as `countryRouteCharge.model.ts`,
 * which also keys on destination + service. That one holds money and is banded
 * by customer tier (BAND_A/B/C); a lane's transit time is an operational fact
 * that does not vary by what a customer pays, so storing it there would mean
 * three copies per lane that are free to disagree. Money stays there, time
 * lives here, and neither has to know about the other.
 */

/** Whether the quoted transit time counts working days or plain calendar days. */
export const routeTransitBasisValues = ["BUSINESS_DAYS", "CALENDAR_DAYS"] as const;
export type RouteTransitBasis = (typeof routeTransitBasisValues)[number];

export interface ISwiftlineRoute extends mongoose.Document {
  originCountryCode: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  /**
   * Countries the shipment passes through on the way, in travel order.
   *
   * "India → United Kingdom → Canada" is one lane to Canada that happens to
   * transit the UK, not two lanes. The stops are descriptive: transit time is
   * still entered once for the whole journey, because that is the figure
   * Operations actually knows and the customer actually cares about. Empty for
   * a direct lane.
   */
  viaCountryCodes: string[];
  service: CountryRateService;
  /** Fastest realistic transit, in `transitBasis` units. */
  transitDaysMin: number;
  /**
   * Slowest realistic transit. Estimated delivery is quoted from this rather
   * than the minimum: a date the shipment beats reads as good service, and a
   * date it misses generates a support ticket.
   */
  transitDaysMax: number;
  transitBasis: RouteTransitBasis;
  /**
   * Whether the lane is open for booking. A closed lane keeps its transit
   * history instead of being deleted, so reopening it does not mean re-keying
   * the times.
   */
  serviceable: boolean;
  /**
   * Same-day dispatch cut-off as "HH:mm", 24-hour, in the origin branch's local
   * time. Empty when the lane has no published cut-off. Matches the `time`
   * format already used by `operationalCalendarEntry.model.ts`.
   */
  cutOffTime: string;
  /** What may not travel on this lane, shown by the serviceability checker. */
  restrictions: string;
  /** Operational free text. Never shown to customers. */
  notes: string;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const countryCodeField = {
  type: String,
  uppercase: true,
  trim: true,
  required: true,
  minlength: 2,
  maxlength: 2
};

const swiftlineRouteSchema = new mongoose.Schema<ISwiftlineRoute>(
  {
    originCountryCode: { ...countryCodeField, default: "IN", index: true },
    destinationCountryCode: { ...countryCodeField, index: true },
    // Capped at four: a lane with more legs than that is a routing plan, not a
    // lane, and belongs in a carrier system rather than here.
    viaCountryCodes: {
      type: [{ type: String, uppercase: true, trim: true, minlength: 2, maxlength: 2 }],
      default: [],
      validate: {
        validator: (values: string[]) => values.length <= 4,
        message: "A route may pass through at most four countries."
      }
    },
    destinationCountryName: { type: String, trim: true, required: true, maxlength: 80 },
    service: { type: String, enum: countryRateServiceValues, required: true, index: true },
    // Bounded at 120 so a mistyped "300" cannot quote a delivery date a year out.
    transitDaysMin: { type: Number, required: true, min: 1, max: 120 },
    transitDaysMax: { type: Number, required: true, min: 1, max: 120 },
    transitBasis: {
      type: String,
      enum: routeTransitBasisValues,
      required: true,
      default: "BUSINESS_DAYS"
    },
    serviceable: { type: Boolean, required: true, default: true, index: true },
    cutOffTime: {
      type: String,
      trim: true,
      maxlength: 5,
      default: "",
      validate: {
        validator: (value: string) => value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
        message: "Cut-off time must be a 24-hour time such as 16:30."
      }
    },
    restrictions: { type: String, trim: true, maxlength: 1000, default: "" },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

// A shipment resolves exactly one route, so the lane key has to be unique — two
// rows would leave the estimate depending on which one the query happened to
// return first.
swiftlineRouteSchema.index(
  { originCountryCode: 1, destinationCountryCode: 1, service: 1 },
  { unique: true, name: "uniq_swiftline_route_lane" }
);

// The admin list reads in the order it renders: destination, then service.
swiftlineRouteSchema.index({ destinationCountryCode: 1, service: 1 });

/**
 * The rules a lane must satisfy however it is written.
 *
 * Returns the first problem, or null. Shared by both hooks below because
 * `pre("validate")` covers `save()` while `findOneAndUpdate` — which is how the
 * upsert in the controller writes — never fires document middleware at all.
 * Guarding only one of the two leaves the other silently unchecked.
 */
function findRouteProblem(route: {
  originCountryCode?: string;
  destinationCountryCode?: string;
  viaCountryCodes?: string[];
  transitDaysMin?: number;
  transitDaysMax?: number;
}): { path: string; message: string } | null {
  if (
    typeof route.transitDaysMin === "number"
    && typeof route.transitDaysMax === "number"
    && route.transitDaysMax < route.transitDaysMin
  ) {
    return {
      path: "transitDaysMax",
      message: "Maximum transit days must be greater than or equal to minimum transit days."
    };
  }

  // A stop that repeats, or that is already an endpoint, describes a journey
  // nobody makes and would render as "India → UK → UK → Canada".
  const stops = route.viaCountryCodes ?? [];
  if (new Set(stops).size !== stops.length) {
    return { path: "viaCountryCodes", message: "Each transit country may only appear once." };
  }
  if (
    stops.includes(route.originCountryCode ?? "")
    || stops.includes(route.destinationCountryCode ?? "")
  ) {
    return {
      path: "viaCountryCodes",
      message: "A transit country cannot also be the origin or the destination."
    };
  }

  return null;
}

swiftlineRouteSchema.pre("validate", function ensureRouteIsCoherent() {
  const problem = findRouteProblem(this);
  if (problem) this.invalidate(problem.path, problem.message);
});

swiftlineRouteSchema.pre("findOneAndUpdate", async function ensureUpdatedRouteIsCoherent() {
  // The update may set fields via $set, or seed them via $setOnInsert on an
  // upsert, so the candidate lane is assembled from both before it is checked.
  const update = (this.getUpdate() ?? {}) as {
    $set?: Record<string, unknown>;
    $setOnInsert?: Record<string, unknown>;
  };
  const candidate = { ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) };
  const filter = this.getFilter() as Record<string, unknown>;

  const problem = findRouteProblem({
    // Anything the update does not mention is unchanged, so the filter — which
    // carries the lane key — supplies it.
    originCountryCode: String(candidate.originCountryCode ?? filter.originCountryCode ?? ""),
    destinationCountryCode: String(candidate.destinationCountryCode ?? filter.destinationCountryCode ?? ""),
    viaCountryCodes: candidate.viaCountryCodes as string[] | undefined,
    transitDaysMin: candidate.transitDaysMin as number | undefined,
    transitDaysMax: candidate.transitDaysMax as number | undefined
  });

  if (!problem) return;

  // Thrown rather than passed to `next`, which rejects the query the same way
  // and keeps the hook's signature free of Mongoose's callback typing.
  const error = new mongoose.Error.ValidationError();
  error.addError(problem.path, new mongoose.Error.ValidatorError({
    path: problem.path,
    message: problem.message
  }));
  throw error;
});

/** The lane as a person reads it: "IN → GB → CA". */
export function formatRoutePath(route: Pick<ISwiftlineRoute, "originCountryCode" | "viaCountryCodes" | "destinationCountryCode">) {
  return [route.originCountryCode, ...(route.viaCountryCodes ?? []), route.destinationCountryCode].join(" → ");
}

export const SwiftlineRoute = mongoose.model<ISwiftlineRoute>(
  "SwiftlineRoute",
  swiftlineRouteSchema
);
