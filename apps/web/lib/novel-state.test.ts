import { describe, expect, it } from "vitest";
import { groupNovelChapters, markNovelChapterRead, parseNovelReadState, parseNovelResumes, rememberNovelMatch, updateNovelResumes } from "./novel-state";
import type { NovelChapter, NovelSummary } from "./novel-response";

const novel: NovelSummary = { id: "n1", sourceId: "s1", title: "Story", genres: [] };
const chapter = (id: string, index: number, title: string): NovelChapter => ({ id, index, title, sourceId: "s1", novelId: "n1" });

describe("novel state", () => {
  it("keeps the latest match and resume for a novel", () => {
    expect(rememberNovelMatch([], "anilist:1", novel)[0]?.novel.id).toBe("n1");
    const base = { id: "s1:n1", novelKey: "s1:n1", workId: null, title: "Story", chapterTitle: "One", chapterIndex: 0, progressPercent: 10, href: "/one", coverUrl: null, updatedAt: "2026-01-01" };
    const next = { ...base, chapterTitle: "Two", chapterIndex: 1, updatedAt: "2026-01-02" };
    expect(updateNovelResumes([base], next)).toEqual([next]);
    expect(parseNovelResumes(JSON.stringify([next, { broken: true }]))).toEqual([next]);
  });

  it("persists read chapters and groups volumes", () => {
    const state = markNovelChapterRead(parseNovelReadState(null), "s1:n1", "c1");
    expect(state).toEqual({ "s1:n1": ["c1"] });
    expect(groupNovelChapters([chapter("c1", 0, "Volume 1 Chapter 1"), chapter("c2", 1, "Vol. 2 - Chapter 1")]).map((group) => group.label)).toEqual(["Volume 1", "Volume 2"]);
  });
});
