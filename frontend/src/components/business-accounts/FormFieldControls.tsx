"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { CountrySelector, FlagImage, defaultCountries, parseCountry, type CountryIso2 } from "react-international-phone";
import { FiChevronDown } from "react-icons/fi";
import {
  BusinessAccount,
  BusinessAccountFormData,
  DocumentType
} from "@/lib/businessAccounts";

// Shared form values and types used across the multi-step business account wizard.
export type SelectOption = {
  value: string;
  label: string;
  iso2?: CountryIso2;
};

export type UniqueField = "email" | "mobileNumber" | "registrationId";
export type ExistingDocuments = NonNullable<BusinessAccount["documents"]>;

export type ContactUpdater = <Key extends keyof BusinessAccountFormData["contact"]>(
  key: Key,
  value: BusinessAccountFormData["contact"][Key]
) => void;

export type CompanyUpdater = <Key extends keyof BusinessAccountFormData["company"]>(
  key: Key,
  value: BusinessAccountFormData["company"][Key]
) => void;

export const businessAccountSteps = ["Contact Details", "Company Details", "Upload Documents", "Review & Submit"];

export const departments = [
  "Management",
  "Operations",
  "Logistics",
  "Finance",
  "Procurement",
  "Accounts",
  "Sales",
  "Import and Export",
  "Other"
];

export const industries = [
  "Freight Forwarder",
  "Custom House Agent (CHA)",
  "Broker/Agent",
  "E-commerce",
  "Retail",
  "Manufacturing",
  "Healthcare",
  "Pharmaceuticals",
  "Automotive",
  "Electronics",
  "Fashion and Apparel",
  "Food and Beverage",
  "FMCG",
  "Import and Export",
  "Construction",
  "Agriculture",
  "Chemicals",
  "Information Technology",
  "Professional Services",
  "Other"
];

export const shipmentVolumes = [
  "1-50 shipments",
  "51-200 shipments",
  "201-500 shipments",
  "501-1,000 shipments",
  "1,001-5,000 shipments",
  "More than 5,000 shipments"
];

export const countryOptions: SelectOption[] = [
  { value: "India", label: "India", iso2: "in" },
  { value: "United States", label: "United States", iso2: "us" },
  { value: "United Kingdom", label: "United Kingdom", iso2: "gb" },
  { value: "Canada", label: "Canada", iso2: "ca" },
  { value: "Australia", label: "Australia", iso2: "au" },
  { value: "United Arab Emirates", label: "United Arab Emirates", iso2: "ae" },
  { value: "Saudi Arabia", label: "Saudi Arabia", iso2: "sa" },
  { value: "Singapore", label: "Singapore", iso2: "sg" },
  { value: "China", label: "China", iso2: "cn" },
  { value: "Japan", label: "Japan", iso2: "jp" },
  { value: "Germany", label: "Germany", iso2: "de" },
  { value: "France", label: "France", iso2: "fr" },
  { value: "Italy", label: "Italy", iso2: "it" },
  { value: "Netherlands", label: "Netherlands", iso2: "nl" },
  { value: "Belgium", label: "Belgium", iso2: "be" },
  { value: "Spain", label: "Spain", iso2: "es" },
  { value: "Switzerland", label: "Switzerland", iso2: "ch" },
  { value: "South Korea", label: "South Korea", iso2: "kr" },
  { value: "Indonesia", label: "Indonesia", iso2: "id" },
  { value: "Malaysia", label: "Malaysia", iso2: "my" },
  { value: "Thailand", label: "Thailand", iso2: "th" },
  { value: "Vietnam", label: "Vietnam", iso2: "vn" },
  { value: "Bangladesh", label: "Bangladesh", iso2: "bd" },
  { value: "Nepal", label: "Nepal", iso2: "np" },
  { value: "Sri Lanka", label: "Sri Lanka", iso2: "lk" },
  { value: "South Africa", label: "South Africa", iso2: "za" },
  { value: "Brazil", label: "Brazil", iso2: "br" },
  { value: "Mexico", label: "Mexico", iso2: "mx" },
  { value: "New Zealand", label: "New Zealand", iso2: "nz" },
  { value: "Qatar", label: "Qatar", iso2: "qa" },
  { value: "Oman", label: "Oman", iso2: "om" },
  { value: "Kuwait", label: "Kuwait", iso2: "kw" },
  { value: "Bahrain", label: "Bahrain", iso2: "bh" },
  { value: "Other", label: "Other" }
];

