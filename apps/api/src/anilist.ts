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

const SEARCH_QUERY = `query Search($page: Int, $perPage: Int, $search: String, $type: MediaType, $genre: String, $year: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, genre: $genre, seasonYear: $year, sort: [TRENDING_DESC, POPULARITY_DESC]) {
      id type format title { romaji english native } synonyms description(asHtml: false)
      coverImage { extraLarge large } bannerImage seasonYear startDate { year } status genres isAdult averageScore countryOfOrigin
    }
  }
}`;

const MEDIA_FIELDS = `
  id type format title { romaji english native } synonyms description(asHtml: false)
  coverImage { extraLarge large } bannerImage seasonYear startDate { year } status genres isAdult averageScore countryOfOrigin
`;

const DISCOVER_QUERY = `query Discover($perPage: Int) {
  featured: Page(page: 1, perPage: 6) {
    media(type: ANIME, isAdult: false, sort: [TRENDING_DESC, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
  }
  trending: Page(page: 1, perPage: $perPage) {
    media(isAdult: false, sort: [TRENDING_DESC, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
  }
  updated: Page(page: 1, perPage: $perPage) {
    media(isAdult: false, sort: [UPDATED_AT_DESC, TRENDING_DESC]) { ${MEDIA_FIELDS} }
  }
}`;

const WORK_QUERY = `query Work($id: Int!) {
  Media(id: $id) { ${MEDIA_FIELDS} }
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

export class AniListProvider implements CatalogProvider {
  readonly id = "anilist";
  constructor(private readonly endpoint = process.env.ANILIST_API_URL ?? "https://graphql.anilist.co") {}

  async search(filters: SearchFilters, signal?: AbortSignal): Promise<ProviderResult<{ items: Work[]; hasNextPage: boolean }>> {
    const requestedType = filters.kind === "ANIME" ? "ANIME" : filters.kind ? "MANGA" : undefined;
    try {
      const init: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: SEARCH_QUERY, variables: { page: filters.page, perPage: filters.pageSize, search: filters.query || undefined, type: requestedType, genre: filters.genre, year: filters.year } }),
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
        body: JSON.stringify({ query: DISCOVER_QUERY, variables: { perPage: 12 } }),
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
}
