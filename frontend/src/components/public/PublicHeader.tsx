"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiGlobe, FiMail, FiPhone } from "react-icons/fi";

export default function PublicHeader() {
  const pathname = usePathname();
  const isTrack = pathname?.startsWith("/track");
  const isBusiness = pathname?.startsWith("/request/business-account");

  const trackClass = isTrack
    ? "rounded-full  px-3 py-1.5 tracking-wider font-semibold text-white shadow-sm"
    : "rounded-full px-3 py-1.5 text-white/80 hover:bg-white/10 hover:text-white";
  const businessClass = isBusiness
    ? "rounded-full  px-3 py-1.5 font-semibold text-white shadow-sm"
    : "rounded-full px-3 py-1.5 text-white/80 hover:bg-white/10 hover:text-white";

  const trackMobileClass = isTrack
    ? "rounded-full bg-white px-3 py-1 font-semibold text-[#12185A]"
    : "rounded-full px-3 py-1 hover:bg-white/10 hover:text-white";
  const businessMobileClass = isBusiness
    ? "rounded-full bg-white px-3 py-1 font-semibold text-[#12185A]"
    : "rounded-full px-3 py-1 hover:bg-white/10 hover:text-white";

  return (
    <>
      <div className="h-1 bg-[#0D1282]" />
      <header className="border-b border-white/10 bg-[#12185A]">
        <div className="mx-auto flex  max-w-7xl items-center justify-between gap-3  py-3 ">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-3"
            aria-label="Swiftline Cargo"
          >
            <Image
              src="/slc_white_logo.png"
              alt="Swiftline Cargo"
              width={80}
              height={100}
              priority
              className="h-9 w-auto object-contain sm:h-15"
            />
            <span className="hidden text-xs font-semibold leading-tight text-white sm:block">
              SWIFTLINE
              <br />
              <span className="font-normal text-white/70">Cargo & Express</span>
            </span>
          </Link>

          <nav
            aria-label="Public"
            className="hidden items-center gap-1 text-lg font-medium sm:flex"
          >
            <Link href="/track" className={trackClass}>
              Track
            </Link>
            <Link href="/request/business-account" className={businessClass}>
              Business account
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden lg:flex items-center gap-3">
              <div className="flex flex-col items-end gap-1 text-right">
                <a
                  href="tel:+917027116600"
                  className="inline-flex items-center tracking-wider gap-1.5 text-xs font-semibold leading-none text-white hover:text-white/90"
                >
                  <FiPhone
                    className="h-3 w-3 text-white/70"
                    aria-hidden="true"
                  />
                  +91 70271 16600
                </a>
                <a
                  href="mailto:Info@swiftlinefreight.com"
                  className="inline-flex items-center tracking-wider gap-1.5 text-xs leading-none text-white/70 hover:text-white"
                >
                  <FiMail
                    className="h-3 w-3 text-white/60"
                    aria-hidden="true"
                  />
                  Info@swiftlinefreight.com
                </a>
              </div>
              <span className="h-8 w-px bg-white/10" aria-hidden="true" />
              <a
                href="https://swiftlinefreight.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 tracking-wider rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs text-white transition hover:bg-white/10"
              >
                <FiGlobe className="h-3 w-3 text-white/80" aria-hidden="true" />
                swiftlinefreight.com
              </a>
            </div>

            <a
              href="tel:+917027116600"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white hover:bg-white/10 lg:hidden"
              aria-label="Call +91 70271 16600"
            >
              <FiPhone className="h-4 w-4" aria-hidden="true" />
            </a>

            <Link
              href="/"
              className="inline-flex items-center rounded-full bg-white px-4 py-2 text-xs font-bold text-[#12185A] transition hover:bg-white/90"
            >
              Sign in
            </Link>
          </div>
        </div>

        <nav
          aria-label="Public mobile"
          className="flex items-center justify-center gap-2 border-t border-white/10 bg-[#0F144F] px-4 py-2 text-xs font-medium sm:hidden"
        >
          <Link href="/track" className={trackMobileClass}>
            Track
          </Link>
          <span className="text-white/20">•</span>
          <Link
            href="/request/business-account"
            className={businessMobileClass}
          >
            Business account
          </Link>
        </nav>
      </header>
    </>
  );
}
