"use client";

import { useEffect, useMemo, useState } from "react";
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
        className="h-full min-h-[210px] animate-pulse bg-slate-100 sm:min-h-[220px] lg:min-h-[240px]"
      />
    );
  }

  // Hide the banner section completely when there are no uploaded/visible banners.
  if (!slide) return null;

  return (
    <section
      aria-label="Dashboard banner"
      className="group relative h-full min-h-[210px] overflow-hidden bg-slate-900 sm:min-h-[220px] lg:min-h-[240px]"
    >
      {/* Banner image fills the complete banner side of the dashboard header. */}
      <img
        src={slide.imageSrc}
        alt={slideLabel}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.025]"
      />

      {/* Keep uploaded artwork visible while giving the copy enough contrast. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent"
      />

      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/25 to-transparent"
      />

      {/* Banner copy */}
      <div className="relative z-10 flex h-full min-h-[210px] flex-col justify-end px-5 py-5 text-white sm:min-h-[220px] sm:px-6 sm:py-6 lg:min-h-[240px] lg:px-7 lg:py-7">
        <div className="max-w-[520px]">
          {slide.banner.heading ? (
            <h2 className="text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] text-white drop-shadow-sm sm:text-[21px] lg:text-[22px]">
              {slide.banner.heading}
            </h2>
          ) : null}

          {slide.banner.description ? (
            <p className="mt-1.5 line-clamp-2 max-w-[480px] text-[13px] leading-5 text-white/85 sm:text-sm">
              {slide.banner.description}
            </p>
          ) : null}

          {slides.length > 1 ? (
            <div
              className="mt-4 flex items-center gap-1.5"
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
                      ? "w-7 bg-white"
                      : "w-1.5 bg-white/45 hover:bg-white/75"
                  }`}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="absolute left-4 right-4 top-4 z-30 rounded-lg border border-red-100 bg-white/95 px-3 py-2 text-xs font-medium text-red-700 shadow-sm backdrop-blur-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
