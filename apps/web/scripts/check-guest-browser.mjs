// Start Next with NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co,
// NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key, NEXT_PUBLIC_API_URL=http://127.0.0.1:4000/v1.
// All API/auth traffic is mocked; no real accounts are created.
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const page = await context.newPage();
const base = process.env.HOME_TEST_URL ?? "http://localhost:3002";
const work = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Fixture Adventure", kind: "ANIME", alternateTitles: [], synopsis: "A journey through an imaginary world.", coverUrl: "/brand/hao-logo-192.png", bannerUrl: "/brand/hao-logo-512.png", year: 2026, status: "FINISHED", genres: ["Fantasy"], averageScore: 80, maturityRating: "GENERAL", source: { kind: "ANILIST", externalId: "123" } };
const errors = [];
const privateRequests = [];
let signupCount = 0;
page.on("pageerror", error => errors.push(error.message));
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
await context.route("http://127.0.0.1:4000/**", route => {
  const url = new URL(route.request().url());
  if (route.request().method() === "OPTIONS") return json(route, {});
  if (url.pathname.endsWith("/discover")) return json(route, { featured: [work], trending: [work], updated: [work] });
  if (url.pathname.endsWith("/search")) return json(route, { items: [{ ...work, kind: url.searchParams.get("kind") ?? "ANIME" }] });
  if (url.pathname.endsWith("/seasons")) return json(route, { items: [] });
  if (url.pathname.includes("/works/")) return json(route, { work });
  if (url.pathname.endsWith("/auth/signup")) {
    signupCount++;
    const body = route.request().postDataJSON();
    return json(route, { message: "That invite code is not valid. Check it with the person who invited you." }, body.inviteCode === "BAD" ? 403 : 400);
  }
  privateRequests.push(url.pathname);
  return json(route, { message: "Sign in required" }, 401);
});
await context.addInitScript(() => {
  localStorage.setItem("hao:anime-continue:v1", JSON.stringify([{ id: "private", animeTitle: "PRIVATE HISTORY", sourceId: "a", animeId: "a", episodeId: "a", positionSeconds: 10, durationSeconds: 20 }]));
});
await mkdir(".tmp/guest-access", { recursive: true });
try {
  await page.goto(base);
  await page.getByRole("heading", { name: work.title, exact: true, level: 1 }).waitFor();
  assert.equal(await page.getByText("PRIVATE HISTORY").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Sources online" }).count(), 0);
  await page.getByRole("link", { name: "Explore title", exact: true }).click();
  await page.getByRole("link", { name: "Sign in to watch", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Add to library" }).count(), 0);
  const href = await page.getByRole("link", { name: "Sign in to watch", exact: true }).getAttribute("href");
  assert.match(href, /next=%2Ftitle%2F/);
  assert.equal(privateRequests.length, 0);
  await page.goto(`${base}/player/anime?episodeId=fixture-episode`);
  await page.getByRole("heading", { name: "Make yourself at home." }).waitFor();
  assert.equal(await page.locator("video").count(), 0);
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await page.getByRole("heading", { name: "Join HAO", exact: true }).waitFor();
  assert.match(page.url(), /episodeId/);
  await page.getByLabel("Email address", { exact: true }).fill("fixture@example.com");
  await page.getByLabel("Password", { exact: true }).fill("FixturePassword123");
  await page.getByLabel("Confirm password", { exact: true }).fill("MismatchPassword123");
  await page.getByLabel("Invite code", { exact: true }).fill("BAD");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByText("The passwords do not match.", { exact: true }).waitFor();
  assert.equal(signupCount, 0);
  await page.getByLabel("Confirm password", { exact: true }).fill("FixturePassword123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByText(/That invite code is not valid/).waitFor();
  assert.equal(signupCount, 1);
  await page.screenshot({ path: ".tmp/guest-access/signup-desktop.png", fullPage: true });
  for (const width of [820, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `signup overflow at ${width}`);
  }
  await page.screenshot({ path: ".tmp/guest-access/signup-mobile.png", fullPage: true });
  for (const route of ["/discover", "/reader", "/novels"]) {
    await page.goto(`${base}${route}`);
    await page.locator(".media-card").first().waitFor();
  }
  await page.goto(`${base}/library`);
  await page.getByRole("heading", { name: "Make yourself at home." }).waitFor();
  assert.deepEqual(privateRequests, []);
  assert.deepEqual(errors, []);
  console.log("Guest browsing, title/login return links, signup validation, private page gating, and responsive layout passed.");
} finally { await browser.close(); }
