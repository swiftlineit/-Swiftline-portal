import type { Metadata } from "next";
import PublicTrackingLanding from "@/components/tracking/PublicTrackingLanding";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Route shell for /track. All of the page lives in `PublicTrackingLanding`, so
 * the design can be edited in one place without touching routing or metadata.
 */
export const metadata: Metadata = {
  title: "Track Shipment Online | Swiftline Cargo",
  description:
    "Track a Swiftline Cargo or SLC shipment online with the AWB number printed on your label. "
    + "See live status, customs progress and estimated delivery without signing in.",
  alternates: { canonical: "/track" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Track Shipment Online | Swiftline Cargo",
    description:
      "Enter your Swiftline or SLC tracking number to see shipment status and estimated delivery.",
    url: siteUrl("/track"),
    siteName: "Swiftline Cargo",
    type: "website"
  }
};

export default function PublicTrackLandingPage() {
  return <PublicTrackingLanding />;
}
