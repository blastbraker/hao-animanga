import { normalizeTitle } from "@hao/domain";
import type { MangaChapter, MangaSource, MangaSummary } from "./manga-response";

export type ReadableMangaFallback = {
  source: MangaSource;
  item: MangaSummary;
  chapters: MangaChapter[];
};

type MangaFallbackOptions = {
  title: string;
  alternateTitles?: string[];
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
  const targetTitles = [...new Set([options.title, ...(options.alternateTitles ?? [])].map((title) => title.trim()).filter(Boolean))].slice(0, 8);
  for (const source of candidates) {
    const startedAt = Date.now();
    let match: MangaSummary | null = null;
    for (const searchTitle of targetTitles) {
      try {
        const results = await options.searchSource(source, searchTitle);
        match = targetTitles.map((title) => findExactMangaTitleMatch(results, title)).find(Boolean) ?? null;
        if (match) break;
      } catch {
        // One title spelling can fail while an alternate title still succeeds.
      }
    }
    try {
      if (!match) throw new Error("No matching title from this source");
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
