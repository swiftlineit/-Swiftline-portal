"use client";

import { ChangeEvent, ReactNode, useEffect, useState } from "react";
import { CountrySelector, FlagImage } from "react-international-phone";
import { FiChevronDown, FiMinus, FiPlus } from "react-icons/fi";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { toast } from "react-toastify";
import { csbTypeOptions, type CsbType } from "@/lib/csbType";
import { getHsnCodeError, maxParcelItems, type ParcelItem } from "@/lib/parcelItems";
import { findRestrictedCategories } from "@/lib/restrictedGoods";
import {
  getPhoneCountryByDialCode,
  preferredPhoneCountries
} from "@/components/business-accounts/FormFieldControls";

export function ShipmentFieldLabel({
  children,
  required = false,
  tooltip
}: {
  children: ReactNode;
  required?: boolean;
  // Short explanation shown on hover, for fields whose wording is ambiguous.
  tooltip?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
      {children}
      {required ? <span className="text-red-600">*</span> : null}
      {tooltip ? <InfoTooltip text={tooltip} /> : null}
    </span>
  );
}

// Field errors surface in a toast (deduped by message) rather than inline text, and
// only when the field holds wrong content. An empty required field just highlights;
// its "is required" message is raised by the page when Create is pressed.
function toastFieldError(error: string | undefined, value: string) {
  if (error && value.trim()) toast.error(error, { toastId: error });
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
  inputMode,
  readOnly = false,
  maxLength,
  hint,
  tooltip,
  onBlur
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
  readOnly?: boolean;
  maxLength?: number;
  hint?: string;
  tooltip?: string;
  // Fires after the field's own touched-tracking, e.g. to surface a restricted-goods toast.
  onBlur?: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const showError = touched || revealError;

  return (
    <label className="block min-w-0">
      <ShipmentFieldLabel required={required} tooltip={tooltip}>{label}</ShipmentFieldLabel>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={onChange}
        onBlur={() => { setTouched(true); toastFieldError(error, value); onBlur?.(); }}
        placeholder={placeholder}
        readOnly={readOnly}
        maxLength={maxLength}
        aria-invalid={Boolean(error && showError)}
        className={`mt-2 h-11 w-full min-w-0 rounded-xl border px-3.5 text-sm outline-none transition focus:ring-2 ${
          readOnly
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
            : error && showError
              ? "border-red-400 bg-white focus:border-red-500 focus:ring-red-100"
              : "border-slate-300 bg-white focus:border-blue-900 focus:ring-blue-100"
        }`}
      />
      {hint ? <p className="mt-1.5 text-xs text-slate-500">{hint}</p> : null}
    </label>
  );
}

