"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import {
  ArrowRight,
  BookOpen,
  CircleAlert,
  Clapperboard,
  LoaderCircle,
  Play,
  RefreshCw,
  Server,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { api, getActiveBridgeEndpoint, type DiscoverResponse, type LibraryResponse } from "../lib/api";
import { CONTINUE_WATCHING_STORAGE_KEY, DISMISSED_CONTINUE_STORAGE_KEY, parseContinueWatching, parseDismissedWorkIds, playbackPercent } from "../lib/playback-progress";
import { MediaCard } from "../components/media-card";

type AnimeSource = { id: string; name: string; language: string; supportsLatest: boolean; provider: string };
type AnimeItem = { id: string; title: string; description: string; provider: string; attribution: string; thumbnailUrl?: string | null };
type MangaSource = { id: string; name: string; displayName: string; language: string; mature: boolean; supportsLatest: boolean };
type MangaItem = { id: number; sourceId: string; title: string; author?: string; description?: string; genres: string[] };
type MangaCatalog = { items: MangaItem[]; hasNextPage: boolean };
type BrowseMode = "popular" | "latest";
type HomeContinueItem = { id: string; storageId: string | null; workId: string | null; title: string; coverUrl: string | null; episodeLabel: string; sourceLabel: string; percent: number; positionSeconds: number; updatedAt: string; href: string };

const fallback: Work[] = [{
  id: "10000000-0000-4000-8000-000000000001",
  kind: "ANIME",
  title: "Violet Evergarden",
  alternateTitles: [],
  synopsis: "A former child soldier learns the meaning of the words left to her by someone dear.",
  coverUrl: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21827-ubzq619ZA2E9.png",
  bannerUrl: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/21827-3EwjBS6ebj1C.jpg",
  year: 2018,
  status: "FINISHED",
  genres: ["Drama", "Fantasy"],
  maturityRating: "PG-13",
  averageScore: 85,
  source: { kind: "ANILIST", externalId: "21827" },
}];

