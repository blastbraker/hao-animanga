import type { ProviderResult } from "@hao/providers";

export type EpisodeGuideItem = {
  number: number;
  title: string;
  filler: boolean;
  recap: boolean;
  airedAt: string | null;
  summary: string | null;
  thumbnailUrl: string | null;
  metadataUrl: string | null;
};

type AniListEpisodeMedia = {
  idMal?: number | null;
  title?: { english?: string | null; romaji?: string | null } | null;
  startDate?: { year?: number | null } | null;
};

type TvMazeEpisode = {
  number?: number | null;
  season?: number | null;
  name?: string | null;
  summary?: string | null;
  airdate?: string | null;
  url?: string | null;
  image?: { medium?: string | null; original?: string | null } | null;
};

type TvMazeShow = {
  name?: string | null;
  premiered?: string | null;
  _embedded?: { episodes?: TvMazeEpisode[] } | null;
};

const EPISODE_MEDIA_QUERY = `query EpisodeGuideMedia($id: Int!) { Media(id: $id, type: ANIME) { idMal title { english romaji } startDate { year } } }`;
const EMPTY_PREVIEW = { summary: null, thumbnailUrl: null, metadataUrl: null } as const;

export class EpisodeGuideProvider {
  private readonly cache = new Map<number, { expiresAt: number; maxEpisode: number; complete: boolean; items: EpisodeGuideItem[] }>();
  private readonly previewCache = new Map<string, { expiresAt: number; items: EpisodeGuideItem[] }>();

  constructor(
    private readonly anilistEndpoint = process.env.ANILIST_API_URL ?? "https://graphql.anilist.co",
    private readonly jikanEndpoint = process.env.JIKAN_API_URL ?? "https://api.jikan.moe/v4",
    private readonly tvMazeEndpoint = process.env.TVMAZE_API_URL ?? "https://api.tvmaze.com",
  ) {}

  async get(anilistExternalId: string, requestedMaxEpisode: number, signal?: AbortSignal): Promise<ProviderResult<EpisodeGuideItem[]>> {
    const anilistId = Number(anilistExternalId);
    if (!Number.isSafeInteger(anilistId) || anilistId <= 0) return { ok: false, error: { code: "INVALID", message: "AniList ID is invalid", retryable: false } };
    const maxEpisode = Math.max(1, Math.min(2_000, Math.ceil(requestedMaxEpisode || 100)));
    const cached = this.cache.get(anilistId);
    if (cached && cached.expiresAt > Date.now() && (cached.complete || cached.maxEpisode >= maxEpisode)) {
      return { ok: true, data: cached.items.filter((item) => item.number <= maxEpisode), cached: true };
    }

    try {
      const anilistResponse = await fetch(this.anilistEndpoint, requestInit({ query: EPISODE_MEDIA_QUERY, variables: { id: anilistId } }, signal));
      if (anilistResponse.status === 429) return { ok: false, error: { code: "RATE_LIMITED", message: "AniList rate limit reached", retryable: true } };
      if (!anilistResponse.ok) return { ok: false, error: { code: "UNAVAILABLE", message: `AniList returned ${anilistResponse.status}`, retryable: anilistResponse.status >= 500 } };
      const anilistBody = await anilistResponse.json() as { data?: { Media?: AniListEpisodeMedia | null } };
      const media = anilistBody.data?.Media;
      if (!media) return { ok: true, data: [] };

      const [jikan, previews] = await Promise.all([
        media.idMal ? this.getJikanEpisodes(media.idMal, maxEpisode, signal) : Promise.resolve({ items: [] as EpisodeGuideItem[], complete: true }),
        this.getTvMazePreviews(media, maxEpisode, signal),
      ]);
      const merged = mergeEpisodeMetadata(jikan.items, previews).filter((item) => item.number <= maxEpisode);
      this.cache.set(anilistId, {
        expiresAt: Date.now() + 6 * 60 * 60 * 1_000,
        maxEpisode,
        complete: jikan.complete,
        items: merged,
      });
      return { ok: true, data: merged };
    } catch (error) {
      return { ok: false, error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "Episode metadata request failed", retryable: true } };
    }
  }

  async getPreviews(title: string, requestedMaxEpisode: number, year?: number | null, signal?: AbortSignal): Promise<ProviderResult<EpisodeGuideItem[]>> {
    const cleanTitle = title.trim();
    if (cleanTitle.length < 2 || cleanTitle.length > 200) return { ok: false, error: { code: "INVALID", message: "Anime title is invalid", retryable: false } };
    const maxEpisode = Math.max(1, Math.min(2_000, Math.ceil(requestedMaxEpisode || 100)));
    const targetYear = year && Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
    const key = `${normalizeTitle(cleanTitle)}:${targetYear ?? "unknown"}:${maxEpisode}`;
    const cached = this.previewCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return { ok: true, data: cached.items, cached: true };
    const items = await this.getTvMazePreviews({ title: { english: cleanTitle }, startDate: { year: targetYear } }, maxEpisode, signal);
    this.previewCache.set(key, { expiresAt: Date.now() + 6 * 60 * 60 * 1_000, items });
    return { ok: true, data: items };
  }

  private async getJikanEpisodes(malId: number, maxEpisode: number, signal?: AbortSignal): Promise<{ items: EpisodeGuideItem[]; complete: boolean }> {
    const items: EpisodeGuideItem[] = [];
    const requiredPages = Math.min(20, Math.ceil(maxEpisode / 100));
    let complete = false;
    for (let page = 1; page <= requiredPages; page += 1) {
      try {
        const response = await fetch(`${this.jikanEndpoint}/anime/${malId}/episodes?page=${page}`, signal ? { signal } : undefined);
        if (!response.ok) break;
        const body = await response.json() as {
          data?: Array<{ mal_id: number; title?: string | null; filler?: boolean; recap?: boolean; aired?: string | null }>;
          pagination?: { has_next_page?: boolean };
        };
        for (const episode of body.data ?? []) {
          if (!Number.isFinite(episode.mal_id)) continue;
          items.push({
            number: episode.mal_id,
            title: episode.title?.trim() ?? "",
            filler: episode.filler === true,
            recap: episode.recap === true,
            airedAt: episode.aired ?? null,
            ...EMPTY_PREVIEW,
          });
        }
        if (!body.pagination?.has_next_page) { complete = true; break; }
      } catch {
        break;
      }
    }
    return { items, complete };
  }

  private async getTvMazePreviews(media: AniListEpisodeMedia, maxEpisode: number, signal?: AbortSignal): Promise<EpisodeGuideItem[]> {
    const titles = [media.title?.english, media.title?.romaji].filter((title): title is string => Boolean(title?.trim()));
    if (!titles.length) return [];
    for (const title of titles) {
      try {
        const url = `${this.tvMazeEndpoint}/singlesearch/shows?q=${encodeURIComponent(title)}&embed=episodes`;
        const response = await fetch(url, {
          ...(signal ? { signal } : {}),
          headers: { accept: "application/json", "user-agent": "HAO-PWA/1.0 (episode previews)" },
        });
        if (!response.ok) continue;
        const show = await response.json() as TvMazeShow;
        if (!show.name || !titles.some((candidate) => titlesMatch(candidate, show.name!))) continue;
        const selected = selectTvMazeEpisodes(show, media.startDate?.year ?? null, maxEpisode);
        if (!selected.length) continue;
        return selected.map((episode, index) => ({
          number: episode.absoluteNumber ?? episode.episode.number ?? index + 1,
          title: episode.episode.name?.trim() ?? "",
          filler: false,
          recap: false,
          airedAt: episode.episode.airdate ?? null,
          summary: cleanSummary(episode.episode.summary),
          thumbnailUrl: episode.episode.image?.original ?? episode.episode.image?.medium ?? null,
          metadataUrl: httpsUrl(episode.episode.url),
        }));
      } catch {
        // Episode previews are optional; Jikan/source metadata remains available.
      }
    }
    return [];
  }
}

