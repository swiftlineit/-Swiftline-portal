import Image from "next/image";
import Link from "next/link";

/**
 * Chrome for the one part of the portal that signed-out people see.
 *
 * Standalone rather than the dashboard shell: a consignee has no account, so a
 * sidebar of links they cannot open would be noise at best. Everything here is
 * a plain link, so the page renders and navigates with no JavaScript at all.
 */
export default function PublicTrackLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="h-1 bg-[#0D1282]" />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/track" className="flex items-center gap-3" aria-label="Swiftline Cargo tracking">
            <Image
              src="/swiftline-invoice-logo.png"
              alt="Swiftline Cargo"
              width={140}
              height={58}
              priority
              className="h-11 w-auto object-contain sm:h-15"
            />
          </Link>

          <Link
            href="/"
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] sm:h-10 sm:px-4 sm:text-sm"
          >
            Portal sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1   ">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Swiftline Cargo. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/privacy-policy" className="font-medium text-slate-600 hover:text-[#0D1282]">
              Privacy policy
            </Link>
            <a
              href="https://wa.me/917027606600"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-slate-600 hover:text-[#0D1282]"
            >
              Contact Swiftline
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
