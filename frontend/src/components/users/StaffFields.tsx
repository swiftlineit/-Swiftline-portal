"use client";

import { useId, useState, useRef, type HTMLAttributes, type ReactNode } from "react";
import { BiSolidEdit } from "react-icons/bi";
import { FiChevronDown, FiExternalLink, FiEye, FiEyeOff, FiFileText, FiImage, FiUpload, FiX } from "react-icons/fi";
import type { IconType } from "react-icons";
import { toast } from "react-toastify";
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
export const MAX_PROFILE_IMAGE_BYTES = 3 * 1024 * 1024;
export const ACCEPTED_PROFILE_IMAGES = "image/jpeg,image/png,image/webp";

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
  error,
  onBlur,
  autoComplete,
  inputMode
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
  onBlur?: () => void;
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const inputId = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = type === "password";

  return (
    <div className="block">
      <label htmlFor={inputId} className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      </label>
      <div className="relative mt-1.5">
        <input
          id={inputId}
          type={isPassword && passwordVisible ? "text" : type}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          className={`h-10 w-full rounded-xl border px-3 text-sm text-slate-900 outline-none transition focus:ring-2 ${isPassword ? "pr-10" : ""} ${
            error
              ? "border-red-400 focus:border-red-500 focus:ring-red-100"
              : "border-slate-300 focus:border-[#0D1282] focus:ring-blue-100"
          }`}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={passwordVisible}
            className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center text-slate-400 transition hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D1282]"
          >
            {passwordVisible ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}
      {!error && helper ? <span className="mt-1 block text-xs text-slate-500">{helper}</span> : null}
    </div>
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
      <span className="relative block">
        <select
        value={value}
        required={required}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        className={`h-10 w-full appearance-none rounded-xl border bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:ring-2 ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-[#0D1282] focus:ring-blue-100"}`}
      >
        <option value="" disabled>{placeholder ?? "Select"}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      </span>
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
        <span className="relative block">
          <select
          value={showOther ? OTHER_DESIGNATION : value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === OTHER_DESIGNATION) {
              setOtherPicked(true);
              onChange("");
              return;
            }
            setOtherPicked(false);
            onChange(next);
          }}
          className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100"
        >
          <option value="">Select a designation</option>
          {designationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        </span>
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
  const [query, setQuery] = useState("");
  const visibleOptions = options.filter((branch) =>
    `${branch.code} ${branch.name}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <FieldShell
      label="Assigned branches"
      required={required}
      error={error}
      helper="Select every branch this staff member may access."
    >
      <div className={`rounded-xl border bg-white p-3 ${error ? "border-red-400" : "border-slate-300"}`}>
        {options.length > 6 ? (
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search branches" className="mb-3 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100" />
        ) : null}
        <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
          {visibleOptions.map((branch) => {
            const checked = values.includes(branch.id);
            return (
              <label key={branch.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition ${checked ? "border-[#0D1282]/40 bg-[#0D1282]/5 font-semibold text-[#0D1282]" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked ? [...values, branch.id] : values.filter((id) => id !== branch.id))} className="h-4 w-4 accent-[#0D1282]" />
                <span>{branch.code} - {branch.name}</span>
              </label>
            );
          })}
          {!visibleOptions.length ? <p className="py-3 text-sm text-slate-500">No branches found.</p> : null}
        </div>
      </div>
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

/**
 * Blob URL for a locally picked file, created once per File and reused for every
 * render and every preview of it.
 *
 * Deliberately not revoked on unmount. React Strict Mode mounts a component, runs
 * its effect cleanup, then remounts it without re-running the render-phase setup,
 * so revoking there left every preview pointing at a dead blob and rendering as a
 * broken image. Keying weakly lets the entry go once nothing holds the File, and
 * the browser releases the URLs themselves when the document unloads.
 */
const filePreviewUrls = new WeakMap<File, string>();

function filePreviewUrl(file: File) {
  const existing = filePreviewUrls.get(file);
  if (existing) return existing;

  const url = URL.createObjectURL(file);
  filePreviewUrls.set(file, url);
  return url;
}

function LocalFileTile({ file }: { file: File }) {
  const url = filePreviewUrl(file);
  const isImage = file.type.startsWith("image/");

  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-500">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : <FiFileText aria-hidden="true" className="h-6 w-6" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800">{file.name}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{formatFileSize(file.size)}</span>
      </span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#0D1282] hover:bg-[#0D1282]/5">
        <FiExternalLink className="h-3.5 w-3.5" /> Preview
      </a>
    </div>
  );
}

export function DocumentUploadField({
  label,
  required = false,
  helper,
  file,
  existingName,
  error,
  onChange
}: {
  label: string;
  required?: boolean;
  helper?: string;
  file?: File;
  existingName?: string;
  error?: string;
  onChange: (file?: File) => void;
}) {
  const inputId = `staff-document-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const selectedName = file?.name || existingName || "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectionError, setSelectionError] = useState("");
  const visibleError = error || selectionError;

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
        className={`mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white px-4 py-4 text-center text-sm font-semibold transition ${visibleError ? "border-red-300 text-red-700 hover:border-red-400" : "border-[#0D1282]/20 text-[#0D1282] hover:border-[#0D1282]/50 hover:bg-[#0D1282]/5"}`}
      >
        <FiUpload className="h-4 w-4" />
        {selectedName ? "Replace file" : "Browse file"}
      </label>
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_DOCUMENTS}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
            const message = `${file.name} is not supported. Use PDF, JPG, or PNG.`;
            setSelectionError(message);
            toast.error(message);
            return;
          }
          if (file.size > MAX_DOCUMENT_BYTES) {
            const message = `${file.name} is larger than 5 MB.`;
            setSelectionError(message);
            toast.error(message);
            return;
          }
          setSelectionError("");
          onChange(file);
          toast.success(`${file.name} selected successfully.`);
        }}
        className="sr-only"
      />

      {file ? <LocalFileTile key={`${file.name}-${file.lastModified}`} file={file} /> : (
        <p className={`mt-2 truncate text-xs ${visibleError ? "font-medium text-red-600" : "text-slate-500"}`} title={selectedName}>
          {visibleError || (selectedName ? `${selectedName} (on file)` : helper || "PDF, JPG, or PNG up to 5 MB.")}
        </p>
      )}
    </div>
  );
}

