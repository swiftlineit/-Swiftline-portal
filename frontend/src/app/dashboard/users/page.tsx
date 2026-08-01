"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FiChevronRight } from "react-icons/fi";
import { DashboardLoading } from "@/components/DashboardShell";
import { StatusPill } from "@/components/users/StaffFields";
import { roleLabels, STAFF_DIRECTORY_AREA, type PortalRole } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";
import { listUsers, updateUserStatus, type User, type UserStatus } from "@/lib/users";

// The transitions offered per current status, so the row only shows the moves
// that are actually available from where the account is now.
const statusActionMap: Record<UserStatus, Array<{ label: string; status: UserStatus }>> = {
  invited: [
    { label: "Activate", status: "active" },
    { label: "Suspend", status: "suspended" },
    { label: "Disable", status: "disabled" }
  ],
  active: [
    { label: "Suspend", status: "suspended" },
    { label: "Disable", status: "disabled" }
  ],
  suspended: [
    { label: "Activate", status: "active" },
    { label: "Disable", status: "disabled" }
  ],
  disabled: [{ label: "Activate", status: "active" }]
};

const statusActionTone: Record<UserStatus, string> = {
  active: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
  invited: "border-slate-200 text-slate-700 hover:bg-slate-50",
  suspended: "border-amber-200 text-amber-700 hover:bg-amber-50",
  disabled: "border-red-200 text-red-700 hover:bg-red-50"
};

function branchSummary(item: User) {
  if (item.role === "admin") return "All branches";
  if (item.role === "client") return "Managed through client access";

  const names = item.assignedBranches.map((branch) => branch.code || branch.name).filter(Boolean);
  if (!names.length) return "None";
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

export default function UsersPage() {
  const { user, loading } = useAdminUser(STAFF_DIRECTORY_AREA);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Login status is an admin action. HR reads the directory only, matching the
  // guard on PATCH /users/:id/status.
  const canManageStatus = user?.role === "admin";

  useEffect(() => {
    if (!user) return;
    async function loadUsers() {
      setLoadingUsers(true);
      setError("");
      try {
        setUsers((await listUsers()).users);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load users.");
      } finally {
        setLoadingUsers(false);
      }
    }
    void loadUsers();
  }, [user]);

  async function handleStatusChange(userId: string, status: UserStatus) {
    setBusyUserId(userId);
    setError("");
    try {
      const updated = await updateUserStatus(userId, status);
      setUsers((current) => current.map((item) => item._id === userId ? { ...item, ...updated.user } : item));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update user status.");
    } finally {
      setBusyUserId(null);
    }
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Add internal staff and open a record to review or change their details.
          </p>
        </div>
        <Link
          href="/dashboard/users/new"
          className="inline-flex h-10 items-center rounded-4xl bg-[#0D1282] px-4 text-sm font-semibold text-white shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63]"
        >
          + Add Staff
        </Link>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-3xl text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="whitespace-nowrap px-5 py-4">Name</th>
              <th className="whitespace-nowrap px-5 py-4">Role</th>
              <th className="whitespace-nowrap px-5 py-4">Assigned Branches</th>
              <th className="whitespace-nowrap px-5 py-4">Staff Details</th>
              <th className="whitespace-nowrap px-5 py-4">Status</th>
              <th className="whitespace-nowrap px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loadingUsers ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading users...</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">No users found.</td>
              </tr>
            ) : users.map((item) => (
              <tr key={item._id} className="border-b border-slate-100 align-middle last:border-b-0 hover:bg-slate-50/60">
                <td className="px-5 py-4">
                  <Link href={`/dashboard/users/${item._id}`} className="font-medium text-slate-900 transition hover:text-[#0D1282]">
                    {item.name || "-"}
                  </Link>
                </td>

                <td className="whitespace-nowrap px-5 py-4">
                  <span className="inline-flex items-center rounded-full bg-[#0D1282]/8 px-2.5 py-1 text-xs font-semibold text-[#0D1282]">
                    {roleLabels[item.role as PortalRole] ?? item.role}
                  </span>
                </td>

                <td className="px-5 py-4 text-slate-700">{branchSummary(item)}</td>

                <td className="px-5 py-4">
                  <div className="space-y-0.5 text-xs text-slate-600">
                    <p className="break-all font-medium text-slate-900">{item.email}</p>
                    {item.staffProfile?.designation ? <p>{item.staffProfile.designation}</p> : null}
                    {item.phone ? <p>{item.phone}</p> : null}
                    {item.staffProfile?.employeeCode ? <p>Code: {item.staffProfile.employeeCode}</p> : null}
                  </div>
                </td>

                <td className="whitespace-nowrap px-5 py-4"><StatusPill status={item.userStatus} /></td>

                <td className="whitespace-nowrap px-5 py-4">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {/* Your own login is not suspendable from here, so an admin
                        cannot lock themselves out of the portal. */}
                    {canManageStatus && item.userStatus && item.email !== user.email
                      ? statusActionMap[item.userStatus].map((action) => (
                        <button
                          key={`${item._id}-${action.status}`}
                          type="button"
                          disabled={busyUserId === item._id}
                          onClick={() => void handleStatusChange(item._id, action.status)}
                          className={`h-8 rounded-full border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${statusActionTone[action.status]}`}
                        >
                          {action.label}
                        </button>
                      ))
                      : null}

                    <Link
                      href={`/dashboard/users/${item._id}`}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-[#0D1282] transition hover:underline"
                    >
                      View
                      <FiChevronRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
