"use client";

import Link from "next/link";
import { FiArchive, FiArrowRight } from "react-icons/fi";
import { EmptyState, SectionCard } from "@/components/dashboard/DashboardWidgets";
import { type DashboardOverview } from "@/lib/dashboardOverview";

export default function AdminRecentManifestsCard({
  overview,
  refreshing
}: {
  overview: DashboardOverview | null;
  refreshing: boolean;
}) {
  const manifests = overview?.manifests ?? null;
  const dim = refreshing ? "opacity-60" : "opacity-100";
  if (!manifests) return null;

  return (
    <SectionCard
      icon={FiArchive}
      title="Recent manifests"
      subtitle="Latest packing lists across your branches"
      action={
        <Link
          href="/dashboard/operations-manifests"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0D1282] hover:underline"
        >
          View all
          <FiArrowRight aria-hidden="true" className="h-3 w-3" />
        </Link>
      }
    >
      {manifests.recent.length ? (
        <ul className={`grid grid-cols-1 gap-3 transition-opacity duration-200 sm:grid-cols-2 xl:grid-cols-3 ${dim}`}>
          {manifests.recent.map((manifest) => (
            <li key={manifest.id}>
              <Link
                href={`/dashboard/operations-manifests/${manifest.id}`}
                className="block h-full rounded-xl bg-slate-50 px-3.5 py-3 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{manifest.manifestNumber}</span>
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {manifest.status.replaceAll("_", " ")}
                  </span>
                </span>
                <span className="mt-1 block truncate text-xs text-slate-500">
                  {manifest.totalConsignments} consignments, {manifest.totalWeightKg} kg
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">
                  {manifest.header.destinationCountryName || "Destination pending"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={FiArchive}
          title="No manifests yet"
          message="Start a manifest to begin packing bags and scanning parcels."
          actionLabel="New manifest"
          actionHref="/dashboard/operations-manifests/new"
        />
      )}
    </SectionCard>
  );
}
