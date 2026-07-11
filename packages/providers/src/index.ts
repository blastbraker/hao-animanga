import type { MediaKind, Work } from "@hao/domain";

export type ProviderResult<T> =
  | { ok: true; data: T; cached?: boolean }
  | { ok: false; error: { code: "UNAVAILABLE" | "UNAUTHORIZED" | "RATE_LIMITED" | "INVALID"; message: string; retryable: boolean } };

export interface SearchFilters {
  query: string;
  kind?: MediaKind;
  genre?: string;
  year?: number;
  page: number;
  pageSize: number;
}

export interface CatalogProvider {
  readonly id: string;
  search(filters: SearchFilters, signal?: AbortSignal): Promise<ProviderResult<{ items: Work[]; hasNextPage: boolean }>>;
  getWork(externalId: string, signal?: AbortSignal): Promise<ProviderResult<Work>>;
}

export interface StreamVariant {
  id: string;
  url: string;
  quality?: string;
  audio?: string;
  subtitles: Array<{ label: string; language?: string; url: string }>;
}

export interface AnimeProvider {
  readonly id: string;
  episodes(sourceId: string): Promise<ProviderResult<Array<{ id: string; number: number; title?: string }>>>;
  streams(episodeId: string): Promise<ProviderResult<StreamVariant[]>>;
}

export interface MangaProvider {
  readonly id: string;
  chapters(sourceId: string): Promise<ProviderResult<Array<{ id: string; number: number; title?: string }>>>;
  pages(chapterId: string): Promise<ProviderResult<Array<{ index: number; url: string }>>>;
}

export interface NovelProvider {
  readonly id: string;
  manifest(sourceId: string): Promise<ProviderResult<{ title: string; chapters: Array<{ id: string; title: string; href: string }> }>>;
}
