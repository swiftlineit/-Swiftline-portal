"use client";

import { useParams } from "next/navigation";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import TicketDetail from "@/components/tickets/TicketDetail";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientTicketDetailPage() {
  const { user, loading } = useClientUser(); const params = useParams<{ ticketId: string }>();
  if (loading || !user) return <ClientDashboardLoading />;
  return <div className="mx-auto max-w-7xl"><TicketDetail audience="client" ticketId={params.ticketId} /></div>;
}
