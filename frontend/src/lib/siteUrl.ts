/**
 * Where this portal is served from, as search engines and email links see it.
 *
 * The canonical host used to be typed out in the root layout's `metadataBase`
 * and again in robots.ts. Public tracking adds a sitemap and a canonical tag per
 * page, which would have made four copies of one string that has to agree with
 * itself or the SEO silently breaks.
 *
 * Overridable so a staging deployment advertises itself rather than production.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://swiftlineportal.com")
  .replace(/\/+$/, "");

/** An absolute URL for a portal path, for canonicals, sitemaps and share links. */
export function siteUrl(path: string) {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