export default function HomePage() {
  const [data, setData] = useState<DiscoverResponse>({ featured: fallback, trending: fallback, updated: fallback });
  const [bridge, setBridge] = useState("");
  const [animeSources, setAnimeSources] = useState<AnimeSource[]>([]);
  const [mangaSources, setMangaSources] = useState<MangaSource[]>([]);
  const [animeSourceId, setAnimeSourceId] = useState("");
  const [mangaSourceId, setMangaSourceId] = useState("");
  const [animeMode, setAnimeMode] = useState<BrowseMode>("popular");
  const [mangaMode, setMangaMode] = useState<BrowseMode>("popular");
  const [animeItems, setAnimeItems] = useState<AnimeItem[]>([]);
  const [mangaItems, setMangaItems] = useState<MangaItem[]>([]);
  const [connecting, setConnecting] = useState(true);
  const [animeBusy, setAnimeBusy] = useState(false);
  const [mangaBusy, setMangaBusy] = useState(false);
  const [bridgeError, setBridgeError] = useState("");
  const [animeError, setAnimeError] = useState("");
  const [mangaError, setMangaError] = useState("");
  const [continueItems, setContinueItems] = useState<HomeContinueItem[]>([]);

  const hero = data.featured[0] ?? fallback[0]!;
  const activeAnimeSource = useMemo(() => animeSources.find((source) => source.id === animeSourceId), [animeSourceId, animeSources]);
  const activeMangaSource = useMemo(() => mangaSources.find((source) => source.id === mangaSourceId), [mangaSourceId, mangaSources]);
  const sourceCount = animeSources.length + mangaSources.length;

  useEffect(() => {
    void api<DiscoverResponse>("/discover").then(setData).catch(() => undefined);
    void loadContinueItems();
    void connectRepositories();
  }, []);

  async function loadContinueItems() {
    const dismissed = new Set(parseDismissedWorkIds(readLocal(DISMISSED_CONTINUE_STORAGE_KEY)));
    const localEntries = parseContinueWatching(readLocal(CONTINUE_WATCHING_STORAGE_KEY)).filter((entry) => !entry.workId || !dismissed.has(entry.workId));
    const localItems: HomeContinueItem[] = localEntries.map((entry) => {
      const parameters = new URLSearchParams({ sourceId: entry.sourceId, animeId: entry.animeId, mode: "search", query: entry.animeTitle, episodeId: entry.episodeId });
      if (entry.workId) parameters.set("workId", entry.workId);
      return {
        id: `local:${entry.id}`, storageId: entry.id, workId: entry.workId, title: entry.animeTitle,
        coverUrl: entry.thumbnailUrl, episodeLabel: `Episode ${entry.episodeNumber} · ${entry.episodeTitle}`,
        sourceLabel: entry.sourceName, percent: playbackPercent(entry.positionSeconds, entry.durationSeconds) ?? 0,
        positionSeconds: entry.positionSeconds, updatedAt: entry.updatedAt, href: `/player/anime?${parameters.toString()}`,
      };
    });
    setContinueItems(localItems);
    try {
      const library = await api<LibraryResponse>("/library");
      const localWorkIds = new Set(localEntries.flatMap((entry) => entry.workId ? [entry.workId] : []));
      const syncedItems: HomeContinueItem[] = library.items.flatMap((entry) => {
        const progress = entry.progress;
        if (entry.work.kind !== "ANIME" || !progress?.positionSeconds || (progress.positionPercent ?? 0) >= 95 || localWorkIds.has(entry.work.id) || dismissed.has(entry.work.id)) return [];
        const episodeNumber = Math.floor(progress.completedUnits) + 1;
        const parameters = new URLSearchParams({ resumeEpisode: String(episodeNumber) });
        if (entry.work.source.kind === "ANILIST") parameters.set("anilistId", entry.work.source.externalId);
        return [{
          id: `synced:${entry.work.id}`, storageId: null, workId: entry.work.id, title: entry.work.title,
          coverUrl: entry.work.coverUrl, episodeLabel: `Episode ${episodeNumber}`,
          sourceLabel: "Synced HAO progress", percent: progress.positionPercent ?? 0,
          positionSeconds: progress.positionSeconds, updatedAt: progress.updatedAt,
          href: `/title/${entry.work.id}?${parameters.toString()}`,
        }];
      });
      setContinueItems([...localItems, ...syncedItems].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 12));
    } catch { /* Local continue-watching remains available while sync is offline. */ }
  }

  function removeContinueItem(item: HomeContinueItem) {
    if (item.storageId) {
      const remaining = parseContinueWatching(readLocal(CONTINUE_WATCHING_STORAGE_KEY)).filter((entry) => item.workId ? entry.workId !== item.workId : entry.id !== item.storageId);
      writeLocal(CONTINUE_WATCHING_STORAGE_KEY, JSON.stringify(remaining));
    }
    if (item.workId) {
      const dismissed = new Set(parseDismissedWorkIds(readLocal(DISMISSED_CONTINUE_STORAGE_KEY)));
      dismissed.add(item.workId);
      writeLocal(DISMISSED_CONTINUE_STORAGE_KEY, JSON.stringify([...dismissed]));
    }
    setContinueItems((items) => items.filter((candidate) => item.workId ? candidate.workId !== item.workId : candidate.id !== item.id));
  }

  async function requestBridge<T>(endpoint: string, path: string): Promise<T> {
    const response = await fetch(`${endpoint}${path}`);
    const payload = await response.json().catch(() => null) as ({ message?: string } & T) | null;
    if (!response.ok) throw new Error(payload?.message ?? `Bridge returned ${response.status}`);
    return payload as T;
  }

  async function connectRepositories() {
    setConnecting(true); setBridgeError(""); setAnimeError(""); setMangaError("");
    try {
      const endpoint = await getActiveBridgeEndpoint();
      await requestBridge(endpoint, "/health");
      setBridge(endpoint);

      const [animeResult, mangaResult] = await Promise.allSettled([
        requestBridge<AnimeSource[]>(endpoint, "/v1/anime/sources"),
        requestBridge<MangaSource[]>(endpoint, "/v1/manga/sources"),
      ]);
      const catalogRequests: Promise<void>[] = [];

      if (animeResult.status === "fulfilled") {
        const sources = animeResult.value;
        const preferred = sources.find((source) => source.language === "en") ?? sources[0];
        setAnimeSources(sources);
        if (preferred) {
          setAnimeSourceId(preferred.id);
          catalogRequests.push(loadAnimeCatalog(endpoint, preferred.id, "popular"));
        } else setAnimeError("Install and enable an Aniyomi extension to add anime here.");
      } else setAnimeError(errorMessage(animeResult.reason));

      if (mangaResult.status === "fulfilled") {
        const sources = mangaResult.value;
        const preferred = sources.find((source) => source.name === "MangaDex" && source.language === "en") ?? sources.find((source) => source.language === "en") ?? sources[0];
        setMangaSources(sources);
        if (preferred) {
          setMangaSourceId(preferred.id);
          catalogRequests.push(loadMangaCatalog(endpoint, preferred.id, "popular"));
        } else setMangaError("Install and enable a Mihon extension to add manga here.");
      } else setMangaError(errorMessage(mangaResult.reason));
      await Promise.all(catalogRequests);
    } catch (cause) {
      setBridgeError(errorMessage(cause));
      setBridge("");
    } finally {
      setConnecting(false);
    }
  }

  async function loadAnimeCatalog(endpoint: string, sourceId: string, mode: BrowseMode) {
    setAnimeBusy(true); setAnimeError("");
    try {
      const params = new URLSearchParams({ sourceId, mode, page: "1" });
      const items = await requestBridge<AnimeItem[]>(endpoint, `/v1/anime/catalog?${params.toString()}`);
      setAnimeItems(items.slice(0, 12));
      if (!items.length) setAnimeError(`This source returned no ${mode} anime.`);
    } catch (cause) {
      setAnimeItems([]); setAnimeError(errorMessage(cause));
    } finally { setAnimeBusy(false); }
  }

  async function loadMangaCatalog(endpoint: string, sourceId: string, mode: BrowseMode) {
    setMangaBusy(true); setMangaError("");
    try {
      const params = new URLSearchParams({ sourceId, mode, page: "1" });
      const result = await requestBridge<MangaCatalog>(endpoint, `/v1/manga/browse?${params.toString()}`);
      setMangaItems(result.items.slice(0, 12));
      if (!result.items.length) setMangaError(`This source returned no ${mode} manga.`);
    } catch (cause) {
      setMangaItems([]); setMangaError(errorMessage(cause));
    } finally { setMangaBusy(false); }
  }

  function changeAnimeSource(sourceId: string) {
    setAnimeSourceId(sourceId); setAnimeMode("popular");
    void loadAnimeCatalog(bridge, sourceId, "popular");
  }

  function changeMangaSource(sourceId: string) {
    setMangaSourceId(sourceId); setMangaMode("popular");
    void loadMangaCatalog(bridge, sourceId, "popular");
  }

  function changeAnimeMode(mode: BrowseMode) {
    setAnimeMode(mode); void loadAnimeCatalog(bridge, animeSourceId, mode);
  }

  function changeMangaMode(mode: BrowseMode) {
    setMangaMode(mode); void loadMangaCatalog(bridge, mangaSourceId, mode);
  }

  return <div className="page home-page">
    <section className="hero home-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,10,18,.98) 8%, rgba(8,10,18,.64) 54%, rgba(8,10,18,.2)), linear-gradient(0deg,#080a12 0%,transparent 48%), url(${hero.bannerUrl ?? hero.coverUrl})` }}>
      <div className="hero-copy">
        <span className="eyebrow"><Sparkles size={14}/> FEATURED ARCHIVE</span>
        <h1>{hero.title}</h1><p>{hero.synopsis}</p>
        <div className="hero-meta"><span>{hero.year}</span><span>{hero.status}</span><span>{hero.averageScore}% score</span></div>
        <div className="hero-actions"><Link href={`/title/${hero.id}?anilistId=${encodeURIComponent(hero.source.externalId)}`} className="button primary"><Sparkles size={18}/> Explore title</Link><Link href="#your-sources" className="button ghost"><Play size={18}/> Browse my sources</Link></div>
      </div>
      <div className="hero-index"><b>01</b><span>/ {String(Math.max(data.featured.length, 1)).padStart(2, "0")}</span></div>
    </section>

    <ContinueWatchingSection items={continueItems} onRemove={removeContinueItem}/>

    <section id="your-sources" className="content-block source-hub">
      <div className="source-hub-heading">
        <div><span className="eyebrow">YOUR LOCAL COLLECTION</span><h2>From your repositories</h2><p>Browse installed sources directly. Catalog requests stay between this browser and your HAO Bridge.</p></div>
        <div className={`bridge-status ${bridge ? "online" : ""}`}><span/><div><b>{connecting ? "Connecting" : bridge ? "Bridge online" : "Bridge unavailable"}</b><small>{bridge ? `${sourceCount} sources ready` : "Check Settings to reconnect"}</small></div></div>
      </div>

      {bridgeError ? <div className="source-hub-error"><CircleAlert/><div><b>Your repositories could not be reached</b><p>{bridgeError}</p></div><button className="button ghost" onClick={()=>void connectRepositories()}><RefreshCw/>Retry</button><Link className="button primary" href="/settings"><Settings/>Settings</Link></div> : <>
        <RepositorySection
          kind="anime"
          title="Anime from your sources"
          description={activeAnimeSource ? `${activeAnimeSource.name} · ${activeAnimeSource.language.toUpperCase()} · ${animeMode === "popular" ? "Popular now" : "Latest updates"}` : "Your installed Aniyomi sources"}
          icon={<Clapperboard/>}
          sources={animeSources.map((source) => ({ id: source.id, label: `${source.name} · ${source.language.toUpperCase()}`, supportsLatest: source.supportsLatest }))}
          sourceId={animeSourceId}
          mode={animeMode}
          busy={connecting || animeBusy}
          error={animeError}
          onSource={changeAnimeSource}
          onMode={changeAnimeMode}
          browseHref="/player/anime"
        >
          {animeItems.map((item) => <AnimeRepositoryCard key={item.id} item={item} sourceId={animeSourceId} mode={animeMode}/>) }
        </RepositorySection>

        <RepositorySection
          kind="manga"
          title="Manga from your sources"
          description={activeMangaSource ? `${activeMangaSource.displayName} · ${activeMangaSource.language.toUpperCase()} · ${mangaMode === "popular" ? "Popular now" : "Latest updates"}` : "Your installed Mihon sources"}
          icon={<BookOpen/>}
          sources={mangaSources.map((source) => ({ id: source.id, label: `${source.displayName} · ${source.language.toUpperCase()}`, supportsLatest: source.supportsLatest }))}
          sourceId={mangaSourceId}
          mode={mangaMode}
          busy={connecting || mangaBusy}
          error={mangaError}
          onSource={changeMangaSource}
          onMode={changeMangaMode}
          browseHref="/reader"
        >
          {mangaItems.map((item) => <MangaRepositoryCard key={item.id} item={item} endpoint={bridge} sourceId={mangaSourceId} mode={mangaMode}/>) }
        </RepositorySection>
      </>}
    </section>

    <MediaRow title="Trending across HAO" eyebrow="ANILIST DISCOVERY" items={data.trending}/>
    <MediaRow title="Fresh from the shelves" eyebrow="RECENTLY UPDATED" items={data.updated}/>
  </div>;
}