export const registrationCountryOptions = [
  { value: "United Kingdom", label: "United Kingdom", iso2: "gb" as CountryIso2 },
  { value: "United States", label: "United States", iso2: "us" as CountryIso2 },
  { value: "India", label: "India", iso2: "in" as CountryIso2 },
  { value: "France", label: "France", iso2: "fr" as CountryIso2 },
  { value: "Netherlands", label: "Netherlands", iso2: "nl" as CountryIso2 },
  { value: "Kuwait", label: "Kuwait", iso2: "kw" as CountryIso2 },
  { value: "Canada", label: "Canada", iso2: "ca" as CountryIso2 },
  { value: "Switzerland", label: "Switzerland", iso2: "ch" as CountryIso2 },
  { value: "Poland", label: "Poland", iso2: "pl" as CountryIso2 }
];

export const currencyOptions: SelectOption[] = [
  { value: "INR", label: "INR - Indian Rupee", iso2: "in" },
  { value: "USD", label: "USD - US Dollar", iso2: "us" },
  { value: "GBP", label: "GBP - Pound Sterling", iso2: "gb" },
  { value: "EUR", label: "EUR - Euro", iso2: "fr" },
  { value: "AED", label: "AED - UAE Dirham", iso2: "ae" },
  { value: "CAD", label: "CAD - Canadian Dollar", iso2: "ca" },
  { value: "AUD", label: "AUD - Australian Dollar", iso2: "au" },
  { value: "SGD", label: "SGD - Singapore Dollar", iso2: "sg" },
  { value: "SAR", label: "SAR - Saudi Riyal", iso2: "sa" },
  { value: "JPY", label: "JPY - Japanese Yen", iso2: "jp" },
  { value: "CNY", label: "CNY - Chinese Yuan", iso2: "cn" },
  { value: "CHF", label: "CHF - Swiss Franc", iso2: "ch" },
  { value: "NZD", label: "NZD - New Zealand Dollar", iso2: "nz" },
  { value: "QAR", label: "QAR - Qatari Riyal", iso2: "qa" },
  { value: "KWD", label: "KWD - Kuwaiti Dinar", iso2: "kw" },
  { value: "BHD", label: "BHD - Bahraini Dinar", iso2: "bh" },
  { value: "OMR", label: "OMR - Omani Rial", iso2: "om" },
];

export const shipmentTypeOptions = [
  { value: "international_cargo", label: "International Cargo" },
  { value: "international_courier", label: "International Courier" }
];

export const titleOptions = [
  { value: "mr.", label: "Mr." },
  { value: "mrs.", label: "Mrs." },
  { value: "ms.", label: "Ms." },
  { value: "dr.", label: "Dr." },
  { value: "prof.", label: "Prof." }
];

export const mobileTypeOptions = [
  { value: "mobile", label: "Mobile" },
  { value: "office", label: "Office" }
];

export const companyTypeOptions = [
  { value: "pvt_ltd", label: "Pvt. Ltd" },
  { value: "llp", label: "LLP" },
  { value: "enterprise", label: "Enterprise" }
];

export const canadaRegistrationTypeOptions = [
  { value: "business_number", label: "Business number" },
  { value: "registry_or_corporation_number", label: "Registry ID / Corporation number" },
  { value: "quebec_enterprise_number", label: "Quebec enterprise number" }
];

