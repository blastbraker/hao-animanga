"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, LoaderCircle, Search, Server, TriangleAlert } from "lucide-react";
import { api } from "../../lib/api";

type BridgeDevice = { endpoint: string; revokedAt: string | null };
type MangaSource = { id: string; name: string; displayName: string; language: string; mature: boolean; supportsLatest: boolean };
type MangaSummary = { id: number; sourceId: string; title: string; author?: string; description?: string; status?: string; genres: string[] };
type MangaSearchResponse = { items: MangaSummary[]; hasNextPage: boolean };
type MangaChapter = { id: number; index: number; name: string; number: number; scanlator?: string; uploadDate: number; read: boolean; lastPageRead: number; pageCount: number };
type MangaChapterPages = { mangaId: number; chapterIndex: number; chapterName: string; pageCount: number; pageUrls: string[] };
type BrowseMode = "popular" | "latest";
type ReadingMode = "webtoon" | "ltr" | "rtl";

export default function ReaderPage() {
  const [bridge, setBridge] = useState("");
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
  const [busy, setBusy] = useState("Connecting to your Bridge…");
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

  async function bridgeRequest<T>(path: string): Promise<T> {
    if (!bridge) throw new Error("Pair HAO Bridge in Settings first.");
    const response = await fetch(`${bridge}${path}`);
    const payload = await response.json().catch(() => null) as ({ message?: string } & T) | null;
    if (!response.ok) throw new Error(payload?.message ?? `Bridge returned ${response.status}`);
    return payload as T;
  }

  useEffect(() => {
    let cancelled = false;
    void api<{ items: BridgeDevice[] }>("/bridges").then(async ({ items }) => {
      const endpoint = items.find((item) => !item.revokedAt)?.endpoint?.replace(/\/$/, "");
      if (!endpoint) throw new Error("Pair HAO Bridge in Settings before browsing manga.");
      setBridge(endpoint);
      const response = await fetch(`${endpoint}/v1/manga/sources`);
      const payload = await response.json().catch(() => null) as (MangaSource[] & { message?: string }) | null;
      if (!response.ok) throw new Error(payload?.message ?? `Bridge returned ${response.status}`);
      if (!payload?.length) throw new Error("No manga sources are available. Install and enable a Mihon extension first.");
      if (cancelled) return;
      setSources(payload);
      const preferred = payload.find((source) => source.name === "MangaDex" && source.language === "en") ?? payload.find((source) => source.language === "en") ?? payload[0]!;
      setSourceId(preferred.id);
      const catalogResponse = await fetch(`${endpoint}/v1/manga/browse?sourceId=${encodeURIComponent(preferred.id)}&mode=popular&page=1`);
      const catalog = await catalogResponse.json().catch(() => null) as (MangaSearchResponse & { message?: string }) | null;
      if (!catalogResponse.ok) throw new Error(catalog?.message ?? `Bridge returned ${catalogResponse.status}`);
      if (cancelled) return;
      setResults(catalog?.items ?? []);
      setBusy("");
    }).catch((cause: unknown) => {
      if (!cancelled) { setBusy(""); setError(cause instanceof Error ? cause.message : "Could not connect to HAO Bridge."); }
    });
    return () => { cancelled = true; };
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!sourceId || !query.trim()) return;
    setBusy("Searching your local source…"); setError(""); setSelected(null); setChapters([]); setPages(null);
    try {
      const response = await bridgeRequest<MangaSearchResponse>(`/v1/manga/search?sourceId=${encodeURIComponent(sourceId)}&query=${encodeURIComponent(query.trim())}&page=1`);
      setResults(response.items);
      if (!response.items.length) setError("No titles matched that search in this source.");
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
  }

  async function browse(mode: BrowseMode, nextSourceId = sourceId) {
    if (!nextSourceId) return;
    setBrowseMode(mode); setQuery(""); setBusy(`Loading ${mode} titles…`); setError(""); setSelected(null); setChapters([]); setPages(null);
    try {
      const response = await bridgeRequest<MangaSearchResponse>(`/v1/manga/browse?sourceId=${encodeURIComponent(nextSourceId)}&mode=${mode}&page=1`);
      setResults(response.items);
      if (!response.items.length) setError(`This source did not return any ${mode} titles.`);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
  }

  function changeSource(nextSourceId: string) {
    setSourceId(nextSourceId);
    void browse(browseMode, nextSourceId);
  }

  async function openTitle(item: MangaSummary) {
    setSelected(item); setResults([]); setPages(null); setBusy("Loading chapters…"); setError("");
    try {
      const [details, chapterList] = await Promise.all([
        bridgeRequest<MangaSummary>(`/v1/manga/${item.id}`),
        bridgeRequest<MangaChapter[]>(`/v1/manga/${item.id}/chapters`),
      ]);
      setSelected(details); setChapters(chapterList);
      if (!chapterList.length) setError(`No readable ${activeSource?.language.toUpperCase() ?? "selected-language"} chapters are available from ${activeSource?.name ?? "this source"} for this title. Try another result or source.`);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
  }

  async function openChapter(chapter: MangaChapter) {
    if (!selected) return;
    setBusy(`Loading ${chapter.name}…`); setError("");
    try {
      setPages(await bridgeRequest<MangaChapterPages>(`/v1/manga/${selected.id}/chapter/${chapter.index}/pages`));
      setPageIndex(0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
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

  function resetTitle() { setSelected(null); setChapters([]); setPages(null); setError(""); }

  if (pages && selected) return <div className="reader-page live-reader">
    <header className="reader-toolbar">
      <button onClick={()=>setPages(null)}><ChevronLeft/> Chapters</button>
      <div><b>{selected.title}</b><span>{pages.chapterName}</span></div>
      <div className="reader-mode-controls"><select aria-label="Reading mode" value={readingMode} onChange={(event)=>changeReadingMode(event.target.value as ReadingMode)}><option value="webtoon">Webtoon</option><option value="ltr">Left to right</option><option value="rtl">Right to left</option></select><span>{readingMode === "webtoon" ? `${pages.pageCount} pages` : `${pageIndex + 1} / ${pages.pageCount}`}</span></div>
    </header>
    {busy && <ReaderStatus text={busy}/>} {error && <ReaderError text={error}/>}
    <main className={`manga-pages ${readingMode === "webtoon" ? "webtoon" : "paged"}`} dir={readingMode === "rtl" ? "rtl" : "ltr"} aria-label={`${selected.title}, ${pages.chapterName}`}>
      {readingMode === "webtoon" ? pages.pageUrls.map((url, index)=><img key={url} loading={index < 2 ? "eager" : "lazy"} src={`${bridge}${url}`} alt={`Page ${index + 1} of ${pages.pageCount}`}/>) : <img key={pages.pageUrls[pageIndex]} src={`${bridge}${pages.pageUrls[pageIndex]}`} alt={`Page ${pageIndex + 1} of ${pages.pageCount}`}/>}
    </main>
    {readingMode === "webtoon" ? <footer className="reader-footer chapter-navigation">
      <button disabled={chapterPosition >= chapters.length - 1} onClick={()=>openAdjacentChapter(1)}><ChevronLeft/> Previous chapter</button><span>{pages.chapterName}</span><button disabled={chapterPosition <= 0} onClick={()=>openAdjacentChapter(-1)}>Next chapter <ChevronRight/></button>
    </footer> : <PagedNavigation mode={readingMode} pageIndex={pageIndex} pageCount={pages.pageCount} setPageIndex={setPageIndex}/>}
  </div>;

  return <div className="page inner-page manga-browser">
    <div className="page-intro"><span className="eyebrow">LOCAL EXTENSION READER</span><h1>Read manga</h1><p>Search sources running on your HAO Bridge. HAO’s cloud never receives third-party catalogs, chapters, or pages.</p></div>
    <form className="search-panel manga-search" onSubmit={search}>
      <label><Search/><input aria-label="Search manga" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search titles…"/></label>
      <select aria-label="Manga source" value={sourceId} onChange={(event)=>changeSource(event.target.value)} disabled={!sources.length}>
        {sources.map((source)=><option key={source.id} value={source.id}>{source.displayName} · {source.language.toUpperCase()}</option>)}
      </select>
      <button className="button primary" disabled={Boolean(busy) || !query.trim() || !sourceId}>Search</button>
    </form>
    {activeSource && <p className="source-disclosure"><Server/> Browsing {activeSource.displayName} through your local Bridge. Use only content you are authorized to access.</p>}
    <div className="tabs manga-browse-tabs" aria-label="Browse manga">
      <button className={browseMode === "popular" && !query ? "active" : ""} disabled={Boolean(busy)} onClick={()=>void browse("popular")}>Popular</button>
      <button className={browseMode === "latest" && !query ? "active" : ""} disabled={Boolean(busy) || !activeSource?.supportsLatest} onClick={()=>void browse("latest")}>Latest updates</button>
    </div>
    {busy && <ReaderStatus text={busy}/>} {error && <ReaderError text={error}/>}

    {results.length > 0 && <section className="manga-results" aria-label="Manga search results">{results.map((item)=><button key={item.id} className="manga-result" onClick={()=>void openTitle(item)}>
      <img src={`${bridge}/v1/manga/${item.id}/thumbnail`} alt="" loading="lazy"/>
      <span><b>{item.title}</b><small>{item.author ?? "Unknown author"}</small></span>
    </button>)}</section>}

    {selected && !pages && <section className="manga-title-panel">
      <button className="button ghost compact" onClick={resetTitle}><ChevronLeft/> Search results</button>
      <div className="manga-title-copy"><img src={`${bridge}/v1/manga/${selected.id}/thumbnail`} alt=""/><div><span className="eyebrow">{selected.status?.replaceAll("_", " ") ?? "MANGA"}</span><h2>{selected.title}</h2><p>{selected.description ?? "No description supplied by this source."}</p>{selected.genres.length > 0 && <div className="genre-row">{selected.genres.slice(0,8).map((genre)=><span key={genre}>{genre}</span>)}</div>}</div></div>
      <div className="chapter-list"><h3>Chapters</h3>{chapters.map((chapter)=><button key={chapter.id} onClick={()=>void openChapter(chapter)}><BookOpen/><span><b>{chapter.name}</b><small>{chapter.scanlator ?? "Source release"}{chapter.pageCount > 0 ? ` · ${chapter.pageCount} pages` : ""}</small></span><ChevronRight/></button>)}</div>
    </section>}

    {!busy && !error && !results.length && !selected && <div className="empty-state"><BookOpen/><h2>Browse your installed manga source</h2><p>Choose Popular, Latest updates, or search for a title.</p></div>}
  </div>;
}

function ReaderStatus({ text }: { text: string }) { return <p className="reader-message" role="status"><LoaderCircle className="spin"/> {text}</p>; }
function ReaderError({ text }: { text: string }) { return <p className="reader-message error" role="alert"><TriangleAlert/> {text}</p>; }
function message(cause: unknown) { return cause instanceof Error ? cause.message : "The manga source could not complete this request."; }

function PagedNavigation({ mode, pageIndex, pageCount, setPageIndex }: { mode: ReadingMode; pageIndex: number; pageCount: number; setPageIndex: (value: number) => void }) {
  const previous = mode === "rtl" ? <button disabled={pageIndex === 0} onClick={()=>setPageIndex(pageIndex - 1)}>Previous page <ChevronRight/></button> : <button disabled={pageIndex === 0} onClick={()=>setPageIndex(pageIndex - 1)}><ChevronLeft/> Previous page</button>;
  const next = mode === "rtl" ? <button disabled={pageIndex >= pageCount - 1} onClick={()=>setPageIndex(pageIndex + 1)}><ChevronLeft/> Next page</button> : <button disabled={pageIndex >= pageCount - 1} onClick={()=>setPageIndex(pageIndex + 1)}>Next page <ChevronRight/></button>;
  return <footer className={`reader-footer page-navigation ${mode}`}>{mode === "rtl" ? next : previous}<span>Page {pageIndex + 1} of {pageCount}</span>{mode === "rtl" ? previous : next}</footer>;
}
