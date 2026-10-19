"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProfilePreferences, Work } from "@hao/domain";
import { Activity, ArrowRight, BookOpen, CircleAlert, Clapperboard, History, Play, RefreshCw, Settings, Sparkles, Star, X } from "lucide-react";
import { api, bridgeErrorMessage, bridgeJson, getActiveBridge, type DiscoverResponse, type LibraryResponse } from "../lib/api";
import { CONTINUE_WATCHING_STORAGE_KEY, DISMISSED_CONTINUE_STORAGE_KEY, parseContinueWatching, parseDismissedWorkIds, playbackPercent } from "../lib/playback-progress";
import { NOVEL_RESUMES_KEY, parseNovelResumes } from "../lib/novel-state";
import { MediaCard } from "../components/media-card";
import { HomeShelf } from "../components/home-shelf";
import { HomeSourceStatus, type BridgeReadiness } from "../components/home-source-status";
import { cacheProfilePreferences, isWorkAllowed } from "../lib/profile-preferences";

type AnimeSource = {
  id: string;
  name: string;
  language: string;
  supportsLatest: boolean;
  provider: string;
};
type AnimeItem = {
  id: string;
  title: string;
  description: string;
  provider: string;
  attribution: string;
  thumbnailUrl?: string | null;
};
type MangaSource = {
  id: string;
  name: string;
  displayName: string;
  language: string;
  mature: boolean;
  supportsLatest: boolean;
};
type MangaItem = {
  id: number;
  sourceId: string;
  title: string;
  author?: string;
  description?: string;
  genres: string[];
};
type MangaCatalog = { items: MangaItem[]; hasNextPage: boolean };
type BrowseMode = "popular" | "latest";
type HomeContinueItem = {
  kind: "anime" | "novel";
  id: string;
  storageId: string | null;
  workId: string | null;
  title: string;
  coverUrl: string | null;
  episodeLabel: string;
  sourceLabel: string;
  percent: number;
  positionSeconds: number;
  updatedAt: string;
  href: string;
};

const fallback: Work[] = [
  {
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
    source: { kind: "ANILIST", externalId: "21827" }
  }
];