export const registrationConfig: Record<string, {
  primaryLabel?: string;
  primaryInfo?: string;
  primaryTypeValue?: string;
  secondaryLabel?: string;
  secondaryInfo?: string;
  secondaryTypeValue?: string;
}> = {
  "United Kingdom": {
    primaryLabel: "TAX (CRID) Company Registration ID",
    primaryInfo: "Enter your UK CRID or company tax registration ID.",
    primaryTypeValue: "tax_crid"
  },
  India: {
    primaryLabel: "Permanent Account Number (PAN)",
    primaryInfo: "Enter the company PAN issued in India.",
    primaryTypeValue: "pan"
  },
  France: {
    primaryLabel: "VAT (VAT Registration)",
    primaryInfo: "Enter your French VAT registration number.",
    primaryTypeValue: "vat",
    secondaryLabel: "TAX (SIREN) Registration Code",
    secondaryInfo: "Enter your French SIREN registration code.",
    secondaryTypeValue: "siren"
  },
  Netherlands: {
    primaryLabel: "VAT (VAT Registration)",
    primaryInfo: "Enter your Netherlands VAT registration number.",
    primaryTypeValue: "vat",
    secondaryLabel: "KVK Number",
    secondaryInfo: "Enter your Netherlands KVK number.",
    secondaryTypeValue: "kvk"
  },
  Switzerland: {
    primaryLabel: "UIDHQ",
    primaryInfo: "Enter your Swiss UIDHQ number.",
    primaryTypeValue: "uidhq"
  },
  Poland: {
    primaryLabel: "VAT (VAT Registration)",
    primaryInfo: "Enter your Polish VAT registration number.",
    primaryTypeValue: "vat"
  }
};

const phoneCountries = defaultCountries.map(parseCountry);
export const preferredPhoneCountries: CountryIso2[] = ["in", "ae", "us", "gb", "sg", "ca", "au", "sa"];

export function toOptions(values: string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

export function getPhoneCountryByDialCode(countryCode: string) {
  const dialCode = countryCode.replace(/^\+/, "");

  return phoneCountries.find((country) => country.dialCode === dialCode)
    ?? phoneCountries.find((country) => country.iso2 === "in")
    ?? phoneCountries[0];
}

export function getCurrencyCode(value: string) {
  return value.split(" - ")[0] || value;
}

export function getDocumentLabel(type: DocumentType) {
  if (type === "aadhaarCard") return "Aadhaar Card";
  if (type === "panCard") return "PAN Card Copy";
  if (type === "adCertificate") return "AD Certificate";
  if (type === "msmeCertificate") return "MSME Certificate";
  if (type === "tanCertificate") return "TAN Certificate";
  if (type === "otherCertificate") return "Other Certificate";
  if (type === "gstCertificate") return "GST Certificate";
  return "IEC Certificate";
}

function DropdownChevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <FiChevronDown
      aria-hidden="true"
      className={`h-5 w-5 shrink-0 stroke-[2.6] text-[#0D1282] transition ${open ? "rotate-180" : ""} ${className}`}
    />
  );
}