function mergeEpisodeMetadata(jikan: EpisodeGuideItem[], previews: EpisodeGuideItem[]): EpisodeGuideItem[] {
  const items = new Map<number, EpisodeGuideItem>();
  for (const item of previews) items.set(item.number, item);
  for (const item of jikan) {
    const preview = items.get(item.number);
    items.set(item.number, {
      ...item,
      airedAt: item.airedAt ?? preview?.airedAt ?? null,
      summary: preview?.summary ?? null,
      thumbnailUrl: preview?.thumbnailUrl ?? null,
      metadataUrl: preview?.metadataUrl ?? null,
    });
  }
  return [...items.values()].sort((left, right) => left.number - right.number);
}

function selectTvMazeEpisodes(show: TvMazeShow, targetYear: number | null, maxEpisode: number): Array<{ episode: TvMazeEpisode; absoluteNumber?: number }> {
  const episodes = (show._embedded?.episodes ?? []).filter((episode) => Number.isFinite(episode.number) && Number(episode.number) > 0);
  if (!episodes.length) return [];
  const groups = new Map<number, TvMazeEpisode[]>();
  for (const episode of episodes) {
    const season = Number.isFinite(episode.season) ? Number(episode.season) : 1;
    groups.set(season, [...(groups.get(season) ?? []), episode]);
  }
  const premiereYear = yearOf(show.premiered);
  const ranked = [...groups.values()].map((items) => {
    const year = items.map((item) => yearOf(item.airdate)).find((value): value is number => value !== null) ?? premiereYear;
    const yearDistance = targetYear && year ? Math.abs(targetYear - year) : 0;
    const countDistance = Math.abs(Math.min(maxEpisode, items.length) - maxEpisode) / Math.max(1, maxEpisode);
    return { items, yearDistance, score: yearDistance * 10 + countDistance };
  }).sort((left, right) => left.score - right.score);
  const selected = ranked[0];
  if (!selected || (targetYear && selected.yearDistance > 2)) return [];

  const chronological = [...episodes].sort((left, right) => String(left.airdate ?? "").localeCompare(String(right.airdate ?? "")) || Number(left.season) - Number(right.season) || Number(left.number) - Number(right.number));
  const isOriginalLongRun = Boolean(targetYear && premiereYear && Math.abs(targetYear - premiereYear) <= 1 && maxEpisode > selected.items.length + 5 && chronological.length >= Math.min(maxEpisode, 25));
  if (isOriginalLongRun) return chronological.slice(0, maxEpisode).map((episode, index) => ({ episode, absoluteNumber: index + 1 }));
  return [...selected.items].sort((left, right) => Number(left.number) - Number(right.number)).map((episode) => ({ episode }));
}

function titlesMatch(left: string, right: string): boolean {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a)))) return true;
  const aWords = new Set(a.split(" ").filter((word) => word.length > 1));
  const bWords = new Set(b.split(" ").filter((word) => word.length > 1));
  const shared = [...aWords].filter((word) => bWords.has(word)).length;
  return shared / Math.max(1, Math.min(aWords.size, bWords.size)) >= 0.72;
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanSummary(value: string | null | undefined): string | null {
  const summary = value
    ?.replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return summary || null;
}

function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function yearOf(value: string | null | undefined): number | null {
  const year = Number(value?.slice(0, 4));
  return Number.isInteger(year) && year > 1900 && year < 2200 ? year : null;
}

function requestInit(body: unknown, signal?: AbortSignal): RequestInit {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) };
  if (signal) init.signal = signal;
  return init;
}