export default function HomePage() {
  const [data, setData] = useState<DiscoverResponse>({
    featured: fallback,
    trending: fallback,
    updated: fallback
  });
  const [bridge, setBridge] = useState("");
  const [bridgeScope, setBridgeScope] = useState<"personal" | "beta">("personal");
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
  const [bridgeReadiness, setBridgeReadiness] = useState<BridgeReadiness>({ online: false, animeCount: null, mangaCount: null, latencyMs: null });
  const [featuredIndex, setFeaturedIndex] = useState(0);

  const featured = data.featured.length ? data.featured : fallback;
  const selectedFeaturedIndex = Math.min(featuredIndex, featured.length - 1);
  const hero = featured[selectedFeaturedIndex]!;

  useEffect(() => {
    void Promise.all([api<DiscoverResponse>("/discover"), api<ProfilePreferences>("/profile")])
      .then(([discovery, preferences]) => {
        cacheProfilePreferences(preferences);
        setData({
          ...discovery,
          featured: discovery.featured.filter((work) => isWorkAllowed(work, preferences)),
          trending: discovery.trending.filter((work) => isWorkAllowed(work, preferences)),
          updated: discovery.updated.filter((work) => isWorkAllowed(work, preferences)),
        });
      })
      .catch(() => undefined);
    void loadContinueItems();
    void connectRepositories();
  }, []);

  useEffect(() => {
    if (!bridge) return;
    const interval = window.setInterval(() => void refreshBridgeReadiness(bridge), 30_000);
    return () => window.clearInterval(interval);
  }, [bridge]);

  async function loadContinueItems() {
    const dismissed = new Set(parseDismissedWorkIds(readLocal(DISMISSED_CONTINUE_STORAGE_KEY)));
    const localEntries = parseContinueWatching(readLocal(CONTINUE_WATCHING_STORAGE_KEY)).filter((entry) => !entry.workId || !dismissed.has(entry.workId));
    const localItems: HomeContinueItem[] = localEntries.map((entry) => {
      const parameters = new URLSearchParams({
        sourceId: entry.sourceId,
        animeId: entry.animeId,
        mode: "search",
        query: entry.animeTitle,
        episodeId: entry.episodeId
      });
      if (entry.workId) parameters.set("workId", entry.workId);
      return {
        kind: "anime" as const,
        id: `local:${entry.id}`,
        storageId: entry.id,
        workId: entry.workId,
        title: entry.animeTitle,
        coverUrl: entry.thumbnailUrl,
        episodeLabel: `Episode ${entry.episodeNumber} · ${entry.episodeTitle}`,
        sourceLabel: entry.sourceName,
        percent: playbackPercent(entry.positionSeconds, entry.durationSeconds) ?? 0,
        positionSeconds: entry.positionSeconds,
        updatedAt: entry.updatedAt,
        href: `/player/anime?${parameters.toString()}`
      };
    });
    const novelItems: HomeContinueItem[] = parseNovelResumes(readLocal(NOVEL_RESUMES_KEY)).map((entry) => ({
      kind: "novel",
      id: `novel:${entry.id}`,
      storageId: entry.id,
      workId: entry.workId,
      title: entry.title,
      coverUrl: entry.coverUrl,
      episodeLabel: entry.chapterTitle,
      sourceLabel: "Light novel",
      percent: entry.progressPercent,
      positionSeconds: 0,
      updatedAt: entry.updatedAt,
      href: entry.href,
    }));
    setContinueItems([...localItems, ...novelItems].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 12));
    try {
      const library = await api<LibraryResponse>("/library");
      const localWorkIds = new Set(localEntries.flatMap((entry) => (entry.workId ? [entry.workId] : [])));
      const syncedItems: HomeContinueItem[] = library.items.flatMap((entry) => {
        const progress = entry.progress;
        if (entry.work.kind !== "ANIME" || !progress?.positionSeconds || (progress.positionPercent ?? 0) >= 95 || localWorkIds.has(entry.work.id) || dismissed.has(entry.work.id)) return [];
        const episodeNumber = Math.floor(progress.completedUnits) + 1;
        const parameters = new URLSearchParams({
          resumeEpisode: String(episodeNumber)
        });
        if (entry.work.source.kind === "ANILIST") parameters.set("anilistId", entry.work.source.externalId);
        return [
          {
            kind: "anime" as const,
            id: `synced:${entry.work.id}`,
            storageId: null,
            workId: entry.work.id,
            title: entry.work.title,
            coverUrl: entry.work.coverUrl,
            episodeLabel: `Episode ${episodeNumber}`,
            sourceLabel: "Synced HAO progress",
            percent: progress.positionPercent ?? 0,
            positionSeconds: progress.positionSeconds,
            updatedAt: progress.updatedAt,
            href: `/title/${entry.work.id}?${parameters.toString()}`
          }
        ];
      });
      setContinueItems([...localItems, ...novelItems, ...syncedItems].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 12));
    } catch {
      /* Local continue-watching remains available while sync is offline. */
    }
  }

  function removeContinueItem(item: HomeContinueItem) {
    if (item.kind === "novel" && item.storageId) {
      const remaining = parseNovelResumes(readLocal(NOVEL_RESUMES_KEY)).filter((entry) => entry.id !== item.storageId);
      writeLocal(NOVEL_RESUMES_KEY, JSON.stringify(remaining));
    }
    if (item.kind === "anime" && item.storageId) {
      const remaining = parseContinueWatching(readLocal(CONTINUE_WATCHING_STORAGE_KEY)).filter((entry) => (item.workId ? entry.workId !== item.workId : entry.id !== item.storageId));
      writeLocal(CONTINUE_WATCHING_STORAGE_KEY, JSON.stringify(remaining));
    }
    if (item.workId) {
      const dismissed = new Set(parseDismissedWorkIds(readLocal(DISMISSED_CONTINUE_STORAGE_KEY)));
      dismissed.add(item.workId);
      writeLocal(DISMISSED_CONTINUE_STORAGE_KEY, JSON.stringify([...dismissed]));
    }
    setContinueItems((items) => items.filter((candidate) => (item.workId ? candidate.workId !== item.workId : candidate.id !== item.id)));
  }

  async function requestBridge<T>(endpoint: string, path: string): Promise<T> {
    return bridgeJson<T>(endpoint, path);
  }

  async function connectRepositories() {
    setConnecting(true);
    setBridgeError("");
    setAnimeError("");
    setMangaError("");
    try {
      const access = await getActiveBridge();
      const endpoint = access.endpoint;
      const startedAt = performance.now();
      await requestBridge(endpoint, "/health");
      setBridge(endpoint);
      setBridgeScope(access.scope);

      const [animeResult, mangaResult] = await Promise.allSettled([requestBridge<AnimeSource[]>(endpoint, "/v1/anime/sources"), requestBridge<MangaSource[]>(endpoint, "/v1/manga/sources")]);
      setBridgeReadiness({
        online: true,
        animeCount: animeResult.status === "fulfilled" ? animeResult.value.length : null,
        mangaCount: mangaResult.status === "fulfilled" ? mangaResult.value.length : null,
        latencyMs: Math.round(performance.now() - startedAt),
      });
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
      setBridgeReadiness({ online: false, animeCount: null, mangaCount: null, latencyMs: null });
    } finally {
      setConnecting(false);
    }
  }

  async function refreshBridgeReadiness(endpoint: string) {
    const startedAt = performance.now();
    const [health, anime, manga] = await Promise.allSettled([
      requestBridge(endpoint, "/health"),
      requestBridge<AnimeSource[]>(endpoint, "/v1/anime/sources"),
      requestBridge<MangaSource[]>(endpoint, "/v1/manga/sources"),
    ]);
    setBridgeReadiness({
      online: health.status === "fulfilled",
      animeCount: anime.status === "fulfilled" ? anime.value.length : null,
      mangaCount: manga.status === "fulfilled" ? manga.value.length : null,
      latencyMs: health.status === "fulfilled" ? Math.round(performance.now() - startedAt) : null,
    });
  }

  async function loadAnimeCatalog(endpoint: string, sourceId: string, mode: BrowseMode) {
    setAnimeBusy(true);
    setAnimeError("");
    try {
      const params = new URLSearchParams({ sourceId, mode, page: "1" });
      const items = await requestBridge<AnimeItem[]>(endpoint, `/v1/anime/catalog?${params.toString()}`);
      setAnimeItems(items.slice(0, 12));
      if (!items.length) setAnimeError(`This source returned no ${mode} anime.`);
    } catch (cause) {
      setAnimeItems([]);
      setAnimeError(errorMessage(cause));
    } finally {
      setAnimeBusy(false);
    }
  }

  async function loadMangaCatalog(endpoint: string, sourceId: string, mode: BrowseMode) {
    setMangaBusy(true);
    setMangaError("");
    try {
      const params = new URLSearchParams({ sourceId, mode, page: "1" });
      const result = await requestBridge<MangaCatalog>(endpoint, `/v1/manga/browse?${params.toString()}`);
      setMangaItems(result.items.slice(0, 12));
      if (!result.items.length) setMangaError(`This source returned no ${mode} manga.`);
    } catch (cause) {
      setMangaItems([]);
      setMangaError(errorMessage(cause));
    } finally {
      setMangaBusy(false);
    }
  }

  function changeAnimeSource(sourceId: string) {
    setAnimeSourceId(sourceId);
    setAnimeMode("popular");
    void loadAnimeCatalog(bridge, sourceId, "popular");
  }

  function changeMangaSource(sourceId: string) {
    setMangaSourceId(sourceId);
    setMangaMode("popular");
    void loadMangaCatalog(bridge, sourceId, "popular");
  }

  function changeAnimeMode(mode: BrowseMode) {
    setAnimeMode(mode);
    void loadAnimeCatalog(bridge, animeSourceId, mode);
  }

  function changeMangaMode(mode: BrowseMode) {
    setMangaMode(mode);
    void loadMangaCatalog(bridge, mangaSourceId, mode);
  }

  return (
    <div className="page home-page">
      <HomeSourceStatus readiness={bridgeReadiness} connecting={connecting} scope={bridgeScope} onRetry={() => void connectRepositories()} />
      <section
        aria-label="Featured titles"
        aria-roledescription="carousel"
        className={`hero home-hero ${hero.title.length > 52 ? "has-long-title" : ""}`}
        style={{
          backgroundImage: [
            "linear-gradient(90deg, rgba(8,10,18,.96) 0%, rgba(8,10,18,.72) 36%, rgba(8,10,18,.12) 78%)",
            "linear-gradient(0deg,rgba(8,10,18,.7) 0%,transparent 50%)",
            hero.bannerUrl ? `url(${hero.bannerUrl})` : "",
            hero.coverUrl ? `url(${hero.coverUrl})` : ""
          ].filter(Boolean).join(", ")
        }}
      >
        <div className="hero-copy">
          <span className="eyebrow">
            <Sparkles size={14} /> FEATURED
          </span>
          <h1 className={hero.title.length > 52 ? "long-title" : undefined} title={hero.title}>{hero.title}</h1>
          <p>{hero.synopsis}</p>
          <div className="hero-meta">
            {hero.year && <span>{hero.year}</span>}
            <span>{hero.kind === "LIGHT_NOVEL" ? "Light novel" : hero.kind.charAt(0) + hero.kind.slice(1).toLowerCase()}</span>
            {hero.averageScore != null && <span className="hero-score"><Star size={13} fill="currentColor" /> {(hero.averageScore / 10).toFixed(1)}</span>}
          </div>
          <div className="hero-actions">
            <Link href={hero.source.kind === "ANILIST" ? `/title/${hero.id}?anilistId=${encodeURIComponent(hero.source.externalId)}` : `/title/${hero.id}`} className="button primary">
              <Sparkles size={18} /> Explore title
            </Link>
            <Link href="#your-sources" className="button ghost">
              <Play size={18} /> Browse sources
            </Link>
          </div>
        </div>
        {featured.length > 1 && <div className="home-hero-dots" aria-label="Choose a featured title">
          {featured.map((work, index) => <button key={work.id} aria-label={`Show featured title: ${work.title}`} aria-pressed={index === selectedFeaturedIndex} onClick={() => setFeaturedIndex(index)}><span /></button>)}
        </div>}
      </section>

      <ContinueWatchingSection items={continueItems} onRemove={removeContinueItem} />

      <section id="your-sources" className="content-block source-hub">
        {bridgeError ? (
          <div className="source-hub-error">
            <CircleAlert />
            <div>
              <b>Your sources could not be reached</b>
              <p>{bridgeError}</p>
            </div>
            <button className="button ghost" onClick={() => void connectRepositories()}>
              <RefreshCw />
              Retry
            </button>
            <Link className="button primary" href="/settings">
              <Settings />
              Settings
            </Link>
          </div>
        ) : (
          <>
            <RepositorySection
              kind="anime"
              title="Anime"
              icon={<Clapperboard />}
              sources={animeSources.map((source) => ({
                id: source.id,
                label: `${source.name} · ${source.language.toUpperCase()}`,
                supportsLatest: source.supportsLatest
              }))}
              sourceId={animeSourceId}
              mode={animeMode}
              busy={connecting || animeBusy}
              error={animeError}
              onSource={changeAnimeSource}
              onMode={changeAnimeMode}
              browseHref="/player/anime"
            >
              {animeItems.map((item) => (
                <AnimeRepositoryCard key={item.id} item={item} endpoint={bridge} sourceId={animeSourceId} mode={animeMode} />
              ))}
            </RepositorySection>

            <RepositorySection
              kind="manga"
              title="Manga"
              icon={<BookOpen />}
              sources={mangaSources.map((source) => ({
                id: source.id,
                label: `${source.displayName} · ${source.language.toUpperCase()}`,
                supportsLatest: source.supportsLatest
              }))}
              sourceId={mangaSourceId}
              mode={mangaMode}
              busy={connecting || mangaBusy}
              error={mangaError}
              onSource={changeMangaSource}
              onMode={changeMangaMode}
              browseHref="/reader"
            >
              {mangaItems.map((item) => (
                <MangaRepositoryCard key={item.id} item={item} endpoint={bridge} sourceId={mangaSourceId} mode={mangaMode} />
              ))}
            </RepositorySection>
          </>
        )}
      </section>

      <MediaRow title="Trending across HAO" icon={<Activity />} items={data.trending} />
      <MediaRow title="New this year" icon={<Sparkles />} items={data.updated} />
    </div>
  );
}