export function formatShipmentType(value: string) {
  return shipmentTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function Field({
  label,
  value,
  onChange,
  onBlur,
  error,
  helper,
  type = "text",
  placeholder,
  maxLength,
  max,
  info,
  disabled = false,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  helper?: string;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  max?: number;
  info?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const inputPlaceholder = placeholder ?? `${label}${required ? " *" : ""}`;

  return (
    <label className="block">
      <span className="relative block">
        <input
          type={type}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          maxLength={maxLength}
          max={max}
          disabled={disabled}
          placeholder={inputPlaceholder}
          aria-label={label}
          aria-invalid={Boolean(error)}
          className={`block h-14 w-full rounded-xl border bg-white py-0 pl-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-[#EEEDED]/60 disabled:text-slate-500 ${
            info ? "pr-10" : "pr-3"
          } ${
            error
              ? "border-[#D71313] focus:border-[#D71313] focus:ring-[#D71313]/15"
              : "border-[#EEEDED] focus:border-[#0D1282] focus:ring-[#F0DE36]/35"
          }`}
        />
        {info ? (
          <span className="group absolute right-3 top-1/2 z-20 -translate-y-1/2">
            <span
              aria-label={info}
              tabIndex={0}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0D1282] text-[10px] font-bold text-white outline-none transition focus:ring-2 focus:ring-[#F0DE36]/50"
            >
              i
            </span>
            <span className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 hidden w-56 max-w-[calc(100vw-2rem)] rounded-xl bg-[#0D1282] px-3 py-2 text-left text-xs font-semibold leading-5 text-white shadow-xl group-hover:block group-focus-within:block">
              {info}
            </span>
          </span>
        ) : null}
      </span>
      {error ? <p className="mt-1 text-xs font-semibold text-[#D71313]">{error}</p> : null}
      {!error && helper ? <p className="mt-1 text-xs font-medium text-slate-500">{helper}</p> : null}
    </label>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled = false
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`inline-flex items-center gap-3 text-sm font-medium ${disabled ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-800"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-[#EEEDED] accent-[#0D1282] disabled:cursor-not-allowed"
      />
      <span>{label}</span>
    </label>
  );
}

export function CountryRegistrationSelect({
  label,
  value,
  onChange,
  error,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // No fallback to a default country: if the stored value is not a listed option,
  // show it as-is rather than misrepresenting it as another country.
  const selectedOption = registrationCountryOptions.find((option) => option.value === value) ?? null;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlightedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function selectOption(option: (typeof registrationCountryOptions)[number]) {
    onChange(option.value);
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
      setHighlightedIndex((current) => Math.min(current + 1, registrationCountryOptions.length - 1));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    }

    if (event.key === "Enter" && registrationCountryOptions[highlightedIndex]) {
      event.preventDefault();
      selectOption(registrationCountryOptions[highlightedIndex]);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0" onKeyDown={handleKeyDown}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setOpen((current) => !current);
          setHighlightedIndex(0);
        }}
        className={`flex h-14 w-full min-w-0 items-center gap-3 rounded-xl border bg-white px-3 text-left text-sm shadow-sm outline-none transition focus:ring-2 ${
          error
            ? "border-[#D71313] focus:border-[#D71313] focus:ring-[#D71313]/15"
            : "border-[#EEEDED] focus:border-[#0D1282] focus:ring-[#F0DE36]/35"
        }`}
      >
        <span className="flex h-8 w-10 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
          {selectedOption ? <FlagImage iso2={selectedOption.iso2} size="32px" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-medium uppercase text-slate-500">
            {label}{required ? " *" : ""}
          </span>
          <span className="block truncate text-sm font-medium text-slate-950">{selectedOption?.label ?? (value || "Select a country")}</span>
        </span>
        <DropdownChevron open={open} className="mr-1" />
      </button>

      {open ? (
        <div className="absolute top-full z-50 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-[#EEEDED] bg-white p-1 shadow-xl" ref={listRef}>
          {registrationCountryOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              data-index={index}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectOption(option)}
              className={`flex h-12 w-full items-center gap-3 px-3 text-left text-sm ${
                highlightedIndex === index ? "rounded-lg bg-[#F0DE36]/20 text-[#0D1282]" : "rounded-lg text-slate-700 hover:bg-[#EEEDED]/60"
              }`}
            >
              <span className="flex h-6 w-8 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
                <FlagImage iso2={option.iso2} size="24px" />
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-1 text-xs font-semibold text-[#D71313]">{error}</p> : null}
    </div>
  );
}

export function CountryCodeField({
  value,
  onChange,
  error,
  required = false
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
}) {
  const selectedCountry = getPhoneCountryByDialCode(value);

  return (
    <div className="block">
      <CountrySelector
        selectedCountry={selectedCountry.iso2}
        preferredCountries={preferredPhoneCountries}
        onSelect={(country) => onChange(`+${country.dialCode}`)}
        renderButtonWrapper={({ rootProps }) => (
          <button
            {...rootProps}
            type="button"
            aria-label={`Country${required ? " required" : ""}`}
            className={`flex h-14 w-full min-w-0 items-center gap-2 rounded-xl border bg-white px-3 py-0 text-left text-sm shadow-sm outline-none transition focus:ring-2 ${
              error
                ? "border-[#D71313] focus:border-[#D71313] focus:ring-[#D71313]/15"
                : "border-[#EEEDED] focus:border-[#0D1282] focus:ring-[#F0DE36]/35"
            }`}
          >
            <span className="flex h-6 w-8 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
              <FlagImage iso2={selectedCountry.iso2} size="24px" />
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-900">{selectedCountry.name} {""} +{selectedCountry.dialCode}</span>
            {/* <span className="shrink-0 font-semibold text-slate-600">+{selectedCountry.dialCode}</span> */}
            <FiChevronDown aria-hidden="true" className="mr-1 h-5 w-5 shrink-0 stroke-[2.6] text-[#0D1282]" />
          </button>
        )}
      />
      {error ? <p className="mt-1 text-xs font-semibold text-[#D71313]">{error}</p> : null}
    </div>
  );
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  error,
  required = false,
  placeholder,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
  required?: boolean;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const displayPlaceholder = placeholder ?? `${label}${required ? " *" : ""}`;
  const filteredOptions = search.trim()
    ? options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setOpenUp(window.innerHeight - rect.bottom < 320 && rect.top > 320);
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlightedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function selectOption(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    setSearch("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    if (!open && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      setOpen(true);
      setSearch((current) => `${current}${event.key}`);
      setHighlightedIndex(0);
      return;
    }

    if (event.key === "Backspace" && search) {
      event.preventDefault();
      setSearch((current) => current.slice(0, -1));
      setHighlightedIndex(0);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setSearch("");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    }

    if (event.key === "Enter" && filteredOptions[highlightedIndex]) {
      event.preventDefault();
      selectOption(filteredOptions[highlightedIndex]);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0" onKeyDown={handleKeyDown}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => {
            const nextOpen = !current;
            if (!nextOpen) setSearch("");
            return nextOpen;
          });
          setHighlightedIndex(0);
        }}
        className={`flex h-14 w-full min-w-0 items-center rounded-xl border bg-white py-0 pl-4 pr-11 text-left text-sm shadow-sm outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:bg-[#EEEDED]/60 disabled:text-slate-500 ${
          error
            ? "border-[#D71313] focus:border-[#D71313] focus:ring-[#D71313]/15"
            : "border-[#EEEDED] focus:border-[#0D1282] focus:ring-[#F0DE36]/35"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedOption?.iso2 ? (
            <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
              <FlagImage iso2={selectedOption.iso2} size="20px" />
            </span>
          ) : null}
          <span title={search || selectedOption?.label || displayPlaceholder} className={search || selectedOption ? "block truncate text-slate-900" : "block truncate text-slate-400"}>
            {search || selectedOption?.label || displayPlaceholder}
          </span>
        </span>
        <DropdownChevron open={open} className="pointer-events-none absolute right-5" />
      </button>

      {open && !disabled ? (
        <div
          className={`absolute z-50 w-full overflow-hidden rounded-xl border border-[#EEEDED] bg-white p-1 shadow-xl ${
            openUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <div ref={listRef} className="max-h-64 overflow-y-auto overscroll-contain">
            {filteredOptions.length ? filteredOptions.map((option, index) => (
              <button
                key={option.value}
                type="button"
                data-index={index}
                title={option.label}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option)}
                className={`flex h-10 w-full items-center gap-2 px-3 text-left text-sm ${
                  highlightedIndex === index ? "rounded-lg bg-[#F0DE36]/20 text-[#0D1282]" : "rounded-lg text-slate-700 hover:bg-[#EEEDED]/60"
                }`}
              >
                {option.iso2 ? (
                  <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
                    <FlagImage iso2={option.iso2} size="20px" />
                  </span>
                ) : null}
                <span className="truncate">{option.label}</span>
              </button>
            )) : (
              <p className="px-3 py-4 text-sm text-slate-500">No options found.</p>
            )}
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs font-semibold text-[#D71313]">{error}</p> : null}
    </div>
  );
}

export function MultiSearchableSelect({
  label,
  values,
  onChange,
  options,
  error,
  required = false,
  disabled = false
}: {
  label: string;
  values: string[];
  onChange: (value: string[]) => void;
  options: SelectOption[];
  error?: string;
  required?: boolean;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const filteredOptions = search.trim()
    ? options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const selectedOptions = values
    .map((value) => options.find((option) => option.value === value))
    .filter((option): option is SelectOption => Boolean(option));
  const visibleChips = selectedOptions.slice(0, 3);
  const hiddenCount = Math.max(selectedOptions.length - visibleChips.length, 0);
  const placeholder = `${label}${required ? " *" : ""}`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setOpenUp(window.innerHeight - rect.bottom < 320 && rect.top > 320);
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlightedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function toggleValue(value: string) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
    setSearch("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    if (!open && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      setOpen(true);
      setSearch((current) => `${current}${event.key}`);
      setHighlightedIndex(0);
      return;
    }

    if (event.key === "Backspace" && search) {
      event.preventDefault();
      setSearch((current) => current.slice(0, -1));
      setHighlightedIndex(0);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setSearch("");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    }

    if (event.key === "Enter" && filteredOptions[highlightedIndex]) {
      event.preventDefault();
      toggleValue(filteredOptions[highlightedIndex].value);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0" onKeyDown={handleKeyDown}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => {
            const nextOpen = !current;
            if (!nextOpen) setSearch("");
            return nextOpen;
          });
          setHighlightedIndex(0);
        }}
        className={`flex min-h-14 w-full min-w-0 items-center rounded-xl border bg-white py-2 pl-4 pr-11 text-left text-sm shadow-sm outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:bg-[#EEEDED]/60 disabled:text-slate-500 ${
          error
            ? "border-[#D71313] focus:border-[#D71313] focus:ring-[#D71313]/15"
            : "border-[#EEEDED] focus:border-[#0D1282] focus:ring-[#F0DE36]/35"
        }`}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 overflow-hidden">
          {search ? (
            <span className="truncate text-slate-900">{search}</span>
          ) : visibleChips.length ? visibleChips.map((option) => (
            <span key={option.value} title={option.label} className="inline-flex max-w-42.5 items-center gap-1 rounded-full bg-[#EEEDED] px-2.5 py-1 text-xs font-semibold text-[#0D1282]">
              {option.iso2 ? (
                <span className="flex h-4 w-6 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
                  <FlagImage iso2={option.iso2} size="16px" />
                </span>
              ) : null}
              <span className="truncate">{option.label}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleValue(option.value);
                }}
                className="text-slate-500 hover:text-[#D71313]"
              >
                x
              </span>
            </span>
          )) : <span className="truncate text-slate-400">{placeholder}</span>}
          {!search && hiddenCount ? <span className="text-xs font-semibold text-slate-500">+{hiddenCount} more</span> : null}
        </span>
        <DropdownChevron open={open} className="pointer-events-none absolute right-5" />
      </button>

      {open && !disabled ? (
        <div
          className={`absolute z-50 w-full overflow-hidden rounded-xl border border-[#EEEDED] bg-white p-1 shadow-xl ${
            openUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {values.length ? (
            <div className="sticky top-0 z-10 mb-1 rounded-lg bg-[#EEEDED]/65 p-2">
              <button type="button" onClick={() => onChange([])} className="text-xs font-semibold text-[#D71313]">
                Clear all
              </button>
            </div>
          ) : null}
          <div ref={listRef} className="max-h-64 overflow-y-auto overscroll-contain">
            {filteredOptions.length ? filteredOptions.map((option, index) => {
              const selected = values.includes(option.value);

              return (
                <button
                  key={option.value}
                  type="button"
                  data-index={index}
                  title={option.label}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => toggleValue(option.value)}
                  className={`flex h-10 w-full items-center justify-between gap-3 px-3 text-left text-sm ${
                    highlightedIndex === index ? "rounded-lg bg-[#F0DE36]/20 text-[#0D1282]" : "rounded-lg text-slate-700 hover:bg-[#EEEDED]/60"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.iso2 ? (
                      <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
                        <FlagImage iso2={option.iso2} size="20px" />
                      </span>
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </span>
                  {selected ? <span className="shrink-0 rounded-full bg-[#F0DE36]/25 px-2 py-1 text-xs font-semibold text-[#0D1282]">Selected</span> : null}
                </button>
              );
            }) : (
              <p className="px-3 py-4 text-sm text-slate-500">No countries found.</p>
            )}
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs font-semibold text-[#D71313]">{error}</p> : null}
    </div>
  );
}

export function DocumentInput({
  type,
  required,
  helper,
  existingFileName,
  file,
  error,
  onChange
}: {
  type: DocumentType;
  required: boolean;
  helper: string;
  existingFileName?: string;
  file: File | null;
  error?: string;
  onChange: (file: File | null) => void;
}) {
  const inputId = `document-upload-${type}`;

  return (
    <div className="rounded-2xl bg-[#EEEDED]/35 p-5 ring-1 ring-[#EEEDED]">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-stretch">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#0D1282]">
            {getDocumentLabel(type)} {required ? <span className="text-[#D71313]">*</span> : null}
          </h3>
          <p className="mt-1 text-sm text-slate-500">{helper}</p>
          <p className="mt-1 text-xs text-slate-400">Supported formats: PDF, JPG, JPEG, PNG. Max size: 5 MB.</p>

          <label
            htmlFor={inputId}
            className={`mt-4 flex min-h-28 cursor-pointer flex-col justify-center rounded-xl border-2 border-dashed px-5 py-5 transition hover:border-[#0D1282]/50 hover:bg-[#F0DE36]/10 ${
              error ? "border-[#D71313] bg-[#D71313]/5" : "border-[#0D1282]/20 bg-white/70"
            }`}
          >
            <span className="rounded-lg px-2 py-1 text-sm font-semibold text-[#0D1282] transition hover:bg-[#F0DE36]/15">
              {file || existingFileName ? "Replace file" : "Browse file"}
            </span>
            <span className="mt-1 text-sm text-slate-500">Choose one PDF or image document.</span>
          </label>
          {error ? <p className="mt-2 text-xs font-semibold text-[#D71313]">{error}</p> : null}
          <input
            id={inputId}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(event) => onChange(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </div>
        <DocumentPreviewCard
          inputId={inputId}
          file={file}
          existingFileName={existingFileName}
          onRemove={() => onChange(null)}
        />
      </div>
    </div>
  );
}

export function DocumentPreviewCard({
  inputId,
  file,
  existingFileName,
  onRemove
}: {
  inputId: string;
  file: File | null;
  existingFileName?: string;
  onRemove: () => void;
}) {
  const fileName = file?.name || existingFileName || "";
  const isImage = Boolean(file?.type.startsWith("image/"));
  const isPdf = file?.type === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!fileName) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-[#0D1282]/15 bg-white/65 px-4 text-center text-sm font-medium text-slate-400">
        No file selected
      </div>
    );
  }

  return (
    <div className="flex min-h-40 flex-col rounded-xl bg-white p-3 shadow-sm ring-1 ring-[#EEEDED]">
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-[#EEEDED]/55">
        {isImage && previewUrl ? (
          <button
            type="button"
            onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
            aria-label={`Preview ${fileName}`}
            className="h-full w-full bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url("${previewUrl}")` }}
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-[#0D1282]/15 bg-white text-sm font-bold text-[#0D1282] shadow-sm">
            {isPdf ? "PDF" : "FILE"}
          </div>
        )}
      </div>

      <div className="mt-3 min-w-0">
        <p title={fileName} className="truncate text-sm font-semibold text-slate-900">{fileName}</p>
        <p className="mt-1 text-xs text-slate-500">
          {file ? `${formatFileSize(file.size)} - Uploaded successfully` : "Existing private file"}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
        {previewUrl ? (
          <button type="button" onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")} className="text-[#0D1282] transition hover:text-[#D71313]">
            Preview
          </button>
        ) : null}
        <label htmlFor={inputId} className="cursor-pointer text-[#0D1282] transition hover:text-[#D71313]">
          Replace
        </label>
        {file ? (
          <button type="button" onClick={onRemove} className="text-[#D71313]">
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ReviewSection({
  title,
  values,
  onEdit
}: {
  title: string;
  values: string[][];
  onEdit: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-3xl bg-white shadow-[0_14px_40px_rgba(13,18,130,0.08)] ring-1 ring-[#EEEDED]">
      <div className="relative overflow-hidden bg-[#0D1282] px-5 py-5 sm:px-6">
        <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[#F0DE36]/15" />
        <div className="absolute -bottom-12 right-16 h-24 w-24 rounded-full bg-white/5" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 h-1 w-10 rounded-full bg-[#F0DE36]" />
            <h2 className="truncate text-lg font-bold tracking-tight text-white">{title}</h2>
            <p className="mt-1 text-xs font-medium text-white/65">
              Review the information below before submission.
            </p>
          </div>

          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#0D1282] shadow-sm transition hover:bg-[#F0DE36] focus:outline-none focus:ring-2 focus:ring-[#F0DE36]/60 focus:ring-offset-2 focus:ring-offset-[#0D1282]"
          >
            Edit
          </button>
        </div>
      </div>

      <dl className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        {values.map(([label, value]) => (
          <div
            key={label}
            className="group relative min-w-0 overflow-hidden rounded-2xl bg-[#EEEDED]/45 px-4 py-4 transition hover:bg-[#F0DE36]/10"
          >
            <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-[#F0DE36] transition-all group-hover:inset-y-3" />
            <div className="pl-2">
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#0D1282]/55">
                {label}
              </dt>
              <dd className="mt-2 wrap-break-words text-sm font-semibold leading-6 text-slate-800">
                {value || "Not provided"}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}