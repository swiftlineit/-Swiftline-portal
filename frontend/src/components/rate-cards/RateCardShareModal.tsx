"use client";

import { useEffect, useState } from "react";
import { FiX } from "react-icons/fi";
import RateCardShareView from "@/components/rate-cards/RateCardShareView";
import type { RateCardShare } from "@/lib/rateCardShares";

/**
 * The rate card as a modal. Deliberately not a page: a rate card is something a
 * client glances at and downloads, and pushing it into the router would lose
 * whatever they were doing behind it.
 */
export default function RateCardShareModal({
  share,
  recipientLabel,
  onClose,
  onDownload,
}: {
  share: RateCardShare;
  recipientLabel: string;
  onClose: () => void;
  onDownload: (format: "pdf" | "xlsx") => Promise<void>;
}) {
  const [downloading, setDownloading] = useState<"" | "pdf" | "xlsx">("");
  const [error, setError] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    // The sheet scrolls inside the panel, so the page behind it must not.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  async function handleDownload(format: "pdf" | "xlsx") {
    setDownloading(format);
    setError("");

    try {
      await onDownload(format);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The document could not be downloaded.");
    } finally {
      setDownloading("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-70 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Rate card ${share.shareNumber}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative my-auto w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close rate card"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          <FiX aria-hidden="true" className="h-5 w-5" />
        </button>

        {error ? (
          <p className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <RateCardShareView
          share={share}
          recipientLabel={recipientLabel}
          downloading={downloading}
          onDownload={(format) => void handleDownload(format)}
        />
      </div>
    </div>
  );
}
