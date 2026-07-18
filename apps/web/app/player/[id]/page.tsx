"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Captions, CheckCircle2, ChevronDown, ChevronRight, Film, Flag, ListVideo, LoaderCircle, Maximize2, Pause, Play, RefreshCw, RotateCcw, RotateCw, Search, Server, Settings2, SkipBack, SkipForward, TriangleAlert, Volume2, VolumeX } from "lucide-react";
import Hls from "hls.js";
import { api, bridgeErrorMessage, bridgeJson, getActiveBridge, type LibraryResponse } from "../../../lib/api";
import { completedEpisodeUnits, continueWatchingId, CONTINUE_WATCHING_STORAGE_KEY, DISMISSED_CONTINUE_STORAGE_KEY, parseContinueWatching, parseDismissedWorkIds, parsePlaybackPosition, playbackPercent, playbackStorageKey, resumablePosition, updateContinueWatching, type ContinueWatchingEntry } from "../../../lib/playback-progress";
import { confidentSourceMatch } from "../../../lib/source-match";
import { rankSourcesByReliability, recordSourceResult } from "../../../lib/source-reliability";
import { nextPlaybackCandidate, prioritizePlaybackItems } from "../../../lib/playback-recovery";
import { pickAudioVariant, streamAudioMode, type AudioMode } from "../../../lib/stream-audio";
import { maybeNotifyNewReleases, recordActivity, RELEASE_SNAPSHOTS_STORAGE_KEY, saveSourceReport, updateReleaseSnapshot } from "../../../lib/beta-features";

type AnimeSourceSummary = {
  id: string;
  name: string;
  language: string;
  supportsLatest: boolean;
  provider: string;
};
type AnimeCatalogItem = {
  id: string;
  title: string;
  description: string;
  provider: string;
  attribution: string;
  thumbnailUrl?: string | null;
};
type AnimeEpisode = {
  id: string;
  animeId: string;
  number: number;
  title: string;
};
type AnimeServer = { id: string; name: string };
type AnimeSubtitle = { label: string; language?: string; url: string };
type AnimeStream = {
  id: string;
  serverId: string;
  url: string;
  kind: "MP4" | "HLS";
  quality?: string;
  audio?: string;
  subtitles: AnimeSubtitle[];
};

