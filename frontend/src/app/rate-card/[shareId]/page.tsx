"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { FiAlertCircle } from "react-icons/fi";
import { BsWhatsapp } from "react-icons/bs";
import RateCardShareView from "@/components/rate-cards/RateCardShareView";
import {
  downloadPublicRateCardShareDocument,
  getPublicRateCardShare,
  type RateCardShare,
} from "@/lib/rateCardShares";

/**
 * The rate card as an emailed or WhatsApped recipient sees it. No session is
 * involved: the token in the query string is the whole credential, so this page
 * shows the sheet and nothing else about the portal.
 */
export default function PublicRateCardPage() {
  // useSearchParams opts the tree into client rendering, so the boundary has to
  // sit above it or the build fails on prerender.
  return (
    <Suspense fallback={<PublicRateCardShell><p className="py-24 text-center text-sm font-semibold text-[#0D1282]">Loading rate card...</p></PublicRateCardShell>}>
      <PublicRateCard />
    </Suspense>
  );
}

function PublicRateCardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1 bg-[#0D1282]" />
      <main className="mx-auto w-full max-w-8xl px-4 py-8 sm:px-20 sm:py-12">{children}</main>
    </div>
  );
}

function PublicRateCard() {
  const params = useParams<{ shareId: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const requestedDownload = searchParams.get("download");

  // A link missing either half is not a fetch that failed, it is a link that
  // was never usable. Deriving it during render keeps the effect free to do the
  // one thing it is for: talking to the API.
  const linkIncomplete = !params.shareId || !token;

  const [share, setShare] = useState<RateCardShare | null>(null);
  const [recipientLabel, setRecipientLabel] = useState("Valued Customer");
  const [downloading, setDownloading] = useState<"" | "pdf" | "xlsx">("");
  const [fetchError, setFetchError] = useState("");
  const [loading, setLoading] = useState(!linkIncomplete);

  const error = linkIncomplete
    ? "This rate card link is incomplete. Please use the full link you were sent."
    : fetchError;
  // `?download=pdf` on the WhatsApp links fires exactly once, and never again on
  // a re-render or a React strict-mode double mount.
  const autoDownloaded = useRef(false);

  const download = useCallback(
    async (format: "pdf" | "xlsx", shareNumber: string) => {
      setDownloading(format);
      setFetchError("");

      try {
        await downloadPublicRateCardShareDocument(params.shareId, token, format, shareNumber);
      } catch (caught) {
        setFetchError(caught instanceof Error ? caught.message : "The document could not be downloaded.");
      } finally {
        setDownloading("");
      }
    },
    [params.shareId, token],
  );

  useEffect(() => {
    if (linkIncomplete) return;

    let active = true;

    async function loadShare() {
      try {
        const result = await getPublicRateCardShare(params.shareId, token);
        if (!active) return;

        setShare(result.share);
        setRecipientLabel(result.recipientLabel);
        setLoading(false);

        if (!autoDownloaded.current && (requestedDownload === "pdf" || requestedDownload === "excel")) {
          autoDownloaded.current = true;
          await download(requestedDownload === "pdf" ? "pdf" : "xlsx", result.share.shareNumber);
        }
      } catch (caught) {
        if (!active) return;
        setFetchError(caught instanceof Error ? caught.message : "This rate card could not be opened.");
        setLoading(false);
      }
    }

    const start = window.setTimeout(() => void loadShare(), 0);

    return () => {
      active = false;
      window.clearTimeout(start);
    };
  }, [linkIncomplete, params.shareId, token, requestedDownload, download]);

  return (
    <PublicRateCardShell>
      <>
        {loading ? (
          <p className="py-24 text-center justify-center align-middle text-sm font-semibold text-[#0D1282]">Loading rate card...</p>
        ) : null}

        {!loading && !share ? (
          <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <FiAlertCircle className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">This rate card is unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
            <a
              href="https://wa.me/917027606600"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white transition hover:bg-[#1ea952]"
            >
              <BsWhatsapp className="h-4 w-4" />
              Request the latest rates
            </a>
          </div>
        ) : null}

        {share ? (
          <>
            {error ? (
              <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {error}
              </p>
            ) : null}

            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <RateCardShareView
                share={share}
                recipientLabel={recipientLabel}
                downloading={downloading}
                onDownload={(format) => void download(format, share.shareNumber)}
              />
            </div>

            <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <p>Swiftline · {share.shareNumber}</p>
              <a
                href="https://wa.me/917027606600"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-semibold text-[#0D1282] hover:underline"
              >
                <BsWhatsapp className="h-3.5 w-3.5 text-emerald-600" />
                Talk to us about these rates
              </a>
            </footer>
          </>
        ) : null}
      </>
    </PublicRateCardShell>
  );
}
