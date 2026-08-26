"use client";

import { useParams } from "next/navigation";
import { DashboardLoading } from "@/components/DashboardShell";
import TicketDetail from "@/components/tickets/TicketDetail";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminTicketDetailPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA); const params = useParams<{ ticketId: string }>();
  if (loading || !user) return <DashboardLoading />;
  return <div className="mx-auto max-w-7xl"><TicketDetail audience="admin" ticketId={params.ticketId} /></div>;
}
