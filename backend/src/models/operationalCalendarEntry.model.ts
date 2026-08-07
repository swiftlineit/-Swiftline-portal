import mongoose from "mongoose";

/**
 * A single row in the Holiday & Cut-Off Calendar. One collection with a
 * category discriminator covers all eight entry kinds the client calendar
 * shows; each category writes a defined subset of the optional fields below
 * (documented on `calendarEntryCategoryValues`). Keeping them in one collection
 * makes the list, the client view and the admin form one shared query.
 */
export const calendarEntryCategoryValues = [
  "BRANCH_HOLIDAY",
  "DESTINATION_HOLIDAY",
  "CUSTOMS_HOLIDAY",
  "PICKUP_CUTOFF",
  "SAME_DAY_BOOKING_CUTOFF",
  "FLIGHT_CLOSING_TIME",
  "WEEKEND_DELIVERY",
  "PEAK_SEASON_RESTRICTION"
] as const;

export type CalendarEntryCategory = (typeof calendarEntryCategoryValues)[number];

export interface IOperationalCalendarEntry extends mongoose.Document {
  category: CalendarEntryCategory;
  /** Short heading shown on the calendar, e.g. "Deepavali" or "London cut-off". */
  title: string;
  /** Optional free text for notes, exceptions or what is restricted. */
  description?: string;
  /** Branch-scoped entries (branch holidays, pickups, weekend delivery). */
  branchId?: mongoose.Types.ObjectId | null;
  /** Destination or customs holidays are scoped to a country code (IN, AE...). */
  countryCode?: string | null;
  /** Free-text route label used by flight closing times, e.g. "London (LHR)". */
  locationLabel?: string | null;
  /** Single date (holidays) or the start of a window (peak season). */
  date?: Date | null;
  /** End of a holiday range or peak season window. */
  endDate?: Date | null;
  /** "HH:mm" 24-hour clock for cut-off and flight closing times. */
  time?: string | null;
  /** Whether weekend deliveries run; used by WEEKEND_DELIVERY entries. */
  weekendDeliveryAvailable?: boolean | null;
  /** Only active entries are shown to clients. */
  active: boolean;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const operationalCalendarEntrySchema = new mongoose.Schema<IOperationalCalendarEntry>(
  {
    category: { type: String, enum: calendarEntryCategoryValues, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null, index: true },
    countryCode: { type: String, trim: true, uppercase: true, maxlength: 2, default: null },
    locationLabel: { type: String, trim: true, maxlength: 120, default: null },
    date: { type: Date, default: null },
    endDate: { type: Date, default: null },
    time: { type: String, trim: true, maxlength: 5, default: null },
    weekendDeliveryAvailable: { type: Boolean, default: null },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

// The client calendar renders grouped by category, then by start date.
operationalCalendarEntrySchema.index({ category: 1, active: 1, date: 1 });

export const OperationalCalendarEntry = mongoose.model<IOperationalCalendarEntry>(
  "OperationalCalendarEntry",
  operationalCalendarEntrySchema
);