// The consignor country and dialling code are fixed to India, so they render as a
// disabled flag chip rather than an editable field.
export function ShipmentFixedCountryField({ label, mode = "country" }: { label: string; mode?: "country" | "dial" }) {
  return (
    <label className="block min-w-0">
      <ShipmentFieldLabel required>{label}</ShipmentFieldLabel>
      <div className="mt-2 flex h-11 w-full min-w-0 cursor-not-allowed items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3.5 text-sm text-slate-600">
        <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
          <FlagImage iso2="in" size="20px" />
        </span>
        <span className="min-w-0 flex-1 truncate">{mode === "dial" ? "India +91" : "India"}</span>
      </div>
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
          onBlur={() => { setTouched(true); toastFieldError(error, value); }}
          aria-invalid={Boolean(error && showError)}
          className={`h-11 w-full appearance-none rounded-xl border bg-white pr-12 text-sm outline-none transition focus:ring-2 ${flagCountryCode ? "pl-12" : "pl-3.5"} ${
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
    </label>
  );
}

export function ShipmentPhoneCodeField({
  value,
  onChange,
  error,
  revealError = false,
  defaultDialCode
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  revealError?: boolean;
  // Dial code shown when nothing is stored yet. Defaults to India for backwards
  // compatibility; the consignee passes "+44" so the UK code is pre-selected.
  defaultDialCode?: string;
}) {
  const [touched, setTouched] = useState(false);
  const selectedCountry = getPhoneCountryByDialCode(value.trim() || defaultDialCode || "");
  const showError = touched || revealError;

  // Keep the controlled form value in sync with the visible default so the
  // pre-selected code is also a valid submission value.
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
              className={`flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border bg-white px-3.5 text-left text-sm outline-none transition focus:ring-2 ${
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
    </div>
  );
}

/**
 * Mandatory CSB-IV / CSB-V choice for a shipment draft, rendered as two
 * selectable cards. Radio inputs give the grouped single-choice semantics.
 *
 * CSB-V adds a flat clearance charge to the whole shipment, so the choice is
 * shown prominently rather than buried in a dropdown.
 */
export function ShipmentCsbTypeField({
  value,
  onChange,
  disabled = false
}: {
  value: CsbType;
  onChange: (value: CsbType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {csbTypeOptions.map((option) => {
        const checked = value === option.value;
        return (
          <label
            key={option.value}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
              disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-100"
                : checked
                  ? "cursor-pointer border-blue-900 bg-blue-50"
                  : "cursor-pointer border-slate-300 bg-white hover:border-blue-300"
            }`}
          >
            <input
              type="radio"
              name="shipmentCsbType"
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-blue-900"
            />
            <span className="block min-w-0">
              <span className={`block text-sm font-semibold ${checked ? "text-blue-950" : "text-slate-900"}`}>
                {option.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Per-parcel contents: one row per distinct good, each with its own mandatory
 * HSN code. Restricted descriptions highlight red and raise a toast on blur,
 * matching how the single contents field behaved before.
 *
 * The joined descriptions become the parcel's contentsDescription on save, which
 * is what the EDI export, manifest, carrier payload and labels keep reading.
 */
export function ParcelItemsEditor({
  items,
  onChange,
  revealError = false,
  maxItems = maxParcelItems
}: {
  items: ParcelItem[];
  onChange: (items: ParcelItem[]) => void;
  revealError?: boolean;
  maxItems?: number;
}) {
  function updateItem(index: number, field: keyof ParcelItem, value: string) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  function addItem() {
    if (items.length >= maxItems) return;
    onChange([...items, { description: "", hsnCode: "" }]);
  }

  function removeItem(index: number) {
    // Always leave one row so the parcel never renders with no contents input.
    if (items.length <= 1) {
      onChange([{ description: "", hsnCode: "" }]);
      return;
    }
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <ShipmentFieldLabel required tooltip="Each distinct item in this box, with its HSN code">
          Contents
        </ShipmentFieldLabel>
        <button
          type="button"
          onClick={addItem}
          disabled={items.length >= maxItems}
          className="inline-flex items-center gap-1 rounded-full border border-blue-900 px-3 py-1 text-xs font-semibold text-blue-900 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:hover:bg-transparent"
        >
          <FiPlus aria-hidden="true" /> Add Item
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {items.map((item, index) => {
          const restricted = findRestrictedCategories(item.description);
          const hsnError = getHsnCodeError(item.hsnCode);
          const showDescriptionError = restricted.length > 0;
          const showHsnError = Boolean(hsnError) && (revealError || item.hsnCode.trim().length > 0);

          return (
            <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-start">
              <input
                type="text"
                value={item.description}
                onChange={(event) => updateItem(index, "description", event.target.value)}
                onBlur={() => {
                  if (restricted.length) {
                    toast.error(`${restricted.join(", ")} is a restricted item and cannot be shipped.`, {
                      toastId: `restricted-${restricted.join("-")}`
                    });
                  }
                }}
                placeholder={`Item ${index + 1} description`}
                maxLength={120}
                aria-label={`Item ${index + 1} description`}
                aria-invalid={showDescriptionError}
                className={`h-11 w-full min-w-0 rounded-xl border px-3.5 text-sm outline-none transition focus:ring-2 ${
                  showDescriptionError
                    ? "border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-100"
                    : revealError && !item.description.trim()
                      ? "border-red-400 bg-white focus:border-red-500 focus:ring-red-100"
                      : "border-slate-300 bg-white focus:border-blue-900 focus:ring-blue-100"
                }`}
              />
              <input
                type="text"
                inputMode="numeric"
                value={item.hsnCode}
                // Digits only: an HSN code is 4, 6 or 8 numerals.
                onChange={(event) => updateItem(index, "hsnCode", event.target.value.replace(/\D/g, "").slice(0, 8))}
                onBlur={() => {
                  if (hsnError && item.hsnCode.trim()) toast.error(hsnError, { toastId: hsnError });
                }}
                placeholder="HSN code"
                aria-label={`Item ${index + 1} HSN code`}
                aria-invalid={showHsnError}
                className={`h-11 w-full min-w-0 rounded-xl border px-3.5 text-sm outline-none transition focus:ring-2 ${
                  showHsnError
                    ? "border-red-400 bg-white focus:border-red-500 focus:ring-red-100"
                    : "border-slate-300 bg-white focus:border-blue-900 focus:ring-blue-100"
                }`}
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={items.length <= 1 && !item.description && !item.hsnCode}
                aria-label={`Remove item ${index + 1}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-300 disabled:hover:bg-transparent"
              >
                <FiMinus aria-hidden="true" />
              </button>

              {showDescriptionError ? (
                <p className="text-xs font-semibold text-red-600 sm:col-span-3">
                  {restricted.join(", ")} is a restricted item and cannot be shipped.
                </p>
              ) : showHsnError ? (
                <p className="text-xs font-semibold text-red-600 sm:col-span-3">{hsnError}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
