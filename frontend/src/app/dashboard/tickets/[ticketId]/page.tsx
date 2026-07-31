"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";
import { DashboardLoading } from "@/components/DashboardShell";
import TicketDetail from "@/components/tickets/TicketDetail";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminTicketDetailPage() {
  const { user, loading } = useAdminUser(); const params = useParams<{ ticketId: string }>();
  if (loading || !user) return <DashboardLoading />;
  return <div className="mx-auto max-w-7xl"><Link href="/dashboard/tickets" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-900"><FiArrowLeft />Support Tickets</Link><TicketDetail audience="admin" ticketId={params.ticketId} /></div>;
}
