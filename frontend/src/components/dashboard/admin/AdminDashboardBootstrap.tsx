"use client";

import { BarsSkeleton, KpiCardSkeleton, RowsSkeleton, Shimmer, panelSurface } from "@/components/dashboard/DashboardWidgets";

export default function AdminDashboardBootstrap() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#EEEDED]/60">
      <div className="h-1 shrink-0 bg-[#0D1282]" />
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
          <div className="flex h-20 items-center gap-3 border-b border-slate-200 px-3">
            <Shimmer surface="light" className="h-10 w-10 rounded-lg" />
            <Shimmer surface="light" className="h-4 w-24" />
          </div>
          <div className="space-y-2 px-3 py-6">
            {Array.from({ length: 9 }).map((_, index) => <Shimmer key={index} surface="light" className="h-11 w-full rounded-lg" />)}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-20 shrink-0 items-center justify-end gap-4 border-b border-slate-200 bg-white px-8">
            <Shimmer surface="light" className="h-10 w-10 rounded" />
            <Shimmer surface="light" className="h-4 w-32" />
            <Shimmer surface="light" className="h-10 w-24 rounded-lg" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#EEEDED]/60 p-6 lg:p-8">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
              <div className={`p-6 ${panelSurface}`}>
                <Shimmer surface="light" className="h-4 w-40" />
                <Shimmer surface="light" className="mt-4 h-7 w-64" />
                <Shimmer surface="light" className="mt-3 h-3 w-full max-w-xl" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => <KpiCardSkeleton key={index} />)}
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className={`p-5 lg:col-span-2 ${panelSurface}`}>
                  <Shimmer surface="light" className="h-4 w-48" />
                  <div className="mt-5"><BarsSkeleton rows={8} /></div>
                </div>
                <div className={`p-5 ${panelSurface}`}>
                  <Shimmer surface="light" className="h-4 w-32" />
                  <div className="mt-5"><RowsSkeleton rows={5} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
