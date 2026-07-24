"use client";

import { BusinessAccount } from "@/lib/businessAccounts";
import { Branch } from "@/lib/branches";
import { useDialog } from "@/lib/useDialog";

// Shared assign-branch dialog used by the accounts list and the branch detail
// page. Rendered only while open, so the dialog hook can own focus management.
export function AssignBranchModal({
  account,
  branches,
  branchSearch,
  selectedBranchId,
  branchesLoading,
  updating,
  onSearchChange,
  onSelectBranch,
  onCancel,
  onAssign
}: {
  account: BusinessAccount;
  branches: Branch[];
  branchSearch: string;
  selectedBranchId: string;
  branchesLoading: boolean;
  updating: boolean;
  onSearchChange: (value: string) => void;
  onSelectBranch: (value: string) => void;
  onCancel: () => void;
  onAssign: () => Promise<void>;
}) {
  const dialogRef = useDialog<HTMLDivElement>(true, onCancel);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0D1282]/30 px-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Assign branch"
        tabIndex={-1}
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none"
      >
        <div className="rounded-t-2xl border-b border-slate-100 bg-[#EEEDED]/50 px-5 py-4">
          <h2 className="text-lg font-bold text-[#0D1282]">Assign Branch</h2>
          <p className="mt-1 text-sm text-slate-500">
            {account.company.companyName} - {account.accountId}
          </p>
        </div>

        <div className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-slate-700">
            Search Branch
            <input
              value={branchSearch}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Branch name, code, city, country"
              className="mt-2 block h-10 w-full rounded-lg border border-slate-200 bg-[#EEEDED]/50 px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#0D1282] focus:bg-white focus:ring-2 focus:ring-[#0D1282]/15"
            />
          </label>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
            {branchesLoading ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Loading active branches...</p>
            ) : branches.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No active branches found.</p>
            ) : branches.map((branch) => (
              <label
                key={branch._id}
                className={`flex cursor-pointer items-start gap-3 border-b border-slate-100 px-4 py-3 transition last:border-b-0 ${
                  selectedBranchId === branch._id ? "bg-[#0D1282]/5" : "bg-white hover:bg-[#EEEDED]/40"
                }`}
              >
                <input
                  type="radio"
                  name="assignedBranch"
                  checked={selectedBranchId === branch._id}
                  onChange={() => onSelectBranch(branch._id)}
                  className="mt-1 h-4 w-4 accent-[#0D1282]"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{branch.name}</span>
                  <span className="mt-1 block text-xs font-semibold text-[#0D1282]">{branch.code}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {[branch.address.city, branch.address.countryName].filter(Boolean).join(", ") || "Location not set"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 rounded-b-2xl border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={updating}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onAssign()}
            disabled={!selectedBranchId || updating}
            className="rounded-lg bg-[#0D1282] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updating ? "Assigning..." : "Assign Branch"}
          </button>
        </div>
      </div>
    </div>
  );
}