type RepositorySectionProps = {
  kind: "anime" | "manga";
  title: string;
  description: string;
  icon: React.ReactNode;
  sources: { id: string; label: string; supportsLatest: boolean }[];
  sourceId: string;
  mode: BrowseMode;
  busy: boolean;
  error: string;
  onSource: (sourceId: string) => void;
  onMode: (mode: BrowseMode) => void;
  browseHref: string;
  children: React.ReactNode;
};

function ContinueWatchingSection({ items, onRemove }: { items: HomeContinueItem[]; onRemove: (item: HomeContinueItem) => void }) {
  if (!items.length) return null;
  return <section className="content-block continue-watching-section">
    <div className="section-head"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Continue watching</h2></div><Link href="/library">My library <ArrowRight size={16}/></Link></div>
    <div className="continue-watching-row">{items.map((item)=><article className="continue-watch-card" key={item.id}>
      <Link href={item.href} aria-label={`Resume ${item.title}`}>
        <div className="continue-watch-cover">{item.coverUrl ? <img src={item.coverUrl} alt=""/> : <span><Clapperboard/></span>}<i style={{ width: `${item.percent}%` }}/></div>
        <div className="continue-watch-copy"><span>{item.sourceLabel}</span><h3>{item.title}</h3><p>{item.episodeLabel}</p><div className="continue-watch-meta"><b>{item.percent > 0 ? `${Math.round(item.percent)}% watched` : "Ready to start"}</b><small>{item.positionSeconds > 0 ? formatWatchTime(item.positionSeconds) : "Next episode"}</small></div><div className="continue-watch-track"><i style={{ width: `${item.percent}%` }}/></div></div>
        <span className="continue-watch-play"><Play fill="currentColor"/></span>
      </Link>
      <button className="continue-watch-remove" aria-label={`Remove ${item.title} from Continue Watching`} title="Remove from Continue Watching" onClick={()=>onRemove(item)}><X/></button>
    </article>)}</div>
  </section>;
}

