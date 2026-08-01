"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiBriefcase,
  FiCreditCard,
  FiDownload,
  FiEye,
  FiFileText,
  FiMapPin,
  FiShield,
  FiUser
} from "react-icons/fi";
import {
  BranchField,
  DateField,
  DesignationField,
  EditActions,
  EditButton,
  FormError,
  InputField,
  MAX_DOCUMENT_BYTES,
  MIN_STAFF_AGE_YEARS,
  ReadOnlyField,
  SectionCard,
  SelectField,
  StatusPill,
  formatFileSize,
  formatStaffDate,
  staffFieldGrid,
  staffPatterns,
  toDateInputValue,
  yearsAgo
} from "@/components/users/StaffFields";
import {
  internalRoles,
  isBranchScopedRole,
  roleLabels,
  type InternalRole,
  type PortalRole
} from "@/lib/roles";
import {
  downloadStaffDocument,
  fetchStaffDocumentObjectUrl,
  getStaffUser,
  listUserBranchOptions,
  staffDocumentTypes,
  updateStaffUser,
  type StaffDocumentType,
  type User
} from "@/lib/users";

const roleOptions = internalRoles.map((role) => ({ value: role, label: roleLabels[role] }));

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
  { value: "disabled", label: "Disabled" }
];

const documentLabels: Record<StaffDocumentType, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN",
  other: "Other document"
};

type Section = "access" | "personal" | "employment" | "identity" | "contact";

const emptyForm = {
  firstName: "",
  lastName: "",
  phone: "",
  role: "operations",
  userStatus: "active",
  designation: "",
  employeeCode: "",
  dateOfJoining: "",
  dateOfBirth: "",
  panNumber: "",
  addressLine1: "",
  addressCity: "",
  addressState: "",
  addressPostalCode: "",
  emergencyContactName: "",
  emergencyContactPhone: ""
};

// The fields each section owns. Saving sends only these keys, so one section can
// be edited without touching values another section is showing.
const sectionFields: Record<Section, Array<keyof typeof emptyForm>> = {
  access: ["role", "userStatus"],
  personal: ["firstName", "lastName", "phone", "dateOfBirth"],
  employment: ["designation", "employeeCode", "dateOfJoining"],
  identity: ["panNumber"],
  contact: ["addressLine1", "addressCity", "addressState", "addressPostalCode", "emergencyContactName", "emergencyContactPhone"]
};

function toForm(staffUser: User) {
  return {
    firstName: staffUser.firstName || (staffUser.name ?? "").split(" ")[0] || "",
    lastName: staffUser.lastName || (staffUser.name ?? "").split(" ").slice(1).join(" "),
    phone: staffUser.phone ?? "",
    role: staffUser.role,
    userStatus: staffUser.userStatus ?? "active",
    designation: staffUser.staffProfile?.designation ?? "",
    employeeCode: staffUser.staffProfile?.employeeCode ?? "",
    dateOfJoining: toDateInputValue(staffUser.staffProfile?.dateOfJoining),
    dateOfBirth: toDateInputValue(staffUser.staffProfile?.dateOfBirth),
    panNumber: staffUser.staffProfile?.panNumber ?? "",
    addressLine1: staffUser.staffProfile?.address.line1 ?? "",
    addressCity: staffUser.staffProfile?.address.city ?? "",
    addressState: staffUser.staffProfile?.address.state ?? "",
    addressPostalCode: staffUser.staffProfile?.address.postalCode ?? "",
    emergencyContactName: staffUser.staffProfile?.emergencyContact.name ?? "",
    emergencyContactPhone: staffUser.staffProfile?.emergencyContact.phone ?? ""
  };
}

function branchIdsOf(staffUser: User) {
  return staffUser.assignedBranches.map((branch) => branch._id ?? branch.id ?? "").filter(Boolean);
}

function branchLabel(staffUser: User) {
  return staffUser.assignedBranches.map((branch) => `${branch.code} - ${branch.name}`).join(", ");
}

