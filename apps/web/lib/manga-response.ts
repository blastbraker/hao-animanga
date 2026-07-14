export type MangaSource = {
  id: string;
  name: string;
  displayName: string;
  language: string;
  mature: boolean;
  supportsLatest: boolean;
};

export type MangaSummary = {
  id: number;
  sourceId: string;
  title: string;
  author?: string;
  description?: string;
  status?: string;
  genres: string[];
};

export type MangaSearchResponse = { items: MangaSummary[]; hasNextPage: boolean };

export type MangaChapter = {
  id: number;
  index: number;
  name: string;
  number: number;
  scanlator?: string;
  uploadDate: number;
  read: boolean;
  lastPageRead: number;
  pageCount: number;
};

export type MangaChapterPages = {
  mangaId: number;
  chapterIndex: number;
  chapterName: string;
  pageCount: number;
  pageUrls: string[];
};

export function normalizeMangaSources(value: unknown): MangaSource[] {
  return array(value).flatMap((item) => {
    if (!record(item) || !text(item.id) || !text(item.name) || !text(item.language)) return [];
    return [
      {
        id: item.id,
        name: item.name,
        displayName: text(item.displayName) ? item.displayName : item.name,
        language: item.language,
        mature: item.mature === true,
        supportsLatest: item.supportsLatest === true,
      },
    ];
  });
}

export function normalizeMangaSummary(value: unknown, fallback: MangaSummary): MangaSummary {
  const item = record(value) ? value : {};
  const author = optionalText(item.author) ?? fallback.author;
  const description = optionalText(item.description) ?? fallback.description;
  const status = optionalText(item.status) ?? fallback.status;
  return {
    id: finite(item.id) ? item.id : fallback.id,
    sourceId: text(item.sourceId) ? item.sourceId : fallback.sourceId,
    title: text(item.title) ? item.title : fallback.title,
    ...(author ? { author } : {}),
    ...(description ? { description } : {}),
    ...(status ? { status } : {}),
    genres: stringArray(item.genres),
  };
}

export function normalizeMangaSearchResponse(value: unknown): MangaSearchResponse {
  if (!record(value)) return { items: [], hasNextPage: false };
  const items = array(value.items).flatMap((item) => {
    if (!record(item) || !finite(item.id) || !text(item.title)) return [];
    return [
      normalizeMangaSummary(item, {
        id: item.id,
        sourceId: text(item.sourceId) ? item.sourceId : "",
        title: item.title,
        genres: [],
      }),
    ];
  });
  return { items, hasNextPage: value.hasNextPage === true };
}

export function normalizeMangaChapters(value: unknown): MangaChapter[] {
  return array(value).flatMap((item) => {
    if (!record(item) || !finite(item.id) || !finite(item.index)) return [];
    const scanlator = optionalText(item.scanlator);
    return [
      {
        id: item.id,
        index: item.index,
        name: text(item.name) ? item.name : `Chapter ${finite(item.number) ? item.number : item.index}`,
        number: finite(item.number) ? item.number : item.index,
        ...(scanlator ? { scanlator } : {}),
        uploadDate: finite(item.uploadDate) ? item.uploadDate : 0,
        read: item.read === true,
        lastPageRead: finite(item.lastPageRead) ? item.lastPageRead : 0,
        pageCount: finite(item.pageCount) ? item.pageCount : 0,
      },
    ];
  });
}

export function normalizeMangaChapterPages(value: unknown): MangaChapterPages | null {
  if (!record(value) || !finite(value.mangaId) || !finite(value.chapterIndex)) return null;
  const pageUrls = stringArray(value.pageUrls);
  return {
    mangaId: value.mangaId,
    chapterIndex: value.chapterIndex,
    chapterName: text(value.chapterName) ? value.chapterName : `Chapter ${value.chapterIndex}`,
    pageCount: pageUrls.length,
    pageUrls,
  };
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return array(value).filter(text);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalText(value: unknown): string | undefined {
  return text(value) ? value : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
