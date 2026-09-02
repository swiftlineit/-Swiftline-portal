"use client";

import { FormEvent, useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import Script from "next/script";
import {
  FiCheck,
  FiCheckCircle,
  FiClock,
  FiFileText,
  FiShield,
  FiBriefcase,
  FiUsers,
  FiArrowLeft,
  FiArrowRight,
  FiAlertCircle,
  FiLoader,
  FiChevronDown
} from "react-icons/fi";
import {
  BusinessAccountFiles,
  BusinessAccountFormData,
  DocumentType,
  emptyBusinessAddress,
} from "@/lib/businessAccounts";
import {
  createPublicBusinessAccount,
  createPublicIdempotencyKey,
  requestPublicEmailOtp,
  verifyPublicEmailOtp,
  validatePublicBusinessAccountUnique,
} from "@/lib/publicBusinessAccounts";
import {
  emailValidationMessage,
  getPhoneValidationError,
  isValidBusinessContactEmail,
} from "@/lib/businessAccountContactRules";
import {
  fieldLabels,
  getStepIssues,
  isStepValid,
  stepFieldKeys,
  validateBusinessAccountForm,
} from "@/lib/businessAccountValidation";
import { documentTooltips } from "@/lib/businessAccountTooltips";
import {
  businessAccountSteps,
  Field,
  SearchableSelect,
  CountryCodeField,
  CountryRegistrationSelect,
  CheckboxField,
  ComboBoxField,
  MultiSearchableSelect,
  type UniqueField,
  companyTypeOptions,
  countryOptions,
  currencyOptions,
  industries,
  registrationConfig,
  shipmentTypeOptions,
  titleOptions,
  mobileTypeOptions,
  toOptions,
  getCurrencyCode,
  registrationTypeOptionsByCountry,
} from "@/components/business-accounts/FormFieldControls";
import { AddressAutocompleteField } from "@/components/business-accounts/AddressAutocompleteField";
import { getPostalCodeFormat } from "@/lib/businessAccountPostalCodes";
import {
  GSTIN_EXAMPLE,
  GSTIN_LENGTH,
  getGstinStateName,
  normalizeGstin,
} from "@/lib/gstin";
import { collectsGstin } from "@/lib/businessAccountValidation";
import { sectionTooltips } from "@/lib/businessAccountTooltips";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { OTP_LENGTH, OtpCodeInput } from "@/components/auth/OtpCodeInput";
import {
  fetchCities,
  fetchStates,
  findStateCode,
  matchStateName,
  type GeographyState,
} from "@/lib/geography";
import {
  defaultUsTaxIdType,
  formatUsTaxId,
  isMaskedUsTaxId,
  isSensitiveUsTaxIdType,
  isUsTaxIdType,
  usTaxIdExamples,
  usTaxIdLabels,
  type UsTaxIdType,
} from "@/lib/usTaxId";
import {
  getPrimaryRegistrationRule,
  getSecondaryRegistrationRule,
} from "@/lib/businessAccountRegistrationRules";
import { BUSINESS_ACCOUNT_CREDIT_LIMIT_MAX } from "@/lib/businessAccountContactRules";
import {
  departments,
  jobTitleOptions,
  isListedJobTitle,
  OTHER_JOB_TITLE,
  shipmentVolumes,
} from "@/lib/businessAccountOptions";

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";

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
    shipmentTypes: ["international_cargo"],
  },
  company: {
    registrationCountry: "India",
    registrationIdType: "pan",
    registrationId: "",
    gstin: "",
    gstExempt: false,
    gstExemptReason: "",
    secondaryRegistrationId: "",
    noCompanyRegistration: false,
    noCompany: false,
    companyType: "",
    companyName: "",
    registeredAddress: "",
    addressLine2: "",
    city: "",
    stateOrProvince: "",
    postalCode: "",
    addressCountry: "India",
    useCompanyAddressAsBillingAddress: true,
    billingAddress: emptyBusinessAddress,
    operatingCountries: ["India"],
    website: "",
    industry: "",
    monthlyShipmentVolume: "",
    requestedCreditCurrency: "INR",
    requestedCreditLimit: "",
  },
  gstBilling: { requestedTreatment: "GST_APPLICABLE", requestReason: "" },
};

const duplicateMessages: Record<UniqueField, string> = {
  email: "Email address already exists.",
  mobileNumber: "Mobile number already exists.",
  registrationId: "Company registration ID already exists.",
};

const maxDocumentSizeBytes = 5 * 1024 * 1024;
const allowedDocumentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
const allowedDocumentExtensions = new Set(["pdf", "jpg", "jpeg", "png"]);

