"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FiArrowLeft,
  FiArrowRight,
  FiCheck,
  FiCopy,
  FiMail,
  FiPlus,
  FiSend,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import { BsWhatsapp } from "react-icons/bs";
import { FlagImage, type CountryIso2 } from "react-international-phone";
import {
  formatCountryRateService,
  formatRateCardBand,
  rateCardBands,
  type CountryRateCard,
  type RateCardBand,
  type CountryRateService,
} from "@/lib/countryRateCards";
import {
  createRateCardShare,
  formatRate,
  type RateCardShareChannel,
  type RateCardShareResult,
} from "@/lib/rateCardShares";
import { listBusinessAccounts, type BusinessAccount } from "@/lib/businessAccounts";

// Standard Indian export-freight defaults. They are only a starting point — every
// field stays editable — but they mean a routine share needs no typing at all.
const DEFAULT_GST_PERCENT = 18;
const DEFAULT_VOLUMETRIC_DIVISOR = 5000;
const DEFAULT_VALIDITY_DAYS = 90;

const STEPS = ["Rates & pricing", "Commercial terms", "Recipients"] as const;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultTerms() {
  const validFrom = new Date();
  const validUntil = new Date(validFrom.getTime() + DEFAULT_VALIDITY_DAYS * 86_400_000);

  return {
    validFrom: isoDate(validFrom),
    validUntil: isoDate(validUntil),
    fuelSurchargePercent: "0",
    gstPercent: String(DEFAULT_GST_PERCENT),
    minChargeableWeightKg: "0",
    volumetricDivisor: String(DEFAULT_VOLUMETRIC_DIVISOR),
    remarks: "",
  };
}