export default function PlayerPage() {
  const playerShellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const autoplayRequestedRef = useRef(false);
  const lastSavedAtRef = useRef(0);
  const restoredPlaybackKeyRef = useRef("");
  const remoteProgressRef = useRef<{
    episodeNumber: number;
    positionSeconds: number;
  } | null>(null);
  const playbackRecoveryRef = useRef(false);
  const failedPlaybackSourcesRef = useRef(new Set<string>());
  const [bridge, setBridge] = useState("");
  const [bridgeScope, setBridgeScope] = useState<"personal" | "beta">("personal");
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
  const [sourceFallbackStatus, setSourceFallbackStatus] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [subtitleMode, setSubtitleMode] = useState("off");
  const [subtitleSize, setSubtitleSize] = useState("100");
  const [subtitleBackground, setSubtitleBackground] = useState("dark");
  const [busy, setBusy] = useState("Connecting to HAO Bridge…");
  const [error, setError] = useState("");

  const anime = useMemo(() => catalog.find((item) => item.id === animeId), [animeId, catalog]);
  const episode = useMemo(() => episodes.find((item) => item.id === episodeId), [episodeId, episodes]);
  const episodeIndex = useMemo(() => episodes.findIndex((item) => item.id === episodeId), [episodeId, episodes]);
  const previousEpisode = episodeIndex > 0 ? episodes[episodeIndex - 1] : undefined;
  const nextEpisode = episodeIndex >= 0 && episodeIndex < episodes.length - 1 ? episodes[episodeIndex + 1] : undefined;
  const stream = useMemo(() => streams.find((item) => item.id === streamId), [streamId, streams]);
  const streamUrl = stream ? (stream.url.startsWith("/") ? `${bridge}${stream.url}` : stream.url) : "";
  const activeAudioMode = stream ? streamAudioMode(stream) : null;
  const availableAudioModes = useMemo(() => new Set(streams.map(streamAudioMode).filter((mode): mode is AudioMode => mode !== null)), [streams]);
  const audioSwitchTarget: AudioMode | null = activeAudioMode === "dub"
    ? (availableAudioModes.has("sub") ? "sub" : null)
    : (availableAudioModes.has("dub") ? "dub" : null);

  async function bridgeRequest<T>(endpoint: string, path: string): Promise<T> {
    return bridgeJson<T>(endpoint, path);
  }

  useEffect(() => {
    setAutoplayNext(readPreference("hao:anime:autoplay-next") !== "false");
    const savedVolume = Number(readPreference("hao:anime:volume"));
    if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) setVolume(savedVolume);
    setMuted(readPreference("hao:anime:muted") === "true");
    setSubtitleSize(readPreference("hao:anime:subtitle-size") || "100");
    setSubtitleBackground(readPreference("hao:anime:subtitle-background") || "dark");
    void connect();
    return () => {
      if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
      safelyResetVideo(videoRef.current);
    };
  }, []);

  useEffect(() => {
    if (!anime || !episodes.length) return;
    const key = `anime:${sourceId}:${anime.id}`;
    const snapshot = updateReleaseSnapshot(key, episodes.length, readPreference(RELEASE_SNAPSHOTS_STORAGE_KEY));
    writePreference(RELEASE_SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshot.snapshots));
    maybeNotifyNewReleases(anime.title, "episode", snapshot.previous, episodes.length);
  }, [anime?.id, anime?.title, episodes.length, sourceId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [muted, streamId, volume]);

  useEffect(() => {
    const fullscreenChanged = () => setIsFullscreen(document.fullscreenElement === playerShellRef.current);
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => document.removeEventListener("fullscreenchange", fullscreenChanged);
  }, []);

  useEffect(() => {
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    if (!isPlaying || settingsOpen) {
      setControlsVisible(true);
      return;
    }
    controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2400);
    return () => {
      if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    };
  }, [isPlaying, settingsOpen]);

  useEffect(() => {
    function keyboardControls(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
      if (!stream) return;
      const key = event.key.toLowerCase();
      if (key === " " || key === "k") {
        event.preventDefault();
        void togglePlayback();
      } else if (key === "arrowleft" || key === "j") {
        event.preventDefault();
        seekBy(-10);
      } else if (key === "arrowright" || key === "l") {
        event.preventDefault();
        seekBy(10);
      } else if (key === "m") {
        event.preventDefault();
        toggleMute();
      } else if (key === "f") {
        event.preventDefault();
        void toggleFullscreen();
      }
    }
    window.addEventListener("keydown", keyboardControls);
    return () => window.removeEventListener("keydown", keyboardControls);
  }, [isPlaying, muted, stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || !streamUrl) return;
    setError("");
    if (stream.kind === "HLS" && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) void recoverFromPlaybackFailure();
      });
      return () => {
        hls.destroy();
        safelyResetVideo(video);
      };
    }
    video.src = streamUrl;
    video.load();
    return () => {
      safelyResetVideo(video);
    };
  }, [stream, streamUrl]);

  async function connect() {
    failedPlaybackSourcesRef.current.clear();
    setBusy("Connecting to HAO Bridge…");
    setError("");
    try {
      const parameters = new URLSearchParams(window.location.search);
      const requestedSourceId = parameters.get("sourceId");
      const requestedAnimeId = parameters.get("animeId");
      const requestedEpisodeId = parameters.get("episodeId");
      const requestedWorkId = parameters.get("workId") ?? "";
      const requestedQuery = parameters.get("query")?.trim() ?? "";
      const requestedMode: "popular" | "latest" | "search" = parameters.get("mode") === "search" && requestedQuery.length >= 2 ? "search" : parameters.get("mode") === "latest" ? "latest" : "popular";
      const access = await getActiveBridge();
      const endpoint = access.endpoint;
      const nextSources = await bridgeRequest<AnimeSourceSummary[]>(endpoint, "/v1/anime/sources");
      if (!nextSources.length) throw new Error(access.scope === "beta" ? "No approved anime sources are currently available. Ask the beta administrator to check the shared Bridge." : "Install and enable an Aniyomi extension before browsing anime.");
      const initialSource = nextSources.find((item) => item.id === requestedSourceId) ?? nextSources.find((item) => !item.provider.includes("HAO Signed Fixture")) ?? nextSources[0]!;
      const initialMode = requestedMode === "latest" && !initialSource.supportsLatest ? "popular" : requestedMode;
      setBridge(endpoint);
      setBridgeScope(access.scope);
      setWorkId(requestedWorkId);
      setSources(nextSources);
      setSourceId(initialSource.id);
      setBrowseMode(initialMode);
      setSearchDraft(requestedQuery);
      const alternateTitles = requestedWorkId ? await hydrateCanonicalPlayback(requestedWorkId) : [];
      if (initialMode === "search" && requestedQuery && requestedAnimeId) {
        await loadAnimeWithSourceFallback(endpoint, nextSources, initialSource.id, requestedQuery, requestedAnimeId, requestedEpisodeId ?? undefined, alternateTitles);
      } else {
        await loadCatalog(endpoint, initialSource.id, initialMode, requestedQuery, requestedAnimeId ?? undefined, requestedEpisodeId ?? undefined, nextSources);
      }
    } catch (cause) {
      setBusy("");
      setError(message(cause));
    }
  }

  async function hydrateCanonicalPlayback(canonicalWorkId: string): Promise<string[]> {
    remoteProgressRef.current = null;
    setWorkCoverUrl(null);
    const [workResult, libraryResult] = await Promise.allSettled([api<{ work: { coverUrl: string | null; alternateTitles: string[] } }>(`/works/${canonicalWorkId}`), api<LibraryResponse>("/library")]);
    if (workResult.status === "fulfilled") setWorkCoverUrl(workResult.value.work.coverUrl);
    const alternateTitles = workResult.status === "fulfilled" ? workResult.value.work.alternateTitles : [];
    if (libraryResult.status !== "fulfilled") return alternateTitles;
    const libraryEntry = libraryResult.value.items.find((item) => item.work.id === canonicalWorkId);
    if (!libraryEntry) {
      await api("/library", {
        method: "PUT",
        body: JSON.stringify({
          workId: canonicalWorkId,
          status: "WATCHING_READING",
          favorite: false,
          rating: null,
          notes: ""
        })
      }).catch(() => undefined);
    }
    const progress = libraryEntry?.progress;
    if (progress?.positionSeconds && (progress.positionPercent ?? 0) < 95) {
      remoteProgressRef.current = {
        episodeNumber: progress.completedUnits + 1,
        positionSeconds: progress.positionSeconds
      };
    }
    return alternateTitles;
  }

  async function loadCatalog(endpoint: string, nextSourceId: string, mode: "popular" | "latest" | "search", query: string, preferredAnimeId?: string, preferredEpisodeId?: string, availableSources: AnimeSourceSummary[] = sources) {
    setBusy(mode === "search" ? `Searching for “${query}”…` : mode === "latest" ? "Loading latest updates…" : "Loading popular anime…");
    setError("");
    setSourceFallbackStatus("");
    safelyResetVideo(videoRef.current);
    setCatalog([]);
    setAnimeId("");
    setEpisodes([]);
    setEpisodeId("");
    setServers([]);
    setServerId("");
    setStreams([]);
    setStreamId("");
    try {
      const parameters = new URLSearchParams({
        sourceId: nextSourceId,
        mode,
        page: "1"
      });
      if (mode === "search") parameters.set("query", query.trim());
      const titles = await bridgeRequest<AnimeCatalogItem[]>(endpoint, `/v1/anime/catalog?${parameters.toString()}`);
      const persistedTitle =
        preferredAnimeId && !titles.some((item) => item.id === preferredAnimeId)
          ? ({
              id: preferredAnimeId,
              title: query || "Selected anime",
              description: "Selected from a verified HAO title match.",
              provider: availableSources.find((item) => item.id === nextSourceId)?.name ?? "Installed anime source",
              attribution: "HAO Bridge"
            } satisfies AnimeCatalogItem)
          : null;
      const catalogItems = persistedTitle ? [persistedTitle, ...titles] : titles;
      if (!catalogItems.length) throw new Error(mode === "search" ? `No results found for “${query}”.` : "This source did not return any titles.");
      const initialTitle = catalogItems.find((item) => item.id === preferredAnimeId) ?? catalogItems[0]!;
      setCatalog(catalogItems);
      setAnimeId(initialTitle.id);
      const loaded = await loadAnime(endpoint, initialTitle.id, false, preferredEpisodeId);
      if (!loaded) {
        failedPlaybackSourcesRef.current.add(nextSourceId);
        const remainingSources = availableSources.filter((source) => !failedPlaybackSourcesRef.current.has(source.id));
        if (!remainingSources.length) throw new Error(`No installed source returned a playable stream for “${initialTitle.title}”.`);
        const failedSource = availableSources.find((source) => source.id === nextSourceId)?.name ?? "The selected source";
        await loadAnimeWithSourceFallback(endpoint, remainingSources, remainingSources[0]!.id, initialTitle.title, undefined, undefined, [], true);
        setSourceFallbackStatus(`Switched sources because ${failedSource} listed episodes but returned no playable streams.`);
      }
    } catch (cause) {
      setBusy("");
      setError(message(cause));
    }
  }

  async function loadAnimeWithSourceFallback(
    endpoint: string,
    availableSources: AnimeSourceSummary[],
    preferredSourceId: string,
    query: string,
    preferredAnimeId?: string,
    preferredEpisodeId?: string,
    alternateTitles: string[] = [],
    trustFirstSearchResult = false,
  ) {
    setError("");
    setSourceFallbackStatus("");
    safelyResetVideo(videoRef.current);
    setCatalog([]);
    setAnimeId("");
    setEpisodes([]);
    setEpisodeId("");
    setServers([]);
    setServerId("");
    setStreams([]);
    setStreamId("");

    const orderedSources = rankSourcesByReliability(availableSources, "anime", preferredSourceId);
    const preferredSource = orderedSources[0];
    let desiredEpisodeNumber = remoteProgressRef.current?.episodeNumber ?? null;

    for (const [index, source] of orderedSources.entries()) {
      const startedAt = performance.now();
      setBusy(index === 0 ? `Opening “${query}”…` : `Trying ${source.name}…`);
      try {
        const parameters = new URLSearchParams({ sourceId: source.id, mode: "search", query, page: "1" });
        const titles = await bridgeRequest<AnimeCatalogItem[]>(endpoint, `/v1/anime/catalog?${parameters.toString()}`);
        const persistedPreferred =
          source.id === preferredSourceId && preferredAnimeId
            ? ({
                id: preferredAnimeId,
                title: query,
                description: "Selected from a verified HAO title match.",
                provider: source.name,
                attribution: "HAO Bridge",
              } satisfies AnimeCatalogItem)
            : null;
        const item =
          (source.id === preferredSourceId && preferredAnimeId ? titles.find((title) => title.id === preferredAnimeId) ?? persistedPreferred : null) ??
          confidentSourceMatch({ title: query, alternateTitles }, titles) ??
          (trustFirstSearchResult ? titles[0] ?? null : null);
        if (!item) {
          recordSourceResult("anime", source.id, false, performance.now() - startedAt);
          continue;
        }

        const nextEpisodes = (await bridgeRequest<AnimeEpisode[]>(endpoint, `/v1/anime/${encodeURIComponent(item.id)}/episodes`))
          .slice()
          .sort((left, right) => left.number - right.number);
        if (!nextEpisodes.length) {
          recordSourceResult("anime", source.id, false, performance.now() - startedAt);
          continue;
        }

        const preferredEpisode = source.id === preferredSourceId ? nextEpisodes.find((episode) => episode.id === preferredEpisodeId) : undefined;
        if (preferredEpisode) desiredEpisodeNumber = preferredEpisode.number;
        const initialEpisode = preferredEpisode ?? nextEpisodes.find((episode) => episode.number === desiredEpisodeNumber) ?? nextEpisodes[0]!;
        const nextCatalog = titles.some((title) => title.id === item.id) ? titles : [item, ...titles];

        setSourceId(source.id);
        setBrowseMode("search");
        setSearchDraft(query);
        setCatalog(nextCatalog);
        setAnimeId(item.id);
        setEpisodes(nextEpisodes);
        setEpisodeId(initialEpisode.id);
        autoplayRequestedRef.current = true;
        await loadEpisode(endpoint, initialEpisode.id);
        recordSourceResult("anime", source.id, true, performance.now() - startedAt);
        replacePlaybackSourceInUrl(source.id, item.id, initialEpisode.id, query);
        if (source.id !== preferredSourceId) {
          setSourceFallbackStatus(`Switched from ${preferredSource?.name ?? "the first source"} to ${source.name} because the first source did not have a playable match.`);
        }
        setBusy("");
        return;
      } catch {
        recordSourceResult("anime", source.id, false, performance.now() - startedAt);
        setServers([]);
        setServerId("");
        setStreams([]);
        setStreamId("");
      }
    }

    throw new Error(`None of your installed anime sources could provide a playable match for “${query}”.`);
  }

  async function loadAnime(endpoint: string, nextAnimeId: string, cancelled = false, preferredEpisodeId?: string): Promise<boolean> {
    setBusy("Loading episodes…");
    setError("");
    safelyResetVideo(videoRef.current);
    try {
      const nextEpisodes = (await bridgeRequest<AnimeEpisode[]>(endpoint, `/v1/anime/${encodeURIComponent(nextAnimeId)}/episodes`))
        .slice()
        .sort((left, right) => left.number - right.number);
      if (!nextEpisodes.length) throw new Error("This source did not return any episodes.");
      if (cancelled) return false;
      const initialEpisode = nextEpisodes.find((item) => item.id === preferredEpisodeId) ?? nextEpisodes[0]!;
      remoteProgressRef.current = {
        episodeNumber: initialEpisode.number,
        positionSeconds: remoteProgressRef.current?.positionSeconds ?? 0
      };
      autoplayRequestedRef.current = true;
      setEpisodes(nextEpisodes);
      setEpisodeId(initialEpisode.id);
      await loadEpisode(endpoint, initialEpisode.id, cancelled);
      return !cancelled;
    } catch {
      return false;
    } finally {
      if (!cancelled) setBusy("");
    }
  }

  async function loadEpisode(endpoint: string, nextEpisodeId: string, cancelled = false) {
    setBusy("Loading stream servers…");
    setError("");
    safelyResetVideo(videoRef.current);
    const nextServers = await bridgeRequest<AnimeServer[]>(endpoint, `/v1/anime/episodes/${encodeURIComponent(nextEpisodeId)}/servers`);
    if (!nextServers.length) throw new Error("No stream servers are available for this episode.");
    if (cancelled) return;
    const preferredServerName = readPreference("hao:anime:preferred-server");
    const initialServer = nextServers.find((item) => item.name === preferredServerName) ?? nextServers[0]!;
    setServers(nextServers);
    await loadPlayableServer(endpoint, nextEpisodeId, nextServers, initialServer.id, cancelled);
  }

  async function loadPlayableServer(endpoint: string, nextEpisodeId: string, availableServers: AnimeServer[], preferredServerId: string, cancelled = false) {
    const orderedServers = prioritizePlaybackItems(availableServers, preferredServerId);
    let lastFailure: unknown = null;
    for (const [index, candidateServer] of orderedServers.entries()) {
      if (cancelled) return;
      setServerId(candidateServer.id);
      setStreams([]);
      setStreamId("");
      try {
        await loadServer(endpoint, nextEpisodeId, candidateServer.id, cancelled);
        if (index > 0) setSourceFallbackStatus(`Switched to ${candidateServer.name} because the preferred server had no playable stream.`);
        return;
      } catch (cause) {
        lastFailure = cause;
      }
    }
    throw new Error(lastFailure ? "Every server from this source was checked, but none returned a playable stream." : "No stream server returned a playable stream for this episode.");
  }

  async function loadServer(endpoint: string, nextEpisodeId: string, nextServerId: string, cancelled = false) {
    setBusy("Resolving authorized streams…");
    setError("");
    safelyResetVideo(videoRef.current);
    const nextStreams = await bridgeRequest<AnimeStream[]>(endpoint, `/v1/anime/episodes/${encodeURIComponent(nextEpisodeId)}/streams?serverId=${encodeURIComponent(nextServerId)}`);
    if (!nextStreams.length) throw new Error("This server did not return a playable stream.");
    if (cancelled) return;
    const preferredStream = readPreference("hao:anime:preferred-stream");
    const preferredAudioMode: AudioMode = readPreference("hao:anime:audio-mode") === "dub" ? "dub" : "sub";
    const preferredAudioStreams = nextStreams.filter((item) => streamAudioMode(item) === preferredAudioMode);
    const orderedStreams = preferredAudioStreams.length
      ? [...preferredAudioStreams, ...nextStreams.filter((item) => streamAudioMode(item) !== preferredAudioMode)]
      : nextStreams;
    const initialStream = orderedStreams.find((item) => streamPreference(item) === preferredStream) ?? orderedStreams[0]!;
    setStreams(orderedStreams);
    setStreamId(initialStream.id);
    setBusy("");
  }

  async function changeAnime(next: string) {
    failedPlaybackSourcesRef.current.clear();
    clearCanonicalWork();
    const selectedAnime = catalog.find((item) => item.id === next);
    setAnimeId(next);
    setEpisodes([]);
    setServers([]);
    setStreams([]);
    try {
      const loaded = await loadAnime(bridge, next);
      if (!loaded && selectedAnime) {
        failedPlaybackSourcesRef.current.add(sourceId);
        const remainingSources = sources.filter((source) => !failedPlaybackSourcesRef.current.has(source.id));
        if (!remainingSources.length) throw new Error("No additional source is available.");
        const failedSource = sources.find((source) => source.id === sourceId)?.name ?? "The selected source";
        await loadAnimeWithSourceFallback(bridge, remainingSources, remainingSources[0]!.id, selectedAnime.title, undefined, undefined, [], true);
        setSourceFallbackStatus(`Switched sources because ${failedSource} listed episodes but returned no playable streams.`);
      }
    } catch {
      setBusy("");
      setError(selectedAnime ? `No installed source returned a playable stream for “${selectedAnime.title}”.` : "This anime could not be opened.");
    }
  }
  async function changeEpisode(next: string, autoplayVideo = true) {
    if (next === episodeId) return;
    const nextEpisode = episodes.find((item) => item.id === next);
    failedPlaybackSourcesRef.current.clear();
    if (!videoRef.current?.ended) await persistProgress(false);
    autoplayRequestedRef.current = autoplayVideo;
    restoredPlaybackKeyRef.current = "";
    setProgressStatus("");
    setEpisodeId(next);
    setServers([]);
    setStreams([]);
    replaceEpisodeInUrl(next);
    try {
      await loadEpisode(bridge, next);
    } catch (cause) {
      if (nextEpisode && anime?.title) {
        try {
          await fallBackToAnotherSource(nextEpisode.number, 0);
          return;
        } catch {
          // Show the original source error with a useful all-sources explanation below.
        }
      }
      setBusy("");
      setError(sources.length > 1 ? "No installed source returned a playable stream for this episode." : message(cause));
    }
  }
  async function changeServer(next: string) {
    const continuePlaying = videoRef.current ? !videoRef.current.paused : false;
    await persistProgress(false);
    const selectedServer = servers.find((item) => item.id === next);
    if (selectedServer) writePreference("hao:anime:preferred-server", selectedServer.name);
    restoredPlaybackKeyRef.current = "";
    autoplayRequestedRef.current = continuePlaying;
    setServerId(next);
    setStreams([]);
    try {
      await loadPlayableServer(bridge, episodeId, servers, next);
    } catch (cause) {
      setBusy("");
      setError(message(cause));
    }
  }
  async function changeSource(next: string) {
    failedPlaybackSourcesRef.current.clear();
    clearCanonicalWork();
    setSourceId(next);
    setBrowseMode("popular");
    setSearchDraft("");
    await loadCatalog(bridge, next, "popular", "");
  }
  async function changeBrowseMode(next: "popular" | "latest") {
    clearCanonicalWork();
    setBrowseMode(next);
    await loadCatalog(bridge, sourceId, next, "");
  }
  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchDraft.trim();
    if (query.length < 2) {
      setError("Enter at least two characters to search.");
      return;
    }
    clearCanonicalWork();
    failedPlaybackSourcesRef.current.clear();
    setBrowseMode("search");
    try {
      await loadAnimeWithSourceFallback(bridge, sources, sourceId, query);
    } catch (cause) {
      setBusy("");
      setError(message(cause));
    }
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

  async function switchAudioVersion(target: AudioMode) {
    const nextStream = pickAudioVariant(streams, stream, target);
    if (!nextStream) return;
    writePreference("hao:anime:audio-mode", target);
    setSourceFallbackStatus(`Switched to ${target === "dub" ? "dubbed audio" : "subtitled audio"}.`);
    await changeStream(nextStream.id);
  }

  async function recoverFromPlaybackFailure() {
    if (playbackRecoveryRef.current || !episode) return;
    playbackRecoveryRef.current = true;
    setError("");
    autoplayRequestedRef.current = true;
    try {
      const candidate = nextPlaybackCandidate(streams, streamId, servers, serverId);
      if (candidate?.kind === "stream") {
        setSourceFallbackStatus("That quality failed, so HAO switched to another stream automatically.");
        safelyResetVideo(videoRef.current);
        setStreamId(candidate.id);
        return;
      }
      if (candidate?.kind === "server") {
        setSourceFallbackStatus("That server failed, so HAO switched to a backup server automatically.");
        const candidateIndex = servers.findIndex((item) => item.id === candidate.id);
        try {
          await loadPlayableServer(bridge, episode.id, candidateIndex >= 0 ? servers.slice(candidateIndex) : servers, candidate.id);
          return;
        } catch {
          // Every remaining server failed, so continue with another installed source.
        }
      }

      await fallBackToAnotherSource(episode.number, currentTime);
    } catch {
      setBusy("");
      setError("HAO tried the available qualities, servers, and installed sources, but this episode still could not be played.");
    } finally {
      playbackRecoveryRef.current = false;
    }
  }

  async function fallBackToAnotherSource(episodeNumber: number, positionSeconds: number) {
    failedPlaybackSourcesRef.current.add(sourceId);
    const remainingSources = sources.filter((source) => !failedPlaybackSourcesRef.current.has(source.id));
    if (!remainingSources.length || !anime?.title) throw new Error("No additional source is available.");
    remoteProgressRef.current = { episodeNumber, positionSeconds };
    setSourceFallbackStatus("That source could not play this episode. Trying another installed source…");
    await loadAnimeWithSourceFallback(bridge, remainingSources, remainingSources[0]!.id, anime.title, undefined, undefined, [], true);
  }

  async function persistProgress(completed: boolean) {
    const video = videoRef.current;
    if (!video || !episode || !sourceId || !animeId || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const positionSeconds = completed ? video.duration : video.currentTime;
    const saved = {
      positionSeconds,
      durationSeconds: video.duration,
      updatedAt: new Date().toISOString(),
      completed
    };
    writePreference(playbackStorageKey(sourceId, animeId, episode.id), JSON.stringify(saved));
    saveContinueEntry(episode, positionSeconds, video.duration, completed);
    recordActivity({ id: `anime:${sourceId}:${animeId}`, kind: "watch", title: anime?.title ?? "Selected anime", detail: `Episode ${episode.number} · ${episode.title}`, href: window.location.pathname + window.location.search, sourceName: sources.find((item) => item.id === sourceId)?.name ?? anime?.provider ?? "Anime source", progressPercent: playbackPercent(positionSeconds, video.duration) });
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
          positionPercent: playbackPercent(positionSeconds, video.duration)
        })
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
      updatedAt: new Date().toISOString()
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
    setError("");
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setCurrentTime(video.currentTime);
    const key = playbackStorageKey(sourceId, animeId, episode.id);
    if (restoredPlaybackKeyRef.current !== key) {
      const localPosition = parsePlaybackPosition(readPreference(key));
      const remoteProgress = remoteProgressRef.current;
      const remotePosition =
        !localPosition && remoteProgress?.episodeNumber === episode.number
          ? {
              positionSeconds: remoteProgress.positionSeconds,
              durationSeconds: video.duration,
              updatedAt: new Date(0).toISOString(),
              completed: false
            }
          : null;
      const resumeAt = resumablePosition(localPosition ?? remotePosition, video.duration);
      if (resumeAt !== null) {
        video.currentTime = resumeAt;
        setCurrentTime(resumeAt);
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
        setMuted(true);
        writePreference("hao:anime:muted", "true");
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
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
      if (Number.isFinite(video.duration)) setDuration(video.duration);
    }
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

  function replacePlaybackSourceInUrl(nextSourceId: string, nextAnimeId: string, nextEpisodeId: string, query: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("sourceId", nextSourceId);
    url.searchParams.set("animeId", nextAnimeId);
    url.searchParams.set("episodeId", nextEpisodeId);
    url.searchParams.set("mode", "search");
    url.searchParams.set("query", query);
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

  function revealControls() {
    setControlsVisible(true);
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    if (isPlaying && !settingsOpen) {
      controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2400);
    }
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video || !stream) return;
    revealControls();
    if (video.paused) {
      try {
        await video.play();
      } catch {
        setError("Playback could not start. Try another server or quality.");
      }
    } else video.pause();
  }

  function seekBy(seconds: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const nextTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    revealControls();
  }

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    setCurrentTime(seconds);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    writePreference("hao:anime:muted", String(next));
    revealControls();
  }

  function changeVolume(nextVolume: number) {
    setVolume(nextVolume);
    setMuted(nextVolume === 0);
    writePreference("hao:anime:volume", String(nextVolume));
    writePreference("hao:anime:muted", String(nextVolume === 0));
  }

  async function toggleFullscreen() {
    const shell = playerShellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shell.requestFullscreen();
    revealControls();
  }

  function changeSubtitle(next: string) {
    const video = videoRef.current;
    if (!video) return;
    for (let index = 0; index < video.textTracks.length; index += 1) video.textTracks[index]!.mode = next === String(index) ? "showing" : "disabled";
    setSubtitleMode(next);
  }

  function reportPlayerIssue() {
    saveSourceReport({ medium: "anime", sourceId, sourceName: activeSourceName, title: anime?.title ?? "Selected anime", detail: error || `Playback issue for episode ${episode?.number ?? "unknown"}`, pageUrl: window.location.href });
    void api("/source-reports", { method: "POST", body: JSON.stringify({ medium: "anime", sourceId, sourceName: activeSourceName, title: anime?.title ?? "Selected anime", detail: error || `Playback issue for episode ${episode?.number ?? "unknown"}` }) }).catch(() => undefined);
    setProgressStatus("Issue saved for the beta administrator");
  }

  const playedPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const activeSourceName = sources.find((item) => item.id === sourceId)?.name ?? anime?.provider ?? "HAO source";
  const posterUrl = workCoverUrl ?? anime?.thumbnailUrl ?? undefined;

  return (
    <div className="player-page anime-player-page">
      <div className="player-watch-layout">
      <section className="player-primary" aria-label="Video player">
      <div
        ref={playerShellRef}
        className={`video-stage streaming-stage ${controlsVisible || !isPlaying ? "controls-visible" : "controls-hidden"}`}
        onMouseMove={revealControls}
        onMouseLeave={() => isPlaying && !settingsOpen && setControlsVisible(false)}
        onFocusCapture={revealControls}
        style={posterUrl && !stream ? { backgroundImage: `linear-gradient(rgba(0,0,0,.62),rgba(0,0,0,.86)),url(${posterUrl})` } : undefined}
      >
        {stream ? (
          <video
            ref={videoRef}
            className={`subtitle-size-${subtitleSize} subtitle-background-${subtitleBackground}`}
            key={`${episodeId}:${stream.id}`}
            playsInline
            preload="metadata"
            poster={posterUrl}
            onClick={() => void togglePlayback()}
            onDoubleClick={() => void toggleFullscreen()}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => {
              setIsPlaying(true);
              setIsBuffering(false);
              revealControls();
              void persistProgress(false);
            }}
            onPlaying={() => setIsBuffering(false)}
            onWaiting={() => setIsBuffering(true)}
            onTimeUpdate={handleTimeUpdate}
            onPause={() => {
              setIsPlaying(false);
              setControlsVisible(true);
              if (!videoRef.current?.ended) void persistProgress(false);
            }}
            onEnded={() => {
              setIsPlaying(false);
              setControlsVisible(true);
              void handleEnded();
            }}
            onError={() => void recoverFromPlaybackFailure()}
          >
            {stream.subtitles.map((subtitle) => <track key={subtitle.url} kind="subtitles" label={subtitle.label} srcLang={subtitle.language} src={subtitle.url} />)}
          </video>
        ) : (
          <div className="player-placeholder">{busy ? <LoaderCircle className="spin" /> : <Film />}<span>{busy || "Choose an episode and stream."}</span></div>
        )}

        {stream && <div className="player-title-overlay"><div><b>{anime?.title ?? "Anime"}</b><span>{episode ? `Episode ${episode.number} · ${episode.title}` : "Select an episode"}</span></div><span className="player-quality-badge">{stream.quality ?? "AUTO"}</span></div>}
        {stream && !isPlaying && !isBuffering && <button className="player-center-action" aria-label="Play" onClick={() => void togglePlayback()}><Play fill="currentColor" /></button>}
        {stream && isBuffering && <div className="player-buffering" role="status"><LoaderCircle className="spin" /><span>Buffering</span></div>}

        {stream && (
          <div className="custom-player-controls" aria-label="Playback controls">
            <input className="player-progress" aria-label="Video progress" aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`} type="range" min="0" max={Math.max(duration, 0)} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(event) => seekTo(Number(event.target.value))} style={{ background: `linear-gradient(90deg,var(--cyan) ${playedPercent}%,rgba(255,255,255,.28) ${playedPercent}%)` }} />
            <div className="player-control-row">
              <div className="player-control-group">
                <button aria-label={isPlaying ? "Pause" : "Play"} title={isPlaying ? "Pause (Space)" : "Play (Space)"} onClick={() => void togglePlayback()}>{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
                <button aria-label="Back 10 seconds" title="Back 10 seconds (J)" onClick={() => seekBy(-10)}><RotateCcw /></button>
                <button aria-label="Forward 10 seconds" title="Forward 10 seconds (L)" onClick={() => seekBy(10)}><RotateCw /></button>
                <button aria-label={muted ? "Unmute" : "Mute"} title="Mute (M)" onClick={toggleMute}>{muted || volume === 0 ? <VolumeX /> : <Volume2 />}</button>
                <input className="player-volume" aria-label="Volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} />
                <span className="player-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>
              <div className="player-control-group">
                {nextEpisode && <button aria-label="Next episode" title="Next episode" onClick={() => void changeEpisode(nextEpisode.id, true)}><SkipForward /></button>}
                {audioSwitchTarget && <button className="audio-version-toggle" aria-label={`Switch to ${audioSwitchTarget === "dub" ? "dubbed" : "subtitled"} audio`} title={`Switch to ${audioSwitchTarget === "dub" ? "Dub" : "Sub"}`} onClick={() => void switchAudioVersion(audioSwitchTarget)}><span>{audioSwitchTarget.toUpperCase()}</span></button>}
                <button className={subtitleMode !== "off" ? "active" : ""} aria-label="Subtitles" title="Subtitles" disabled={!stream.subtitles.length} onClick={() => changeSubtitle(subtitleMode === "off" ? "0" : "off")}><Captions /></button>
                <button className={settingsOpen ? "active" : ""} aria-label="Playback settings" title="Playback settings" onClick={() => { setSettingsOpen((value) => !value); setControlsVisible(true); }}><Settings2 /></button>
                <button aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} title="Fullscreen (F)" onClick={() => void toggleFullscreen()}><Maximize2 /></button>
              </div>
            </div>
          </div>
        )}

        {stream && settingsOpen && (
          <div className="playback-settings" role="dialog" aria-label="Playback settings">
            <div className="playback-settings-heading"><b>Playback settings</b><button aria-label="Close playback settings" onClick={() => setSettingsOpen(false)}>×</button></div>
            <label>Server<select aria-label="Stream server" value={serverId} onChange={(event) => void changeServer(event.target.value)} disabled={Boolean(busy) || !servers.length}>{servers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Quality & audio<select aria-label="Stream quality" value={streamId} onChange={(event) => void changeStream(event.target.value)} disabled={Boolean(busy) || !streams.length}>{streams.map((item) => <option key={item.id} value={item.id}>{item.quality ?? "Auto"} · {item.audio ?? "Default audio"}</option>)}</select></label>
            <label>Subtitles<select aria-label="Subtitle track" value={subtitleMode} onChange={(event) => changeSubtitle(event.target.value)}><option value="off">Off</option>{stream.subtitles.map((subtitle, index) => <option key={subtitle.url} value={String(index)}>{subtitle.label}</option>)}</select></label>
            <label>Subtitle size<select aria-label="Subtitle size" value={subtitleSize} onChange={(event) => { setSubtitleSize(event.target.value); writePreference("hao:anime:subtitle-size", event.target.value); }}><option value="75">Small</option><option value="100">Medium</option><option value="125">Large</option><option value="150">Extra large</option></select></label>
            <label>Subtitle background<select aria-label="Subtitle background" value={subtitleBackground} onChange={(event) => { setSubtitleBackground(event.target.value); writePreference("hao:anime:subtitle-background", event.target.value); }}><option value="dark">Dark</option><option value="none">None</option></select></label>
          </div>
        )}
      </div>
      </section>
      <aside className="episode-rail" aria-label="Episodes">
        <div className="episode-rail-heading"><div><ListVideo /><span><b>Episodes</b><small>{episodes.length ? `${episodes.length} available` : "Loading episodes"}</small></span></div><span>{episodeIndex >= 0 ? `${episodeIndex + 1}/${episodes.length}` : "—"}</span></div>
        <div className="episode-list">
          {episodes.map((item) => (
            <button key={item.id} className={item.id === episodeId ? "active" : ""} aria-current={item.id === episodeId ? "true" : undefined} onClick={() => void changeEpisode(item.id, true)} disabled={Boolean(busy)}>
              <span className="episode-number">{String(item.number).padStart(2, "0")}</span>
              <span><b>Episode {item.number}</b><small>{item.title}</small></span>
              {item.id === episodeId ? <Play fill="currentColor" /> : item.id === nextEpisode?.id ? <span className="up-next-label">UP NEXT</span> : <ChevronRight />}
            </button>
          ))}
          {!busy && !episodes.length && <p>No episodes are available from this source.</p>}
        </div>
      </aside>
      </div>
      <details className="source-workbench">
      <summary><span><Settings2 /> Change title or source</span><ChevronDown /></summary>
      <div className="source-workbench-body">
      <div className="anime-browse-bar">
        <label>
          Source
          <select aria-label="Anime source" value={sourceId} onChange={(event) => void changeSource(event.target.value)} disabled={Boolean(busy)}>
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.language.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Browse
          <select aria-label="Browse mode" value={browseMode} onChange={(event) => void changeBrowseMode(event.target.value as "popular" | "latest")} disabled={Boolean(busy)}>
            <option value="popular">Popular</option>
            <option value="latest" disabled={!sources.find((item) => item.id === sourceId)?.supportsLatest}>
              Latest updates
            </option>
            {browseMode === "search" && <option value="search">Search results</option>}
          </select>
        </label>
        <form className="anime-search" onSubmit={(event) => void submitSearch(event)}>
          <label>
            Search
            <input aria-label="Search this anime source" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search titles…" disabled={Boolean(busy)} />
          </label>
          <button className="button primary compact" type="submit" disabled={Boolean(busy) || searchDraft.trim().length < 2}>
            <Search />
            Search
          </button>
        </form>
      </div>
      <div className="player-source-bar">
        <label>
          Title
          <select aria-label="Anime title" value={animeId} onChange={(event) => void changeAnime(event.target.value)} disabled={Boolean(busy)}>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Episode
          <select aria-label="Episode" value={episodeId} onChange={(event) => void changeEpisode(event.target.value)} disabled={Boolean(busy) || !episodes.length}>
            {episodes.map((item) => (
              <option key={item.id} value={item.id}>
                Episode {item.number} · {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Server
          <select aria-label="Stream server" value={serverId} onChange={(event) => void changeServer(event.target.value)} disabled={Boolean(busy) || !servers.length}>
            {servers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quality
          <select aria-label="Stream quality" value={streamId} onChange={(event) => void changeStream(event.target.value)} disabled={Boolean(busy) || !streams.length}>
            {streams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.quality ?? "Auto"} · {item.audio ?? "Default audio"}
              </option>
            ))}
          </select>
        </label>
      </div>
      </div>
      </details>
      <section className="player-information">
      <div className="episode-navigation" aria-label="Episode navigation">
        <button className="button ghost compact" disabled={Boolean(busy) || !previousEpisode} onClick={() => previousEpisode && void changeEpisode(previousEpisode.id, true)}>
          <SkipBack />
          Previous
        </button>
        <span>{episodeIndex >= 0 ? `${episodeIndex + 1} of ${episodes.length}` : "No episode selected"}</span>
        <label className="autoplay-toggle">
          <input type="checkbox" checked={autoplayNext} onChange={(event) => toggleAutoplay(event.target.checked)} />
          <span>Autoplay next</span>
        </label>
        <button className="button ghost compact" disabled={Boolean(busy) || !nextEpisode} onClick={() => nextEpisode && void changeEpisode(nextEpisode.id, true)}>
          Next
          <SkipForward />
        </button>
      </div>
      {busy && (
        <p className="player-status" role="status">
          <LoaderCircle className="spin" /> {busy}
        </p>
      )}
      {error && (
        <p className="player-status error" role="alert">
          <TriangleAlert /> {error}
          <button className="button ghost compact" onClick={() => void connect()}>
            <RefreshCw />
            Retry
          </button>
          <button className="button ghost compact" onClick={reportPlayerIssue}><Flag /> Report source</button>
        </p>
      )}
      <div className="now-playing">
        <div>
          <span className="eyebrow">
            <Server /> NOW PLAYING · {bridgeScope === "beta" ? "MANAGED BETA BRIDGE" : (anime?.provider ?? "LOCAL RUNTIME")}
          </span>
          <h1>{anime?.title ?? "Anime player"}</h1>
          <p>{episode ? `Episode ${episode.number} · ${episode.title}` : (anime?.description ?? "Connect an authorized anime source.")}</p>
          {anime?.attribution && <small>{anime.attribution}</small>}
          {progressStatus && (
            <span className="progress-save-status">
              <CheckCircle2 />
              {progressStatus}
            </span>
          )}
          {sourceFallbackStatus && (
            <span className="source-fallback-status">
              <RefreshCw />
              {sourceFallbackStatus}
            </span>
          )}
        </div>
      </div>
      </section>
      <div className="player-shortcuts" aria-label="Keyboard shortcuts"><span>Space Play/Pause</span><span>J/L ±10 seconds</span><span>M Mute</span><span>F Fullscreen</span></div>
    </div>
  );
}

function safelyResetVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Playback continues when local storage is unavailable. */
  }
}

function streamPreference(stream: AnimeStream): string {
  return `${stream.quality ?? "Auto"}|${stream.audio ?? "Default audio"}`;
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}

function message(cause: unknown) {
  return bridgeErrorMessage(cause, "The anime source could not complete this request.");
}
