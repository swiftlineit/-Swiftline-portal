"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import TicketDetail from "@/components/tickets/TicketDetail";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientTicketDetailPage() {
  const { user, loading } = useClientUser(); const params = useParams<{ ticketId: string }>();
  if (loading || !user) return <ClientDashboardLoading />;
  return <div className="mx-auto max-w-7xl"><Link href="/client/tickets" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-900"><FiArrowLeft />Support Tickets</Link><TicketDetail audience="client" ticketId={params.ticketId} /></div>;
}