type RepositorySectionProps = {
  kind: "anime" | "manga";
  title: string;
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
  return (
    <section className="content-block continue-watching-section">
      <div className="section-head">
        <h2><History aria-hidden="true" /> Continue watching & reading</h2>
        <Link href="/library">
          My library <ArrowRight size={16} />
        </Link>
      </div>
      <HomeShelf label="Continue watching and reading" variant="continue">
        {items.map((item) => (
          <article className="continue-watch-card" key={item.id}>
            <Link href={item.href} aria-label={`Resume ${item.title}`}>
              <div className="continue-watch-cover">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" />
                ) : (
                  <span>
                    <Clapperboard />
                  </span>
                )}
                <i style={{ width: `${item.percent}%` }} />
              </div>
              <div className="continue-watch-copy">
                <span className={`continue-kind ${item.kind}`} title={item.sourceLabel}>{item.kind === "novel" ? "NOVEL" : "ANIME"}</span>
                <h3 title={item.title}>{item.title}</h3>
                <p>{item.episodeLabel}</p>
                <div className="continue-watch-meta">
                  <b>{item.percent > 0 ? `${Math.round(item.percent)}% ${item.kind === "novel" ? "read" : "watched"}` : "Ready to start"}</b>
                  <small>{item.kind === "novel" ? "Resume chapter" : item.positionSeconds > 0 ? formatWatchTime(item.positionSeconds) : "Next episode"}</small>
                </div>
                <div className="continue-watch-track">
                  <i style={{ width: `${item.percent}%` }} />
                </div>
              </div>
              <span className="continue-watch-play">
                <Play fill="currentColor" />
              </span>
            </Link>
            <button className="continue-watch-remove" aria-label={`Remove ${item.title} from continue shelf`} title="Remove from continue shelf" onClick={() => onRemove(item)}>
              <X />
            </button>
          </article>
        ))}
      </HomeShelf>
    </section>
  );
}

