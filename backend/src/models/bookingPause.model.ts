import mongoose from "mongoose";

/**
 * Booking pause — temporarily blocks all bookings for selected destinations.
 * `countries` stores tokens: GB (United Kingdom), US, CA, EUROPE, ALL.
 * EUROPE expands to ~44 European ISO2 codes; ALL matches any country.
 */
export const bookingPauseCountryValues = ["GB", "US", "CA", "EUROPE", "ALL"] as const;
export type BookingPauseCountry = (typeof bookingPauseCountryValues)[number];

export type BookingPauseStatus = "ACTIVE" | "UPCOMING" | "EXPIRED" | "DISABLED";

export interface IBookingPause extends mongoose.Document {
  countries: BookingPauseCountry[];
  countryLabels: string[];
  startAt: Date;
  endAt: Date;
  reason: string;
  active: boolean;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const bookingPauseSchema = new mongoose.Schema<IBookingPause>(
  {
    countries: {
      type: [String],
      enum: bookingPauseCountryValues,
      required: true,
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length > 0,
        message: "Select at least one destination"
      }
    },
    countryLabels: { type: [String], default: [] },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

bookingPauseSchema.index({ active: 1, startAt: 1, endAt: 1 });
bookingPauseSchema.index({ countries: 1 });

export function deriveBookingPauseStatus(
  pause: Pick<IBookingPause, "active" | "startAt" | "endAt">,
  now = new Date()
): BookingPauseStatus {
  if (!pause.active) return "DISABLED";
  if (now < pause.startAt) return "UPCOMING";
  if (now > pause.endAt) return "EXPIRED";
  return "ACTIVE";
}

export const BookingPause = mongoose.model<IBookingPause>("BookingPause", bookingPauseSchema);
