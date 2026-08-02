import { describe, expect, it } from "vitest";
import {
  normalizeNovelChapterContent,
  normalizeNovelChapters,
  normalizeNovelSearch,
  normalizeNovelSources,
} from "./novel-response";

describe("novel Bridge response normalization", () => {
  it("keeps only valid sources and catalog records", () => {
    expect(
      normalizeNovelSources([
        {
          id: "source",
          name: "Fixture",
          language: "en",
          supportsLatest: true,
          mature: false,
        },
        null,
      ]),
    ).toHaveLength(1);
    expect(
      normalizeNovelSearch({
        items: [
          {
            id: "novel",
            sourceId: "source",
            title: "Story",
            genres: ["Fantasy", 1],
          },
          { nope: true },
        ],
        hasNextPage: true,
      }),
    ).toEqual({
      items: [
        {
          id: "novel",
          sourceId: "source",
          title: "Story",
          imageUrl: null,
          author: null,
          description: null,
          status: null,
          genres: ["Fantasy"],
        },
      ],
      hasNextPage: true,
    });
  });

  it("rejects malformed chapters and content", () => {
    expect(
      normalizeNovelChapters([
        {
          id: "chapter",
          sourceId: "source",
          novelId: "novel",
          title: "Chapter 1",
          index: 0,
        },
        { index: -1 },
      ]),
    ).toHaveLength(1);
    expect(
      normalizeNovelChapterContent({
        chapterId: "chapter",
        novelId: "novel",
        title: "Chapter 1",
        html: "<p>Text</p>",
      })?.html,
    ).toBe("<p>Text</p>");
    expect(normalizeNovelChapterContent({ chapterId: "chapter" })).toBeNull();
  });
});
