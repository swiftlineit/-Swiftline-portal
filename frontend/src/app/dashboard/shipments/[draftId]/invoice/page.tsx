"use client";

import { useParams } from "next/navigation";
import ShipmentInvoicePage from "@/components/shipments/ShipmentInvoicePage";

export default function AdminShipmentInvoiceRoute() {
  const params = useParams<{ draftId: string }>();
  return <ShipmentInvoicePage draftId={params.draftId} audience="admin" />;
}
