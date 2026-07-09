"use client";

import {
  Field,
  SearchableSelect,
  CountryCodeField,
  type ContactUpdater,
  type UniqueField,
  departments,
  mobileTypeOptions,
  shipmentTypeOptions,
  titleOptions,
  toOptions
} from "@/components/business-accounts/FormFieldControls";
import { BusinessAccountFormData } from "@/lib/businessAccounts";

// Contact step UI for collecting personal and shipment details.
export function ContactStep({
  formData,
  validationErrors,
  fieldErrors,
  validatingFields,
  onContactChange,
  onShipmentTypeChange,
  onValidateUniqueField
}: {
  formData: BusinessAccountFormData;
  validationErrors: Record<string, string>;
  fieldErrors: Partial<Record<UniqueField, string>>;
  validatingFields: Partial<Record<UniqueField, boolean>>;
  onContactChange: ContactUpdater;
  onShipmentTypeChange: (value: string) => void;
  onValidateUniqueField: (field: UniqueField) => Promise<boolean>;
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-5 md:grid-cols-[minmax(110px,140px)_1fr_1fr]">
        <SearchableSelect
          label="Title"
          value={formData.contact.title}
          onChange={(value) => onContactChange("title", value as BusinessAccountFormData["contact"]["title"])}
          options={titleOptions}
          error={validationErrors.title}
          searchable={false}
          required
        />
        <Field
          label="First Name"
          value={formData.contact.firstName}
          onChange={(value) => onContactChange("firstName", value)}
          error={validationErrors.firstName}
          maxLength={22}
          required
        />
        <Field
          label="Last Name"
          value={formData.contact.lastName}
          onChange={(value) => onContactChange("lastName", value)}
          error={validationErrors.lastName}
          maxLength={22}
          required
        />
      </div>

      <div className="border border-yellow-300 bg-yellow-50 px-3 py-3 text-sm text-slate-900">
        Note: You can only enter up to <span className="font-bold">22 characters </span> in each &quot;First name&quot; and &quot;Last name&quot; field.
      </div>

      <Field
        label="Email Address"
        type="email"
        value={formData.contact.email}
        onChange={(value) => onContactChange("email", value)}
        onBlur={() => void onValidateUniqueField("email")}
        error={validationErrors.email || fieldErrors.email}
        helper={validatingFields.email ? "Checking email..." : undefined}
        required
      />

      <div className="grid gap-5 md:grid-cols-[minmax(150px,180px)_minmax(190px,220px)_1fr]">
        <SearchableSelect
          label="Phone Type"
          value={formData.contact.mobileType}
          onChange={(value) => onContactChange("mobileType", value as BusinessAccountFormData["contact"]["mobileType"])}
          options={mobileTypeOptions}
          error={validationErrors.mobileType}
          searchable={false}
          required
        />
        <CountryCodeField
          value={formData.contact.countryCode}
          onChange={(value) => onContactChange("countryCode", value)}
          error={validationErrors.countryCode}
          required
        />
        <Field
          label="Mobile Number"
          value={formData.contact.mobileNumber}
          onChange={(value) => onContactChange("mobileNumber", value)}
          onBlur={() => void onValidateUniqueField("mobileNumber")}
          error={validationErrors.mobileNumber || fieldErrors.mobileNumber}
          helper={validatingFields.mobileNumber ? "Checking mobile number..." : undefined}
          required
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="Job Title"
          value={formData.contact.jobTitle}
          onChange={(value) => onContactChange("jobTitle", value)}
          error={validationErrors.jobTitle}
          required
        />
        <SearchableSelect
          label="Department"
          value={formData.contact.department}
          onChange={(value) => onContactChange("department", value)}
          options={toOptions(departments)}
          error={validationErrors.department}
          required
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <SearchableSelect
          label="Shipment Type"
          value={formData.contact.shipmentTypes[0] ?? ""}
          onChange={onShipmentTypeChange}
          options={shipmentTypeOptions}
          error={validationErrors.shipmentTypes}
          searchable={false}
          required
        />
      </div>
    </div>
  );
}
