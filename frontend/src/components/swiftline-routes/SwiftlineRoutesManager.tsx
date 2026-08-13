"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiEdit3, FiGlobe, FiPlus, FiSave, FiSearch, FiTrash2 } from "react-icons/fi";
import {
  countryRateServices,
  formatCountryRateService,
  getCountryFlag,
  type CountryRateService
} from "@/lib/countryRateCards";
import { portalCountries } from "@/lib/portalCountries";
import {
  deleteSwiftlineRoute,
  formatTransitTime,
  listSwiftlineRoutes,
  routeTransitBases,
  routeTransitBasisLabels,
  saveSwiftlineRoute,
  type RouteTransitBasis,
  type SwiftlineRoute,
  type SwiftlineRouteInput
} from "@/lib/swiftlineRoutes";

/**
 * Swiftline Routes — the lanes we operate, and the transit time each one quotes.
 *
 * The transit time entered here is what produces the Estimated Delivery date on
 * every shipment, the On Schedule / Delayed status, and the transit figure shown
 * on quotes and the serviceability checker. A lane with no route configured
 * simply shows no estimate; it never guesses one.
 */

type FormState = {
  destinationCountryCode: string;
  /** Ordered transit stops between origin and destination. */
  viaCountryCodes: string[];
  service: CountryRateService;
  transitDaysMin: string;
  transitDaysMax: string;
  transitBasis: RouteTransitBasis;
  serviceable: boolean;
  cutOffTime: string;
  restrictions: string;
  notes: string;
};

function blankForm(): FormState {
  return {
    destinationCountryCode: "",
    viaCountryCodes: [],
    service: "COURIER",
    transitDaysMin: "",
    transitDaysMax: "",
    transitBasis: "BUSINESS_DAYS",
    serviceable: true,
    cutOffTime: "",
    restrictions: "",
    notes: ""
  };
}

function loadRouteIntoForm(route: SwiftlineRoute): FormState {
  return {
    destinationCountryCode: route.destinationCountryCode,
    viaCountryCodes: route.viaCountryCodes ?? [],
    service: route.service,
    transitDaysMin: String(route.transitDaysMin),
    transitDaysMax: String(route.transitDaysMax),
    transitBasis: route.transitBasis,
    serviceable: route.serviceable,
    cutOffTime: route.cutOffTime,
    restrictions: route.restrictions,
    notes: route.notes
  };
}

function toRouteInput(form: FormState): SwiftlineRouteInput {
  const country = portalCountries.find((entry) => entry.iso2 === form.destinationCountryCode);

  return {
    destinationCountryCode: form.destinationCountryCode,
    viaCountryCodes: form.viaCountryCodes.filter(Boolean),
    // The name travels with the code so the list reads without a second lookup,
    // and stays correct if the reference list is edited later.
    destinationCountryName: country?.name ?? form.destinationCountryCode,
    service: form.service,
    transitDaysMin: Number(form.transitDaysMin),
    transitDaysMax: Number(form.transitDaysMax),
    transitBasis: form.transitBasis,
    serviceable: form.serviceable,
    cutOffTime: form.cutOffTime,
    restrictions: form.restrictions.trim(),
    notes: form.notes.trim()
  };
}

/**
 * The lane as a path: IN → GB → CA.
 *
 * Transit stops are picked out from the endpoints, because the thing an
 * operator is scanning this column for is whether a lane goes direct or
 * through somewhere. There is deliberately no separate "Via GB" badge beside
 * it — the arrow already says that, and saying it twice is the repeated
 * information the design brief asks us to avoid.
 */
function RoutePath({ route }: { route: SwiftlineRoute }) {
  const stops = route.viaCountryCodes ?? [];

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs tabular-nums">
      <span className="font-medium text-slate-500">{route.originCountryCode}</span>
      {stops.map((code) => (
        <span key={code} className="flex items-center gap-1">
          <span aria-hidden="true" className="text-slate-300">→</span>
          <span className="rounded bg-[#0D1282]/8 px-1.5 py-0.5 font-semibold text-[#0D1282]">
            {code}
          </span>
        </span>
      ))}
      <span aria-hidden="true" className="text-slate-300">→</span>
      <span className="font-semibold text-slate-700">{route.destinationCountryCode}</span>
      {stops.length ? (
        <span className="ml-1 text-slate-400">
          ({stops.length} transit {stops.length === 1 ? "country" : "countries"})
        </span>
      ) : (
        <span className="ml-1 text-slate-400">(direct)</span>
      )}
    </span>
  );
}

