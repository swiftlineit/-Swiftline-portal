import type { Metadata } from "next";
import PublicTrackingLanding from "@/components/tracking/PublicTrackingLanding";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Route shell for /track. All of the page lives in `PublicTrackingLanding`, so
 * the design can be edited in one place without touching routing or metadata.
 */
export const metadata: Metadata = {
  title: "Swiftline Tracking | Track Shipment by AWB Number",
  description:
    "Track your Swiftline Cargo shipment online using your AWB or SLC tracking number. See live shipment status, customs progress and estimated delivery.",
  alternates: { canonical: "/track" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Swiftline Tracking | Track Shipment by AWB Number",
    description:
      "Track your Swiftline Cargo shipment using your AWB or SLC tracking number and see live shipment status, customs progress and estimated delivery.",
    url: siteUrl("/track"),
    siteName: "Swiftline Cargo",
    type: "website"
  }
};

export default function PublicTrackLandingPage() {
  return <PublicTrackingLanding />;
}
