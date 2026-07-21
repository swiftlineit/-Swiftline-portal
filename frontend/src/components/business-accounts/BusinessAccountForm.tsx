"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parsePhoneNumberFromString } from "libphonenumber-js";
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
import {
  businessAccountSteps,
  CompanyStep,
  ContactStep,
  DocumentsStep,
  ReviewStep,
  type UniqueField
} from "@/components/business-accounts/BusinessAccountFormSteps";
import {
  getPrimaryRegistrationRule,
  getSecondaryRegistrationRule
} from "@/lib/businessAccountRegistrationRules";
import {
  getPostalCodeValidationMessage,
  isValidPostalCodeForCountry
} from "@/lib/businessAccountPostalCodes";

const defaultFormData: BusinessAccountFormData = {
  contact: {
    title: "mr.",
    firstName: "",
    lastName: "",
    email: "",
    mobileType: "mobile",
    countryCode: "+91",
    mobileNumber: "",
    jobTitle: "",
    department: "",
    shipmentTypes: ["international_cargo"]
  },
  company: {
    registrationCountry: "India",
    registrationIdType: "pan",
    registrationId: "",
    gstin: "",
    secondaryRegistrationId: "",
    noCompanyRegistration: false,
    noCompany: false,
    companyType: "",
    companyName: "",
    registeredAddress: "",
    city: "",
    stateOrProvince: "",
    postalCode: "",
    addressCountry: "India",
    useCompanyAddressAsBillingAddress: true,
    operatingCountries: ["India"],
    website: "",
    industry: "",
    monthlyShipmentVolume: "",
    requestedCreditCurrency: "INR",
    requestedCreditLimit: ""
  }
};

const duplicateMessages: Record<UniqueField, string> = {
  email: "Email address already exists.",
  mobileNumber: "Mobile number already exists.",
  registrationId: "Company registration ID already exists."
};

const maxDocumentSizeBytes = 5 * 1024 * 1024;
const allowedDocumentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const allowedDocumentExtensions = new Set(["pdf", "jpg", "jpeg", "png"]);
const allowedPersonalEmailDomains = new Set(["gmail.com", "yahoo.com", "outlook.com"]);
const reservedPersonalEmailNames = new Set(["gmail", "yahoo", "outlook", "hotmail"]);
const blockedEmailTlds = new Set(["con", "comm", "cpm", "coom", "om"]);
const emailValidationMessage = "Use gmail.com, yahoo.com, outlook.com, or a valid company email domain.";
const phoneValidationMessage = "Enter a valid phone number for the selected country code.";
type CompanyBlurValidationField = "registrationId" | "secondaryRegistrationId" | "postalCode" | "requestedCreditLimit";

