import { afterEach, describe, expect, it, vi } from "vitest";
import { AniListProvider } from "./anilist";

const media = (id: number, title: string, year: number) => ({
  id, type: "ANIME", format: "TV", title: { romaji: title, english: title, native: null }, synonyms: [], description: "",
  coverImage: { extraLarge: `https://example.com/${id}.jpg`, large: null }, bannerImage: null, seasonYear: year,
  startDate: { year }, status: "FINISHED", genres: ["Fantasy"], isAdult: false, averageScore: 80, countryOfOrigin: "JP",
});

afterEach(() => vi.unstubAllGlobals());

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
});
