import type { NovelChapter } from "./novel-response";

export function novelChapterNavigation(
  chapters: NovelChapter[],
  chapterId?: string,
) {
  const currentIndex = chapterId
    ? chapters.findIndex((chapter) => chapter.id === chapterId)
    : -1;
  return {
    currentIndex,
    previous: currentIndex > 0 ? chapters[currentIndex - 1] : null,
    next:
      currentIndex >= 0 && currentIndex < chapters.length - 1
        ? chapters[currentIndex + 1]
        : null,
  };
}

export function filterNovelChapters(
  chapters: NovelChapter[],
  rawQuery: string,
): NovelChapter[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return chapters;
  return chapters.filter((chapter, index) =>
    `${index + 1} ${chapter.title}`.toLowerCase().includes(query),
  );
}
