"use client";

import {
  CheckboxField,
  CountryRegistrationSelect,
  Field,
  MultiSearchableSelect,
  SearchableSelect,
  type CompanyUpdater,
  type UniqueField,
  canadaRegistrationTypeOptions,
  companyTypeOptions,
  countryOptions,
  currencyOptions,
  industries,
  registrationConfig,
  shipmentVolumes,
  toOptions,
  getCurrencyCode
} from "@/components/business-accounts/FormFieldControls";
import { BusinessAccountFormData } from "@/lib/businessAccounts";
import {
  getPrimaryRegistrationRule,
  getSecondaryRegistrationRule
} from "@/lib/businessAccountRegistrationRules";

// Company step UI for registration, address, and credit details.
export function CompanyStep({
  formData,
  validationErrors,
  fieldErrors,
  validatingFields,
  onCompanyChange,
  onValidateUniqueField,
  onValidateCompanyField
}: {
  formData: BusinessAccountFormData;
  validationErrors: Record<string, string>;
  fieldErrors: Partial<Record<UniqueField, string>>;
  validatingFields: Partial<Record<UniqueField, boolean>>;
  onCompanyChange: CompanyUpdater;
  onValidateUniqueField: (field: UniqueField) => Promise<boolean>;
  onValidateCompanyField: (field: "registrationId" | "secondaryRegistrationId" | "postalCode" | "requestedCreditLimit") => boolean;
}) {
  const selectedRegistrationCountry = formData.company.registrationCountry;
  const selectedRegistrationConfig = registrationConfig[selectedRegistrationCountry];
  const showsRegistrationField = Boolean(selectedRegistrationConfig) || selectedRegistrationCountry === "Canada";
  const requiresSecondaryRegistration = Boolean(selectedRegistrationConfig?.secondaryLabel);
  const noRegistrationChecked = Boolean(formData.company.noCompanyRegistration);
  const noCompanyChecked = Boolean(formData.company.noCompany);
  const primaryRegistrationRule = getPrimaryRegistrationRule(selectedRegistrationCountry, formData.company.registrationIdType);
  const secondaryRegistrationRule = getSecondaryRegistrationRule(selectedRegistrationCountry);
  const selectedAddressCountry = formData.company.addressCountry ?? formData.company.registrationCountry;

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
    Australia: "AUD",
    "United Arab Emirates": "AED",
    "Saudi Arabia": "SAR",
    Singapore: "SGD",
    China: "CNY",
    Japan: "JPY",
    Qatar: "QAR",
    Oman: "OMR",
    Bahrain: "BHD",
    "New Zealand": "NZD"
  };

  function handleRegistrationCountryChange(country: string) {
    const nextConfig = registrationConfig[country];

    onCompanyChange("registrationCountry", country);
    onCompanyChange("registrationIdType", country === "Canada" ? "business_number" : nextConfig?.primaryTypeValue ?? "");
    onCompanyChange("registrationId", "");
    onCompanyChange("secondaryRegistrationId", "");
    onCompanyChange("noCompanyRegistration", false);
    onCompanyChange("operatingCountries", [country]);
    onCompanyChange("addressCountry", country);
    onCompanyChange("requestedCreditCurrency", countryCurrencyMap[country] ?? "INR");
  }

  return (
    <div className="space-y-8">
      <section className="space-y-5 border border-slate-200 bg-white p-5 shadow-sm">
        <CountryRegistrationSelect
          label="Country of Registration"
          value={formData.company.registrationCountry}
          onChange={handleRegistrationCountryChange}
          error={validationErrors.registrationCountry}
          required
        />

        {showsRegistrationField ? (
          <div className={selectedRegistrationCountry === "Canada" ? "grid gap-5 md:grid-cols-[minmax(220px,280px)_1fr]" : "grid gap-5"}>
            {selectedRegistrationCountry === "Canada" ? (
              <SearchableSelect
                label="Registration ID Type"
                value={formData.company.registrationIdType ?? "business_number"}
                onChange={(value) => onCompanyChange("registrationIdType", value)}
                options={canadaRegistrationTypeOptions}
                disabled={noCompanyChecked}
                searchable={false}
                required={!noRegistrationChecked && !noCompanyChecked}
              />
            ) : null}

            <Field
              label={selectedRegistrationCountry === "Canada"
                ? canadaRegistrationTypeOptions.find((option) => option.value === formData.company.registrationIdType)?.label ?? "Registration ID"
                : selectedRegistrationConfig?.primaryLabel ?? "Registration ID"}
              value={formData.company.registrationId}
              onChange={(value) => onCompanyChange("registrationId", value.toUpperCase())}
              onBlur={() => {
                if (onValidateCompanyField("registrationId")) void onValidateUniqueField("registrationId");
              }}
              error={validationErrors.registrationId || fieldErrors.registrationId}
              helper={validatingFields.registrationId ? "Checking registration ID..." : undefined}
              info={primaryRegistrationRule?.info ?? selectedRegistrationConfig?.primaryInfo ?? "Enter the selected Canadian company registration number."}
              disabled={noRegistrationChecked || noCompanyChecked}
              maxLength={primaryRegistrationRule?.maxLength}
              required={!noRegistrationChecked && !noCompanyChecked}
            />

            {requiresSecondaryRegistration ? (
              <Field
                label={selectedRegistrationConfig.secondaryLabel ?? "Additional Registration Code"}
                value={formData.company.secondaryRegistrationId ?? ""}
                onChange={(value) => onCompanyChange("secondaryRegistrationId", value.toUpperCase())}
                onBlur={() => onValidateCompanyField("secondaryRegistrationId")}
                error={validationErrors.secondaryRegistrationId}
                info={secondaryRegistrationRule?.info ?? selectedRegistrationConfig.secondaryInfo}
                disabled={noRegistrationChecked || noCompanyChecked}
                maxLength={secondaryRegistrationRule?.maxLength}
                required={!noRegistrationChecked && !noCompanyChecked}
              />
            ) : null}
          </div>
        ) : null}

        <CheckboxField
          label="I don't have a company registration no. for this country"
          checked={noRegistrationChecked}
          onChange={(checked) => {
            onCompanyChange("noCompanyRegistration", checked);
            if (checked) {
              onCompanyChange("registrationId", "");
              onCompanyChange("secondaryRegistrationId", "");
            }
          }}
        />

        {noRegistrationChecked ? (
          <div className="border border-yellow-300 bg-yellow-50 px-3 py-3 text-sm leading-6 text-slate-900">
            We will not be able to process your account number creation immediately without the registration number. Please enter your company details manually and submit your request.
          </div>
        ) : null}
      </section>

      <section className="space-y-5 px-5">
        <h2 className="text-xl font-bold text-slate-950">Company details</h2>
        <CheckboxField
          label="I don't have any company"
          checked={noCompanyChecked}
          onChange={(checked) => {
            onCompanyChange("noCompany", checked);
            if (checked) {
              onCompanyChange("noCompanyRegistration", true);
              onCompanyChange("registrationId", "");
              onCompanyChange("secondaryRegistrationId", "");
            }
          }}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Company Name"
            value={formData.company.companyName}
            onChange={(value) => onCompanyChange("companyName", value)}
            error={validationErrors.companyName}
            disabled={noCompanyChecked}
            required={!noCompanyChecked}
          />
          <SearchableSelect
            label="Company Type"
            value={formData.company.companyType}
            onChange={(value) => onCompanyChange("companyType", value)}
            options={companyTypeOptions}
            error={validationErrors.companyType}
            placeholder="Company Type"
            disabled={noCompanyChecked}
            searchable={false}
            required={!noCompanyChecked}
          />
          {selectedRegistrationCountry === "India" ? (
            <Field
              label="GSTIN"
              value={formData.company.gstin ?? ""}
              onChange={(value) => onCompanyChange("gstin", value.toUpperCase().replace(/\s+/g, ""))}
              error={validationErrors.gstin}
              info="Optional for customers who are not registered under GST."
              disabled={noCompanyChecked}
              maxLength={15}
            />
          ) : null}
        </div>
      </section>

      <section className="space-y-5 border-slate-200 px-5">
        <h3 className="text-sm font-bold text-slate-950">Company address</h3>
        {selectedRegistrationCountry === "United States" ? (
          <div className="border border-yellow-300 bg-yellow-50 px-3 py-3 text-sm leading-6 text-slate-900">
            SWIFTLINE does not open accounts at USPS, retail postal locations or PO boxes. Please provide the physical address of the company within the US. You must be age 19 or older to open an account.
          </div>
        ) : null}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field
              label="Company Address"
              value={formData.company.registeredAddress}
              onChange={(value) => onCompanyChange("registeredAddress", value)}
              error={validationErrors.registeredAddress}
              disabled={noCompanyChecked}
              required={!noCompanyChecked}
            />
          </div>
          <Field
            label="City"
            value={formData.company.city}
            onChange={(value) => onCompanyChange("city", value)}
            error={validationErrors.city}
            disabled={noCompanyChecked}
            required={!noCompanyChecked}
          />
          <Field
            label="State or Province"
            value={formData.company.stateOrProvince}
            onChange={(value) => onCompanyChange("stateOrProvince", value)}
            error={validationErrors.stateOrProvince}
            disabled={noCompanyChecked}
            required={!noCompanyChecked}
          />
          <div className="grid gap-5 md:col-span-2 md:grid-cols-[minmax(140px,220px)_minmax(0,1fr)]">
            <Field
              label="Postal Code"
              value={formData.company.postalCode}
              onChange={(value) => onCompanyChange("postalCode", value)}
              onBlur={() => onValidateCompanyField("postalCode")}
              error={validationErrors.postalCode}
              // helper={`Format: ${getPostalCodeFormat(selectedAddressCountry)}`}
              disabled={noCompanyChecked}
              required={!noCompanyChecked}
            />
            <SearchableSelect
              label="Country"
              value={selectedAddressCountry}
              onChange={(value) => onCompanyChange("addressCountry", value)}
              options={countryOptions}
              error={validationErrors.addressCountry}
              disabled={noCompanyChecked}
              required={!noCompanyChecked}
            />
          </div>
          <div className="md:col-span-2">
            <MultiSearchableSelect
              label="Operating Countries"
              values={formData.company.operatingCountries}
              onChange={(value) => onCompanyChange("operatingCountries", value)}
              options={countryOptions}
              error={validationErrors.operatingCountries}
              disabled={noCompanyChecked}
              required={!noCompanyChecked}
            />
          </div>
        </div>
        <CheckboxField
          label="Use company address as billing address"
          checked={Boolean(formData.company.useCompanyAddressAsBillingAddress)}
          disabled={noCompanyChecked}
          onChange={(checked) => onCompanyChange("useCompanyAddressAsBillingAddress", checked)}
        />
      </section>

      <section className="space-y-5 px-5">
        <h3 className="text-sm font-bold text-slate-950">Additional information</h3>
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Company Website"
            type="url"
            value={formData.company.website ?? ""}
            onChange={(value) => onCompanyChange("website", value)}
            error={validationErrors.website}
            disabled={noCompanyChecked}
          />
          <SearchableSelect
            label="Company Industry"
            value={formData.company.industry}
            onChange={(value) => onCompanyChange("industry", value)}
            options={toOptions(industries)}
            error={validationErrors.industry}
            disabled={noCompanyChecked}
            required={!noCompanyChecked}
          />
          <SearchableSelect
            label="Monthly Shipment Volume"
            value={formData.company.monthlyShipmentVolume}
            onChange={(value) => onCompanyChange("monthlyShipmentVolume", value)}
            options={toOptions(shipmentVolumes)}
            error={validationErrors.monthlyShipmentVolume}
            disabled={noCompanyChecked}
            required={!noCompanyChecked}
          />
          <div className="grid grid-cols-[200px_1fr] gap-3">
            <SearchableSelect
              label="Currency"
              value={formData.company.requestedCreditCurrency}
              onChange={(value) => onCompanyChange("requestedCreditCurrency", getCurrencyCode(value))}
              options={currencyOptions}
              error={validationErrors.requestedCreditCurrency}
              disabled={noCompanyChecked}
              required
            />
            <Field
              label="Requested Credit Limit"
              placeholder="Requested Credit (max 100000)"
              type="number"
              value={formData.company.requestedCreditLimit}
              onChange={(value) => onCompanyChange("requestedCreditLimit", value)}
              onBlur={() => onValidateCompanyField("requestedCreditLimit")}
              error={validationErrors.requestedCreditLimit}
              disabled={noCompanyChecked}
              max={100000}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
