"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { FiArrowRight, FiSearch } from "react-icons/fi";
import {
  isTrackingReference,
  normalizeTrackingNumber,
} from "@/lib/publicTracking";

/**
 * The search box on the public tracker.
 *
 * Navigates to /track/<AWB> rather than fetching in place. That is what makes a
 * result linkable: the consignee can bookmark it, forward it, or reload it, and
 * the page behind it is server-rendered so all three work.
 *
 * It also validates the shape before navigating, so an obvious typo is answered
 * instantly instead of costing a round trip and a full page render. The server
 * revalidates regardless- this is a courtesy, not a gate.
 */
export default function PublicTrackingForm({
  initialValue = "",
  autoFocus = false,
}: {
  initialValue?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trackingNumber = normalizeTrackingNumber(value);

    if (!trackingNumber) {
      setError("Enter the tracking number printed on your shipment label.");
      return;
    }

    if (!isTrackingReference(trackingNumber)) {
      setError(
        "That does not look like a tracking number. Enter it exactly as printed on your label.",
      );
      return;
    }

    setError("");

    // Left true deliberately: the spinner state ends when the new route paints,
    // which also stops a double submit while the server renders the result.
    setSubmitting(true);

    router.push(`/track/${encodeURIComponent(trackingNumber)}`);
  }

  return (
    <form onSubmit={submit} noValidate className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor="tracking-number" className="sr-only">
            Tracking number
          </label>

          <FiSearch
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />

          <input
            id="tracking-number"
            name="trackingNumber"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
            // 40, not the length of a current AWB: carrier-numbered pieces on
            // older shipments run to 25 characters, and truncating one as it is
            // typed would be baffling.
            maxLength={40}
            placeholder="SLCDEL170826001"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "tracking-number-error" : undefined}
            className={`h-12 w-full rounded-xl border bg-white pl-11 pr-4 text-sm font-medium tracking-wide text-slate-950 outline-none transition placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:ring-2 sm:h-14 sm:text-base ${
              error
                ? "border-red-300 focus:border-red-500 focus:ring-red-100"
                : "border-slate-300 focus:border-[#0D1282] focus:ring-[#0D1282]/15"
            }`}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="group inline-flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-xl bg-[#0D1282] px-6 text-sm font-semibold text-white transition hover:bg-[#0a0e68] focus:outline-none focus:ring-2 focus:ring-[#0D1282]/30 disabled:cursor-not-allowed disabled:bg-slate-400 sm:h-14 sm:px-8 sm:text-base"
        >
          {submitting ? (
            "Searching…"
          ) : (
            <>
              <span>Track</span>

              <FiArrowRight
                aria-hidden="true"
                className="h-4 w-4 text-[#d71920] transition-transform duration-200 group-hover:translate-x-0.5 sm:h-[18px] sm:w-[18px]"
              />
            </>
          )}
        </button>
      </div>

      {error ? (
        <p
          id="tracking-number-error"
          role="alert"
          className="mt-2.5 text-sm text-start font-medium text-red-600"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}