"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  BusinessAccount,
  BusinessAccountMember,
  BusinessAccountMemberRole,
  businessAccountMemberRoles,
  createBusinessAccountClientAccess,
  listBusinessAccountMembers,
  resendBusinessAccountInvitation
} from "@/lib/businessAccounts";
import { formatDashboardDateTime } from "@/lib/dateFormat";

const roleLabels: Record<BusinessAccountMemberRole, string> = {
  account_owner: "Account Owner",
  account_admin: "Account Admin",
  operations: "Operations",
  finance: "Finance",
  tracking_only: "Tracking Only"
};

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "account_owner" as BusinessAccountMemberRole,
  assignedBranches: [] as string[],
  sendInvitationEmail: true
};

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value?: string | null) {
  return value ? formatDashboardDateTime(value) : "Never";
}

function getAssignedBranch(account: BusinessAccount) {
  return account.assignedBranch && typeof account.assignedBranch === "object"
    ? account.assignedBranch
    : null;
}

function getAssignedBranchLabel(account: BusinessAccount) {
  const branch = getAssignedBranch(account);
  if (!branch) return "No branch assigned";
  return `${branch.name || "Branch"}${branch.code ? ` (${branch.code})` : ""}`;
}

export function BusinessAccountAccessPanel({ account }: { account: BusinessAccount }) {
  const [members, setMembers] = useState<BusinessAccountMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [emailNotice, setEmailNotice] = useState("");
  const canCreateClientLogin = ["approved", "active"].includes(account.status)
    && account.kycReview?.overallStatus === "verified"
    && Boolean(getAssignedBranch(account));
  const assignedBranch = getAssignedBranch(account);

  useEffect(() => {
    let mounted = true;

    async function loadAccessData() {
      setLoading(true);
      setError("");

      try {
        const memberResult = await listBusinessAccountMembers(account.accountId);

        if (!mounted) return;
        setMembers(memberResult.members);
      } catch (caughtError) {
        if (!mounted) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load client access.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadAccessData();
    return () => {
      mounted = false;
    };
  }, [account.accountId]);

  function updateForm<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  async function handleCreateClientLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setEmailNotice("");

    try {
      const result = await createBusinessAccountClientAccess(account.accountId, {
        ...form,
        assignedBranches: assignedBranch?._id ? [assignedBranch._id] : []
      });
      setMembers((current) => [result.member, ...current]);
      setEmailNotice(result.emailSent ? "Invitation email sent." : "Email was skipped. Check SMTP configuration and backend logs.");
      setForm(emptyForm);
      setModalOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to create client login.");
    } finally {
      setSaving(false);
    }
  }

  async function handleResendInvitation(memberId: string) {
    setSaving(true);
    setError("");
    setEmailNotice("");

    try {
      const result = await resendBusinessAccountInvitation(account.accountId, memberId);
      setEmailNotice(result.emailSent ? "Invitation email sent." : "Email was skipped. Check SMTP configuration and backend logs.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to resend invitation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-slate-200 bg-white p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Users & Access</h2>
          <p className="mt-1 text-sm text-slate-500">Create client logins without storing passwords in the business account record.</p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={!canCreateClientLogin}
          className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-950 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Create Client Login
        </button>
      </div>

      {!canCreateClientLogin ? (
        <div className="mt-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Client login creation unlocks after the account is approved or active, KYC is verified, and one branch is assigned.
        </div>
      ) : null}

      {emailNotice ? (
        <div className="mt-4 border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
          {emailNotice}
        </div>
      ) : null}

      {error ? <div className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="mt-5 overflow-x-auto border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Branches</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last Login</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading access...</td></tr>
            ) : members.length ? members.map((member) => (
              <tr key={member._id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{member.user.name || `${member.user.firstName} ${member.user.lastName}`.trim()}</p>
                  <p className="mt-1 text-xs text-slate-500">{member.user.email}</p>
                </td>
                <td className="px-4 py-3 font-semibold text-slate-700">{roleLabels[member.role]}</td>
                <td className="px-4 py-3 text-slate-600">
                  {member.assignedBranches.length ? member.assignedBranches.map((branch) => branch.code || branch.name).join(", ") : getAssignedBranchLabel(account)}
                </td>
                <td className="px-4 py-3 capitalize text-slate-600">{formatStatus(member.status)}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(member.user.lastLogin)}</td>
                <td className="px-4 py-3">
                  {member.status === "invited" ? (
                    <button
                      type="button"
                      onClick={() => void handleResendInvitation(member._id)}
                      disabled={saving}
                      className="text-sm font-semibold text-blue-900 disabled:text-slate-400"
                    >
                      Resend Invitation
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-slate-400">No actions</span>
                  )}
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No client users have been added yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <form onSubmit={handleCreateClientLogin} className="w-full max-w-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-950">Create Client Login</h3>
                <p className="mt-1 text-sm text-slate-500">The client receives an activation link and creates their own password.</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="text-sm font-semibold text-slate-500">Close</button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <AccessField label="First Name" value={form.firstName} onChange={(value) => updateForm("firstName", value)} required />
              <AccessField label="Last Name" value={form.lastName} onChange={(value) => updateForm("lastName", value)} required />
              <AccessField label="Email" type="email" value={form.email} onChange={(value) => updateForm("email", value)} required />
              <AccessField label="Phone Number" value={form.phone} onChange={(value) => updateForm("phone", value)} />
              <label className="block">
                <span className="sr-only">Client Role</span>
                <select
                  value={form.role}
                  onChange={(event) => updateForm("role", event.target.value as BusinessAccountMemberRole)}
                  className="block h-12 w-full border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                >
                  {businessAccountMemberRoles.map((role) => (
                    <option key={role} value={role}>{roleLabels[role]}</option>
                  ))}
                </select>
              </label>
              <label className="flex h-12 items-center gap-3 border border-slate-300 px-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.sendInvitationEmail}
                  onChange={(event) => updateForm("sendInvitationEmail", event.target.checked)}
                  className="h-4 w-4"
                />
                Send Invitation Email
              </label>
            </div>

            <div className="mt-5 border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Assigned Branch</p>
              <p className="mt-2 text-sm text-slate-600">{getAssignedBranchLabel(account)}</p>
              <p className="mt-1 text-xs text-slate-500">Client login access is restricted to the business account assigned branch.</p>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setModalOpen(false)} className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">
                {saving ? "Creating..." : "Create Login"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function AccessField({
  label,
  value,
  onChange,
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={`${label}${required ? " *" : ""}`}
        onChange={(event) => onChange(event.target.value)}
        className="block h-12 w-full border border-slate-300 px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}
