"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BusinessAccount,
  BusinessAccountFiles,
  BusinessAccountFormData,
  DocumentType,
  createBusinessAccount,
  submitBusinessAccount,
  updateBusinessAccount,
  validateBusinessAccountUnique
} from "@/lib/businessAccounts";

const departments = [
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

const industries = [
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

const shipmentVolumes = [
  "1-50 shipments",
  "51-200 shipments",
  "201-500 shipments",
  "501-1,000 shipments",
  "1,001-5,000 shipments",
  "More than 5,000 shipments"
];

const countries = [
  "India",
  "United States",
  "United Kingdom of Great Britain and Northern Ireland",
  "Canada",
  "Australia",
  "United Arab Emirates",
  "Saudi Arabia",
  "Singapore",
  "China",
  "Japan",
  "Germany",
  "France",
  "Italy",
  "Netherlands",
  "Belgium",
  "Spain",
  "Switzerland",
  "South Korea",
  "Indonesia",
  "Malaysia",
  "Thailand",
  "Vietnam",
  "Bangladesh",
  "Nepal",
  "Sri Lanka",
  "South Africa",
  "Brazil",
  "Mexico",
  "New Zealand",
  "Qatar",
  "Oman",
  "Kuwait",
  "Bahrain",
  "Other"
];

const currencies = [
  "INR",
  "USD",
  "GBP",
  "EUR",
  "AED",
  "CAD",
  "AUD",
  "SGD",
  "SAR",
  "JPY",
  "CNY",
  "CHF",
  "NZD",
  "QAR",
  "KWD",
  "BHD",
  "OMR"
];

const defaultFormData: BusinessAccountFormData = {
  contact: {
    firstName: "",
    lastName: "",
    email: "",
    countryCode: "+91",
    mobileNumber: "",
    department: "",
    shipmentTypes: ["domestic"]
  },
  company: {
    registrationCountry: "India",
    registrationId: "",
    companyName: "",
    registeredAddress: "",
    city: "",
    stateOrProvince: "",
    postalCode: "",
    operatingCountries: ["India"],
    website: "",
    industry: "",
    monthlyShipmentVolume: "",
    requestedCreditCurrency: "INR",
    requestedCreditLimit: ""
  }
};

function fromAccount(account?: BusinessAccount): BusinessAccountFormData {
  if (!account) return defaultFormData;

  return {
    contact: account.contact,
    company: {
      ...account.company,
      website: account.company.website ?? "",
      operatingCountries: account.company.operatingCountries ?? (account.company.operatingCountry ? [account.company.operatingCountry] : []),
      requestedCreditCurrency: account.company.requestedCreditLimit.currency,
      requestedCreditLimit: account.company.requestedCreditLimit.amount?.toString() ?? ""
    }
  };
}

function getDocumentLabel(type: DocumentType) {
  if (type === "gstCertificate") return "GST Certificate";
  if (type === "panCard") return "PAN Card Copy";
  return "IEC Certificate";
}

function getCurrencyCode(value: string) {
  return value.split(" - ")[0] || value;
}

function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type SelectOption = {
  value: string;
  label: string;
};

type UniqueField = "email" | "mobileNumber" | "registrationId";

const duplicateMessages: Record<UniqueField, string> = {
  email: "Email address already exists.",
  mobileNumber: "Mobile number already exists.",
  registrationId: "Company registration ID already exists."
};

const maxDocumentSizeBytes = 5 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const allowedDocumentExtensions = new Set(["pdf", "jpg", "jpeg", "png"]);

const stepValidationKeys = [
  ["firstName", "lastName", "email", "countryCode", "mobileNumber", "department", "shipmentTypes"],
  [
    "registrationCountry",
    "registrationId",
    "companyName",
    "registeredAddress",
    "city",
    "stateOrProvince",
    "postalCode",
    "operatingCountries",
    "industry",
    "monthlyShipmentVolume",
    "requestedCreditCurrency",
    "requestedCreditLimit",
    "website"
  ],
  [],
  ["confirmation"]
];

function toOptions(values: string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUrl(value: string) {
  if (!value) return true;

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function getDocumentFileError(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isAllowedType = allowedDocumentTypes.has(file.type) || allowedDocumentExtensions.has(extension);

  if (!isAllowedType) return "Only PDF, JPG, JPEG, and PNG files are supported.";
  if (file.size <= 0) return "The selected file is empty or corrupted.";
  if (file.size > maxDocumentSizeBytes) return "File size must not exceed 5 MB.";

  return "";
}

export default function BusinessAccountForm({ account }: { account?: BusinessAccount }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<BusinessAccountFormData>(() => fromAccount(account));
  const [files, setFiles] = useState<BusinessAccountFiles>({});
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [documentErrors, setDocumentErrors] = useState<Partial<Record<DocumentType, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<UniqueField, string>>>({});
  const [validatingFields, setValidatingFields] = useState<Partial<Record<UniqueField, boolean>>>({});
  const [saving, setSaving] = useState(false);

  const isInternational = formData.contact.shipmentTypes.includes("international");
  const existingDocuments = account?.documents ?? {};
  const steps = ["Contact", "Company", "Documents", "Review"];
  const isEdit = Boolean(account);
  const isDraftEdit = account?.status === "draft";
  const isCheckingUnique = Object.values(validatingFields).some(Boolean);

  const documentFields = useMemo(() => {
    const fields: { type: DocumentType; required: boolean; helper: string }[] = [
      { type: "gstCertificate", required: true, helper: "Required for applicable Indian businesses." },
      { type: "panCard", required: true, helper: "Required for applicable Indian businesses." },
      {
        type: "iecCertificate",
        required: isInternational,
        helper: isInternational
          ? "Required because international shipments are selected."
          : "Optional for domestic-only business accounts."
      }
    ];

    return fields;
  }, [isInternational]);

  function updateContact<Key extends keyof BusinessAccountFormData["contact"]>(
    key: Key,
    value: BusinessAccountFormData["contact"][Key]
  ) {
    setValidationErrors((current) => ({ ...current, [key]: "" }));

    if (key === "email" || key === "mobileNumber") {
      setFieldErrors((current) => ({ ...current, [key]: undefined }));
    }

    setFormData((current) => ({
      ...current,
      contact: { ...current.contact, [key]: value }
    }));
  }

  function updateCompany<Key extends keyof BusinessAccountFormData["company"]>(
    key: Key,
    value: BusinessAccountFormData["company"][Key]
  ) {
    setValidationErrors((current) => ({ ...current, [key]: "" }));

    if (key === "registrationId") {
      setFieldErrors((current) => ({ ...current, registrationId: undefined }));
    }

    setFormData((current) => ({
      ...current,
      company: { ...current.company, [key]: value }
    }));
  }

  function replaceStepValidationErrors(stepToValidate: number, nextErrors: Record<string, string>) {
    const keys = stepValidationKeys[stepToValidate] ?? [];

    setValidationErrors((current) => {
      const merged = { ...current };

      for (const key of keys) {
        delete merged[key];
      }

      return { ...merged, ...nextErrors };
    });
  }

  function getUniqueFieldValue(field: UniqueField) {
    if (field === "email") return formData.contact.email.trim();
    if (field === "mobileNumber") return formData.contact.mobileNumber.trim();
    return formData.company.registrationId.trim();
  }

  async function validateUniqueField(field: UniqueField): Promise<boolean> {
    const value = getUniqueFieldValue(field);

    if (!value) {
      setFieldErrors((current) => ({ ...current, [field]: undefined }));
      return true;
    }

    setValidatingFields((current) => ({ ...current, [field]: true }));

    try {
      const result = await validateBusinessAccountUnique({
        [field]: value,
        excludeAccountId: account?.accountId
      });

      if (getUniqueFieldValue(field) !== value) return true;

      const hasConflict = result.conflicts[field];
      setFieldErrors((current) => ({
        ...current,
        [field]: hasConflict ? duplicateMessages[field] : undefined
      }));

      return !hasConflict;
    } catch {
      setFieldErrors((current) => ({
        ...current,
        [field]: "Unable to validate this value right now."
      }));
      return false;
    } finally {
      setValidatingFields((current) => ({ ...current, [field]: false }));
    }
  }

  async function validateStepUniqueFields(stepToValidate: number): Promise<boolean> {
    const fields: UniqueField[] = stepToValidate === 0
      ? ["email", "mobileNumber"]
      : stepToValidate === 1
        ? ["registrationId"]
        : [];

    if (!fields.length) return true;

    const results = await Promise.all(fields.map((field) => validateUniqueField(field)));
    const isValid = results.every(Boolean);

    if (!isValid) {
      setError("Please fix the highlighted duplicate fields before continuing.");
    }

    return isValid;
  }

  function toggleShipmentType(type: "domestic" | "international") {
    const current = formData.contact.shipmentTypes;
    const next = current.includes(type)
      ? current.filter((item) => item !== type)
      : [...current, type];

    setValidationErrors((currentErrors) => ({ ...currentErrors, shipmentTypes: "" }));
    if (type === "international" && current.includes("international")) {
      setDocumentErrors((currentErrors) => ({ ...currentErrors, iecCertificate: undefined }));
    }
    updateContact("shipmentTypes", next.length ? next : [type]);
  }

  function handleDocumentChange(type: DocumentType, file: File | null) {
    if (!file) {
      setFiles((current) => ({ ...current, [type]: null }));
      setDocumentErrors((current) => ({ ...current, [type]: undefined }));
      return;
    }

    const fileError = getDocumentFileError(file);

    if (fileError) {
      setFiles((current) => ({ ...current, [type]: null }));
      setDocumentErrors((current) => ({ ...current, [type]: fileError }));
      return;
    }

    setFiles((current) => ({ ...current, [type]: file }));
    setDocumentErrors((current) => ({ ...current, [type]: undefined }));
  }

  function getStepValidationErrors(stepToValidate: number) {
    const nextErrors: Record<string, string> = {};

    if (stepToValidate === 0) {
      if (!formData.contact.firstName.trim()) nextErrors.firstName = "First name is required.";
      if (!formData.contact.lastName.trim()) nextErrors.lastName = "Last name is required.";
      if (!formData.contact.email.trim()) nextErrors.email = "Email address is required.";
      else if (!isValidEmail(formData.contact.email.trim())) nextErrors.email = "Enter a valid email address.";
      if (!formData.contact.countryCode.trim()) nextErrors.countryCode = "Country code is required.";
      if (!/^\d{6,15}$/.test(formData.contact.mobileNumber.trim())) {
        nextErrors.mobileNumber = "Mobile number must contain 6 to 15 digits.";
      }
      if (!formData.contact.department.trim()) nextErrors.department = "Department is required.";
      if (!formData.contact.shipmentTypes.length) nextErrors.shipmentTypes = "Select at least one shipment type.";
    }

    if (stepToValidate === 1) {
      if (!formData.company.registrationCountry.trim()) nextErrors.registrationCountry = "Country of registration is required.";
      if (!formData.company.registrationId.trim()) nextErrors.registrationId = "Company registration ID is required.";
      if (!formData.company.companyName.trim()) nextErrors.companyName = "Company name is required.";
      if (!formData.company.registeredAddress.trim()) nextErrors.registeredAddress = "Registered address is required.";
      if (!formData.company.city.trim()) nextErrors.city = "City is required.";
      if (!formData.company.stateOrProvince.trim()) nextErrors.stateOrProvince = "State or province is required.";
      if (!formData.company.postalCode.trim()) nextErrors.postalCode = "Postal code is required.";
      if (!formData.company.operatingCountries.length) nextErrors.operatingCountries = "Select at least one operating country.";
      if (!formData.company.industry.trim()) nextErrors.industry = "Company industry is required.";
      if (!formData.company.monthlyShipmentVolume.trim()) nextErrors.monthlyShipmentVolume = "Monthly shipment volume is required.";
      if (!formData.company.requestedCreditCurrency.trim()) nextErrors.requestedCreditCurrency = "Currency is required.";
      if (formData.company.website && !isValidUrl(formData.company.website)) nextErrors.website = "Enter a valid website URL.";
      const requestedCreditLimit = formData.company.requestedCreditLimit.trim();
      if (requestedCreditLimit && (!Number.isFinite(Number(requestedCreditLimit)) || Number(requestedCreditLimit) < 0)) {
        nextErrors.requestedCreditLimit = "Requested credit limit must be a valid positive amount.";
      }
    }

    if (stepToValidate === 3 && !confirmation) {
      nextErrors.confirmation = "Please confirm the information has been reviewed.";
    }

    return nextErrors;
  }

  function getDocumentValidationErrors() {
    const nextErrors: Partial<Record<DocumentType, string>> = { ...documentErrors };

    if (!files.gstCertificate && !existingDocuments.gstCertificate) {
      nextErrors.gstCertificate = "GST Certificate is required.";
    }

    if (!files.panCard && !existingDocuments.panCard) {
      nextErrors.panCard = "PAN Card Copy is required.";
    }

    // IEC is mandatory only for international shipment accounts; domestic-only accounts are not blocked.
    if (isInternational && !files.iecCertificate && !existingDocuments.iecCertificate) {
      nextErrors.iecCertificate = "IEC Certificate is required for international shipment accounts.";
    }

    return nextErrors;
  }

  async function validateStep(stepToValidate: number) {
    setError("");

    if (stepToValidate === 2) {
      const nextDocumentErrors = getDocumentValidationErrors();
      setDocumentErrors(nextDocumentErrors);

      if (Object.values(nextDocumentErrors).some(Boolean)) {
        setError("Please fix the highlighted document issues before continuing.");
        return false;
      }

      return true;
    }

    const nextErrors = getStepValidationErrors(stepToValidate);
    replaceStepValidationErrors(stepToValidate, nextErrors);

    if (Object.keys(nextErrors).length) {
      setError("Please fill the highlighted fields before continuing.");
      return false;
    }

    return validateStepUniqueFields(stepToValidate);
  }

  async function submitForReview() {
    for (const stepToValidate of [0, 1, 2, 3]) {
      if (!(await validateStep(stepToValidate))) {
        setStep(stepToValidate);
        return;
      }
    }

    setSaving(true);

    try {
      const result = isEdit && account
        ? await updateBusinessAccount(account.accountId, formData, files)
        : await createBusinessAccount(formData, files);

      if (!isEdit || isDraftEdit) {
        await submitBusinessAccount(result.account.accountId);
      }

      router.push(`/dashboard/business-accounts/${result.account.accountId}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save business account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(await validateStep(step))) return;
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function handleStepNavigation(nextStep: number) {
    if (nextStep <= step) {
      setStep(nextStep);
      return;
    }

    for (let stepToValidate = step; stepToValidate < nextStep; stepToValidate += 1) {
      if (!(await validateStep(stepToValidate))) {
        setStep(stepToValidate);
        return;
      }
    }

    setStep(nextStep);
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">
            {isEdit ? "Edit Business Account" : "Create Business Account"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isEdit && !isDraftEdit
              ? "Update the submitted account details, documents, and review information."
              : "Complete the account details, upload documents, then submit for pending review."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/dashboard/business-accounts")}
          className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-900 hover:text-blue-900"
        >
          Cancel
        </button>
      </div>

      <div className="mb-6 grid grid-cols-4 border border-slate-200 bg-white">
        {steps.map((label, index) => {
          const isCurrent = step === index;
          const isCompleted = index < step;

          return (
            <button
              key={label}
              type="button"
              onClick={() => void handleStepNavigation(index)}
              className={`border-r border-slate-200 px-4 py-3 text-left text-sm font-semibold last:border-r-0 ${
                isCurrent
                  ? "bg-blue-600 text-white"
                  : isCompleted
                    ? "bg-green-500 text-white"
                    : "text-slate-600 hover:text-blue-900"
              }`}
            >
              {index + 1}. {label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <form noValidate onSubmit={handleContinue} className="border border-slate-200 bg-white p-6 shadow-sm">
        {/* <p className="mb-5 text-sm font-medium text-slate-500">Fields marked with <span className="text-red-600">*</span> are required.</p> */}

        {step === 0 ? (
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="First Name" value={formData.contact.firstName} onChange={(value) => updateContact("firstName", value)} error={validationErrors.firstName} required />
            <Field label="Last Name" value={formData.contact.lastName} onChange={(value) => updateContact("lastName", value)} error={validationErrors.lastName} required />
            <Field
              label="Email Address"
              type="email"
              value={formData.contact.email}
              onChange={(value) => updateContact("email", value)}
              onBlur={() => void validateUniqueField("email")}
              error={validationErrors.email || fieldErrors.email}
              helper={validatingFields.email ? "Checking email..." : undefined}
              required
            />
            <div className="grid grid-cols-[90px_1fr] gap-3">
              <Field label="Code" value={formData.contact.countryCode} onChange={(value) => updateContact("countryCode", value)} error={validationErrors.countryCode} required />
              <Field
                label="Mobile Number"
                value={formData.contact.mobileNumber}
                onChange={(value) => updateContact("mobileNumber", value)}
                onBlur={() => void validateUniqueField("mobileNumber")}
                error={validationErrors.mobileNumber || fieldErrors.mobileNumber}
                helper={validatingFields.mobileNumber ? "Checking mobile number..." : undefined}
                required
              />
            </div>
            <SearchableSelect label="Department" value={formData.contact.department} onChange={(value) => updateContact("department", value)} options={toOptions(departments)} error={validationErrors.department} required />
            <div>
              <label className="block text-sm font-semibold text-slate-700">Shipment Type <span className="text-red-600">*</span></label>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <CheckboxField
                  label="Domestic Shipments"
                  checked={formData.contact.shipmentTypes.includes("domestic")}
                  onChange={() => toggleShipmentType("domestic")}
                />
                <CheckboxField
                  label="International Shipments"
                  checked={isInternational}
                  onChange={() => toggleShipmentType("international")}
                />
              </div>
              {validationErrors.shipmentTypes ? <p className="mt-1 text-xs font-semibold text-red-600">{validationErrors.shipmentTypes}</p> : null}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-8">
            <section>
            
              <div className="grid gap-5 md:grid-cols-2">
                <SearchableSelect label="Country of Registration" value={formData.company.registrationCountry} onChange={(value) => updateCompany("registrationCountry", value)} options={toOptions(countries)} error={validationErrors.registrationCountry} required />
                <Field
                  label="Company Registration ID"
                  value={formData.company.registrationId}
                  onChange={(value) => updateCompany("registrationId", value)}
                  onBlur={() => void validateUniqueField("registrationId")}
                  error={validationErrors.registrationId || fieldErrors.registrationId}
                  helper={validatingFields.registrationId ? "Checking registration ID..." : undefined}
                  required
                />
                <Field label="Company Name" value={formData.company.companyName} onChange={(value) => updateCompany("companyName", value)} error={validationErrors.companyName} required />
                <Field label="Company Website" type="url" value={formData.company.website ?? ""} onChange={(value) => updateCompany("website", value)} error={validationErrors.website} />
              </div>
            </section>

            <section className=" border-slate-200 ">
            
              <div className="grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <TextAreaField label="Registered Address" value={formData.company.registeredAddress} onChange={(value) => updateCompany("registeredAddress", value)} error={validationErrors.registeredAddress} required />
                </div>
                <Field label="City" value={formData.company.city} onChange={(value) => updateCompany("city", value)} error={validationErrors.city} required />
                <Field label="State or Province" value={formData.company.stateOrProvince} onChange={(value) => updateCompany("stateOrProvince", value)} error={validationErrors.stateOrProvince} required />
                <div className="md:col-span-2 grid gap-5 md:grid-cols-[minmax(140px,220px)_minmax(0,1fr)]">
                  <Field label="Postal Code" value={formData.company.postalCode} onChange={(value) => updateCompany("postalCode", value)} error={validationErrors.postalCode} required />
                  <MultiSearchableSelect label="Operating Countries" values={formData.company.operatingCountries} onChange={(value) => updateCompany("operatingCountries", value)} options={toOptions(countries)} error={validationErrors.operatingCountries} required />
                </div>
              </div>
            </section>

            <section className="">
           
              <div className="grid gap-5 md:grid-cols-2">
                <SearchableSelect label="Company Industry" value={formData.company.industry} onChange={(value) => updateCompany("industry", value)} options={toOptions(industries)} error={validationErrors.industry} required />
                <SearchableSelect label="Monthly Shipment Volume" value={formData.company.monthlyShipmentVolume} onChange={(value) => updateCompany("monthlyShipmentVolume", value)} options={toOptions(shipmentVolumes)} error={validationErrors.monthlyShipmentVolume} required />
                <div className="grid grid-cols-[100px_1fr] gap-3">
                  <SearchableSelect
                    label="Currency"
                    value={formData.company.requestedCreditCurrency}
                    onChange={(value) => updateCompany("requestedCreditCurrency", getCurrencyCode(value))}
                    options={currencies.map((currency) => ({ value: getCurrencyCode(currency), label: currency }))}
                    error={validationErrors.requestedCreditCurrency}
                    required
                  />
                  <Field label="Requested Credit Limit" type="number" value={formData.company.requestedCreditLimit} onChange={(value) => updateCompany("requestedCreditLimit", value)} error={validationErrors.requestedCreditLimit} />
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-4">
            {documentFields.map((field) => (
              <DocumentInput
                key={field.type}
                type={field.type}
                required={field.required}
                helper={field.helper}
                existingFileName={existingDocuments[field.type]?.originalName}
                file={files[field.type] ?? null}
                error={documentErrors[field.type]}
                onChange={(file) => handleDocumentChange(field.type, file)}
              />
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-6">
            <ReviewSection title="Contact Details" values={[
              ["Name", `${formData.contact.firstName} ${formData.contact.lastName}`],
              ["Email", formData.contact.email],
              ["Mobile", `${formData.contact.countryCode} ${formData.contact.mobileNumber}`],
              ["Department", formData.contact.department],
              ["Shipment Type", formData.contact.shipmentTypes.join(", ")]
            ]} onEdit={() => setStep(0)} />
            <ReviewSection title="Company Details" values={[
              ["Company", formData.company.companyName],
              ["Registration", `${formData.company.registrationCountry} - ${formData.company.registrationId}`],
              ["Operating Countries", formData.company.operatingCountries.join(", ")],
              ["Address", `${formData.company.registeredAddress}, ${formData.company.city}`],
              ["Industry", formData.company.industry],
              ["Credit Requested", formData.company.requestedCreditLimit ? `${formData.company.requestedCreditCurrency} ${formData.company.requestedCreditLimit}` : "Not requested"]
            ]} onEdit={() => setStep(1)} />
            <ReviewSection title="Uploaded Documents" values={documentFields.map((field) => [
              getDocumentLabel(field.type),
              files[field.type]?.name || existingDocuments[field.type]?.originalName || (field.required ? "Missing" : "Not uploaded")
            ])} onEdit={() => setStep(2)} />
            <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.checked);
                  setValidationErrors((current) => ({ ...current, confirmation: "" }));
                }}
                className="mt-1 h-4 w-4"
              />
              I confirm that the provided business and contact information has been reviewed and is accurate.
            </label>
            {validationErrors.confirmation ? <p className="text-xs font-semibold text-red-600">{validationErrors.confirmation}</p> : null}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
            disabled={step === 0 || saving}
            className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          <div className="flex gap-3">
            {step < steps.length - 1 ? (
              <button
                type="submit"
                disabled={saving || isCheckingUnique}
                className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-blue-900/60"
              >
                {isCheckingUnique ? "Checking..." : "Continue"}
              </button>
            ) : (
              <button
                type="button"
                onClick={submitForReview}
                disabled={saving || isCheckingUnique}
                className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-blue-900/60"
              >
                {saving
                  ? isEdit && !isDraftEdit ? "Saving..." : "Submitting..."
                  : isCheckingUnique ? "Checking..."
                    : isEdit && !isDraftEdit ? "Save Changes" : "Submit for Review"}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  error,
  helper,
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  helper?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}{required ? <span className="text-red-600"> *</span> : null}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        className={`mt-2 block w-full border px-3 py-2 text-sm outline-none transition focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-100"
            : "border-slate-300 focus:border-blue-900 focus:ring-blue-100"
        }`}
      />
      {error ? <p className="mt-1 text-xs font-semibold text-red-600">{error}</p> : null}
      {!error && helper ? <p className="mt-1 text-xs font-medium text-slate-500">{helper}</p> : null}
    </label>
  );
}

function SearchableSelect({
  label,
  value,
  onChange,
  options,
  error,
  required = false,
  placeholder = "Select"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.trim().toLowerCase())
  );

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
    listRef.current
      ?.querySelector(`[data-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function selectOption(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    setSearch("");
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
      <label className="block text-sm font-semibold text-slate-700">
        {label}{required ? <span className="text-red-600"> *</span> : null}
      </label>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setHighlightedIndex(0);
        }}
        className={`mt-2 flex h-10 w-full min-w-0 items-center border bg-white py-2 pl-3 pr-11 text-left text-sm outline-none transition focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-100"
            : "border-slate-300 focus:border-blue-900 focus:ring-blue-100"
        }`}
      >
        <span title={selectedOption?.label || placeholder} className={selectedOption ? "block truncate text-slate-900" : "block truncate text-slate-400"}>
          {selectedOption?.label || placeholder}
        </span>
        <span className={`pointer-events-none absolute right-4 text-slate-400 transition ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {open ? (
        <div
          className={`absolute z-50 w-full overflow-hidden border border-slate-200 bg-white shadow-lg ${
            openUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <div className="sticky top-0 border-b border-slate-200 bg-white p-2">
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setHighlightedIndex(0);
              }}
              placeholder="Search"
              className="block h-9 w-full border border-slate-300 px-3 text-sm outline-none focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto overscroll-contain">
            {filteredOptions.length ? filteredOptions.map((option, index) => (
              <button
                key={option.value}
                type="button"
                data-index={index}
                title={option.label}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option)}
                className={`block h-10 w-full truncate px-3 text-left text-sm ${
                  highlightedIndex === index ? "bg-blue-50 text-blue-900" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {option.label}
              </button>
            )) : (
              <p className="px-3 py-4 text-sm text-slate-500">No options found.</p>
            )}
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs font-semibold text-red-600">{error}</p> : null}
    </div>
  );
}

function MultiSearchableSelect({
  label,
  values,
  onChange,
  options,
  error,
  required = false
}: {
  label: string;
  values: string[];
  onChange: (value: string[]) => void;
  options: SelectOption[];
  error?: string;
  required?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.trim().toLowerCase())
  );
  const selectedOptions = values
    .map((value) => options.find((option) => option.value === value))
    .filter((option): option is SelectOption => Boolean(option));
  const visibleChips = selectedOptions.slice(0, 3);
  const hiddenCount = Math.max(selectedOptions.length - visibleChips.length, 0);

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
    listRef.current
      ?.querySelector(`[data-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function toggleValue(value: string) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
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
      <label className="block text-sm font-semibold text-slate-700">
        {label}{required ? <span className="text-red-600"> *</span> : null}
      </label>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setHighlightedIndex(0);
        }}
        className={`mt-2 flex min-h-10 w-full min-w-0 items-center border bg-white py-2 pl-3 pr-11 text-left text-sm outline-none transition focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-100"
            : "border-slate-300 focus:border-blue-900 focus:ring-blue-100"
        }`}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 overflow-hidden">
          {visibleChips.length ? visibleChips.map((option) => (
            <span key={option.value} title={option.label} className="inline-flex max-w-[170px] items-center gap-1 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              <span className="truncate">{option.label}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleValue(option.value);
                }}
                className="text-slate-500 hover:text-red-600"
              >
                x
              </span>
            </span>
          )) : <span className="truncate text-slate-400">Select countries</span>}
          {hiddenCount ? <span className="text-xs font-semibold text-slate-500">+{hiddenCount} more</span> : null}
        </span>
        <span className={`pointer-events-none absolute right-4 text-slate-400 transition ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {open ? (
        <div
          className={`absolute z-50 w-full overflow-hidden border border-slate-200 bg-white shadow-lg ${
            openUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <div className="sticky top-0 border-b border-slate-200 bg-white p-2">
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setHighlightedIndex(0);
              }}
              placeholder="Search countries"
              className="block h-9 w-full border border-slate-300 px-3 text-sm outline-none focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
            />
            {values.length ? (
              <button type="button" onClick={() => onChange([])} className="mt-2 text-xs font-semibold text-red-600">
                Clear all
              </button>
            ) : null}
          </div>
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
                    highlightedIndex === index ? "bg-blue-50 text-blue-900" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {selected ? <span className="shrink-0 font-semibold text-blue-900">Selected</span> : null}
                </button>
              );
            }) : (
              <p className="px-3 py-4 text-sm text-slate-500">No countries found.</p>
            )}
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs font-semibold text-red-600">{error}</p> : null}
    </div>
  );
}

