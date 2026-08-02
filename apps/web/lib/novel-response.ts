export type NovelSource = {
  id: string;
  name: string;
  language: string;
  supportsLatest: boolean;
  mature: boolean;
};
export type NovelSummary = {
  id: string;
  sourceId: string;
  title: string;
  imageUrl?: string | null;
  author?: string | null;
  description?: string | null;
  status?: string | null;
  genres: string[];
};
export type NovelChapter = {
  id: string;
  index: number;
  title: string;
  sourceId: string;
  novelId: string;
  uploadDate?: number | null;
};
export type NovelChapterContent = {
  chapterId: string;
  novelId: string;
  title: string;
  html: string;
};
export type NovelSearchResponse = {
  items: NovelSummary[];
  hasNextPage: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeNovelSources(value: unknown): NovelSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    record(item) && text(item.id) && text(item.name)
      ? [
          {
            id: item.id,
            name: item.name,
            language: text(item.language) ? item.language : "unknown",
            supportsLatest: item.supportsLatest === true,
            mature: item.mature === true,
          },
        ]
      : [],
  );
}

export function normalizeNovelSummary(value: unknown): NovelSummary | null {
  if (
    !record(value) ||
    !text(value.id) ||
    !text(value.sourceId) ||
    !text(value.title)
  )
    return null;
  return {
    id: value.id,
    sourceId: value.sourceId,
    title: value.title,
    imageUrl: text(value.imageUrl) ? value.imageUrl : null,
    author: text(value.author) ? value.author : null,
    description: text(value.description) ? value.description : null,
    status: text(value.status) ? value.status : null,
    genres: Array.isArray(value.genres)
      ? value.genres.filter(text).slice(0, 40)
      : [],
  };
}

export function normalizeNovelSearch(value: unknown): NovelSearchResponse {
  if (!record(value)) return { items: [], hasNextPage: false };
  return {
    items: Array.isArray(value.items)
      ? value.items
          .map(normalizeNovelSummary)
          .filter((item): item is NovelSummary => item !== null)
      : [],
    hasNextPage: value.hasNextPage === true,
  };
}

export function normalizeNovelChapters(value: unknown): NovelChapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !record(item) ||
      !text(item.id) ||
      !text(item.sourceId) ||
      !text(item.novelId) ||
      !text(item.title) ||
      typeof item.index !== "number" ||
      !Number.isInteger(item.index) ||
      item.index < 0
    )
      return [];
    return [
      {
        id: item.id,
        sourceId: item.sourceId,
        novelId: item.novelId,
        title: item.title,
        index: item.index,
        uploadDate:
          typeof item.uploadDate === "number" ? item.uploadDate : null,
      },
    ];
  });
}

export function normalizeNovelChapterContent(
  value: unknown,
): NovelChapterContent | null {
  if (
    !record(value) ||
    !text(value.chapterId) ||
    !text(value.novelId) ||
    !text(value.title) ||
    typeof value.html !== "string"
  )
    return null;
  return {
    chapterId: value.chapterId,
    novelId: value.novelId,
    title: value.title,
    html: value.html,
  };
}