function RepositorySection({ kind, title, description, icon, sources, sourceId, mode, busy, error, onSource, onMode, browseHref, children }: RepositorySectionProps) {
  const active = sources.find((source) => source.id === sourceId);
  const hasCards = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section className={`repository-shelf ${kind}`}>
    <header className="repository-shelf-head">
      <div className="repository-title"><span className="repository-icon">{icon}</span><div><h3>{title}</h3><p>{description}</p></div></div>
      <div className="repository-controls">
        <label><span>Source</span><select aria-label={`${kind} source`} value={sourceId} disabled={busy || !sources.length} onChange={(event)=>onSource(event.target.value)}>{sources.map((source)=><option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
        <div className="mode-switch" aria-label={`Browse ${kind}`}><button className={mode === "popular" ? "active" : ""} disabled={busy || !sourceId} onClick={()=>onMode("popular")}>Popular</button><button className={mode === "latest" ? "active" : ""} disabled={busy || !active?.supportsLatest} onClick={()=>onMode("latest")}>Latest</button></div>
        <Link href={browseHref} aria-label={`Open full ${kind} browser`}>View all <ArrowRight/></Link>
      </div>
    </header>
    {busy ? <RepositorySkeleton/> : error && !hasCards ? <RepositoryEmpty kind={kind} error={error}/> : <div className="repository-row">{children}</div>}
    {error && hasCards && <p className="repository-inline-error"><CircleAlert/> {error}</p>}
  </section>;
}

function AnimeRepositoryCard({ item, sourceId, mode }: { item: AnimeItem; sourceId: string; mode: BrowseMode }) {
  const href = `/player/anime?${new URLSearchParams({ sourceId, animeId: item.id, mode }).toString()}`;
  return <Link className="repository-card" href={href}>
    <div className="repository-poster anime-poster">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy"/> : <span className="poster-monogram"><Clapperboard/><b>{item.title.slice(0, 1)}</b></span>}<span className="repo-kind">ANIME</span><span className="repo-play"><Play fill="currentColor"/></span></div>
    <div className="repository-card-copy"><h4>{item.title}</h4><p>{item.provider}</p><small>{item.attribution}</small></div>
  </Link>;
}

function MangaRepositoryCard({ item, endpoint, sourceId, mode }: { item: MangaItem; endpoint: string; sourceId: string; mode: BrowseMode }) {
  const href = `/reader?${new URLSearchParams({ sourceId, mangaId: String(item.id), mode }).toString()}`;
  return <Link className="repository-card" href={href}>
    <div className="repository-poster"><img src={`${endpoint}/v1/manga/${item.id}/thumbnail`} alt="" loading="lazy"/><span className="repo-kind">MANGA</span><span className="repo-play"><BookOpen/></span></div>
    <div className="repository-card-copy"><h4>{item.title}</h4><p>{item.author ?? "Unknown author"}</p><small>{item.genres[0] ?? "Source catalog"}</small></div>
  </Link>;
}

function RepositorySkeleton() {
  return <div className="repository-row skeleton-row" aria-label="Loading repository titles">{Array.from({ length: 6 }, (_, index)=><div className="repository-card skeleton-card" key={index}><span/><i/><i/></div>)}</div>;
}

function RepositoryEmpty({ kind, error }: { kind: "anime" | "manga"; error: string }) {
  return <div className="repository-empty">{kind === "anime" ? <Clapperboard/> : <BookOpen/>}<div><b>No {kind} titles to show yet</b><p>{error}</p></div><Link href="/settings" className="button ghost"><Settings/>Manage sources</Link></div>;
}

function MediaRow({ title, eyebrow, items }: { title: string; eyebrow: string; items: Work[] }) {
  return <section className="content-block"><div className="section-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><Link href="/discover">Explore all <ArrowRight size={16}/></Link></div><div className="media-row">{items.map((work) => <MediaCard key={work.id} work={work}/>)}</div></section>;
}

function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : "This source could not complete the request."; }

function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeLocal(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Home remains usable when local storage is unavailable. */ }
}

function formatWatchTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
