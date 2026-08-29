import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const base = process.env.UI_BASE ?? "http://localhost:3000";
const api = process.env.UI_API ?? "http://localhost:5000";
const email = process.env.UI_EMAIL;
const password = process.env.UI_PASSWORD;
const output = process.env.UI_SHOT_DIR ?? path.join(process.cwd(), ".ui-shots", "profitability");
if (!email || !password) throw new Error("Set UI_EMAIL and UI_PASSWORD before running the profitability browser check.");

mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const problems = [];
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 1000 }
];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !/GSI_LOGGER|requestStorageAccess|Failed to load resource/.test(message.text())) {
      problems.push(`[${viewport.name}] console: ${message.text().slice(0, 240)}`);
    }
  });
  page.on("response", (response) => {
    const optionalProfileImage = response.status() === 404 && response.url().includes("/api/v1/profile/image");
    const manualFxFallback = response.status() === 503 && response.url().includes("/api/v1/profitability/fx/");
    if (response.status() >= 400 && !optionalProfileImage && !manualFxFallback) problems.push(`[${viewport.name}] HTTP ${response.status()}: ${response.url().slice(0, 220)}`);
  });
  page.on("requestfailed", (request) => problems.push(`[${viewport.name}] request failed: ${request.url().slice(0, 180)}`));
  const signIn = await context.request.post(`${api}/api/v1/auth/login`, { data: { email, password, termsAccepted: true } });
  if (!signIn.ok()) {
    problems.push(`[${viewport.name}] sign-in failed: HTTP ${signIn.status()}`);
    await context.close();
    continue;
  }
  await page.goto(`${base}/dashboard/finance/profitability`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByRole("heading", { name: "Profitability / Margin" }).waitFor({ timeout: 30_000 });
  for (const tab of ["Overview", "Flight costs", "Shipment margins", "Buying rates"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    if (tab === "Overview") await page.getByText("Revenue today", { exact: true }).waitFor({ timeout: 15_000 });
    if (tab === "Flight costs") await page.getByText("Loading flight costs…").waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    if (tab === "Buying rates") await page.getByText("Loading buying rates…").waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(250);
    const slug = tab.toLowerCase().replaceAll(" ", "-");
    if (viewport.name === "desktop" || tab === "Flight costs") {
      await page.screenshot({ path: path.join(output, `${viewport.name}-${slug}.png`), fullPage: true });
    }
    if (tab === "Flight costs" && (viewport.name === "mobile" || viewport.name === "desktop")) {
      await page.getByRole("button", { name: "New cost sheet", exact: true }).click();
      await page.getByRole("heading", { name: "Flight details", exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `${viewport.name}-new-cost-sheet.png`), fullPage: true });
      await page.getByRole("button", { name: "Flight costs", exact: true }).last().click();
    }
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`[${viewport.name}] document overflow: ${overflow}px`);
  const selectCount = await page.locator("select.appearance-none").count();
  const chevronCount = await page.locator("svg.pointer-events-none").count();
  if (selectCount && chevronCount < selectCount) problems.push(`[${viewport.name}] dropdown icons missing: ${selectCount} selects, ${chevronCount} icons`);
  await context.close();
}

await browser.close();
console.log(`Screenshots in ${output}`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Profitability browser check passed.");
