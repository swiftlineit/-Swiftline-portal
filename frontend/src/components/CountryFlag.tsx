/**
 * The flag for a country, anywhere in the portal.
 *
 * Served from `public/flags` rather than bundled or fetched from a CDN. Three
 * approaches were tried before this one and each failed differently: flag
 * emoji render as two plain letters because Windows ships no flag glyphs;
 * hand-drawn inline SVG covered fifteen countries and showed a grey letter
 * badge for the other two hundred; and a CDN puts every flag in the portal
 * behind a third party a customer network can block.
 *
 * Files are synced by `npm run sync:flags` and named by lowercase ISO-3166
 * alpha-2, matching the casing the country catalogue uses.
 */

const flagAspectRatio = 3 / 2;

export default function CountryFlag({
  code,
  size = 14,
  className = ""
}: {
  /** ISO-3166 alpha-2, in either case. */
  code: string;
  /** Rendered height in pixels. Width follows the 3:2 flag ratio. */
  size?: number;
  className?: string;
}) {
  const iso2 = code.trim().toLowerCase();

  // Anything that is not a country code has no flag to show. Rendering a
  // placeholder here would put a grey box beside every free-text destination.
  if (!/^[a-z]{2}$/.test(iso2)) return null;

  return (
    <img
      src={`/flags/${iso2}.svg`}
      // Decorative: every call site shows the country name beside the flag, so
      // announcing the code again only makes a screen reader repeat itself.
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      width={Math.round(size * flagAspectRatio)}
      height={size}
      style={{ width: Math.round(size * flagAspectRatio), height: size }}
      className={`inline-block shrink-0 rounded-xs object-cover ring-1 ring-black/10 ${className}`}
    />
  );
}
