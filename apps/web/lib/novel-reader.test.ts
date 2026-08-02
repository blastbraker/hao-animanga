import { describe, expect, it } from "vitest";
import type { NovelChapter } from "./novel-response";
import { filterNovelChapters, novelChapterNavigation } from "./novel-reader";

const chapters: NovelChapter[] = [
  {
    id: "1",
    index: 0,
    title: "Chapter 1 - Arrival",
    sourceId: "source",
    novelId: "novel",
  },
  {
    id: "2",
    index: 1,
    title: "Chapter 2 - The Gate",
    sourceId: "source",
    novelId: "novel",
  },
  {
    id: "2500",
    index: 2,
    title: "Chapter 2500 - Final Battle",
    sourceId: "source",
    novelId: "novel",
  },
];

describe("novel reader chapter controls", () => {
  it("returns adjacent chapters in reading order", () => {
    const navigation = novelChapterNavigation(chapters, "2");
    expect(navigation.currentIndex).toBe(1);
    expect(navigation.previous?.id).toBe("1");
    expect(navigation.next?.id).toBe("2500");
  });

  it("searches chapter numbers and titles", () => {
    expect(
      filterNovelChapters(chapters, "2500").map((chapter) => chapter.id),
    ).toEqual(["2500"]);
    expect(
      filterNovelChapters(chapters, "final battle").map(
        (chapter) => chapter.id,
      ),
    ).toEqual(["2500"]);
  });
});
