"use client";
import { DashboardLoading } from "@/components/DashboardShell";
import PodManagementBoard from "@/components/pods/PodManagementBoard";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";
export default function PodPage() { const { user, loading } = useAdminUser(OPERATIONS_AREA); if (loading || !user) return <DashboardLoading />; return <PodManagementBoard operationsControls />; }
