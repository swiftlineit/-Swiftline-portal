import Link from "next/link";

export default function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-8xl flex-col gap-3 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-12">
        <p className="leading-5">
          © {new Date().getFullYear()} Swiftline Cargo and Express Logistics Pvt Ltd. All rights reserved.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/privacy-policy"
            className="font-medium text-slate-600 transition hover:text-[#0D1282]"
          >
            Privacy policy
          </Link>
          <a
            href="https://swiftlinefreight.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-600 transition hover:text-[#0D1282]"
          >
            swiftlinefreight.com
          </a>
          <a
            href="mailto:Info@swiftlinefreight.com"
            className="font-medium text-slate-600 transition hover:text-[#0D1282]"
          >
            Info@swiftlinefreight.com
          </a>
        </div>
      </div>
    </footer>
  );
}
