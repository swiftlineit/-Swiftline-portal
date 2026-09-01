import type { Metadata } from "next";
import PublicBusinessAccountPage from "@/components/public-business-account/PublicBusinessAccountForm";
import { siteUrl } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "Request a Business Account — Swiftline Cargo",
  description:
    "Apply for a Swiftline business account to book international cargo and courier shipments. Fast verification, transparent KYC, and dedicated support.",
  alternates: { canonical: "/request/business-account" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Request a Business Account — Swiftline Cargo",
    description:
      "Apply for a Swiftline business account to book international cargo and courier shipments.",
    url: siteUrl("/request/business-account"),
    siteName: "Swiftline Cargo",
    type: "website"
  }
};

export default function RequestBusinessAccountRoute() {
  return <PublicBusinessAccountPage />;
}
