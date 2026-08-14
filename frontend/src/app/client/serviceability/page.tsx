"use client";

import { useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiSearch, FiXCircle } from "react-icons/fi";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import { useClientUser } from "@/lib/useClientUser";

type ServiceabilityOption = {
  service: "COURIER" | "CARGO";
  serviceable: boolean;
  unavailableReason: string;
  transitDaysMin: number | null;
  transitDaysMax: number | null;
  transitBasis: "BUSINESS_DAYS" | "CALENDAR_DAYS" | null;
  viaCountryCodes: string[];
  maxBoxKg: number | null;
  maxWeightKg: number | null;
  weightExceedsBands: boolean;
  restrictions: string;
  notes: string;
};

type ServiceabilityResult = {
  destinationCountryCode: string;
  destinationPostcode: string;
  remoteArea: { checked: boolean; isRemote: boolean };
  options: ServiceabilityOption[];
};

async function check(params: URLSearchParams) {
  let token = getAccessToken() ?? await refreshAccessToken();
  const send = () => fetch(apiUrl(`/api/v1/client/serviceability?${params.toString()}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  let response = await send();
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (token) response = await send();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.message || "Serviceability could not be checked.");
  return data.result as ServiceabilityResult;
}

function transitLabel(option: ServiceabilityOption) {
  if (option.transitDaysMin === null || option.transitDaysMax === null) return "Not published";
  const unit = option.transitBasis === "BUSINESS_DAYS" ? "business days" : "calendar days";
  return option.transitDaysMin === option.transitDaysMax
    ? `${option.transitDaysMax} ${unit}`
    : `${option.transitDaysMin}–${option.transitDaysMax} ${unit}`;
}

/**
 * Whether Swiftline can carry a shipment, before one is created.
 *
 * Answers from the same records that price and schedule a real booking, so a
 * lane called unserviceable here would genuinely be refused at booking. Both
 * services are always listed, including those that cannot carry it and why —
 * omitting one silently leaves the customer unsure it was considered.
 */
export default function ServiceabilityPage() {
  const { user, loading } = useClientUser();
  const [countryCode, setCountryCode] = useState("");
  const [postcode, setPostcode] = useState("");
  const [weight, setWeight] = useState("");
  const [result, setResult] = useState<ServiceabilityResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (loading || !user) return <ClientDashboardLoading />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (countryCode.trim().length !== 2) {
      setError("Enter the two-letter destination country code, for example GB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ destinationCountryCode: countryCode.trim().toUpperCase() });
      if (postcode.trim()) params.set("destinationPostcode", postcode.trim());
      if (weight.trim()) params.set("weightKg", weight.trim());
      setResult(await check(params));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Serviceability could not be checked.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">Serviceability Checker</h1>
        <p className="mt-1 text-sm text-slate-500">
          Check where Swiftline delivers, how long it takes, and what weight is accepted — before you book.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-600">Destination country</span>
            <input
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
              maxLength={2}
              placeholder="GB"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm uppercase outline-none focus:border-blue-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-600">Destination postcode</span>
            <input
              value={postcode}
              onChange={(event) => setPostcode(event.target.value)}
              maxLength={20}
              placeholder="Optional"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-600">Weight (kg)</span>
            <input
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              inputMode="decimal"
              placeholder="Optional"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-900"
            />
          </label>
        </div>
        <button
          disabled={busy}
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-4xl bg-blue-950 px-5 text-sm font-semibold text-white hover:bg-blue-900 disabled:bg-slate-400"
        >
          <FiSearch aria-hidden="true" className="h-4 w-4" />
          {busy ? "Checking…" : "Check serviceability"}
        </button>
        {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
      </form>

      {result ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remote area</p>
            <p className="mt-1 text-sm text-slate-800">
              {/* Three outcomes, not two: not knowing is different from knowing
                  it is not remote, and saying "No" to an unchecked postcode
                  would be a promise nothing supports. */}
              {!result.remoteArea.checked
                ? "Not checked — enter a destination postcode, or no remote-area list is configured for this country."
                : result.remoteArea.isRemote
                  ? "This postcode is a remote area. A remote area surcharge applies."
                  : "This postcode is not a remote area."}
            </p>
          </div>

          {result.options.map((option) => (
            <div
              key={option.service}
              className={`rounded-2xl border p-5 ${option.serviceable ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-950">
                  {option.service === "COURIER" ? "Courier" : "Cargo"}
                </h2>
                <span className={`inline-flex items-center gap-1.5 rounded-4xl border px-3 py-1 text-xs font-semibold uppercase ${
                  option.serviceable
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-300 bg-slate-100 text-slate-600"
                }`}>
                  {option.serviceable ? <FiCheckCircle aria-hidden="true" className="h-3.5 w-3.5" /> : <FiXCircle aria-hidden="true" className="h-3.5 w-3.5" />}
                  {option.serviceable ? "Available" : "Not available"}
                </span>
              </div>

              {option.unavailableReason ? (
                <p className="mt-2 text-sm text-slate-600">{option.unavailableReason}</p>
              ) : null}

              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Estimated transit</dt>
                  <dd className="text-sm text-slate-800">{transitLabel(option)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Maximum weight</dt>
                  <dd className="text-sm text-slate-800">
                    {option.maxWeightKg === null ? "Not published" : `${option.maxWeightKg} kg`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Maximum per box</dt>
                  <dd className="text-sm text-slate-800">
                    {option.maxBoxKg === null ? "Not published" : `${option.maxBoxKg} kg`}
                  </dd>
                </div>
              </dl>

              {option.viaCountryCodes.length ? (
                <p className="mt-3 text-sm text-slate-600">
                  Routed via {option.viaCountryCodes.join(" → ")}.
                </p>
              ) : null}

              {option.restrictions ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <p className="text-sm text-amber-900">{option.restrictions}</p>
                </div>
              ) : null}

              {option.notes ? <p className="mt-3 text-sm text-slate-500">{option.notes}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
