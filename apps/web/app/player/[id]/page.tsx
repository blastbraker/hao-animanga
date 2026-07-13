"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Film, LoaderCircle, RefreshCw, Search, Server, TriangleAlert } from "lucide-react";
import Hls from "hls.js";
import { getActiveBridgeEndpoint } from "../../../lib/api";

type AnimeSourceSummary = { id: string; name: string; language: string; supportsLatest: boolean; provider: string };
type AnimeCatalogItem = { id: string; title: string; description: string; provider: string; attribution: string; thumbnailUrl?: string | null };
type AnimeEpisode = { id: string; animeId: string; number: number; title: string };
type AnimeServer = { id: string; name: string };
type AnimeSubtitle = { label: string; language?: string; url: string };
type AnimeStream = { id: string; serverId: string; url: string; kind: "MP4" | "HLS"; quality?: string; audio?: string; subtitles: AnimeSubtitle[] };

export default function PlayerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [bridge, setBridge] = useState("");
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
  const [busy, setBusy] = useState("Connecting to your HAO Bridge…");
  const [error, setError] = useState("");

  const anime = useMemo(() => catalog.find((item) => item.id === animeId), [animeId, catalog]);
  const episode = useMemo(() => episodes.find((item) => item.id === episodeId), [episodeId, episodes]);
  const stream = useMemo(() => streams.find((item) => item.id === streamId), [streamId, streams]);
  const streamUrl = stream ? (stream.url.startsWith("/") ? `${bridge}${stream.url}` : stream.url) : "";

  async function bridgeRequest<T>(endpoint: string, path: string): Promise<T> {
    const response = await fetch(`${endpoint}${path}`);
    const payload = await response.json().catch(() => null) as ({ message?: string } & T) | null;
    if (!response.ok) throw new Error(payload?.message ?? `Bridge returned ${response.status}`);
    return payload as T;
  }

  useEffect(() => {
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
      const requestedMode = parameters.get("mode") === "latest" ? "latest" : "popular";
      const endpoint = await getActiveBridgeEndpoint();
      const nextSources = await bridgeRequest<AnimeSourceSummary[]>(endpoint, "/v1/anime/sources");
      if (!nextSources.length) throw new Error("Install and enable an Aniyomi extension before browsing anime.");
      const initialSource = nextSources.find((item) => item.id === requestedSourceId) ?? nextSources.find((item) => !item.provider.includes("HAO Signed Fixture")) ?? nextSources[0]!;
      const initialMode = requestedMode === "latest" && initialSource.supportsLatest ? "latest" : "popular";
      setBridge(endpoint); setSources(nextSources); setSourceId(initialSource.id); setBrowseMode(initialMode);
      await loadCatalog(endpoint, initialSource.id, initialMode, "", requestedAnimeId ?? undefined);
    } catch (cause) { setBusy(""); setError(message(cause)); }
  }

  async function loadCatalog(endpoint: string, nextSourceId: string, mode: "popular" | "latest" | "search", query: string, preferredAnimeId?: string) {
    setBusy(mode === "search" ? `Searching for “${query}”…` : mode === "latest" ? "Loading latest updates…" : "Loading popular anime…");
    setError(""); safelyResetVideo(videoRef.current);
    setCatalog([]); setAnimeId(""); setEpisodes([]); setEpisodeId(""); setServers([]); setServerId(""); setStreams([]); setStreamId("");
    try {
      const parameters = new URLSearchParams({ sourceId: nextSourceId, mode, page: "1" });
      if (mode === "search") parameters.set("query", query.trim());
      const titles = await bridgeRequest<AnimeCatalogItem[]>(endpoint, `/v1/anime/catalog?${parameters.toString()}`);
      if (!titles.length) throw new Error(mode === "search" ? `No results found for “${query}”.` : "This source did not return any titles.");
      const initialTitle = titles.find((item) => item.id === preferredAnimeId) ?? titles[0]!;
      setCatalog(titles); setAnimeId(initialTitle.id);
      await loadAnime(endpoint, initialTitle.id);
    } catch (cause) { setBusy(""); setError(message(cause)); }
  }

  async function loadAnime(endpoint: string, nextAnimeId: string, cancelled = false) {
    setBusy("Loading episodes…"); setError(""); safelyResetVideo(videoRef.current);
    try {
      const nextEpisodes = await bridgeRequest<AnimeEpisode[]>(endpoint, `/v1/anime/${encodeURIComponent(nextAnimeId)}/episodes`);
      if (!nextEpisodes.length) throw new Error("This source did not return any episodes.");
      if (cancelled) return;
      setEpisodes(nextEpisodes); setEpisodeId(nextEpisodes[0]!.id);
      await loadEpisode(endpoint, nextEpisodes[0]!.id, cancelled);
    } catch (cause) { if (!cancelled) setError(message(cause)); }
    finally { if (!cancelled) setBusy(""); }
  }

  async function loadEpisode(endpoint: string, nextEpisodeId: string, cancelled = false) {
    setBusy("Loading stream servers…"); setError(""); safelyResetVideo(videoRef.current);
    const nextServers = await bridgeRequest<AnimeServer[]>(endpoint, `/v1/anime/episodes/${encodeURIComponent(nextEpisodeId)}/servers`);
    if (!nextServers.length) throw new Error("No stream servers are available for this episode.");
    if (cancelled) return;
    setServers(nextServers); setServerId(nextServers[0]!.id);
    await loadServer(endpoint, nextEpisodeId, nextServers[0]!.id, cancelled);
  }

  async function loadServer(endpoint: string, nextEpisodeId: string, nextServerId: string, cancelled = false) {
    setBusy("Resolving authorized streams…"); setError(""); safelyResetVideo(videoRef.current);
    const nextStreams = await bridgeRequest<AnimeStream[]>(endpoint, `/v1/anime/episodes/${encodeURIComponent(nextEpisodeId)}/streams?serverId=${encodeURIComponent(nextServerId)}`);
    if (!nextStreams.length) throw new Error("This server did not return a playable stream.");
    if (cancelled) return;
    setStreams(nextStreams); setStreamId(nextStreams[0]!.id); setBusy("");
  }

  async function changeAnime(next: string) { setAnimeId(next); setEpisodes([]); setServers([]); setStreams([]); await loadAnime(bridge, next); }
  async function changeEpisode(next: string) { setEpisodeId(next); setServers([]); setStreams([]); try { await loadEpisode(bridge, next); } catch (cause) { setBusy(""); setError(message(cause)); } }
  async function changeServer(next: string) { setServerId(next); setStreams([]); try { await loadServer(bridge, episodeId, next); } catch (cause) { setBusy(""); setError(message(cause)); } }
  async function changeSource(next: string) { setSourceId(next); setBrowseMode("popular"); setSearchDraft(""); await loadCatalog(bridge, next, "popular", ""); }
  async function changeBrowseMode(next: "popular" | "latest") { setBrowseMode(next); await loadCatalog(bridge, sourceId, next, ""); }
  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchDraft.trim();
    if (query.length < 2) { setError("Enter at least two characters to search."); return; }
    setBrowseMode("search");
    await loadCatalog(bridge, sourceId, "search", query);
  }

  return <div className="player-page anime-player-page">
    <div className="video-stage">
      {stream ? <video ref={videoRef} key={stream.id} controls playsInline preload="metadata" onError={()=>setError("The selected stream could not be loaded. Try another server or quality.")}>
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
      <label>Quality<select aria-label="Stream quality" value={streamId} onChange={(event)=>{safelyResetVideo(videoRef.current);setStreamId(event.target.value)}} disabled={Boolean(busy) || !streams.length}>{streams.map((item)=><option key={item.id} value={item.id}>{item.quality ?? "Auto"} · {item.audio ?? "Default audio"}</option>)}</select></label>
    </div>
    {busy && <p className="player-status" role="status"><LoaderCircle className="spin"/> {busy}</p>}
    {error && <p className="player-status error" role="alert"><TriangleAlert/> {error}<button className="button ghost compact" onClick={()=>void connect()}><RefreshCw/>Retry</button></p>}
    <div className="now-playing">
      <div><span className="eyebrow"><Server/> NOW PLAYING · {anime?.provider ?? "LOCAL RUNTIME"}</span><h1>{anime?.title ?? "Anime player"}</h1><p>{episode ? `Episode ${episode.number} · ${episode.title}` : anime?.description ?? "Connect an authorized anime source."}</p>{anime?.attribution && <small>{anime.attribution}</small>}</div>
    </div>
  </div>;
}

function safelyResetVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : "The anime source could not complete this request."; }
