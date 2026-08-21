"use client";

import { useEffect, useState } from "react";
import { FiAlertTriangle, FiCalendar } from "react-icons/fi";
import {
  ClientDashboardLoading
} from "@/components/client/ClientDashboardShell";
import OperationsCalendarView from "@/components/operations-advisory/OperationsCalendarView";
import { useClientUser } from "@/lib/useClientUser";
import {
  listClientCalendarEntries,
  listClientRegulatoryUpdates,
  listClientServiceDisruptions,
  type CalendarEntry,
  type RegulatoryUpdate,
  type ServiceDisruption
} from "@/lib/operationsAdvisory";

/**
 * The Holiday & Cut-Off Calendar a client sees: branch and destination
 * holidays, customs closures, cut-off and flight closing times, weekend
 * delivery availability, peak season restrictions and live service
 * disruptions- all grouped by category by the shared read-only view.
 */
export default function ClientOperationsCalendarPage() {
  const { user, loading: userLoading } = useClientUser();
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [disruptions, setDisruptions] = useState<ServiceDisruption[]>([]);
  const [regulatoryUpdates, setRegulatoryUpdates] = useState<RegulatoryUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (userLoading || !user) return;
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [entryData, disruptionData, regulatoryData] = await Promise.all([
          listClientCalendarEntries(),
          listClientServiceDisruptions(),
          listClientRegulatoryUpdates()
        ]);
        if (!active) return;
        setEntries(entryData.entries);
        setDisruptions(disruptionData.disruptions);
        setRegulatoryUpdates(regulatoryData.updates);
      } catch (caughtError) {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "The calendar could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [user, userLoading]);

  if (userLoading || !user) return <ClientDashboardLoading />;

  return (
    <div className="mx-auto flex max-w-300 flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-950">
            <FiCalendar aria-hidden="true" className="h-6 w-6 text-[#0D1282]" />
            Holiday & Cut-Off Calendar
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Branch and destination holidays, cut-off times, weekend delivery, customs &amp; regulatory changes and live service updates.
          </p>
        </div>
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-xl border border-[#D71313]/25 bg-[#D71313]/[0.06] px-4 py-3 text-sm font-medium text-[#D71313]">
          <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <p className="text-sm font-semibold text-[#0D1282]">Loading calendar...</p>
        </div>
      ) : (
        <OperationsCalendarView entries={entries} disruptions={disruptions} regulatoryUpdates={regulatoryUpdates} />
      )}
    </div>
  );
}
