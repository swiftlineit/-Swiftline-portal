"use client";

import { Suspense } from "react";
import { FiAlertOctagon, FiCalendar, FiEye } from "react-icons/fi";
import { DashboardLoading } from "@/components/DashboardShell";
import CalendarEntriesManager from "@/components/operations-advisory/CalendarEntriesManager";
import ServiceDisruptionsManager from "@/components/operations-advisory/ServiceDisruptionsManager";
import OperationsCalendarView from "@/components/operations-advisory/OperationsCalendarView";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  listCalendarEntries,
  listServiceDisruptions,
  type CalendarEntry,
  type ServiceDisruption
} from "@/lib/operationsAdvisory";

type Tab = "disruptions" | "calendar";

const tabMeta: Record<Tab, { label: string; icon: typeof FiCalendar }> = {
  disruptions: { label: "Service Disruption Centre", icon: FiAlertOctagon },
  calendar: { label: "Holiday & Cut-Off Calendar", icon: FiCalendar }
};

export default function OperationsAdvisoryPage() {
  // useSearchParams opts the tree into client rendering, so the boundary has to
  // sit above it or the build fails on prerender.
  return (
    <Suspense fallback={<DashboardLoading message="Loading Operations Advisory..." />}>
      <OperationsAdvisoryContent />
    </Suspense>
  );
}

function OperationsAdvisoryContent() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);
  const searchParams = useSearchParams();

  // The header calendar icon deep-links here with ?tab=calendar. Tab state is
  // kept local so clicking the tabs never rewrites the URL, but a navigation
  // that changes the query (e.g. clicking the header icon again) adjusts the
  // tab during render using React's store-info-from-previous-renders pattern.
  const [tab, setTab] = useState<Tab>(() => searchParams.get("tab") === "calendar" ? "calendar" : "disruptions");
  const [previousSearchParams, setPreviousSearchParams] = useState(searchParams);
  if (searchParams !== previousSearchParams) {
    setPreviousSearchParams(searchParams);
    setTab(searchParams.get("tab") === "calendar" ? "calendar" : "disruptions");
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">Operations Advisory</h1>
        <p className="mt-1 text-sm text-slate-500">
          Publish service disruptions and maintain the Holiday & Cut-Off Calendar shown to clients.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-slate-200">
        {(Object.keys(tabMeta) as Tab[]).map((key) => {
          const meta = tabMeta[key];
          const Icon = meta.icon;
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
                active
                  ? "border-[#0D1282] text-[#0D1282]"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {tab === "disruptions" ? (
        <ServiceDisruptionsManager />
      ) : (
        <>
          <CalendarEntriesManager />
          <PreviewStrip />
        </>
      )}
    </>
  );
}

/**
 * A staff-only look at exactly what the client calendar page renders. Reuses the
 * same read-only view component with a small fetch wrapper so admins can verify
 * an entry before it reaches clients.
 */
function PreviewStrip() {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [disruptions, setDisruptions] = useState<ServiceDisruption[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [entryData, disruptionData] = await Promise.all([
          listCalendarEntries({ active: true }),
          listServiceDisruptions({ scope: "live" })
        ]);
        if (!active) return;
        setEntries(entryData.entries);
        setDisruptions(disruptionData.disruptions);
        setError("");
      } catch (caughtError) {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Preview could not be loaded.");
      }
    }

    void load();
    return () => { active = false; };
  }, []);

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center gap-2">
        <FiEye aria-hidden="true" className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Client preview</h2>
      </div>
      {error ? (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      ) : (
        <OperationsCalendarView entries={entries} disruptions={disruptions} />
      )}
    </section>
  );
}