/** Round preview of the picked profile image, sized like the avatar it becomes. */
function ProfileImagePreview({ file }: { file: File }) {
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <span className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={filePreviewUrl(file)} alt={`Preview of ${file.name}`} className="h-full w-full object-cover" />
      </span>
      <span className="max-w-full truncate text-xs text-slate-500" title={file.name}>
        {file.name} ({formatFileSize(file.size)})
      </span>
    </div>
  );
}

export function ProfileImageUploadField({ file, error, onChange }: { file?: File; error?: string; onChange: (file?: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectionError, setSelectionError] = useState("");
  const visibleError = error || selectionError;

  return (
    <div className={`rounded-2xl border bg-slate-50/60 p-4 ${visibleError ? "border-red-300" : "border-slate-200"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Profile image</p>
          <p className="mt-1 text-xs text-slate-500">Optional JPG, PNG, or WebP up to 3 MB.</p>
        </div>
        {file ? <button type="button" onClick={() => onChange(undefined)} aria-label="Remove profile image" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"><FiX className="h-4 w-4" /></button> : null}
      </div>
      {file ? <ProfileImagePreview key={`${file.name}-${file.lastModified}`} file={file} /> : (
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#0D1282]/20 bg-white px-4 py-5 text-sm font-semibold text-[#0D1282] transition hover:border-[#0D1282]/50 hover:bg-[#0D1282]/5">
          <FiImage className="h-5 w-5" /> Choose profile image
        </button>
      )}
      {file ? <button type="button" onClick={() => inputRef.current?.click()} className="mt-2 text-xs font-semibold text-[#0D1282] hover:underline">Replace image</button> : null}
      {visibleError ? <p className="mt-2 text-xs font-medium text-red-600">{visibleError}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_PROFILE_IMAGES}
        className="sr-only"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!selected) return;
          if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
            const message = "Choose a JPG, PNG, or WebP profile image.";
            setSelectionError(message);
            toast.error(message);
            return;
          }
          if (selected.size > MAX_PROFILE_IMAGE_BYTES) {
            const message = "The profile image must be 3 MB or smaller.";
            setSelectionError(message);
            toast.error(message);
            return;
          }
          setSelectionError("");
          onChange(selected);
          toast.success("Profile image selected successfully.");
        }}
      />
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
