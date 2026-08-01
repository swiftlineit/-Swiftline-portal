"use client";

import { useParams } from "next/navigation";
import CustomsInvoicePage from "@/components/shipments/CustomsInvoicePage";

export default function ClientCustomsInvoiceRoute() {
  const params = useParams<{ draftId: string }>();
  return <CustomsInvoicePage draftId={params.draftId} audience="client" />;
}
