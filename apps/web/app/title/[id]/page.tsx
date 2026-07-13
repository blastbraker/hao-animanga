"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import { BookOpen, BookmarkPlus, CircleAlert, Clapperboard, Heart, LoaderCircle, Play, RefreshCw, Server, Star } from "lucide-react";
import { api, getActiveBridgeEndpoint } from "../../../lib/api";
import { confidentSourceMatch } from "../../../lib/source-match";

type AnimeSource = { id: string; name: string; language: string; supportsLatest: boolean; provider: string };
type AnimeItem = { id: string; title: string; description: string; provider: string; attribution: string; thumbnailUrl?: string | null };
type AnimeEpisode = { id: string; animeId: string; number: number; title: string };
type MangaSource = { id: string; name: string; displayName: string; language: string; mature: boolean };
type MangaItem = { id: number; sourceId: string; title: string; author?: string; description?: string; genres: string[] };
type MangaSearchResponse = { items: MangaItem[] };
type MangaChapter = { id: number; index: number; name: string; number: number; scanlator?: string; pageCount: number };
type AnimeAvailability = { source: AnimeSource; item: AnimeItem; episodes: AnimeEpisode[] };
type MangaAvailability = { source: MangaSource; item: MangaItem; chapters: MangaChapter[] };

export default function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const [work, setWork] = useState<Work | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [bridge, setBridge] = useState("");
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [animeAvailability, setAnimeAvailability] = useState<AnimeAvailability[]>([]);
  const [mangaAvailability, setMangaAvailability] = useState<MangaAvailability[]>([]);

  useEffect(() => {
    let cancelled = false;
    setWork(null); setError("");
    void params.then(async ({ id }) => {
      try {
        return await api<{ work: Work }>(`/works/${id}`);
      } catch (cause) {
        const externalId = new URLSearchParams(window.location.search).get("anilistId");
        if (!externalId) throw cause;
        return api<{ work: Work }>(`/works/anilist/${encodeURIComponent(externalId)}`);
      }
    }).then(({ work: nextWork }) => {
      if (!cancelled) setWork(nextWork);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "This title could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [params, reloadKey]);

  useEffect(() => {
    if (!work) return;
    let cancelled = false;
    setAvailabilityBusy(true); setAvailabilityError(""); setAnimeAvailability([]); setMangaAvailability([]);
    void loadAvailability(work).then((result) => {
      if (cancelled) return;
      setBridge(result.endpoint);
      setAnimeAvailability(result.anime); setMangaAvailability(result.manga);
    }).catch((cause: unknown) => {
      if (!cancelled) setAvailabilityError(cause instanceof Error ? cause.message : "Installed sources could not be checked.");
    }).finally(() => { if (!cancelled) setAvailabilityBusy(false); });
    return () => { cancelled = true; };
  }, [work]);

  const primaryAnime = animeAvailability[0];
  const primaryManga = mangaAvailability[0];
  const primaryHref = useMemo(() => {
    if (!work) return "#";
    if (primaryAnime) return animePlayerHref(primaryAnime.source.id, primaryAnime.item.id, work.title, primaryAnime.episodes[0]?.id);
    if (primaryManga) return mangaReaderHref(primaryManga.source.id, primaryManga.item.id);
    return work.kind === "ANIME" ? "/player/anime" : "/reader";
  }, [primaryAnime, primaryManga, work]);

  if (error) return <div className="page inner-page"><div className="empty-state title-error"><CircleAlert/><h2>Title unavailable</h2><p>{error}</p><button className="button primary" onClick={()=>setReloadKey((value)=>value+1)}><RefreshCw/>Retry</button><Link className="button ghost" href="/discover">Back to Discover</Link></div></div>;
  if (!work) return <div className="page inner-page empty-state">Opening title…</div>;

  async function save() {
    await api("/library", { method: "PUT", body: JSON.stringify({ workId: work!.id, status: "WATCHING_READING", favorite: true }) });
    setSaved(true);
  }

  const mediaLabel = work.kind === "ANIME" ? "anime" : "manga";
  return <div className="title-page">
    <div className="title-backdrop" style={{ backgroundImage: `linear-gradient(0deg,#080a12 5%,rgba(8,10,18,.25)),url(${work.bannerUrl ?? work.coverUrl})` }}/>
    <div className="title-content">
      <img className="detail-cover" src={work.coverUrl ?? "/icon.svg"} alt={`${work.title} cover`}/>
      <div className="detail-copy">
        <span className="eyebrow">{work.kind.replace("_", " ")} · {work.year}</span><h1>{work.title}</h1>
        <div className="title-meta"><span><Star size={15} fill="currentColor"/> {((work.averageScore ?? 0) / 10).toFixed(1)}</span><span>{work.status}</span><span>{work.maturityRating}</span></div>
        <p>{work.synopsis}</p><div className="genre-row">{work.genres.map((genre)=><span key={genre}>{genre}</span>)}</div>
        <div className="hero-actions">
          {availabilityBusy ? <button className="button primary" disabled><LoaderCircle className="spin"/> Checking {mediaLabel} sources…</button> : primaryAnime || primaryManga ? <Link href={primaryHref} className="button primary">{work.kind === "ANIME" ? <Play fill="currentColor"/> : <BookOpen/>}Open on {primaryAnime?.source.name ?? primaryManga?.source.displayName}</Link> : <button className="button primary" disabled>{work.kind === "ANIME" ? <Play/> : <BookOpen/>}Not in installed sources</button>}
          <button className="button ghost" onClick={()=>void save()}>{saved ? <Heart fill="currentColor"/> : <BookmarkPlus/>}{saved ? "Saved" : "Add to library"}</button>
        </div>
      </div>
    </div>
    <section className="content-block detail-section availability-section">
      <div className="section-head"><div><span className="eyebrow">AVAILABLE FROM YOUR SOURCES</span><h2>{work.kind === "ANIME" ? "Episodes" : "Chapters"}</h2></div>{bridge && <span className="availability-bridge"><Server/> Local Bridge</span>}</div>
      {availabilityBusy && <AvailabilitySkeleton kind={work.kind}/>}
      {availabilityError && !availabilityBusy && <div className="source-empty availability-error"><CircleAlert/><div><b>Installed sources could not be checked.</b><span>{availabilityError}</span></div><button className="button ghost" onClick={()=>setReloadKey((value)=>value+1)}><RefreshCw/>Retry</button></div>}
      {!availabilityBusy && !availabilityError && work.kind === "ANIME" && animeAvailability.map((availability)=><AnimeSourcePanel key={availability.source.id} availability={availability} workTitle={work.title}/>) }
      {!availabilityBusy && !availabilityError && work.kind !== "ANIME" && mangaAvailability.map((availability)=><MangaSourcePanel key={availability.source.id} availability={availability}/>) }
      {!availabilityBusy && !availabilityError && !animeAvailability.length && !mangaAvailability.length && <div className="source-empty"><b>No confident installed match was found.</b><span>This exact title or season is not currently available from your enabled sources. HAO will not open a similar title or a different season.</span><Link href={work.kind === "ANIME" ? "/player/anime" : "/reader"}>Open the source browser →</Link></div>}
    </section>
  </div>;
}

async function loadAvailability(work: Work): Promise<{ endpoint: string; anime: AnimeAvailability[]; manga: MangaAvailability[] }> {
  const endpoint = await getActiveBridgeEndpoint();
  if (work.kind === "ANIME") {
    const sources = await bridgeRequest<AnimeSource[]>(endpoint, "/v1/anime/sources");
    const candidates = preferredSources(sources, (source) => source.language, (source) => source.id, 8);
    const results = await Promise.allSettled(candidates.map(async (source): Promise<AnimeAvailability | null> => {
      const parameters = new URLSearchParams({ sourceId: source.id, mode: "search", query: work.title, page: "1" });
      const searchItems = await bridgeRequest<AnimeItem[]>(endpoint, `/v1/anime/catalog?${parameters.toString()}`);
      let item = confidentSourceMatch(work, searchItems);
      if (!item) {
        const modes = source.supportsLatest ? ["popular", "latest"] : ["popular"];
        const catalogs = await Promise.all(modes.map((mode) => bridgeRequest<AnimeItem[]>(endpoint, `/v1/anime/catalog?${new URLSearchParams({ sourceId: source.id, mode, page: "1" }).toString()}`)));
        item = confidentSourceMatch(work, catalogs.flat());
      }
      if (!item) return null;
      const episodes = (await bridgeRequest<AnimeEpisode[]>(endpoint, `/v1/anime/${encodeURIComponent(item.id)}/episodes`)).slice().sort((left, right) => left.number - right.number);
      return episodes.length ? { source, item, episodes } : null;
    }));
    return { endpoint, anime: fulfilled(results), manga: [] };
  }

  if (work.kind === "MANGA" || work.kind === "MANHWA") {
    const sources = await bridgeRequest<MangaSource[]>(endpoint, "/v1/manga/sources");
    const generalSources = sources.filter((source) => !source.mature);
    const candidates = preferredSources(generalSources, (source) => source.language, (source) => `${source.name}:${source.language}`, 8);
    const results = await Promise.allSettled(candidates.map(async (source): Promise<MangaAvailability | null> => {
      const parameters = new URLSearchParams({ sourceId: source.id, query: work.title, page: "1" });
      const response = await bridgeRequest<MangaSearchResponse>(endpoint, `/v1/manga/search?${parameters.toString()}`);
      const item = confidentSourceMatch(work, response.items);
      if (!item) return null;
      const chapters = await bridgeRequest<MangaChapter[]>(endpoint, `/v1/manga/${item.id}/chapters`);
      return chapters.length ? { source, item, chapters } : null;
    }));
    return { endpoint, anime: [], manga: fulfilled(results) };
  }
  return { endpoint, anime: [], manga: [] };
}

async function bridgeRequest<T>(endpoint: string, path: string): Promise<T> {
  const response = await fetch(`${endpoint}${path}`);
  const payload = await response.json().catch(() => null) as ({ message?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.message ?? `Bridge returned ${response.status}`);
  return payload as T;
}

function preferredSources<T>(sources: T[], language: (source: T) => string, identity: (source: T) => string, limit: number): T[] {
  const preferred = [...sources].sort((left, right) => Number(language(right) === "en") - Number(language(left) === "en"));
  const seen = new Set<string>();
  return preferred.filter((source) => { const key = identity(source); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, limit);
}

function fulfilled<T>(results: PromiseSettledResult<T | null>[]): T[] {
  return results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}

function animePlayerHref(sourceId: string, animeId: string, query: string, episodeId?: string) {
  const parameters = new URLSearchParams({ sourceId, animeId, mode: "search", query });
  if (episodeId) parameters.set("episodeId", episodeId);
  return `/player/anime?${parameters.toString()}`;
}

function mangaReaderHref(sourceId: string, mangaId: number, chapterIndex?: number) {
  const parameters = new URLSearchParams({ sourceId, mangaId: String(mangaId) });
  if (chapterIndex !== undefined) parameters.set("chapterIndex", String(chapterIndex));
  return `/reader?${parameters.toString()}`;
}

function AnimeSourcePanel({ availability, workTitle }: { availability: AnimeAvailability; workTitle: string }) {
  return <article className="availability-panel"><header><span className="availability-icon"><Clapperboard/></span><div><h3>{availability.item.title}</h3><p>{availability.source.name} · {availability.source.language.toUpperCase()} · {availability.episodes.length} episodes</p></div><Link className="button ghost compact" href={animePlayerHref(availability.source.id, availability.item.id, workTitle, availability.episodes[0]?.id)}><Play/>Play</Link></header><div className="release-list">{availability.episodes.slice(0, 60).map((episode)=><Link key={episode.id} href={animePlayerHref(availability.source.id, availability.item.id, workTitle, episode.id)}><span className="release-number">{episode.number}</span><span><b>{episode.title}</b><small>Episode {episode.number}</small></span><Play/></Link>)}</div></article>;
}

function MangaSourcePanel({ availability }: { availability: MangaAvailability }) {
  return <article className="availability-panel"><header><span className="availability-icon manga"><BookOpen/></span><div><h3>{availability.item.title}</h3><p>{availability.source.displayName} · {availability.source.language.toUpperCase()} · {availability.chapters.length} chapters</p></div><Link className="button ghost compact" href={mangaReaderHref(availability.source.id, availability.item.id)}><BookOpen/>Read</Link></header><div className="release-list">{availability.chapters.slice(0, 40).map((chapter)=><Link key={chapter.id} href={mangaReaderHref(availability.source.id, availability.item.id, chapter.index)}><span className="release-number">{chapter.number || "—"}</span><span><b>{chapter.name}</b><small>{chapter.scanlator ?? "Source release"}{chapter.pageCount ? ` · ${chapter.pageCount} pages` : ""}</small></span><BookOpen/></Link>)}</div></article>;
}

function AvailabilitySkeleton({ kind }: { kind: Work["kind"] }) {
  return <div className="availability-loading"><LoaderCircle className="spin"/><div><b>Checking installed {kind === "ANIME" ? "anime" : "manga"} sources…</b><span>Matching titles before loading releases.</span></div></div>;
}
