"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { FiChevronDown, FiTrash2, FiUpload, FiX } from "react-icons/fi";
import {
  BranchDocument,
  BranchDocumentType,
  BranchFormData,
  BranchPhoneNumber,
  BranchService,
  BranchStatus,
  ShipmentCoverage,
  WorkingDay,
  branchServices,
  countryOptions,
  createBranch,
  currencyOptions,
  deleteBranchDocument,
  deleteBranchImage,
  formatBranchLabel,
  shipmentCoverageTypes,
  updateBranch,
  updateBranchStatus,
  uploadBranchDocument,
  uploadBranchImages,
  validateBranchCode,
  validateBranchCodeForEdit,
  workingDays
} from "@/lib/branches";

type FormErrors = Partial<Record<string, string>>;
type FieldKey =
  | "name"
  | "code"
  | "labelCode"
  | "country"
  | "city"
  | "postalCode"
  | "address"
  | "email"
  | "phone"
  | "supportedServices"
  | "shipmentCoverage"
  | "operatingCountries"
  | "baseCurrency"
  | "workingDays"
  | "policyAccepted"
  | "phoneNumber0"
  | "phoneNumber1"
  | "phoneNumber2";
type ValidationLevel = "DRAFT" | "ACTIVE";
// draft  → save without activating
// activate → create as active, or save edits and then activate
// save   → persist edits to an existing non-draft branch (status unchanged)
type SubmitMode = "draft" | "activate" | "save";

const initialForm: BranchFormData = {
  name: "",
  code: "",
  labelCode: "",
  openingDate: "",
  description: "",
  address: {
    countryCode: "",
    countryName: "",
    city: "",
    stateOrProvince: "",
    postalCode: "",
    address: ""
  },
  contact: {
    email: "",
    phone: ""
  },
  operations: {
    supportedServices: [],
    shipmentCoverage: [],
    operatingCountries: [],
    workingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]
  },
  baseCurrency: "",
  gstin: "",
  invoiceSacCode: "",
  phoneNumbers: [
    { label: "", number: "" },
    { label: "", number: "" },
    { label: "", number: "" }
  ],
  existingImages: [],
  existingDocuments: []
};

function normalizeBranchCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
}

function normalizeLabelCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value: string) {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

function isDomesticOnlyCoverage(coverage: ShipmentCoverage[]) {
  return coverage.length === 1 && coverage[0] === "DOMESTIC";
}

function validateForm(data: BranchFormData, level: ValidationLevel, codeExists: boolean | null): FormErrors {
  const errors: FormErrors = {};

  if (data.name.trim().length < 3) errors.name = "Branch name must be at least 3 characters.";
  if (!/^[A-Z0-9-]{3,20}$/.test(data.code)) errors.code = "Use 3-20 uppercase letters, numbers, or hyphens.";
  if (level === "ACTIVE" && !/^[A-Z]{3}$/.test(data.labelCode)) errors.labelCode = "Use exactly 3 uppercase letters, for example DEL.";
  if (codeExists) errors.code = "This branch code already exists.";

  if (level === "DRAFT") return errors;

  // Active branches must be operationally usable, while drafts can stay incomplete.
  if (!data.address.countryCode) errors.country = "Country is required.";
  if (!data.address.city.trim()) errors.city = "City is required.";
  if (!data.address.postalCode.trim()) errors.postalCode = "Postal code is required.";
  if (!data.address.address.trim()) errors.address = "Address is required.";
  if (!isValidEmail(data.contact.email)) errors.email = "Enter a valid email address.";
  if (!isValidPhone(data.contact.phone)) errors.phone = "Use international format, for example +919876543210.";
  if (data.operations.supportedServices.length === 0) errors.supportedServices = "Select at least one service.";
  if (data.operations.shipmentCoverage.length === 0) errors.shipmentCoverage = "Select at least one coverage type.";
  if (!data.baseCurrency) errors.baseCurrency = "Base currency is required.";
  if (data.operations.workingDays.length === 0) errors.workingDays = "Select at least one working day.";
  // Domestic-only branches infer their country from their address; anything
  // crossing borders must state where it operates.
  if (!isDomesticOnlyCoverage(data.operations.shipmentCoverage) && data.operations.operatingCountries.length === 0) {
    errors.operatingCountries = "Select at least one operating country for international coverage.";
  }
  // Indian branches need a GSTIN or invoice generation fails after the fact.
  if (data.address.countryCode === "IN" && !data.gstin.trim()) errors.gstin = "GSTIN is required for Indian branches.";

  // Branches being activated must have PAN and GST documents uploaded.
  // Documents are validated during upload flow, not here.

  return errors;
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1.5 text-xs font-semibold text-[#D71313]">{message}</p> : null;
}

function RequiredMark() {
  return <span className="text-[#D71313]">*</span>;
}

const fieldClasses = "mt-2 block h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2";
const fieldToneClasses = (hasError?: string) => hasError
  ? "border-[#D71313] focus:border-[#D71313] focus:ring-[#D71313]/15"
  : "border-[#EEEDED] focus:border-[#0D1282] focus:ring-[#F0DE36]/35";

function TextField({
  label,
  required,
  error,
  helper,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; required?: boolean; error?: string; helper?: string }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label} {required ? <RequiredMark /> : null}
      <input
        {...props}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        className={`${fieldClasses} ${fieldToneClasses(error)} disabled:cursor-not-allowed disabled:bg-[#EEEDED]/60 disabled:text-slate-500`}
      />
      <FieldError message={error} />
      {!error && helper ? <p className="mt-1.5 text-xs font-medium text-slate-500">{helper}</p> : null}
    </label>
  );
}

