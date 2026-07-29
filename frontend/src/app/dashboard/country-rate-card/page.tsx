"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { FiDownload, FiEdit2, FiTrash2 } from "react-icons/fi";
import { FlagImage, type CountryIso2 } from "react-international-phone";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import { BiSolidEdit } from "react-icons/bi";
import { countryOptions } from "@/lib/branches";
import {
  buildCountryRateCardCsv,
  CountryRateCard,
  CountryRateCardInput,
  CountryRateService,
  countryRateServices,
  deleteCountryRateCard,
  formatCountryRateService,
  listCountryRateCards,
  saveCountryRateCard,
} from "@/lib/countryRateCards";
import { useAdminUser } from "@/lib/useAdminUser";

type FormState = {
  countryCode: string;
  service: CountryRateService;
  fromKg: string;
  toKg: string;
  chargesPerKg: string;
  maxBoxKg: string;
};

const defaultForm: FormState = {
  countryCode: "GB",
  service: "COURIER",
  fromKg: "",
  toKg: "",
  chargesPerKg: "",
  maxBoxKg: "",
};

function getCountryName(countryCode: string) {
  return (
    countryOptions.find((country) => country.code === countryCode)?.name ??
    countryCode
  );
}

function getCountryIso2(countryCode: string) {
  return countryCode.toLowerCase() as CountryIso2;
}

function toPayload(form: FormState): CountryRateCardInput {
  return {
    countryCode: form.countryCode,
    countryName: getCountryName(form.countryCode),
    service: form.service,
    fromKg: Number(form.fromKg),
    toKg: Number(form.toKg),
    chargesPerKg: Number(form.chargesPerKg),
    maxBoxKg: Number(form.maxBoxKg),
  };
}

export default function CountryRateCardPage() {
  const { user, loading } = useAdminUser();
  const [rates, setRates] = useState<CountryRateCard[]>([]);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [editingRateId, setEditingRateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;

    async function loadRates() {
      setDataLoading(true);
      setError("");

      try {
        const result = await listCountryRateCards();
        setRates(result.rates);
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
    setMessage("");
  }

  function editRate(rate: CountryRateCard) {
    setEditingRateId(rate._id);
    setForm({
      countryCode: rate.countryCode,
      service: rate.service,
      fromKg: String(rate.fromKg),
      toKg: String(rate.toKg),
      chargesPerKg: String(rate.chargesPerKg),
      maxBoxKg: String(rate.maxBoxKg),
    });
    setMessage("");
  }

  async function refreshRates() {
    const result = await listCountryRateCards();
    setRates(result.rates);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await saveCountryRateCard(toPayload(form), editingRateId || undefined);
      await refreshRates();
      resetForm();
      setMessage(editingRateId ? "Rate card updated." : "Rate card added.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save rate card.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeRate(rateId: string) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await deleteCountryRateCard(rateId);
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
    const csv = buildCountryRateCardCsv(rates);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "swiftline-country-rate-card.csv";
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">
            Country Rate Card
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Maintain courier and cargo rates by country and weight slab.
          </p>
        </div>
        <button
          type="button"
          onClick={exportRates}
          disabled={!rates.length}
          className="inline-flex h-10 items-center gap-2 rounded-4xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          <FiDownload aria-hidden="true" className="h-4 w-4" />
          Export
        </button>
      </div>

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

      <form
        onSubmit={handleSubmit}
        className="mb-6 border border-slate-200 bg-white p-4 rounded-2xl"
      >
        <p className="mb-4 text-sm text-slate-600">
          Add multiple non-overlapping slabs for the same country and service.
        </p>
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7 items-end">
  <CountryRateSelect
    value={form.countryCode}
    onChange={(countryCode) => updateField("countryCode", countryCode)}
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
        {/* <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="h-10 bg-blue-900 px-4 text-sm font-semibold rounded-4xl text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {busy ? "Saving..." : editingRateId ? "Update Rate" : "Add Rate"}
          </button>
          {editingRateId ? (
            <button
              type="button"
              onClick={resetForm}
              className="h-10 border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-slate-500"
            >
              Cancel Edit
            </button>
          ) : null}
        </div> */}
      </form>

      <div className="overflow-x-auto border border-slate-200 bg-white rounded-2xl ">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">From KG</th>
              <th className="px-4 py-3">To KG</th>
              <th className="px-4 py-3">Charges / KG</th>
              <th className="px-4 py-3">Max Box KG</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {dataLoading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading rate cards...
                </td>
              </tr>
            ) : rates.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No country rate cards found.
                </td>
              </tr>
            ) : (
              rates.map((rate) => (
                <tr
                  key={rate._id}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <p className="flex items-center gap-2 font-semibold text-slate-950">
                      <span className="flex h-5 w-7 items-center justify-center overflow-hidden [&_img]:rounded-none">
                        <FlagImage
                          iso2={getCountryIso2(rate.countryCode)}
                          size="20px"
                        />
                      </span>
                      <span>{rate.countryName}</span>
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {formatCountryRateService(rate.service)}
                  </td>
                  <td className="px-4 py-3">{rate.fromKg}</td>
                  <td className="px-4 py-3">{rate.toKg}</td>
                  <td className="px-4 py-3 font-semibold">
                    {rate.chargesPerKg}
                  </td>
                  <td className="px-4 py-3">{rate.maxBoxKg}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => editRate(rate)}
                        className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:text-blue-700"
                      >
                        <BiSolidEdit  aria-hidden="true" className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeRate(rate._id)}
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
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}

function CountryRateSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const selectedCountry =
    countryOptions.find((country) => country.code === value) ??
    countryOptions[0];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function selectCountry(country: (typeof countryOptions)[number]) {
    onChange(country.code);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        Math.min(current + 1, countryOptions.length - 1),
      );
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    }

    if (event.key === "Enter" && countryOptions[highlightedIndex]) {
      event.preventDefault();
      selectCountry(countryOptions[highlightedIndex]);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative min-w-0"
      onKeyDown={handleKeyDown}
    >
      <span className="text-xs font-semibold uppercase text-slate-500">
        Country
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Country"
        onClick={() => {
          setOpen((current) => !current);
          setHighlightedIndex(0);
        }}
        className="mt-2 flex h-10 w-full rounded-2xl items-center gap-3 border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-900 outline-none focus:border-blue-900"
      >
        <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
          <FlagImage iso2={getCountryIso2(selectedCountry.code)} size="20px" />
        </span>
        <span className="min-w-0 flex-1 truncate">{selectedCountry.name}</span>
      </button>

      {open ? (
        <div
          ref={listRef}
          className="absolute top-full z-50 mt-1 max-h-64 w-full overflow-y-auto border border-slate-200 bg-white shadow-lg"
        >
          {countryOptions.map((country, index) => (
            <button
              key={country.code}
              type="button"
              data-index={index}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectCountry(country)}
              className={`flex h-11 w-full items-center gap-3 px-3 text-left text-sm ${
                highlightedIndex === index
                  ? "bg-blue-50 text-blue-900"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
                <FlagImage iso2={getCountryIso2(country.code)} size="20px" />
              </span>
              <span className="truncate">{country.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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
