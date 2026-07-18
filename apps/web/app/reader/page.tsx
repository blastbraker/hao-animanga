"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import { BookOpen, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Search, Server, TriangleAlert } from "lucide-react";
import { api, bridgeErrorMessage, bridgeJson, getActiveBridge, type LibraryResponse } from "../../lib/api";
import {
  MangaChapter,
  MangaChapterPages,
  MangaSource,
  MangaSummary,
  normalizeMangaChapterPages,
  normalizeMangaChapters,
  normalizeMangaSearchResponse,
  normalizeMangaSources,
  normalizeMangaSummary,
} from "../../lib/manga-response";
import { findReadableMangaFallback, type ReadableMangaFallback } from "../../lib/manga-fallback";
import { dedupeSourceResults, rankSourcesByReliability, recordSourceResult } from "../../lib/source-reliability";
type BrowseMode = "popular" | "latest";
type ReadingMode = "webtoon" | "ltr" | "rtl";
const ALL_SOURCES_ID = "all-installed-sources";

export default function ReaderPage() {
  const [bridge, setBridge] = useState("");
  const [bridgeScope, setBridgeScope] = useState<"personal" | "beta">("personal");
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MangaSummary[]>([]);
  const [browseMode, setBrowseMode] = useState<BrowseMode>("popular");
  const [selected, setSelected] = useState<MangaSummary | null>(null);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [chapterQuery, setChapterQuery] = useState("");
  const [visibleChapterCount, setVisibleChapterCount] = useState(50);
  const [pages, setPages] = useState<MangaChapterPages | null>(null);
  const [readingMode, setReadingMode] = useState<ReadingMode>("webtoon");
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState("Connecting to HAO Bridge…");
  const [error, setError] = useState("");
  const [searchSummary, setSearchSummary] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const libraryWorkIdRef = useRef<string | null>(null);
  const libraryReadyWorkIdRef = useRef<string | null>(null);

  const activeSource = useMemo(() => sources.find((source) => source.id === sourceId), [sourceId, sources]);
  const selectedSource = useMemo(() => sources.find((source) => source.id === selected?.sourceId), [selected?.sourceId, sources]);
  const currentChapter = useMemo(() => chapters.find((chapter) => chapter.index === pages?.chapterIndex), [chapters, pages]);
  const chapterPosition = currentChapter ? chapters.indexOf(currentChapter) : -1;
  const filteredChapters = useMemo(() => {
    const normalizedQuery = chapterQuery.trim().toLowerCase();
    if (!normalizedQuery) return chapters;
    return chapters.filter((chapter) => [chapter.name, chapter.number, chapter.scanlator].some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery)));
  }, [chapterQuery, chapters]);

  useEffect(() => {
    const saved = window.localStorage.getItem("hao:manga-reading-mode");
    if (saved === "webtoon" || saved === "ltr" || saved === "rtl") setReadingMode(saved);
  }, []);

  useEffect(() => {
    setChapterQuery("");
    setVisibleChapterCount(50);
  }, [selected?.id, selected?.sourceId]);

  useEffect(() => {
    if (!pages || readingMode === "webtoon") return;
    const totalPages = pages.pageCount;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const forward = readingMode === "rtl" ? event.key === "ArrowLeft" : event.key === "ArrowRight";
      setPageIndex((current) => Math.max(0, Math.min(totalPages - 1, current + (forward ? 1 : -1))));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pages, readingMode]);

  useEffect(() => {
    if (!pages || !selected || !currentChapter) return;
    const timer = window.setTimeout(() => {
      const positionPercent = readingMode === "webtoon" ? null : pages.pageCount <= 1 ? 100 : Math.round((pageIndex / (pages.pageCount - 1)) * 1000) / 10;
      void syncChapterProgress(currentChapter, positionPercent);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [currentChapter, pageIndex, pages, readingMode, selected]);

  async function bridgeRequest<T>(path: string, endpoint = bridge): Promise<T> {
    return bridgeJson<T>(endpoint, path);
  }

  function unlinkCanonicalWork() {
    libraryWorkIdRef.current = null;
    libraryReadyWorkIdRef.current = null;
    setSyncStatus("");
  }

  async function ensureLibraryWork(): Promise<string> {
    if (!selected) throw new Error("No manga title is selected.");
    let workId = libraryWorkIdRef.current;
    if (!workId) {
      const imported = await api<{ work: Work }>("/works/import-extension", {
        method: "POST",
        body: JSON.stringify({
          kind: selected.genres.some((genre) => genre.toLocaleLowerCase() === "manhwa") ? "MANHWA" : "MANGA",
          sourceId: selected.sourceId || sourceId,
          externalId: String(selected.id),
          title: selected.title,
          synopsis: selected.description ?? "",
          coverUrl: bridge ? `${bridge}/v1/manga/${selected.id}/thumbnail` : null,
          status: selected.status ?? null,
          genres: selected.genres,
        }),
      });
      workId = imported.work.id;
      libraryWorkIdRef.current = workId;
    }
    if (libraryReadyWorkIdRef.current !== workId) {
      const library = await api<LibraryResponse>("/library");
      const existing = library.items.find((entry) => entry.work.id === workId);
      await api("/library", {
        method: "PUT",
        body: JSON.stringify({
          workId,
          status: !existing || existing.status === "PLANNING" ? "WATCHING_READING" : existing.status,
          favorite: existing?.favorite ?? false,
          rating: existing?.rating ?? null,
          notes: existing?.notes ?? "",
        }),
      });
      libraryReadyWorkIdRef.current = workId;
      setSyncStatus("Added to Library");
    }
    return workId;
  }

  async function syncChapterProgress(chapter: MangaChapter, positionPercent: number | null) {
    try {
      const workId = await ensureLibraryWork();
      await api("/progress", {
        method: "PUT",
        body: JSON.stringify({
          workId,
          releaseItemId: null,
          completedUnits: Math.max(0, chapter.number || chapter.index),
          positionSeconds: null,
          positionPercent,
        }),
      });
      setSyncStatus(`Chapter ${chapter.number || chapter.index} synced`);
    } catch {
      setSyncStatus("Progress saved on this page only · sync unavailable");
    }
  }

  async function findMangaFallback(title: string, currentSource: MangaSource, availableSources: MangaSource[], endpoint = bridge): Promise<ReadableMangaFallback | null> {
    const fallbackSources = rankSourcesByReliability(
      availableSources.filter((source) => source.id !== currentSource.id && source.language === currentSource.language),
      "manga",
    ).slice(0, 8);
    return findReadableMangaFallback({
      title,
      currentSourceId: currentSource.id,
      language: currentSource.language,
      sources: fallbackSources,
      searchSource: async (source, fallbackTitle) => normalizeMangaSearchResponse(
        await bridgeRequest<unknown>(`/v1/manga/search?sourceId=${encodeURIComponent(source.id)}&query=${encodeURIComponent(fallbackTitle)}&page=1`, endpoint),
      ).items,
      loadChapters: async (item) => normalizeMangaChapters(await bridgeRequest<unknown>(`/v1/manga/${item.id}/chapters`, endpoint)),
      onAttempt: (source, succeeded, latencyMs) => recordSourceResult("manga", source.id, succeeded, latencyMs),
    });
  }

  useEffect(() => {
    let cancelled = false;
    void getActiveBridge()
      .then(async (access) => {
        const endpoint = access.endpoint;
        const parameters = new URLSearchParams(window.location.search);
        const requestedSourceId = parameters.get("sourceId");
        const requestedMangaId = Number(parameters.get("mangaId"));
        const requestedChapterIndex = Number(parameters.get("chapterIndex"));
        const requestedQuery = parameters.get("query")?.trim() ?? "";
        const requestedWorkId = parameters.get("workId");
        const requestedMode: BrowseMode = parameters.get("mode") === "latest" ? "latest" : "popular";
        setBridge(endpoint);
        if (requestedWorkId) libraryWorkIdRef.current = requestedWorkId;
        setBridgeScope(access.scope);
        const payload = normalizeMangaSources(await bridgeRequest<unknown>("/v1/manga/sources", endpoint));
        if (!payload.length) throw new Error("No manga sources are available. Install and enable a Mihon extension first.");
        if (cancelled) return;
        setSources(payload);
        const preferred = payload.find((source) => source.id === requestedSourceId) ?? payload.find((source) => source.name === "MangaDex" && source.language === "en") ?? payload.find((source) => source.language === "en") ?? payload[0]!;
        const initialMode = requestedMode === "latest" && preferred.supportsLatest ? "latest" : "popular";
        setSourceId(preferred.id);
        setBrowseMode(initialMode);
        if (requestedQuery) setQuery(requestedQuery);
        const catalog = normalizeMangaSearchResponse(
          requestedQuery && !requestedMangaId
            ? await bridgeRequest<unknown>(`/v1/manga/search?sourceId=${encodeURIComponent(preferred.id)}&query=${encodeURIComponent(requestedQuery)}&page=1`, endpoint)
            : await bridgeRequest<unknown>(`/v1/manga/browse?sourceId=${encodeURIComponent(preferred.id)}&mode=${initialMode}&page=1`, endpoint),
        );
        if (cancelled) return;
        setResults(catalog.items);
        if (Number.isInteger(requestedMangaId) && requestedMangaId > 0) {
          const [detailsPayload, chapterPayload] = await Promise.all([bridgeRequest<unknown>(`/v1/manga/${requestedMangaId}`, endpoint), bridgeRequest<unknown>(`/v1/manga/${requestedMangaId}/chapters`, endpoint)]);
          if (cancelled) return;
          const fallback = catalog.items.find((item) => item.id === requestedMangaId) ?? { id: requestedMangaId, sourceId: preferred.id, title: "Selected title", genres: [] };
          let details = normalizeMangaSummary(detailsPayload, fallback);
          let chapterList = normalizeMangaChapters(chapterPayload);
          let selectedMangaId = requestedMangaId;
          const currentSource = payload.find((source) => source.id === details.sourceId) ?? preferred;
          setSourceId(currentSource.id);
          if (!chapterList.length) {
            const readableFallback = await findMangaFallback(details.title, currentSource, payload, endpoint);
            if (cancelled) return;
            if (readableFallback) {
              details = normalizeMangaSummary(await bridgeRequest<unknown>(`/v1/manga/${readableFallback.item.id}`, endpoint), readableFallback.item);
              chapterList = readableFallback.chapters;
              selectedMangaId = readableFallback.item.id;
              setSourceId(readableFallback.source.id);
              setResults(dedupeSourceResults([readableFallback.item, ...catalog.items]));
              setSearchSummary(`${currentSource.displayName} had no ${currentSource.language.toUpperCase()} chapters. Switched to ${readableFallback.source.displayName} with ${chapterList.length} chapters.`);
            } else {
              setError(`No readable ${currentSource.language.toUpperCase()} chapters are available from the installed sources for this title.`);
            }
          }
          setSelected(details);
          setChapters(chapterList);
          const requestedChapter = chapterList.find((chapter) => chapter.index === requestedChapterIndex);
          if (requestedChapter) {
            const chapterPages = normalizeMangaChapterPages(await bridgeRequest<unknown>(`/v1/manga/${selectedMangaId}/chapter/${requestedChapter.index}/pages`, endpoint));
            if (!chapterPages) throw new Error("This source returned invalid page data for the selected chapter.");
            if (cancelled) return;
            setPages(chapterPages);
            setPageIndex(0);
          }
        }
        setBusy("");
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setBusy("");
          setError(cause instanceof Error ? cause.message : "Could not connect to HAO Bridge.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!sourceId || !query.trim()) return;
    const searchSources = sourceId === ALL_SOURCES_ID
      ? rankSourcesByReliability(sources.filter((source) => source.language === "en"), "manga").slice(0, 8)
      : sources.filter((source) => source.id === sourceId);
    if (!searchSources.length) {
      setError("No eligible manga sources are available for this search.");
      return;
    }
    setBusy(searchSources.length > 1 ? `Searching ${searchSources.length} approved sources…` : `Searching ${searchSources[0]?.displayName ?? "your source"}…`);
    setError("");
    setSearchSummary("");
    setSelected(null);
    setChapters([]);
    setPages(null);
    unlinkCanonicalWork();
    try {
      const responses = await Promise.allSettled(searchSources.map(async (source) => {
        const startedAt = performance.now();
        try {
          const response = normalizeMangaSearchResponse(await bridgeRequest<unknown>(`/v1/manga/search?sourceId=${encodeURIComponent(source.id)}&query=${encodeURIComponent(query.trim())}&page=1`));
          recordSourceResult("manga", source.id, response.items.length > 0, performance.now() - startedAt);
          return response.items;
        } catch (cause) {
          recordSourceResult("manga", source.id, false, performance.now() - startedAt);
          throw cause;
        }
      }));
      const successful = responses.filter((response): response is PromiseFulfilledResult<MangaSummary[]> => response.status === "fulfilled");
      const items = dedupeSourceResults(successful.flatMap((response) => response.value)).slice(0, 100);
      setResults(items);
      if (searchSources.length > 1) setSearchSummary(`${items.length} unique titles from ${successful.length} of ${searchSources.length} sources.`);
      if (!items.length) setError(successful.length ? "No titles matched that search in the available sources." : "Every manga source failed. Retry shortly or ask the beta administrator to check the Bridge.");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }

  async function browse(mode: BrowseMode, nextSourceId = sourceId) {
    if (!nextSourceId || nextSourceId === ALL_SOURCES_ID) return;
    setBrowseMode(mode);
    setQuery("");
    setSearchSummary("");
    setBusy(`Loading ${mode} titles…`);
    setError("");
    setSelected(null);
    setChapters([]);
    setPages(null);
    unlinkCanonicalWork();
    try {
      const response = normalizeMangaSearchResponse(await bridgeRequest<unknown>(`/v1/manga/browse?sourceId=${encodeURIComponent(nextSourceId)}&mode=${mode}&page=1`));
      setResults(response.items);
      if (!response.items.length) setError(`This source did not return any ${mode} titles.`);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }

  function changeSource(nextSourceId: string) {
    unlinkCanonicalWork();
    setSourceId(nextSourceId);
    if (nextSourceId === ALL_SOURCES_ID) {
      setResults([]);
      setSelected(null);
      setChapters([]);
      setPages(null);
      setError("");
      setSearchSummary("Search will check up to eight approved English sources and combine duplicate titles.");
      return;
    }
    void browse(browseMode, nextSourceId);
  }

  async function openTitle(item: MangaSummary) {
    unlinkCanonicalWork();
    setSelected(item);
    setPages(null);
    setBusy("Loading chapters…");
    setError("");
    setSearchSummary("");
    try {
      const [detailsPayload, chapterPayload] = await Promise.all([bridgeRequest<unknown>(`/v1/manga/${item.id}`), bridgeRequest<unknown>(`/v1/manga/${item.id}/chapters`)]);
      let details = normalizeMangaSummary(detailsPayload, item);
      let chapterList = normalizeMangaChapters(chapterPayload);
      const currentSource = sources.find((source) => source.id === item.sourceId) ?? selectedSource ?? activeSource;
      if (!chapterList.length && currentSource) {
        setBusy(`No chapters from ${currentSource.displayName}. Trying other ${currentSource.language.toUpperCase()} sources…`);
        const fallback = await findMangaFallback(details.title, currentSource, sources);
        if (fallback) {
          details = normalizeMangaSummary(await bridgeRequest<unknown>(`/v1/manga/${fallback.item.id}`), fallback.item);
          chapterList = fallback.chapters;
          setSourceId(fallback.source.id);
          setResults((current) => dedupeSourceResults([fallback.item, ...current]));
          setSearchSummary(`${currentSource.displayName} had no ${currentSource.language.toUpperCase()} chapters. Switched to ${fallback.source.displayName} with ${chapterList.length} chapters.`);
        }
      }
      setSelected(details);
      setChapters(chapterList);
      if (!chapterList.length) setError(`No readable ${currentSource?.language.toUpperCase() ?? "selected-language"} chapters are available from the installed sources for this title.`);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }

  async function openChapter(chapter: MangaChapter) {
    if (!selected) return;
    setBusy(`Loading ${chapter.name}…`);
    setError("");
    try {
      const chapterPages = normalizeMangaChapterPages(await bridgeRequest<unknown>(`/v1/manga/${selected.id}/chapter/${chapter.index}/pages`));
      if (!chapterPages) throw new Error("This source returned invalid page data for the selected chapter.");
      setPages(chapterPages);
      setPageIndex(0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }

  function openAdjacentChapter(offset: number) {
    const chapter = chapters[chapterPosition + offset];
    if (chapter) void openChapter(chapter);
  }

  function changeReadingMode(mode: ReadingMode) {
    setReadingMode(mode);
    setPageIndex(0);
    window.localStorage.setItem("hao:manga-reading-mode", mode);
  }

  function resetTitle() {
    setSelected(null);
    setChapters([]);
    setPages(null);
    setError("");
  }

  if (pages && selected)
    return (
      <div className="reader-page live-reader">
        <header className="reader-toolbar">
          <button onClick={() => setPages(null)}>
            <ChevronLeft /> Chapters
          </button>
          <div>
            <b>{selected.title}</b>
            <span>{pages.chapterName}{syncStatus ? ` · ${syncStatus}` : ""}</span>
          </div>
          <div className="reader-mode-controls">
            <select aria-label="Reading mode" value={readingMode} onChange={(event) => changeReadingMode(event.target.value as ReadingMode)}>
              <option value="webtoon">Webtoon</option>
              <option value="ltr">Left to right</option>
              <option value="rtl">Right to left</option>
            </select>
            <span>{readingMode === "webtoon" ? `${pages.pageCount} pages` : `${pageIndex + 1} / ${pages.pageCount}`}</span>
          </div>
        </header>
        {busy && <ReaderStatus text={busy} />} {error && <ReaderError text={error} onRetry={() => window.location.reload()} />}
        <main className={`manga-pages ${readingMode === "webtoon" ? "webtoon" : "paged"}`} dir={readingMode === "rtl" ? "rtl" : "ltr"} aria-label={`${selected.title}, ${pages.chapterName}`}>
          {readingMode === "webtoon" ? (
            pages.pageUrls.map((url, index) => <img key={url} loading={index < 2 ? "eager" : "lazy"} src={`${bridge}${url}`} alt={`Page ${index + 1} of ${pages.pageCount}`} />)
          ) : (
            <>
              <img key={pages.pageUrls[pageIndex]} src={`${bridge}${pages.pageUrls[pageIndex]}`} alt={`Page ${pageIndex + 1} of ${pages.pageCount}`} />
              <div className="page-turn-zones" role="group" aria-label="Page turn controls">
                <button
                  type="button"
                  className="page-turn-zone previous"
                  aria-label="Previous page"
                  title="Previous page"
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                >
                  <span><ChevronLeft /> Previous</span>
                </button>
                <button
                  type="button"
                  className="page-turn-zone next"
                  aria-label="Next page"
                  title="Next page"
                  disabled={pageIndex >= pages.pageCount - 1}
                  onClick={() => setPageIndex((current) => Math.min(pages.pageCount - 1, current + 1))}
                >
                  <span>Next <ChevronRight /></span>
                </button>
              </div>
            </>
          )}
        </main>
        {readingMode === "webtoon" ? (
          <footer className="reader-footer chapter-navigation">
            <button disabled={chapterPosition >= chapters.length - 1} onClick={() => openAdjacentChapter(1)}>
              <ChevronLeft /> Previous chapter
            </button>
            <span>{pages.chapterName}</span>
            <button disabled={chapterPosition <= 0} onClick={() => openAdjacentChapter(-1)}>
              Next chapter <ChevronRight />
            </button>
          </footer>
        ) : (
          <PagedNavigation mode={readingMode} pageIndex={pageIndex} pageCount={pages.pageCount} setPageIndex={setPageIndex} />
        )}
      </div>
    );

  return (
    <div className="page inner-page manga-browser">
      <div className="page-intro">
        <span className="eyebrow">{bridgeScope === "beta" ? "MANAGED BETA READER" : "LOCAL EXTENSION READER"}</span>
        <h1>Read manga</h1>
        <p>Search approved sources running on {bridgeScope === "beta" ? "the managed Beta Bridge" : "your HAO Bridge"}. HAO’s cloud never receives third-party catalogs, chapters, or pages.</p>
      </div>
      <form className="search-panel manga-search" onSubmit={search}>
        <label>
          <Search />
          <input aria-label="Search manga" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles…" />
        </label>
        <select aria-label="Manga source" value={sourceId} onChange={(event) => changeSource(event.target.value)} disabled={!sources.length}>
          <option value={ALL_SOURCES_ID}>All approved English sources</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.displayName} · {source.language.toUpperCase()}
            </option>
          ))}
        </select>
        <button className="button primary" disabled={Boolean(busy) || !query.trim() || !sourceId}>
          Search
        </button>
      </form>
      {sourceId === ALL_SOURCES_ID ? (
        <p className="source-disclosure">
          <Server /> Unified search checks the healthiest approved sources first and keeps one result per title.
        </p>
      ) : activeSource && (
        <p className="source-disclosure">
          <Server /> Browsing {activeSource.displayName} through {bridgeScope === "beta" ? "the managed Beta Bridge" : "your personal Bridge"}. Use only content you are authorized to access.
        </p>
      )}
      <div className="tabs manga-browse-tabs" aria-label="Browse manga">
        <button className={browseMode === "popular" && !query ? "active" : ""} disabled={Boolean(busy) || sourceId === ALL_SOURCES_ID} onClick={() => void browse("popular")}>
          Popular
        </button>
        <button className={browseMode === "latest" && !query ? "active" : ""} disabled={Boolean(busy) || sourceId === ALL_SOURCES_ID || !activeSource?.supportsLatest} onClick={() => void browse("latest")}>
          Latest updates
        </button>
      </div>
      {searchSummary && <p className="unified-search-summary" role="status">{searchSummary}</p>}
      {busy && <ReaderStatus text={busy} />} {error && <ReaderError text={error} onRetry={() => window.location.reload()} />}
      {results.length > 0 && !selected && (
        <section className="manga-results" aria-label="Manga search results">
          {results.map((item) => (
            <button key={`${item.sourceId}:${item.id}`} className="manga-result" onClick={() => void openTitle(item)}>
              <img src={`${bridge}/v1/manga/${item.id}/thumbnail`} alt="" loading="lazy" />
              <span>
                <b>{item.title}</b>
                <small>{item.author ?? "Unknown author"}{sourceId === ALL_SOURCES_ID ? ` · ${sources.find((source) => source.id === item.sourceId)?.name ?? "Installed source"}` : ""}</small>
              </span>
            </button>
          ))}
        </section>
      )}
      {selected && !pages && (
        <section className="manga-title-panel">
          <button className="button ghost compact" onClick={resetTitle}>
            <ChevronLeft /> Search results
          </button>
          <div className="manga-title-copy">
            <img src={`${bridge}/v1/manga/${selected.id}/thumbnail`} alt="" />
            <div>
              <span className="eyebrow">{selected.status?.replaceAll("_", " ") ?? "MANGA"}</span>
              <h2>{selected.title}</h2>
              <p>{selected.description ?? "No description supplied by this source."}</p>
              {selected.genres.length > 0 && (
                <div className="genre-row">
                  {selected.genres.slice(0, 8).map((genre) => (
                    <span key={genre}>{genre}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="chapter-list">
            <div className="chapter-list-head">
              <div>
                <h3>Chapters</h3>
                <small>{filteredChapters.length === chapters.length ? `${chapters.length} available` : `${filteredChapters.length} of ${chapters.length}`}</small>
              </div>
              {chapters.length > 12 && (
                <label className="chapter-search">
                  <Search />
                  <input value={chapterQuery} onChange={(event) => { setChapterQuery(event.target.value); setVisibleChapterCount(50); }} placeholder="Find a chapter" aria-label="Find a chapter" />
                </label>
              )}
            </div>
            {filteredChapters.slice(0, visibleChapterCount).map((chapter) => (
              <button key={chapter.id} onClick={() => void openChapter(chapter)}>
                <BookOpen />
                <span>
                  <b>{chapter.name}</b>
                  <small>
                    {chapter.scanlator ?? "Source release"}
                    {chapter.pageCount > 0 ? ` · ${chapter.pageCount} pages` : ""}
                  </small>
                </span>
                <ChevronRight />
              </button>
            ))}
            {filteredChapters.length > visibleChapterCount && (
              <button className="chapter-show-more" onClick={() => setVisibleChapterCount((count) => count + 50)}>
                Show {Math.min(50, filteredChapters.length - visibleChapterCount)} more chapters
              </button>
            )}
            {!filteredChapters.length && <p className="chapter-filter-empty">No chapters match “{chapterQuery}”.</p>}
          </div>
        </section>
      )}
      {!busy && !error && !results.length && !selected && (
        <div className="empty-state">
          <BookOpen />
          <h2>Browse your installed manga source</h2>
          <p>Choose Popular, Latest updates, or search for a title.</p>
        </div>
      )}
    </div>
  );
}

function ReaderStatus({ text }: { text: string }) {
  return (
    <p className="reader-message" role="status">
      <LoaderCircle className="spin" /> {text}
    </p>
  );
}
function ReaderError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <p className="reader-message error" role="alert">
      <TriangleAlert /> <span>{text}</span>
      <button className="button ghost compact" onClick={onRetry}><RefreshCw /> Retry</button>
      <Link className="button ghost compact" href="/settings"><Server /> Source status</Link>
    </p>
  );
}
function message(cause: unknown) {
  return bridgeErrorMessage(cause, "The manga source could not complete this request.");
}

function PagedNavigation({ mode, pageIndex, pageCount, setPageIndex }: { mode: ReadingMode; pageIndex: number; pageCount: number; setPageIndex: (value: number) => void }) {
  const previous =
    mode === "rtl" ? (
      <button disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>
        Previous page <ChevronRight />
      </button>
    ) : (
      <button disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>
        <ChevronLeft /> Previous page
      </button>
    );
  const next =
    mode === "rtl" ? (
      <button disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex(pageIndex + 1)}>
        <ChevronLeft /> Next page
      </button>
    ) : (
      <button disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex(pageIndex + 1)}>
        Next page <ChevronRight />
      </button>
    );
  return (
    <footer className={`reader-footer page-navigation ${mode}`}>
      {mode === "rtl" ? next : previous}
      <span>
        Page {pageIndex + 1} of {pageCount}
      </span>
      {mode === "rtl" ? previous : next}
    </footer>
  );
}
