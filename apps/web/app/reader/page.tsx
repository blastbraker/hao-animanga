"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Search, Server, TriangleAlert } from "lucide-react";
import { bridgeErrorMessage, bridgeJson, getActiveBridge } from "../../lib/api";
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
type BrowseMode = "popular" | "latest";
type ReadingMode = "webtoon" | "ltr" | "rtl";

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
  const [pages, setPages] = useState<MangaChapterPages | null>(null);
  const [readingMode, setReadingMode] = useState<ReadingMode>("webtoon");
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState("Connecting to HAO Bridge…");
  const [error, setError] = useState("");

  const activeSource = useMemo(() => sources.find((source) => source.id === sourceId), [sourceId, sources]);
  const currentChapter = useMemo(() => chapters.find((chapter) => chapter.index === pages?.chapterIndex), [chapters, pages]);
  const chapterPosition = currentChapter ? chapters.indexOf(currentChapter) : -1;

  useEffect(() => {
    const saved = window.localStorage.getItem("hao:manga-reading-mode");
    if (saved === "webtoon" || saved === "ltr" || saved === "rtl") setReadingMode(saved);
  }, []);

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

  async function bridgeRequest<T>(path: string, endpoint = bridge): Promise<T> {
    return bridgeJson<T>(endpoint, path);
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
        const requestedMode: BrowseMode = parameters.get("mode") === "latest" ? "latest" : "popular";
        setBridge(endpoint);
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
          const details = normalizeMangaSummary(detailsPayload, fallback);
          const chapterList = normalizeMangaChapters(chapterPayload);
          setSelected(details);
          setChapters(chapterList);
          if (!chapterList.length) setError(`No readable ${preferred.language.toUpperCase()} chapters are available from ${preferred.name} for this title.`);
          const requestedChapter = chapterList.find((chapter) => chapter.index === requestedChapterIndex);
          if (requestedChapter) {
            const chapterPages = normalizeMangaChapterPages(await bridgeRequest<unknown>(`/v1/manga/${requestedMangaId}/chapter/${requestedChapter.index}/pages`, endpoint));
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
    setBusy("Searching your local source…");
    setError("");
    setSelected(null);
    setChapters([]);
    setPages(null);
    try {
      const response = normalizeMangaSearchResponse(await bridgeRequest<unknown>(`/v1/manga/search?sourceId=${encodeURIComponent(sourceId)}&query=${encodeURIComponent(query.trim())}&page=1`));
      setResults(response.items);
      if (!response.items.length) setError("No titles matched that search in this source.");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy("");
    }
  }

  async function browse(mode: BrowseMode, nextSourceId = sourceId) {
    if (!nextSourceId) return;
    setBrowseMode(mode);
    setQuery("");
    setBusy(`Loading ${mode} titles…`);
    setError("");
    setSelected(null);
    setChapters([]);
    setPages(null);
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
    setSourceId(nextSourceId);
    void browse(browseMode, nextSourceId);
  }

  async function openTitle(item: MangaSummary) {
    setSelected(item);
    setPages(null);
    setBusy("Loading chapters…");
    setError("");
    try {
      const [detailsPayload, chapterPayload] = await Promise.all([bridgeRequest<unknown>(`/v1/manga/${item.id}`), bridgeRequest<unknown>(`/v1/manga/${item.id}/chapters`)]);
      const details = normalizeMangaSummary(detailsPayload, item);
      const chapterList = normalizeMangaChapters(chapterPayload);
      setSelected(details);
      setChapters(chapterList);
      if (!chapterList.length) setError(`No readable ${activeSource?.language.toUpperCase() ?? "selected-language"} chapters are available from ${activeSource?.name ?? "this source"} for this title. Try another result or source.`);
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
            <span>{pages.chapterName}</span>
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
      {activeSource && (
        <p className="source-disclosure">
          <Server /> Browsing {activeSource.displayName} through {bridgeScope === "beta" ? "the managed Beta Bridge" : "your personal Bridge"}. Use only content you are authorized to access.
        </p>
      )}
      <div className="tabs manga-browse-tabs" aria-label="Browse manga">
        <button className={browseMode === "popular" && !query ? "active" : ""} disabled={Boolean(busy)} onClick={() => void browse("popular")}>
          Popular
        </button>
        <button className={browseMode === "latest" && !query ? "active" : ""} disabled={Boolean(busy) || !activeSource?.supportsLatest} onClick={() => void browse("latest")}>
          Latest updates
        </button>
      </div>
      {busy && <ReaderStatus text={busy} />} {error && <ReaderError text={error} onRetry={() => window.location.reload()} />}
      {results.length > 0 && !selected && (
        <section className="manga-results" aria-label="Manga search results">
          {results.map((item) => (
            <button key={item.id} className="manga-result" onClick={() => void openTitle(item)}>
              <img src={`${bridge}/v1/manga/${item.id}/thumbnail`} alt="" loading="lazy" />
              <span>
                <b>{item.title}</b>
                <small>{item.author ?? "Unknown author"}</small>
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
            <h3>Chapters</h3>
            {chapters.map((chapter) => (
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
