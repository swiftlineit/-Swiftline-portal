"use client";

import { useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { toast } from "react-toastify";
import { formatCreditMoney } from "@/lib/creditAccounts";
import {
  deleteDraftFlightCostSheet,
  listFlightCostDrafts,
  type FlightCostDraftSummary
} from "@/lib/profitability";

export default function FlightCostDraftsPanel() {
  const [drafts, setDrafts] = useState<FlightCostDraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const result = await listFlightCostDrafts();
    setDrafts(result.sheets);
    setError("");
  }

  useEffect(() => {
    let active = true;
    listFlightCostDrafts()
      .then((result) => {
        if (!active) return;
        setDrafts(result.sheets);
        setError("");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Flight cost drafts could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function removeDraft(draft: FlightCostDraftSummary) {
    const confirmed = window.confirm(
      `Delete draft ${draft.manifestNumber}? This removes its provisional allocations and restores the shipment profitability values. Only draft sheets can be deleted.`
    );
    if (!confirmed) return;

    setDeletingId(draft.id);
    try {
      const result = await deleteDraftFlightCostSheet(draft.id);
      toast.success(result.message);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The draft flight cost sheet could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div>
          <h1 className="font-bold text-slate-950">Flight cost drafts</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Remove provisional cost sheets that were created by mistake. Finalized, review-required, and cancelled records are retained for audit.
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">Drafts only</span>
      </div>

      {error ? (
        <div role="alert" className="mx-5 mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-y border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3">Manifest</th>
              <th className="px-4 py-3">Flight</th>
              <th className="px-4 py-3">Destination</th>
              <th className="px-4 py-3 text-right">Weight</th>
              <th className="px-4 py-3 text-right">Parcels</th>
              <th className="px-4 py-3 text-right">Provisional cost</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-slate-500">Loading flight cost drafts…</td>
              </tr>
            ) : drafts.length ? (
              drafts.map((draft) => (
                <tr key={draft.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#0D1282]">{draft.manifestNumber}</p>
                    <p className="text-xs text-slate-500">{draft.mawbNumber}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{draft.airlineName}</p>
                    <p className="text-xs text-slate-500">{draft.flightNumber} · {draft.flightDate}</p>
                  </td>
                  <td className="px-4 py-3">{draft.destinationCountryName}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{draft.billedWeightKg.toFixed(3)} kg</td>
                  <td className="px-4 py-3 text-right tabular-nums">{draft.totalParcels}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatCreditMoney(draft.totals.totalCostMinor, "INR")}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(draft.updatedAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void removeDraft(draft)}
                      disabled={deletingId === draft.id}
                      aria-label={`Delete draft cost sheet ${draft.manifestNumber}`}
                      className="inline-flex h-11 items-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                    >
                      <FiTrash2 aria-hidden="true" /> {deletingId === draft.id ? "Deleting…" : "Delete draft"}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-slate-500">No draft flight cost sheets found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
