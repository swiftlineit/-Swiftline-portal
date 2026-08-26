"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { FiBriefcase, FiFileText, FiHeart, FiMapPin, FiRefreshCw, FiUser } from "react-icons/fi";
import { AddressAutocompleteField } from "@/components/business-accounts/AddressAutocompleteField";
import {
  BranchField,
  DateField,
  DesignationField,
  DocumentUploadField,
  InputField,
  MAX_DOCUMENT_BYTES,
  MIN_STAFF_AGE_YEARS,
  ProfileImageUploadField,
  SectionCard,
  SelectField,
  staffPatterns,
  yearsAgo
} from "@/components/users/StaffFields";
import type { LookupAddress } from "@/lib/addressLookup";
import {
  internalRoles,
  isBranchScopedRole,
  roleLabels,
  staffRoles,
  type InternalRole
} from "@/lib/roles";
import { createStaff, listUserBranchOptions } from "@/lib/users";
import { useGuardedNavigate, useUnsavedChanges } from "@/lib/useUnsavedChanges";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "operations" as InternalRole,
  password: "",
  dateOfJoining: "",
  aadhaarNumber: "",
  designation: "",
  employeeCode: "",
  dateOfBirth: "",
  panNumber: "",
  addressLine1: "",
  addressCity: "",
  addressState: "",
  addressPostalCode: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: ""
};

type FormValues = typeof emptyForm;
type DocumentField = "aadhaar" | "pan" | "other";
type FieldKey = keyof FormValues | DocumentField | "assignedBranches" | "profileImage";
type FieldErrors = Partial<Record<FieldKey, string>>;

const relationshipOptions = [
  { value: "parent", label: "Parent" },
  { value: "spouse", label: "Spouse" },
  { value: "sibling", label: "Sibling" },
  { value: "child", label: "Child" },
  { value: "guardian", label: "Guardian" },
  { value: "friend", label: "Friend" },
  { value: "other", label: "Other" }
];

