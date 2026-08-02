import type { NovelChapter, NovelSummary } from "./novel-response";

export const NOVEL_MATCHES_KEY = "hao:novel-source-matches:v1";
export const NOVEL_RESUMES_KEY = "hao:novel-resumes:v1";
export const NOVEL_READ_KEY = "hao:novel-read:v1";
export const NOVEL_BOOKMARKS_KEY = "hao:novel-bookmarks:v1";

export type NovelSourceMatch = {
  key: string;
  novel: NovelSummary;
  updatedAt: string;
};

export type NovelResume = {
  id: string;
  novelKey: string;
  workId: string | null;
  title: string;
  chapterTitle: string;
  chapterIndex: number;
  progressPercent: number;
  href: string;
  coverUrl: string | null;
  updatedAt: string;
};

export type NovelBookmark = {
  id: string;
  novelKey: string;
  title: string;
  chapterId: string;
  chapterTitle: string;
  selectedText: string;
  note: string;
  progressPercent: number;
  href: string;
  createdAt: string;
};

export type NovelChapterGroup = { label: string; chapters: NovelChapter[] };

export function novelStorageKey(sourceId: string, novelId: string) {
  return `${sourceId}:${novelId}`;
}

export function novelMatchKey(externalId: string | undefined, title: string) {
  return externalId ? `anilist:${externalId}` : `title:${normalize(title)}`;
}

export function parseNovelMatches(value: string | null): NovelSourceMatch[] {
  return parseArray(value).filter(isMatch).slice(0, 100);
}

export function rememberNovelMatch(matches: NovelSourceMatch[], key: string, novel: NovelSummary) {
  return [{ key, novel, updatedAt: new Date().toISOString() }, ...matches.filter((item) => item.key !== key)].slice(0, 100);
}

export function forgetNovelMatch(matches: NovelSourceMatch[], key: string) {
  return matches.filter((item) => item.key !== key);
}

export function parseNovelResumes(value: string | null): NovelResume[] {
  return parseArray(value).filter(isResume).sort(newestFirst).slice(0, 30);
}

export function updateNovelResumes(items: NovelResume[], next: NovelResume) {
  return [next, ...items.filter((item) => item.novelKey !== next.novelKey)].sort(newestFirst).slice(0, 30);
}

export function resumeForWork(items: NovelResume[], workId: string) {
  return items.find((item) => item.workId === workId) ?? null;
}

export function parseNovelReadState(value: string | null): Record<string, string[]> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, ids]) =>
      Array.isArray(ids) ? [[key, ids.filter((id): id is string => typeof id === "string").slice(-5000)]] : [],
    ));
  } catch {
    return {};
  }
}

export function markNovelChapterRead(state: Record<string, string[]>, key: string, chapterId: string) {
  return { ...state, [key]: [...new Set([...(state[key] ?? []), chapterId])].slice(-5000) };
}

export function parseNovelBookmarks(value: string | null): NovelBookmark[] {
  return parseArray(value).filter(isBookmark).sort(newestFirst).slice(0, 500);
}

export function updateNovelBookmarks(items: NovelBookmark[], bookmark: NovelBookmark) {
  return [bookmark, ...items.filter((item) => item.id !== bookmark.id)].sort(newestFirst).slice(0, 500);
}

export function groupNovelChapters(chapters: NovelChapter[]): NovelChapterGroup[] {
  const groups = new Map<string, NovelChapter[]>();
  for (const chapter of chapters) {
    const match = chapter.title.match(/\b(?:volume|vol\.?)[\s#:-]*(\d+(?:\.\d+)?)/i);
    const label = match ? `Volume ${match[1]}` : "Chapters";
    groups.set(label, [...(groups.get(label) ?? []), chapter]);
  }
  return [...groups].map(([label, grouped]) => ({ label, chapters: grouped }));
}

function parseArray(value: string | null): unknown[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isMatch(value: unknown): value is NovelSourceMatch {
  if (!record(value) || typeof value.key !== "string" || !record(value.novel)) return false;
  const novel = value.novel;
  return typeof novel.id === "string" && typeof novel.sourceId === "string" && typeof novel.title === "string" && Array.isArray(novel.genres) && typeof value.updatedAt === "string";
}

function isResume(value: unknown): value is NovelResume {
  if (!record(value)) return false;
  return typeof value.id === "string" && typeof value.novelKey === "string" && (value.workId === null || typeof value.workId === "string") && typeof value.title === "string" && typeof value.chapterTitle === "string" && typeof value.chapterIndex === "number" && typeof value.progressPercent === "number" && typeof value.href === "string" && (value.coverUrl === null || typeof value.coverUrl === "string") && typeof value.updatedAt === "string";
}

function isBookmark(value: unknown): value is NovelBookmark {
  if (!record(value)) return false;
  return typeof value.id === "string" && typeof value.novelKey === "string" && typeof value.title === "string" && typeof value.chapterId === "string" && typeof value.chapterTitle === "string" && typeof value.selectedText === "string" && typeof value.note === "string" && typeof value.progressPercent === "number" && typeof value.href === "string" && typeof value.createdAt === "string";
}

function newestFirst(left: { updatedAt?: string; createdAt?: string }, right: { updatedAt?: string; createdAt?: string }) {
  return (right.updatedAt ?? right.createdAt ?? "").localeCompare(left.updatedAt ?? left.createdAt ?? "");
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
