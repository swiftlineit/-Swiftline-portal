import type { ReactNode } from "react";

/**
 * Flag emoji cannot be used here: Windows ships no country-flag glyphs, so a
 * regional-indicator pair renders as two plain letters in Chrome and Edge. A native
 * `<option>` also accepts text only, so flags have to be drawn as inline SVG and
 * shown in a custom listbox.
 *
 * Each flag is drawn for a 20x14 badge, where fine detail is invisible anyway.
 */
const stripes = [0, 2, 4, 6, 8, 10, 12];

const flags: Record<string, ReactNode> = {
  IN: (
    <>
      <rect width="20" height="14" fill="#FF9933" />
      <rect y="4.67" width="20" height="4.66" fill="#FFFFFF" />
      <rect y="9.33" width="20" height="4.67" fill="#138808" />
      <circle cx="10" cy="7" r="1.7" fill="none" stroke="#046A38" strokeWidth="0.55" />
    </>
  ),
  AE: (
    <>
      <rect width="20" height="4.67" fill="#00732F" />
      <rect y="4.67" width="20" height="4.66" fill="#FFFFFF" />
      <rect y="9.33" width="20" height="4.67" fill="#000000" />
      <rect width="5" height="14" fill="#FF0000" />
    </>
  ),
  US: (
    <>
      <rect width="20" height="14" fill="#FFFFFF" />
      {stripes.map((y) => <rect key={y} y={y} width="20" height="1" fill="#B22234" />)}
      <rect width="8.5" height="7.5" fill="#3C3B6E" />
    </>
  ),
  GB: (
    <>
      <rect width="20" height="14" fill="#012169" />
      <path d="M0 0 20 14M20 0 0 14" stroke="#FFFFFF" strokeWidth="2.8" />
      <path d="M0 0 20 14M20 0 0 14" stroke="#C8102E" strokeWidth="1.5" />
      <path d="M10 0v14M0 7h20" stroke="#FFFFFF" strokeWidth="4.6" />
      <path d="M10 0v14M0 7h20" stroke="#C8102E" strokeWidth="2.7" />
    </>
  ),
  SG: (
    <>
      <rect width="20" height="7" fill="#ED2939" />
      <rect y="7" width="20" height="7" fill="#FFFFFF" />
      <circle cx="4.4" cy="3.5" r="2.3" fill="#FFFFFF" />
      <circle cx="5.7" cy="3.5" r="2.3" fill="#ED2939" />
      <circle cx="7.6" cy="2.3" r="0.5" fill="#FFFFFF" />
      <circle cx="7.6" cy="4.7" r="0.5" fill="#FFFFFF" />
    </>
  ),
  CA: (
    <>
      <rect width="20" height="14" fill="#FFFFFF" />
      <rect width="5" height="14" fill="#D80621" />
      <rect x="15" width="5" height="14" fill="#D80621" />
      <path d="M10 3.1l.85 1.95 1.95-.6-.9 2.05.95.5-2.05 1.25.35 1.05-1.65-.3v1.7h-.7v-1.7l-1.65.3.35-1.05L5.2 7l.95-.5-.9-2.05 1.95.6z" fill="#D80621" />
    </>
  ),
  AU: (
    <>
      <rect width="20" height="14" fill="#00247D" />
      <path d="M5 0v7M0 3.5h10" stroke="#FFFFFF" strokeWidth="2.4" />
      <path d="M5 0v7M0 3.5h10" stroke="#C8102E" strokeWidth="1.3" />
      <circle cx="5" cy="11" r="1" fill="#FFFFFF" />
      <circle cx="14.5" cy="3" r="0.6" fill="#FFFFFF" />
      <circle cx="17" cy="6" r="0.6" fill="#FFFFFF" />
      <circle cx="14.5" cy="9.5" r="0.6" fill="#FFFFFF" />
      <circle cx="12.5" cy="6.4" r="0.45" fill="#FFFFFF" />
    </>
  ),
  SA: (
    <>
      <rect width="20" height="14" fill="#006C35" />
      <rect x="3" y="5.3" width="14" height="0.9" fill="#FFFFFF" />
      <rect x="3.6" y="7.8" width="11" height="0.7" fill="#FFFFFF" />
    </>
  ),
  DE: (
    <>
      <rect width="20" height="4.67" fill="#000000" />
      <rect y="4.67" width="20" height="4.66" fill="#DD0000" />
      <rect y="9.33" width="20" height="4.67" fill="#FFCE00" />
    </>
  ),
  FR: (
    <>
      <rect width="6.67" height="14" fill="#002395" />
      <rect x="6.67" width="6.66" height="14" fill="#FFFFFF" />
      <rect x="13.33" width="6.67" height="14" fill="#ED2939" />
    </>
  ),
  NL: (
    <>
      <rect width="20" height="4.67" fill="#AE1C28" />
      <rect y="4.67" width="20" height="4.66" fill="#FFFFFF" />
      <rect y="9.33" width="20" height="4.67" fill="#21468B" />
    </>
  ),
  CN: (
    <>
      <rect width="20" height="14" fill="#EE1C25" />
      <path d="M3.6 2l.62 1.9h2l-1.62 1.18.62 1.9L3.6 5.8 1.98 6.98l.62-1.9L.98 3.9h2z" fill="#FFDE00" />
      <circle cx="7.4" cy="1.7" r="0.5" fill="#FFDE00" />
      <circle cx="8.8" cy="3.1" r="0.5" fill="#FFDE00" />
      <circle cx="8.8" cy="5.1" r="0.5" fill="#FFDE00" />
      <circle cx="7.4" cy="6.5" r="0.5" fill="#FFDE00" />
    </>
  ),
  JP: (
    <>
      <rect width="20" height="14" fill="#FFFFFF" />
      <circle cx="10" cy="7" r="4.2" fill="#BC002D" />
    </>
  ),
  KR: (
    <>
      <rect width="20" height="14" fill="#FFFFFF" />
      <circle cx="10" cy="7" r="3.6" fill="#CD2E3A" />
      <path d="M6.4 7a3.6 3.6 0 007.2 0z" fill="#0047A0" />
      <path d="M2.4 4.2l1.8-1.4M15.8 11.2l1.8-1.4" stroke="#000000" strokeWidth="0.7" />
    </>
  ),
  MY: (
    <>
      <rect width="20" height="14" fill="#FFFFFF" />
      {stripes.map((y) => <rect key={y} y={y} width="20" height="1" fill="#CC0001" />)}
      <rect width="10" height="8" fill="#010066" />
      <circle cx="3.9" cy="4" r="2" fill="#FFCC00" />
      <circle cx="4.8" cy="4" r="1.7" fill="#010066" />
      <path d="M7.1 2.5l.36 1.05 1.1.05-.87.68.31 1.07-.9-.63-.9.63.31-1.07-.87-.68 1.1-.05z" fill="#FFCC00" />
    </>
  ),
  TH: (
    <>
      <rect width="20" height="14" fill="#A51931" />
      <rect y="2.33" width="20" height="9.34" fill="#F4F5F8" />
      <rect y="4.67" width="20" height="4.66" fill="#2D2A4A" />
    </>
  )
};

export default function CountryFlag({ code, className = "" }: { code: string; className?: string }) {
  const flag = flags[code.toUpperCase()];
  if (!flag) {
    return (
      <span className={`inline-flex h-[14px] w-5 shrink-0 items-center justify-center rounded-[2px] bg-slate-200 text-[8px] font-bold text-slate-600 ${className}`}>
        {code.toUpperCase().slice(0, 2)}
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 20 14"
      role="img"
      aria-label={`${code.toUpperCase()} flag`}
      className={`h-[14px] w-5 shrink-0 rounded-[2px] ring-1 ring-black/10 ${className}`}
    >
      {flag}
    </svg>
  );
}
