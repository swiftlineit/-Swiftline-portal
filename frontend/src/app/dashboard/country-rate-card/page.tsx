"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "react-toastify";
import { FiChevronRight, FiDownload, FiSearch, FiShare2, FiTrash2, FiUploadCloud } from "react-icons/fi";
import { MdOutlineKeyboardDoubleArrowRight } from "react-icons/md";

import { DashboardLoading } from "@/components/DashboardShell";
import { BiSolidEdit } from "react-icons/bi";
import ShareRateCardDialog from "@/components/rate-cards/ShareRateCardDialog";
import RateCardImportDialog from "@/components/rate-cards/RateCardImportDialog";
import RateCardCountryPicker from "@/components/rate-cards/RateCardCountryPicker";
import CountryFlag from "@/components/CountryFlag";
import RouteChargesForm from "@/components/rate-cards/RouteChargesForm";
import RateCardAssignments from "@/components/rate-cards/RateCardAssignments";
import { countryName } from "@/lib/countries";
import { resolveCountry } from "@/lib/countryLookup";
import {
  buildCountryRateCardCsv,
  CountryRateCard,
  CountryRateCardInput,
  CountryRouteCharge,
  CountryRateService,
  RateCardBand,
  countryRateServices,
  rateCardBands,
  deleteCountryRateCard,
  formatCountryRateService,
  formatRateCardBand,
  listCountryRateCards,
  listCountryRouteCharges,
  saveCountryRateCard,
} from "@/lib/countryRateCards";
import { RATE_CARD_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

type FormState = {
  /** The text in the country field. The ISO code is derived from it. */
  countryQuery: string;
  service: CountryRateService;
  fromKg: string;
  toKg: string;
  chargesPerKg: string;
  maxBoxKg: string;
};

// The country field starts empty. It used to default to the United Kingdom,
// which made the quickest way to use the form also the quickest way to save a
// UK rate by accident.
const defaultForm: FormState = {
  countryQuery: "",
  service: "COURIER",
  fromKg: "",
  toKg: "",
  chargesPerKg: "",
  maxBoxKg: "",
};

/** One country and service, with its weight slabs. How the table is grouped. */
type RateGroup = {
  key: string;
  countryCode: string;
  countryName: string;
  service: CountryRateService;
  rates: CountryRateCard[];
};

function toPayload(form: FormState, countryCode: string, band: RateCardBand): CountryRateCardInput {
  return {
    band,
    countryCode,
    countryName: countryName(countryCode),
    service: form.service,
    fromKg: Number(form.fromKg),
    toKg: Number(form.toKg),
    chargesPerKg: Number(form.chargesPerKg),
    maxBoxKg: Number(form.maxBoxKg),
  };
}

export default function CountryRateCardPage() {
  const { user, loading } = useAdminUser(RATE_CARD_AREA);
  const [rates, setRates] = useState<CountryRateCard[]>([]);
  const [routeCharges, setRouteCharges] = useState<CountryRouteCharge[]>([]);
  const [selectedBand, setSelectedBand] = useState<RateCardBand>("BAND_A");
  const [form, setForm] = useState<FormState>(defaultForm);
  const [editingRateId, setEditingRateId] = useState("");
  const [countryError, setCountryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState<CountryRateService | "">("");
  // Only the groups the operator has opened or closed by hand; everything else
  // follows the default for the current list length.
  const [overriddenGroups, setOverriddenGroups] = useState<Record<string, boolean>>({});

  // Derived rather than stored beside the text: holding the code and the text
  // as two pieces of state is what makes this kind of field drift, where the
  // box says one country and the rate is saved against another.
  const selectedCountry = useMemo(
    () => resolveCountry(form.countryQuery),
    [form.countryQuery],
  );
  const countryCode = selectedCountry?.iso2.toUpperCase() ?? "";

  const bandRates = useMemo(
    () => rates.filter((rate) => rate.band === selectedBand),
    [rates, selectedBand],
  );

  const visibleRates = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return bandRates.filter((rate) => {
      if (serviceFilter && rate.service !== serviceFilter) return false;
      if (!needle) return true;
      return rate.countryName.toLowerCase().includes(needle)
        || rate.countryCode.toLowerCase().includes(needle);
    });
  }, [bandRates, search, serviceFilter]);

  // Grouped by destination and service: a full rate list runs to nine hundred
  // slabs on one band, and a flat table of that length cannot be read.
  const groups = useMemo(() => {
    const byKey = new Map<string, RateGroup>();

    for (const rate of visibleRates) {
      const key = `${rate.countryCode}:${rate.service}`;
      const group = byKey.get(key);
      if (group) {
        group.rates.push(rate);
        continue;
      }

      byKey.set(key, {
        key,
        countryCode: rate.countryCode,
        countryName: rate.countryName,
        service: rate.service,
        rates: [rate],
      });
    }

    return [...byKey.values()]
      .map((group) => ({
        ...group,
        rates: [...group.rates].sort((a, b) => a.fromKg - b.fromKg),
      }))
      .sort((a, b) => a.countryName.localeCompare(b.countryName) || a.service.localeCompare(b.service));
  }, [visibleRates]);

  // A short list is easier to read open; a long one is unusable open. A search
  // that narrows to a handful therefore opens them without a second click.
  //
  // Only groups the operator has actually clicked are remembered, and they are
  // remembered as a state rather than as membership of a list. Storing "these
  // are open" instead would invert every one of them the moment a search
  // changed what the default is.
  const expandedByDefault = groups.length <= 8;
  function isExpanded(key: string) {
    return overriddenGroups[key] ?? expandedByDefault;
  }

  function toggleGroup(key: string) {
    setOverriddenGroups((current) => ({
      ...current,
      [key]: !(current[key] ?? expandedByDefault),
    }));
  }

  useEffect(() => {
    if (!user) return;

    async function loadRates() {
      setDataLoading(true);
      setError("");

      try {
        const [rateResult, routeChargeResult] = await Promise.all([
          listCountryRateCards(),
          listCountryRouteCharges()
        ]);
        setRates(rateResult.rates);
        setRouteCharges(routeChargeResult.routeCharges);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load country rate cards.",
        );
      } finally {
        setDataLoading(false);
      }
    }

    void loadRates();
  }, [user]);

  // Debounced so a long rate card is not regrouped on every keystroke, matching
  // the shipments list.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  function updateField<K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
  }

  function handleInput(field: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      updateField(field, event.target.value as FormState[keyof FormState]);
    };
  }

  function resetForm() {
    setForm(defaultForm);
    setEditingRateId("");
    setCountryError("");
    setMessage("");
  }

  function editRate(rate: CountryRateCard) {
    setEditingRateId(rate._id);
    setForm({
      countryQuery: countryName(rate.countryCode),
      service: rate.service,
      fromKg: String(rate.fromKg),
      toKg: String(rate.toKg),
      chargesPerKg: String(rate.chargesPerKg),
      maxBoxKg: String(rate.maxBoxKg),
    });
    setCountryError("");
    setMessage("");
  }

  async function refreshRates() {
    const [{ rates: nextRates }, { routeCharges: nextRouteCharges }] = await Promise.all([
      listCountryRateCards(),
      listCountryRouteCharges()
    ]);
    setRates(nextRates);
    setRouteCharges(nextRouteCharges);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // A rate is keyed by ISO-3166 alpha-2, so there is nothing to submit until
    // the typed text resolves to a country.
    if (!countryCode) {
      setCountryError(
        form.countryQuery.trim()
          ? `We could not match "${form.countryQuery.trim()}" to a country. Pick one from the list.`
          : "Pick a country from the list.",
      );
      return;
    }

    setBusy(true);
    setCountryError("");
    setError("");
    setMessage("");

    try {
      await saveCountryRateCard(toPayload(form, countryCode, selectedBand), editingRateId || undefined);
      await refreshRates();
      resetForm();
      toast.success(editingRateId ? "Rate card updated." : "Rate card added.");
    } catch (caughtError) {
      toast.error(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save rate card.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeRate(rateId: string) {
    if (!window.confirm("Remove this rate? Assigned accounts may lose coverage for this weight range.")) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await deleteCountryRateCard(rateId, true);
      await refreshRates();
      if (editingRateId === rateId) resetForm();
      setMessage("Rate card removed.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to remove rate card.",
      );
    } finally {
      setBusy(false);
    }
  }

  function exportRates() {
    const csv = buildCountryRateCardCsv(visibleRates);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `swiftline-${selectedBand.toLowerCase()}-rate-card.csv`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">
            Country Rate Card
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Maintain courier and cargo rates by country and weight slab.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
            <span className="text-xs font-semibold uppercase text-slate-500">Rate Card</span>
            <select
              value={selectedBand}
              onChange={(event) => {
                setSelectedBand(event.target.value as RateCardBand);
                resetForm();
              }}
              className="bg-transparent text-sm font-semibold text-slate-900 outline-none"
            >
              {rateCardBands.map((band) => <option key={band} value={band}>{formatRateCardBand(band)}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="inline-flex h-10 items-center gap-2 rounded-4xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-slate-500"
          >
            <FiUploadCloud aria-hidden="true" className="h-4 w-4" />
            Import Excel
          </button>
          <button
            type="button"
            onClick={exportRates}
            disabled={!visibleRates.length}
            className="inline-flex h-10 items-center gap-2 rounded-4xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            <FiDownload aria-hidden="true" className="h-4 w-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setSharing(true)}
            disabled={!bandRates.length}
            className="inline-flex h-10 items-center gap-2 rounded-4xl bg-[#0D1282] px-4 text-sm font-semibold text-white hover:bg-[#0a0e66] disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            <FiShare2 aria-hidden="true" className="h-4 w-4" />
            Share Rate Card
          </button>
        </div>
      </div>

      {sharing ? (
        <ShareRateCardDialog rates={rates} initialBand={selectedBand} onClose={() => setSharing(false)} />
      ) : null}

      {importing ? (
        <RateCardImportDialog
          initialBand={selectedBand}
          existingRates={rates}
          onClose={() => setImporting(false)}
          onImported={() => void refreshRates()}
        />
      ) : null}

      {error ? (
        <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mb-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {message}
        </div>
      ) : null}

      <RateCardAssignments />

      <form
        onSubmit={handleSubmit}
        className="mb-6 border border-slate-200 bg-white p-4 rounded-2xl"
      >
        <p className="mb-4 text-sm text-slate-600">
          Add multiple non-overlapping slabs for the same country and service.
        </p>
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7 items-end">
          <RateCardCountryPicker
            value={form.countryQuery}
            onChange={(value) => {
              updateField("countryQuery", value);
              setCountryError("");
            }}
            invalid={Boolean(countryError)}
          />

          <label>
            <span className="text-xs font-semibold uppercase text-slate-500">
              Service
            </span>

            <div className="relative mt-2">
              <select
                value={form.service}
                onChange={handleInput("service")}
                className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm font-semibold text-slate-900 outline-none focus:border-blue-900"
              >
                {countryRateServices.map((service) => (
                  <option key={service} value={service}>
                    {formatCountryRateService(service)}
                  </option>
                ))}
              </select>

              <span className="pointer-events-none absolute right-3 top-1/2 h-0 w-0 -translate-y-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-slate-500" />
            </div>
          </label>

          <RateInput
            label="From KG"
            value={form.fromKg}
            onChange={handleInput("fromKg")}
          />

          <RateInput
            label="To KG"
            value={form.toKg}
            onChange={handleInput("toKg")}
          />

          <RateInput
            label="Charges / KG"
            value={form.chargesPerKg}
            onChange={handleInput("chargesPerKg")}
          />

          <RateInput
            label="Max Box KG"
            value={form.maxBoxKg}
            onChange={handleInput("maxBoxKg")}
          />

          <div className="flex flex-col justify-end gap-2">
            <button
              type="submit"
              disabled={busy}
              className="h-10 rounded-4xl bg-blue-900 px-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busy ? "Saving..." : editingRateId ? "Update Rate" : " + Add Rate"}
            </button>

            {editingRateId ? (
              <button
                type="button"
                onClick={resetForm}
                className="h-10 rounded-4xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-slate-500"
              >
                Cancel Edit
              </button>
            ) : null}
          </div>
        </div>

        {countryError ? (
          <p className="mt-3 text-xs font-semibold text-red-600">{countryError}</p>
        ) : null}
      </form>

      {/* Keyed to the country selected above; service targeting is handled inside
          the route-charge section so it can update Courier and Cargo together. */}
      <RouteChargesForm
        band={selectedBand}
        countryCode={countryCode}
        countryName={countryCode ? countryName(countryCode) : ""}
        onSaved={() => void refreshRates()}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <FiSearch
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search a country or code"
            aria-label="Search rate card countries"
            className="h-10 w-full rounded-2xl border border-slate-300 bg-white pl-9 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-900"
          />
        </div>

        <select
          value={serviceFilter}
          onChange={(event) => setServiceFilter(event.target.value as CountryRateService | "")}
          aria-label="Filter by service"
          className="h-10 rounded-2xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-900"
        >
          <option value="">All services</option>
          {countryRateServices.map((service) => (
            <option key={service} value={service}>{formatCountryRateService(service)}</option>
          ))}
        </select>

        <p className="text-xs font-semibold text-slate-500">
          {visibleRates.length === bandRates.length
            ? `${bandRates.length} slab${bandRates.length === 1 ? "" : "s"}`
            : `${visibleRates.length} of ${bandRates.length} slabs`}
          {groups.length ? ` · ${groups.length} destination${groups.length === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      <div className="overflow-x-auto border border-slate-200 bg-white rounded-2xl ">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Weight (KG)</th>
              <th className="px-4 py-3">Charges / KG</th>
              <th className="px-4 py-3">Max Box KG</th>
              <th className="px-4 py-3">Route Charges</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {dataLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Loading rate cards...
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  {bandRates.length ? "No rates match this search." : "No country rate cards found."}
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                const open = isExpanded(group.key);
                const routeCharge = routeCharges.find((charge) =>
                  charge.band === selectedBand
                  && charge.countryCode === group.countryCode
                  && charge.service === group.service
                );
                const cheapest = Math.min(...group.rates.map((rate) => rate.chargesPerKg));
                const dearest = Math.max(...group.rates.map((rate) => rate.chargesPerKg));

                return (
                  <GroupRows
                    key={group.key}
                    group={group}
                    open={open}
                    onToggle={() => toggleGroup(group.key)}
                    routeChargeSummary={formatRouteChargeSummary(routeCharge)}
                    cheapest={cheapest}
                    dearest={dearest}
                    busy={busy}
                    onEdit={editRate}
                    onRemove={(rateId) => void removeRate(rateId)}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GroupRows({
  group,
  open,
  onToggle,
  routeChargeSummary,
  cheapest,
  dearest,
  busy,
  onEdit,
  onRemove,
}: {
  group: RateGroup;
  open: boolean;
  onToggle: () => void;
  routeChargeSummary: string;
  cheapest: number;
  dearest: number;
  busy: boolean;
  onEdit: (rate: CountryRateCard) => void;
  onRemove: (rateId: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-slate-100 bg-slate-50/70">
        <td colSpan={7} className="p-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <FiChevronRight
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
            />
            <CountryFlag code={group.countryCode} size={20} />
            <span className="font-semibold text-slate-950">{group.countryName}</span>
            <span className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
              {formatCountryRateService(group.service)}
            </span>
            <span className="text-xs text-slate-500">
              {group.rates.length} slab{group.rates.length === 1 ? "" : "s"}
              {" · "}
              {dearest === cheapest ? `${cheapest} / kg` : `${dearest} to ${cheapest} / kg`}
            </span>
            <span className="ml-auto hidden max-w-80 truncate text-xs text-slate-500 sm:block">
              {routeChargeSummary === "-" ? "No route charges" : routeChargeSummary}
            </span>
          </button>
        </td>
      </tr>

      {open
        ? group.rates.map((rate) => (
            <tr key={rate._id} className="border-b border-slate-100">
              <td className="px-4 py-3 pl-11 text-slate-500">{rate.countryCode}</td>
              <td className="px-4 py-3">{formatCountryRateService(rate.service)}</td>
              <td className="px-4 py-3">
                {rate.fromKg}
                <span>
                  <MdOutlineKeyboardDoubleArrowRight className="mx-1 mb-1 inline h-4 w-4 text-green-800" />
                </span>
                {rate.toKg}
              </td>
              <td className="px-4 py-3 font-semibold">{rate.chargesPerKg}</td>
              <td className="px-4 py-3">{rate.maxBoxKg}</td>
              <td className="px-4 py-3 max-w-5 text-xs text-slate-600">{routeChargeSummary}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => onEdit(rate)}
                    className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:text-blue-700"
                  >
                    <BiSolidEdit aria-hidden="true" className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(rate._id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 font-semibold text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <FiTrash2 aria-hidden="true" className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))
        : null}
    </>
  );
}

function formatRouteChargeSummary(routeCharge: CountryRouteCharge | undefined) {
  if (!routeCharge) return "-";

  const details: string[] = [];
  if (routeCharge.fuelSurchargePercent > 0) details.push(`Fuel ${routeCharge.fuelSurchargePercent}%`);
  if (routeCharge.remoteAreaCharge > 0) {
    const postcodes = routeCharge.remoteAreaPostcodes.length
      ? ` (${routeCharge.remoteAreaPostcodes.join(", ")})`
      : "";
    details.push(`Remote ₹${routeCharge.remoteAreaCharge.toFixed(2)}${postcodes}`);
  } else if (routeCharge.remoteAreaPostcodes.length) {
    details.push(`Remote areas (${routeCharge.remoteAreaPostcodes.join(", ")})`);
  }
  if (routeCharge.handlingCharge > 0) details.push(`Handling ₹${routeCharge.handlingCharge.toFixed(2)}`);
  // Insurance is omitted while cover is switched off portal-wide. A stored
  // percentage is kept on the route but is never priced, so summarising it here
  // would describe a charge no shipment can incur.
  if (routeCharge.discountPercent > 0) details.push(`Discount ${routeCharge.discountPercent}%`);

  return details.length ? details.join(" · ") : "-";
}

function RateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label>
      <span className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={onChange}
        required
        className="mt-2 h-10 w-full border rounded-2xl border-slate-300 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-900"
      />
    </label>
  );
}