function RepositorySection({ kind, title, icon, sources, sourceId, mode, busy, error, onSource, onMode, browseHref, children }: RepositorySectionProps) {
  const active = sources.find((source) => source.id === sourceId);
  const hasCards = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className={`repository-shelf ${kind}`}>
      <header className="repository-shelf-head">
        <div className="repository-title">
          <span className="repository-icon" aria-hidden="true">{icon}</span>
          <h2>{title}</h2>
        </div>
        <div className="repository-controls">
          <label>
            <span>Source</span>
            <select aria-label={`${kind} source`} value={sourceId} disabled={busy || !sources.length} onChange={(event) => onSource(event.target.value)}>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          <div className="mode-switch" aria-label={`Browse ${kind}`}>
            <button className={mode === "popular" ? "active" : ""} aria-pressed={mode === "popular"} disabled={busy || !sourceId} onClick={() => onMode("popular")}>
              Popular
            </button>
            <button className={mode === "latest" ? "active" : ""} aria-pressed={mode === "latest"} disabled={busy || !active?.supportsLatest} onClick={() => onMode("latest")}>
              Latest
            </button>
          </div>
          <Link href={sourceId ? `${browseHref}?${new URLSearchParams({ sourceId, mode }).toString()}` : browseHref} aria-label={`Open full ${kind} browser`}>
            View all <ArrowRight />
          </Link>
        </div>
      </header>
      {busy ? <RepositorySkeleton /> : error && !hasCards ? <RepositoryEmpty kind={kind} error={error} /> : <HomeShelf label={title}>{children}</HomeShelf>}
      {error && hasCards && (
        <p className="repository-inline-error">
          <CircleAlert /> {error}
        </p>
      )}
    </section>
  );
}

