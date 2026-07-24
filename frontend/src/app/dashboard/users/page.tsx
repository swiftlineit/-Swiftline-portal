"use client";

import { useEffect, useState } from "react";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
import { useAdminUser } from "@/lib/useAdminUser";
import {
  listUserBranchOptions,
  listUsers,
  portalRoles,
  type PortalRole,
  updateUserAccess,
  updateUserStatus,
  type User,
  type UserStatus
} from "@/lib/users";

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

function formatStatus(status?: UserStatus) {
  return status ? status.replaceAll("_", " ") : "Unknown";
}

export default function UsersPage() {
  const { user, loading } = useAdminUser();
  const [users, setUsers] = useState<User[]>([]);
  const [branchOptions, setBranchOptions] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    async function loadUsers() {
      setLoadingUsers(true);
      setError("");
      try {
        const [userData, branchData] = await Promise.all([listUsers(), listUserBranchOptions()]);
        setUsers(userData.users);
        setBranchOptions(branchData.branches);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load users.");
      } finally {
        setLoadingUsers(false);
      }
    }
    void loadUsers();
  }, [user]);

  function replaceUser(updated: User) {
    setUsers((current) => current.map((item) => item._id === updated._id ? updated : item));
  }

  async function handleStatusChange(userId: string, status: User["userStatus"]) {
    setBusyUserId(userId);
    setError("");
    try {
      replaceUser((await updateUserStatus(userId, status)).user);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update user status.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleAccessChange(userId: string, role: PortalRole, assignedBranches: string[]) {
    setBusyUserId(userId);
    setError("");
    try {
      replaceUser((await updateUserAccess(userId, role, assignedBranches)).user);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update user access.");
    } finally {
      setBusyUserId(null);
    }
  }

  if (loading || !user) return <BusinessAccountsLoading />;

  return (
    <BusinessAccountsShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">Users</h1>
        <p className="mt-1 text-sm text-slate-500">Manage portal roles, branch access, and login status.</p>
      </div>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="min-w-[1180px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Assigned Branches</th>
              <th className="px-4 py-3">Verified</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadingUsers ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading users...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No users found.</td></tr>
            ) : users.map((item) => {
              const assignedBranchIds = item.assignedBranches.map((branch) => branch._id ?? branch.id ?? "").filter(Boolean);
              return (
                <tr key={item._id} className="border-b border-slate-100 align-top last:border-b-0">
                  <td className="px-4 py-3">{item.name || "-"}</td>
                  <td className="px-4 py-3">{item.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={item.role}
                      disabled={busyUserId === item._id}
                      onChange={(event) => {
                        const role = event.target.value as PortalRole;
                        void handleAccessChange(item._id, role, ["admin", "client"].includes(role) ? [] : assignedBranchIds);
                      }}
                      className="h-10 min-w-36 border border-slate-300 bg-white px-3 text-sm capitalize outline-none focus:border-blue-900 disabled:bg-slate-100"
                    >
                      {portalRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </td>
                  <td className="min-w-64 px-4 py-3">
                    {["admin", "client"].includes(item.role) ? (
                      <span className="text-xs text-slate-500">{item.role === "admin" ? "All branches" : "Managed through client access"}</span>
                    ) : (
                      <select
                        multiple
                        value={assignedBranchIds}
                        disabled={busyUserId === item._id}
                        onChange={(event) => void handleAccessChange(
                          item._id,
                          item.role,
                          Array.from(event.target.selectedOptions, (option) => option.value)
                        )}
                        aria-label={`Assigned branches for ${item.name || item.email}`}
                        className="h-20 w-full border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-900 disabled:bg-slate-100"
                      >
                        {branchOptions.map((branch) => (
                          <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">{item.isVerified ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 capitalize">{formatStatus(item.userStatus)}</td>
                  <td className="px-4 py-3">
                    {item.userStatus ? (
                      <select
                        defaultValue=""
                        disabled={busyUserId === item._id}
                        onChange={(event) => {
                          const status = event.target.value as User["userStatus"];
                          if (status) void handleStatusChange(item._id, status);
                          event.target.value = "";
                        }}
                        className="h-10 min-w-40 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-900 disabled:bg-slate-100"
                      >
                        <option value="" disabled>Status</option>
                        {statusActionMap[item.userStatus].map((action) => (
                          <option key={`${item._id}-${action.status}`} value={action.status}>{action.label}</option>
                        ))}
                      </select>
                    ) : <span className="text-sm text-slate-500">No actions</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </BusinessAccountsShell>
  );
}
