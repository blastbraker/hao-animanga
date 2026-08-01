import { createHash } from "node:crypto";
import type { MediaKind, Work } from "@hao/domain";
import type { CatalogProvider, ProviderResult, SearchFilters } from "@hao/providers";

interface AniListMedia {
  id: number;
  type: "ANIME" | "MANGA";
  format: string | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[];
  description: string | null;
  coverImage: { extraLarge: string | null; large: string | null };
  bannerImage: string | null;
  seasonYear: number | null;
  startDate: { year: number | null };
  status: string | null;
  genres: string[];
  isAdult: boolean;
  averageScore: number | null;
  countryOfOrigin: string | null;
}

export type AnimeDetails = {
  format: string | null;
  episodes: number | null;
  durationMinutes: number | null;
  season: string | null;
  startDate: { year: number | null; month: number | null; day: number | null };
  endDate: { year: number | null; month: number | null; day: number | null };
  country: string | null;
  adult: boolean;
  studios: string[];
  officialSiteUrl: string | null;
  trailerUrl: string | null;
  anilistUrl: string;
  malUrl: string | null;
};

const SEARCH_QUERY = `query Search($page: Int, $perPage: Int, $search: String, $type: MediaType, $genre: String, $year: Int, $status: MediaStatus, $isAdult: Boolean) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, genre: $genre, seasonYear: $year, status: $status, isAdult: $isAdult, sort: [TRENDING_DESC, POPULARITY_DESC]) {
      id type format title { romaji english native } synonyms description(asHtml: false)
      coverImage { extraLarge large } bannerImage seasonYear startDate { year } status genres isAdult averageScore countryOfOrigin
    }
  }
}`;

const MEDIA_FIELDS = `
  id type format title { romaji english native } synonyms description(asHtml: false)
  coverImage { extraLarge large } bannerImage seasonYear startDate { year } status genres isAdult averageScore countryOfOrigin
`;

const DISCOVER_QUERY = `query Discover($perPage: Int, $year: Int) {
  featured: Page(page: 1, perPage: 6) {
    media(type: ANIME, isAdult: false, sort: [TRENDING_DESC, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
  }
  trending: Page(page: 1, perPage: $perPage) {
    media(isAdult: false, sort: [TRENDING_DESC, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
  }
  updated: Page(page: 1, perPage: $perPage) {
    media(type: ANIME, seasonYear: $year, isAdult: false, sort: [START_DATE_DESC, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
  }
}`;

const WORK_QUERY = `query Work($id: Int!) {
  Media(id: $id) { ${MEDIA_FIELDS} }
}`;

const SEASONS_QUERY = `query Seasons($id: Int!) {
  Media(id: $id) {
    ${MEDIA_FIELDS}
    relations {
      edges {
        relationType(version: 2)
        node { ${MEDIA_FIELDS} }
      }
    }
  }
}`;

const ANIME_DETAILS_QUERY = `query AnimeDetails($id: Int!) {
  Media(id: $id, type: ANIME) {
    id idMal format episodes duration season countryOfOrigin isAdult siteUrl
    startDate { year month day }
    endDate { year month day }
    studios(isMain: true) { nodes { name } }
    externalLinks { site url type }
    trailer { id site }
  }
}`;

function kindFor(media: AniListMedia): MediaKind {
  if (media.type === "ANIME") return "ANIME";
  if (media.format === "NOVEL") return "LIGHT_NOVEL";
  if (media.countryOfOrigin === "KR") return "MANHWA";
  return "MANGA";
}

function mapWork(media: AniListMedia): Work {
  const title = media.title.english ?? media.title.romaji ?? media.title.native ?? `AniList ${media.id}`;
  return {
    id: stableWorkId(media.id),
    kind: kindFor(media),
    title,
    alternateTitles: [...new Set([media.title.romaji, media.title.english, media.title.native, ...media.synonyms].filter((v): v is string => Boolean(v && v !== title)))],
    synopsis: media.description?.replace(/<[^>]+>/g, "") ?? "",
    coverUrl: media.coverImage.extraLarge ?? media.coverImage.large,
    bannerUrl: media.bannerImage,
    year: media.seasonYear ?? media.startDate.year,
    status: media.status,
    genres: media.genres,
    maturityRating: media.isAdult ? "ADULT" : "GENERAL",
    averageScore: media.averageScore,
    source: { kind: "ANILIST", externalId: String(media.id) },
  };
}

