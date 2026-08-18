import type { Metadata } from "next";
import PublicTrackingLanding from "@/components/tracking/PublicTrackingLanding";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Route shell for /track. All of the page lives in `PublicTrackingLanding`, so
 * the design can be edited in one place without touching routing or metadata.
 */
export const metadata: Metadata = {
  title: "Track a Swiftline Cargo shipment",
  description:
    "Track your Swiftline Cargo shipment with the AWB number printed on your label. "
    + "Live status, customs progress and estimated delivery - no sign-in needed.",
  alternates: { canonical: "/track" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Track a Swiftline Cargo shipment",
    description:
      "Enter your Swiftline tracking number to see where your parcel is and when it should arrive.",
    url: siteUrl("/track"),
    siteName: "Swiftline Cargo",
    type: "website"
  }
};

export default function PublicTrackLandingPage() {
  return <PublicTrackingLanding />;
}
