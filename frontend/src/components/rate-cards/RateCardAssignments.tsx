"use client";

import { useEffect, useMemo, useState } from "react";
import RateCardAssignmentPanel from "@/components/business-accounts/RateCardAssignmentPanel";
import {
  listRateCardAssignmentAccounts,
  type RateCardAssignmentAccount,
} from "@/lib/countryRateCards";

export default function RateCardAssignments() {
  const [accounts, setAccounts] = useState<RateCardAssignmentAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void listRateCardAssignmentAccounts()
      .then((result) => {
        if (!active) return;
        setAccounts(result.accounts);
        setSelectedId((current) => current || result.accounts[0]?._id || "");
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Business accounts could not be loaded."); });
    return () => { active = false; };
  }, []);

  const selected = useMemo(() => accounts.find((account) => account._id === selectedId) ?? null, [accounts, selectedId]);

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#0D1282]">Business Account Assignments</h2>
          <p className="mt-1 text-sm text-slate-600">Finance and operations can change only accounts in their assigned branches; administrators can manage all branches.</p>
        </div>
        <label className="min-w-72">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Business account</span>
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#0D1282]">
            {!accounts.length ? <option value="">No branch accounts available</option> : null}
            {accounts.map((account) => (
              <option key={account._id} value={account._id}>
                {account.company.companyName || account.accountId} - {account.accountId}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
      {selected ? (
        <RateCardAssignmentPanel
          key={selected._id}
          account={selected}
          onAssigned={(updated) => setAccounts((current) => current.map((account) => account._id === selected._id
            ? { ...account, rateCardBand: updated.rateCardBand ?? null }
            : account))}
        />
      ) : null}
    </section>
  );
}
