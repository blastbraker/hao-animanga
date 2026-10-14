import type { Work } from "@hao/domain";
import { confidentAudioSourceMatch, confidentSourceMatch } from "./source-match";

type AnimeIdentity = Pick<Work, "title" | "alternateTitles">;
export const MAX_ANIME_SEARCH_QUERIES = 4;

/** Use metadata aliases, never guessed translations or stripped season names. */
export function animeSourceQueries(work: AnimeIdentity): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const title of [work.title, ...work.alternateTitles]) {
    const query = title.trim().replace(/\s+/g, " ");
    const key = query.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (query.length < 2 || query.length > 256 || !key || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length === MAX_ANIME_SEARCH_QUERIES) break;
  }
  return queries;
}

/** Keep canonical aliases for recovery, but never borrow a different show's titles. */
export function animeSearchIdentity(query: string, alternateTitles: string[], canonical?: AnimeIdentity | null): AnimeIdentity {
  const sameWork = canonical && confidentSourceMatch(canonical, [{ title: query }]);
  return {
    title: query,
    alternateTitles: [...alternateTitles, ...(sameWork ? [canonical.title, ...canonical.alternateTitles] : [])],
  };
}

export async function searchAnimeSource<T extends { id: string; title: string }>(
  work: AnimeIdentity,
  search: (query: string) => Promise<T[]>,
  options: { preferredId?: string | undefined; audioMode?: "sub" | "dub" | undefined } = {},
): Promise<{ item: T | null; items: T[] }> {
  const found = new Map<string, T>();
  for (const query of animeSourceQueries(work)) {
    // A failing/offline/rate-limited source is left to the caller's source fallback;
    // do not multiply failed network requests by trying every alias.
    for (const item of await search(query)) found.set(item.id, item);
    const items = [...found.values()];
    const preferred = options.preferredId ? found.get(options.preferredId) : undefined;
    const item = (preferred && confidentSourceMatch(work, [preferred])) || (options.audioMode
      ? confidentAudioSourceMatch(work, items, options.audioMode)
      : confidentSourceMatch(work, items));
    if (item) return { item, items };
  }
  return { item: null, items: [...found.values()] };
}

/** An unavailable episode must not turn into episode one on the next source. */
export function sourceEpisodeForPlayback<T extends { id: string; number: number }>(episodes: T[], number: number | null, preferredId?: string): T | null {
  return episodes.find((episode) => episode.id === preferredId)
    ?? (number !== null ? episodes.find((episode) => episode.number === number) : episodes[0])
    ?? null;
}