const stepValidationKeys = [
  ["title", "firstName", "lastName", "email", "mobileType", "countryCode", "mobileNumber", "jobTitle", "department", "shipmentTypes"],
  [
    "registrationCountry",
    "registrationIdType",
    "registrationId",
    "gstin",
    "secondaryRegistrationId",
    "noCompanyRegistration",
    "noCompany",
    "companyType",
    "companyName",
    "registeredAddress",
    "city",
    "stateOrProvince",
    "postalCode",
    "addressCountry",
    "useCompanyAddressAsBillingAddress",
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

function normalizeShipmentTypes(values: string[]) {
  const firstValue = values[0];

  if (firstValue === "international_courier") {
    return ["international_courier"] as BusinessAccountFormData["contact"]["shipmentTypes"];
  }

  return ["international_cargo"] as BusinessAccountFormData["contact"]["shipmentTypes"];
}

function fromAccount(account?: BusinessAccount): BusinessAccountFormData {
  if (!account) return defaultFormData;

  return {
    contact: {
      ...defaultFormData.contact,
      ...account.contact,
      shipmentTypes: normalizeShipmentTypes(account.contact.shipmentTypes)
    },
    company: {
      ...account.company,
      registrationIdType: account.company.registrationIdType ?? defaultFormData.company.registrationIdType,
      secondaryRegistrationId: account.company.secondaryRegistrationId ?? "",
      noCompanyRegistration: account.company.noCompanyRegistration ?? false,
      noCompany: account.company.noCompany ?? false,
      companyType: account.company.companyType ?? "",
      website: account.company.website ?? "",
      addressCountry: account.company.addressCountry ?? account.company.registrationCountry ?? defaultFormData.company.addressCountry,
      useCompanyAddressAsBillingAddress: account.company.useCompanyAddressAsBillingAddress ?? true,
      operatingCountries: account.company.operatingCountries ?? (account.company.operatingCountry ? [account.company.operatingCountry] : []),
      requestedCreditCurrency: account.company.requestedCreditLimit.currency,
      requestedCreditLimit: account.company.requestedCreditLimit.amount?.toString() ?? ""
    }
  };
}

function isValidEmail(value: string) {
  const email = value.trim().toLowerCase();
  const basicEmailPattern = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

  if (!basicEmailPattern.test(email)) return false;

  const domain = email.split("@")[1] ?? "";
  const parts = domain.split(".");
  const domainName = parts[0];
  const tld = parts.at(-1) ?? "";

  if (!domainName) return false;
  if (blockedEmailTlds.has(tld)) return false;

  if (reservedPersonalEmailNames.has(domainName)) {
    return allowedPersonalEmailDomains.has(domain);
  }

  return /^[a-z]{2,24}$/.test(tld);
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

function countryRequiresRegistrationId(country: string) {
  return !["United States", "Kuwait"].includes(country);
}

function countryRequiresSecondaryRegistrationId(country: string) {
  return ["France", "Netherlands"].includes(country);
}

function getPhoneValidationError(countryCode: string, mobileNumber: string) {
  const normalizedCountryCode = countryCode.trim();
  const normalizedMobileNumber = mobileNumber.trim();

  if (!normalizedCountryCode) return "Country code is required.";
  if (!/^\d{6,15}$/.test(normalizedMobileNumber)) return "Mobile number must contain 6 to 15 digits.";

  const phoneNumber = parsePhoneNumberFromString(`${normalizedCountryCode}${normalizedMobileNumber}`);

  return phoneNumber?.isValid() ? "" : phoneValidationMessage;
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

  const existingDocuments = account?.documents ?? {};
  const steps = businessAccountSteps;
  const isEdit = Boolean(account);
  const isDraftEdit = account?.status === "draft";
  const isCheckingUnique = Object.values(validatingFields).some(Boolean);

  const documentFields = useMemo(() => [
    { type: "aadhaarCard" as DocumentType, required: true, helper: "Mandatory identity document for KYC verification." },
    { type: "panCard" as DocumentType, required: true, helper: "Mandatory PAN document for KYC verification." },
    { type: "adCertificate" as DocumentType, required: false, helper: "Optional supporting AD certificate for KYC review." },
    { type: "msmeCertificate" as DocumentType, required: false, helper: "Optional MSME certificate, if applicable." },
    { type: "tanCertificate" as DocumentType, required: false, helper: "Optional TAN certificate, if applicable." },
    { type: "gstCertificate" as DocumentType, required: false, helper: "Optional GST certificate, if applicable." },
    { type: "iecCertificate" as DocumentType, required: false, helper: "Optional IEC certificate, if applicable." },
    { type: "otherCertificate" as DocumentType, required: false, helper: "Optional supporting certificate or document." }
  ], []);

  function updateContact<Key extends keyof BusinessAccountFormData["contact"]>(
    key: Key,
    value: BusinessAccountFormData["contact"][Key]
  ) {
    setValidationErrors((current) => ({ ...current, [key]: "" }));

    if (key === "email" || key === "mobileNumber") {
      setFieldErrors((current) => ({ ...current, [key]: undefined }));
    }

    if (key === "countryCode") {
      setValidationErrors((current) => ({ ...current, mobileNumber: "" }));
      setFieldErrors((current) => ({ ...current, mobileNumber: undefined }));
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

    if (key === "registrationCountry") {
      setValidationErrors((current) => ({ ...current, registrationId: "", secondaryRegistrationId: "" }));
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

    if (field === "email" && !isValidEmail(value)) {
      setFieldErrors((current) => ({ ...current, email: emailValidationMessage }));
      return false;
    }

    if (field === "mobileNumber") {
      const phoneError = getPhoneValidationError(formData.contact.countryCode, value);

      if (phoneError) {
        setFieldErrors((current) => ({ ...current, mobileNumber: phoneError }));
        return false;
      }
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
        ? formData.company.registrationId.trim() ? ["registrationId"] : []
        : [];

    if (!fields.length) return true;

    const results = await Promise.all(fields.map((field) => validateUniqueField(field)));
    const isValid = results.every(Boolean);

    if (!isValid) {
      setError("Please fix the highlighted duplicate fields before continuing.");
    }

    return isValid;
  }

  function updateShipmentType(value: string) {
    setValidationErrors((currentErrors) => ({ ...currentErrors, shipmentTypes: "" }));
    updateContact("shipmentTypes", [value] as BusinessAccountFormData["contact"]["shipmentTypes"]);
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

  function getCompanyBlurValidationError(field: CompanyBlurValidationField) {
    const noCompany = Boolean(formData.company.noCompany);

    if (field === "registrationId") {
      const registrationId = formData.company.registrationId.trim();
      const canSkipRegistration = noCompany || formData.company.noCompanyRegistration || !countryRequiresRegistrationId(formData.company.registrationCountry);
      const primaryRegistrationRule = getPrimaryRegistrationRule(formData.company.registrationCountry, formData.company.registrationIdType);

      if (canSkipRegistration || !registrationId || !primaryRegistrationRule) return "";
      return primaryRegistrationRule.validate(registrationId) ? "" : primaryRegistrationRule.message;
    }

    if (field === "secondaryRegistrationId") {
      const secondaryRegistrationId = formData.company.secondaryRegistrationId?.trim() ?? "";
      const canSkipRegistration = noCompany || formData.company.noCompanyRegistration || !countryRequiresRegistrationId(formData.company.registrationCountry);
      const secondaryRegistrationRule = getSecondaryRegistrationRule(formData.company.registrationCountry);

      if (canSkipRegistration || !secondaryRegistrationId || !secondaryRegistrationRule) return "";
      return secondaryRegistrationRule.validate(secondaryRegistrationId) ? "" : secondaryRegistrationRule.message;
    }

    if (field === "postalCode") {
      const postalCode = formData.company.postalCode.trim();
      const addressCountry = formData.company.addressCountry?.trim();

      if (noCompany || !postalCode || !addressCountry) return "";
      return isValidPostalCodeForCountry(addressCountry, postalCode) ? "" : getPostalCodeValidationMessage(addressCountry);
    }

    const requestedCreditLimit = formData.company.requestedCreditLimit.trim();

    if (noCompany || !requestedCreditLimit) return "";
    if (!Number.isFinite(Number(requestedCreditLimit)) || Number(requestedCreditLimit) < 0) {
      return "Requested credit limit must be a valid positive amount.";
    }

    if (Number(requestedCreditLimit) > 100000) {
      return "Requested credit limit cannot exceed 100000.";
    }

    return "";
  }

  function validateCompanyFieldOnBlur(field: CompanyBlurValidationField) {
    const nextError = getCompanyBlurValidationError(field);

    setValidationErrors((current) => ({
      ...current,
      [field]: nextError
    }));

    return !nextError;
  }

  function getStepValidationErrors(stepToValidate: number) {
    const nextErrors: Record<string, string> = {};

    if (stepToValidate === 0) {
      if (!formData.contact.title.trim()) nextErrors.title = "Title is required.";
      if (!formData.contact.firstName.trim()) nextErrors.firstName = "First name is required.";
      else if (formData.contact.firstName.trim().length > 22) nextErrors.firstName = "First name must be 22 characters or less.";
      if (!formData.contact.lastName.trim()) nextErrors.lastName = "Last name is required.";
      else if (formData.contact.lastName.trim().length > 22) nextErrors.lastName = "Last name must be 22 characters or less.";
      if (!formData.contact.email.trim()) nextErrors.email = "Email address is required.";
      else if (!isValidEmail(formData.contact.email.trim())) nextErrors.email = emailValidationMessage;
      if (!formData.contact.mobileType.trim()) nextErrors.mobileType = "Phone type is required.";
      const phoneError = getPhoneValidationError(formData.contact.countryCode, formData.contact.mobileNumber);
      if (phoneError === "Country code is required.") nextErrors.countryCode = phoneError;
      else if (phoneError) nextErrors.mobileNumber = phoneError;
      if (!formData.contact.jobTitle.trim()) nextErrors.jobTitle = "Job title is required.";
      if (!formData.contact.department.trim()) nextErrors.department = "Department is required.";
      if (!formData.contact.shipmentTypes.length) nextErrors.shipmentTypes = "Select at least one shipment type.";
    }

    if (stepToValidate === 1) {
      if (!formData.company.registrationCountry.trim()) nextErrors.registrationCountry = "Country of registration is required.";
      const noCompany = Boolean(formData.company.noCompany);
      if (!noCompany && !formData.company.companyType.trim()) nextErrors.companyType = "Company type is required.";

      const canSkipRegistration = noCompany || formData.company.noCompanyRegistration || !countryRequiresRegistrationId(formData.company.registrationCountry);
      if (!canSkipRegistration && !formData.company.registrationId.trim()) nextErrors.registrationId = "Registration ID is required.";
      if (!canSkipRegistration && countryRequiresSecondaryRegistrationId(formData.company.registrationCountry) && !formData.company.secondaryRegistrationId?.trim()) {
        nextErrors.secondaryRegistrationId = "Additional registration code is required.";
      }

      const primaryRegistrationRule = getPrimaryRegistrationRule(formData.company.registrationCountry, formData.company.registrationIdType);
      if (!canSkipRegistration && formData.company.registrationId.trim() && primaryRegistrationRule && !primaryRegistrationRule.validate(formData.company.registrationId)) {
        nextErrors.registrationId = primaryRegistrationRule.message;
      }

      const secondaryRegistrationRule = getSecondaryRegistrationRule(formData.company.registrationCountry);
      if (!canSkipRegistration && formData.company.secondaryRegistrationId?.trim() && secondaryRegistrationRule && !secondaryRegistrationRule.validate(formData.company.secondaryRegistrationId)) {
        nextErrors.secondaryRegistrationId = secondaryRegistrationRule.message;
      }
      if (formData.company.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(formData.company.gstin)) {
        nextErrors.gstin = "Enter a valid 15-character GSTIN.";
      }

      if (!noCompany && !formData.company.companyName.trim()) nextErrors.companyName = "Company name is required.";
      if (!noCompany && !formData.company.registeredAddress.trim()) nextErrors.registeredAddress = "Registered address is required.";
      if (!noCompany && !formData.company.city.trim()) nextErrors.city = "City is required.";
      if (!noCompany && !formData.company.stateOrProvince.trim()) nextErrors.stateOrProvince = "State or province is required.";
      if (!noCompany && !formData.company.postalCode.trim()) nextErrors.postalCode = "Postal code is required.";
      if (!noCompany && !formData.company.addressCountry?.trim()) nextErrors.addressCountry = "Country is required.";
      if (
        !noCompany
        && formData.company.postalCode.trim()
        && formData.company.addressCountry?.trim()
        && !isValidPostalCodeForCountry(formData.company.addressCountry, formData.company.postalCode)
      ) {
        nextErrors.postalCode = getPostalCodeValidationMessage(formData.company.addressCountry);
      }
      if (!noCompany && !formData.company.operatingCountries.length) nextErrors.operatingCountries = "Select at least one operating country.";
      if (!noCompany && !formData.company.industry.trim()) nextErrors.industry = "Company industry is required.";
      if (!noCompany && !formData.company.monthlyShipmentVolume.trim()) nextErrors.monthlyShipmentVolume = "Monthly shipment volume is required.";
      if (!formData.company.requestedCreditCurrency.trim()) nextErrors.requestedCreditCurrency = "Currency is required.";
      if (!noCompany && formData.company.website && !isValidUrl(formData.company.website)) nextErrors.website = "Enter a valid website URL.";

      const requestedCreditLimit = formData.company.requestedCreditLimit.trim();
      if (!noCompany && requestedCreditLimit && (!Number.isFinite(Number(requestedCreditLimit)) || Number(requestedCreditLimit) < 0)) {
        nextErrors.requestedCreditLimit = "Requested credit limit must be a valid positive amount.";
      } else if (!noCompany && requestedCreditLimit && Number(requestedCreditLimit) > 100000) {
        nextErrors.requestedCreditLimit = "Requested credit limit cannot exceed 100000.";
      }
    }

    if (stepToValidate === 3 && !confirmation) {
      nextErrors.confirmation = "Please confirm the information has been reviewed.";
    }

    return nextErrors;
  }

  function getDocumentValidationErrors() {
    const nextErrors: Partial<Record<DocumentType, string>> = { ...documentErrors };

    if (!files.aadhaarCard && !existingDocuments.aadhaarCard) {
      nextErrors.aadhaarCard = "Aadhaar Card is required.";
    }

    if (!files.panCard && !existingDocuments.panCard) {
      nextErrors.panCard = "PAN Card Copy is required.";
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
          <h2 className="mb-3 text-4xl font-bold uppercase text-slate-800">Let&apos;s Get Started</h2>
          <p className="mb-3 text-sm text-slate-500">
            Enter your {steps[step]}. Fields marked with asterisk (<span className="text-red-600">*</span>) are mandatory.
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
        {step === 0 ? (
          <ContactStep
            formData={formData}
            validationErrors={validationErrors}
            fieldErrors={fieldErrors}
            validatingFields={validatingFields}
            onContactChange={updateContact}
            onShipmentTypeChange={updateShipmentType}
            onValidateUniqueField={validateUniqueField}
          />
        ) : null}

        {step === 1 ? (
          <CompanyStep
            formData={formData}
            validationErrors={validationErrors}
            fieldErrors={fieldErrors}
            validatingFields={validatingFields}
            onCompanyChange={updateCompany}
            onValidateUniqueField={validateUniqueField}
            onValidateCompanyField={validateCompanyFieldOnBlur}
          />
        ) : null}

        {step === 2 ? (
          <DocumentsStep
            documentFields={documentFields}
            existingDocuments={existingDocuments}
            files={files}
            documentErrors={documentErrors}
            onDocumentChange={handleDocumentChange}
          />
        ) : null}

        {step === 3 ? (
          <ReviewStep
            formData={formData}
            documentFields={documentFields}
            existingDocuments={existingDocuments}
            files={files}
            confirmation={confirmation}
            validationErrors={validationErrors}
            onConfirmationChange={(checked) => {
              setConfirmation(checked);
              setValidationErrors((current) => ({ ...current, confirmation: "" }));
            }}
            onEditStep={setStep}
          />
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
