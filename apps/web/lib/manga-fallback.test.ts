import { describe, expect, it } from "vitest";
import type { MangaChapter, MangaSource, MangaSummary } from "./manga-response";
import { findExactMangaTitleMatch, findReadableMangaFallback } from "./manga-fallback";

const sources: MangaSource[] = [
  { id: "current", name: "Current", displayName: "Current (EN)", language: "en", mature: false, supportsLatest: true },
  { id: "empty", name: "Empty", displayName: "Empty (EN)", language: "en", mature: false, supportsLatest: true },
  { id: "readable", name: "Readable", displayName: "Readable (EN)", language: "en", mature: false, supportsLatest: true },
  { id: "other-language", name: "Other", displayName: "Other (ES)", language: "es", mature: false, supportsLatest: true },
];

const summary = (id: number, sourceId: string, title: string): MangaSummary => ({ id, sourceId, title, genres: [] });
const chapter = (id: number): MangaChapter => ({ id, index: id, name: `Chapter ${id}`, number: id, uploadDate: 0, read: false, lastPageRead: 0, pageCount: 10 });

describe("manga source fallback", () => {
  it("matches normalized exact titles without selecting sequels", () => {
    expect(findExactMangaTitleMatch([summary(1, "one", "Solo Leveling: Ragnarok"), summary(2, "two", "SOLO-LEVELING")], "Solo Leveling")?.id).toBe(2);
  });

  it("skips the current source, other languages, and exact matches without chapters", async () => {
    const searched: string[] = [];
    const result = await findReadableMangaFallback({
      title: "Solo Leveling",
      currentSourceId: "current",
      language: "en",
      sources,
      searchSource: async (source) => {
        searched.push(source.id);
        return [summary(source.id === "empty" ? 10 : 20, source.id, "Solo Leveling")];
      },
      loadChapters: async (item) => item.sourceId === "readable" ? [chapter(1)] : [],
    });

    expect(searched).toEqual(["empty", "readable"]);
    expect(result?.source.id).toBe("readable");
    expect(result?.chapters).toHaveLength(1);
  });

  it("continues when a fallback source fails", async () => {
    const result = await findReadableMangaFallback({
      title: "Solo Leveling",
      currentSourceId: "current",
      language: "en",
      sources,
      searchSource: async (source) => {
        if (source.id === "empty") throw new Error("source unavailable");
        return [summary(20, source.id, "Solo Leveling")];
      },
      loadChapters: async () => [chapter(1)],
    });

    expect(result?.source.id).toBe("readable");
  });

  it("searches alternate titles when a source does not recognize the display title", async () => {
    const searched: string[] = [];
    const result = await findReadableMangaFallback({
      title: "My Dress-Up Darling",
      alternateTitles: ["Sono Bisque Doll wa Koi wo Suru"],
      currentSourceId: "current",
      language: "en",
      sources: [sources[0]!, sources[2]!],
      searchSource: async (source, title) => {
        searched.push(`${source.id}:${title}`);
        return title === "Sono Bisque Doll wa Koi wo Suru" ? [summary(30, source.id, "My Dress-Up Darling")] : [];
      },
      loadChapters: async () => [chapter(1)],
    });

    expect(searched).toEqual(["readable:My Dress-Up Darling", "readable:Sono Bisque Doll wa Koi wo Suru"]);
    expect(result?.item.title).toBe("My Dress-Up Darling");
  });

  it("continues to an alternate title when the first spelling throws", async () => {
    const result = await findReadableMangaFallback({
      title: "My Dress-Up Darling",
      alternateTitles: ["Sono Bisque Doll wa Koi wo Suru"],
      currentSourceId: "current",
      language: "en",
      sources: [sources[0]!, sources[2]!],
      searchSource: async (source, title) => {
        if (title === "My Dress-Up Darling") throw new Error("source rejected query");
        return [summary(30, source.id, "My Dress-Up Darling")];
      },
      loadChapters: async () => [chapter(1)],
    });

    expect(result?.source.id).toBe("readable");
  });
});