function TextAreaField({
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
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}{required ? <span className="text-red-600"> *</span> : null}</span>
      <textarea
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        aria-invalid={Boolean(error)}
        className={`mt-2 block w-full border px-3 py-2 text-sm outline-none transition focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-100"
            : "border-slate-300 focus:border-blue-900 focus:ring-blue-100"
        }`}
      />
      {error ? <p className="mt-1 text-xs font-semibold text-red-600">{error}</p> : null}
    </label>
  );
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 border-slate-300 text-blue-900 focus:ring-blue-900"
      />
      <span>{label}</span>
    </label>
  );
}

function DocumentInput({
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
    <div className="border border-slate-200 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-stretch">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {getDocumentLabel(type)} {required ? <span className="text-red-600">*</span> : null}
          </h3>
          <p className="mt-1 text-sm text-slate-500">{helper}</p>
          <p className="mt-1 text-xs text-slate-400">Supported formats: PDF, JPG, JPEG, PNG. Max size: 5 MB.</p>

          <label
            htmlFor={inputId}
            className={`mt-4 flex min-h-28 cursor-pointer flex-col justify-center border border-dashed px-4 py-5 transition hover:border-blue-900 hover:bg-blue-50/40 ${
              error ? "border-red-400 bg-red-50/40" : "border-slate-300"
            }`}
          >
            <span className="text-sm font-semibold text-blue-900">
              {file || existingFileName ? "Replace file" : "Browse file"}
            </span>
            <span className="mt-1 text-sm text-slate-500">Choose one PDF or image document.</span>
          </label>
          {error ? <p className="mt-2 text-xs font-semibold text-red-600">{error}</p> : null}
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

function DocumentPreviewCard({
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
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!fileName) {
    return (
      <div className="flex min-h-40 items-center justify-center border border-slate-200 bg-slate-50 px-4 text-center text-sm font-medium text-slate-400">
        No file selected
      </div>
    );
  }

  return (
    <div className="flex min-h-40 flex-col border border-slate-200 bg-white p-3">
      <div className="flex h-24 items-center justify-center overflow-hidden bg-slate-50">
        {isImage && previewUrl ? (
          <button
            type="button"
            onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
            aria-label={`Preview ${fileName}`}
            className="h-full w-full bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url("${previewUrl}")` }}
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center border border-slate-300 bg-white text-sm font-bold text-blue-900">
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
          <button type="button" onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")} className="text-blue-900">
            Preview
          </button>
        ) : null}
        <label htmlFor={inputId} className="cursor-pointer text-blue-900">
          Replace
        </label>
        {file ? (
          <button type="button" onClick={onRemove} className="text-red-600">
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ReviewSection({
  title,
  values,
  onEdit
}: {
  title: string;
  values: string[][];
  onEdit: () => void;
}) {
  return (
    <section className="border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <button type="button" onClick={onEdit} className="text-sm font-semibold text-blue-900">
          Edit
        </button>
      </div>
      <dl className="grid gap-3 md:grid-cols-2">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold uppercase text-slate-400">{label}</dt>
            <dd className="mt-1 text-sm text-slate-700">{value || "Not provided"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