function AnimeRepositoryCard({ item, endpoint, sourceId, mode }: { item: AnimeItem; endpoint: string; sourceId: string; mode: BrowseMode }) {
  const [imageFailed, setImageFailed] = useState(false);
  const href = `/player/anime?${new URLSearchParams({ sourceId, animeId: item.id, mode }).toString()}`;
  return (
    <Link className="repository-card" href={href} title={`${item.title} · ${item.attribution || item.provider}`}>
      <div className="repository-poster anime-poster">
        {item.thumbnailUrl && !imageFailed ? (
          <img src={`${endpoint}/v1/anime/${encodeURIComponent(item.id)}/thumbnail`} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <span className="poster-monogram">
            <Clapperboard />
            <b>{item.title.slice(0, 1)}</b>
          </span>
        )}
        <span className="repo-kind">ANIME</span>
        <span className="repo-play">
          <Play fill="currentColor" />
        </span>
      </div>
      <div className="repository-card-copy">
        <h4>{item.title}</h4>
      </div>
    </Link>
  );
}

function MangaRepositoryCard({ item, endpoint, sourceId, mode }: { item: MangaItem; endpoint: string; sourceId: string; mode: BrowseMode }) {
  const href = `/reader?${new URLSearchParams({ sourceId, mangaId: String(item.id), mode }).toString()}`;
  return (
    <Link className="repository-card" href={href}>
      <div className="repository-poster">
        <img src={`${endpoint}/v1/manga/${item.id}/thumbnail`} alt="" loading="lazy" />
        <span className="repo-kind">MANGA</span>
        <span className="repo-play">
          <BookOpen />
        </span>
      </div>
      <div className="repository-card-copy">
        <h4>{item.title}</h4>
        {item.genres[0] && <p>{item.genres[0]}</p>}
      </div>
    </Link>
  );
}

