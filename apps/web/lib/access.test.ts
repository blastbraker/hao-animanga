import { describe, expect, it } from "vitest";
import { authHref, isPublicApiRequest, isPublicPage } from "./access";

describe("public browsing boundary", () => {
  it("allows metadata pages, not playback or personal pages", () => {
    for (const path of ["/", "/discover", "/reader", "/novels", "/title/abc"]) expect(isPublicPage(path)).toBe(true);
    for (const path of ["/player/anime", "/library", "/settings", "/admin", "/novels/chapter/abc", "/activity"]) expect(isPublicPage(path)).toBe(false);
  });
  it("has a narrow read-only metadata API allowlist", () => {
    for (const path of ["/discover", "/search?q=title", "/works/anilist/123", "/works/abc-123/seasons"]) expect(isPublicApiRequest(path)).toBe(true);
    for (const path of ["/library", "/bridges", "/profile", "/epubs", "/admin/invitations", "/works/import-extension", "/auth/password-ready"]) expect(isPublicApiRequest(path)).toBe(false);
    expect(isPublicApiRequest("/discover", "PUT")).toBe(false);
    expect(isPublicApiRequest("/auth/signup", "POST")).toBe(true);
    expect(isPublicApiRequest("/auth/signup?role=admin", "POST")).toBe(false);
  });
  it("preserves the episode destination without allowing off-site redirects", () => {
    expect(authHref("signup", "/player/anime?episodeId=one")).toBe("/signup?next=%2Fplayer%2Fanime%3FepisodeId%3Done");
    expect(authHref("login", "//evil.example")).toBe("/login?next=%2F");
  });
});
