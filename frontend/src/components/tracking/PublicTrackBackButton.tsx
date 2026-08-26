"use client";

import { usePathname } from "next/navigation";
import PortalBackButton from "@/components/PortalBackButton";

/**
 * Public tracking result back control.
 *
 * Mounted in the public tracking layout so it appears on every /track/* page
 * (including the result page that the shell wraps). Hidden on the /track
 * index itself so it does not point at itself.
 */
export default function PublicTrackBackButton() {
  const pathname = usePathname() ?? "";
  // Only show on result pages (/track/<number>); hide on /track itself.
  const isResult = pathname.startsWith("/track/") && pathname !== "/track" && pathname !== "/track/";
  if (!isResult) return null;
  return (
    <div className="mb-2">
      <PortalBackButton fallbackHref="/track" ariaLabel="Back to tracking search" />
    </div>
  );
}
