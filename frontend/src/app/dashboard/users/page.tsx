"use client";

import { useEffect, useState } from "react";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
import { useAdminUser } from "@/lib/useAdminUser";
import { listUsers, updateUserStatus, User, UserStatus } from "@/lib/users";

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
  disabled: [
    { label: "Activate", status: "active" }
  ]
};

function formatStatus(status?: UserStatus) {
  if (!status) return "Unknown";
  return status.replaceAll("_", " ");
}

export default function UsersPage() {
  const { user, loading } = useAdminUser();
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

    async function loadUsers() {
      setLoadingUsers(true);
      setError("");

      try {
        const data = await listUsers();
        setUsers(data.users);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load users.");
      } finally {
        setLoadingUsers(false);
      }
    }

    void loadUsers();
  }, [user]);

  async function handleStatusChange(userId: string, status: User["userStatus"]) {
    setBusyUserId(userId);
    setError("");

    try {
      const data = await updateUserStatus(userId, status);
      setUsers((current) => current.map((item) => (item._id === userId ? data.user : item)));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update user status.");
    } finally {
      setBusyUserId(null);
    }
  }

  if (loading || !user) return <BusinessAccountsLoading />;

  return (
    <BusinessAccountsShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">Users</h1>
        <p className="mt-1 text-sm text-slate-500">View and manage registered users.</p>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Verified</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadingUsers ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Loading users...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((item) => (
                <tr key={item._id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3">{item.name || "—"}</td>
                  <td className="px-4 py-3">{item.email}</td>
                  <td className="px-4 py-3 capitalize">{item.role}</td>
                  <td className="px-4 py-3">{item.isVerified ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 capitalize">{formatStatus(item.userStatus)}</td>
                  <td className="px-4 py-3">
                    {item.userStatus ? (
                      <select
                        defaultValue=""
                        disabled={busyUserId === item._id}
                        onChange={(event) => {
                          const status = event.target.value as User["userStatus"];
                          if (!status) return;
                          void handleStatusChange(item._id, status);
                          event.target.value = "";
                        }}
                        className="h-10 min-w-45 border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                      >
                        <option value="" disabled>
                          status
                        </option>
                        {statusActionMap[item.userStatus].map((action) => (
                          <option key={`${item._id}-${action.status}`} value={action.status}>
                            {action.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-slate-500">No actions</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </BusinessAccountsShell>
  );
}