export default function ShareRateCardDialog({
  rates,
  initialBand,
  onClose,
}: {
  rates: CountryRateCard[];
  initialBand: RateCardBand;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RateCardShareResult | null>(null);

  const [title, setTitle] = useState("International Rate Card");
  const [band, setBand] = useState<RateCardBand>(initialBand);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [services, setServices] = useState<CountryRateService[]>([]);
  const [adjustmentMode, setAdjustmentMode] = useState<"NONE" | "PERCENT" | "FLAT">("NONE");
  const [adjustmentValue, setAdjustmentValue] = useState("0");
  const [terms, setTerms] = useState(defaultTerms);
  const [customTerms, setCustomTerms] = useState<string[]>([]);

  const [channels, setChannels] = useState<RateCardShareChannel[]>(["PORTAL", "EMAIL"]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [emails, setEmails] = useState<{ email: string; name: string }[]>([]);
  const [phones, setPhones] = useState<{ phone: string; name: string }[]>([]);

  const availableCountries = useMemo(() => {
    const seen = new Map<string, string>();
    for (const rate of rates.filter((rate) => rate.band === band)) seen.set(rate.countryCode, rate.countryName);
    return [...seen.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [rates, band]);

  // The exact set the server will freeze, mirrored here so the composer can show
  // a live count and rate range before anything is sent.
  const matchingRates = useMemo(
    () =>
      rates.filter(
        (rate) =>
          rate.band === band &&
          (!countryCodes.length || countryCodes.includes(rate.countryCode)) &&
          (!services.length || services.includes(rate.service)),
      ),
    [rates, band, countryCodes, services],
  );

  const adjustedRange = useMemo(() => {
    if (!matchingRates.length) return null;
    const value = Number(adjustmentValue) || 0;
    const adjust = (base: number) => {
      if (adjustmentMode === "NONE" || !value) return base;
      const next = adjustmentMode === "PERCENT" ? base * (1 + value / 100) : base + value;
      return Math.max(Math.round(next * 100) / 100, 0);
    };

    const adjusted = matchingRates.map((rate) => adjust(rate.chargesPerKg));
    return { lowest: Math.min(...adjusted), highest: Math.max(...adjusted) };
  }, [matchingRates, adjustmentMode, adjustmentValue]);

  function toggle<T>(list: T[], value: T, set: (next: T[]) => void) {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function handleSubmit() {
    setBusy(true);
    setError("");

    try {
      const response = await createRateCardShare({
        band,
        title,
        channels,
        selection: { countryCodes, services, rateIds: [] },
        adjustmentMode,
        adjustmentValue: Number(adjustmentValue) || 0,
        terms: {
          validFrom: terms.validFrom,
          validUntil: terms.validUntil,
          fuelSurchargePercent: Number(terms.fuelSurchargePercent) || 0,
          gstPercent: Number(terms.gstPercent) || 0,
          minChargeableWeightKg: Number(terms.minChargeableWeightKg) || 0,
          volumetricDivisor: Number(terms.volumetricDivisor) || 0,
          remarks: terms.remarks,
          customTerms: customTerms.filter((term) => term.trim()),
        },
        recipientAccountIds: accountIds,
        recipientEmails: emails.filter((entry) => entry.email.trim()),
        recipientPhones: phones.filter((entry) => entry.phone.trim()),
      });

      setResult(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The rate card could not be shared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell onClose={onClose} title={result ? "Rate card shared" : "Share rate card"}>
      {result ? (
        <ShareResult result={result} onClose={onClose} />
      ) : (
        <>
          <StepBar step={step} />

          {error ? (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}

          {step === 0 ? (
            <RatesStep
              band={band}
              setBand={(nextBand) => {
                setBand(nextBand);
                setCountryCodes([]);
              }}
              title={title}
              setTitle={setTitle}
              availableCountries={availableCountries}
              countryCodes={countryCodes}
              toggleCountry={(code) => toggle(countryCodes, code, setCountryCodes)}
              services={services}
              toggleService={(service) => toggle(services, service, setServices)}
              adjustmentMode={adjustmentMode}
              setAdjustmentMode={setAdjustmentMode}
              adjustmentValue={adjustmentValue}
              setAdjustmentValue={setAdjustmentValue}
              matchCount={matchingRates.length}
              adjustedRange={adjustedRange}
              portalSelected={channels.includes("PORTAL")}
            />
          ) : null}

          {step === 1 ? (
            <TermsStep
              terms={terms}
              setTerms={setTerms}
              customTerms={customTerms}
              setCustomTerms={setCustomTerms}
            />
          ) : null}

          {step === 2 ? (
            <RecipientsStep
              band={band}
              channels={channels}
              toggleChannel={(channel) => {
                const next = channels.includes(channel)
                  ? channels.filter((item) => item !== channel)
                  : [...channels, channel];
                setChannels(next);
                if (channel === "PORTAL" && next.includes("PORTAL")) {
                  setAdjustmentMode("NONE");
                  setAdjustmentValue("0");
                }
              }}
              accountIds={accountIds}
              setAccountIds={setAccountIds}
              emails={emails}
              setEmails={setEmails}
              phones={phones}
              setPhones={setPhones}
            />
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
            >
              {step === 0 ? "Cancel" : <><FiArrowLeft className="h-4 w-4" /> Back</>}
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={step === 0 && !matchingRates.length}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0D1282] px-6 text-sm font-semibold text-white transition hover:bg-[#0a0e66] disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                Continue <FiArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={busy || !channels.length}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0D1282] px-6 text-sm font-semibold text-white transition hover:bg-[#0a0e66] disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                <FiSend className="h-4 w-4" />
                {busy ? "Sharing..." : "Share rate card"}
              </button>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}

/* ------------------------------------ Chrome ----------------------------------- */

function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-70 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="my-auto w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <FiX aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function StepBar({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2">
      {STEPS.map((label, index) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              index <= step ? "bg-[#0D1282] text-white" : "bg-slate-200 text-slate-500"
            }`}
          >
            {index < step ? <FiCheck className="h-3.5 w-3.5" /> : index + 1}
          </span>
          <span
            className={`hidden truncate text-xs font-semibold sm:block ${
              index <= step ? "text-slate-900" : "text-slate-400"
            }`}
          >
            {label}
          </span>
          {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-slate-200" /> : null}
        </li>
      ))}
    </ol>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#0D1282]";

/* ------------------------------------ Steps ------------------------------------ */

function RatesStep({
  band,
  setBand,
  title,
  setTitle,
  availableCountries,
  countryCodes,
  toggleCountry,
  services,
  toggleService,
  adjustmentMode,
  setAdjustmentMode,
  adjustmentValue,
  setAdjustmentValue,
  matchCount,
  adjustedRange,
  portalSelected,
}: {
  band: RateCardBand;
  setBand: (band: RateCardBand) => void;
  title: string;
  setTitle: (value: string) => void;
  availableCountries: { code: string; name: string }[];
  countryCodes: string[];
  toggleCountry: (code: string) => void;
  services: CountryRateService[];
  toggleService: (service: CountryRateService) => void;
  adjustmentMode: "NONE" | "PERCENT" | "FLAT";
  setAdjustmentMode: (mode: "NONE" | "PERCENT" | "FLAT") => void;
  adjustmentValue: string;
  setAdjustmentValue: (value: string) => void;
  matchCount: number;
  adjustedRange: { lowest: number; highest: number } | null;
  portalSelected: boolean;
}) {
  return (
    <div className="space-y-5">
      <Field label="Rate card title" hint="Shown as the heading on the PDF, the Excel sheet and the portal view.">
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
      </Field>

      <Field label="Rate card" hint="Only rows and route charges from this card will be included.">
        <select value={band} onChange={(event) => setBand(event.target.value as RateCardBand)} className={inputClass}>
          {rateCardBands.map((value) => <option key={value} value={value}>{formatRateCardBand(value)}</option>)}
        </select>
      </Field>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Destinations
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Leave everything unselected to share every destination on the rate card.
        </p>
        <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
          {availableCountries.map((country) => {
            const selected = countryCodes.includes(country.code);
            return (
              <button
                key={country.code}
                type="button"
                onClick={() => toggleCountry(country.code)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  selected
                    ? "border-[#0D1282] bg-[#0D1282]/10 text-[#0D1282]"
                    : "border-slate-300 text-slate-600 hover:border-slate-400"
                }`}
              >
                <span className="flex h-4 w-6 items-center justify-center overflow-hidden [&_img]:rounded-none">
                  <FlagImage iso2={country.code.toLowerCase() as CountryIso2} size="16px" />
                </span>
                {country.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service</p>
        <div className="mt-2 flex gap-2">
          {(["COURIER", "CARGO"] as const).map((service) => {
            const selected = services.includes(service);
            return (
              <button
                key={service}
                type="button"
                onClick={() => toggleService(service)}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                  selected
                    ? "border-[#0D1282] bg-[#0D1282]/10 text-[#0D1282]"
                    : "border-slate-300 text-slate-600 hover:border-slate-400"
                }`}
              >
                {formatCountryRateService(service)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Customer pricing
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          {portalSelected
            ? "Portal shares always use the recipient account's assigned rates, so additional adjustments are disabled."
            : "A positive value marks the rates up; a negative one discounts them. Adjusted documents are labelled external proposals."}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Adjustment">
            <select
              value={adjustmentMode}
              disabled={portalSelected}
              onChange={(event) => setAdjustmentMode(event.target.value as "NONE" | "PERCENT" | "FLAT")}
              className={inputClass}
            >
              <option value="NONE">None — share base rates</option>
              <option value="PERCENT">Percentage</option>
              <option value="FLAT">Flat amount per kg</option>
            </select>
          </Field>

          <Field label={adjustmentMode === "FLAT" ? "Amount per kg (INR)" : "Percentage (%)"}>
            <input
              type="number"
              step="0.01"
              value={adjustmentValue}
              disabled={adjustmentMode === "NONE"}
              onChange={(event) => setAdjustmentValue(event.target.value)}
              className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
            />
          </Field>
        </div>
      </div>

      <div
        className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
          matchCount
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        {matchCount ? (
          <>
            {matchCount} weight {matchCount === 1 ? "slab" : "slabs"} will be shared
            {adjustedRange
              ? ` · ${formatRate(adjustedRange.lowest)} — ${formatRate(adjustedRange.highest)} per kg`
              : ""}
          </>
        ) : (
          "No rates match this selection. Widen the destination or service filter."
        )}
      </div>
    </div>
  );
}

type TermsState = ReturnType<typeof defaultTerms>;

function TermsStep({
  terms,
  setTerms,
  customTerms,
  setCustomTerms,
}: {
  terms: TermsState;
  setTerms: (updater: (current: TermsState) => TermsState) => void;
  customTerms: string[];
  setCustomTerms: (next: string[]) => void;
}) {
  function update<K extends keyof TermsState>(key: K, value: TermsState[K]) {
    setTerms((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valid from">
          <input
            type="date"
            value={terms.validFrom}
            onChange={(event) => update("validFrom", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Valid until" hint="The share link stops working on this date.">
          <input
            type="date"
            value={terms.validUntil}
            onChange={(event) => update("validUntil", event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fuel surcharge (%)" hint="Leave at 0 to omit it from the sheet.">
          <input
            type="number"
            min="0"
            step="0.01"
            value={terms.fuelSurchargePercent}
            onChange={(event) => update("fuelSurchargePercent", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="GST (%)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={terms.gstPercent}
            onChange={(event) => update("gstPercent", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Min chargeable weight (kg)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={terms.minChargeableWeightKg}
            onChange={(event) => update("minChargeableWeightKg", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Volumetric divisor" hint="L × W × H in cm, divided by this number.">
          <input
            type="number"
            min="0"
            step="1"
            value={terms.volumetricDivisor}
            onChange={(event) => update("volumetricDivisor", event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Remarks" hint="Free text shown at the end of the PDF, the Excel sheet and the portal view.">
        <textarea
          rows={3}
          value={terms.remarks}
          onChange={(event) => update("remarks", event.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0D1282]"
        />
      </Field>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Additional terms
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Added below Swiftline&apos;s standard terms, which are always included.
        </p>

        <div className="mt-2 space-y-2">
          {customTerms.map((term, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={term}
                onChange={(event) =>
                  setCustomTerms(customTerms.map((item, position) => (position === index ? event.target.value : item)))
                }
                className="h-10 flex-1 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-[#0D1282]"
              />
              <button
                type="button"
                onClick={() => setCustomTerms(customTerms.filter((_, position) => position !== index))}
                aria-label="Remove term"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 text-red-600 transition hover:border-red-400"
              >
                <FiTrash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setCustomTerms([...customTerms, ""])}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-dashed border-slate-300 px-4 text-sm font-semibold text-slate-600 transition hover:border-[#0D1282] hover:text-[#0D1282]"
          >
            <FiPlus className="h-4 w-4" /> Add a term
          </button>
        </div>
      </div>
    </div>
  );
}

function RecipientsStep({
  band,
  channels,
  toggleChannel,
  accountIds,
  setAccountIds,
  emails,
  setEmails,
  phones,
  setPhones,
}: {
  band: RateCardBand;
  channels: RateCardShareChannel[];
  toggleChannel: (channel: RateCardShareChannel) => void;
  accountIds: string[];
  setAccountIds: (next: string[]) => void;
  emails: { email: string; name: string }[];
  setEmails: (next: { email: string; name: string }[]) => void;
  phones: { phone: string; name: string }[];
  setPhones: (next: { phone: string; name: string }[]) => void;
}) {
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void listBusinessAccounts(search, "", 1, 25)
        .then((result) => { if (active) setAccounts(result.accounts); })
        .catch(() => { if (active) setAccounts([]); });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search]);

  const channelCards: { channel: RateCardShareChannel; label: string; description: string; icon: React.ReactNode }[] = [
    {
      channel: "PORTAL",
      label: "Portal",
      description: "Appears in the client's rate card tray",
      icon: <FiSend className="h-4 w-4" />,
    },
    {
      channel: "EMAIL",
      label: "Email",
      description: "Branded email with PDF and Excel attached",
      icon: <FiMail className="h-4 w-4" />,
    },
    {
      channel: "WHATSAPP",
      label: "WhatsApp",
      description: "Formatted message with document links",
      icon: <BsWhatsapp className="h-4 w-4" />,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {channelCards.map((card) => {
          const selected = channels.includes(card.channel);
          return (
            <button
              key={card.channel}
              type="button"
              onClick={() => toggleChannel(card.channel)}
              className={`rounded-xl border p-4 text-left transition ${
                selected
                  ? "border-[#0D1282] bg-[#0D1282]/6 ring-1 ring-[#0D1282]/20"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
                selected ? "bg-[#0D1282] text-white" : "bg-slate-100 text-slate-500"
              }`}
              >
                {card.icon}
              </span>
              <span className="mt-2 block text-sm font-semibold text-slate-900">{card.label}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{card.description}</span>
            </button>
          );
        })}
      </div>

      {channels.includes("PORTAL") || channels.includes("EMAIL") ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Business accounts</p>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by company name or account ID"
            className={inputClass}
          />

          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {!accounts.length ? (
              <p className="px-2 py-4 text-center text-sm text-slate-500">No business accounts found.</p>
            ) : null}

            {accounts.map((account) => {
              const selected = accountIds.includes(account._id);
              const incompatible = channels.includes("PORTAL") && account.rateCardBand !== band;
              return (
                <button
                  key={account._id}
                  type="button"
                  disabled={incompatible}
                  onClick={() =>
                    setAccountIds(
                      selected ? accountIds.filter((id) => id !== account._id) : [...accountIds, account._id],
                    )
                  }
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${
                    selected ? "bg-[#0D1282]/10" : incompatible ? "cursor-not-allowed opacity-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {account.company?.companyName || account.accountId}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">{account.accountId}</span>
                    {incompatible ? <span className="block text-[10px] font-semibold text-amber-700">Assign {formatRateCardBand(band)} before portal sharing</span> : null}
                  </span>
                  {selected ? <FiCheck className="h-4 w-4 shrink-0 text-[#0D1282]" /> : null}
                </button>
              );
            })}
          </div>

          {accountIds.length ? (
            <p className="mt-2 text-[11px] font-semibold text-[#0D1282]">
              {accountIds.length} {accountIds.length === 1 ? "account" : "accounts"} selected
            </p>
          ) : null}
        </div>
      ) : null}

      {channels.includes("EMAIL") ? (
        <RecipientList
          label="Additional email recipients"
          hint="For prospects who have no portal account yet."
          placeholder="name@company.com"
          entries={emails.map((entry) => ({ value: entry.email, name: entry.name }))}
          onChange={(next) => setEmails(next.map((entry) => ({ email: entry.value, name: entry.name })))}
        />
      ) : null}

      {channels.includes("WHATSAPP") ? (
        <RecipientList
          label="WhatsApp numbers"
          hint="International format, for example +919876543210."
          placeholder="+919876543210"
          entries={phones.map((entry) => ({ value: entry.phone, name: entry.name }))}
          onChange={(next) => setPhones(next.map((entry) => ({ phone: entry.value, name: entry.name })))}
        />
      ) : null}
    </div>
  );
}

function RecipientList({
  label,
  hint,
  placeholder,
  entries,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  entries: { value: string; name: string }[];
  onChange: (next: { value: string; name: string }[]) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>

      <div className="mt-2 space-y-2">
        {entries.map((entry, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={entry.value}
              placeholder={placeholder}
              onChange={(event) =>
                onChange(entries.map((item, position) => (position === index ? { ...item, value: event.target.value } : item)))
              }
              className="h-10 flex-1 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-[#0D1282]"
            />
            <input
              value={entry.name}
              placeholder="Contact name"
              onChange={(event) =>
                onChange(entries.map((item, position) => (position === index ? { ...item, name: event.target.value } : item)))
              }
              className="h-10 w-40 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-[#0D1282]"
            />
            <button
              type="button"
              onClick={() => onChange(entries.filter((_, position) => position !== index))}
              aria-label={`Remove ${label}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 text-red-600 transition hover:border-red-400"
            >
              <FiTrash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => onChange([...entries, { value: "", name: "" }])}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-dashed border-slate-300 px-4 text-sm font-semibold text-slate-600 transition hover:border-[#0D1282] hover:text-[#0D1282]"
        >
          <FiPlus className="h-4 w-4" /> Add recipient
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------ Result ----------------------------------- */

/**
 * Shown once, after a successful share. The link token is never persisted in a
 * readable form, so this screen is the only place the working links exist —
 * hence the copy buttons and the warning.
 */
function ShareResult({ result, onClose }: { result: RateCardShareResult; onClose: () => void }) {
  const [copied, setCopied] = useState("");

  function copy(value: string, key: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(""), 2000);
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-semibold text-emerald-800">
          {result.share.shareNumber} is live
          {result.emailsQueued ? ` · ${result.emailsQueued} ${result.emailsQueued === 1 ? "email" : "emails"} queued` : ""}
        </p>
        <p className="mt-1 text-xs text-emerald-700">
          The link expires on {new Date(result.share.expiresAt).toLocaleDateString("en-GB")}. Copy it now — for
          security it is not stored and cannot be shown again.
        </p>
      </div>

      <div className="space-y-2">
        {([
          ["Rate card link", result.links.view, "view"],
          ["Direct PDF link", result.links.pdf, "pdf"],
          ["Direct Excel link", result.links.excel, "excel"],
        ] as const).map(([label, url, key]) => (
          <div key={key} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
              <p className="truncate font-mono text-xs text-slate-700">{url}</p>
            </div>
            <button
              type="button"
              onClick={() => copy(url, key)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282]"
            >
              {copied === key ? <FiCheck className="h-3.5 w-3.5" /> : <FiCopy className="h-3.5 w-3.5" />}
              {copied === key ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </div>

      {result.whatsappLinks.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Send on WhatsApp</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Each button opens WhatsApp with the formatted message and links already written.
          </p>

          <div className="mt-2 space-y-2">
            {result.whatsappLinks.map((entry) => (
              <div key={entry.phone} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{entry.name || entry.phone}</p>
                  {entry.name ? <p className="truncate text-xs text-slate-500">{entry.phone}</p> : null}
                </div>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-[#25D366] px-4 text-xs font-semibold text-white transition hover:bg-[#1ea952]"
                >
                  <BsWhatsapp className="h-3.5 w-3.5" />
                  Open chat
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex justify-end border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center rounded-full bg-[#0D1282] px-6 text-sm font-semibold text-white transition hover:bg-[#0a0e66]"
        >
          Done
        </button>
      </div>
    </div>
  );
}
