import type { Metadata } from "next";
import PublicTrackingResult from "@/components/tracking/PublicTrackingResult";
import { normalizeTrackingNumber, trackPublicShipment } from "@/lib/publicTracking";

/**
 * Route shell for /track/[trackingNumber].
 *
 * Fetching, metadata and routing live here; everything rendered lives in
 * `PublicTrackingResult`, so the design can be edited without touching any of
 * this. A server component on purpose - the consignee usually arrives from a
 * forwarded link, so the status has to be in the first paint and the page has to
 * work with JavaScript off.
 */
type PageProps = { params: Promise<{ trackingNumber: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { trackingNumber } = await params;
  const awb = normalizeTrackingNumber(decodeURIComponent(trackingNumber));

  return {
    title: `Track ${awb} - Swiftline Cargo`,
    description: `Live tracking, customs progress and estimated delivery for Swiftline shipment ${awb}.`,
    /**
     * Never indexed, and this matters more rather than less now that the card is
     * open to anyone with the number: these pages are thin, they go stale within
     * days, and Swiftline AWBs are sequential enough to walk. Letting a crawler
     * archive them would put shipment detail into search results permanently.
     *
     * robots.ts deliberately does not disallow /track/ - a blocked path is never
     * fetched, so this tag would never be read.
     */
    robots: { index: false, follow: false, nocache: true },
    alternates: { canonical: "/track" }
  };
}

export default async function PublicTrackResultPage({ params }: PageProps) {
  const { trackingNumber } = await params;
  const awb = normalizeTrackingNumber(decodeURIComponent(trackingNumber));

  return <PublicTrackingResult lookup={await trackPublicShipment(awb)} requestedNumber={awb} />;
}