function TextAreaField({
  label,
  required,
  error,
  value,
  onChange,
  maxLength
}: {
  label: string;
  required?: boolean;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label} {required ? <RequiredMark /> : null}
      <textarea
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 block min-h-24 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:ring-2 ${fieldToneClasses(error)}`}
      />
      <FieldError message={error} />
    </label>
  );
}

function SearchSelect({
  label,
  required,
  value,
  options,
  placeholder,
  error,
  onChange
}: {
  label: string;
  required?: boolean;
  value: string;
  options: { value: string; label: string; helper?: string }[];
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listboxId = useId();
  const filteredOptions = options.filter((option) =>
    `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase())
  );
  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";
  const displayValue = open ? query : selectedLabel;

  function selectOption(option: { value: string }) {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(Math.max(filteredOptions.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) selectOption(option);
    }
  }

  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label} {required ? <RequiredMark /> : null}
      <div className="relative mt-2">
        <input
          value={displayValue}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-activedescendant={open && filteredOptions[highlightedIndex] ? `${listboxId}-${highlightedIndex}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlightedIndex(0);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setHighlightedIndex(0);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          className={`block h-11 w-full rounded-xl border bg-white px-3.5 pr-10 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 ${fieldToneClasses(error)}`}
        />
        <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0D1282]" />
        {open ? (
          <div
            id={listboxId}
            role="listbox"
            className="absolute z-20 mt-1.5 max-h-56 w-full overflow-y-auto rounded-xl border border-[#EEEDED] bg-white p-1 shadow-xl"
          >
            {filteredOptions.length ? filteredOptions.map((option, index) => (
              <button
                type="button"
                key={option.value}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  index === highlightedIndex ? "bg-[#F0DE36]/20 text-[#0D1282]" : "text-slate-700 hover:bg-[#EEEDED]/60"
                }`}
              >
                <span className="font-semibold">{option.label}</span>
                {option.helper ? <span className="ml-2 text-xs text-slate-500">{option.helper}</span> : null}
              </button>
            )) : (
              <p className="px-3 py-2 text-sm text-slate-500">No options found.</p>
            )}
          </div>
        ) : null}
      </div>
      <FieldError message={error} />
    </label>
  );
}

function MultiSelect<T extends string>({
  label,
  required,
  values,
  options,
  placeholder,
  error,
  onChange
}: {
  label: string;
  required?: boolean;
  values: T[];
  options: { value: T; label: string }[];
  placeholder: string;
  error?: string;
  onChange: (values: T[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listboxId = useId();
  const availableOptions = options.filter((option) => !values.includes(option.value));
  const filteredOptions = availableOptions.filter((option) =>
    `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase())
  );

  function removeValue(value: T) {
    onChange(values.filter((current) => current !== value));
  }

  function addValue(option: { value: T }) {
    onChange([...values, option.value]);
    setQuery("");
    setOpen(false);
    setHighlightedIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    // Backspace on an empty query removes the last chip, matching common token inputs.
    if (event.key === "Backspace" && !query && values.length) {
      event.preventDefault();
      removeValue(values[values.length - 1]);
      return;
    }

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(Math.max(filteredOptions.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) addValue(option);
    }
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700">
        {label} {required ? <RequiredMark /> : null}
      </label>
      {/* Clicking the chip area is a mouse convenience; all keyboard interaction
          happens through the input below, which owns the combobox semantics. */}
      <div
        onClick={() => setOpen(true)}
        className={`mt-2 rounded-xl border bg-white px-2.5 py-2 shadow-sm transition focus-within:ring-2 ${error ? "border-[#D71313] focus-within:border-[#D71313] focus-within:ring-[#D71313]/15" : "border-[#EEEDED] focus-within:border-[#0D1282] focus-within:ring-[#F0DE36]/35"}`}
      >
        <div className="flex min-h-7 flex-wrap gap-2">
          {values.map((value) => (
            <span key={value} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D1282]/8 px-2.5 py-1 text-xs font-semibold text-[#0D1282]">
              {options.find((option) => option.value === value)?.label ?? value}
              <button type="button" onClick={() => removeValue(value)} aria-label={`Remove ${value}`}>
                <FiX className="h-3 w-3" />
              </button>
            </span>
          ))}
          {values.length > 1 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
            >
              <FiTrash2 className="h-3 w-3" /> Remove all
            </button>
          ) : null}
          <input
            value={query}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-required={required || undefined}
            aria-invalid={error ? true : undefined}
            aria-activedescendant={open && filteredOptions[highlightedIndex] ? `${listboxId}-${highlightedIndex}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            placeholder={values.length ? "" : placeholder}
            className="min-w-44 flex-1 border-0 bg-transparent px-1 text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        {open ? (
          <div id={listboxId} role="listbox" className="mt-2 max-h-48 overflow-y-auto border-t border-[#EEEDED] pt-2">
            {filteredOptions.length ? filteredOptions.map((option, index) => (
              <button
                type="button"
                key={option.value}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => addValue(option)}
                className={`block w-full rounded-lg px-2.5 py-2 text-left text-sm transition ${
                  index === highlightedIndex ? "bg-[#F0DE36]/20 text-[#0D1282]" : "text-slate-700 hover:bg-[#EEEDED]/60"
                }`}
              >
                {option.label}
              </button>
            )) : (
              <p className="px-2 py-2 text-sm text-slate-500">No options found.</p>
            )}
          </div>
        ) : null}
      </div>
      <FieldError message={error} />
    </div>
  );
}

