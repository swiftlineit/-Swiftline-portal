import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicBusinessAccountSuccess from "@/components/public-business-account/PublicBusinessAccountSuccess";

export const metadata: Metadata = {
  title: "Business Account Success Preview",
  robots: { index: false, follow: false },
};

export default function BusinessAccountSuccessPreviewRoute() {
  // This route is deliberately available only during local development. It
  // must never look like a real submitted account in a deployed environment.
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <PublicBusinessAccountSuccess
      accountId="PREVIEW-SLC-000001"
      companyName="Swiftline Demo Logistics"
      email="demo@swiftline.example"
    />
  );
}
