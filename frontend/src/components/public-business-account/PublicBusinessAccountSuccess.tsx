import Link from "next/link";
import Image from "next/image";
import { FiArrowLeft, FiArrowRight } from "react-icons/fi";

export default function PublicBusinessAccountSuccess({
  accountId,
  companyName,
  email,
}: {
  accountId: string;
  companyName: string;
  email: string;
}) {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-10 mt-20 sm:px-6">
      <section className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200  shadow-[0_10px_30px_rgba(15,23,42,0.07)]">
        <div className="bg-amber-100/30 px-6 py-8 text-center sm:px-8 sm:py-9">
          <div className="mx-auto flex h-42 w-42 items-center justify-center ">
            <Image
              src="/success circle check.svg"
              alt=""
              aria-hidden="true"
              width={148}
              height={148}
              unoptimized
              className="h-42 w-42 object-contain"
            />
          </div>

          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
            Request submitted
          </h1>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
            Your business account request is now under review. Our team will
            verify your details and documents and notify you by email.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2.5 border-t border-slate-100 px-6 py-5 sm:flex-row sm:justify-center">
          <Link
            href="/request/business-account"
            className="inline-flex h-9 min-w-[140px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <FiArrowLeft className="h-3.5 w-3.5" />
            Back to Business Account
          </Link>

          <a
            href="https://swiftlinefreight.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 min-w-[140px] items-center justify-center gap-2 rounded-lg bg-[#0D1282] px-4 text-xs font-semibold text-white transition hover:bg-[#0A0F6D]"
          >
            Visit Swiftline
            <FiArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>
    </main>
  );
}
