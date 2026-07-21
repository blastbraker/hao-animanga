import type { ProviderResult } from "@hao/providers";

export type EpisodeGuideItem = {
  number: number;
  title: string;
  filler: boolean;
  recap: boolean;
  airedAt: string | null;
};

const MAL_ID_QUERY = `query EpisodeGuideMedia($id: Int!) { Media(id: $id, type: ANIME) { idMal } }`;

export class EpisodeGuideProvider {
  private readonly cache = new Map<number, { expiresAt: number; maxEpisode: number; complete: boolean; items: EpisodeGuideItem[] }>();

  constructor(
    private readonly anilistEndpoint = process.env.ANILIST_API_URL ?? "https://graphql.anilist.co",
    private readonly jikanEndpoint = process.env.JIKAN_API_URL ?? "https://api.jikan.moe/v4",
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
      const anilistResponse = await fetch(this.anilistEndpoint, requestInit({ query: MAL_ID_QUERY, variables: { id: anilistId } }, signal));
      if (anilistResponse.status === 429) return { ok: false, error: { code: "RATE_LIMITED", message: "AniList rate limit reached", retryable: true } };
      if (!anilistResponse.ok) return { ok: false, error: { code: "UNAVAILABLE", message: `AniList returned ${anilistResponse.status}`, retryable: anilistResponse.status >= 500 } };
      const anilistBody = await anilistResponse.json() as { data?: { Media?: { idMal?: number | null } } };
      const malId = anilistBody.data?.Media?.idMal;
      if (!malId) return { ok: true, data: [] };

      const items: EpisodeGuideItem[] = [];
      const requiredPages = Math.min(20, Math.ceil(maxEpisode / 100));
      let complete = false;
      for (let page = 1; page <= requiredPages; page += 1) {
        const response = await fetch(`${this.jikanEndpoint}/anime/${malId}/episodes?page=${page}`, signal ? { signal } : undefined);
        if (response.status === 429) {
          if (!items.length) return { ok: false, error: { code: "RATE_LIMITED", message: "Episode metadata rate limit reached", retryable: true } };
          break;
        }
        if (!response.ok) {
          if (!items.length) return { ok: false, error: { code: "UNAVAILABLE", message: `Episode metadata returned ${response.status}`, retryable: response.status >= 500 } };
          break;
        }
        const body = await response.json() as {
          data?: Array<{ mal_id: number; title?: string | null; filler?: boolean; recap?: boolean; aired?: string | null }>;
          pagination?: { has_next_page?: boolean };
        };
        for (const episode of body.data ?? []) {
          if (!Number.isFinite(episode.mal_id)) continue;
          items.push({ number: episode.mal_id, title: episode.title?.trim() ?? "", filler: episode.filler === true, recap: episode.recap === true, airedAt: episode.aired ?? null });
        }
        if (!body.pagination?.has_next_page) { complete = true; break; }
      }
      const unique = [...new Map(items.map((item) => [item.number, item])).values()].sort((left, right) => left.number - right.number);
      this.cache.set(anilistId, { expiresAt: Date.now() + 6 * 60 * 60 * 1_000, maxEpisode, complete, items: unique });
      return { ok: true, data: unique.filter((item) => item.number <= maxEpisode) };
    } catch (error) {
      return { ok: false, error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "Episode metadata request failed", retryable: true } };
    }
  }
}

function requestInit(body: unknown, signal?: AbortSignal): RequestInit {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) };
  if (signal) init.signal = signal;
  return init;
}
