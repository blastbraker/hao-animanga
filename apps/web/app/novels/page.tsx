"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import {
  BookOpenText,
  ChevronRight,
  FileUp,
  LibraryBig,
  Search,
  Server,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { MediaCard } from "../../components/media-card";
import {
  api,
  bridgeErrorMessage,
  bridgeJson,
  getActiveBridge,
} from "../../lib/api";
import {
  normalizeNovelChapters,
  normalizeNovelSearch,
  normalizeNovelSources,
  normalizeNovelSummary,
  type NovelChapter,
  type NovelSource,
  type NovelSummary,
} from "../../lib/novel-response";
import { filterNovelChapters } from "../../lib/novel-reader";
import {
  blendNovelRankings,
  confidentNovelSourceMatch,
  novelSourceSearchQueries,
} from "../../lib/novel-catalog";
import { sourceFallbackOrder } from "../../lib/source-match";
import {
  NOVEL_MATCHES_KEY,
  NOVEL_RESUMES_KEY,
  forgetNovelMatch,
  novelMatchKey,
  parseNovelMatches,
  parseNovelResumes,
  rememberNovelMatch,
  type NovelResume,
} from "../../lib/novel-state";

const GENRES = ["Fantasy", "Romance", "Adventure", "Drama", "Comedy"] as const;
type Shelf = "POPULAR" | "RELEASING" | "NEW";
type SourceMode = "popular" | "latest" | "search";
type UploadResult = {
  filename: string;
  manifest: { title?: string; creator?: string; chapters?: unknown[] };
  work?: Work;
};