export default function SwiftlineRoutesManager() {
  const [routes, setRoutes] = useState<SwiftlineRoute[]>([]);
  const [form, setForm] = useState<FormState>(blankForm());
  const [editingLane, setEditingLane] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const result = await listSwiftlineRoutes();
    setRoutes(result.routes);
    return result.routes;
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const result = await listSwiftlineRoutes();
        if (!active) return;
        setRoutes(result.routes);
        setError("");
      } catch (caughtError) {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Routes could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, []);

  // Filtering runs here rather than round-tripping: the whole route list is
  // already loaded, and a lane count in the low hundreds filters instantly.
  const visibleRoutes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return routes.filter((route) => {
      if (serviceFilter && route.service !== serviceFilter) return false;
      if (!term) return true;
      return route.destinationCountryName.toLowerCase().includes(term)
        || route.destinationCountryCode.toLowerCase().includes(term);
    });
  }, [routes, search, serviceFilter]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
  }

  function updateVia(index: number, value: string) {
    updateField(
      "viaCountryCodes",
      form.viaCountryCodes.map((code, position) => (position === index ? value : code))
    );
  }

  function removeVia(index: number) {
    updateField("viaCountryCodes", form.viaCountryCodes.filter((_, position) => position !== index));
  }

  function handleTextChange(field: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      updateField(field, event.target.value as FormState[keyof FormState]);
    };
  }

  function loadRoute(route: SwiftlineRoute) {
    // The lane key is what the server upserts on, so holding it is what tells
    // the form it is replacing a lane rather than adding one.
    setEditingLane(`${route.destinationCountryCode}:${route.service}`);
    setForm(loadRouteIntoForm(route));
    setMessage("");
    setError("");
  }

  function resetForm() {
    setEditingLane(null);
    setForm(blankForm());
    setMessage("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await saveSwiftlineRoute(toRouteInput(form));
      await refresh();
      setMessage(result.message);
      resetForm();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Route could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(route: SwiftlineRoute) {
    const label = `${route.destinationCountryName} / ${formatCountryRateService(route.service)}`;
    if (!window.confirm(
      `Remove the ${label} route?\n\nShipments already booked keep the delivery date they were given. `
      + `To stop new bookings without losing the transit times, set the route to Not serviceable instead.`
    )) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await deleteSwiftlineRoute(route._id);
      await refresh();
      if (editingLane === `${route.destinationCountryCode}:${route.service}`) resetForm();
      setMessage(result.message);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Route could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-2 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100";
  const labelClass = "text-xs font-semibold uppercase text-slate-500";
  const selectClass = `${inputClass} appearance-none pr-9`;

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <form onSubmit={handleSubmit} className="h-fit rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">
            {editingLane ? "Edit Route" : "Add a Route"}
          </h2>
          {editingLane ? (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-semibold uppercase text-blue-900 hover:underline"
            >
              Cancel
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 px-4 py-4">
          <label className="block">
            <span className={labelClass}>Destination country</span>
            <div className="relative">
              <select
                required
                value={form.destinationCountryCode}
                onChange={handleTextChange("destinationCountryCode")}
                className={selectClass}
              >
                <option value="">Select a destination</option>
                {portalCountries.map((country) => (
                  <option key={country.iso2} value={country.iso2}>
                    {country.name} ({country.iso2})
                  </option>
                ))}
              </select>
              <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-slate-400" />
            </div>
            <span className="mt-1 block text-xs text-slate-400">
              Every route departs India. Saving a destination that already exists for this
              service replaces its transit time.
            </span>
          </label>

          {/* Transit stops, in travel order. A direct lane simply has none. */}
          <div>
            <span className={labelClass}>Transit countries (optional)</span>
            <p className="mt-1 text-xs text-slate-400">
              Add a stop for a lane that travels through another country, such as
              India&nbsp;→&nbsp;United Kingdom&nbsp;→&nbsp;Canada. Transit time is still entered once,
              for the whole journey.
            </p>

            <div className="mt-2 flex flex-col gap-2">
              {form.viaCountryCodes.map((code, index) => (
                <div key={`${code}-${index}`} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-400">
                    {index + 1}
                  </span>
                  <div className="relative flex-1">
                    <select
                      value={code}
                      onChange={(event) => updateVia(index, event.target.value)}
                      className={selectClass}
                    >
                      <option value="">Select a country</option>
                      {portalCountries.map((country) => (
                        <option key={country.iso2} value={country.iso2}>
                          {country.name} ({country.iso2})
                        </option>
                      ))}
                    </select>
                    <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-slate-400" />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeVia(index)}
                    aria-label={`Remove transit stop ${index + 1}`}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-red-600 transition hover:border-red-400"
                  >
                    <FiTrash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {form.viaCountryCodes.length < 4 ? (
                <button
                  type="button"
                  onClick={() => updateField("viaCountryCodes", [...form.viaCountryCodes, ""])}
                  className="inline-flex h-9 w-fit items-center gap-2 rounded-4xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282]"
                >
                  <FiPlus aria-hidden="true" className="h-3.5 w-3.5" />
                  Add transit country
                </button>
              ) : null}
            </div>

            {/* The path as it will read in the list, so a mistake is visible
                before it is saved rather than after. */}
            {form.destinationCountryCode ? (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold tracking-wide text-slate-600">
                IN {form.viaCountryCodes.filter(Boolean).map((code) => `→ ${code} `).join("")}→{" "}
                {form.destinationCountryCode}
              </p>
            ) : null}
          </div>

          <label className="block">
            <span className={labelClass}>Service</span>
            <div className="relative">
              <select value={form.service} onChange={handleTextChange("service")} className={selectClass}>
                {countryRateServices.map((service) => (
                  <option key={service} value={service}>{formatCountryRateService(service)}</option>
                ))}
              </select>
              <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-slate-400" />
            </div>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Transit from</span>
              <input
                required
                type="number"
                min={1}
                max={120}
                value={form.transitDaysMin}
                onChange={handleTextChange("transitDaysMin")}
                className={inputClass}
                placeholder="3"
              />
            </label>
            <label className="block">
              <span className={labelClass}>Transit to</span>
              <input
                required
                type="number"
                min={1}
                max={120}
                value={form.transitDaysMax}
                onChange={handleTextChange("transitDaysMax")}
                className={inputClass}
                placeholder="5"
              />
            </label>
          </div>
          <p className="-mt-2 text-xs text-slate-400">
            The estimated delivery date customers see is quoted from the slower figure, so a
            shipment normally arrives on or before it.
          </p>

          <label className="block">
            <span className={labelClass}>Counted in</span>
            <div className="relative">
              <select value={form.transitBasis} onChange={handleTextChange("transitBasis")} className={selectClass}>
                {routeTransitBases.map((basis) => (
                  <option key={basis} value={basis}>{routeTransitBasisLabels[basis]}</option>
                ))}
              </select>
              <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-slate-400" />
            </div>
            <span className="mt-1 block text-xs text-slate-400">
              Business days skip weekends and any destination or customs holiday on the
              Holiday &amp; Cut-Off Calendar.
            </span>
          </label>

          <label className="block">
            <span className={labelClass}>Same-day cut-off (optional)</span>
            <input
              type="time"
              value={form.cutOffTime}
              onChange={handleTextChange("cutOffTime")}
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Service restrictions (optional)</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={form.restrictions}
              onChange={handleTextChange("restrictions")}
              className={`${inputClass} h-auto py-2`}
              placeholder="No batteries or liquids on this lane"
            />
            <span className="mt-1 block text-xs text-slate-400">Shown to customers on the serviceability checker.</span>
          </label>

          <label className="block">
            <span className={labelClass}>Internal notes (optional)</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={form.notes}
              onChange={handleTextChange("notes")}
              className={`${inputClass} h-auto py-2`}
            />
            <span className="mt-1 block text-xs text-slate-400">Never shown to customers.</span>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3">
            <input
              type="checkbox"
              checked={form.serviceable}
              onChange={(event) => updateField("serviceable", event.target.checked)}
              className="h-4 w-4 accent-[#0D1282]"
            />
            <span className="text-sm text-slate-700">
              Open for booking
              <span className="block text-xs text-slate-400">
                Clearing this closes the lane but keeps its transit times.
              </span>
            </span>
          </label>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
          ) : null}
          {message ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-4xl bg-blue-950 px-4 text-sm font-semibold text-white transition hover:bg-blue-900 disabled:opacity-50"
          >
            {editingLane ? <FiSave aria-hidden="true" className="h-4 w-4" /> : <FiPlus aria-hidden="true" className="h-4 w-4" />}
            {busy ? "Saving..." : editingLane ? "Save route" : "Add route"}
          </button>
        </div>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="grid gap-3 border-b border-slate-200 px-4 py-3 md:grid-cols-[minmax(0,1fr)_200px]">
          <label className="relative">
            <span className="sr-only">Search routes</span>
            <FiSearch aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search destination or country code"
              className="h-10 w-full rounded-xl border border-slate-300 pl-10 pr-3 text-sm outline-none focus:border-blue-900"
            />
          </label>
          <div className="relative">
            <select
              value={serviceFilter}
              onChange={(event) => setServiceFilter(event.target.value)}
              className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-9 text-sm"
            >
              <option value="">All services</option>
              {countryRateServices.map((service) => (
                <option key={service} value={service}>{formatCountryRateService(service)}</option>
              ))}
            </select>
            <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        <div className="overflow-x-auto">
          {/* 620 rather than 720: the destination cell stacks its name above the
              path now, so the table no longer needs the extra width — and at
              720 the actions column fell off the edge of the slot beside the
              form, leaving Delete unreachable without scrolling. */}
          <table className="w-full min-w-155 text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Transit time</th>
                <th className="px-4 py-3">Cut-off</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows />
              ) : !visibleRoutes.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <FiGlobe aria-hidden="true" className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-semibold text-slate-700">
                      {routes.length ? "No routes match this filter" : "No routes yet"}
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                      {routes.length
                        ? "Clear the search or service filter to see the rest."
                        : "Add the lanes you ship on and the transit time each one takes. Shipments to a destination with no route show no estimated delivery date."}
                    </p>
                  </td>
                </tr>
              ) : (
                visibleRoutes.map((route) => (
                  <tr key={route._id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-slate-900">
                        <span aria-hidden="true">{getCountryFlag(route.destinationCountryCode)}</span>{" "}
                        {route.destinationCountryName}
                      </span>
                      <RoutePath route={route} />
                      {route.restrictions ? (
                        <span className="mt-1 block text-xs text-amber-700">{route.restrictions}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatCountryRateService(route.service)}</td>
                    <td className="px-4 py-3 text-slate-700 tabular-nums">{formatTransitTime(route)}</td>
                    <td className="px-4 py-3 text-slate-700 tabular-nums">{route.cutOffTime || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          route.serviceable
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {route.serviceable ? "Open" : "Closed"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => loadRoute(route)}
                          title={`Edit ${route.destinationCountryName}`}
                          aria-label={`Edit ${route.destinationCountryName} ${formatCountryRateService(route.service)} route`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-blue-900 transition hover:border-blue-900"
                        >
                          <FiEdit3 aria-hidden="true" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(route)}
                          disabled={busy}
                          title={`Remove ${route.destinationCountryName}`}
                          aria-label={`Remove ${route.destinationCountryName} ${formatCountryRateService(route.service)} route`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-red-600 transition hover:border-red-500 disabled:opacity-40"
                        >
                          <FiTrash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Placeholder rows while the first load runs, so the table does not jump. */
function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3].map((row) => (
        <tr key={row} className="border-b border-slate-100 last:border-b-0">
          {[0, 1, 2, 3, 4, 5].map((cell) => (
            <td key={cell} className="px-4 py-4">
              <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