export default function StaffDetail({
  userId,
  canEdit,
  viewerEmail
}: {
  userId: string;
  canEdit: boolean;
  /** Used to spot the viewer's own record; the server refuses self role/status changes. */
  viewerEmail: string;
}) {
  const [staffUser, setStaffUser] = useState<User | null>(null);
  const [branchOptions, setBranchOptions] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Section | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDetail() {
      try {
        const [detail, branchData] = await Promise.all([getStaffUser(userId), listUserBranchOptions()]);
        if (!active) return;
        setStaffUser(detail.user);
        setBranchOptions(branchData.branches);
      } catch (caughtError) {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "Unable to load this staff member.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDetail();
    return () => { active = false; };
  }, [userId]);

  function startEdit(section: Section) {
    if (!staffUser) return;
    setForm(toForm(staffUser));
    setBranches(branchIdsOf(staffUser));
    setError("");
    setNotice("");
    setEditing(section);
  }

  function setValue(key: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validate(section: Section): string {
    if (section === "personal") {
      if (!form.firstName.trim()) return "Enter the first name.";
      if (!form.lastName.trim()) return "Enter the last name.";
      if (!staffPatterns.phone.test(form.phone.trim())) return "Enter a valid phone number.";
      if (form.dateOfBirth && new Date(form.dateOfBirth) > yearsAgo(MIN_STAFF_AGE_YEARS)) {
        return `Staff must be at least ${MIN_STAFF_AGE_YEARS} years old.`;
      }
    }
    if (section === "employment" && !form.dateOfJoining) return "Select the date of joining.";
    if (section === "identity" && form.panNumber && !staffPatterns.pan.test(form.panNumber.trim().toUpperCase())) {
      return "Enter a valid PAN, for example ABCDE1234F.";
    }
    if (section === "contact") {
      if (form.addressPostalCode && !staffPatterns.postalCode.test(form.addressPostalCode.trim())) {
        return "Enter a valid 6-digit PIN code.";
      }
      if (form.emergencyContactPhone && !staffPatterns.phone.test(form.emergencyContactPhone.trim())) {
        return "Enter a valid emergency contact number.";
      }
    }
    if (section === "access" && isBranchScopedRole(form.role) && !branches.length) {
      return "Assign at least one branch.";
    }
    return "";
  }

  async function handleSave(event: FormEvent, section: Section) {
    event.preventDefault();

    const problem = validate(section);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError("");

    try {
      const payload = new FormData();
      const ownRecord = staffUser?.email === viewerEmail;
      // Whatever is shown read-only is left out of the request rather than sent
      // back unchanged: your own role and status, and the role of a client
      // account, which this endpoint does not accept.
      const roleEditable = !ownRecord && (internalRoles as readonly string[]).includes(staffUser?.role ?? "");
      for (const field of sectionFields[section]) {
        if (field === "role" && !roleEditable) continue;
        if (field === "userStatus" && ownRecord) continue;
        payload.append(field, form[field].trim());
      }
      if (section === "access" && isBranchScopedRole(form.role)) {
        for (const branchId of branches) payload.append("assignedBranches", branchId);
      }

      const updated = await updateStaffUser(userId, payload);
      setStaffUser(updated.user);
      setEditing(null);
      setNotice(updated.message || "Staff details updated.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save the changes.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReplaceDocument(type: StaffDocumentType, file?: File) {
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(`${file.name} is larger than 5 MB.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const payload = new FormData();
      payload.append(type, file);
      const updated = await updateStaffUser(userId, payload);
      setStaffUser(updated.user);
      setNotice(`${documentLabels[type]} updated.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to replace the document.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview(type: StaffDocumentType) {
    setError("");
    try {
      const objectUrl = await fetchStaffDocumentObjectUrl(userId, type);
      window.open(objectUrl, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to open the document.");
    }
  }

  async function handleDownload(type: StaffDocumentType, fileName: string) {
    setError("");
    try {
      await downloadStaffDocument(userId, type, fileName);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to download the document.");
    }
  }

  if (loading) {
    return <p className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">Loading staff member...</p>;
  }

  if (!staffUser) {
    return (
      <div className="space-y-4">
        <FormError message={error || "Staff member not found."} />
        <Link href="/dashboard/users" className="text-sm font-semibold text-[#0D1282]">Back to users</Link>
      </div>
    );
  }

  const profile = staffUser.staffProfile;
  const displayName = staffUser.name || [staffUser.firstName, staffUser.lastName].filter(Boolean).join(" ") || staffUser.email;
  // Client accounts belong to the business-account flow, so their role is not
  // changed from here. Changing your own role or login status is refused by the
  // server too, so that an admin cannot lock the last administrator out.
  const editingSelf = staffUser.email === viewerEmail;
  const roleIsEditable = (internalRoles as readonly string[]).includes(staffUser.role) && !editingSelf;

  function sectionAction(section: Section) {
    if (!canEdit) return null;
    if (editing === section) return <EditActions busy={busy} onCancel={() => setEditing(null)} />;
    return editing ? null : <EditButton onClick={() => startEdit(section)} />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <div>
        <Link
          href="/dashboard/users"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-[#0D1282]"
        >
          <FiArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to users
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-slate-950">{displayName}</h1>
            <p className="mt-1 break-all text-sm text-slate-500">{staffUser.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#0D1282]/8 px-2.5 py-1 text-xs font-semibold text-[#0D1282]">
              {roleLabels[staffUser.role as PortalRole] ?? staffUser.role}
            </span>
            <StatusPill status={staffUser.userStatus} />
          </div>
        </div>
      </div>

      <FormError message={error} />
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {notice}
        </div>
      ) : null}

      {!profile ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          This account predates the staff form, so it has no employment record. Role, branches, and login details can still be managed below.
        </div>
      ) : null}

      <form onSubmit={(event) => void handleSave(event, "access")}>
        <SectionCard icon={FiShield} title="Role and access" subtitle="What this person can reach." action={sectionAction("access")}>
          {editing === "access" ? (
            <div className={staffFieldGrid}>
              {roleIsEditable ? (
                <SelectField label="Role" required value={form.role} options={roleOptions} onChange={(value) => setValue("role", value as InternalRole)} />
              ) : (
                <ReadOnlyField label="Role" value={roleLabels[staffUser.role as PortalRole] ?? staffUser.role} locked />
              )}
              {editingSelf ? (
                <ReadOnlyField label="Login status" value={(staffUser.userStatus ?? "").replaceAll("_", " ")} locked />
              ) : (
                <SelectField label="Login status" required value={form.userStatus} options={statusOptions} onChange={(value) => setValue("userStatus", value)} />
              )}
              <div className="sm:col-span-2">
                {isBranchScopedRole(form.role) ? (
                  <BranchField required values={branches} onChange={setBranches} options={branchOptions} />
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Administrators reach every branch, so no branch assignment is needed.
                  </div>
                )}
              </div>
              {editingSelf ? (
                <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">
                  Your own role and login status can only be changed by another administrator.
                </p>
              ) : null}
            </div>
          ) : (
            <dl className={staffFieldGrid}>
              <ReadOnlyField label="Role" value={roleLabels[staffUser.role as PortalRole] ?? staffUser.role} />
              <ReadOnlyField label="Login status" value={(staffUser.userStatus ?? "").replaceAll("_", " ")} />
              <ReadOnlyField label="Verified" value={staffUser.isVerified ? "Yes" : "No"} />
              <div className="sm:col-span-2 lg:col-span-3">
                <ReadOnlyField label="Assigned branches" value={branchLabel(staffUser)} />
              </div>
            </dl>
          )}
        </SectionCard>
      </form>

      <form onSubmit={(event) => void handleSave(event, "personal")}>
        <SectionCard icon={FiUser} title="Personal details" subtitle="Name and contact." action={sectionAction("personal")}>
          {editing === "personal" ? (
            <div className={staffFieldGrid}>
              <InputField label="First name" required value={form.firstName} onChange={(value) => setValue("firstName", value)} maxLength={60} />
              <InputField label="Last name" required value={form.lastName} onChange={(value) => setValue("lastName", value)} maxLength={60} />
              <InputField label="Phone" required value={form.phone} onChange={(value) => setValue("phone", value)} maxLength={20} />
              <DateField label="Date of birth" value={form.dateOfBirth} onChange={(value) => setValue("dateOfBirth", value)} helper="Clear the field to remove it." />
              <ReadOnlyField label="Email" value={staffUser.email} locked />
            </div>
          ) : (
            <dl className={staffFieldGrid}>
              <ReadOnlyField label="First name" value={staffUser.firstName ?? ""} />
              <ReadOnlyField label="Last name" value={staffUser.lastName ?? ""} />
              <ReadOnlyField label="Phone" value={staffUser.phone ?? ""} />
              <ReadOnlyField label="Date of birth" value={formatStaffDate(profile?.dateOfBirth)} />
              <ReadOnlyField label="Email" value={staffUser.email} locked />
              <ReadOnlyField label="Last login" value={formatStaffDate(staffUser.lastLogin)} />
            </dl>
          )}
        </SectionCard>
      </form>

      {profile ? (
        <>
          <form onSubmit={(event) => void handleSave(event, "employment")}>
            <SectionCard icon={FiBriefcase} title="Employment" subtitle="Job title and joining record." action={sectionAction("employment")}>
              {editing === "employment" ? (
                <div className={staffFieldGrid}>
                  <DesignationField value={form.designation} onChange={(value) => setValue("designation", value)} />
                  <InputField label="Employee code" value={form.employeeCode} onChange={(value) => setValue("employeeCode", value)} maxLength={40} />
                  <DateField label="Date of joining" required value={form.dateOfJoining} onChange={(value) => setValue("dateOfJoining", value)} />
                </div>
              ) : (
                <dl className={staffFieldGrid}>
                  <ReadOnlyField label="Designation" value={profile.designation} />
                  <ReadOnlyField label="Employee code" value={profile.employeeCode} />
                  <ReadOnlyField label="Date of joining" value={formatStaffDate(profile.dateOfJoining)} />
                </dl>
              )}
            </SectionCard>
          </form>

          <form onSubmit={(event) => void handleSave(event, "identity")}>
            <SectionCard icon={FiCreditCard} title="Identity" subtitle="Aadhaar is fixed after creation." action={sectionAction("identity")}>
              {editing === "identity" ? (
                <div className={staffFieldGrid}>
                  <ReadOnlyField label="Aadhaar number" value={profile.aadhaarNumber} locked />
                  <InputField label="PAN number" value={form.panNumber} onChange={(value) => setValue("panNumber", value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" />
                </div>
              ) : (
                <dl className={staffFieldGrid}>
                  <ReadOnlyField label="Aadhaar number" value={profile.aadhaarNumber} locked />
                  <ReadOnlyField label="PAN number" value={profile.panNumber} />
                </dl>
              )}
            </SectionCard>
          </form>

          <form onSubmit={(event) => void handleSave(event, "contact")}>
            <SectionCard icon={FiMapPin} title="Address and emergency contact" action={sectionAction("contact")}>
              {editing === "contact" ? (
                <div className={staffFieldGrid}>
                  <InputField label="Address" value={form.addressLine1} onChange={(value) => setValue("addressLine1", value)} maxLength={160} />
                  <InputField label="City" value={form.addressCity} onChange={(value) => setValue("addressCity", value)} maxLength={80} />
                  <InputField label="State" value={form.addressState} onChange={(value) => setValue("addressState", value)} maxLength={80} />
                  <InputField label="PIN code" value={form.addressPostalCode} onChange={(value) => setValue("addressPostalCode", value)} maxLength={6} />
                  <InputField label="Emergency contact name" value={form.emergencyContactName} onChange={(value) => setValue("emergencyContactName", value)} maxLength={80} />
                  <InputField label="Emergency contact phone" value={form.emergencyContactPhone} onChange={(value) => setValue("emergencyContactPhone", value)} maxLength={20} />
                </div>
              ) : (
                <dl className={staffFieldGrid}>
                  <ReadOnlyField label="Address" value={profile.address.line1} />
                  <ReadOnlyField label="City" value={profile.address.city} />
                  <ReadOnlyField label="State" value={profile.address.state} />
                  <ReadOnlyField label="PIN code" value={profile.address.postalCode} />
                  <ReadOnlyField label="Emergency contact" value={profile.emergencyContact.name} />
                  <ReadOnlyField label="Emergency phone" value={profile.emergencyContact.phone} />
                </dl>
              )}
            </SectionCard>
          </form>

          <SectionCard icon={FiFileText} title="Documents" subtitle="Preview or download. Replacing a file removes the copy it supersedes.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {staffDocumentTypes.map((type) => {
                const document = profile.documents[type];
                const inputId = `replace-${type}`;

                return (
                  <div key={type} className="flex flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{documentLabels[type]}</p>

                    {document ? (
                      <>
                        <p className="mt-2 truncate text-sm font-medium text-slate-900" title={document.originalName}>
                          {document.originalName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatFileSize(document.size)} · {formatStaffDate(document.uploadedAt)}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
                          <button type="button" onClick={() => void handlePreview(type)} className="inline-flex items-center gap-1.5 text-[#0D1282] transition hover:underline">
                            <FiEye aria-hidden="true" className="h-3.5 w-3.5" />
                            Review
                          </button>
                          <button type="button" onClick={() => void handleDownload(type, document.originalName)} className="inline-flex items-center gap-1.5 text-[#0D1282] transition hover:underline">
                            <FiDownload aria-hidden="true" className="h-3.5 w-3.5" />
                            Download
                          </button>
                          {canEdit ? (
                            <label htmlFor={inputId} className="cursor-pointer text-slate-600 transition hover:text-[#0D1282]">
                              Replace
                            </label>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mt-2 text-sm text-slate-500">Not uploaded</p>
                        {canEdit ? (
                          <label htmlFor={inputId} className="mt-3 cursor-pointer text-xs font-semibold text-[#0D1282] hover:underline">
                            Upload
                          </label>
                        ) : null}
                      </>
                    )}

                    {canEdit ? (
                      <input
                        id={inputId}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        disabled={busy}
                        onChange={(event) => {
                          void handleReplaceDocument(type, event.target.files?.[0]);
                          event.target.value = "";
                        }}
                        className="sr-only"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
