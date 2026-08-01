"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiArrowLeft, FiBriefcase, FiFileText, FiMapPin, FiUser } from "react-icons/fi";
import {
  BranchField,
  DateField,
  DesignationField,
  DocumentUploadField,
  FormError,
  InputField,
  MAX_DOCUMENT_BYTES,
  MIN_STAFF_AGE_YEARS,
  SectionCard,
  SelectField,
  staffFieldGrid,
  staffPatterns,
  yearsAgo
} from "@/components/users/StaffFields";
import {
  internalRoles,
  isBranchScopedRole,
  roleLabels,
  staffRoles,
  type InternalRole
} from "@/lib/roles";
import { createStaff, listUserBranchOptions } from "@/lib/users";

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
  emergencyContactPhone: ""
};

type FormValues = typeof emptyForm;
type DocumentField = "aadhaar" | "pan" | "other";

/**
 * `canGrantAdmin` reflects the signed-in user: HR may add staff but only an
 * admin may create another admin, so HR is not offered the option at all. The
 * server refuses it either way.
 */
export default function AddStaffForm({ canGrantAdmin }: { canGrantAdmin: boolean }) {
  const router = useRouter();
  const roleOptions = (canGrantAdmin ? internalRoles : staffRoles)
    .map((role) => ({ value: role, label: roleLabels[role] }));
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [assignedBranches, setAssignedBranches] = useState<string[]>([]);
  const [documents, setDocuments] = useState<Partial<Record<DocumentField, File>>>({});
  const [branchOptions, setBranchOptions] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadBranches() {
      try {
        const data = await listUserBranchOptions();
        if (active) setBranchOptions(data.branches);
      } catch (caughtError) {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "Unable to load branches.");
      }
    }
    void loadBranches();
    return () => { active = false; };
  }, []);

  function setValue<Key extends keyof FormValues>(key: Key, value: FormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function setDocument(field: DocumentField, file?: File) {
    setDocuments((current) => {
      const next = { ...current };
      if (file) next[field] = file;
      else delete next[field];
      return next;
    });
  }

  // Mirrors the server rules so a typo is caught before the upload is sent. The
  // first problem in field order is reported, so the message points somewhere.
  function validate(): string {
    const aadhaarDigits = values.aadhaarNumber.replace(/[\s-]/g, "");

    if (!values.firstName.trim()) return "Enter the first name.";
    if (!values.lastName.trim()) return "Enter the last name.";
    if (!values.email.trim()) return "Enter an email address.";
    if (!staffPatterns.phone.test(values.phone.trim())) return "Enter a valid phone number.";
    if (values.password.length < 8) return "Password must be at least 8 characters.";
    if (isBranchScopedRole(values.role) && !assignedBranches.length) return "Assign at least one branch.";
    if (!values.dateOfJoining) return "Select the date of joining.";
    if (!staffPatterns.aadhaar.test(aadhaarDigits)) return "Enter a valid 12-digit Aadhaar number.";
    if (!documents.aadhaar) return "Upload the Aadhaar document.";

    if (values.dateOfBirth && new Date(values.dateOfBirth) > yearsAgo(MIN_STAFF_AGE_YEARS)) {
      return `Staff must be at least ${MIN_STAFF_AGE_YEARS} years old.`;
    }
    if (values.panNumber && !staffPatterns.pan.test(values.panNumber.trim().toUpperCase())) {
      return "Enter a valid PAN, for example ABCDE1234F.";
    }
    if (values.addressPostalCode && !staffPatterns.postalCode.test(values.addressPostalCode.trim())) {
      return "Enter a valid 6-digit PIN code.";
    }
    if (values.emergencyContactPhone && !staffPatterns.phone.test(values.emergencyContactPhone.trim())) {
      return "Enter a valid emergency contact number.";
    }

    const oversized = Object.values(documents).find((file) => file.size > MAX_DOCUMENT_BYTES);
    if (oversized) return `${oversized.name} is larger than 5 MB.`;

    return "";
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const problem = validate();
    if (problem) {
      setError(problem);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSaving(true);
    setError("");

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

      const created = await createStaff(form);
      router.push(`/dashboard/users/${created.user._id}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to create the staff member.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-5xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/dashboard/users"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-[#0D1282]"
          >
            <FiArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to users
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Add Staff</h1>
          <p className="mt-1 text-sm text-slate-500">
            Creates an active internal login. Fields marked <span className="text-red-600">*</span> are required.
          </p>
        </div>
      </div>

      <FormError message={error} />

      <SectionCard icon={FiUser} title="Personal details" subtitle="Who they are and how to reach them.">
        <div className={staffFieldGrid}>
          <InputField label="First name" required value={values.firstName} onChange={(value) => setValue("firstName", value)} maxLength={60} />
          <InputField label="Last name" required value={values.lastName} onChange={(value) => setValue("lastName", value)} maxLength={60} />
          <InputField label="Email" required type="email" value={values.email} onChange={(value) => setValue("email", value)} helper="Used as the login id." />
          <InputField label="Phone" required value={values.phone} onChange={(value) => setValue("phone", value)} placeholder="+91 98765 43210" maxLength={20} />
          <DateField label="Date of birth" value={values.dateOfBirth} onChange={(value) => setValue("dateOfBirth", value)} helper={`Optional. Must be ${MIN_STAFF_AGE_YEARS} or older.`} />
          <InputField label="Temporary password" required value={values.password} onChange={(value) => setValue("password", value)} helper="At least 8 characters. Share it with the staff member." />
        </div>
      </SectionCard>

      <SectionCard icon={FiBriefcase} title="Role and access" subtitle="What they can reach in the portal.">
        <div className={staffFieldGrid}>
          <SelectField
            label="Role"
            required
            value={values.role}
            options={roleOptions}
            onChange={(value) => setValue("role", value as InternalRole)}
          />
          <DesignationField value={values.designation} onChange={(value) => setValue("designation", value)} />
          <InputField label="Employee code" value={values.employeeCode} onChange={(value) => setValue("employeeCode", value)} placeholder="SL-0142" maxLength={40} />
          <DateField label="Date of joining" required value={values.dateOfJoining} onChange={(value) => setValue("dateOfJoining", value)} />
          <div className="sm:col-span-2">
            {isBranchScopedRole(values.role) ? (
              <BranchField required values={assignedBranches} onChange={setAssignedBranches} options={branchOptions} />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Administrators reach every branch, so no branch assignment is needed.
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard icon={FiFileText} title="Identity documents" subtitle="Aadhaar is required. PDF, JPG, or PNG up to 5 MB.">
        <div className="grid gap-5 sm:grid-cols-2">
          <InputField label="Aadhaar number" required value={values.aadhaarNumber} onChange={(value) => setValue("aadhaarNumber", value)} placeholder="1234 5678 9012" maxLength={14} />
          <InputField label="PAN number" value={values.panNumber} onChange={(value) => setValue("panNumber", value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DocumentUploadField label="Aadhaar document" required file={documents.aadhaar} onChange={(file) => setDocument("aadhaar", file)} />
          <DocumentUploadField label="PAN document" file={documents.pan} onChange={(file) => setDocument("pan", file)} />
          <DocumentUploadField label="Other document" file={documents.other} onChange={(file) => setDocument("other", file)} helper="Offer letter, address proof, or similar." />
        </div>
      </SectionCard>

      <SectionCard icon={FiMapPin} title="Address and emergency contact" subtitle="Optional, but useful for HR records.">
        <div className={staffFieldGrid}>
          <InputField label="Address" value={values.addressLine1} onChange={(value) => setValue("addressLine1", value)} maxLength={160} />
          <InputField label="City" value={values.addressCity} onChange={(value) => setValue("addressCity", value)} maxLength={80} />
          <InputField label="State" value={values.addressState} onChange={(value) => setValue("addressState", value)} maxLength={80} />
          <InputField label="PIN code" value={values.addressPostalCode} onChange={(value) => setValue("addressPostalCode", value)} maxLength={6} />
          <InputField label="Emergency contact name" value={values.emergencyContactName} onChange={(value) => setValue("emergencyContactName", value)} maxLength={80} />
          <InputField label="Emergency contact phone" value={values.emergencyContactPhone} onChange={(value) => setValue("emergencyContactPhone", value)} maxLength={20} />
        </div>
      </SectionCard>

      <div className="flex flex-wrap justify-end gap-3">
        <Link
          href="/dashboard/users"
          className="inline-flex h-10 items-center rounded-4xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282]"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-10 items-center rounded-4xl bg-[#0D1282] px-5 text-sm font-semibold text-white shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63] disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Creating..." : "Create Staff"}
        </button>
      </div>
    </form>
  );
}
