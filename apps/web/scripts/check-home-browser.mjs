// Run against a dev server without Supabase configuration, using only local fixtures.
// PLAYWRIGHT_MODULE may point to an installed playwright/index.mjs; HOME_TEST_URL defaults to :3002.
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const base = process.env.HOME_TEST_URL ?? "http://localhost:3002";
const output = process.env.HOME_TEST_OUTPUT ?? ".tmp";
await mkdir(output, { recursive: true });
const titles = ["Violet Evergarden", "A Journey Beyond the Horizon", "The Last Library", "The Skyward Garden", "Summer After Rain", "The Midnight Express", "Paper Lanterns", "Another World", "The Quiet City", "A Distant Promise", "The Observatory", "The Long Way Home"];
const works = titles.map((title, index) => ({ id: `home-fixture-${index}`, title, alternateTitles: [], kind: "ANIME", synopsis: "A young traveler discovers a world of possibility. " .repeat(25), coverUrl: `${base}/home-fixture/poster-${index}.svg`, bannerUrl: `${base}/home-fixture/banner-${index}.svg`, year: 2026, status: "FINISHED", genres: ["Fantasy"], maturityRating: "GENERAL", averageScore: 85, source: { kind: "ANILIST", externalId: String(index + 1) } }));
const catalogRequests = [];
let offline = false;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
function poster(index = 0, banner = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${banner ? 1200 : 240}" height="${banner ? 500 : 360}" viewBox="0 0 240 360"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${210 + index * 17} 65% 52%)"/><stop offset="1" stop-color="#111529"/></linearGradient></defs><rect width="240" height="360" fill="url(#g)"/><circle cx="170" cy="100" r="64" fill="#fff" opacity=".2"/><path d="M0 320 100 140 240 360H0" fill="#fff" opacity=".12"/><text x="20" y="325" fill="white" font-family="sans-serif" font-size="15">HAO TEST ${index + 1}</text></svg>`;
}
await context.route("**/home-fixture/*.svg", route => {
  const name = new URL(route.request().url()).pathname;
  return route.fulfill({ contentType: "image/svg+xml", body: poster(Number(/-(\d+)/.exec(name)?.[1] ?? 0), name.includes("banner")) });
});
await context.route("http://127.0.0.1:4000/**", route => {
  const url = new URL(route.request().url());
  if (route.request().method() === "OPTIONS") return json(route, {});
  if (url.pathname.endsWith("/discover")) return json(route, { featured: works.slice(0, 3), trending: works, updated: works });
  if (url.pathname.endsWith("/profile")) return json(route, { displayName: "Test reader", maturityCeiling: "ADULT", hideUnrated: false });
  if (url.pathname.endsWith("/bridges")) return json(route, { items: [{ endpoint: "http://127.0.0.1:4568", scope: "beta", name: "Fixture Bridge", revokedAt: null }] });
  return json(route, { items: [] });
});
await context.route("http://127.0.0.1:4568/**", route => {
  const url = new URL(route.request().url());
  if (route.request().method() === "OPTIONS") return json(route, {});
  if (offline) return json(route, { message: "Fixture Bridge offline" }, 503);
  if (url.pathname.endsWith("/thumbnail")) return route.fulfill({ contentType: "image/svg+xml", body: poster(Number(/\/(\d+)\/thumbnail/.exec(url.pathname)?.[1] ?? 0)), headers: { "access-control-allow-origin": "*" } });
  if (url.pathname === "/health") return json(route, { status: "ok", paired: true });
  if (url.pathname === "/v1/anime/sources") return json(route, [{ id: "anime-a", name: "Anime fixture", language: "en", supportsLatest: true, provider: "fixture" }, { id: "anime-b", name: "Second anime fixture", language: "en", supportsLatest: false, provider: "fixture" }]);
  if (url.pathname === "/v1/manga/sources") return json(route, [{ id: "manga-a", name: "Manga fixture", displayName: "Manga fixture", language: "en", supportsLatest: true, mature: false }]);
  catalogRequests.push(url.href);
  if (url.pathname === "/v1/anime/catalog") return json(route, titles.map((title, index) => ({ id: String(index), title, description: "Fixture", provider: "fixture", attribution: "Purpose-built test fixture", thumbnailUrl: "/fixture.svg" })));
  if (url.pathname === "/v1/manga/browse") return json(route, { items: titles.map((title, index) => ({ id: index, sourceId: "manga-a", title, genres: ["Adventure"] })), hasNextPage: true });
  return json(route, {});
});
await context.addInitScript(({ works }) => {
  localStorage.setItem("hao:beta-onboarding:v1", "complete");
  localStorage.setItem("hao:anime-continue:v1", JSON.stringify(works.slice(0, 4).map((work, i) => ({ id: String(i), workId: work.id, sourceId: "anime-a", sourceName: "Fixture", animeId: String(i), animeTitle: work.title, thumbnailUrl: work.coverUrl, episodeId: `episode-${i}`, episodeNumber: i + 1, episodeTitle: "A new beginning", positionSeconds: 400, durationSeconds: 1200, updatedAt: `2026-01-0${5 - i}T00:00:00Z` }))));
}, { works });
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Sources online" }).waitFor();
  await page.locator(".repository-shelf.anime .repository-card").first().waitFor();
  assert.equal(await page.locator(".repository-shelf h2").allTextContents().then(values => values.join(",")), "Anime,Manga");
  assert.equal(await page.getByText("From your repositories", { exact: true }).count(), 0);
  assert.equal(await page.getByText("YOUR LOCAL COLLECTION", { exact: true }).count(), 0);
  assert.equal(await page.locator(".continue-watch-card").count(), 4);
  assert.match(await page.getByRole("link", { name: "Resume Violet Evergarden", exact: true }).getAttribute("href"), /episodeId=episode-0/);
  const status = page.getByRole("button", { name: "Sources online" });
  await status.click();
  assert.match(await page.locator("#home-source-details").textContent(), /Shared Beta Bridge/);
  assert.equal(await page.locator("#home-source-details dd").first().textContent(), "2");
  await page.keyboard.press("Escape");
  assert.equal(await status.getAttribute("aria-expanded"), "false");
  assert.equal(await status.evaluate(element => element === document.activeElement), true);
  await status.click();
  await page.getByRole("button", { name: "Beta guide", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Close beta guide" }).click();
  await page.getByRole("button", { name: `Show featured title: ${works[1].title}`, exact: true }).click();
  assert.equal(await page.locator(".home-hero h1").textContent(), works[1].title);
  assert.match(await page.getByRole("link", { name: "Explore title", exact: true }).getAttribute("href"), /home-fixture-1\?anilistId=2/);
  await page.getByRole("button", { name: `Show featured title: ${works[0].title}`, exact: true }).click();
  const animeShelf = page.getByRole("region", { name: "Anime titles", exact: true });
  await page.getByRole("button", { name: "Scroll Anime right", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Anime titles"]').scrollLeft > 100);
  await page.getByRole("button", { name: "Scroll Anime left", exact: true }).click();
  assert.equal(await animeShelf.evaluate(element => element.scrollLeft), 0);
  await page.locator(".repository-shelf.anime").getByRole("button", { name: "Latest", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.repository-shelf.anime [aria-pressed="true"]').textContent.trim() === "Latest" && document.querySelector('.repository-shelf.anime .repository-card'));
  assert.ok(catalogRequests.some(url => url.includes("sourceId=anime-a&mode=latest")));
  assert.equal(await page.getByRole("link", { name: "Open full anime browser", exact: true }).getAttribute("href"), "/player/anime?sourceId=anime-a&mode=latest");
  await page.getByRole("combobox", { name: "anime source", exact: true }).selectOption("anime-b");
  await page.waitForFunction(() => document.querySelector('.repository-shelf.anime .repository-card') && !document.querySelector('[aria-label="anime source"]').disabled);
  assert.equal(await page.locator(".repository-shelf.anime").getByRole("button", { name: "Latest", exact: true }).isDisabled(), true);
  assert.equal(await page.locator(".repository-shelf.anime").getByRole("button", { name: "Popular", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("combobox", { name: "anime source", exact: true }).selectOption("anime-a");
  await page.locator(".repository-shelf.anime .repository-card").first().waitFor();
  await page.locator(".repository-shelf.manga").getByRole("button", { name: "Latest", exact: true }).click();
  await page.locator(".repository-shelf.manga .repository-card").first().waitFor();
  assert.ok(catalogRequests.some(url => url.includes("sourceId=manga-a&mode=latest")));
  assert.equal(await page.getByRole("link", { name: "Open full manga browser", exact: true }).getAttribute("href"), "/reader?sourceId=manga-a&mode=latest");
  for (const [width, height] of [[1440,1000],[1920,1080],[1024,900],[820,1000],[390,844],[320,720]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    const layout = await page.evaluate(() => {
      const paragraph = document.querySelector(".hero-copy > p");
      const hero = document.querySelector(".home-hero");
      const overlay = getComputedStyle(hero, "::before");
      const card = document.querySelector(".continue-watch-card").getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, viewport: innerWidth, paragraphHeight: paragraph.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(paragraph).lineHeight), heroWidth: hero.clientWidth, heroHeight: hero.clientHeight, overlayWidth: parseFloat(overlay.width), overlayHeight: parseFloat(overlay.height), overlayInset: overlay.inset, overlayTint: overlay.backgroundColor, overlayPointerEvents: overlay.pointerEvents, cardWidth: card.width, cardHeight: card.height };
    });
    assert.ok(layout.width <= width + 1, `No horizontal page overflow at ${width}px: ${layout.width}`);
    assert.ok(layout.paragraphHeight <= layout.lineHeight * 2 + 1, "Hero synopsis is capped at two lines");
    assert.ok(layout.cardWidth <= 341 && layout.cardHeight <= 112, `Compact resume card at ${width}px: ${layout.cardWidth} x ${layout.cardHeight}`);
    assert.ok(Math.abs(layout.overlayWidth - layout.heroWidth) < 1 && Math.abs(layout.overlayHeight - layout.heroHeight) < 1, `Overlay covers the entire banner at ${width}px`);
    assert.equal(layout.overlayInset, "0px");
    assert.equal(layout.overlayTint, "rgba(8, 10, 18, 0.2)", "The right edge retains the base tint");
    assert.equal(layout.overlayPointerEvents, "none", "The overlay cannot intercept hero controls");
    if (width === 1440 || width === 390) await page.screenshot({ path: `${output}/home-redesign-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("hao:sidebar-collapsed")), "true");
  await page.screenshot({ path: `${output}/home-redesign-collapsed.png`, fullPage: true });
  await page.getByRole("button", { name: "Remove Violet Evergarden from continue shelf", exact: true }).click();
  assert.equal(await page.locator(".continue-watch-card").count(), 3);
  offline = true;
  await status.click();
  await page.getByRole("button", { name: "Reconnect sources", exact: true }).click();
  await page.getByRole("button", { name: "Sources offline" }).waitFor();
  await page.getByText("Your sources could not be reached", { exact: true }).waitFor();
  offline = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await status.waitFor();
  await page.locator(".repository-shelf.anime .repository-card").first().waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: Home headings, featured carousel, two-line synopsis, source status, guide, shelf arrows, source/mode controls, resume/removal, offline/retry, sidebar preference, and six responsive sizes.");
} catch (error) {
  console.error("Home browser failure", page.url(), await page.locator("body").innerText(), errors);
  await page.screenshot({ path: `${output}/home-redesign-failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
