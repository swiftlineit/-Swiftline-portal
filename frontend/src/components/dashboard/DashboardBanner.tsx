"use client";

import { useEffect, useMemo, useState } from "react";
import { FiImage } from "react-icons/fi";
import {
  getDashboardBannerImage,
  getDashboardBanners,
  type DashboardBanner as DashboardBannerData,
} from "@/lib/dashboardBanner";

type BannerSlide = {
  banner: DashboardBannerData;
  imageSrc: string;
};

export default function DashboardBanner() {
  const [slides, setSlides] = useState<BannerSlide[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await getDashboardBanners();

        const visibleBanners = result.banners.filter(
          (banner) => banner.visible,
        );

        const loadedSlides = await Promise.all(
          visibleBanners.map(async (banner) => {
            const image = await getDashboardBannerImage(banner.id);
            const imageSrc = URL.createObjectURL(image);

            objectUrls.push(imageSrc);

            return {
              banner,
              imageSrc,
            };
          }),
        );

        if (!active) return;

        setSlides(loadedSlides);
        setCurrentIndex(0);
      } catch (caught) {
        if (!active) return;

        setError(
          caught instanceof Error
            ? caught.message
            : "Banner could not be loaded.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    const timer = window.setTimeout(() => void load(), 0);

    return () => {
      active = false;
      window.clearTimeout(timer);

      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (slides.length < 2) return undefined;

    const timer = window.setInterval(() => {
      setCurrentIndex((index) => (index + 1) % slides.length);
    }, 6000);

    return () => window.clearInterval(timer);
  }, [slides.length]);

  const slide = slides[currentIndex] ?? null;

  const slideLabel = useMemo(() => {
    if (!slide) return "Dashboard banner";

    return slide.banner.heading || "Swiftline dashboard update";
  }, [slide]);

  if (loading) {
    return (
      <div
        aria-label="Loading dashboard banner"
        className="min-h-[180px] animate-pulse rounded-xl bg-slate-100 sm:min-h-[190px] lg:min-h-[220px]"
      />
    );
  }

  if (!slide) {
    return (
      <section
        aria-label="Dashboard banner"
        className="flex min-h-[180px] flex-col justify-between rounded-xl border border-slate-200 bg-[linear-gradient(135deg,#f8f9fd_0%,#f1f3fb_100%)] p-5 sm:min-h-[190px] lg:min-h-[220px]"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0D1282]/[0.08] text-[#0D1282]">
          <FiImage
            aria-hidden="true"
            className="h-[18px] w-[18px]"
          />
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-900">
            No updates right now
          </p>

          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
            New service messages will appear here when published.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Dashboard banner"
      className="group relative min-h-[180px] overflow-hidden rounded-xl bg-slate-900 sm:min-h-[190px] lg:min-h-[220px]"
    >
      {/* Banner image */}
      <img
        src={slide.imageSrc}
        alt={slideLabel}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.015]"
      />

      {/* Readability overlays */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.78)_0%,rgba(2,6,23,0.5)_42%,rgba(2,6,23,0.12)_72%,rgba(2,6,23,0.05)_100%)]"
      />

      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(0deg,rgba(2,6,23,0.38)_0%,transparent_60%)]"
      />

      {/* Banner copy */}
      <div className="relative z-10 flex min-h-[180px] flex-col justify-end px-5 py-5 text-white sm:min-h-[190px] sm:px-6 sm:py-5 lg:min-h-[220px]">
        <div className="max-w-[420px]">
          {slide.banner.heading ? (
            <h2 className="text-[19px] font-semibold leading-[1.25] tracking-[-0.02em] text-white sm:text-xl">
              {slide.banner.heading}
            </h2>
          ) : null}

          {slide.banner.description ? (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-white/80 sm:text-sm">
              {slide.banner.description}
            </p>
          ) : null}

          {slides.length > 1 ? (
            <div
              className="mt-3 flex items-center gap-1.5"
              aria-label={`Banner ${currentIndex + 1} of ${slides.length}`}
            >
              {slides.map((item, index) => (
                <button
                  key={item.banner.id}
                  type="button"
                  onClick={() => setCurrentIndex(index)}
                  aria-label={`Show banner ${index + 1}`}
                  aria-current={
                    index === currentIndex ? "true" : undefined
                  }
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    index === currentIndex
                      ? "w-6 bg-white"
                      : "w-1.5 bg-white/40 hover:bg-white/70"
                  }`}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="absolute left-4 right-4 top-4 z-30 rounded-lg bg-white px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}