function RepositorySkeleton() {
  return (
    <div className="repository-row skeleton-row" aria-label="Loading repository titles">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="repository-card skeleton-card" key={index}>
          <span />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

function RepositoryEmpty({ kind, error }: { kind: "anime" | "manga"; error: string }) {
  return (
    <div className="repository-empty">
      {kind === "anime" ? <Clapperboard /> : <BookOpen />}
      <div>
        <b>No {kind} titles to show yet</b>
        <p>{error}</p>
      </div>
      <Link href="/settings" className="button ghost">
        <Settings />
        Manage sources
      </Link>
    </div>
  );
}

function MediaRow({ title, icon, items }: { title: string; icon: React.ReactNode; items: Work[] }) {
  return (
    <section className="content-block">
      <div className="section-head">
        <h2>{icon} {title}</h2>
        <Link href="/discover">
          Explore all <ArrowRight size={16} />
        </Link>
      </div>
      <HomeShelf label={title}>
        {items.map((work) => (
          <MediaCard key={work.id} work={work} />
        ))}
      </HomeShelf>
    </section>
  );
}

function errorMessage(cause: unknown) {
  return bridgeErrorMessage(cause, "This source could not complete the request.");
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Home remains usable when local storage is unavailable. */
  }
}

function formatWatchTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
