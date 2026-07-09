"use client";

// This file now acts as a lightweight barrel for the refactored business-account form.
// The main form logic remains unchanged; the UI is split across focused modules.

export {
  businessAccountSteps,
  type ContactUpdater,
  type CompanyUpdater,
  type ExistingDocuments,
  type SelectOption,
  type UniqueField,
  CheckboxField,
  CountryCodeField,
  CountryRegistrationSelect,
  DocumentInput,
  DocumentPreviewCard,
  Field,
  MultiSearchableSelect,
  ReviewSection,
  SearchableSelect,
  formatFileSize,
  formatShipmentType,
  getCurrencyCode,
  getDocumentLabel,
  getPhoneCountryByDialCode,
  toOptions,
  departments,
  industries,
  shipmentVolumes,
  countryOptions,
  registrationCountryOptions,
  currencyOptions,
  shipmentTypeOptions,
  titleOptions,
  mobileTypeOptions,
  companyTypeOptions,
  canadaRegistrationTypeOptions,
  registrationConfig,
  preferredPhoneCountries
} from "@/components/business-accounts/FormFieldControls";

export { ContactStep } from "@/components/business-accounts/ContactStep";
export { CompanyStep } from "@/components/business-accounts/CompanyStep";
export { DocumentsStep } from "@/components/business-accounts/DocumentsStep";
export { ReviewStep } from "@/components/business-accounts/ReviewStep";
