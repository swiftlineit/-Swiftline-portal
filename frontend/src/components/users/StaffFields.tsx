"use client";

import { useState, useRef, type ReactNode } from "react";
import { BiSolidEdit } from "react-icons/bi";
import type { IconType } from "react-icons";
import { MultiSearchableSelect, SearchableSelect } from "@/components/business-accounts/FormFieldControls";
import { designationOptions, isListedDesignation, OTHER_DESIGNATION } from "@/lib/staffOptions";

// Shared building blocks for the Add Staff page and the staff detail page, so a
// field looks and validates the same in both. The visual language matches the
// profile page: uppercase micro-labels, h-10 rounded-xl controls, brand focus.

export const staffPatterns = {
  aadhaar: /^[2-9][0-9]{11}$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  phone: /^\+?[0-9][0-9\s\-()]{7,19}$/,
  postalCode: /^[0-9]{6}$/
};

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_DOCUMENTS = "application/pdf,image/jpeg,image/png";
export const MIN_STAFF_AGE_YEARS = 18;

export function yearsAgo(years: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

/** Renders an ISO date as a plain readable date, or a dash when absent. */
export function formatStaffDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** ISO timestamp to the yyyy-mm-dd a date input expects. */
export function toDateInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SectionCard({
  icon: Icon,
  title,
  subtitle,
  action,
  children
}: {
  icon: IconType;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D1282]/8 text-[#0D1282]">
            <Icon aria-hidden="true" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export const staffFieldGrid = "grid gap-5 sm:grid-cols-2 lg:grid-cols-3";

/** A read-only value. `locked` marks fields nobody may edit after creation. */
export function ReadOnlyField({
  label,
  value,
  locked = false
}: {
  label: string;
  value: string;
  locked?: boolean;
}) {
  return (
    <div className="rounded border border-slate-100 bg-gray-100/50 p-3">
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {locked ? <span className="font-normal normal-case text-slate-400">(locked)</span> : null}
      </dt>
      <dd className="mt-1.5 wrap-break-words text-sm font-medium text-slate-900">{value || "Not provided"}</dd>
    </div>
  );
}

export function InputField({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  maxLength,
  placeholder,
  helper,
  error
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  maxLength?: number;
  placeholder?: string;
  helper?: string;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1.5 h-10 w-full rounded-xl border px-3 text-sm text-slate-900 outline-none transition focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-100"
            : "border-slate-300 focus:border-[#0D1282] focus:ring-blue-100"
        }`}
      />
      {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}
      {!error && helper ? <span className="mt-1 block text-xs text-slate-500">{helper}</span> : null}
    </label>
  );
}

/** Label wrapper so the shared searchable dropdowns sit in the same rhythm. */
function FieldShell({
  label,
  required,
  helper,
  error,
  children
}: {
  label: string;
  required?: boolean;
  helper?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      <div className="mt-1.5 [&_button]:h-10 [&_button]:min-h-10 [&_button]:rounded-xl">{children}</div>
      {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}
      {!error && helper ? <span className="mt-1 block text-xs text-slate-500">{helper}</span> : null}
    </div>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  required = false,
  placeholder,
  error
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  error?: string;
}) {
  return (
    <FieldShell label={label} required={required} error={error}>
      <SearchableSelect
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={placeholder ?? "Select"}
        hideLabel
      />
    </FieldShell>
  );
}

/**
 * Designation picker: a searchable list of the titles the company uses, with an
 * "Other" choice that reveals a free-text box. A stored title that is not on the
 * list still opens in the text box rather than being silently replaced.
 */
export function DesignationField({
  value,
  onChange,
  error
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [otherPicked, setOtherPicked] = useState(false);
  const showOther = otherPicked || (Boolean(value) && !isListedDesignation(value));

  return (
    <div className="block">
      <FieldShell label="Designation" error={error}>
        <SearchableSelect
          label="Designation"
          value={showOther ? OTHER_DESIGNATION : value}
          options={designationOptions}
          placeholder="Select a designation"
          onChange={(next) => {
            if (next === OTHER_DESIGNATION) {
              setOtherPicked(true);
              onChange("");
              return;
            }
            setOtherPicked(false);
            onChange(next);
          }}
          hideLabel
        />
      </FieldShell>

      {showOther ? (
        <input
          value={value}
          maxLength={80}
          placeholder="Type the designation"
          onChange={(event) => onChange(event.target.value)}
          className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
        />
      ) : null}
    </div>
  );
}

export function BranchField({
  values,
  onChange,
  options,
  required = false,
  error
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: Array<{ id: string; name: string; code: string }>;
  required?: boolean;
  error?: string;
}) {
  return (
    <FieldShell
      label="Assigned branches"
      required={required}
      error={error}
      helper="Search and pick one or more branches."
    >
      <MultiSearchableSelect
        label="Assigned branches"
        values={values}
        onChange={onChange}
        options={options.map((branch) => ({ value: branch.id, label: `${branch.code} - ${branch.name}` }))}
        hideLabel
      />
    </FieldShell>
  );
}

export function DateField({
  label,
  value,
  onChange,
  required = false,
  helper,
  error
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  helper?: string;
  error?: string;
}) {
  return (
    <InputField
      label={label}
      value={value}
      onChange={onChange}
      required={required}
      type="date"
      helper={helper}
      error={error}
    />
  );
}

export function EditButton({ label = "Edit", onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 rounded-2xl border border-[#0D1282] px-3.5 text-sm font-semibold text-[#0D1282] transition hover:bg-[#0D1282]/5"
    >
      <BiSolidEdit aria-hidden="true" className="h-4 w-4" />
      {label}
    </button>
  );
}

export function EditActions({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="inline-flex h-9 items-center gap-2 rounded-4xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-700 transition hover:border-red-500 disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-9 items-center gap-2 rounded-4xl bg-[#0D1282] px-3.5 text-sm font-semibold tracking-wide text-white transition hover:bg-[#0D1282]/90 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {busy ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

export function DocumentUploadField({
  label,
  required = false,
  helper,
  file,
  existingName,
  onChange
}: {
  label: string;
  required?: boolean;
  helper?: string;
  file?: File;
  existingName?: string;
  onChange: (file?: File) => void;
}) {
  const inputId = `staff-document-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const selectedName = file?.name || existingName || "";
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
          {required ? <span className="ml-1 text-red-600">*</span> : null}
        </p>
        {selectedName ? (
          <button type="button" onClick={() => onChange(undefined)} className="text-xs font-semibold text-slate-500 hover:text-red-600">
            Clear
          </button>
        ) : null}
      </div>

      <label
        htmlFor={inputId}
        onClick={(event) => {
          event.preventDefault();
          fileInputRef.current?.click();
        }}
        className="mt-3 flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[#0D1282]/20 bg-white px-4 py-4 text-center text-sm font-semibold text-[#0D1282] transition hover:border-[#0D1282]/50 hover:bg-[#0D1282]/5"
      >
        {selectedName ? "Replace file" : "Browse file"}
      </label>
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_DOCUMENTS}
        onChange={(event) => onChange(event.target.files?.[0])}
        className="sr-only"
      />

      <p className="mt-2 truncate text-xs text-slate-500" title={selectedName}>
        {selectedName
          ? `${selectedName}${file ? ` - ${formatFileSize(file.size)}` : " (on file)"}`
          : helper || "PDF, JPG, or PNG up to 5 MB."}
      </p>
    </div>
  );
}

export function StatusPill({ status }: { status?: string }) {
  const tone = status === "active"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : status === "suspended"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : status === "disabled"
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-slate-100 text-slate-600 ring-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ${tone}`}>
      {(status ?? "unknown").replaceAll("_", " ")}
    </span>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
      {message}
    </div>
  );
}
