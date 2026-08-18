"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { FiSave } from "react-icons/fi";
import { toast } from "react-toastify";
import {
  CountryRouteCharge,
  RateCardBand,
  CountryRateService,
  countryRateServices,
  formatCountryRateService,
  listCountryRouteCharges,
  saveCountryRouteCharge
} from "@/lib/countryRateCards";

type FormState = {
  fuelSurchargePercent: string;
  remoteAreaCharge: string;
  remoteAreaPostcodes: string;
  handlingCharge: string;
  insurancePercent: string;
  insuranceMinimum: string;
  discountPercent: string;
};

// What an unconfigured route charges: nothing. Shown as blanks rather than zeros
// so it is obvious the route has never been configured.
const emptyForm: FormState = {
  fuelSurchargePercent: "",
  remoteAreaCharge: "",
  remoteAreaPostcodes: "",
  handlingCharge: "",
  insurancePercent: "",
  insuranceMinimum: "",
  discountPercent: ""
};

function toFormState(routeCharge: CountryRouteCharge | undefined): FormState {
  if (!routeCharge) return emptyForm;

  return {
    fuelSurchargePercent: String(routeCharge.fuelSurchargePercent),
    remoteAreaCharge: String(routeCharge.remoteAreaCharge),
    remoteAreaPostcodes: routeCharge.remoteAreaPostcodes.join(", "),
    handlingCharge: String(routeCharge.handlingCharge),
    insurancePercent: String(routeCharge.insurancePercent),
    insuranceMinimum: String(routeCharge.insuranceMinimum),
    discountPercent: String(routeCharge.discountPercent)
  };
}

/**
 * Surcharges, insurance and discount for the country selected in the weight
 * slab form above. Service targeting is deliberately independent so one set of
 * values can be applied to Courier, Cargo, or both.
 *
 * These are per route, not per slab: a fuel percentage set here applies to every
 * weight band for that country and service. Keeping it beside the slabs- rather
 * than on a screen of its own- means an operator setting up a new destination
 * sees both halves of what a shipment there will cost.
 */
