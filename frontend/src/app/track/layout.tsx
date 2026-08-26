import Image from "next/image";
import Link from "next/link";
import { FiExternalLink, FiHeadphones } from "react-icons/fi";
import PublicTrackBackButton from "@/components/tracking/PublicTrackBackButton";

/**
 * Chrome for the one part of the portal that signed-out people see.
 *
 * Standalone rather than the dashboard shell: a consignee has no account, so a
 * sidebar of links they cannot open would be noise at best. Everything here is
 * a plain link, so the page renders and navigates with no JavaScript at all.
 */
export default function PublicTrackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-clip bg-slate-50">
      <div className="h-1 bg-[#0D1282]" />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
          {/* Logo */}
          <Link
            href="/track"
            className="flex min-w-0 shrink-0 items-center"
            aria-label="Swiftline Cargo tracking"
          >
            <Image
              src="/swiftline-invoice-logo.png"
              alt="Swiftline Cargo"
              width={140}
              height={58}
              priority
              className="h-9 w-auto object-contain sm:h-12 lg:h-14"
            />
          </Link>

          {/* Right side */}
          <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-4">
            {/* Contact */}
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0D1282]/6 text-[#0D1282] sm:flex">
                <FiHeadphones className="h-4.25 w-4.25" />
              </span>

              <div className="min-w-0 text-right sm:text-left">
                <a
                  href="tel:+917027116600"
                  className="block whitespace-nowrap text-[11px] font-semibold leading-4 text-[#0D1282] transition hover:text-[#d71920] sm:text-sm"
                >
                  +91 70271 16600
                </a>

                <a
                  href="mailto:Info@swiftlinefreight.com"
                  className="block max-w-33.75 truncate text-[9px] leading-4 text-slate-500 transition hover:text-[#0D1282] sm:max-w-none sm:text-xs"
                >
                  Info@swiftlinefreight.com
                </a>
              </div>
            </div>

            {/* Divider */}
            <div className="h-8 w-px shrink-0 bg-slate-200 sm:h-10" />

            {/* Website */}
            <a
              href="https://swiftlinefreight.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Visit swiftlinefreight.com"
              title="swiftlinefreight.com"
              className="group flex shrink-0 items-center gap-3 rounded-xl transition"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#d71920]/[0.07] text-[#d71920] transition duration-200 group-hover:bg-[#d71920] group-hover:text-white sm:h-10 sm:w-10">
                <FiExternalLink className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
              </span>

              {/* Hidden on mobile */}
              <div className="hidden md:block">
                <p className="whitespace-nowrap text-sm font-semibold text-[#0D1282] transition group-hover:text-[#d71920]">
                  swiftlinefreight.com
                </p>

                <p className="mt-0.5 text-xs text-slate-500">
                  Visit our website
                </p>
              </div>
            </a>
          </div>
        </div>
      </header>

      <main className="w-full min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <PublicTrackBackButton />
        </div>
        {children}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="leading-5">
            © {new Date().getFullYear()} Swiftline Cargo. All rights reserved.
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/privacy-policy"
              className="font-medium text-slate-600 transition hover:text-[#0D1282]"
            >
              Privacy policy
            </Link>

            <a
              href="https://wa.me/917027606600"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-slate-600 transition hover:text-[#0D1282]"
            >
              Contact Swiftline
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}