function generateTemporaryPassword() {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%"];
  const all = groups.join("");
  const randomIndex = (length: number) => crypto.getRandomValues(new Uint32Array(1))[0] % length;
  const characters = groups.map((group) => group[randomIndex(group.length)]);
  while (characters.length < 12) characters.push(all[randomIndex(all.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

/**
 * `canGrantAdmin` reflects the signed-in user: HR may add staff but only an
 * admin may create another admin, so HR is not offered the option at all. The
 * server refuses it either way.
 */
export default function AddStaffForm({ canGrantAdmin }: { canGrantAdmin: boolean }) {
  const router = useRouter();
  const guardNavigate = useGuardedNavigate();
  const roleOptions = (canGrantAdmin ? internalRoles : staffRoles)
    .map((role) => ({ value: role, label: roleLabels[role] }));
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [assignedBranches, setAssignedBranches] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Partial<Record<DocumentField, File>>>({});
  const [profileImage, setProfileImage] = useState<File>();
  const [branchOptions, setBranchOptions] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [staffPersisted, setStaffPersisted] = useState(false);

  // Documents and branch assignments count as unsaved work too, not just the
  // typed fields.
  // No draft option: creating a staff member issues an activation invitation,
  // so there is no half-created state for one to be saved into.
  useUnsavedChanges(
    !staffPersisted
    && (JSON.stringify(values) !== JSON.stringify(emptyForm)
      || assignedBranches.length > 0
      || Object.keys(documents).length > 0
      || Boolean(profileImage)),
    { label: "this staff member" }
  );

  useEffect(() => {
    let active = true;
    async function loadBranches() {
      try {
        const data = await listUserBranchOptions();
        if (active) setBranchOptions(data.branches);
      } catch (caughtError) {
        if (active) toast.error(caughtError instanceof Error ? caughtError.message : "Unable to load branches.");
      }
    }
    void loadBranches();
    return () => { active = false; };
  }, []);

  function setValue<Key extends keyof FormValues>(key: Key, value: FormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  }

  function setDocument(field: DocumentField, file?: File) {
    setDocuments((current) => {
      const next = { ...current };
      if (file) next[field] = file;
      else delete next[field];
      return next;
    });
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  // Mirrors the server rules and returns every invalid field so the form can
  // highlight exactly what needs attention.
  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const aadhaarDigits = values.aadhaarNumber.replace(/[\s-]/g, "");

    if (!values.firstName.trim()) errors.firstName = "Enter the first name.";
    if (!values.lastName.trim()) errors.lastName = "Enter the last name.";
    if (!values.email.trim()) errors.email = "Enter an email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Enter a valid email address.";
    if (!staffPatterns.phone.test(values.phone.trim())) errors.phone = "Enter a valid phone number.";
    if (values.password.length < 8) errors.password = "Password must be at least 8 characters.";
    if (isBranchScopedRole(values.role) && !assignedBranches.length) errors.assignedBranches = "Assign at least one branch.";
    if (!values.dateOfJoining) errors.dateOfJoining = "Select the date of joining.";
    if (!staffPatterns.aadhaar.test(aadhaarDigits)) errors.aadhaarNumber = "Enter a valid 12-digit Aadhaar number.";
    if (!documents.aadhaar) errors.aadhaar = "Upload the Aadhaar document.";

    if (values.dateOfBirth && new Date(values.dateOfBirth) > yearsAgo(MIN_STAFF_AGE_YEARS)) {
      errors.dateOfBirth = `Staff must be at least ${MIN_STAFF_AGE_YEARS} years old.`;
    }
    if (values.panNumber && !staffPatterns.pan.test(values.panNumber.trim().toUpperCase())) {
      errors.panNumber = "Enter a valid PAN, for example ABCDE1234F.";
    }
    if (values.addressPostalCode && !staffPatterns.postalCode.test(values.addressPostalCode.trim())) {
      errors.addressPostalCode = "Enter a valid 6-digit PIN code.";
    }
    if (values.emergencyContactPhone && !staffPatterns.phone.test(values.emergencyContactPhone.trim())) {
      errors.emergencyContactPhone = "Enter a valid emergency contact number.";
    }
    if ((values.emergencyContactName || values.emergencyContactPhone) && !values.emergencyContactRelationship) {
      errors.emergencyContactRelationship = "Select the relationship.";
    }

    const oversizedEntry = Object.entries(documents).find(([, file]) => file.size > MAX_DOCUMENT_BYTES);
    if (oversizedEntry) errors[oversizedEntry[0] as DocumentField] = `${oversizedEntry[1].name} is larger than 5 MB.`;

    return errors;
  }

  function applyAddress(address: LookupAddress) {
    setValues((current) => ({
      ...current,
      addressLine1: [address.addressLine1, address.addressLine2].filter(Boolean).join(", "),
      addressCity: address.city,
      addressState: address.state,
      addressPostalCode: address.postalCode
    }));
    setFieldErrors((current) => ({
      ...current,
      addressLine1: undefined,
      addressCity: undefined,
      addressState: undefined,
      addressPostalCode: undefined
    }));
  }
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const errors = validate();
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      toast.error("Please fix the highlighted fields before creating the staff member.");
      window.setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }

    setSaving(true);
    setFieldErrors({});

    try {
      const form = new FormData();
      for (const [key, value] of Object.entries(values)) {
        if (value) form.append(key, String(value).trim());
      }
      // Branches picked before switching the role to admin are not sent; the
      // server would drop them anyway, and this keeps the request honest.
      if (isBranchScopedRole(values.role)) {
        for (const branchId of assignedBranches) form.append("assignedBranches", branchId);
      }
      for (const [field, file] of Object.entries(documents)) form.append(field, file);
      if (profileImage) form.append("profileImage", profileImage);

      const created = await createStaff(form);
      // Saved on the server; leaving no longer loses anything.
      setStaffPersisted(true);
      toast.success(created.message || "Staff member created successfully.");
      router.push(`/dashboard/users/${created.user._id}`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unable to create the staff member.";
      const normalized = message.toLowerCase();
      if (normalized.includes("email")) setFieldErrors((current) => ({ ...current, email: message }));
      else if (normalized.includes("emergency contact")) setFieldErrors((current) => ({ ...current, emergencyContactPhone: message }));
      else if (normalized.includes("phone")) setFieldErrors((current) => ({ ...current, phone: message }));
      else if (normalized.includes("aadhaar document")) setFieldErrors((current) => ({ ...current, aadhaar: message }));
      else if (normalized.includes("aadhaar")) setFieldErrors((current) => ({ ...current, aadhaarNumber: message }));
      else if (normalized.includes("employee code")) setFieldErrors((current) => ({ ...current, employeeCode: message }));
      else if (normalized.includes("profile image")) setFieldErrors((current) => ({ ...current, profileImage: message }));
      else if (normalized.includes("branch")) setFieldErrors((current) => ({ ...current, assignedBranches: message }));
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
  {/* Page heading, matching the other create pages in the dashboard. */}
  <div className="border-b border-slate-200 pb-5">
    <h1 className="text-2xl font-bold tracking-tight text-slate-950">Create New Staff</h1>
    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
      Add an internal team member, set what they can reach in the portal, and record their KYC documents.
    </p>
  </div>

  {/* Personal details */}
  <SectionCard
    icon={FiUser}
    title="Personal details"
    subtitle="Identity, contact information, and optional profile photo."
  >
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <ProfileImageUploadField
          file={profileImage}
          error={fieldErrors.profileImage}
          onChange={(file) => {
            setProfileImage(file);
            setFieldErrors((current) => ({
              ...current,
              profileImage: undefined,
            }));
          }}
        />
      </div>

      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        <InputField
          label="First name"
          required
          error={fieldErrors.firstName}
          value={values.firstName}
          onChange={(value) => setValue("firstName", value)}
          autoComplete="given-name"
          maxLength={60}
        />

        <InputField
          label="Last name"
          required
          error={fieldErrors.lastName}
          value={values.lastName}
          onChange={(value) => setValue("lastName", value)}
          autoComplete="family-name"
          maxLength={60}
        />

        <InputField
          label="Email"
          required
          type="email"
          error={fieldErrors.email}
          value={values.email}
          onChange={(value) => setValue("email", value)}
          onBlur={() => {
            const email = values.email.trim();

            setFieldErrors((current) => ({
              ...current,
              email:
                email &&
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                  ? undefined
                  : "Enter a valid email address.",
            }));
          }}
          autoComplete="email"
          helper="Used as the login id."
        />

        <InputField
          label="Phone"
          required
          error={fieldErrors.phone}
          value={values.phone}
          onChange={(value) => setValue("phone", value)}
          placeholder="+91 98765 43210"
          autoComplete="tel"
          inputMode="tel"
          maxLength={20}
        />

        <DateField
          label="Date of birth"
          error={fieldErrors.dateOfBirth}
          value={values.dateOfBirth}
          onChange={(value) => setValue("dateOfBirth", value)}
          helper={`Optional. Must be ${MIN_STAFF_AGE_YEARS} or older.`}
        />

        <div>
          <InputField
            label="Temporary password"
            required
            type="password"
            error={fieldErrors.password}
            value={values.password}
            onChange={(value) => setValue("password", value)}
            autoComplete="new-password"
            helper="At least 8 characters. Share it securely."
          />

          <button
            type="button"
            onClick={() => {
              setValue(
                "password",
                generateTemporaryPassword(),
              );

              toast.success(
                "A secure temporary password was generated.",
              );
            }}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0D1282] transition hover:text-[#090d68]"
          >
            <FiRefreshCw className="h-3.5 w-3.5" />
            Generate secure password
          </button>
        </div>
      </div>
    </div>
  </SectionCard>

  {/* Role and access */}
  <SectionCard
    icon={FiBriefcase}
    title="Role and access"
    subtitle="What they can reach in the portal."
  >
    <div className="space-y-6">
      {/* 4 fields in one row */}
      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        <SelectField
          label="Role"
          required
          value={values.role}
          options={roleOptions}
          error={fieldErrors.role}
          onChange={(value) =>
            setValue("role", value as InternalRole)
          }
        />

        <DesignationField
          value={values.designation}
          onChange={(value) =>
            setValue("designation", value)
          }
        />

        <InputField
          label="Employee code"
          error={fieldErrors.employeeCode}
          value={values.employeeCode}
          onChange={(value) =>
            setValue("employeeCode", value)
          }
          placeholder="SL-0142"
          maxLength={40}
        />

        <DateField
          label="Date of joining"
          required
          error={fieldErrors.dateOfJoining}
          value={values.dateOfJoining}
          onChange={(value) =>
            setValue("dateOfJoining", value)
          }
        />
      </div>

      {/* Branch full row */}
      <div className="border-t border-slate-100 pt-5">
        {isBranchScopedRole(values.role) ? (
          <BranchField
            required
            error={fieldErrors.assignedBranches}
            values={assignedBranches}
            onChange={(branches) => {
              setAssignedBranches(branches);

              setFieldErrors((current) => ({
                ...current,
                assignedBranches: undefined,
              }));
            }}
            options={branchOptions}
          />
        ) : (
          <div className="flex min-h-11 items-center rounded-lg bg-slate-50 px-4 text-sm text-slate-500">
            Administrators reach every branch, so no branch assignment is needed.
          </div>
        )}
      </div>
    </div>
  </SectionCard>

  {/* Identity documents */}
  <SectionCard
    icon={FiFileText}
    title="Identity documents"
    subtitle="Aadhaar is required. PDF, JPG, or PNG up to 5 MB."
  >
    <div className="space-y-6">
      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
        <InputField
          label="Aadhaar number"
          required
          error={fieldErrors.aadhaarNumber}
          value={values.aadhaarNumber}
          onChange={(value) =>
            setValue("aadhaarNumber", value)
          }
          placeholder="1234 5678 9012"
          inputMode="numeric"
          maxLength={14}
        />

        <InputField
          label="PAN number"
          error={fieldErrors.panNumber}
          value={values.panNumber}
          onChange={(value) =>
            setValue(
              "panNumber",
              value.toUpperCase(),
            )
          }
          placeholder="ABCDE1234F"
          maxLength={10}
        />
      </div>

      <div className="border-t border-slate-100 pt-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DocumentUploadField
            label="Aadhaar document"
            required
            error={fieldErrors.aadhaar}
            file={documents.aadhaar}
            onChange={(file) =>
              setDocument("aadhaar", file)
            }
          />

          <DocumentUploadField
            label="PAN document"
            error={fieldErrors.pan}
            file={documents.pan}
            onChange={(file) =>
              setDocument("pan", file)
            }
          />

          <DocumentUploadField
            label="Other document"
            error={fieldErrors.other}
            file={documents.other}
            onChange={(file) =>
              setDocument("other", file)
            }
            helper="Offer letter, address proof, or similar."
          />
        </div>
      </div>
    </div>
  </SectionCard>

  {/* Residential address */}
  <SectionCard
    icon={FiMapPin}
    title="Residential address"
    subtitle="Search the address first, then review the details filled below."
  >
    <div className="space-y-5">
      <div className="[&_input]:!h-10 [&_input:focus]:!border-[#0D1282] [&_input:focus]:!ring-blue-100">
        <AddressAutocompleteField
          label="Search address"
          value={values.addressLine1}
          countryName="India"
          onChange={(value) =>
            setValue("addressLine1", value)
          }
          onAddressSelected={applyAddress}
          error={fieldErrors.addressLine1}
        />
      </div>

      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <InputField
          label="City"
          error={fieldErrors.addressCity}
          value={values.addressCity}
          onChange={(value) =>
            setValue("addressCity", value)
          }
          maxLength={80}
        />

        <InputField
          label="State"
          error={fieldErrors.addressState}
          value={values.addressState}
          onChange={(value) =>
            setValue("addressState", value)
          }
          maxLength={80}
        />

        <InputField
          label="PIN code"
          error={fieldErrors.addressPostalCode}
          value={values.addressPostalCode}
          onChange={(value) =>
            setValue(
              "addressPostalCode",
              value,
            )
          }
          inputMode="numeric"
          maxLength={6}
        />
      </div>
    </div>
  </SectionCard>

  {/* Emergency contact */}
  <SectionCard
    icon={FiHeart}
    title="Emergency contact"
    subtitle="Keep this separate from the staff member’s own contact details."
  >
    <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
      <InputField
        label="Contact name"
        error={fieldErrors.emergencyContactName}
        value={values.emergencyContactName}
        onChange={(value) =>
          setValue("emergencyContactName", value)
        }
        maxLength={80}
      />

      <InputField
        label="Contact phone"
        error={fieldErrors.emergencyContactPhone}
        value={values.emergencyContactPhone}
        onChange={(value) =>
          setValue("emergencyContactPhone", value)
        }
        autoComplete="tel"
        inputMode="tel"
        maxLength={20}
      />

      <SelectField
        label="Relationship"
        value={values.emergencyContactRelationship}
        options={relationshipOptions}
        placeholder="Select relationship"
        error={
          fieldErrors.emergencyContactRelationship
        }
        onChange={(value) =>
          setValue(
            "emergencyContactRelationship",
            value,
          )
        }
      />
    </div>
  </SectionCard>

  {/* Actions */}
  <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-2">
    <Link
      href="/dashboard/users"
      onNavigate={guardNavigate("/dashboard/users")}
      className="inline-flex h-10 items-center justify-center rounded-xl px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
    >
      Cancel
    </Link>

    <button
      type="submit"
      disabled={saving}
      className="inline-flex h-10 items-center justify-center rounded-xl bg-[#0D1282] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#090d68] disabled:cursor-not-allowed disabled:bg-slate-400"
    >
      {saving ? "Creating..." : "Create Staff"}
    </button>
  </div>
</form>
  );
}
