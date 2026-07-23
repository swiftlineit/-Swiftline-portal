"use client";

import { ChangeEvent, ReactNode, useEffect, useState } from "react";
import { CountrySelector, FlagImage } from "react-international-phone";
import { FiChevronDown } from "react-icons/fi";
import {
  getPhoneCountryByDialCode,
  preferredPhoneCountries
} from "@/components/business-accounts/FormFieldControls";

export function ShipmentFieldLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="text-xs font-semibold uppercase text-slate-600">
      {children}
      {required ? <span className="ml-1 text-red-600">*</span> : null}
    </span>
  );
}

function ShipmentFieldError({ error, visible }: { error?: string; visible: boolean }) {
  return error && visible ? <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p> : null;
}

export function ShipmentTextField({
  label,
  value,
  onChange,
  error,
  revealError = false,
  required = false,
  type = "text",
  placeholder,
  inputMode
}: {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  revealError?: boolean;
  required?: boolean;
  type?: string;
  placeholder?: string;
  inputMode?: "decimal" | "email" | "numeric" | "search" | "tel" | "text" | "url";
}) {
  const [touched, setTouched] = useState(false);
  const showError = touched || revealError;

  return (
    <label className="block min-w-0">
      <ShipmentFieldLabel required={required}>{label}</ShipmentFieldLabel>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={onChange}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        aria-invalid={Boolean(error && showError)}
        className={`mt-2 h-11 w-full min-w-0 border bg-white px-3 text-sm outline-none transition focus:ring-2 ${
          error && showError
            ? "border-red-400 focus:border-red-500 focus:ring-red-100"
            : "border-slate-300 focus:border-blue-900 focus:ring-blue-100"
        }`}
      />
      <ShipmentFieldError error={error} visible={showError} />
    </label>
  );
}

export function ShipmentSelectField({
  label,
  value,
  onChange,
  children,
  error,
  revealError = false,
  required = false,
  flagCountryCode
}: {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  error?: string;
  revealError?: boolean;
  required?: boolean;
  flagCountryCode?: string;
}) {
  const [touched, setTouched] = useState(false);
  const showError = touched || revealError;

  return (
    <label className="block min-w-0">
      <ShipmentFieldLabel required={required}>{label}</ShipmentFieldLabel>
      <span className="relative mt-2 block">
        {flagCountryCode ? (
          <span className="pointer-events-none absolute left-3 top-1/2 z-10 flex h-5 w-7 -translate-y-1/2 items-center justify-center overflow-hidden [&_img]:rounded-none">
            <FlagImage iso2={flagCountryCode.toLowerCase()} size="20px" />
          </span>
        ) : null}
        <select
          value={value}
          onChange={onChange}
          onBlur={() => setTouched(true)}
          aria-invalid={Boolean(error && showError)}
          className={`h-11 w-full appearance-none border bg-white pr-12 text-sm outline-none transition focus:ring-2 ${flagCountryCode ? "pl-12" : "pl-3"} ${
            error && showError
              ? "border-red-400 focus:border-red-500 focus:ring-red-100"
              : "border-slate-300 focus:border-blue-900 focus:ring-blue-100"
          }`}
        >
          {children}
        </select>
        <FiChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        />
      </span>
      <ShipmentFieldError error={error} visible={showError} />
    </label>
  );
}

export function ShipmentPhoneCodeField({
  value,
  onChange,
  error,
  revealError = false
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  revealError?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const selectedCountry = getPhoneCountryByDialCode(value);
  const showError = touched || revealError;

  // The selector displays India when no code is stored; keep the controlled
  // form value in sync so the visible default is also a valid submission value.
  useEffect(() => {
    if (!value.trim()) onChange(`+${selectedCountry.dialCode}`);
  }, [onChange, selectedCountry.dialCode, value]);

  return (
    <div className="min-w-0">
      <ShipmentFieldLabel required>Mobile Country Code</ShipmentFieldLabel>
      <div className="mt-2" onBlur={() => setTouched(true)}>
        <CountrySelector
          selectedCountry={selectedCountry.iso2}
          preferredCountries={preferredPhoneCountries}
          onSelect={(country) => onChange(`+${country.dialCode}`)}
          renderButtonWrapper={({ rootProps }) => (
            <button
              {...rootProps}
              type="button"
              className={`flex h-11 w-full min-w-0 items-center gap-2 border bg-white px-3 text-left text-sm outline-none transition focus:ring-2 ${
                error && showError
                  ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                  : "border-slate-300 focus:border-blue-900 focus:ring-blue-100"
              }`}
            >
              <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
                <FlagImage iso2={selectedCountry.iso2} size="20px" />
              </span>
              <span className="min-w-0 flex-1 truncate">{selectedCountry.name} +{selectedCountry.dialCode}</span>
              <FiChevronDown aria-hidden="true" className="mr-1 h-4 w-4 shrink-0 text-slate-500" />
            </button>
          )}
        />
      </div>
      <ShipmentFieldError error={error} visible={showError} />
    </div>
  );
}
