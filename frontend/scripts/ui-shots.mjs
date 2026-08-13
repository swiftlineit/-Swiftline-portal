/**
 * Screenshots client portal pages at phone, tablet and desktop widths, and
 * reports the responsive failures a screenshot alone will not show you:
 * console errors, failed requests, and sideways page scroll.
 *
 *   npm run ui:shots -- dashboard shipments tracking
 *
 * Needs both dev servers running, and a client login supplied as:
 *   UI_EMAIL=someone@example.com UI_PASSWORD=... npm run ui:shots -- dashboard
 *
 * Sign-in goes through the API rather than the form on purpose. reCAPTCHA is
 * configured with a real site key, and a token minted on localhost fails
 * Google's origin check; posting without a token takes the same documented
 * fail-open path and sets the identical refreshToken cookie, so the app then
 * authenticates exactly as it would for a real visitor.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const API = process.env.UI_API ?? "http://localhost:5000";
const EMAIL = process.env.UI_EMAIL;
const PASSWORD = process.env.UI_PASSWORD;
const OUT = process.env.UI_SHOT_DIR ?? path.join(process.cwd(), ".ui-shots");

if (!EMAIL || !PASSWORD) {
  console.error("Set UI_EMAIL and UI_PASSWORD to a client login before running.");
  process.exit(1);
}

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 }
];

const routes = process.argv.slice(2);
if (!routes.length) {
  console.error('Name at least one route, e.g. "dashboard" for /client/dashboard.');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    const text = message.text();
    // Google Sign-In and storage-access warnings are localhost noise, not ours.
    const isLocalhostNoise = /GSI_LOGGER|requestStorageAccess/.test(text);
    if (message.type() === "error" && !isLocalhostNoise) {
      problems.push(`[${viewport.name}] console: ${text.slice(0, 200)}`);
    }
  });
  page.on("requestfailed", (request) => {
    problems.push(`[${viewport.name}] request failed: ${request.url().slice(0, 140)}`);
  });

  const signIn = await context.request.post(`${API}/api/v1/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, termsAccepted: true }
  });
  if (!signIn.ok()) problems.push(`[${viewport.name}] sign-in failed: HTTP ${signIn.status()}`);

  for (const route of routes) {
    await page.goto(`${BASE}/client/${route}`, { waitUntil: "networkidle", timeout: 45000 })
      .catch(() => problems.push(`[${viewport.name}] ${route}: navigation timed out`));
    await page.waitForTimeout(1800);

    // An unread rate card share opens over the page on arrival. Real behaviour,
    // but it hides whatever is being reviewed, so dismiss it as a client would.
    const closeShare = page.locator('[aria-label="Close rate card"]');
    if (await closeShare.count()) {
      await closeShare.first().click().catch(() => {});
      await page.waitForTimeout(600);
    }

    await page.screenshot({ path: path.join(OUT, `${route.replace(/\//g, "-")}-${viewport.name}.png`) });

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`[${viewport.name}] ${route}: horizontal overflow of ${overflow}px`);
  }

  await context.close();
}

await browser.close();

console.log(`Screenshots in ${OUT}`);
if (problems.length) {
  console.log(`\nPROBLEMS:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("No console errors, failed requests, or horizontal overflow.");
