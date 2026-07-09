"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FiChevronDown, FiX } from "react-icons/fi";
import {
  BranchFormData,
  BranchService,
  ShipmentCoverage,
  WorkingDay,
  branchServices,
  countryOptions,
  createBranch,
  currencyOptions,
  formatBranchLabel,
  shipmentCoverageTypes,
  updateBranch,
  validateBranchCode,
  validateBranchCodeForEdit,
  workingDays
} from "@/lib/branches";

type FormErrors = Partial<Record<string, string>>;
type FieldKey =
  | "name"
  | "code"
  | "country"
  | "city"
  | "postalCode"
  | "address"
  | "email"
  | "phone"
  | "supportedServices"
  | "shipmentCoverage"
  | "baseCurrency"
  | "workingDays";
type SaveAction = "DRAFT" | "ACTIVE";

const initialForm: BranchFormData = {
  name: "",
  code: "",
  openingDate: "",
  description: "",
  address: {
    countryCode: "",
    countryName: "",
    city: "",
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
  baseCurrency: ""
};

function normalizeBranchCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value: string) {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

function validateForm(data: BranchFormData, action: SaveAction, codeExists: boolean | null): FormErrors {
  const errors: FormErrors = {};

  if (data.name.trim().length < 3) errors.name = "Branch name must be at least 3 characters.";
  if (!/^[A-Z0-9-]{3,20}$/.test(data.code)) errors.code = "Use 3-20 uppercase letters, numbers, or hyphens.";
  if (codeExists) errors.code = "This branch code already exists.";

  if (action === "DRAFT") return errors;

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

  return errors;
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null;
}

function RequiredMark() {
  return <span className="text-red-600">*</span>;
}

function TextField({
  label,
  required,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; required?: boolean; error?: string }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label} {required ? <RequiredMark /> : null}
      <input
        {...props}
        className="mt-2 block h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
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
  const filteredOptions = options.filter((option) =>
    `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase())
  );
  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";
  const displayValue = open ? query : selectedLabel;

  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label} {required ? <RequiredMark /> : null}
      <div className="relative mt-2">
        <input
          value={displayValue}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onClick={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          className="block h-10 w-full border border-slate-300 px-3 pr-10 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
        />
        <FiChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        {open ? (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto border border-slate-200 bg-white shadow-lg">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setQuery("");
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50"
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
  const availableOptions = options.filter((option) => !values.includes(option.value));
  const filteredOptions = availableOptions.filter((option) =>
    `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase())
  );

  function removeValue(value: T) {
    onChange(values.filter((current) => current !== value));
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700">
        {label} {required ? <RequiredMark /> : null}
      </label>
      <div
        onClick={() => setOpen(true)}
        className="mt-2 border border-slate-300 bg-white px-2 py-2 focus-within:border-blue-900 focus-within:ring-2 focus-within:ring-blue-100"
      >
        <div className="flex min-h-7 flex-wrap gap-2">
          {values.map((value) => (
            <span key={value} className="inline-flex items-center gap-1 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              {options.find((option) => option.value === value)?.label ?? value}
              <button type="button" onClick={() => removeValue(value)} aria-label={`Remove ${value}`}>
                <FiX className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            placeholder={values.length ? "" : placeholder}
            className="min-w-44 flex-1 border-0 px-1 text-sm outline-none"
          />
        </div>
        {open ? (
          <div className="mt-2 max-h-48 overflow-y-auto border-t border-slate-100 pt-2">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => {
                  onChange([...values, option.value]);
                  setQuery("");
                  setOpen(false);
                }}
                className="block w-full px-2 py-2 text-left text-sm text-slate-700 hover:bg-blue-50"
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

export default function BranchForm({
  branchId,
  initialData,
  initialStatus = "DRAFT"
}: {
  branchId?: string;
  initialData?: BranchFormData;
  initialStatus?: SaveAction;
}) {
  const router = useRouter();
  const isEditMode = Boolean(branchId);
  const [form, setForm] = useState<BranchFormData>(initialData ?? initialForm);
  const [codeExists, setCodeExists] = useState<boolean | null>(null);
  const [savingAction, setSavingAction] = useState<SaveAction | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Partial<Record<FieldKey, boolean>>>({});

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

    const timeout = window.setTimeout(async () => {
      try {
        const result = branchId
          ? await validateBranchCodeForEdit(form.code, branchId)
          : await validateBranchCode(form.code);
        setCodeExists(result.exists);
      } catch {
        setCodeExists(null);
      }
    }, 300);

    return () => window.clearTimeout(timeout);
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

  async function handleSubmit(action: SaveAction) {
    const errors = validateForm(form, action, codeExists);
    if (Object.keys(errors).length) {
      setSubmitAttempted(true);
      setTouchedFields((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(errors).map((field) => [field, true]))
      }));
      setSubmitError("Please fix the highlighted fields before saving.");
      return;
    }

    setSavingAction(action);
    setSubmitError("");
    setSuccessMessage("");

    try {
      const result = branchId
        ? await updateBranch(branchId, form, action)
        : await createBranch(form, action);
      setSuccessMessage(isEditMode ? "Branch updated successfully." : action === "ACTIVE" ? "Branch created successfully." : "Branch draft saved.");
      router.push(`/dashboard/branches/${result.branch._id}`);
    } catch (caughtError) {
      setSubmitError(caughtError instanceof Error ? caughtError.message : "Unable to save branch.");
    } finally {
      setSavingAction(null);
    }
  }

  return (
    <div className="space-y-6">
      {submitError ? <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{submitError}</div> : null}
      {successMessage ? <div className="border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">{successMessage}</div> : null}

      <section className="border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-950">Basic Details</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
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
            onChange={(event) => {
              markTouched("code");
              setCodeExists(null);
              updateForm({ code: normalizeBranchCode(event.target.value) });
            }}
            error={visibleErrors.code}
            placeholder="DEL-HUB"
          />
          <label className="block text-sm font-semibold text-slate-700 md:col-span-2">
            Description
            <textarea
              value={form.description}
              onChange={(event) => updateForm({ description: event.target.value })}
              maxLength={500}
              className="mt-2 block min-h-24 w-full border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-950">Address and Contact</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
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
            label="Opening Date"
            type="date"
            value={form.openingDate}
            onChange={(event) => updateForm({ openingDate: event.target.value })}
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

          <label className="block text-sm font-semibold text-slate-700">
            Full Address <RequiredMark />
            <textarea
              value={form.address.address}
              onChange={(event) => {
                markTouched("address");
                updateAddress({ address: event.target.value });
              }}
              className="mt-2 block min-h-24 w-full border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
            />
            <FieldError message={visibleErrors.address} />
          </label>
        </div>
      </section>

      <section className="border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-950">Operations and Settings</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
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
            values={form.operations.operatingCountries}
            options={countryOptions.map((country) => ({ value: country.code, label: `${country.name} (${country.code})` }))}
            placeholder="Search countries"
            onChange={(values) => updateOperations({ operatingCountries: values })}
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
              {workingDays.map((day) => (
                <label key={day} className="flex items-center gap-2 border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.operations.workingDays.includes(day)}
                    onChange={(event) => {
                      const nextDays: WorkingDay[] = event.target.checked
                        ? [...form.operations.workingDays, day]
                        : form.operations.workingDays.filter((current) => current !== day);
                      markTouched("workingDays");
                      updateOperations({ workingDays: nextDays });
                    }}
                    className="h-4 w-4"
                  />
                  {formatBranchLabel(day)}
                </label>
              ))}
            </div>
            <FieldError message={visibleErrors.workingDays} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        {initialStatus !== "ACTIVE" ? (
          <button
            type="button"
            onClick={() => void handleSubmit("DRAFT")}
            disabled={savingAction !== null}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-900 hover:text-blue-900 disabled:opacity-60"
          >
            {savingAction === "DRAFT" ? "Saving..." : isEditMode ? "Save Draft" : "Save as Draft"}
          </button>
        ) : null}
        {initialStatus === "ACTIVE" ? (
          <button
            type="button"
            onClick={() => void handleSubmit("ACTIVE")}
            disabled={savingAction !== null || Object.keys(activeErrors).length > 0}
            className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingAction === "ACTIVE" ? "Updating..." : "Update Branch"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSubmit("ACTIVE")}
            disabled={savingAction !== null || Object.keys(activeErrors).length > 0}
            className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingAction === "ACTIVE" ? (isEditMode ? "Activating..." : "Creating...") : isEditMode ? "Save and Activate" : "Create Branch"}
          </button>
        )}
      </div>
    </div>
  );
}
