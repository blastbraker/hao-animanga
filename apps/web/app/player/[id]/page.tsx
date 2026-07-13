"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Film, LoaderCircle, RefreshCw, Search, Server, TriangleAlert } from "lucide-react";
import Hls from "hls.js";
import { api, getActiveBridgeEndpoint, type LibraryResponse } from "../../../lib/api";
import { completedEpisodeUnits, continueWatchingId, CONTINUE_WATCHING_STORAGE_KEY, DISMISSED_CONTINUE_STORAGE_KEY, parseContinueWatching, parseDismissedWorkIds, parsePlaybackPosition, playbackPercent, playbackStorageKey, resumablePosition, updateContinueWatching, type ContinueWatchingEntry } from "../../../lib/playback-progress";

type AnimeSourceSummary = { id: string; name: string; language: string; supportsLatest: boolean; provider: string };
type AnimeCatalogItem = { id: string; title: string; description: string; provider: string; attribution: string; thumbnailUrl?: string | null };
type AnimeEpisode = { id: string; animeId: string; number: number; title: string };
type AnimeServer = { id: string; name: string };
type AnimeSubtitle = { label: string; language?: string; url: string };
type AnimeStream = { id: string; serverId: string; url: string; kind: "MP4" | "HLS"; quality?: string; audio?: string; subtitles: AnimeSubtitle[] };

