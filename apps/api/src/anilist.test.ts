import { afterEach, describe, expect, it, vi } from "vitest";
import { AniListProvider } from "./anilist";

const media = (id: number, title: string, year: number) => ({
  id, type: "ANIME", format: "TV", title: { romaji: title, english: title, native: null }, synonyms: [], description: "",
  coverImage: { extraLarge: `https://example.com/${id}.jpg`, large: null }, bannerImage: null, seasonYear: year,
  startDate: { year }, status: "FINISHED", genres: ["Fantasy"], isAdult: false, averageScore: 80, countryOfOrigin: "JP",
});

afterEach(() => vi.unstubAllGlobals());

describe("AniList light novel discovery", () => {
  it("requests the NOVEL format instead of filtering a mixed manga page", async () => {
    const novel = { ...media(20, "Spice and Wolf", 2006), type: "MANGA", format: "NOVEL" };
    const fetchMock = vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { variables: Record<string, unknown> };
      expect(request.variables).toMatchObject({ type: "MANGA", format: "NOVEL" });
      return new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: [novel] } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new AniListProvider("https://example.test/graphql").search({ query: "", kind: "LIGHT_NOVEL", page: 1, pageSize: 20 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.items).toMatchObject([{ kind: "LIGHT_NOVEL", title: "Spice and Wolf" }]);
  });
});

describe("AniList anime seasons", () => {
  it("walks the complete TV prequel and sequel chain in year order", async () => {
    const nodes = new Map([
      [1, { ...media(1, "Example", 2020), relations: { edges: [{ relationType: "SEQUEL", node: media(2, "Example Season 2", 2022) }] } }],
      [2, { ...media(2, "Example Season 2", 2022), relations: { edges: [{ relationType: "PREQUEL", node: media(1, "Example", 2020) }, { relationType: "SEQUEL", node: media(3, "Example Season 3", 2023) }] } }],
      [3, { ...media(3, "Example Season 3", 2023), relations: { edges: [{ relationType: "PREQUEL", node: media(2, "Example Season 2", 2022) }, { relationType: "SEQUEL", node: media(4, "Example Season 4", 2024) }] } }],
      [4, { ...media(4, "Example Season 4", 2024), relations: { edges: [{ relationType: "PREQUEL", node: media(3, "Example Season 3", 2023) }] } }],
    ]);
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const id = (JSON.parse(String(init?.body)) as { variables: { id: number } }).variables.id;
      return new Response(JSON.stringify({ data: { Media: nodes.get(id) } }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const result = await new AniListProvider("https://example.test/graphql").getAnimeSeasons("2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((item) => item.title)).toEqual(["Example", "Example Season 2", "Example Season 3", "Example Season 4"]);
  });

  it("includes movie side stories in a series release group", async () => {
    const movie = { ...media(10, "Bleach the Movie: Memories of Nobody", 2006), format: "MOVIE" };
    const nodes = new Map([
      [1, { ...media(1, "Bleach", 2004), relations: { edges: [{ relationType: "SIDE_STORY", node: movie }] } }],
    ]);
    const fetchMock = vi.fn(async (_url, init) => {
      const id = (JSON.parse(String(init?.body)) as { variables: { id: number } }).variables.id;
      return new Response(JSON.stringify({ data: { Media: nodes.get(id) } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new AniListProvider("https://example.test/graphql").getAnimeSeasons("1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((item) => item.title)).toEqual(["Bleach", "Bleach the Movie: Memories of Nobody"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("walks from a movie back to its parent series and related releases", async () => {
    const movie = { ...media(10, "Bleach the Movie: Memories of Nobody", 2006), format: "MOVIE" };
    const nodes = new Map([
      [10, { ...movie, relations: { edges: [{ relationType: "PARENT", node: media(1, "Bleach", 2004) }] } }],
      [1, { ...media(1, "Bleach", 2004), relations: { edges: [{ relationType: "SIDE_STORY", node: movie }] } }],
    ]);
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const id = (JSON.parse(String(init?.body)) as { variables: { id: number } }).variables.id;
      return new Response(JSON.stringify({ data: { Media: nodes.get(id) } }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const result = await new AniListProvider("https://example.test/graphql").getAnimeSeasons("10");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((item) => item.title)).toEqual(["Bleach", "Bleach the Movie: Memories of Nobody"]);
  });

  it("supplements a season chain when AniList omits the original series relation", async () => {
    const seasonOne = media(1, "Example", 2020);
    const seasonTwo = { ...media(2, "Example Season 2", 2022), synonyms: ["Example"] };
    const seasonTwoPartTwo = media(3, "Example Season 2 Part 2", 2022);
    const spinOff = media(4, "Example Side Stories", 2021);
    const fetchMock = vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { query: string; variables: { id?: number } };
      if (request.query.includes("query Search")) {
        return new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: [seasonOne, seasonTwo, seasonTwoPartTwo, spinOff] } } }), { status: 200 });
      }
      const node = request.variables.id === 2
        ? { ...seasonTwo, relations: { edges: [{ relationType: "SEQUEL", node: seasonTwoPartTwo }] } }
        : { ...seasonTwoPartTwo, relations: { edges: [] } };
      return new Response(JSON.stringify({ data: { Media: node } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new AniListProvider("https://example.test/graphql").getAnimeSeasons("2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((item) => item.title)).toEqual(["Example", "Example Season 2", "Example Season 2 Part 2"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("AniList anime details", () => {
  it("maps player metadata and official links", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { Media: {
      id: 207809, idMal: 63489, format: "TV", episodes: 24, duration: 23, season: "SUMMER", countryOfOrigin: "JP", isAdult: false,
      siteUrl: "https://anilist.co/anime/207809", startDate: { year: 2026, month: 7, day: 8 }, endDate: { year: null, month: null, day: null },
      studios: { nodes: [{ name: "Tatsunoko Production" }] }, externalLinks: [{ site: "Official Site", url: "https://example.test/anime", type: "INFO" }],
      trailer: { id: "abc123", site: "youtube" },
    } } }), { status: 200 })));
    const result = await new AniListProvider("https://example.test/graphql").getAnimeDetails("207809");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ format: "TV", episodes: 24, durationMinutes: 23, studios: ["Tatsunoko Production"], officialSiteUrl: "https://example.test/anime", trailerUrl: "https://www.youtube.com/watch?v=abc123", malUrl: "https://myanimelist.net/anime/63489" });
  });
});
