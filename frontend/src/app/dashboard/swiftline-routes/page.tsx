"use client";

import { DashboardLoading } from "@/components/DashboardShell";
import SwiftlineRoutesManager from "@/components/swiftline-routes/SwiftlineRoutesManager";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function SwiftlineRoutesPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);

  if (loading || !user) return <DashboardLoading />;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">Swiftline Routes</h1>
        <p className="mt-1 text-sm text-slate-500">
          The lanes Swiftline operates and how long each takes. Transit times set here produce
          the estimated delivery date on every shipment.
        </p>
      </div>

      <SwiftlineRoutesManager />
    </>
  );
}