export default function RouteChargesForm({
  countryCode,
  countryName,
  band,
  onSaved
}: {
  countryCode: string;
  countryName: string;
  band: RateCardBand;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedServices, setSelectedServices] = useState<CountryRateService[]>(["COURIER"]);
  const [routeCharges, setRouteCharges] = useState<Partial<Record<CountryRateService, CountryRouteCharge>>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Reloads whenever the selection above changes, so the fields always describe
  // the route named in the heading, and again after a save so what is shown is
  // what was actually stored.
  useEffect(() => {
    let active = true;

    async function loadRouteCharge() {
      setLoading(true);
      setError("");

      try {
        const result = await listCountryRouteCharges(band);
        if (!active) return;
        const nextCharges: Partial<Record<CountryRateService, CountryRouteCharge>> = {};
        for (const service of countryRateServices) {
          const routeCharge = result.routeCharges.find(
            (item) => item.countryCode === countryCode && item.service === service
          );
          if (routeCharge) nextCharges[service] = routeCharge;
        }
        setRouteCharges(nextCharges);
        setForm(toFormState(nextCharges[selectedServices[0]]));
      } catch (caughtError) {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load route charges.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadRouteCharge();

    return () => {
      active = false;
    };
  }, [band, countryCode, reloadKey, selectedServices]);

  function handleInput(field: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };
  }

  function toggleService(service: CountryRateService) {
    setSelectedServices((current) => {
      if (current.includes(service)) {
        const next = current.length === 1 ? current : current.filter((item) => item !== service);
        setForm(toFormState(routeCharges[next[0]]));
        return next;
      }
      const next = [...current, service];
      setForm(toFormState(routeCharges[next[0]]));
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedServices.length) {
      toast.error("Select at least one service for these route charges.");
      return;
    }
    setBusy(true);
    setError("");

    try {
      // Blank fields mean "do not charge this", which is zero to the pricing engine.
      await Promise.all(selectedServices.map((service) => saveCountryRouteCharge({
          band,
          countryCode,
          service,
          fuelSurchargePercent: Number(form.fuelSurchargePercent) || 0,
          remoteAreaCharge: Number(form.remoteAreaCharge) || 0,
          remoteAreaPostcodes: form.remoteAreaPostcodes,
          handlingCharge: Number(form.handlingCharge) || 0,
          insurancePercent: Number(form.insurancePercent) || 0,
          insuranceMinimum: Number(form.insuranceMinimum) || 0,
          discountPercent: Number(form.discountPercent) || 0
        })));
      toast.success(`Route charges saved for ${countryName} (${selectedServices.map(formatCountryRateService).join(" and ")}).`);
      setReloadKey((current) => current + 1);
      onSaved?.();
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Route charges could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-500">Route Charges</h2>
          <p className="mt-1 text-sm text-slate-600">
            Applied to every weight slab for{" "}
            <span className="font-semibold text-slate-900">
              {countryName}
            </span>
            . Select one or both services, then leave a field blank to charge nothing.
          </p>
        </div>
        <button
          type="submit"
          disabled={busy || loading}
          className="inline-flex h-10 items-center gap-2 rounded-4xl bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          <FiSave aria-hidden="true" className="h-4 w-4" />
          {busy ? "Saving..." : "Save Route Charges"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Services</span>
        {countryRateServices.map((serviceOption) => (
          <label key={serviceOption} className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={selectedServices.includes(serviceOption)}
              onChange={() => toggleService(serviceOption)}
              className="h-4 w-4 accent-blue-900"
            />
            {formatCountryRateService(serviceOption)}
          </label>
        ))}
        <span className="text-xs text-slate-500">The same values will be saved for every selected service.</span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <ChargeInput
          label="Fuel Surcharge %"
          hint="Percentage of base freight"
          value={form.fuelSurchargePercent}
          onChange={handleInput("fuelSurchargePercent")}
          max={100}
        />
        <ChargeInput
          label="Remote Area Charge"
          hint="Flat, on matching postcodes"
          value={form.remoteAreaCharge}
          onChange={handleInput("remoteAreaCharge")}
        />
        <ChargeInput
          label="Handling Charge"
          hint="Flat, once per shipment"
          value={form.handlingCharge}
          onChange={handleInput("handlingCharge")}
        />
        {/*
          Insurance is switched off portal-wide while the product is unfinished.
          The inputs are hidden rather than removed: the stored percentage and
          minimum are still submitted unchanged below, so a route's configuration
          survives untouched and restoring cover is a matter of showing these
          again. Pricing ignores them regardless- see shipmentPricing.service.ts.
        */}
        <ChargeInput
          label="Discount %"
          hint="Off all charges, pre-GST"
          value={form.discountPercent}
          onChange={handleInput("discountPercent")}
          max={100}
        />
      </div>

      <label className="mt-4 block">
        <span className="text-xs font-semibold uppercase text-slate-500">Remote Area Postcodes</span>
        <span className="mt-1 block text-xs text-slate-500">
          Prefixes, separated by commas or new lines. A destination is remote when its postcode starts with any
          of them, so &quot;HS&quot; covers a whole region and &quot;HS12AB&quot; a single delivery point.
        </span>
        <textarea
          value={form.remoteAreaPostcodes}
          onChange={handleInput("remoteAreaPostcodes")}
          rows={2}
          placeholder="HS, IV41, ZE"
          className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold uppercase text-slate-900 outline-none focus:border-blue-900"
        />
      </label>

      <p className="mt-3 text-xs text-slate-500">
        A discount set here applies to every customer shipping on this route.
      </p>
    </form>
  );
}

function ChargeInput({
  label,
  hint,
  value,
  onChange,
  max
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  max?: number;
}) {
  return (
    <label>
      <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
      <input
        type="number"
        min="0"
        max={max}
        step="0.01"
        value={value}
        onChange={onChange}
        placeholder="0"
        className="mt-2 h-10 w-full rounded-2xl border border-slate-300 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-900"
      />
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  );
}
