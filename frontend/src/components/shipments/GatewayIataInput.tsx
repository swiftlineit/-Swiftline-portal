"use client";

import { useId } from "react";

type GatewayIataInputProps = {
  value: string;
  onChange: (value: string) => void;
  ukRoute?: boolean;
  className?: string;
};

export function normalizeGatewayIata(value: string) {
  return value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3);
}

export function isValidGatewayIata(value: string) {
  return /^[A-Z]{3}$/.test(value);
}

/** Structured gateway capture shared by individual and bulk status updates. */
export default function GatewayIataInput({
  value,
  onChange,
  ukRoute = false,
  className = ""
}: GatewayIataInputProps) {
  const helpId = useId();

  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Gateway IATA <span className="text-red-600">*</span>
      </span>
      <input
        value={ukRoute ? "LHR" : value}
        onChange={(event) => onChange(normalizeGatewayIata(event.target.value))}
        maxLength={3}
        required
        readOnly={ukRoute}
        autoComplete="off"
        spellCheck={false}
        placeholder="JFK"
        aria-describedby={helpId}
        className={`mt-2 h-10 w-full rounded-xl border px-3 text-sm font-semibold uppercase tracking-[0.16em] outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10 ${
          ukRoute
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-600"
            : "border-slate-300 bg-white text-slate-900 placeholder:tracking-normal placeholder:text-slate-400"
        }`}
      />
      <span id={helpId} className="mt-1 block text-xs font-medium leading-4 text-slate-500">
        {ukRoute
          ? "UK tracking uses the agreed LHR gateway."
          : "Actual three-letter arrival gateway, for example JFK, YVR or FRA."}
      </span>
    </label>
  );
}