function FormSection({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#EEEDED] bg-white p-6 shadow-sm">
      <div className="border-l-4 border-[#F0DE36] pl-3.5">
        <h2 className="text-base font-bold text-[#0D1282]">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function BranchForm({
  branchId,
  initialData,
  initialStatus = "DRAFT",
  identityLocked = false
}: {
  branchId?: string;
  initialData?: BranchFormData;
  initialStatus?: BranchStatus;
  // True once the branch has been activated: its code and station code are baked
  // into issued tracking numbers and can no longer change.
  identityLocked?: boolean;
}) {
  const router = useRouter();
  const isEditMode = Boolean(branchId);
  const [form, setForm] = useState<BranchFormData>(initialData ?? initialForm);
  const [codeExists, setCodeExists] = useState<boolean | null>(null);
  const [savingMode, setSavingMode] = useState<SubmitMode | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [documentFiles, setDocumentFiles] = useState<{
    pan?: File;
    gst?: File;
    other?: { title: string; file: File };
  }>({});
  const [uploading, setUploading] = useState(false);
  const [existingImages, setExistingImages] = useState<string[]>(initialData?.existingImages ?? []);
  const [existingDocuments, setExistingDocuments] = useState<BranchDocument[]>(initialData?.existingDocuments ?? []);
  const [deletingImages, setDeletingImages] = useState<Set<number>>(new Set());
  const [deletingDocs, setDeletingDocs] = useState<Set<number>>(new Set());

  const countrySelectOptions = useMemo(
    () => countryOptions.map((country) => ({ value: country.code, label: country.name, helper: country.code })),
    []
  );
  const currencySelectOptions = useMemo(
    () => currencyOptions.map((currency) => ({ value: currency, label: currency })),
    []
  );
  const activeErrors = validateForm(form, "ACTIVE", codeExists);
  const visibleErrors = Object.fromEntries(
    Object.entries(activeErrors).filter(([field]) => submitAttempted || touchedFields[field as FieldKey])
  ) as FormErrors;

  useEffect(() => {
    if (!form.code || !/^[A-Z0-9-]{3,20}$/.test(form.code)) {
      return;
    }

    // Cancelled on cleanup so a slow response for an earlier code can never
    // overwrite the result for the code currently in the box.
    let cancelled = false;

    const timeout = window.setTimeout(async () => {
      try {
        const result = branchId
          ? await validateBranchCodeForEdit(form.code, branchId)
          : await validateBranchCode(form.code);
        if (!cancelled) setCodeExists(result.exists);
      } catch {
        if (!cancelled) setCodeExists(null);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [branchId, form.code]);

  function updateForm(update: Partial<BranchFormData>) {
    setForm((current) => ({ ...current, ...update }));
  }

  function markTouched(field: FieldKey) {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  }

  function updateAddress(update: Partial<BranchFormData["address"]>) {
    setForm((current) => ({ ...current, address: { ...current.address, ...update } }));
  }

  function updateContact(update: Partial<BranchFormData["contact"]>) {
    setForm((current) => ({ ...current, contact: { ...current.contact, ...update } }));
  }

  function updateOperations(update: Partial<BranchFormData["operations"]>) {
    setForm((current) => ({ ...current, operations: { ...current.operations, ...update } }));
  }

  function updatePhoneNumber(index: number, update: Partial<BranchPhoneNumber>) {
    setForm((current) => {
      const next = [...current.phoneNumbers];
      next[index] = { ...next[index], ...update };
      return { ...current, phoneNumbers: next };
    });
  }

  function handleImageSelect(files: FileList | null) {
    if (!files) return;
    const newFiles = Array.from(files);
    const combined = [...imageFiles, ...newFiles].slice(0, 5);
    setImageFiles(combined);

    // Generate preview URLs for new images.
    const newPreviews = newFiles.map((file) => URL.createObjectURL(file));
    setImagePreviews((prev) => {
      // Revoke old previews to avoid memory leaks.
      prev.forEach((url) => URL.revokeObjectURL(url));
      return combined.map((file) => URL.createObjectURL(file));
    });
  }

  function removeImage(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleDocumentSelect(type: "pan" | "gst" | "other", file: File | null, title?: string) {
    if (!file) {
      setDocumentFiles((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
      return;
    }
    setDocumentFiles((prev) => {
      if (type === "other") {
        return { ...prev, other: { title: title ?? "", file } };
      }
      return { ...prev, [type]: file };
    });
  }

  async function handleSubmit(mode: SubmitMode) {
    // Activating a branch requires policy acceptance and mandatory documents.
    const requiresActiveValidation = mode === "activate" || (mode === "save" && initialStatus === "ACTIVE");

    if (requiresActiveValidation && !policyAccepted) {
      setSubmitAttempted(true);
      toast.error("Please accept the branch operating policy.");
      return;
    }

    const errors = validateForm(form, requiresActiveValidation ? "ACTIVE" : "DRAFT", codeExists);

    if (Object.keys(errors).length) {
      setSubmitAttempted(true);
      setTouchedFields((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(errors).map((field) => [field, true]))
      }));
      toast.error("Please fix the highlighted fields before saving.");
      return;
    }

    setSavingMode(mode);
    setUploading(true);

    try {
      let branch;

      if (!branchId) {
        const result = await createBranch(form, mode === "activate" ? "ACTIVE" : "DRAFT");
        branch = result.branch;
      } else {
        const result = await updateBranch(branchId, form);
        branch = result.branch;

        if (mode === "activate") {
          const statusResult = await updateBranchStatus(branchId, "ACTIVE");
          branch = statusResult.branch;
        }
      }

      // Upload images if any were selected.
      if (imageFiles.length) {
        await uploadBranchImages(branch._id, imageFiles);
      }

      // Upload documents if any were selected.
      const docUploads: Promise<unknown>[] = [];
      if (documentFiles.pan) {
        docUploads.push(uploadBranchDocument(branch._id, "PAN", "PAN Card", documentFiles.pan));
      }
      if (documentFiles.gst) {
        docUploads.push(uploadBranchDocument(branch._id, "GST", "GST Certificate", documentFiles.gst));
      }
      if (documentFiles.other) {
        docUploads.push(uploadBranchDocument(branch._id, "OTHER", documentFiles.other.title, documentFiles.other.file));
      }
      await Promise.all(docUploads);

      toast.success(mode === "draft" ? "Branch saved as draft." : "Branch saved successfully.");
      router.push(`/dashboard/branches/${branch._id}`);
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Unable to save branch.");
    } finally {
      setSavingMode(null);
      setUploading(false);
    }
  }

  const saving = savingMode !== null || uploading;
  const secondaryButtonClasses = "rounded-4xl border border-[#EEEDED] bg-white px-4 py-2.5 text-sm font-semibold text-[#0D1282] shadow-sm transition hover:bg-[#EEEDED]/60 disabled:cursor-not-allowed disabled:opacity-50";
  const primaryButtonClasses = "rounded-4xl bg-[#0D1282] px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-6">
      <FormSection title="Basic Details" description="Branch identity and the station code used to build tracking numbers.">
        <div className="grid gap-5 md:grid-cols-2">
          <TextField
            label="Branch Name"
            required
            value={form.name}
            onChange={(event) => {
              markTouched("name");
              updateForm({ name: event.target.value });
            }}
            error={visibleErrors.name}
          />
          <TextField
            label="Branch Code"
            required
            value={form.code}
            disabled={identityLocked}
            helper={identityLocked ? "Locked: the branch has been activated." : undefined}
            onChange={(event) => {
              markTouched("code");
              setCodeExists(null);
              updateForm({ code: normalizeBranchCode(event.target.value) });
            }}
            error={visibleErrors.code}
            placeholder="DEL-HUB"
          />
          <TextField
            label="Station Code"
            required
            value={form.labelCode}
            disabled={identityLocked}
            helper={identityLocked ? "Locked: used by already-issued tracking numbers." : undefined}
            onChange={(event) => {
              markTouched("labelCode");
              updateForm({ labelCode: normalizeLabelCode(event.target.value) });
            }}
            error={visibleErrors.labelCode}
            placeholder="DEL"
          />
          <TextField
            label="Opening Date"
            type="date"
            value={form.openingDate}
            onChange={(event) => updateForm({ openingDate: event.target.value })}
          />
          <div className="md:col-span-2">
            <TextAreaField
              label="Description"
              value={form.description}
              maxLength={500}
              onChange={(value) => updateForm({ description: value })}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Address and Contact" description="Required before this branch can be activated.">
        <div className="grid gap-5 md:grid-cols-2">
          <SearchSelect
            label="Country"
            required
            value={form.address.countryCode}
            options={countrySelectOptions}
            placeholder="Search country"
            error={visibleErrors.country}
            onChange={(value) => {
              markTouched("country");
              const country = countryOptions.find((option) => option.code === value);
              updateAddress({ countryCode: value, countryName: country?.name ?? "" });
            }}
          />
          <TextField
            label="City"
            required
            value={form.address.city}
            onChange={(event) => {
              markTouched("city");
              updateAddress({ city: event.target.value });
            }}
            error={visibleErrors.city}
          />
          <TextField
            label="State or Province"
            value={form.address.stateOrProvince}
            onChange={(event) => updateAddress({ stateOrProvince: event.target.value })}
          />
          <TextField
            label="Postal Code"
            required
            value={form.address.postalCode}
            onChange={(event) => {
              markTouched("postalCode");
              updateAddress({ postalCode: event.target.value });
            }}
            error={visibleErrors.postalCode}
          />
          <TextField
            label="Email"
            required
            value={form.contact.email}
            onChange={(event) => {
              markTouched("email");
              updateContact({ email: event.target.value });
            }}
            error={visibleErrors.email}
          />
          <TextField
            label="Phone"
            required
            value={form.contact.phone}
            onChange={(event) => {
              markTouched("phone");
              updateContact({ phone: event.target.value });
            }}
            error={visibleErrors.phone}
            placeholder="+919876543210"
          />
          <div className="md:col-span-2">
            <TextAreaField
              label="Full Address"
              required
              value={form.address.address}
              error={visibleErrors.address}
              onChange={(value) => {
                markTouched("address");
                updateAddress({ address: value });
              }}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Tax and Invoicing" description="Indian branches require a GSTIN before they can go live.">
        <div className="grid gap-5 md:grid-cols-2">
          <TextField
            label="Branch GSTIN"
            required={form.address.countryCode === "IN"}
            value={form.gstin}
            onChange={(event) => updateForm({ gstin: event.target.value.toUpperCase().replace(/\s+/g, "") })}
            error={visibleErrors.gstin}
            maxLength={15}
            placeholder="06ABCDE1234F1Z5"
          />
          <TextField
            label="Invoice SAC Code"
            value={form.invoiceSacCode}
            onChange={(event) => updateForm({ invoiceSacCode: event.target.value.replace(/[^0-9]/g, "") })}
            maxLength={12}
            placeholder="Applicable service code"
          />
        </div>
      </FormSection>

      <FormSection title="Operations and Settings" description="Services, coverage, currency, and working days.">
        <div className="grid gap-5 md:grid-cols-2">
          <MultiSelect<BranchService>
            label="Supported Services"
            required
            values={form.operations.supportedServices}
            options={branchServices.map((service) => ({ value: service, label: formatBranchLabel(service) }))}
            placeholder="Search services"
            error={visibleErrors.supportedServices}
            onChange={(values) => {
              markTouched("supportedServices");
              updateOperations({ supportedServices: values });
            }}
          />
          <MultiSelect<ShipmentCoverage>
            label="Shipment Coverage"
            required
            values={form.operations.shipmentCoverage}
            options={shipmentCoverageTypes.map((coverage) => ({ value: coverage, label: formatBranchLabel(coverage) }))}
            placeholder="Search coverage"
            error={visibleErrors.shipmentCoverage}
            onChange={(values) => {
              markTouched("shipmentCoverage");
              updateOperations({ shipmentCoverage: values });
            }}
          />
          <MultiSelect<string>
            label="Operating Countries"
            required={!isDomesticOnlyCoverage(form.operations.shipmentCoverage)}
            values={form.operations.operatingCountries}
            options={countryOptions.map((country) => ({ value: country.code, label: `${country.name} (${country.code})` }))}
            placeholder="Search countries"
            error={visibleErrors.operatingCountries}
            onChange={(values) => {
              markTouched("operatingCountries");
              updateOperations({ operatingCountries: values });
            }}
          />
          <SearchSelect
            label="Base Currency"
            required
            value={form.baseCurrency}
            options={currencySelectOptions}
            placeholder="Search currency"
            error={visibleErrors.baseCurrency}
            onChange={(value) => {
              markTouched("baseCurrency");
              updateForm({ baseCurrency: value });
            }}
          />
          <div className="md:col-span-2">
            <p className="text-sm font-semibold text-slate-700">Working Days <RequiredMark /></p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {workingDays.map((day) => {
                const checked = form.operations.workingDays.includes(day);

                return (
                  <label
                    key={day}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition ${
                      checked
                        ? "border-[#0D1282] bg-[#0D1282]/5 text-[#0D1282]"
                        : "border-[#EEEDED] text-slate-700 hover:border-[#0D1282]/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const nextDays: WorkingDay[] = event.target.checked
                          ? [...form.operations.workingDays, day]
                          : form.operations.workingDays.filter((current) => current !== day);
                        markTouched("workingDays");
                        updateOperations({ workingDays: nextDays });
                      }}
                      className="h-4 w-4 accent-[#0D1282]"
                    />
                    {formatBranchLabel(day)}
                  </label>
                );
              })}
            </div>
            <FieldError message={visibleErrors.workingDays} />
          </div>
        </div>
      </FormSection>

      <FormSection title="Branch Contact Numbers" description="Additional phone numbers for specific departments or staff.">
        <div className="grid gap-5 md:grid-cols-3">
          {form.phoneNumbers.map((phone, index) => (
            <div key={index} className="space-y-3 rounded-xl border border-[#EEEDED] bg-[#EEEDED]/20 p-4">
              <TextField
                label={`Label ${index + 1}`}
                value={phone.label}
                placeholder="e.g. Manager, Operations"
                onChange={(event) => updatePhoneNumber(index, { label: event.target.value })}
              />
              <TextField
                label={`Phone ${index + 1}`}
                value={phone.number}
                placeholder="+919876543210"
                onChange={(event) => updatePhoneNumber(index, { number: event.target.value })}
                error={visibleErrors[`phoneNumber${index}` as FieldKey]}
              />
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection title="Branch Images" description="Upload up to 5 branch office images (JPG, PNG, GIF, WebP, max 5 MB each).">
        <div className="space-y-4">
          {(imagePreviews.length || existingImages.length) ? (
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {existingImages.map((imagePath, index) => (
                <div key={`existing-${index}`} className="group relative overflow-hidden rounded-xl border border-[#EEEDED] bg-[#EEEDED]/40">
                  <img
                    src={`/api/v1/files/${encodeURIComponent(imagePath.replace(/\\/g, "/"))}`}
                    alt={`Existing branch image ${index + 1}`}
                    className="h-32 w-full object-cover"
                  />
                  <button
                    type="button"
                    disabled={deletingImages.has(index)}
                    onClick={async () => {
                      if (!branchId) return;
                      setDeletingImages((prev) => new Set(prev).add(index));
                      try {
                        await deleteBranchImage(branchId, index);
                        setExistingImages((prev) => prev.filter((_, i) => i !== index));
                        toast.success("Image deleted.");
                      } catch (caught) {
                        toast.error(caught instanceof Error ? caught.message : "Failed to delete image.");
                      } finally {
                        setDeletingImages((prev) => { const next = new Set(prev); next.delete(index); return next; });
                      }
                    }}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-[#D71313] opacity-0 shadow-sm transition hover:bg-white group-hover:opacity-100 disabled:opacity-50"
                  >
                    <FiX className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {imagePreviews.map((preview, index) => (
                <div key={index} className="group relative overflow-hidden rounded-xl border border-[#EEEDED] bg-[#EEEDED]/40">
                  <img
                    src={preview}
                    alt={`Branch image ${index + 1}`}
                    className="h-32 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-[#D71313] opacity-0 shadow-sm transition hover:bg-white group-hover:opacity-100"
                  >
                    <FiX className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {imageFiles.length + existingImages.length < 5 ? (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#EEEDED] px-4 py-8 text-sm font-semibold text-slate-500 transition hover:border-[#0D1282]/30 hover:text-[#0D1282]">
              <FiUpload className="h-5 w-5" />
              {imageFiles.length || existingImages.length ? "Add more images" : "Click to select branch images"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(event) => handleImageSelect(event.target.files)}
              />
            </label>
          ) : null}
          <p className="text-xs text-slate-400">{existingImages.length + imageFiles.length} / 5 images</p>
        </div>
      </FormSection>

      <FormSection title="Branch Documents" description="Upload PAN Card (required), GST Certificate (required), and optional documents.">
        <div className="grid gap-5 md:grid-cols-2">
          {existingDocuments.filter((d) => d.type === "PAN").map((doc, idx) => {
            const docIndex = existingDocuments.indexOf(doc);
            return (
              <div key={`existing-pan-${idx}`} className="rounded-xl border border-[#EEEDED] bg-[#EEEDED]/20 p-4">
                <p className="mb-3 text-sm font-semibold text-slate-700">PAN Card <span className="text-[#D71313]">*</span></p>
                <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <a href={`/api/v1/files/${encodeURIComponent(doc.filePath.replace(/\\/g, "/"))}`} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium text-[#0D1282] hover:underline">{doc.fileName}</a>
                  </div>
                  <button
                    type="button"
                    disabled={deletingDocs.has(docIndex)}
                    onClick={async () => {
                      if (!branchId) return;
                      setDeletingDocs((prev) => new Set(prev).add(docIndex));
                      try {
                        await deleteBranchDocument(branchId, docIndex);
                        setExistingDocuments((prev) => prev.filter((_, i) => i !== docIndex));
                        toast.success("PAN document deleted.");
                      } catch (caught) {
                        toast.error(caught instanceof Error ? caught.message : "Failed to delete document.");
                      } finally {
                        setDeletingDocs((prev) => { const next = new Set(prev); next.delete(docIndex); return next; });
                      }
                    }}
                    className="ml-2 text-[#D71313] hover:text-[#D71313]/70 disabled:opacity-50"
                  >
                    <FiX className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="rounded-xl border border-[#EEEDED] bg-[#EEEDED]/20 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-700">
              PAN Card <span className="text-[#D71313]">*</span>
            </p>
            {documentFiles.pan ? (
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
                <span className="truncate text-sm text-slate-700">{documentFiles.pan.name}</span>
                <button
                  type="button"
                  onClick={() => handleDocumentSelect("pan", null)}
                  className="text-[#D71313] hover:text-[#D71313]/70"
                >
                  <FiX className="h-4 w-4" />
                </button>
              </div>
            ) : existingDocuments.some((d) => d.type === "PAN") ? null : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#EEEDED] px-4 py-6 text-sm text-slate-500 hover:border-[#0D1282]/30 hover:text-[#0D1282]">
                <FiUpload className="h-4 w-4" /> Upload PAN (PDF, JPG, PNG)
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleDocumentSelect("pan", file);
                  }}
                />
              </label>
            )}
          </div>

          {existingDocuments.filter((d) => d.type === "GST").map((doc, idx) => {
            const docIndex = existingDocuments.indexOf(doc);
            return (
              <div key={`existing-gst-${idx}`} className="rounded-xl border border-[#EEEDED] bg-[#EEEDED]/20 p-4">
                <p className="mb-3 text-sm font-semibold text-slate-700">GST Certificate <span className="text-[#D71313]">*</span></p>
                <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <a href={`/api/v1/files/${encodeURIComponent(doc.filePath.replace(/\\/g, "/"))}`} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium text-[#0D1282] hover:underline">{doc.fileName}</a>
                  </div>
                  <button
                    type="button"
                    disabled={deletingDocs.has(docIndex)}
                    onClick={async () => {
                      if (!branchId) return;
                      setDeletingDocs((prev) => new Set(prev).add(docIndex));
                      try {
                        await deleteBranchDocument(branchId, docIndex);
                        setExistingDocuments((prev) => prev.filter((_, i) => i !== docIndex));
                        toast.success("GST document deleted.");
                      } catch (caught) {
                        toast.error(caught instanceof Error ? caught.message : "Failed to delete document.");
                      } finally {
                        setDeletingDocs((prev) => { const next = new Set(prev); next.delete(docIndex); return next; });
                      }
                    }}
                    className="ml-2 text-[#D71313] hover:text-[#D71313]/70 disabled:opacity-50"
                  >
                    <FiX className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="rounded-xl border border-[#EEEDED] bg-[#EEEDED]/20 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-700">
              GST Certificate <span className="text-[#D71313]">*</span>
            </p>
            {documentFiles.gst ? (
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
                <span className="truncate text-sm text-slate-700">{documentFiles.gst.name}</span>
                <button
                  type="button"
                  onClick={() => handleDocumentSelect("gst", null)}
                  className="text-[#D71313] hover:text-[#D71313]/70"
                >
                  <FiX className="h-4 w-4" />
                </button>
              </div>
            ) : existingDocuments.some((d) => d.type === "GST") ? null : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#EEEDED] px-4 py-6 text-sm text-slate-500 hover:border-[#0D1282]/30 hover:text-[#0D1282]">
                <FiUpload className="h-4 w-4" /> Upload GST (PDF, JPG, PNG)
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleDocumentSelect("gst", file);
                  }}
                />
              </label>
            )}
          </div>
          {existingDocuments.filter((d) => d.type === "OTHER").map((doc, idx) => {
            const docIndex = existingDocuments.indexOf(doc);
            return (
              <div key={`existing-other-${idx}`} className="md:col-span-2 rounded-xl border border-[#EEEDED] bg-[#EEEDED]/20 p-4">
                <p className="mb-3 text-sm font-semibold text-slate-700">Other Document (optional)</p>
                <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-700">{doc.title || doc.type}</p>
                    <a href={`/api/v1/files/${encodeURIComponent(doc.filePath.replace(/\\/g, "/"))}`} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium text-[#0D1282] hover:underline">{doc.fileName}</a>
                  </div>
                  <button
                    type="button"
                    disabled={deletingDocs.has(docIndex)}
                    onClick={async () => {
                      if (!branchId) return;
                      setDeletingDocs((prev) => new Set(prev).add(docIndex));
                      try {
                        await deleteBranchDocument(branchId, docIndex);
                        setExistingDocuments((prev) => prev.filter((_, i) => i !== docIndex));
                        toast.success("Document deleted.");
                      } catch (caught) {
                        toast.error(caught instanceof Error ? caught.message : "Failed to delete document.");
                      } finally {
                        setDeletingDocs((prev) => { const next = new Set(prev); next.delete(docIndex); return next; });
                      }
                    }}
                    className="ml-2 text-[#D71313] hover:text-[#D71313]/70 disabled:opacity-50"
                  >
                    <FiX className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="md:col-span-2 rounded-xl border border-[#EEEDED] bg-[#EEEDED]/20 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-700">Other Document (optional)</p>
            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="text"
                value={documentFiles.other?.title ?? ""}
                onChange={(event) => {
                  const file = documentFiles.other?.file;
                  handleDocumentSelect("other", file ?? null, event.target.value);
                }}
                placeholder="Document title"
                className="h-11 rounded-xl border border-[#EEEDED] bg-white px-3.5 text-sm outline-none transition focus:ring-2 focus:border-[#0D1282] focus:ring-[#F0DE36]/35"
              />
              {documentFiles.other?.file ? (
                <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
                  <span className="truncate text-sm text-slate-700">{documentFiles.other.file.name}</span>
                  <button
                    type="button"
                    onClick={() => handleDocumentSelect("other", null)}
                    className="text-[#D71313] hover:text-[#D71313]/70"
                  >
                    <FiX className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#EEEDED] px-4 py-3 text-sm text-slate-500 hover:border-[#0D1282]/30 hover:text-[#0D1282]">
                  <FiUpload className="h-4 w-4" /> Upload document (PDF, JPG, PNG)
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleDocumentSelect("other", file, documentFiles.other?.title ?? "");
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </div>
      </FormSection>

      {!isEditMode || initialStatus !== "ACTIVE" ? (
        <div className={`rounded-xl border p-4 transition ${
          submitAttempted && !policyAccepted
            ? "border-[#D71313]/25 bg-[#D71313]/5"
            : "border-[#EEEDED] bg-white"
        }`}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={policyAccepted}
              onChange={(event) => {
                setPolicyAccepted(event.target.checked);
                if (event.target.checked) setSubmitAttempted(false);
              }}
              className="mt-0.5 h-4 w-4 accent-[#0D1282]"
            />
            <div>
              <p className="text-sm font-semibold text-slate-700">
                I confirm that the information provided is accurate and I accept the branch operating policies.
                <span className="text-[#D71313]"> *</span>
              </p>
              {submitAttempted && !policyAccepted ? (
                <p className="mt-1 text-xs font-semibold text-[#D71313]">
                  You must accept the policy before activating this branch.
                </p>
              ) : null}
            </div>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl px-5 py-4">
        {!isEditMode ? (
          <>
            <button type="button" onClick={() => void handleSubmit("draft")} disabled={saving || uploading} className={secondaryButtonClasses}>
              {uploading ? "Uploading files..." : savingMode === "draft" ? "Saving..." : "Save as Draft"}
            </button>
            <button type="button" onClick={() => void handleSubmit("activate")} disabled={saving || uploading} className={primaryButtonClasses}>
              {uploading ? "Uploading files..." : savingMode === "activate" ? "Creating..." : "Create Branch"}
            </button>
          </>
        ) : initialStatus === "DRAFT" ? (
          <>
            <button type="button" onClick={() => void handleSubmit("draft")} disabled={saving || uploading} className={secondaryButtonClasses}>
              {uploading ? "Uploading files..." : savingMode === "draft" ? "Saving..." : "Save Draft"}
            </button>
            <button type="button" onClick={() => void handleSubmit("activate")} disabled={saving || uploading} className={primaryButtonClasses}>
              {uploading ? "Uploading files..." : savingMode === "activate" ? "Activating..." : "Save & Activate"}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void handleSubmit("save")} disabled={saving || uploading} className={primaryButtonClasses}>
            {uploading ? "Uploading files..." : savingMode === "save" ? "Saving..." : "Save Changes"}
          </button>
        )}
      </div>
    </div>
  );
}