export default function PlayerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoplayRequestedRef = useRef(false);
  const lastSavedAtRef = useRef(0);
  const restoredPlaybackKeyRef = useRef("");
  const remoteProgressRef = useRef<{ episodeNumber: number; positionSeconds: number } | null>(null);
  const [bridge, setBridge] = useState("");
  const [workId, setWorkId] = useState("");
  const [workCoverUrl, setWorkCoverUrl] = useState<string | null>(null);
  const [sources, setSources] = useState<AnimeSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [browseMode, setBrowseMode] = useState<"popular" | "latest" | "search">("popular");
  const [searchDraft, setSearchDraft] = useState("");
  const [catalog, setCatalog] = useState<AnimeCatalogItem[]>([]);
  const [animeId, setAnimeId] = useState("");
  const [episodes, setEpisodes] = useState<AnimeEpisode[]>([]);
  const [episodeId, setEpisodeId] = useState("");
  const [servers, setServers] = useState<AnimeServer[]>([]);
  const [serverId, setServerId] = useState("");
  const [streams, setStreams] = useState<AnimeStream[]>([]);
  const [streamId, setStreamId] = useState("");
  const [autoplayNext, setAutoplayNext] = useState(true);
  const [progressStatus, setProgressStatus] = useState("");
  const [busy, setBusy] = useState("Connecting to your HAO Bridge…");
  const [error, setError] = useState("");

  const anime = useMemo(() => catalog.find((item) => item.id === animeId), [animeId, catalog]);
  const episode = useMemo(() => episodes.find((item) => item.id === episodeId), [episodeId, episodes]);
  const episodeIndex = useMemo(() => episodes.findIndex((item) => item.id === episodeId), [episodeId, episodes]);
  const previousEpisode = episodeIndex > 0 ? episodes[episodeIndex - 1] : undefined;
  const nextEpisode = episodeIndex >= 0 && episodeIndex < episodes.length - 1 ? episodes[episodeIndex + 1] : undefined;
  const stream = useMemo(() => streams.find((item) => item.id === streamId), [streamId, streams]);
  const streamUrl = stream ? (stream.url.startsWith("/") ? `${bridge}${stream.url}` : stream.url) : "";

  async function bridgeRequest<T>(endpoint: string, path: string): Promise<T> {
    const response = await fetch(`${endpoint}${path}`);
    const payload = await response.json().catch(() => null) as ({ message?: string } & T) | null;
    if (!response.ok) throw new Error(payload?.message ?? `Bridge returned ${response.status}`);
    return payload as T;
  }

  useEffect(() => {
    setAutoplayNext(readPreference("hao:anime:autoplay-next") !== "false");
    void connect();
    return () => { safelyResetVideo(videoRef.current); };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || !streamUrl) return;
    setError("");
    if (stream.kind === "HLS" && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError("The selected HLS stream could not be loaded. Try another quality.");
      });
      return () => { hls.destroy(); safelyResetVideo(video); };
    }
    video.src = streamUrl;
    video.load();
    return () => { safelyResetVideo(video); };
  }, [stream, streamUrl]);

  async function connect() {
    setBusy("Connecting to your HAO Bridge…"); setError("");
    try {
      const parameters = new URLSearchParams(window.location.search);
      const requestedSourceId = parameters.get("sourceId");
      const requestedAnimeId = parameters.get("animeId");
      const requestedEpisodeId = parameters.get("episodeId");
      const requestedWorkId = parameters.get("workId") ?? "";
      const requestedQuery = parameters.get("query")?.trim() ?? "";
      const requestedMode: "popular" | "latest" | "search" = parameters.get("mode") === "search" && requestedQuery.length >= 2 ? "search" : parameters.get("mode") === "latest" ? "latest" : "popular";
      const endpoint = await getActiveBridgeEndpoint();
      const nextSources = await bridgeRequest<AnimeSourceSummary[]>(endpoint, "/v1/anime/sources");
      if (!nextSources.length) throw new Error("Install and enable an Aniyomi extension before browsing anime.");
      const initialSource = nextSources.find((item) => item.id === requestedSourceId) ?? nextSources.find((item) => !item.provider.includes("HAO Signed Fixture")) ?? nextSources[0]!;
      const initialMode = requestedMode === "latest" && !initialSource.supportsLatest ? "popular" : requestedMode;
      setBridge(endpoint); setWorkId(requestedWorkId); setSources(nextSources); setSourceId(initialSource.id); setBrowseMode(initialMode); setSearchDraft(requestedQuery);
      if (requestedWorkId) await hydrateCanonicalPlayback(requestedWorkId);
      await loadCatalog(endpoint, initialSource.id, initialMode, requestedQuery, requestedAnimeId ?? undefined, requestedEpisodeId ?? undefined);
    } catch (cause) { setBusy(""); setError(message(cause)); }
  }

  async function hydrateCanonicalPlayback(canonicalWorkId: string) {
    remoteProgressRef.current = null;
    setWorkCoverUrl(null);
    const [workResult, libraryResult] = await Promise.allSettled([
      api<{ work: { coverUrl: string | null } }>(`/works/${canonicalWorkId}`),
      api<LibraryResponse>("/library"),
    ]);
    if (workResult.status === "fulfilled") setWorkCoverUrl(workResult.value.work.coverUrl);
    if (libraryResult.status !== "fulfilled") return;
    const libraryEntry = libraryResult.value.items.find((item) => item.work.id === canonicalWorkId);
    if (!libraryEntry) {
      await api("/library", { method: "PUT", body: JSON.stringify({ workId: canonicalWorkId, status: "WATCHING_READING", favorite: false, rating: null, notes: "" }) }).catch(() => undefined);
    }
    const progress = libraryEntry?.progress;
    if (progress?.positionSeconds && (progress.positionPercent ?? 0) < 95) {
      remoteProgressRef.current = { episodeNumber: progress.completedUnits + 1, positionSeconds: progress.positionSeconds };
    }
  }

  async function loadCatalog(endpoint: string, nextSourceId: string, mode: "popular" | "latest" | "search", query: string, preferredAnimeId?: string, preferredEpisodeId?: string) {
    setBusy(mode === "search" ? `Searching for “${query}”…` : mode === "latest" ? "Loading latest updates…" : "Loading popular anime…");
    setError(""); safelyResetVideo(videoRef.current);
    setCatalog([]); setAnimeId(""); setEpisodes([]); setEpisodeId(""); setServers([]); setServerId(""); setStreams([]); setStreamId("");
    try {
      const parameters = new URLSearchParams({ sourceId: nextSourceId, mode, page: "1" });
      if (mode === "search") parameters.set("query", query.trim());
      const titles = await bridgeRequest<AnimeCatalogItem[]>(endpoint, `/v1/anime/catalog?${parameters.toString()}`);
      const persistedTitle = preferredAnimeId && !titles.some((item) => item.id === preferredAnimeId) ? {
        id: preferredAnimeId,
        title: query || "Selected anime",
        description: "Selected from a verified HAO title match.",
        provider: sources.find((item) => item.id === nextSourceId)?.name ?? "Installed anime source",
        attribution: "HAO Bridge",
      } satisfies AnimeCatalogItem : null;
      const catalogItems = persistedTitle ? [persistedTitle, ...titles] : titles;
      if (!catalogItems.length) throw new Error(mode === "search" ? `No results found for “${query}”.` : "This source did not return any titles.");
      const initialTitle = catalogItems.find((item) => item.id === preferredAnimeId) ?? catalogItems[0]!;
      setCatalog(catalogItems); setAnimeId(initialTitle.id);
      await loadAnime(endpoint, initialTitle.id, false, preferredEpisodeId);
    } catch (cause) { setBusy(""); setError(message(cause)); }
  }

  async function loadAnime(endpoint: string, nextAnimeId: string, cancelled = false, preferredEpisodeId?: string) {
    setBusy("Loading episodes…"); setError(""); safelyResetVideo(videoRef.current);
    try {
      const nextEpisodes = await bridgeRequest<AnimeEpisode[]>(endpoint, `/v1/anime/${encodeURIComponent(nextAnimeId)}/episodes`);
      if (!nextEpisodes.length) throw new Error("This source did not return any episodes.");
      if (cancelled) return;
      const initialEpisode = nextEpisodes.find((item) => item.id === preferredEpisodeId) ?? nextEpisodes[0]!;
      autoplayRequestedRef.current = true;
      setEpisodes(nextEpisodes); setEpisodeId(initialEpisode.id);
      await loadEpisode(endpoint, initialEpisode.id, cancelled);
    } catch (cause) { if (!cancelled) setError(message(cause)); }
    finally { if (!cancelled) setBusy(""); }
  }

  async function loadEpisode(endpoint: string, nextEpisodeId: string, cancelled = false) {
    setBusy("Loading stream servers…"); setError(""); safelyResetVideo(videoRef.current);
    const nextServers = await bridgeRequest<AnimeServer[]>(endpoint, `/v1/anime/episodes/${encodeURIComponent(nextEpisodeId)}/servers`);
    if (!nextServers.length) throw new Error("No stream servers are available for this episode.");
    if (cancelled) return;
    const preferredServerName = readPreference("hao:anime:preferred-server");
    const initialServer = nextServers.find((item) => item.name === preferredServerName) ?? nextServers[0]!;
    setServers(nextServers); setServerId(initialServer.id);
    await loadServer(endpoint, nextEpisodeId, initialServer.id, cancelled);
  }

  async function loadServer(endpoint: string, nextEpisodeId: string, nextServerId: string, cancelled = false) {
    setBusy("Resolving authorized streams…"); setError(""); safelyResetVideo(videoRef.current);
    const nextStreams = await bridgeRequest<AnimeStream[]>(endpoint, `/v1/anime/episodes/${encodeURIComponent(nextEpisodeId)}/streams?serverId=${encodeURIComponent(nextServerId)}`);
    if (!nextStreams.length) throw new Error("This server did not return a playable stream.");
    if (cancelled) return;
    const preferredStream = readPreference("hao:anime:preferred-stream");
    const initialStream = nextStreams.find((item) => streamPreference(item) === preferredStream) ?? nextStreams[0]!;
    setStreams(nextStreams); setStreamId(initialStream.id); setBusy("");
  }

  async function changeAnime(next: string) { clearCanonicalWork(); setAnimeId(next); setEpisodes([]); setServers([]); setStreams([]); await loadAnime(bridge, next); }
  async function changeEpisode(next: string, autoplayVideo = true) {
    if (next === episodeId) return;
    if (!videoRef.current?.ended) await persistProgress(false);
    autoplayRequestedRef.current = autoplayVideo;
    restoredPlaybackKeyRef.current = "";
    setProgressStatus(""); setEpisodeId(next); setServers([]); setStreams([]);
    replaceEpisodeInUrl(next);
    try { await loadEpisode(bridge, next); } catch (cause) { setBusy(""); setError(message(cause)); }
  }
  async function changeServer(next: string) {
    const continuePlaying = videoRef.current ? !videoRef.current.paused : false;
    await persistProgress(false);
    const selectedServer = servers.find((item) => item.id === next);
    if (selectedServer) writePreference("hao:anime:preferred-server", selectedServer.name);
    restoredPlaybackKeyRef.current = "";
    autoplayRequestedRef.current = continuePlaying;
    setServerId(next); setStreams([]);
    try { await loadServer(bridge, episodeId, next); } catch (cause) { setBusy(""); setError(message(cause)); }
  }
  async function changeSource(next: string) { clearCanonicalWork(); setSourceId(next); setBrowseMode("popular"); setSearchDraft(""); await loadCatalog(bridge, next, "popular", ""); }
  async function changeBrowseMode(next: "popular" | "latest") { clearCanonicalWork(); setBrowseMode(next); await loadCatalog(bridge, sourceId, next, ""); }
  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchDraft.trim();
    if (query.length < 2) { setError("Enter at least two characters to search."); return; }
    clearCanonicalWork();
    setBrowseMode("search");
    await loadCatalog(bridge, sourceId, "search", query);
  }

  async function changeStream(next: string) {
    const continuePlaying = videoRef.current ? !videoRef.current.paused : false;
    await persistProgress(false);
    const selectedStream = streams.find((item) => item.id === next);
    if (selectedStream) writePreference("hao:anime:preferred-stream", streamPreference(selectedStream));
    restoredPlaybackKeyRef.current = "";
    autoplayRequestedRef.current = continuePlaying;
    safelyResetVideo(videoRef.current);
    setStreamId(next);
  }

  async function persistProgress(completed: boolean) {
    const video = videoRef.current;
    if (!video || !episode || !sourceId || !animeId || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const positionSeconds = completed ? video.duration : video.currentTime;
    const saved = { positionSeconds, durationSeconds: video.duration, updatedAt: new Date().toISOString(), completed };
    writePreference(playbackStorageKey(sourceId, animeId, episode.id), JSON.stringify(saved));
    saveContinueEntry(episode, positionSeconds, video.duration, completed);
    setProgressStatus(workId ? "Saving progress…" : "Resume saved on this device");
    if (!workId) return;
    try {
      await api("/progress", {
        method: "PUT",
        body: JSON.stringify({
          workId,
          releaseItemId: null,
          completedUnits: completedEpisodeUnits(episode.number, completed),
          positionSeconds,
          positionPercent: playbackPercent(positionSeconds, video.duration),
        }),
      });
      setProgressStatus(completed ? "Episode completed · progress synced" : "Progress synced");
    } catch {
      setProgressStatus("Resume saved locally · sync unavailable");
    }
  }

  function saveContinueEntry(targetEpisode: AnimeEpisode, positionSeconds: number, durationSeconds: number, completed = false) {
    const id = continueWatchingId(sourceId, animeId);
    const entry: ContinueWatchingEntry = {
      id,
      workId: workId || null,
      sourceId,
      sourceName: sources.find((item) => item.id === sourceId)?.name ?? anime?.provider ?? "Installed anime source",
      animeId,
      animeTitle: anime?.title ?? "Selected anime",
      thumbnailUrl: workCoverUrl ?? anime?.thumbnailUrl ?? null,
      episodeId: targetEpisode.id,
      episodeNumber: targetEpisode.number,
      episodeTitle: targetEpisode.title,
      positionSeconds,
      durationSeconds,
      updatedAt: new Date().toISOString(),
    };
    const entries = parseContinueWatching(readPreference(CONTINUE_WATCHING_STORAGE_KEY));
    writePreference(CONTINUE_WATCHING_STORAGE_KEY, JSON.stringify(updateContinueWatching(entries, entry, completed)));
    if (workId) {
      const dismissed = parseDismissedWorkIds(readPreference(DISMISSED_CONTINUE_STORAGE_KEY)).filter((id) => id !== workId);
      writePreference(DISMISSED_CONTINUE_STORAGE_KEY, JSON.stringify(dismissed));
    }
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video || !episode) return;
    const key = playbackStorageKey(sourceId, animeId, episode.id);
    if (restoredPlaybackKeyRef.current !== key) {
      const localPosition = parsePlaybackPosition(readPreference(key));
      const remoteProgress = remoteProgressRef.current;
      const remotePosition = !localPosition && remoteProgress?.episodeNumber === episode.number ? {
        positionSeconds: remoteProgress.positionSeconds,
        durationSeconds: video.duration,
        updatedAt: new Date(0).toISOString(),
        completed: false,
      } : null;
      const resumeAt = resumablePosition(localPosition ?? remotePosition, video.duration);
      if (resumeAt !== null) {
        video.currentTime = resumeAt;
        setProgressStatus(`Resumed at ${formatTime(resumeAt)}`);
      }
      restoredPlaybackKeyRef.current = key;
    }
    if (autoplayRequestedRef.current) void attemptAutoplay(video);
  }

  async function attemptAutoplay(video: HTMLVideoElement) {
    autoplayRequestedRef.current = false;
    try {
      await video.play();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        video.muted = true;
        try {
          await video.play();
          setProgressStatus("Autoplay started muted · use the player to unmute");
          return;
        } catch (fallbackCause) {
          if (fallbackCause instanceof DOMException && fallbackCause.name === "AbortError") return;
        }
      }
      setError("Autoplay was blocked by the browser. Press play once to allow playback.");
    }
  }

  function handleTimeUpdate() {
    if (Date.now() - lastSavedAtRef.current < 10_000) return;
    lastSavedAtRef.current = Date.now();
    void persistProgress(false);
  }

  async function handleEnded() {
    await persistProgress(true);
    if (nextEpisode) saveContinueEntry(nextEpisode, 0, 0);
    if (autoplayNext && nextEpisode) await changeEpisode(nextEpisode.id, true);
  }

  function toggleAutoplay(value: boolean) {
    setAutoplayNext(value);
    writePreference("hao:anime:autoplay-next", String(value));
  }

  function replaceEpisodeInUrl(nextEpisodeId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("episodeId", nextEpisodeId);
    window.history.replaceState(null, "", url);
  }

  function clearCanonicalWork() {
    setWorkId("");
    setWorkCoverUrl(null);
    remoteProgressRef.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("workId");
    window.history.replaceState(null, "", url);
  }

  return <div className="player-page anime-player-page">
    <div className="video-stage">
      {stream ? <video ref={videoRef} key={`${episodeId}:${stream.id}`} controls playsInline preload="metadata" onLoadedMetadata={handleLoadedMetadata} onPlay={()=>void persistProgress(false)} onTimeUpdate={handleTimeUpdate} onPause={()=>{if (!videoRef.current?.ended) void persistProgress(false);}} onEnded={()=>void handleEnded()} onError={()=>setError("The selected stream could not be loaded. Try another server or quality.")}>
        {stream.subtitles.map((subtitle)=><track key={subtitle.url} kind="subtitles" label={subtitle.label} srcLang={subtitle.language} src={subtitle.url}/>)}
      </video> : <div className="player-placeholder"><Film/><span>{busy || "Choose an episode and stream."}</span></div>}
    </div>
    <div className="anime-browse-bar">
      <label>Source<select aria-label="Anime source" value={sourceId} onChange={(event)=>void changeSource(event.target.value)} disabled={Boolean(busy)}>{sources.map((item)=><option key={item.id} value={item.id}>{item.name} · {item.language.toUpperCase()}</option>)}</select></label>
      <label>Browse<select aria-label="Browse mode" value={browseMode} onChange={(event)=>void changeBrowseMode(event.target.value as "popular" | "latest")} disabled={Boolean(busy)}><option value="popular">Popular</option><option value="latest" disabled={!sources.find((item)=>item.id===sourceId)?.supportsLatest}>Latest updates</option>{browseMode === "search" && <option value="search">Search results</option>}</select></label>
      <form className="anime-search" onSubmit={(event)=>void submitSearch(event)}><label>Search<input aria-label="Search this anime source" value={searchDraft} onChange={(event)=>setSearchDraft(event.target.value)} placeholder="Search titles…" disabled={Boolean(busy)}/></label><button className="button primary compact" type="submit" disabled={Boolean(busy) || searchDraft.trim().length < 2}><Search/>Search</button></form>
    </div>
    <div className="player-source-bar">
      <label>Title<select aria-label="Anime title" value={animeId} onChange={(event)=>void changeAnime(event.target.value)} disabled={Boolean(busy)}>{catalog.map((item)=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Episode<select aria-label="Episode" value={episodeId} onChange={(event)=>void changeEpisode(event.target.value)} disabled={Boolean(busy) || !episodes.length}>{episodes.map((item)=><option key={item.id} value={item.id}>Episode {item.number} · {item.title}</option>)}</select></label>
      <label>Server<select aria-label="Stream server" value={serverId} onChange={(event)=>void changeServer(event.target.value)} disabled={Boolean(busy) || !servers.length}>{servers.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Quality<select aria-label="Stream quality" value={streamId} onChange={(event)=>void changeStream(event.target.value)} disabled={Boolean(busy) || !streams.length}>{streams.map((item)=><option key={item.id} value={item.id}>{item.quality ?? "Auto"} · {item.audio ?? "Default audio"}</option>)}</select></label>
    </div>
    <div className="episode-navigation" aria-label="Episode navigation">
      <button className="button ghost compact" disabled={Boolean(busy) || !previousEpisode} onClick={()=>previousEpisode && void changeEpisode(previousEpisode.id, true)}><ChevronLeft/>Previous</button>
      <span>{episodeIndex >= 0 ? `${episodeIndex + 1} of ${episodes.length}` : "No episode selected"}</span>
      <label className="autoplay-toggle"><input type="checkbox" checked={autoplayNext} onChange={(event)=>toggleAutoplay(event.target.checked)}/><span>Autoplay next</span></label>
      <button className="button ghost compact" disabled={Boolean(busy) || !nextEpisode} onClick={()=>nextEpisode && void changeEpisode(nextEpisode.id, true)}>Next<ChevronRight/></button>
    </div>
    {busy && <p className="player-status" role="status"><LoaderCircle className="spin"/> {busy}</p>}
    {error && <p className="player-status error" role="alert"><TriangleAlert/> {error}<button className="button ghost compact" onClick={()=>void connect()}><RefreshCw/>Retry</button></p>}
    <div className="now-playing">
      <div><span className="eyebrow"><Server/> NOW PLAYING · {anime?.provider ?? "LOCAL RUNTIME"}</span><h1>{anime?.title ?? "Anime player"}</h1><p>{episode ? `Episode ${episode.number} · ${episode.title}` : anime?.description ?? "Connect an authorized anime source."}</p>{anime?.attribution && <small>{anime.attribution}</small>}{progressStatus && <span className="progress-save-status"><CheckCircle2/>{progressStatus}</span>}</div>
    </div>
  </div>;
}

function safelyResetVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function readPreference(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Playback continues when local storage is unavailable. */ }
}

function streamPreference(stream: AnimeStream): string {
  return `${stream.quality ?? "Auto"}|${stream.audio ?? "Default audio"}`;
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : "The anime source could not complete this request."; }