export default function NovelsPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [shelf, setShelf] = useState<Shelf>("POPULAR");
  const [items, setItems] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [bridge, setBridge] = useState("");
  const [bridgeScope, setBridgeScope] = useState<"personal" | "beta">(
    "personal",
  );
  const [sources, setSources] = useState<NovelSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("popular");
  const [sourceQuery, setSourceQuery] = useState("");
  const [submittedSourceQuery, setSubmittedSourceQuery] = useState("");
  const [sourceItems, setSourceItems] = useState<NovelSummary[]>([]);
  const [sourceBusy, setSourceBusy] = useState(
    "Connecting to your novel sources…",
  );
  const [sourceError, setSourceError] = useState("");
  const [selected, setSelected] = useState<NovelSummary | null>(null);
  const [chapters, setChapters] = useState<NovelChapter[]>([]);
  const [chapterQuery, setChapterQuery] = useState("");
  const [visibleChapters, setVisibleChapters] = useState(60);
  const [continueReading, setContinueReading] = useState<NovelResume[]>([]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === sourceId) ?? null,
    [sourceId, sources],
  );
  const openedSource = useMemo(
    () =>
      sources.find((source) => source.id === selected?.sourceId) ??
      selectedSource,
    [selected, selectedSource, sources],
  );
  const filteredChapters = useMemo(
    () => filterNovelChapters(chapters, chapterQuery),
    [chapterQuery, chapters],
  );
  const blendedItems = useMemo(
    () => blendNovelRankings(items, sourceItems, 3),
    [items, sourceItems],
  );

  useEffect(() => {
    setContinueReading(parseNovelResumes(window.localStorage.getItem(NOVEL_RESUMES_KEY)).slice(0, 10));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const parameters = new URLSearchParams({
      q: submittedQuery,
      kind: "LIGHT_NOVEL",
      pageSize: "30",
      maturity: "GENERAL",
    });
    if (genre) parameters.set("genre", genre);
    if (shelf === "RELEASING") parameters.set("status", "RELEASING");
    if (shelf === "NEW")
      parameters.set("year", String(new Date().getFullYear()));
    try {
      const result = await api<{ items: Work[] }>(
        `/search?${parameters.toString()}`,
      );
      setItems(result.items);
    } catch (cause) {
      setItems([]);
      setError(
        cause instanceof Error
          ? cause.message
          : "The light-novel catalog is temporarily unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [genre, shelf, submittedQuery]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    void getActiveBridge()
      .then(async (access) => {
        if (cancelled) return;
        setBridge(access.endpoint);
        setBridgeScope(access.scope);
        const result = normalizeNovelSources(
          await bridgeJson<unknown>(access.endpoint, "/v1/novel/sources"),
        );
        if (cancelled) return;
        setSources(result);
        setSourceId((current) => current || result[0]?.id || "");
        setSourceBusy("");
      })
      .catch((cause) => {
        if (!cancelled) {
          setSourceBusy("");
          setSourceError(
            bridgeErrorMessage(cause, "Novel sources are unavailable."),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bridge || !sourceId) return;
    let cancelled = false;
    setSourceBusy(
      sourceMode === "search"
        ? "Searching this source…"
        : "Opening this source…",
    );
    setSourceError("");
    setSelected(null);
    setChapters([]);
    const params = new URLSearchParams({
      sourceId,
      mode: sourceMode,
      page: "1",
    });
    if (sourceMode === "search") params.set("query", submittedSourceQuery);
    void bridgeJson<unknown>(bridge, `/v1/novel/catalog?${params.toString()}`)
      .then((payload) => {
        if (!cancelled) setSourceItems(normalizeNovelSearch(payload).items);
      })
      .catch((cause) => {
        if (!cancelled) {
          setSourceItems([]);
          setSourceError(
            bridgeErrorMessage(cause, "This novel source could not be opened."),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSourceBusy("");
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, sourceId, sourceMode, submittedSourceQuery]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadMessage("");
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api<UploadResult>("/epubs", {
        method: "POST",
        body,
      });
      if (result.work)
        setItems((current) => [
          result.work!,
          ...current.filter((item) => item.id !== result.work!.id),
        ]);
      const chapterCount = result.manifest.chapters?.length ?? 0;
      setUploadMessage(
        `${result.manifest.title || result.filename} is ready${chapterCount ? ` with ${chapterCount} chapters` : ""}.`,
      );
    } catch (cause) {
      setUploadMessage(
        cause instanceof Error
          ? cause.message
          : "The EPUB could not be uploaded.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function searchSource() {
    const next = sourceQuery.trim();
    if (!next) return;
    setSourceMode("search");
    setSubmittedSourceQuery(next);
  }

  async function openNovel(item: NovelSummary): Promise<boolean> {
    if (!bridge) return false;
    setSourceBusy(`Loading ${item.title}…`);
    setSourceError("");
    setVisibleChapters(60);
    setChapterQuery("");
    try {
      const encoded = encodeURIComponent(item.id);
      const [detailPayload, chapterPayload] = await Promise.all([
        bridgeJson<unknown>(bridge, `/v1/novel/${encoded}`),
        bridgeJson<unknown>(bridge, `/v1/novel/${encoded}/chapters`),
      ]);
      setSelected(normalizeNovelSummary(detailPayload) ?? item);
      setChapters(normalizeNovelChapters(chapterPayload));
      return true;
    } catch (cause) {
      setSelected(item);
      setChapters([]);
      setSourceError(
        bridgeErrorMessage(cause, "This novel could not be loaded."),
      );
      return false;
    } finally {
      setSourceBusy("");
    }
  }

  async function openAnilistNovel(work: Work) {
    if (!bridge) return;
    setSourceBusy(`Finding readable chapters for ${work.title}...`);
    setSourceError("");
    setSelected(null);
    setChapters([]);

    const matchKey = novelMatchKey(
      work.source.kind === "ANILIST" ? work.source.externalId : undefined,
      work.title,
    );
    const remembered = parseNovelMatches(window.localStorage.getItem(NOVEL_MATCHES_KEY));
    const savedMatch = remembered.find((item) => item.key === matchKey);
    if (savedMatch) {
      if (await openNovel(savedMatch.novel)) return;
      window.localStorage.setItem(NOVEL_MATCHES_KEY, JSON.stringify(forgetNovelMatch(remembered, matchKey)));
      setSourceError("");
    }

    const visibleMatch = confidentNovelSourceMatch(work, sourceItems);
    if (visibleMatch) {
      if (await openNovel(visibleMatch)) {
        window.localStorage.setItem(NOVEL_MATCHES_KEY, JSON.stringify(rememberNovelMatch(remembered, matchKey, visibleMatch)));
        return;
      }
    }

    const queries = novelSourceSearchQueries(work).slice(0, 6);

    for (const source of sourceFallbackOrder(sources, sourceId)) {
      for (const sourceQuery of queries) {
        const parameters = new URLSearchParams({
          sourceId: source.id,
          mode: "search",
          query: sourceQuery,
          page: "1",
        });
        try {
          const result = normalizeNovelSearch(
            await bridgeJson<unknown>(
              bridge,
              `/v1/novel/catalog?${parameters.toString()}`,
            ),
          );
          const match = confidentNovelSourceMatch(work, result.items);
          if (match) {
            if (await openNovel(match)) {
              window.localStorage.setItem(NOVEL_MATCHES_KEY, JSON.stringify(rememberNovelMatch(remembered, matchKey, match)));
              return;
            }
          }
        } catch {
          // A failed source must not prevent the remaining installed sources
          // from being checked for this title.
        }
      }
    }

    setSourceBusy("");
    setSourceError(
      `No readable installed match was found for ${work.title}. Try another title or source.`,
    );
  }

  function readerHref(chapter: NovelChapter) {
    const parameters = new URLSearchParams({
      sourceId: chapter.sourceId,
      novelId: chapter.novelId,
      chapterId: chapter.id,
      chapterIndex: String(chapter.index),
      title: selected?.title ?? "Novel",
    });
    return `/novels/read?${parameters.toString()}`;
  }

  return (
    <div className="page inner-page novels-page">
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".epub,application/epub+zip"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      {uploadMessage && (
        <p className="novel-upload-status" role="status">
          {uploadMessage}
        </p>
      )}

      {continueReading.length > 0 && (
        <section className="content-block novel-continue-section">
          <div className="section-head">
            <div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Continue reading</h2></div>
            <Link href="/library">My library <ChevronRight /></Link>
          </div>
          <div className="novel-continue-row">
            {continueReading.map((item) => (
              <Link href={item.href} className="novel-continue-card" key={item.id}>
                {item.coverUrl ? <img src={item.coverUrl} alt="" /> : <span className="novel-cover-placeholder"><BookOpenText /></span>}
                <div><small>{Math.round(item.progressPercent)}% read</small><b>{item.title}</b><p>{item.chapterTitle}</p><i><span style={{ width: `${item.progressPercent}%` }} /></i></div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section
        className="novel-extension-catalog"
        aria-labelledby="source-novels-heading"
      >
        <div className="discover-results-heading">
          <div>
            <span className="eyebrow">
              <Server />{" "}
              {bridgeScope === "beta"
                ? "SHARED BETA BRIDGE"
                : "YOUR HAO BRIDGE"}
            </span>
            <h2 id="source-novels-heading">Light novel rankings</h2>
            <p className="novel-ranking-intro">
              Three AniList favorites, then three readable titles from your
              selected source.
            </p>
          </div>
          <div className="novel-heading-actions">
            {selectedSource && (
              <span>
                {selectedSource.name} · {selectedSource.language.toUpperCase()}
              </span>
            )}
            <button
              className="button ghost novel-upload-action"
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <FileUp /> {uploading ? "Checking EPUB…" : "Upload EPUB"}
            </button>
          </div>
        </div>
        {sources.length ? (
          <>
            <div className="novel-source-controls">
              <select
                aria-label="Novel source"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                {sources.map((source) => (
                  <option value={source.id} key={source.id}>
                    {source.name} · {source.language.toUpperCase()}
                  </option>
                ))}
              </select>
              <div className="novel-source-modes">
                <button
                  className={sourceMode === "popular" ? "active" : ""}
                  onClick={() => setSourceMode("popular")}
                >
                  Popular
                </button>
                <button
                  className={sourceMode === "latest" ? "active" : ""}
                  disabled={!selectedSource?.supportsLatest}
                  onClick={() => setSourceMode("latest")}
                >
                  Latest
                </button>
              </div>
              <label>
                <Search />
                <input
                  aria-label="Search selected novel source"
                  value={sourceQuery}
                  onChange={(event) => setSourceQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && searchSource()}
                  placeholder={`Search ${selectedSource?.name ?? "source"}…`}
                />
              </label>
              <button className="button primary" onClick={searchSource}>
                <Search /> Search
              </button>
            </div>
            <div className="novel-discovery-controls">
              <div className="novel-search">
                <label>
                  <Search />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) =>
                      event.key === "Enter" && setSubmittedQuery(query.trim())
                    }
                    placeholder="Search AniList light novels..."
                  />
                </label>
                <button
                  className="button primary"
                  onClick={() => setSubmittedQuery(query.trim())}
                >
                  <Search /> Search AniList
                </button>
              </div>
              <div className="novel-filter-bar">
                <div className="novel-shelves" aria-label="Novel shelf">
                  {(
                    [
                      ["POPULAR", "Popular"],
                      ["RELEASING", "Releasing"],
                      ["NEW", "New this year"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={shelf === value ? "active" : ""}
                      aria-pressed={shelf === value}
                      onClick={() => setShelf(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label>
                  <Settings2 />
                  <select
                    aria-label="Novel genre"
                    value={genre}
                    onChange={(event) => setGenre(event.target.value)}
                  >
                    <option value="">All genres</option>
                    {GENRES.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {sourceBusy && (
              <p className="novel-source-status" role="status">
                {sourceBusy}
              </p>
            )}
            {sourceError && (
              <p className="novel-source-status error" role="alert">
                {sourceError}
              </p>
            )}
            {!selected && (
              <>
                <div className="discover-results-heading novel-blended-heading">
                  <div>
                    <span className="eyebrow">BLENDED DISCOVERY</span>
                    <h2>
                      {submittedQuery || sourceMode === "search"
                        ? "Combined search results"
                        : "Popular across AniList and your source"}
                    </h2>
                  </div>
                  <span>
                    {items.length} AniList / {sourceItems.length}{" "}
                    {selectedSource?.name ?? "source"}
                  </span>
                </div>
                {loading && !blendedItems.length ? (
                  <div className="empty-state">Opening the shelves...</div>
                ) : error && !sourceItems.length ? (
                  <div className="empty-state">
                    <BookOpenText />
                    <h2>Catalog unavailable</h2>
                    <p>{error}</p>
                    <button
                      className="button ghost"
                      onClick={() => void load()}
                    >
                      Retry
                    </button>
                  </div>
                ) : blendedItems.length ? (
                  <div className="catalog-grid novel-blended-grid">
                    {blendedItems.map((entry) =>
                      entry.kind === "anilist" ? (
                        <button
                          className="novel-source-card"
                          key={`anilist:${entry.item.id}`}
                          onClick={() => void openAnilistNovel(entry.item)}
                        >
                          {entry.item.coverUrl ? (
                            <img
                              src={entry.item.coverUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="novel-cover-placeholder">
                              <BookOpenText />
                            </span>
                          )}
                          <span>
                            <b>{entry.item.title}</b>
                            <small>
                              Find chapters <ChevronRight />
                            </small>
                          </span>
                        </button>
                      ) : (
                        <button
                          key={`source:${entry.item.id}`}
                          className="novel-source-card"
                          onClick={() => void openNovel(entry.item)}
                        >
                          {entry.item.imageUrl ? (
                            <img
                              src={entry.item.imageUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="novel-cover-placeholder">
                              <BookOpenText />
                            </span>
                          )}
                          <span>
                            <b>{entry.item.title}</b>
                            <small>
                              Read chapters <ChevronRight />
                            </small>
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                ) : (
                  !sourceBusy &&
                  !sourceError && (
                    <div className="empty-state">
                      <LibraryBig />
                      <h2>No light novels returned</h2>
                      <p>Try another ranking, search, genre, or source.</p>
                    </div>
                  )
                )}
              </>
            )}
            {selected && (
              <div className="novel-detail-panel">
                <button
                  className="novel-back"
                  onClick={() => {
                    setSelected(null);
                    setChapters([]);
                    setChapterQuery("");
                  }}
                >
                  ← Back to source
                </button>
                <div className="novel-detail-copy">
                  {selected.imageUrl ? (
                    <img src={selected.imageUrl} alt="" />
                  ) : (
                    <span className="novel-cover-placeholder">
                      <BookOpenText />
                    </span>
                  )}
                  <div>
                    <span className="eyebrow">{openedSource?.name}</span>
                    <h2>{selected.title}</h2>
                    {selected.author && (
                      <p className="novel-author">by {selected.author}</p>
                    )}
                    <p>
                      {selected.description ||
                        "No description supplied by this source."}
                    </p>
                    {selected.genres.length > 0 && (
                      <div className="novel-genres">
                        {selected.genres.map((value) => (
                          <span key={value}>{value}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="novel-chapter-list">
                  <div>
                    <h3>Chapters</h3>
                    <small>
                      {chapterQuery
                        ? `${filteredChapters.length.toLocaleString()} of ${chapters.length.toLocaleString()}`
                        : `${chapters.length.toLocaleString()} available`}
                    </small>
                  </div>
                  <label className="novel-chapter-filter">
                    <Search />
                    <input
                      type="search"
                      value={chapterQuery}
                      placeholder="Search chapter title or number…"
                      onChange={(event) => {
                        setChapterQuery(event.target.value);
                        setVisibleChapters(60);
                      }}
                    />
                  </label>
                  {filteredChapters.slice(0, visibleChapters).map((chapter) => (
                    <Link href={readerHref(chapter)} key={chapter.id}>
                      <span>{chapter.index + 1}</span>
                      <b>{chapter.title}</b>
                      <ChevronRight />
                    </Link>
                  ))}
                  {filteredChapters.length > visibleChapters && (
                    <button
                      onClick={() => setVisibleChapters((value) => value + 100)}
                    >
                      Show{" "}
                      {Math.min(100, filteredChapters.length - visibleChapters)}{" "}
                      more chapters
                    </button>
                  )}
                  {!sourceBusy && filteredChapters.length === 0 && (
                    <p>
                      {chapterQuery
                        ? `No chapters match “${chapterQuery}”.`
                        : "No readable chapters were returned by this source."}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          !sourceBusy && (
            <div className="empty-state">
              <Server />
              <h2>No novel source is installed</h2>
              <p>
                Ask the beta administrator to review and install a JavaScript
                novel source from Settings.
              </p>
              <Link className="button ghost" href="/settings">
                Open Settings
              </Link>
            </div>
          )
        )}
      </section>

      {!sourceBusy && !sources.length && (
        <section
          className="novel-catalog"
          aria-labelledby="novel-catalog-heading"
        >
          <div className="novel-search">
            <label>
              <Search />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && setSubmittedQuery(query.trim())
                }
                placeholder="Search light novels…"
              />
            </label>
            <button
              className="button primary"
              onClick={() => setSubmittedQuery(query.trim())}
            >
              <Search /> Search
            </button>
          </div>
          <div className="novel-filter-bar">
            <div className="novel-shelves" aria-label="Novel shelf">
              {(
                [
                  ["POPULAR", "Popular"],
                  ["RELEASING", "Releasing"],
                  ["NEW", "New this year"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={shelf === value ? "active" : ""}
                  aria-pressed={shelf === value}
                  onClick={() => setShelf(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              <Settings2 />
              <select
                aria-label="Novel genre"
                value={genre}
                onChange={(event) => setGenre(event.target.value)}
              >
                <option value="">All genres</option>
                {GENRES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="discover-results-heading">
            <div>
              <span className="eyebrow">ANILIST NOVEL DISCOVERY</span>
              <h2 id="novel-catalog-heading">
                {submittedQuery
                  ? `Results for “${submittedQuery}”`
                  : shelf === "POPULAR"
                    ? "Popular light novels"
                    : shelf === "RELEASING"
                      ? "Currently releasing"
                      : "New this year"}
              </h2>
            </div>
            {!loading && <span>{items.length} titles</span>}
          </div>
          {loading ? (
            <div className="empty-state">Opening the shelves…</div>
          ) : error ? (
            <div className="empty-state">
              <BookOpenText />
              <h2>Catalog unavailable</h2>
              <p>{error}</p>
              <button className="button ghost" onClick={() => void load()}>
                Retry
              </button>
            </div>
          ) : items.length ? (
            <div className="catalog-grid">
              {items.map((work) => (
                <MediaCard key={work.id} work={work} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Search />
              <h2>No light novels found</h2>
              <p>Try another title, shelf, or genre.</p>
            </div>
          )}
        </section>
      )}
      <aside className="novel-source-note">
        <ShieldCheck />
        <div>
          <b>Source code stays on your Bridge</b>
          <span>
            Third-party novel sources run in an isolated local process. HAO
            sanitizes chapter markup before it reaches the reader.
          </span>
        </div>
      </aside>
    </div>
  );
}