function stableWorkId(externalId: number): string {
  const digest = createHash("sha256").update(`anilist:${externalId}`).digest("hex").split("");
  digest[12] = "4";
  digest[16] = "8";
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

const ANIME_SEASON_FORMATS = ["TV", "TV_SHORT", "ONA"];

function animeTitleValues(media: AniListMedia): string[] {
  return [media.title.english, media.title.romaji, media.title.native, ...media.synonyms]
    .filter((value): value is string => Boolean(value?.trim()));
}

function animePrimaryTitleValues(media: AniListMedia): string[] {
  return [media.title.english, media.title.romaji, media.title.native]
    .filter((value): value is string => Boolean(value?.trim()));
}

function seasonFamilyTitle(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/\s+(?:season\s*\d+(?:\s+part\s*\d+)?|part\s*\d+|\d+(?:st|nd|rd|th)\s+season)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function normalizedAnimeTitle(title: string): string {
  return title.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function seasonFamilyKeys(media: AniListMedia): Set<string> {
  const titles = animePrimaryTitleValues(media);
  const stripped = titles
    .map((title) => ({ family: seasonFamilyTitle(title), original: normalizedAnimeTitle(title) }))
    .filter(({ family, original }) => family && family !== original)
    .map(({ family }) => family);
  return new Set(stripped.length ? stripped : titles.map(seasonFamilyTitle).filter(Boolean));
}

function isWorkSeasonFamilyCandidate(seed: AniListMedia, candidate: Work): boolean {
  if (candidate.kind !== "ANIME") return false;
  const seedFamilies = seasonFamilyKeys(seed);
  return [candidate.title, ...candidate.alternateTitles].some((title) => seedFamilies.has(seasonFamilyTitle(title)));
}

function isMediaSeasonFamilyCandidate(seed: AniListMedia, candidate: AniListMedia): boolean {
  const seedFamilies = seasonFamilyKeys(seed);
  return animePrimaryTitleValues(candidate).some((title) => seedFamilies.has(seasonFamilyTitle(title)));
}

function hasFamilyRoot(seed: AniListMedia, candidates: Iterable<AniListMedia>): boolean {
  const seedFamilies = seasonFamilyKeys(seed);
  return [...candidates].some((candidate) => animePrimaryTitleValues(candidate).some((title) => seedFamilies.has(normalizedAnimeTitle(title))));
}

export class AniListProvider implements CatalogProvider {
  readonly id = "anilist";
  constructor(private readonly endpoint = process.env.ANILIST_API_URL ?? "https://graphql.anilist.co") {}

  async search(filters: SearchFilters, signal?: AbortSignal): Promise<ProviderResult<{ items: Work[]; hasNextPage: boolean }>> {
    const requestedType = filters.kind === "ANIME" ? "ANIME" : filters.kind ? "MANGA" : undefined;
    try {
      const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: {
            page: filters.page,
            perPage: filters.pageSize,
            search: filters.query || undefined,
            type: requestedType,
            genre: filters.genre,
            year: filters.year,
            status: filters.status,
            isAdult: filters.maturity === "GENERAL" ? false : filters.maturity === "ADULT" ? true : undefined,
          },
        }),
      };
      if (signal) init.signal = signal;
      const response = await fetch(this.endpoint, init);
      if (response.status === 429) return { ok: false, error: { code: "RATE_LIMITED", message: "AniList rate limit reached", retryable: true } };
      if (!response.ok) return { ok: false, error: { code: "UNAVAILABLE", message: `AniList returned ${response.status}`, retryable: response.status >= 500 } };
      const body = await response.json() as { data?: { Page?: { pageInfo: { hasNextPage: boolean }; media: AniListMedia[] } }; errors?: Array<{ message: string }> };
      if (!body.data?.Page) return { ok: false, error: { code: "UNAVAILABLE", message: body.errors?.[0]?.message ?? "AniList returned no data", retryable: true } };
      let items = body.data.Page.media.map(mapWork);
      if (filters.kind) items = items.filter((item) => item.kind === filters.kind);
      return { ok: true, data: { items, hasNextPage: body.data.Page.pageInfo.hasNextPage } };
    } catch (error) {
      return { ok: false, error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "AniList request failed", retryable: true } };
    }
  }

  async discover(signal?: AbortSignal): Promise<ProviderResult<{ featured: Work[]; trending: Work[]; updated: Work[] }>> {
    try {
      const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: DISCOVER_QUERY, variables: { perPage: 12, year: new Date().getUTCFullYear() } }),
      };
      if (signal) init.signal = signal;
      const response = await fetch(this.endpoint, init);
      if (response.status === 429) return { ok: false, error: { code: "RATE_LIMITED", message: "AniList rate limit reached", retryable: true } };
      if (!response.ok) return { ok: false, error: { code: "UNAVAILABLE", message: `AniList returned ${response.status}`, retryable: response.status >= 500 } };
      const body = await response.json() as {
        data?: { featured?: { media: AniListMedia[] }; trending?: { media: AniListMedia[] }; updated?: { media: AniListMedia[] } };
        errors?: Array<{ message: string }>;
      };
      if (!body.data?.trending?.media?.length) return { ok: false, error: { code: "UNAVAILABLE", message: body.errors?.[0]?.message ?? "AniList returned no discovery data", retryable: true } };
      const trending = body.data.trending.media.map(mapWork);
      const featuredCandidates = (body.data.featured?.media ?? []).map(mapWork);
      const featured = featuredCandidates.filter((work) => work.bannerUrl && work.coverUrl);
      return {
        ok: true,
        data: {
          featured: featured.length ? featured : trending.filter((work) => work.bannerUrl).slice(0, 4),
          trending,
          updated: (body.data.updated?.media ?? []).map(mapWork),
        },
      };
    } catch (error) {
      return { ok: false, error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "AniList discovery failed", retryable: true } };
    }
  }

  async getWork(externalId: string, signal?: AbortSignal): Promise<ProviderResult<Work>> {
    const id = Number(externalId);
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: { code: "INVALID", message: "AniList ID is invalid", retryable: false } };
    try {
      const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: WORK_QUERY, variables: { id } }),
      };
      if (signal) init.signal = signal;
      const response = await fetch(this.endpoint, init);
      if (response.status === 429) return { ok: false, error: { code: "RATE_LIMITED", message: "AniList rate limit reached", retryable: true } };
      if (!response.ok) return { ok: false, error: { code: "UNAVAILABLE", message: `AniList returned ${response.status}`, retryable: response.status >= 500 } };
      const body = await response.json() as { data?: { Media?: AniListMedia }; errors?: Array<{ message: string }> };
      if (!body.data?.Media) return { ok: false, error: { code: "UNAVAILABLE", message: body.errors?.[0]?.message ?? "Work unavailable", retryable: true } };
      return { ok: true, data: mapWork(body.data.Media) };
    } catch (error) {
      return { ok: false, error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "AniList work request failed", retryable: true } };
    }
  }

  async getAnimeSeasons(externalId: string, signal?: AbortSignal): Promise<ProviderResult<Work[]>> {
    const id = Number(externalId);
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: { code: "INVALID", message: "AniList ID is invalid", retryable: false } };
    try {
      type SeasonMedia = AniListMedia & { relations?: { edges?: Array<{ relationType: string; node: AniListMedia }> } };
      const pending = [id];
      const visited = new Set<number>();
      const discovered = new Map<number, AniListMedia>();
      const supplemented = new Map<string, Work>();
      let seedMedia: SeasonMedia | null = null;
      let firstFailure: { code: "UNAVAILABLE" | "RATE_LIMITED"; message: string; retryable: boolean } | null = null;
      while (pending.length && visited.size < 20) {
        const nextId = pending.shift()!;
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        const init: RequestInit = {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: SEASONS_QUERY, variables: { id: nextId } }),
        };
        if (signal) init.signal = signal;
        const response = await fetch(this.endpoint, init);
        if (response.status === 429) {
          firstFailure ??= { code: "RATE_LIMITED", message: "AniList rate limit reached", retryable: true };
          continue;
        }
        if (!response.ok) {
          firstFailure ??= { code: "UNAVAILABLE", message: `AniList returned ${response.status}`, retryable: response.status >= 500 };
          continue;
        }
        const body = await response.json() as { data?: { Media?: SeasonMedia }; errors?: Array<{ message: string }> };
        const media = body.data?.Media;
        if (!media) {
          firstFailure ??= { code: "UNAVAILABLE", message: body.errors?.[0]?.message ?? "Anime seasons unavailable", retryable: true };
          continue;
        }
        discovered.set(media.id, media);
        if (nextId === id) seedMedia = media;
        const mediaIsMovie = media.format === "MOVIE";
        if (nextId === id && !mediaIsMovie && !ANIME_SEASON_FORMATS.includes(media.format ?? "")) return { ok: true, data: [mapWork(media)] };
        for (const edge of media.relations?.edges ?? []) {
          const node = edge.node;
          const isConnectedSeason = (edge.relationType === "PREQUEL" || edge.relationType === "SEQUEL")
            && ANIME_SEASON_FORMATS.includes(media.format ?? "")
            && ANIME_SEASON_FORMATS.includes(node.format ?? "");
          const isRelatedMovie = edge.relationType === "SIDE_STORY"
            && ANIME_SEASON_FORMATS.includes(media.format ?? "")
            && node.format === "MOVIE";
          const isMovieParent = mediaIsMovie
            && edge.relationType === "PARENT"
            && ANIME_SEASON_FORMATS.includes(node.format ?? "");
          if (node.type === "ANIME" && (isConnectedSeason || isRelatedMovie || isMovieParent)) {
            discovered.set(node.id, node);
            if ((isConnectedSeason || isMovieParent) && !visited.has(node.id)) pending.push(node.id);
          }
        }
      }
      if (seedMedia && (discovered.size <= 1 || !hasFamilyRoot(seedMedia, discovered.values()))) {
        const search = animeTitleValues(seedMedia).map((title) => title.replace(/\s+(?:season\s*\d+(?:\s+part\s*\d+)?|part\s*\d+|\d+(?:st|nd|rd|th)\s+season)\s*$/i, "").trim()).find(Boolean);
        if (search) {
          const result = await this.search({ query: search, kind: "ANIME", page: 1, pageSize: 30 }, signal);
          if (result.ok) {
            for (const candidate of result.data.items) {
              if (isWorkSeasonFamilyCandidate(seedMedia, candidate)) supplemented.set(candidate.id, candidate);
            }
          }
        }
      }
      if (!discovered.size && firstFailure) return { ok: false, error: firstFailure };
      const grouped = new Map<string, Work>();
      for (const media of discovered.values()) {
        if (media.format === "ONA" && seedMedia && !isMediaSeasonFamilyCandidate(seedMedia, media)) continue;
        const item = mapWork(media);
        grouped.set(item.id, item);
      }
      for (const item of supplemented.values()) grouped.set(item.id, item);
      const items = [...grouped.values()].filter((item) => item.kind === "ANIME")
        .sort((left, right) => (left.year ?? 9999) - (right.year ?? 9999) || left.title.localeCompare(right.title));
      return { ok: true, data: items };
    } catch (error) {
      return { ok: false, error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "AniList seasons request failed", retryable: true } };
    }
  }

  async getAnimeDetails(externalId: string, signal?: AbortSignal): Promise<ProviderResult<AnimeDetails>> {
    const id = Number(externalId);
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: { code: "INVALID", message: "AniList ID is invalid", retryable: false } };
    try {
      const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: ANIME_DETAILS_QUERY, variables: { id } }),
      };
      if (signal) init.signal = signal;
      const response = await fetch(this.endpoint, init);
      if (response.status === 429) return { ok: false, error: { code: "RATE_LIMITED", message: "AniList rate limit reached", retryable: true } };
      if (!response.ok) return { ok: false, error: { code: "UNAVAILABLE", message: `AniList returned ${response.status}`, retryable: response.status >= 500 } };
      const body = await response.json() as { data?: { Media?: {
        id: number; idMal: number | null; format: string | null; episodes: number | null; duration: number | null; season: string | null;
        countryOfOrigin: string | null; isAdult: boolean; siteUrl: string | null;
        startDate: AnimeDetails["startDate"]; endDate: AnimeDetails["endDate"];
        studios?: { nodes?: Array<{ name: string }> }; externalLinks?: Array<{ site: string; url: string; type: string }>;
        trailer?: { id: string; site: string } | null;
      } }; errors?: Array<{ message: string }> };
      const media = body.data?.Media;
      if (!media) return { ok: false, error: { code: "UNAVAILABLE", message: body.errors?.[0]?.message ?? "Anime details unavailable", retryable: true } };
      const officialSite = media.externalLinks?.find((link) => link.site.toLocaleLowerCase() === "official site")
        ?? media.externalLinks?.find((link) => link.type === "INFO" && !/anilist|myanimelist/i.test(link.site));
      return { ok: true, data: {
        format: media.format,
        episodes: media.episodes,
        durationMinutes: media.duration,
        season: media.season,
        startDate: media.startDate,
        endDate: media.endDate,
        country: media.countryOfOrigin,
        adult: media.isAdult,
        studios: [...new Set((media.studios?.nodes ?? []).map((studio) => studio.name).filter(Boolean))],
        officialSiteUrl: officialSite?.url ?? null,
        trailerUrl: mapTrailerUrl(media.trailer),
        anilistUrl: media.siteUrl ?? `https://anilist.co/anime/${media.id}`,
        malUrl: media.idMal ? `https://myanimelist.net/anime/${media.idMal}` : null,
      } };
    } catch (error) {
      return { ok: false, error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "AniList details request failed", retryable: true } };
    }
  }
}

function mapTrailerUrl(trailer: { id: string; site: string } | null | undefined): string | null {
  if (!trailer?.id) return null;
  const site = trailer.site.toLocaleLowerCase();
  if (site === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.id)}`;
  if (site === "dailymotion") return `https://www.dailymotion.com/video/${encodeURIComponent(trailer.id)}`;
  return null;
}
