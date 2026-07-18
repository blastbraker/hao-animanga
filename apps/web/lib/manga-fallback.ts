import { normalizeTitle } from "@hao/domain";
import type { MangaChapter, MangaSource, MangaSummary } from "./manga-response";

export type ReadableMangaFallback = {
  source: MangaSource;
  item: MangaSummary;
  chapters: MangaChapter[];
};

type MangaFallbackOptions = {
  title: string;
  currentSourceId: string;
  language: string;
  sources: MangaSource[];
  searchSource: (source: MangaSource, title: string) => Promise<MangaSummary[]>;
  loadChapters: (item: MangaSummary) => Promise<MangaChapter[]>;
  onAttempt?: (source: MangaSource, succeeded: boolean, latencyMs: number) => void;
};

export function findExactMangaTitleMatch(items: MangaSummary[], title: string): MangaSummary | null {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return null;
  return items.find((item) => normalizeTitle(item.title) === normalizedTitle) ?? null;
}

export async function findReadableMangaFallback(options: MangaFallbackOptions): Promise<ReadableMangaFallback | null> {
  const candidates = options.sources.filter((source) => source.id !== options.currentSourceId && source.language === options.language);
  for (const source of candidates) {
    const startedAt = Date.now();
    try {
      const match = findExactMangaTitleMatch(await options.searchSource(source, options.title), options.title);
      if (!match) {
        options.onAttempt?.(source, false, Date.now() - startedAt);
        continue;
      }
      const item = match.sourceId ? match : { ...match, sourceId: source.id };
      const chapters = await options.loadChapters(item);
      const succeeded = chapters.length > 0;
      options.onAttempt?.(source, succeeded, Date.now() - startedAt);
      if (succeeded) return { source, item, chapters };
    } catch {
      options.onAttempt?.(source, false, Date.now() - startedAt);
    }
  }
  return null;
}