function getDocumentFileError(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isAllowedType =
    allowedDocumentTypes.has(file.type) ||
    allowedDocumentExtensions.has(extension);
  if (!isAllowedType)
    return "Only PDF, JPG, JPEG, and PNG files are supported.";
  if (file.size <= 0) return "The selected file is empty or corrupted.";
  if (file.size > maxDocumentSizeBytes)
    return "File size must not exceed 5 MB.";
  return "";
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

const PUBLIC_DRAFT_KEY = "public:request-business-account:v1";

function loadPublicDraft(): Partial<{
  formData: BusinessAccountFormData;
  step: number;
  touched: Record<string, boolean>;
  verifiedEmail: string | null;
  verificationToken: string | null;
  verificationExpiresAt: number | null;
}> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PUBLIC_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const PUBLIC_FILES_DB = "public-business-account-draft";
const PUBLIC_FILES_STORE = "files";
const FILES_TTL_MS = 30 * 60 * 1000;

function openDraftDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PUBLIC_FILES_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PUBLIC_FILES_STORE)) db.createObjectStore(PUBLIC_FILES_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveFilesToStorage(files: BusinessAccountFiles) {
  try {
    const entries: [string, { name: string; type: string; buffer: ArrayBuffer }][] = [];
    for (const [key, file] of Object.entries(files)) {
      if (!(file instanceof File)) continue;
      const buffer = await (file as File).arrayBuffer();
      entries.push([key, { name: (file as File).name, type: (file as File).type, buffer }]);
    }
    const db = await openDraftDB();
    const tx = db.transaction(PUBLIC_FILES_STORE, "readwrite");
    const store = tx.objectStore(PUBLIC_FILES_STORE);
    if (entries.length === 0) {
      store.delete("draftFiles");
    } else {
      store.put({ files: Object.fromEntries(entries), timestamp: Date.now() }, "draftFiles");
    }
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}

async function loadFilesFromStorage(): Promise<BusinessAccountFiles | null> {
  try {
    const db = await openDraftDB();
    const tx = db.transaction(PUBLIC_FILES_STORE, "readonly");
    const store = tx.objectStore(PUBLIC_FILES_STORE);
    const req = store.get("draftFiles");
    const result: any = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    if (!result) return null;
    if (Date.now() - result.timestamp > FILES_TTL_MS) {
      await clearFilesFromStorage();
      return null;
    }
    const restored: BusinessAccountFiles = {};
    for (const [key, meta] of Object.entries(result.files as Record<string, any>)) {
      const blob = new Blob([meta.buffer], { type: meta.type });
      const file = new File([blob], meta.name, { type: meta.type });
      (restored as any)[key] = file;
    }
    return restored;
  } catch {
    return null;
  }
}

async function clearFilesFromStorage() {
  try {
    const db = await openDraftDB();
    const tx = db.transaction(PUBLIC_FILES_STORE, "readwrite");
    tx.objectStore(PUBLIC_FILES_STORE).delete("draftFiles");
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}

export default function PublicBusinessAccountPage() {
  const [step, setStep] = useState(0);
  const [formData, setFormData] =
    useState<BusinessAccountFormData>(defaultFormData);
  const [files, setFiles] = useState<BusinessAccountFiles>({});
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{
    accountId: string;
    companyName: string;
  } | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [documentErrors, setDocumentErrors] = useState<
    Partial<Record<DocumentType, string>>
  >({});
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<UniqueField, string>>
  >({});
  const [validatingFields, setValidatingFields] = useState<
    Partial<Record<UniqueField, boolean>>
  >({});
  const [saving, setSaving] = useState(false);

  // Email verification state
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [otpResendAt, setOtpResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(
    null,
  );
  const [verificationExpiresAt, setVerificationExpiresAt] = useState<
    number | null
  >(null);
  const [otpError, setOtpError] = useState("");
  const [otpNotice, setOtpNotice] = useState("");
  const idempotencyKeyRef = useRef("");

  // Hydrate from storage after mount (avoids SSR mismatch)
  useEffect(() => {
    const draft = loadPublicDraft();
    if (draft) {
      if (draft.formData) setFormData(draft.formData);
      if (typeof draft.step === "number") setStep(draft.step);
      if (draft.touched) setTouched(draft.touched);
      if (draft.verifiedEmail) setVerifiedEmail(draft.verifiedEmail);
      if (draft.verificationToken) setVerificationToken(draft.verificationToken);
      if (draft.verificationExpiresAt) setVerificationExpiresAt(draft.verificationExpiresAt);
    }
    void loadFilesFromStorage().then((stored) => {
      if (stored && Object.keys(stored).length) setFiles(stored);
    });
  }, []);

  // Persist public draft across refresh
  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = {
      formData,
      step,
      touched,
      verifiedEmail,
      verificationToken,
      verificationExpiresAt,
    };
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify(payload));
      } catch {}
    }, 400);
    return () => window.clearTimeout(id);
  }, [
    formData,
    step,
    touched,
    verifiedEmail,
    verificationToken,
    verificationExpiresAt,
  ]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void saveFilesToStorage(files);
    }, 400);
    return () => window.clearTimeout(id);
  }, [files]);

  useEffect(() => {
    if (success && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(PUBLIC_DRAFT_KEY);
      } catch {}
      void clearFilesFromStorage();
    }
  }, [success]);

  // Job title other logic
  const [otherPicked, setOtherPicked] = useState(false);
  const showsOtherJobTitle =
    otherPicked ||
    (Boolean(formData.contact.jobTitle) &&
      !isListedJobTitle(formData.contact.jobTitle));

  // Geography for company address
  const selectedRegistrationCountry = formData.company.registrationCountry;
  const selectedRegistrationConfig =
    registrationConfig[selectedRegistrationCountry];
  const showsRegistrationField =
    Boolean(selectedRegistrationConfig) ||
    selectedRegistrationCountry === "Canada";
  const requiresSecondaryRegistration = Boolean(
    selectedRegistrationConfig?.secondaryLabel,
  );
  const noRegistrationChecked = Boolean(formData.company.noCompanyRegistration);
  const noCompanyChecked = Boolean(formData.company.noCompany);
  const primaryRegistrationRule = getPrimaryRegistrationRule(
    selectedRegistrationCountry,
    formData.company.registrationIdType,
  );
  const secondaryRegistrationRule = getSecondaryRegistrationRule(
    selectedRegistrationCountry,
  );
  const selectedAddressCountry =
    formData.company.addressCountry ?? formData.company.registrationCountry;
  const isUnitedStates = selectedRegistrationCountry === "United States";
  const registrationTypeOptions =
    registrationTypeOptionsByCountry[selectedRegistrationCountry] ?? null;
  const selectedRegistrationType =
    formData.company.registrationIdType ||
    (isUnitedStates
      ? defaultUsTaxIdType(noCompanyChecked)
      : registrationTypeOptions?.[0]?.value) ||
    "";
  const usTaxIdType: UsTaxIdType = isUsTaxIdType(selectedRegistrationType)
    ? selectedRegistrationType
    : "ein";

  const [states, setStates] = useState<GeographyState[]>([]);
  const [statesCountry, setStatesCountry] = useState("");
  const [cities, setCities] = useState<string[]>([]);
  const [citiesKey, setCitiesKey] = useState("");
  const selectedState = formData.company.stateOrProvince;
  const selectedStateCode = findStateCode(states, selectedState);
  const wantedCitiesKey = selectedStateCode
    ? `${selectedAddressCountry}:${selectedStateCode}`
    : "";
  const loadingStates = statesCountry !== selectedAddressCountry;
  const loadingCities =
    Boolean(wantedCitiesKey) && citiesKey !== wantedCitiesKey;

  const usesCompanyAddressForBilling = Boolean(
    formData.company.useCompanyAddressAsBillingAddress,
  );
  const billingAddress =
    formData.company.billingAddress ?? emptyBusinessAddress;
  const [billingStates, setBillingStates] = useState<GeographyState[]>([]);
  const [billingStatesCountry, setBillingStatesCountry] = useState("");
  const [billingCities, setBillingCities] = useState<string[]>([]);
  const [billingCitiesKey, setBillingCitiesKey] = useState("");
  const billingStateCode = findStateCode(
    billingStates,
    billingAddress.stateOrProvince,
  );
  const wantedBillingCitiesKey = billingStateCode
    ? `${billingAddress.country}:${billingStateCode}`
    : "";

  const gstExemptChecked = Boolean(formData.company.gstExempt);
  const collectsGst = collectsGstin(
    selectedRegistrationCountry,
    noCompanyChecked,
  );
  const gstinStateName = getGstinStateName(formData.company.gstin ?? "");

  useEffect(() => {
    let cancelled = false;
    void fetchStates(selectedAddressCountry).then((result) => {
      if (cancelled) return;
      setStates(result);
      setStatesCountry(selectedAddressCountry);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedAddressCountry]);

  useEffect(() => {
    if (!wantedCitiesKey) return;
    let cancelled = false;
    void fetchCities(selectedAddressCountry, selectedStateCode).then(
      (result) => {
        if (cancelled) return;
        setCities(result);
        setCitiesKey(wantedCitiesKey);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wantedCitiesKey, selectedAddressCountry, selectedStateCode]);

  useEffect(() => {
    if (usesCompanyAddressForBilling || !billingAddress.country) return;
    let cancelled = false;
    void fetchStates(billingAddress.country).then((result) => {
      if (cancelled) return;
      setBillingStates(result);
      setBillingStatesCountry(billingAddress.country);
    });
    return () => {
      cancelled = true;
    };
  }, [usesCompanyAddressForBilling, billingAddress.country]);

  useEffect(() => {
    if (!wantedBillingCitiesKey) return;
    let cancelled = false;
    void fetchCities(billingAddress.country, billingStateCode).then(
      (result) => {
        if (cancelled) return;
        setBillingCities(result);
        setBillingCitiesKey(wantedBillingCitiesKey);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wantedBillingCitiesKey, billingAddress.country, billingStateCode]);

  useEffect(() => {
    if (!otpSent || !otpExpiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [otpSent, otpExpiresAt]);

  // Heartbeat for verification expiry countdown (optional UI)
  useEffect(() => {
    if (!verificationExpiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [verificationExpiresAt]);

  const secondsToResend = otpResendAt
    ? Math.max(0, Math.ceil((otpResendAt - now) / 1000))
    : 0;
  const secondsToExpiry = otpExpiresAt
    ? Math.max(0, Math.ceil((otpExpiresAt - now) / 1000))
    : 0;

  const validation = useMemo(
    () => validateBusinessAccountForm(formData),
    [formData],
  );

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const [key, field] of Object.entries(validation)) {
      if (touched[key] && field.error) errors[key] = field.error;
    }
    if (touched.confirmation && !confirmation) {
      errors.confirmation = "Please confirm the information has been reviewed.";
    }
    return errors;
  }, [validation, touched, confirmation]);

  const fieldStatus = useMemo(() => {
    const statuses: Record<string, any> = {};
    for (const [key, field] of Object.entries(validation)) {
      if (validatingFields[key as UniqueField]) statuses[key] = "validating";
      else if (validationErrors[key] || fieldErrors[key as UniqueField])
        statuses[key] = "invalid";
      else if (field.filled && !field.error) statuses[key] = "valid";
      else statuses[key] = "idle";
    }
    return statuses;
  }, [validation, validationErrors, fieldErrors, validatingFields]);

  const fieldWarnings = useMemo(() => {
    const warnings: Record<string, string> = {};
    for (const [key, field] of Object.entries(validation)) {
      if (field.warning) warnings[key] = field.warning;
    }
    return warnings;
  }, [validation]);

  const hasUniqueConflict = Object.values(fieldErrors).some(Boolean);
  const isCheckingUnique = Object.values(validatingFields).some(Boolean);
  const documentsComplete =
    Boolean(files.aadhaarCard) &&
    Boolean(files.panCard) &&
    !Object.values(documentErrors).some(Boolean);
  const isEmailVerified = Boolean(
    verifiedEmail &&
    verifiedEmail.toLowerCase() ===
      formData.contact.email.trim().toLowerCase() &&
    verificationToken &&
    verificationExpiresAt &&
    verificationExpiresAt > now,
  );

  // When email changes after verification, reset verification
  useEffect(() => {
    const currentEmailLower = formData.contact.email.trim().toLowerCase();
    if (verifiedEmail && verifiedEmail.toLowerCase() !== currentEmailLower) {
      setVerifiedEmail(null);
      setVerificationToken(null);
      setVerificationExpiresAt(null);
      setOtpSent(false);
      setOtp("");
      setOtpError("");
      setOtpNotice("");
    }
  }, [formData.contact.email, verifiedEmail]);

  const canLeaveStep = (() => {
    if (step === 0)
      return (
        isStepValid(validation, 0) &&
        isEmailVerified &&
        !isCheckingUnique &&
        !hasUniqueConflict
      );
    if (step === 1)
      return (
        isStepValid(validation, 1) && !isCheckingUnique && !hasUniqueConflict
      );
    if (step === 2) return documentsComplete;
    if (step === 3) return true;
    return false;
  })();

  const canSubmit =
    isStepValid(validation, 0) &&
    isStepValid(validation, 1) &&
    documentsComplete &&
    confirmation &&
    isEmailVerified &&
    !hasUniqueConflict &&
    !isCheckingUnique;

  const outstandingIssues = useMemo(() => {
    if (step === 2)
      return documentsComplete
        ? []
        : ["Aadhaar Card and PAN Card Copy are required."];
    if (step === 3) {
      const issues = [0, 1].flatMap((stepIndex) =>
        getStepIssues(validation, stepIndex).map(
          (key) => `${fieldLabels[key] ?? key}: ${validation[key].error}`,
        ),
      );
      if (!documentsComplete)
        issues.push("Aadhaar Card and PAN Card Copy are required.");
      if (!confirmation)
        issues.push("Confirm the information has been reviewed.");
      if (!isEmailVerified)
        issues.push("Email: Please verify your email via OTP.");
      return issues;
    }
    const stepStarted = (stepFieldKeys[step] ?? []).some((key) => touched[key]);
    if (!stepStarted) return [];
    const base = getStepIssues(validation, step).map(
      (key) => `${fieldLabels[key] ?? key}: ${validation[key].error}`,
    );
    if (step === 0 && !isEmailVerified)
      base.push("Email verification is required to continue.");
    return base;
  }, [
    step,
    validation,
    touched,
    documentsComplete,
    confirmation,
    isEmailVerified,
  ]);

  const documentFields = useMemo(
    () => [
      {
        type: "aadhaarCard" as DocumentType,
        required: true,
        helper: "Mandatory identity document for KYC verification.",
        info: documentTooltips.aadhaarCard,
      },
      {
        type: "panCard" as DocumentType,
        required: true,
        helper: "Mandatory PAN document for KYC verification.",
        info: documentTooltips.panCard,
      },
      {
        type: "adCertificate" as DocumentType,
        required: false,
        helper: "Optional supporting AD certificate for KYC review.",
        info: documentTooltips.adCertificate,
      },
      {
        type: "msmeCertificate" as DocumentType,
        required: false,
        helper: "Optional MSME certificate, if applicable.",
        info: documentTooltips.msmeCertificate,
      },
      {
        type: "tanCertificate" as DocumentType,
        required: false,
        helper: "Optional TAN certificate, if applicable.",
        info: documentTooltips.tanCertificate,
      },
      {
        type: "gstCertificate" as DocumentType,
        required: false,
        helper: "Optional GST certificate, if applicable.",
        info: documentTooltips.gstCertificate,
      },
      {
        type: "iecCertificate" as DocumentType,
        required: false,
        helper: "Optional IEC certificate, if applicable.",
        info: documentTooltips.iecCertificate,
      },
      {
        type: "otherCertificate" as DocumentType,
        required: false,
        helper: "Optional supporting certificate or document.",
        info: documentTooltips.otherCertificate,
      },
    ],
    [],
  );

  function markTouched(...keys: string[]) {
    setTouched((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = true;
      return next;
    });
  }
  function markStepTouched(stepToReveal: number) {
    markTouched(...(stepFieldKeys[stepToReveal] ?? []));
  }

  function updateContact<Key extends keyof BusinessAccountFormData["contact"]>(
    key: Key,
    value: BusinessAccountFormData["contact"][Key],
  ) {
    if (key === "email" || key === "mobileNumber")
      setFieldErrors((c) => ({ ...c, [key]: undefined }));
    if (key === "countryCode")
      setFieldErrors((c) => ({ ...c, mobileNumber: undefined }));
    setFormData((current) => ({
      ...current,
      contact: { ...current.contact, [key]: value },
    }));
  }
  function updateCompany<Key extends keyof BusinessAccountFormData["company"]>(
    key: Key,
    value: BusinessAccountFormData["company"][Key],
  ) {
    if (key === "registrationId")
      setFieldErrors((c) => ({ ...c, registrationId: undefined }));
    if (key === "registrationCountry") {
      setFieldErrors((c) => ({ ...c, registrationId: undefined }));
      setTouched((c) => ({
        ...c,
        registrationId: false,
        secondaryRegistrationId: false,
      }));
    }
    setFormData((current) => ({
      ...current,
      company: { ...current.company, [key]: value },
    }));
  }
  function updateGstBilling<
    Key extends keyof BusinessAccountFormData["gstBilling"],
  >(key: Key, value: BusinessAccountFormData["gstBilling"][Key]) {
    setFormData((current) => ({
      ...current,
      gstBilling: { ...current.gstBilling, [key]: value },
    }));
  }

  function getUniqueFieldValue(field: UniqueField) {
    if (field === "email") return formData.contact.email.trim();
    if (field === "mobileNumber") return formData.contact.mobileNumber.trim();
    return formData.company.registrationId.trim();
  }

  async function getRecaptchaToken(
    action: string,
  ): Promise<string | undefined> {
    if (
      !RECAPTCHA_SITE_KEY ||
      typeof window === "undefined" ||
      !(window as any).grecaptcha
    )
      return undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        (window as any).grecaptcha.ready(() => {
          (window as any).grecaptcha
            .execute(RECAPTCHA_SITE_KEY, { action })
            .then(resolve, reject);
        });
      });
    } catch {
      return undefined;
    }
  }

  async function validateUniqueField(field: UniqueField): Promise<boolean> {
    const value = getUniqueFieldValue(field);
    if (!value) {
      setFieldErrors((c) => ({ ...c, [field]: undefined }));
      return true;
    }
    if (field === "email" && !isValidBusinessContactEmail(value)) {
      setFieldErrors((c) => ({ ...c, email: emailValidationMessage }));
      return false;
    }
    if (field === "mobileNumber") {
      const phoneError = getPhoneValidationError(
        formData.contact.countryCode,
        value,
      );
      if (phoneError) {
        setFieldErrors((c) => ({ ...c, mobileNumber: phoneError }));
        return false;
      }
    }
    if (field === "registrationId" && validation.registrationId?.error)
      return false;
    if (
      field === "registrationId" &&
      formData.company.registrationCountry === "United States" &&
      isUsTaxIdType(formData.company.registrationIdType ?? "") &&
      isSensitiveUsTaxIdType(formData.company.registrationIdType as UsTaxIdType)
    ) {
      setFieldErrors((c) => ({ ...c, registrationId: undefined }));
      return true;
    }
    setValidatingFields((c) => ({ ...c, [field]: true }));
    try {
      const result = await validatePublicBusinessAccountUnique({
        [field]: value,
        ...(field === "mobileNumber"
          ? { countryCode: formData.contact.countryCode.trim() }
          : {}),
        ...(field === "registrationId"
          ? { registrationIdType: formData.company.registrationIdType ?? "" }
          : {}),
      });
      if (getUniqueFieldValue(field) !== value) return true;
      const hasConflict = result.conflicts[field];
      setFieldErrors((c) => ({
        ...c,
        [field]: hasConflict ? duplicateMessages[field] : undefined,
      }));
      return !hasConflict;
    } catch {
      setFieldErrors((c) => ({
        ...c,
        [field]: "Unable to validate this value right now.",
      }));
      return false;
    } finally {
      setValidatingFields((c) => ({ ...c, [field]: false }));
    }
  }

  async function validateStepUniqueFields(
    stepToValidate: number,
  ): Promise<boolean> {
    const fields: UniqueField[] =
      stepToValidate === 0
        ? ["email", "mobileNumber"]
        : stepToValidate === 1
          ? formData.company.registrationId.trim()
            ? ["registrationId"]
            : []
          : [];
    if (!fields.length) return true;
    const results = await Promise.all(
      fields.map((field) => validateUniqueField(field)),
    );
    const isValid = results.every(Boolean);
    if (!isValid)
      setError(
        "Please fix the highlighted duplicate fields before continuing.",
      );
    return isValid;
  }

  function handleDocumentChange(type: DocumentType, file: File | null) {
    if (!file) {
      setFiles((c) => ({ ...c, [type]: null }));
      setDocumentErrors((c) => ({ ...c, [type]: undefined }));
      return;
    }
    const fileError = getDocumentFileError(file);
    if (fileError) {
      setFiles((c) => ({ ...c, [type]: null }));
      setDocumentErrors((c) => ({ ...c, [type]: fileError }));
      return;
    }
    setFiles((c) => ({ ...c, [type]: file }));
    setDocumentErrors((c) => ({ ...c, [type]: undefined }));
  }

  function getDocumentValidationErrors() {
    const nextErrors: Partial<Record<DocumentType, string>> = {
      ...documentErrors,
    };
    if (!files.aadhaarCard)
      nextErrors.aadhaarCard = "Aadhaar Card is required.";
    if (!files.panCard) nextErrors.panCard = "PAN Card Copy is required.";
    return nextErrors;
  }

  async function validateStep(stepToValidate: number) {
    setError("");
    if (stepToValidate === 2) {
      const nextDocumentErrors = getDocumentValidationErrors();
      setDocumentErrors(nextDocumentErrors);
      if (Object.values(nextDocumentErrors).some(Boolean)) {
        setError(
          "Please fix the highlighted document issues before continuing.",
        );
        return false;
      }
      return true;
    }
    if (stepToValidate === 3) {
      markTouched("confirmation");
      if (!confirmation) {
        setError("Please confirm the information has been reviewed.");
        return false;
      }
      if (!isEmailVerified) {
        setError("Please verify your email before submitting.");
        return false;
      }
      return true;
    }
    markStepTouched(stepToValidate);
    if (!isStepValid(validation, stepToValidate)) {
      setError("Please fill the highlighted fields before continuing.");
      return false;
    }
    if (stepToValidate === 0 && !isEmailVerified) {
      setError("Please verify your email to continue.");
      return false;
    }
    return validateStepUniqueFields(stepToValidate);
  }

  async function handleSendOtp() {
    setOtpError("");
    setOtpNotice("");
    const emailRaw = formData.contact.email.trim();
    if (!isValidBusinessContactEmail(emailRaw)) {
      setOtpError(emailValidationMessage);
      return;
    }
    // Block OTP if email already taken â€” don't spam inbox for an account that can't be created
    const uniqueOk = await validateUniqueField("email");
    if (!uniqueOk) {
      setOtpError(fieldErrors.email || duplicateMessages.email);
      // ensure field shows invalid state
      markTouched("email");
      return;
    }
    if (fieldErrors.email) {
      setOtpError(fieldErrors.email);
      return;
    }
    setSendingOtp(true);
    try {
      const recaptchaToken = await getRecaptchaToken(
        "public_business_account_email_otp",
      );
      const result = await requestPublicEmailOtp({
        email: emailRaw,
        recaptchaToken,
      });
      const issuedAt = Date.now();
      setNow(issuedAt);
      setOtpExpiresAt(issuedAt + result.expiresInSeconds * 1000);
      setOtpResendAt(issuedAt + result.resendInSeconds * 1000);
      setOtpSent(true);
      setOtp("");
      setOtpNotice(result.message || "Verification code sent to your email.");
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : "Unable to send verification code.";
      // 409 from backend means live account exists â€” surface as field error too
      if (msg.toLowerCase().includes("already exists")) {
        setFieldErrors((c) => ({ ...c, email: duplicateMessages.email }));
      }
      setOtpError(msg);
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleVerifyOtp(codeOverride?: string) {
    const codeToVerify = codeOverride ?? otp;
    if (codeToVerify.length !== 6) {
      setOtpError("Enter the 6-digit code.");
      return;
    }
    setVerifyingOtp(true);
    setOtpError("");
    try {
      const recaptchaToken = await getRecaptchaToken(
        "public_business_account_verify",
      );
      const result = await verifyPublicEmailOtp({
        email: formData.contact.email.trim(),
        code: codeToVerify,
        recaptchaToken,
      });
      setVerifiedEmail(result.verifiedEmail);
      setVerificationToken(result.verificationToken);
      setVerificationExpiresAt(Date.now() + result.expiresInSeconds * 1000);
      setOtpNotice("Email verified successfully.");
      setOtpError("");
      // mark email field as touched to show valid tick
      markTouched("email");
    } catch (caught) {
      setOtpError(
        caught instanceof Error
          ? caught.message
          : "Invalid code. Please try again.",
      );
    } finally {
      setVerifyingOtp(false);
    }
  }

  async function submitForReview() {
    for (const stepToValidate of [0, 1, 2, 3]) {
      if (!(await validateStep(stepToValidate))) {
        setStep(stepToValidate);
        return;
      }
    }
    if (!verificationToken || !isEmailVerified) {
      setError("Please verify your email before submitting.");
      setStep(0);
      return;
    }
    setSaving(true);
    try {
      idempotencyKeyRef.current ||= createPublicIdempotencyKey();
      const recaptchaToken = await getRecaptchaToken(
        "public_business_account_submit",
      );
      const result = await createPublicBusinessAccount(
        formData,
        files,
        verificationToken,
        recaptchaToken,
        idempotencyKeyRef.current,
      );
      setSuccess({
        accountId: result.account.accountId,
        companyName:
          result.account.company.companyName || formData.company.companyName,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to submit business account request.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(await validateStep(step))) return;
    setStep((current) => Math.min(current + 1, 3));
  }

  async function handleStepNavigation(nextStep: number) {
    if (nextStep <= step) {
      setStep(nextStep);
      return;
    }
    for (
      let stepToValidate = step;
      stepToValidate < nextStep;
      stepToValidate += 1
    ) {
      if (!(await validateStep(stepToValidate))) {
        setStep(stepToValidate);
        return;
      }
    }
    setStep(nextStep);
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(PUBLIC_DRAFT_KEY);
    } catch {}
    void clearFilesFromStorage();
    setFormData(defaultFormData);
    setStep(0);
    setTouched({});
    setVerifiedEmail(null);
    setVerificationToken(null);
    setVerificationExpiresAt(null);
    setOtpSent(false);
    setOtp("");
    setOtpError("");
    setOtpNotice("");
    setFiles({});
    setFieldErrors({});
    setDocumentErrors({});
    setError("");
    setConfirmation(false);
  }

  const stateOptions = useMemo(() => {
    const options = states.map((state) => ({
      value: state.name,
      label: state.name,
    }));
    if (
      selectedState &&
      !states.some((state) => state.name === selectedState)
    ) {
      return [
        ...options,
        { value: selectedState, label: `${selectedState} (current)` },
      ];
    }
    return options;
  }, [states, selectedState]);
  const cityOptions =
    wantedCitiesKey && citiesKey === wantedCitiesKey ? cities : [];
  const billingStateOptions = useMemo(() => {
    if (billingStatesCountry !== billingAddress.country) return [];
    const options = billingStates.map((state) => ({
      value: state.name,
      label: state.name,
    }));
    const stored = billingAddress.stateOrProvince;
    if (stored && !billingStates.some((state) => state.name === stored)) {
      return [...options, { value: stored, label: `${stored} (current)` }];
    }
    return options;
  }, [
    billingStates,
    billingStatesCountry,
    billingAddress.country,
    billingAddress.stateOrProvince,
  ]);
  const billingCityOptions =
    wantedBillingCitiesKey && billingCitiesKey === wantedBillingCitiesKey
      ? billingCities
      : [];
  function updateBillingAddress(patch: Partial<typeof billingAddress>) {
    updateCompany("billingAddress", { ...billingAddress, ...patch });
  }
  function applyLookupToBillingAddress(address: any) {
    const country = billingAddress.country || selectedAddressCountry;
    updateBillingAddress({
      addressLine1: address.addressLine1 || billingAddress.addressLine1,
      postalCode: address.postalCode,
      stateOrProvince: matchStateName(billingStates, address.state),
      city: address.city,
      country,
    });
    markTouched(
      "billingAddressLine1",
      "billingPostalCode",
      "billingState",
      "billingCity",
    );
  }
  function applyLookupToCompanyAddress(address: any) {
    updateCompany(
      "registeredAddress",
      address.addressLine1 || formData.company.registeredAddress,
    );
    updateCompany("postalCode", address.postalCode);
    const matchedState = matchStateName(states, address.state);
    updateCompany("stateOrProvince", matchedState);
    updateCompany("city", address.city);
    markTouched("registeredAddress", "postalCode", "stateOrProvince", "city");
  }
  function handleRegistrationCountryChange(country: string) {
    const nextConfig = registrationConfig[country];
    const countryCurrencyMap: Record<string, string> = {
      India: "INR",
      "United States": "USD",
      "United Kingdom": "GBP",
      France: "EUR",
      Netherlands: "EUR",
      Kuwait: "KWD",
      Canada: "CAD",
      Switzerland: "CHF",
      Poland: "EUR",
    };
    updateCompany("registrationCountry", country);
    updateCompany(
      "registrationIdType",
      country === "Canada"
        ? "business_number"
        : country === "United States"
          ? defaultUsTaxIdType(formData.company.noCompany)
          : (nextConfig?.primaryTypeValue ?? ""),
    );
    updateCompany("registrationId", "");
    updateCompany("secondaryRegistrationId", "");
    updateCompany("noCompanyRegistration", false);
    updateCompany("gstin", "");
    updateCompany("gstExempt", false);
    updateCompany("gstExemptReason", "");
    updateCompany("operatingCountries", [country]);
    updateCompany("addressCountry", country);
    updateCompany(
      "requestedCreditCurrency",
      countryCurrencyMap[country] ?? "INR",
    );
  }

  if (success) {
    return (
      <>
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-xl border border-[#C7DADD] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
            <div className="border-t-4 border-t-[#FF0000] bg-[#DFF1F1] px-8 py-10 text-slate-950 sm:px-10 sm:py-12">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-white text-[#0D1282] ring-1 ring-[#C7DADD]">
                <FiCheckCircle className="h-7 w-7" />
              </div>
              <h1 className="mt-6 text-center text-2xl font-bold tracking-tight sm:text-3xl">
                Request submitted
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-6 text-slate-600 sm:text-[15px]">
                Your business account request is now under review. Our team will
                verify your details and documents and notify you by email.
              </p>
            </div>
            <div className="px-6 py-8 sm:px-10">
              <div className="rounded-lg border border-[#C7DADD] bg-[#F7FAFA] px-5 py-5 sm:px-6">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Your reference
                </p>
                <p className="mt-2 text-lg font-bold text-slate-900">
                  {success.accountId}
                </p>
                {success.companyName ? (
                  <p className="mt-1 text-sm font-medium text-slate-600">
                    {success.companyName}
                  </p>
                ) : null}
                <p className="mt-4 text-xs leading-5 text-slate-500">
                  Keep this reference for follow-ups. If we need more
                  information, we’ll contact you at{" "}
                  <span className="font-semibold text-slate-700">
                    {formData.contact.email}
                  </span>
                  .
                </p>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <FiArrowLeft className="h-4 w-4" /> Back to home
                </Link>
                <a
                  href="https://swiftlinefreight.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#0D1282] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0A0F6D]"
                >
                  Visit Swiftline <FiArrowRight className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-6 text-center text-xs text-slate-400">
                Need help?{" "}
                <a
                  href="mailto:Info@swiftlinefreight.com"
                  className="font-semibold text-[#0D1282] hover:text-[#FF0000] hover:underline"
                >
                  Info@swiftlinefreight.com
                </a>{" "}
                ·{" "}
                <a
                  href="tel:+917027116600"
                  className="font-semibold text-[#0D1282] hover:text-[#FF0000] hover:underline"
                >
                  +91 70271 16600
                </a>
              </p>
            </div>
          </div>
        </main>
        {RECAPTCHA_SITE_KEY ? (
          <Script
            src={`https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`}
            strategy="afterInteractive"
          />
        ) : null}
      </>
    );
  }

  // UI copy used by the step header and the responsive progress trackers.
  const stepsMeta = [
    {
      icon: FiUsers,
      label: "Contact",
      desc: "Contact & verification",
      summary:
        "Add the primary contact, verify the work email and tell us what you normally ship.",
    },
    {
      icon: FiBriefcase,
      label: "Company",
      desc: "Registration & billing",
      summary:
        "Provide registration, company address, billing details and the business profile used for account review.",
    },
    {
      icon: FiFileText,
      label: "Documents",
      desc: "KYC & certificates",
      summary:
        "Upload the required KYC documents and any supporting certificates that apply to your business.",
    },
    {
      icon: FiShield,
      label: "Review",
      desc: "Check & submit",
      summary:
        "Confirm the contact, company and document details before submitting the application for approval.",
    },
  ];

  return (
    <>
      {/* Page content theme */}
      <div className="bg-[#F4F7F7]">
        <div className="mx-auto w-full max-w-[1450px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start xl:grid-cols-[350px_minmax(0,1fr)] xl:gap-8 2xl:grid-cols-[390px_minmax(0,952px)] 2xl:justify-center">
          {/* Desktop business account hero */}
          <aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
            <div className="flex h-[720px] flex-col overflow-hidden rounded-xl border border-[#C7DADD] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)] xl:h-[760px]">
              {/* Hero illustration */}
              <div className="relative flex h-[270px] shrink-0 items-center justify-center border-b border-[#C7DADD] bg-[#DFF1F1] px-4 py-5 xl:h-[300px]">
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-[#FF0000]" />
                <img
                  src="https://www.dhl.com/discover/content/dam/icons-and-logos/Group%207753.svg"
                  alt="Business logistics"
                  className="h-full w-full max-w-[330px] object-contain"
                />
              </div>

              {/* Hero copy */}
              <div className="flex min-h-0 flex-1 flex-col bg-white px-6 py-6 xl:px-7 xl:py-7">
                <p className="text-xs font-semibold text-[#0D1282]">
                  Swiftline Business Account
                </p>

                <h1 className="mt-2 text-[26px] font-bold leading-[1.18] tracking-[-0.025em] text-slate-950 xl:text-[28px]">
                  Create your business account
                </h1>

                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Set up your account for business shipping, billing and account support. Complete the application and submit your KYC details for review.
                </p>

                {/* Application essentials */}
                <div className="mt-6 divide-y divide-[#D6E5E7] border-y border-[#D6E5E7]">
                  <div className="flex items-center gap-3 py-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#DFF1F1] text-[#0D1282]">
                      <FiClock className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-500">Estimated time</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">About 10 minutes</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 py-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#DFF1F1] text-[#0D1282]">
                      <FiFileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-500">Keep ready</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">Aadhaar and PAN documents</p>
                    </div>
                  </div>
                </div>

              
              </div>
            </div>
          </aside>

          {/* Right application workspace */}
          <div
            className={`min-w-0 w-full rounded-xl border border-[#C7DADD] border-t-2 bg-[#F3F2EC] p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] xl:max-w-[952px] xl:p-5 2xl:max-w-none ${
              step === 2
                ? "lg:flex lg:h-[720px] lg:flex-col xl:h-[760px]"
                : ""
            }`}
          >
            {/* Mobile / tablet step timeline */}
            {/* <nav
              aria-label="Application progress"
              className="rounded-lg border border-[#C7DADD] bg-white px-4 py-3 lg:hidden"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-600">
                    Step {step + 1} of 4
                  </p>
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {businessAccountSteps[step]}
                  </p>
                </div>
                <span className="text-xs font-semibold text-slate-700">
                  {Math.round(((step + 1) / 4) * 100)}%
                </span>
              </div>

              <div className="relative flex items-start">
                <span
                  aria-hidden="true"
                  className="absolute left-4 right-4 top-4 h-px bg-slate-200"
                />
                {stepsMeta.map((s, idx) => {
                  const isActive = step === idx;
                  const isDone = idx < step;

                  return (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => void handleStepNavigation(idx)}
                      className="relative z-10 flex min-w-0 flex-1 flex-col items-center gap-1.5 px-1 text-center"
                    >
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold ${
                          isDone
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : isActive
                              ? "border-[#0D1282] bg-[#0D1282] text-white"
                              : "border-slate-200 bg-white text-slate-500"
                        }`}
                      >
                        {isDone ? <FiCheck className="h-3.5 w-3.5" /> : idx + 1}
                      </span>
                      <span
                        className={`hidden truncate text-[11px] font-semibold sm:block sm:text-xs ${
                          isActive ? "text-[#0D1282]" : "text-slate-500"
                        }`}
                      >
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </nav> */}

            <main
              className={`mt-4 lg:mt-0 ${
                step === 2 ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" : ""
              }`}
            >
              {error ? (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-[#FF0000]">
                  <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{" "}
                  <span>{error}</span>
                </div>
              ) : null}

              {/* Current step heading */}
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#0D1282]">
                    Step {step + 1} of 4
                  </p>
                  <h2 className="mt-0.5 text-xl font-bold tracking-[-0.02em] text-slate-950 sm:text-[22px]">
                    {businessAccountSteps[step]}
                  </h2>
                  <p className="mt-1 mb-6 max-w-2xl text-sm leading-5 text-slate-600">
                    {stepsMeta[step].summary}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                    <FiCheckCircle className="h-4 w-4" /> Saved
                  </span>
                  <span className="h-3.5 w-px bg-slate-300" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={clearDraft}
                    className="font-semibold text-slate-500 transition hover:text-[#0D1282]"
                    title="Clear saved draft"
                  >
                    Clear draft
                  </button>
                </div>
              </div>

              {/* Public application form */}
              <form
                noValidate
                onSubmit={handleContinue}
                className={`public-business-form overflow-hidden rounded-lg  ${
                  step === 2
                    ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
                    : ""
                }`}
              >
                {step === 2 ? (
                  <div className="flex shrink-0 items-center gap-2 border-b border-[#C7DADD] bg-[#F1F8F8] px-5 py-2.5 text-xs text-slate-500 sm:px-6">
                    <FiClock className="h-3.5 w-3.5 shrink-0 text-[#0D1282]" />
                    Uploaded files are kept temporarily on this device while you complete the application.
                  </div>
                ) : null}

                <div
                  className={`bg-white px-3 py-5 sm:px-8 sm:py-6 ${
                    step === 2
                      ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
                      : ""
                  }`}
                >
                  {/* Step 1: contact details */}
                  {step === 0 ? (
                    <div className="space-y-5">
                      {/* Contact name */}
                      <div className="grid gap-4 md:grid-cols-3">
                        <SearchableSelect
                          label="Title"
                          value={formData.contact.title}
                          onChange={(value) => {
                            markTouched("title");
                            updateContact(
                              "title",
                              value as BusinessAccountFormData["contact"]["title"],
                            );
                          }}
                          options={titleOptions}
                          error={validationErrors.title}
                          status={fieldStatus.title}
                          required
                        />
                        <Field
                          label="First Name"
                          value={formData.contact.firstName}
                          onChange={(v) => updateContact("firstName", v)}
                          onBlur={() => markTouched("firstName")}
                          error={validationErrors.firstName}
                          status={fieldStatus.firstName}
                          maxLength={22}
                          required
                        />
                        <Field
                          label="Last Name"
                          value={formData.contact.lastName}
                          onChange={(v) => updateContact("lastName", v)}
                          onBlur={() => markTouched("lastName")}
                          error={validationErrors.lastName}
                          status={fieldStatus.lastName}
                          maxLength={22}
                          required
                        />
                      </div>
                      {/* Work email and OTP verification */}
                      <div className="rounded-lg border border-[#C7DADD] bg-[#F7FAFA] p-4 sm:p-5">
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-start">
                          <div className="min-w-0">
                            <Field
                              label="Email Address"
                              type="email"
                              value={formData.contact.email}
                              onChange={(value) =>
                                updateContact("email", value)
                              }
                              onBlur={() => {
                                markTouched("email");
                                void validateUniqueField("email");
                              }}
                              error={
                                validationErrors.email || fieldErrors.email
                              }
                              status={fieldStatus.email}
                              placeholder="name@company.com"
                              helper={
                                validatingFields.email
                                  ? "Checking email..."
                                  : undefined
                              }
                              required
                            />
                          </div>

                          <div className="sm:pt-[1.375rem]">
                            <button
                              type="button"
                              onClick={() => void handleSendOtp()}
                              disabled={
                                sendingOtp ||
                                isEmailVerified ||
                                !isValidBusinessContactEmail(
                                  formData.contact.email.trim(),
                                )
                              }
                              className={`inline-flex h-13 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed ${
                                isEmailVerified
                                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "bg-[#0D1282] text-white hover:bg-[#0A0F6D] disabled:bg-slate-300"
                              }`}
                            >
                              {sendingOtp ? (
                                <>
                                  <FiLoader className="h-4 w-4 animate-spin" />
                                  Sending…
                                </>
                              ) : isEmailVerified ? (
                                <>
                                  <FiCheckCircle className="h-4 w-4" />
                                  Verified
                                </>
                              ) : otpSent ? (
                                "Resend code"
                              ) : (
                                "Send verification code"
                              )}
                            </button>
                          </div>
                        </div>

                        {otpError && !(validationErrors.email || fieldErrors.email) ? (
                          <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-xs font-medium text-[#FF0000]">
                            <FiAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {otpError}
                          </p>
                        ) : null}

                        {otpNotice && !otpError && !isEmailVerified ? (
                          <p className="mt-3 text-xs font-medium text-emerald-700">
                            {otpNotice}
                          </p>
                        ) : null}

                        {otpSent && !isEmailVerified ? (
                          <div className="mt-4 border-t border-[#BBD5DA] pt-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">
                                Enter the 6-digit code
                              </p>
                              <span className="text-xs text-slate-500">
                                {secondsToExpiry > 0
                                  ? `Expires in ${formatCountdown(secondsToExpiry)}`
                                  : "Code expired - request a new one"}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-xs text-slate-500">
                              Sent to {formData.contact.email.trim()}
                            </p>

                            <div className="mt-3">
                              <OtpCodeInput
                                label="Verification code"
                                value={otp}
                                onChange={setOtp}
                                onComplete={(c) => void handleVerifyOtp(c)}
                                disabled={verifyingOtp}
                                invalid={Boolean(otpError)}
                              />
                            </div>

                            <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                              <button
                                type="button"
                                disabled={secondsToResend > 0 || sendingOtp}
                                onClick={() => void handleSendOtp()}
                                className="text-xs font-semibold text-slate-700 transition hover:underline disabled:text-slate-400"
                              >
                                {secondsToResend > 0
                                  ? `Resend in ${secondsToResend}s`
                                  : "Resend code"}
                              </button>

                              <button
                                type="button"
                                disabled={verifyingOtp || otp.length !== 6}
                                onClick={() => void handleVerifyOtp()}
                                className="inline-flex items-center justify-center rounded-lg bg-[#0D1282] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0A0F6D] disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                {verifyingOtp ? "Verifying…" : "Verify email"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {/* Phone details */}
                      <div className="grid gap-4 md:grid-cols-3">
                        <SearchableSelect
                          label="Phone Type"
                          value={formData.contact.mobileType}
                          onChange={(value) => {
                            markTouched("mobileType");
                            updateContact("mobileType", value as any);
                          }}
                          options={mobileTypeOptions}
                          error={validationErrors.mobileType}
                          status={fieldStatus.mobileType}
                          required
                        />
                        <CountryCodeField
                          value={formData.contact.countryCode}
                          onChange={(v) => updateContact("countryCode", v)}
                          error={validationErrors.countryCode}
                          required
                        />
                        <Field
                          label="Mobile Number"
                          value={formData.contact.mobileNumber}
                          onChange={(v) => updateContact("mobileNumber", v)}
                          onBlur={() => {
                            markTouched("mobileNumber");
                            void validateUniqueField("mobileNumber");
                          }}
                          error={
                            validationErrors.mobileNumber ||
                            fieldErrors.mobileNumber
                          }
                          status={fieldStatus.mobileNumber}
                          placeholder="Without country code"
                          helper={
                            validatingFields.mobileNumber
                              ? "Checking…"
                              : undefined
                          }
                          required
                        />
                      </div>

                      {/* Role, department and shipment preference */}
                      <div className="grid gap-4 md:grid-cols-3 md:items-start">
                        <div className="grid gap-3">
                          <SearchableSelect
                            label="Job Title"
                            value={
                              showsOtherJobTitle
                                ? OTHER_JOB_TITLE
                                : formData.contact.jobTitle
                            }
                            onChange={(next) => {
                              if (next === OTHER_JOB_TITLE) {
                                setOtherPicked(true);
                                updateContact("jobTitle", "");
                                return;
                              }
                              markTouched("jobTitle");
                              setOtherPicked(false);
                              updateContact("jobTitle", next);
                            }}
                            options={jobTitleOptions}
                            error={
                              showsOtherJobTitle
                                ? undefined
                                : validationErrors.jobTitle
                            }
                            status={
                              showsOtherJobTitle ? "idle" : fieldStatus.jobTitle
                            }
                            required
                          />
                          {showsOtherJobTitle ? (
                            <Field
                              label="Job Title (Manual Entry)"
                              value={formData.contact.jobTitle}
                              onChange={(v) => updateContact("jobTitle", v)}
                              onBlur={() => markTouched("jobTitle")}
                              error={validationErrors.jobTitle}
                              status={fieldStatus.jobTitle}
                              placeholder="e.g. Regional Logistics Head"
                              maxLength={80}
                              required
                            />
                          ) : null}
                        </div>
                        <SearchableSelect
                          label="Department"
                          value={formData.contact.department}
                          onChange={(value) => {
                            markTouched("department");
                            updateContact("department", value);
                          }}
                          options={toOptions(departments)}
                          error={validationErrors.department}
                          status={fieldStatus.department}
                          required
                        />
                        <SearchableSelect
                          label="Shipment Type"
                          value={formData.contact.shipmentTypes[0] ?? ""}
                          onChange={(value) => {
                            markTouched("shipmentTypes");
                            updateContact("shipmentTypes", [value] as any);
                          }}
                          options={shipmentTypeOptions}
                          error={validationErrors.shipmentTypes}
                          status={fieldStatus.shipmentTypes}
                          required
                        />
                      </div>
                    </div>
                  ) : null}

                  {/* Step 2: company details */}
                  {step === 1 ? (
                    <div className="space-y-6">
                      {/* Registration details */}
                      <section className="border-b border-[#BBD5DA] pb-6">
                        <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                          Company registration{" "}
                          <InfoTooltip text={sectionTooltips.registration} />
                        </h3>
                        <div className="mt-4">
                          <CountryRegistrationSelect
                            label="Country of Registration"
                            value={formData.company.registrationCountry}
                            onChange={handleRegistrationCountryChange}
                            error={validationErrors.registrationCountry}
                            required
                          />
                        </div>

                        {showsRegistrationField ? (
                          <div
                            className={
                              registrationTypeOptions
                                ? "mt-4 grid gap-4 md:grid-cols-2"
                                : "mt-4 grid gap-4"
                            }
                          >
                            {registrationTypeOptions ? (
                              <SearchableSelect
                                label={
                                  isUnitedStates
                                    ? "Tax ID Type"
                                    : "Registration ID Type"
                                }
                                value={selectedRegistrationType}
                                onChange={(value) => {
                                  updateCompany("registrationIdType", value);
                                  updateCompany("registrationId", "");
                                }}
                                options={registrationTypeOptions}
                                error={validationErrors.registrationIdType}
                                disabled={
                                  isUnitedStates ? false : noCompanyChecked
                                }
                                required={
                                  isUnitedStates ||
                                  (!noRegistrationChecked && !noCompanyChecked)
                                }
                              />
                            ) : null}
                            <Field
                              label={
                                registrationTypeOptions
                                  ? isUnitedStates
                                    ? usTaxIdLabels[usTaxIdType]
                                    : (registrationTypeOptions.find(
                                        (o) =>
                                          o.value === selectedRegistrationType,
                                      )?.label ?? "Registration ID")
                                  : (selectedRegistrationConfig?.primaryLabel ??
                                    "Registration ID")
                              }
                              value={formData.company.registrationId}
                              onChange={(value) =>
                                updateCompany(
                                  "registrationId",
                                  isUnitedStates
                                    ? isMaskedUsTaxId(value)
                                      ? value
                                      : formatUsTaxId(value, usTaxIdType)
                                    : value.toUpperCase(),
                                )
                              }
                              onBlur={() => {
                                markTouched("registrationId");
                                void validateUniqueField("registrationId");
                              }}
                              error={
                                validationErrors.registrationId ||
                                fieldErrors.registrationId
                              }
                              warning={fieldWarnings.registrationId}
                              status={fieldStatus.registrationId}
                              placeholder={
                                isUnitedStates
                                  ? `e.g. ${usTaxIdExamples[usTaxIdType]}`
                                  : undefined
                              }
                              helper={
                                validatingFields.registrationId
                                  ? "Checking…"
                                  : undefined
                              }
                              maxLength={primaryRegistrationRule?.maxLength}
                              disabled={
                                isUnitedStates
                                  ? false
                                  : noRegistrationChecked || noCompanyChecked
                              }
                              required={
                                isUnitedStates ||
                                (!noRegistrationChecked && !noCompanyChecked)
                              }
                            />
                            {requiresSecondaryRegistration ? (
                              <Field
                                label={
                                  selectedRegistrationConfig.secondaryLabel ??
                                  "Additional Registration Code"
                                }
                                value={
                                  formData.company.secondaryRegistrationId ?? ""
                                }
                                onChange={(v) =>
                                  updateCompany(
                                    "secondaryRegistrationId",
                                    v.toUpperCase(),
                                  )
                                }
                                onBlur={() =>
                                  markTouched("secondaryRegistrationId")
                                }
                                error={validationErrors.secondaryRegistrationId}
                                status={fieldStatus.secondaryRegistrationId}
                                disabled={
                                  noRegistrationChecked || noCompanyChecked
                                }
                                maxLength={secondaryRegistrationRule?.maxLength}
                                required={
                                  !noRegistrationChecked && !noCompanyChecked
                                }
                              />
                            ) : null}
                          </div>
                        ) : null}

                        {isUnitedStates ? null : (
                          <div className="mt-4">
                            <CheckboxField
                              label="I don't have a company registration no. for this country"
                              checked={noRegistrationChecked}
                              onChange={(checked) => {
                                updateCompany("noCompanyRegistration", checked);
                                if (checked) {
                                  updateCompany("registrationId", "");
                                  updateCompany("secondaryRegistrationId", "");
                                }
                              }}
                            />
                          </div>
                        )}
                        {noRegistrationChecked ? (
                          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
                            We will not be able to process your account number
                            creation immediately without the registration
                            number. Please enter your company details manually
                            and submit your request.
                          </p>
                        ) : null}
                      </section>

                      {/* Company identity */}
                      <section>
                        <h3 className="text-sm font-bold text-slate-900">
                          Company details
                        </h3>
                        <div className="mt-4">
                          <CheckboxField
                            label="I don't have any company"
                            checked={noCompanyChecked}
                            onChange={(checked) => {
                              updateCompany("noCompany", checked);
                              if (checked) {
                                updateCompany("noCompanyRegistration", true);
                                updateCompany("registrationId", "");
                                updateCompany("secondaryRegistrationId", "");
                              }
                              if (isUnitedStates) {
                                updateCompany(
                                  "registrationIdType",
                                  defaultUsTaxIdType(checked),
                                );
                                updateCompany("registrationId", "");
                              }
                            }}
                          />
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-2 md:items-start">
                          <Field
                            label="Company Name"
                            value={formData.company.companyName}
                            onChange={(v) => updateCompany("companyName", v)}
                            onBlur={() => markTouched("companyName")}
                            error={validationErrors.companyName}
                            status={fieldStatus.companyName}
                            disabled={noCompanyChecked}
                            required={!noCompanyChecked}
                          />
                          <SearchableSelect
                            label="Company Type"
                            value={formData.company.companyType}
                            onChange={(value) => {
                              markTouched("companyType");
                              updateCompany("companyType", value);
                            }}
                            options={companyTypeOptions}
                            error={validationErrors.companyType}
                            status={fieldStatus.companyType}
                            disabled={noCompanyChecked}
                            required={!noCompanyChecked}
                          />
                        </div>

                        {collectsGst ? (
                          <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5">
                            <Field
                              label="GSTIN"
                              value={formData.company.gstin ?? ""}
                              onChange={(v) =>
                                updateCompany("gstin", normalizeGstin(v))
                              }
                              onBlur={() => markTouched("gstin")}
                              error={validationErrors.gstin}
                              warning={fieldWarnings.gstin}
                              status={fieldStatus.gstin}
                              placeholder={`e.g. ${GSTIN_EXAMPLE}`}
                              helper={
                                gstinStateName
                                  ? `State code ${(formData.company.gstin ?? "").slice(0, 2)} - ${gstinStateName}`
                                  : undefined
                              }
                              disabled={noCompanyChecked || gstExemptChecked}
                              maxLength={GSTIN_LENGTH}
                              required={!gstExemptChecked}
                            />
                            <CheckboxField
                              label="GST Exempt / Not Registered"
                              checked={gstExemptChecked}
                              disabled={noCompanyChecked}
                              onChange={(checked) => {
                                updateCompany("gstExempt", checked);
                                if (checked) updateCompany("gstin", "");
                                else updateCompany("gstExemptReason", "");
                              }}
                            />
                            {gstExemptChecked ? (
                              <Field
                                label="Reason for GST Exemption"
                                value={formData.company.gstExemptReason ?? ""}
                                onChange={(v) =>
                                  updateCompany("gstExemptReason", v)
                                }
                                onBlur={() => markTouched("gstExemptReason")}
                                error={validationErrors.gstExemptReason}
                                status={fieldStatus.gstExemptReason}
                                placeholder="e.g. Turnover below threshold"
                                maxLength={300}
                                required
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </section>

                      {/* GST treatment + address */}
                      <section className="border-b border-[#BBD5DA] pb-6">
                        {/* <h4 className="text-sm font-bold text-slate-900">
                          Shipment billing
                        </h4> */}
                        <div className="mt-3 grid gap-4 md:grid-cols-2 md:items-start">
                       <div>
  <label
    htmlFor="gst-billing-treatment"
    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600"
  >
    GST treatment{" "}
    <span className="normal-case text-slate-400">
      - billed with GST unless approved
    </span>
  </label>

  <div className="relative">
    <select
      id="gst-billing-treatment"
      value={formData.gstBilling.requestedTreatment}
      onChange={(e) => {
        const value =
          e.target
            .value as BusinessAccountFormData["gstBilling"]["requestedTreatment"];

        updateGstBilling("requestedTreatment", value);

        if (value === "GST_APPLICABLE") {
          updateGstBilling("requestReason", "");
        }
      }}
      className="block h-13 w-full appearance-none rounded-lg border border-[#BBD5DA] bg-[#F5F5F5] py-2 pl-3.5 pr-11 text-sm text-slate-900 outline-none transition focus:border-[#FF0000] focus:ring-2 focus:ring-[#FF0000]/10"
    >
      <option value="GST_APPLICABLE">GST applicable</option>
      <option value="NO_GST">No GST requested</option>
    </select>

    <FiChevronDown
      aria-hidden="true"
      className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
    />
  </div>
</div>
                          {formData.gstBilling.requestedTreatment ===
                          "NO_GST" ? (
                            <Field
                              label="Reason for no-GST billing"
                              value={formData.gstBilling.requestReason}
                              onChange={(v) =>
                                updateGstBilling("requestReason", v)
                              }
                              onBlur={() =>
                                markTouched("gstBillingRequestReason")
                              }
                              error={validationErrors.gstBillingRequestReason}
                              status={fieldStatus.gstBillingRequestReason}
                              maxLength={500}
                              required
                            />
                          ) : null}
                        </div>
                      </section>

                      <section>
                        <div className="grid gap-4 md:grid-cols-2 md:items-start">
                          {/* Registered company address */}
                          <div className="md:col-span-2">
                            <AddressAutocompleteField
                              label="Company Address"
                              value={formData.company.registeredAddress}
                              countryName={selectedAddressCountry}
                              onChange={(v) =>
                                updateCompany("registeredAddress", v)
                              }
                              onBlur={() => markTouched("registeredAddress")}
                              onAddressSelected={applyLookupToCompanyAddress}
                              error={validationErrors.registeredAddress}
                              status={fieldStatus.registeredAddress}
                              disabled={noCompanyChecked}
                              required={!noCompanyChecked}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Field
                              label="Address Line 2"
                              value={formData.company.addressLine2 ?? ""}
                              onChange={(v) => updateCompany("addressLine2", v)}
                              onBlur={() => markTouched("addressLine2")}
                              error={validationErrors.addressLine2}
                              status={fieldStatus.addressLine2}
                              placeholder="Building, floor, unit or landmark"
                              maxLength={200}
                              disabled={noCompanyChecked}
                            />
                          </div>
                          {stateOptions.length ? (
                            <SearchableSelect
                              label="State or Province"
                              value={formData.company.stateOrProvince}
                              onChange={(value) => {
                                markTouched("stateOrProvince");
                                updateCompany("stateOrProvince", value);
                                updateCompany("city", "");
                              }}
                              options={stateOptions}
                              error={validationErrors.stateOrProvince}
                              status={fieldStatus.stateOrProvince}
                              disabled={noCompanyChecked}
                              required={!noCompanyChecked}
                            />
                          ) : (
                            <Field
                              label="State or Province"
                              value={formData.company.stateOrProvince}
                              onChange={(v) =>
                                updateCompany("stateOrProvince", v)
                              }
                              onBlur={() => markTouched("stateOrProvince")}
                              error={validationErrors.stateOrProvince}
                              status={fieldStatus.stateOrProvince}
                              disabled={noCompanyChecked}
                              required={!noCompanyChecked}
                            />
                          )}
                          <ComboBoxField
                            label="City"
                            value={formData.company.city}
                            onChange={(v) => updateCompany("city", v)}
                            onBlur={() => markTouched("city")}
                            options={cityOptions}
                            error={validationErrors.city}
                            status={fieldStatus.city}
                            loading={loadingCities}
                            disabled={noCompanyChecked}
                            required={!noCompanyChecked}
                          />
                          <Field
                            label="Postal Code"
                            value={formData.company.postalCode}
                            onChange={(v) => updateCompany("postalCode", v)}
                            onBlur={() => markTouched("postalCode")}
                            error={validationErrors.postalCode}
                            status={fieldStatus.postalCode}
                            placeholder={getPostalCodeFormat(
                              selectedAddressCountry,
                            )}
                            disabled={noCompanyChecked}
                            required={!noCompanyChecked}
                          />
                          <SearchableSelect
                            label="Country"
                            value={selectedAddressCountry}
                            onChange={(value) => {
                              markTouched("addressCountry");
                              updateCompany("addressCountry", value);
                              updateCompany("stateOrProvince", "");
                              updateCompany("city", "");
                            }}
                            options={countryOptions}
                            error={validationErrors.addressCountry}
                            status={fieldStatus.addressCountry}
                            disabled={noCompanyChecked}
                            required={!noCompanyChecked}
                          />
                          <div className="md:col-span-2">
                            <MultiSearchableSelect
                              label="Operating Countries"
                              values={formData.company.operatingCountries}
                              onChange={(value) => {
                                markTouched("operatingCountries");
                                updateCompany("operatingCountries", value);
                              }}
                              options={countryOptions}
                              error={validationErrors.operatingCountries}
                              status={fieldStatus.operatingCountries}
                              disabled={noCompanyChecked}
                              required={!noCompanyChecked}
                            />
                          </div>
                        </div>
                        <div className="mt-4">
                          <CheckboxField
                            label="Use company address as billing address"
                            checked={usesCompanyAddressForBilling}
                            disabled={noCompanyChecked}
                            onChange={(checked) =>
                              updateCompany(
                                "useCompanyAddressAsBillingAddress",
                                checked,
                              )
                            }
                          />
                        </div>
                        {!usesCompanyAddressForBilling && !noCompanyChecked ? (
                          <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5 md:grid-cols-2 md:items-start">
                            {/* Separate billing address */}
                            <div className="md:col-span-2">
                              <AddressAutocompleteField
                                label="Billing Address"
                                value={billingAddress.addressLine1}
                                countryName={
                                  billingAddress.country ||
                                  selectedAddressCountry
                                }
                                onChange={(v) =>
                                  updateBillingAddress({ addressLine1: v })
                                }
                                onBlur={() =>
                                  markTouched("billingAddressLine1")
                                }
                                onAddressSelected={applyLookupToBillingAddress}
                                error={validationErrors.billingAddressLine1}
                                status={fieldStatus.billingAddressLine1}
                                required
                              />
                            </div>
                            <Field
                              label="Billing Address Line 2"
                              value={billingAddress.addressLine2}
                              onChange={(v) =>
                                updateBillingAddress({ addressLine2: v })
                              }
                              placeholder="Building, floor, unit"
                              maxLength={200}
                            />
                            <ComboBoxField
                              label="Billing City"
                              value={billingAddress.city}
                              onChange={(v) =>
                                updateBillingAddress({ city: v })
                              }
                              onBlur={() => markTouched("billingCity")}
                              options={billingCityOptions}
                              error={validationErrors.billingCity}
                              status={fieldStatus.billingCity}
                              required
                            />
                            {billingStateOptions.length ? (
                              <SearchableSelect
                                label="Billing State or Province"
                                value={billingAddress.stateOrProvince}
                                onChange={(value) => {
                                  markTouched("billingState");
                                  updateBillingAddress({
                                    stateOrProvince: value,
                                    city: "",
                                  });
                                }}
                                options={billingStateOptions}
                                error={validationErrors.billingState}
                                status={fieldStatus.billingState}
                                required
                              />
                            ) : (
                              <Field
                                label="Billing State or Province"
                                value={billingAddress.stateOrProvince}
                                onChange={(v) =>
                                  updateBillingAddress({ stateOrProvince: v })
                                }
                                onBlur={() => markTouched("billingState")}
                                error={validationErrors.billingState}
                                status={fieldStatus.billingState}
                                required
                              />
                            )}
                            <Field
                              label="Billing Postal Code"
                              value={billingAddress.postalCode}
                              onChange={(v) =>
                                updateBillingAddress({ postalCode: v })
                              }
                              onBlur={() => markTouched("billingPostalCode")}
                              error={validationErrors.billingPostalCode}
                              status={fieldStatus.billingPostalCode}
                              placeholder={getPostalCodeFormat(
                                billingAddress.country ||
                                  selectedAddressCountry,
                              )}
                              required
                            />
                            <SearchableSelect
                              label="Billing Country"
                              value={billingAddress.country}
                              onChange={(value) => {
                                markTouched("billingCountry");
                                updateBillingAddress({
                                  country: value,
                                  stateOrProvince: "",
                                  city: "",
                                });
                              }}
                              options={countryOptions}
                              error={validationErrors.billingCountry}
                              status={fieldStatus.billingCountry}
                              required
                            />
                          </div>
                        ) : null}
                      </section>

                      {/* Business profile and requested credit */}
                      <div className="border-t border-[#BBD5DA] pt-2">
                        {/* <h4 className="text-sm font-bold text-slate-900">
                          Business profile
                        </h4> */}
                        <div className="mt-4 grid gap-4 md:grid-cols-2 md:items-start">
                          <Field
                            label="Company Website"
                            type="url"
                            value={formData.company.website ?? ""}
                            onChange={(v) => updateCompany("website", v)}
                            onBlur={() => markTouched("website")}
                            error={validationErrors.website}
                            status={fieldStatus.website}
                            placeholder="https://www.company.com"
                            disabled={noCompanyChecked}
                          />
                          <SearchableSelect
                            label="Company Industry"
                            value={formData.company.industry}
                            onChange={(value) => {
                              markTouched("industry");
                              updateCompany("industry", value);
                            }}
                            options={toOptions(industries)}
                            error={validationErrors.industry}
                            status={fieldStatus.industry}
                            disabled={noCompanyChecked}
                            required={!noCompanyChecked}
                          />
                          <SearchableSelect
                            label="Monthly Shipment Volume"
                            value={formData.company.monthlyShipmentVolume}
                            onChange={(value) => {
                              markTouched("monthlyShipmentVolume");
                              updateCompany("monthlyShipmentVolume", value);
                            }}
                            options={toOptions(shipmentVolumes)}
                            error={validationErrors.monthlyShipmentVolume}
                            status={fieldStatus.monthlyShipmentVolume}
                            disabled={noCompanyChecked}
                            required={!noCompanyChecked}
                          />
                          <div className="grid grid-cols-[128px_1fr] gap-3">
                            <SearchableSelect
                              label="Currency"
                              value={formData.company.requestedCreditCurrency}
                              onChange={(value) => {
                                markTouched("requestedCreditCurrency");
                                updateCompany(
                                  "requestedCreditCurrency",
                                  getCurrencyCode(value),
                                );
                              }}
                              options={currencyOptions}
                              error={validationErrors.requestedCreditCurrency}
                              status={fieldStatus.requestedCreditCurrency}
                              disabled={noCompanyChecked}
                              required
                            />
                            <Field
                              label="Requested Credit Limit"
                              placeholder={`Max ${BUSINESS_ACCOUNT_CREDIT_LIMIT_MAX}`}
                              type="number"
                              value={formData.company.requestedCreditLimit}
                              onChange={(v) =>
                                updateCompany("requestedCreditLimit", v)
                              }
                              onBlur={() => markTouched("requestedCreditLimit")}
                              error={validationErrors.requestedCreditLimit}
                              status={fieldStatus.requestedCreditLimit}
                              disabled={noCompanyChecked}
                              max={BUSINESS_ACCOUNT_CREDIT_LIMIT_MAX}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Step 3: KYC document uploads */}
                  {step === 2 ? (
                    <div>
                      {/* Document upload overview */}
                      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#D6E5E7] bg-[#F8FBFB] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#DFF1F1] text-[#0D1282]">
                            <FiFileText className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900">
                              KYC & supporting documents
                            </p>
                            <p className="mt-0.5 text-xs leading-5 text-slate-500">
                              Aadhaar and PAN are required. Add the remaining certificates only when applicable.
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2 text-[11px] font-medium text-slate-500">
                          <span className="rounded-md border border-[#D6E5E7] bg-white px-2.5 py-1.5">
                            PDF, JPG, PNG
                          </span>
                          <span className="rounded-md border border-[#D6E5E7] bg-white px-2.5 py-1.5">
                            Max 5 MB
                          </span>
                        </div>
                      </div>

                      {/* Two documents per row on tablet and desktop */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        {documentFields.map((df) => (
                          <DocumentCard
                            key={df.type}
                            type={df.type as DocumentType}
                            required={df.required}
                            helper={df.helper}
                            info={df.info}
                            file={files[df.type as DocumentType] ?? null}
                            error={documentErrors[df.type as DocumentType]}
                            onChange={(f) =>
                              handleDocumentChange(df.type as DocumentType, f)
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Step 4: final review */}
                  {step === 3 ? (
                    <div className="space-y-5">
                      {/* Review readiness overview */}
                      {/* <section className="overflow-hidden rounded-xl border border-[#C7DADD] bg-white shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
                        <div className="flex flex-col gap-4 border-b border-[#D7E5E7] bg-[#F1F8F8] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#0D1282] ring-1 ring-[#C7DADD]">
                              <FiShield className="h-5 w-5" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-950">
                                Final application check
                              </p>
                              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-600">
                                Review the key details below. You can return to any
                                section to make a correction before submitting.
                              </p>
                            </div>
                          </div>

                          <span
                            className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              outstandingIssues.length
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {outstandingIssues.length ? (
                              <>
                                <FiAlertCircle className="h-3.5 w-3.5" />
                                {outstandingIssues.length} item
                                {outstandingIssues.length === 1 ? "" : "s"} to check
                              </>
                            ) : (
                              <>
                                <FiCheckCircle className="h-3.5 w-3.5" />
                                Ready to submit
                              </>
                            )}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 divide-x divide-y divide-[#E2EBEC] sm:grid-cols-4 sm:divide-y-0">
                          <div className="flex items-center gap-2.5 px-4 py-3.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF4F4] text-[#0D1282]">
                              <FiUsers className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium text-slate-500">
                                Contact
                              </p>
                              <p className="mt-0.5 text-xs font-semibold text-slate-900">
                                Added
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 px-4 py-3.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF4F4] text-[#0D1282]">
                              <FiBriefcase className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium text-slate-500">
                                Company
                              </p>
                              <p className="mt-0.5 text-xs font-semibold text-slate-900">
                                Added
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 px-4 py-3.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF4F4] text-[#0D1282]">
                              <FiFileText className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium text-slate-500">
                                Documents
                              </p>
                              <p
                                className={`mt-0.5 text-xs font-semibold ${
                                  documentsComplete
                                    ? "text-emerald-700"
                                    : "text-amber-700"
                                }`}
                              >
                                {documentsComplete ? "Complete" : "Check required"}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 px-4 py-3.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF4F4] text-[#0D1282]">
                              <FiCheckCircle className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium text-slate-500">
                                Email
                              </p>
                              <p
                                className={`mt-0.5 text-xs font-semibold ${
                                  isEmailVerified
                                    ? "text-emerald-700"
                                    : "text-amber-700"
                                }`}
                              >
                                {isEmailVerified ? "Verified" : "Not verified"}
                              </p>
                            </div>
                          </div>
                        </div>
                      </section> */}

                      {/* Contact summary */}
                      <ReviewCard
                        kind="contact"
                        title="Contact details"
                        description="Primary contact, verification and shipment preferences"
                        onEdit={() => setStep(0)}
                        rows={[
                          ["Title", formData.contact.title],
                          [
                            "Name",
                            `${formData.contact.firstName} ${formData.contact.lastName}`.trim(),
                          ],
                          [
                            "Email",
                            `${formData.contact.email} ${isEmailVerified ? "✓ verified" : "- not verified"}`,
                          ],
                          [
                            "Phone",
                            `${formData.contact.countryCode} ${formData.contact.mobileNumber} (${formData.contact.mobileType})`,
                          ],
                          ["Job", formData.contact.jobTitle],
                          ["Department", formData.contact.department],
                          [
                            "Shipment type",
                            formData.contact.shipmentTypes.join(", "),
                          ],
                        ]}
                      />

                      {/* Company summary */}
                      <ReviewCard
                        kind="company"
                        title="Company details"
                        description="Registration, address, billing and account preferences"
                        columns={3}
                        onEdit={() => setStep(1)}
                        rows={[
                          [
                            "Country of registration",
                            formData.company.registrationCountry,
                          ],
                          [
                            "Registration ID",
                            formData.company.registrationId || "-",
                          ],
                          ...(requiresSecondaryRegistration
                            ? ([
                                [
                                  "Additional code",
                                  formData.company.secondaryRegistrationId ||
                                    "-",
                                ],
                              ] as any)
                            : []),
                          [
                            "GSTIN",
                            formData.company.gstin ||
                              (formData.company.gstExempt
                                ? `Exempt - ${formData.company.gstExemptReason}`
                                : "-"),
                          ],
                          [
                            "Company",
                            formData.company.noCompany
                              ? "No company (individual)"
                              : `${formData.company.companyName} (${formData.company.companyType})`,
                          ],
                          [
                            "Address",
                            `${formData.company.registeredAddress} ${formData.company.addressLine2 ?? ""}`.trim() ||
                              "-",
                          ],
                          [
                            "City / State",
                            `${formData.company.city} - ${formData.company.stateOrProvince}`,
                          ],
                          [
                            "Postal / Country",
                            `${formData.company.postalCode} - ${formData.company.addressCountry}`,
                          ],
                          [
                            "Billing",
                            usesCompanyAddressForBilling
                              ? "Same as company address"
                              : `${billingAddress.addressLine1}, ${billingAddress.city}`,
                          ],
                          [
                            "Operating countries",
                            formData.company.operatingCountries.join(", ") ||
                              "-",
                          ],
                          ["Website", formData.company.website || "-"],
                          ["Industry", formData.company.industry || "-"],
                          [
                            "Monthly volume",
                            formData.company.monthlyShipmentVolume || "-",
                          ],
                          [
                            "Credit",
                            `${formData.company.requestedCreditCurrency} ${formData.company.requestedCreditLimit || "-"}`,
                          ],
                          [
                            "GST treatment",
                            formData.gstBilling.requestedTreatment === "NO_GST"
                              ? `No GST - ${formData.gstBilling.requestReason}`
                              : "GST applicable",
                          ],
                        ]}
                      />

                      {/* Document summary */}
                      <section className="overflow-hidden rounded-xl border border-[#C7DADD] bg-white shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
                        <div className="flex flex-col gap-3 border-b border-[#DCE8E9] bg-[#F8FBFB] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                          <div className="flex items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF4F4] text-[#0D1282]">
                              <FiFileText className="h-4.5 w-4.5" />
                            </span>
                            <div>
                              <p className="text-sm font-bold text-slate-950">
                                Documents
                              </p>
                              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                                Aadhaar and PAN are required. Supporting documents
                                are shown for reference.
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setStep(2)}
                            className="inline-flex min-h-9 w-fit items-center justify-center rounded-lg border border-[#C7DADD] bg-white px-3 text-xs font-semibold text-[#0D1282] transition hover:border-[#AFC8CD] hover:bg-[#EAF4F4]"
                          >
                            Edit documents
                          </button>
                        </div>

                        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                          {documentFields.map((df) => {
                            const f = files[df.type as DocumentType] as
                              | File
                              | null
                              | undefined;

                            const documentLabel =
                              df.type === "aadhaarCard"
                                ? "Aadhaar Card"
                                : df.type === "panCard"
                                  ? "PAN Card"
                                  : df.type === "adCertificate"
                                    ? "AD Certificate"
                                    : df.type === "msmeCertificate"
                                      ? "MSME Certificate"
                                      : df.type === "tanCertificate"
                                        ? "TAN Certificate"
                                        : df.type === "gstCertificate"
                                          ? "GST Certificate"
                                          : df.type === "iecCertificate"
                                            ? "IEC Certificate"
                                            : "Other Certificate";

                            return (
                              <div
                                key={df.type}
                                className={`flex min-w-0 items-center gap-3 rounded-lg border px-3.5 py-3 ${
                                  f
                                    ? "border-emerald-200 bg-emerald-50/40"
                                    : df.required
                                      ? "border-amber-200 bg-amber-50/40"
                                      : "border-[#DEE8E9] bg-[#FAFCFC]"
                                }`}
                              >
                                <span
                                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                                    f
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-white text-slate-500 ring-1 ring-slate-200"
                                  }`}
                                >
                                  {f ? (
                                    <FiCheck className="h-4 w-4" />
                                  ) : (
                                    <FiFileText className="h-4 w-4" />
                                  )}
                                </span>

                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <p className="truncate text-xs font-semibold text-slate-800">
                                      {documentLabel}
                                    </p>
                                    {df.required ? (
                                      <span className="shrink-0 rounded-full bg-[#EEF3F8] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                        Required
                                      </span>
                                    ) : null}
                                  </div>
                                  <p
                                    className={`mt-1 truncate text-[11px] ${
                                      f
                                        ? "font-medium text-emerald-700"
                                        : df.required
                                          ? "font-medium text-amber-700"
                                          : "text-slate-400"
                                    }`}
                                    title={f?.name}
                                  >
                                    {f
                                      ? f.name
                                      : df.required
                                        ? "Document still required"
                                        : "Not attached"}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>

                      {/* Final confirmation */}
                      <label
                        className={`group flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-4 transition sm:px-5 ${
                          validationErrors.confirmation
                            ? "border-red-200 bg-red-50/50"
                            : confirmation
                              ? "border-emerald-200 bg-emerald-50/40"
                              : "border-[#C7DADD] bg-[#F8FBFB] hover:border-[#AFC8CD] hover:bg-[#F1F8F8]"
                        }`}
                      >
                        {/* <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#0D1282] ring-1 ring-[#D3E1E3]">
                          <FiShield className="h-4.5 w-4.5" />
                        </span> */}

                        <span className="min-w-0 flex-1">
                          <span className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={confirmation}
                              onChange={(e) => {
                                setConfirmation(e.target.checked);
                                markTouched("confirmation");
                              }}
                              className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-[#0D1282]"
                            />

                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-slate-900">
                                Confirm and submit for review
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-slate-600">
                                I confirm the information above is accurate and
                                the documents are genuine. I understand the
                                account will be reviewed before activation.
                              </span>
                            </span>
                          </span>

                          {validationErrors.confirmation ? (
                            <span className="mt-2 block pl-8 text-xs font-semibold text-[#D71313]">
                              {validationErrors.confirmation}
                            </span>
                          ) : confirmation ? (
                            <span className="mt-2 inline-flex items-center gap-1.5 pl-8 text-xs font-semibold text-emerald-700">
                              <FiCheckCircle className="h-3.5 w-3.5" />
                              Confirmation completed
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </div>
                  ) : null}

                  {/* Current-step validation summary */}
                  {outstandingIssues.length ? (
                    step === 3 ? (
                      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <p className="text-sm font-semibold text-amber-900">
                          Complete these before submitting
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900">
                          {outstandingIssues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="mt-6 flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                        <FiAlertCircle className="h-4 w-4 shrink-0" />
                        <span>
                          {outstandingIssues.length === 1
                            ? "1 required item needs attention before you can continue."
                            : `${outstandingIssues.length} required items need attention before you can continue.`}
                        </span>
                      </div>
                    )
                  ) : null}
                </div>

                {/* Step navigation */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#C7DADD] bg-[#F1F8F8] px-5 py-4 sm:px-7">
                  <button
                    type="button"
                    onClick={() => setStep((c) => Math.max(c - 1, 0))}
                    disabled={step === 0 || saving}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FiArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <Link
                      href="/"
                      className="hidden min-h-11 items-center rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 sm:inline-flex"
                    >
                      Cancel
                    </Link>
                    {step < 3 ? (
                      <button
                        type="submit"
                        disabled={saving || isCheckingUnique || !canLeaveStep}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#0D1282] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0A0F6D] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:opacity-100"
                      >
                        {isCheckingUnique ? "Checking…" : "Continue"}{" "}
                        <FiArrowRight className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={submitForReview}
                        disabled={saving || !canSubmit}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#0D1282] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0A0F6D] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:opacity-100"
                      >
                        {saving ? (
                          <>
                            <FiLoader className="h-4 w-4 animate-spin" />{" "}
                            Submitting…
                          </>
                        ) : (
                          <>
                            Submit for review{" "}
                            <FiArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </form>

              
            </main>
          </div>
        </div>
      </div>
      </div>

      <style jsx global>{`
        .public-business-form label {
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-size: 0.8125rem !important;
          color: #334155 !important;
        }

        .public-business-form input:not([type="checkbox"]):not([type="file"]),
        .public-business-form select,
        .public-business-form button[aria-expanded] {
          border-radius: 8px !important;
          box-shadow: none !important;
        }

        /* Slightly stronger default field borders on the public form only. */
        .public-business-form input:not([type="checkbox"]):not([type="file"]):not([aria-invalid="true"]),
        .public-business-form select:not([aria-invalid="true"]),
        .public-business-form button[aria-expanded]:not([class*="border-[#FF0000]"]) {
          border-color: #BBD5DA !important;
        }

        .public-business-form input:not([type="checkbox"]):not([type="file"]):focus,
        .public-business-form select:focus,
        .public-business-form button[aria-expanded]:focus {
          border-color: #0D1282 !important;
          box-shadow: 0 0 0 3px rgba(13, 18, 130, 0.10) !important;
        }
      `}</style>

      {RECAPTCHA_SITE_KEY ? (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`}
          strategy="afterInteractive"
        />
      ) : null}
    </>
  );
}

function ReviewCard({
  title,
  description,
  kind,
  rows,
  onEdit,
  columns = 2,
}: {
  title: string;
  description: string;
  kind: "contact" | "company";
  rows: [string, string][];
  onEdit: () => void;
  columns?: 2 | 3;
}) {
  const Icon = kind === "contact" ? FiUsers : FiBriefcase;

  return (
    <section className="overflow-hidden rounded-xl border border-[#C7DADD] bg-white shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 border-b border-[#DCE8E9] bg-[#F8FBFB] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF4F4] text-[#0D1282]">
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-950">{title}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              {description}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-9 w-fit items-center justify-center rounded-lg border border-[#C7DADD] bg-white px-3 text-xs font-semibold text-[#0D1282] transition hover:border-[#AFC8CD] hover:bg-[#EAF4F4]"
        >
          Edit section
        </button>
      </div>

      <dl
        className={`grid ${
          columns === 3
            ? "sm:grid-cols-2 xl:grid-cols-3"
            : "sm:grid-cols-2"
        }`}
      >
        {rows.map(([label, value], index) => {
          const isVerifiedEmail =
            label === "Email" && value.toLowerCase().includes("verified");

          return (
            <div
              key={label}
              className={`min-w-0 border-b border-[#EDF2F2] px-4 py-3.5 sm:px-5 ${
                index % 2 === 1 ? "bg-[#FCFDFD]" : "bg-white"
              }`}
            >
              <dt className="text-[11px] font-semibold text-slate-500">
                {label}
              </dt>
              <dd
                className={`mt-1.5 wrap-break-words text-sm font-semibold leading-5 ${
                  isVerifiedEmail ? "text-emerald-700" : "text-slate-900"
                }`}
              >
                {value || "-"}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

// Public document upload block used in the KYC step.
function DocumentCard({
  type,
  required,
  helper,
  info,
  file,
  error,
  onChange,
}: {
  type: DocumentType;
  required: boolean;
  helper: string;
  info?: string;
  file: File | null;
  error?: string;
  onChange: (f: File | null) => void;
}) {
  const inputId = `public-doc-${type}`;
  const fileRef = useRef<HTMLInputElement>(null);

  const documentLabel: Record<DocumentType, string> = {
    aadhaarCard: "Aadhaar Card",
    panCard: "PAN Card Copy",
    adCertificate: "AD Certificate",
    msmeCertificate: "MSME Certificate",
    tanCertificate: "TAN Certificate",
    gstCertificate: "GST Certificate",
    iecCertificate: "IEC Certificate",
    otherCertificate: "Other Certificate",
  };

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border transition ${
        error
          ? "border-red-200 bg-red-50/30"
          : file
            ? "border-emerald-200 bg-white"
            : "border-[#D6E5E7] bg-white hover:border-[#B8D0D4]"
      }`}
    >
      {/* Document identity */}
      <div className="flex items-start gap-3 px-3.5 pb-3 pt-3.5">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            file
              ? "bg-emerald-50 text-emerald-700"
              : "bg-[#EEF6F6] text-[#0D1282]"
          }`}
        >
          {file ? (
            <FiCheckCircle className="h-4.5 w-4.5" />
          ) : (
            <FiFileText className="h-4.5 w-4.5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="text-sm font-bold text-slate-900">
              {documentLabel[type]}
            </p>

            {required ? (
              <span className="rounded-md bg-[#0D1282]/[0.07] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#0D1282]">
                Required
              </span>
            ) : (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                Optional
              </span>
            )}

            {info ? <InfoTooltip text={info} /> : null}
          </div>

          <p className="mt-1 line-clamp-2 text-[11px] leading-4.5 text-slate-500">
            {helper}
          </p>
        </div>
      </div>

      {/* File action */}
      <div className="border-t border-[#E8EFEF] bg-[#FAFCFC] px-3.5 py-3">
        {file ? (
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-xs font-semibold text-slate-800"
                title={file.name}
              >
                {file.name}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {(file.size / 1024).toFixed(0)} KB · Ready to submit
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#C7DADD] bg-white px-2.5 text-[11px] font-semibold text-[#0D1282] transition hover:bg-[#EEF6F6]"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="inline-flex h-8 items-center justify-center rounded-md px-2 text-[11px] font-semibold text-[#D71313] transition hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-dashed px-3 text-left transition ${
              error
                ? "border-red-300 bg-red-50"
                : "border-[#BBD5DA] bg-white hover:border-[#0D1282]/40 hover:bg-[#F1F8F8]"
            }`}
          >
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-700">
                Choose document
              </span>
              <span className="mt-0.5 block text-[10px] text-slate-400">
                PDF, JPG or PNG · up to 5 MB
              </span>
            </span>

            <span className="shrink-0 rounded-md bg-[#0D1282] px-2.5 py-1.5 text-[10px] font-semibold text-white">
              Browse
            </span>
          </button>
        )}

        {error ? (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold text-[#D71313]">
            <FiAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>

      <input
        ref={fileRef}
        id={inputId}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="sr-only"
      />
    </div>
  );
}
