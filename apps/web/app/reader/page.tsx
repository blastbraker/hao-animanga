"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, LoaderCircle, Search, Server, TriangleAlert } from "lucide-react";
import { api } from "../../lib/api";

type BridgeDevice = { endpoint: string; revokedAt: string | null };
type MangaSource = { id: string; name: string; displayName: string; language: string; mature: boolean };
type MangaSummary = { id: number; sourceId: string; title: string; author?: string; description?: string; status?: string; genres: string[] };
type MangaSearchResponse = { items: MangaSummary[]; hasNextPage: boolean };
type MangaChapter = { id: number; index: number; name: string; number: number; scanlator?: string; uploadDate: number; read: boolean; lastPageRead: number; pageCount: number };
type MangaChapterPages = { mangaId: number; chapterIndex: number; chapterName: string; pageCount: number; pageUrls: string[] };

export default function ReaderPage() {
  const [bridge, setBridge] = useState("");
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MangaSummary[]>([]);
  const [selected, setSelected] = useState<MangaSummary | null>(null);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [pages, setPages] = useState<MangaChapterPages | null>(null);
  const [busy, setBusy] = useState("Connecting to your Bridge…");
  const [error, setError] = useState("");

  const activeSource = useMemo(() => sources.find((source) => source.id === sourceId), [sourceId, sources]);
  const currentChapter = useMemo(() => chapters.find((chapter) => chapter.index === pages?.chapterIndex), [chapters, pages]);
  const chapterPosition = currentChapter ? chapters.indexOf(currentChapter) : -1;

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
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
  }

  function openAdjacentChapter(offset: number) {
    const chapter = chapters[chapterPosition + offset];
    if (chapter) void openChapter(chapter);
  }

  function resetTitle() { setSelected(null); setChapters([]); setPages(null); setError(""); }

  if (pages && selected) return <div className="reader-page live-reader">
    <header className="reader-toolbar">
      <button onClick={()=>setPages(null)}><ChevronLeft/> Chapters</button>
      <div><b>{selected.title}</b><span>{pages.chapterName}</span></div>
      <span>{pages.pageCount} pages</span>
    </header>
    {busy && <ReaderStatus text={busy}/>} {error && <ReaderError text={error}/>}
    <main className="manga-pages" aria-label={`${selected.title}, ${pages.chapterName}`}>
      {pages.pageUrls.map((url, index)=><img key={url} loading={index < 2 ? "eager" : "lazy"} src={`${bridge}${url}`} alt={`Page ${index + 1} of ${pages.pageCount}`}/>) }
    </main>
    <footer className="reader-footer chapter-navigation">
      <button disabled={chapterPosition >= chapters.length - 1} onClick={()=>openAdjacentChapter(1)}><ChevronLeft/> Previous chapter</button>
      <span>{pages.chapterName}</span>
      <button disabled={chapterPosition <= 0} onClick={()=>openAdjacentChapter(-1)}>Next chapter <ChevronRight/></button>
    </footer>
  </div>;

  return <div className="page inner-page manga-browser">
    <div className="page-intro"><span className="eyebrow">LOCAL EXTENSION READER</span><h1>Read manga</h1><p>Search sources running on your HAO Bridge. HAO’s cloud never receives third-party catalogs, chapters, or pages.</p></div>
    <form className="search-panel manga-search" onSubmit={search}>
      <label><Search/><input aria-label="Search manga" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search titles…"/></label>
      <select aria-label="Manga source" value={sourceId} onChange={(event)=>setSourceId(event.target.value)} disabled={!sources.length}>
        {sources.map((source)=><option key={source.id} value={source.id}>{source.displayName} · {source.language.toUpperCase()}</option>)}
      </select>
      <button className="button primary" disabled={Boolean(busy) || !query.trim() || !sourceId}>Search</button>
    </form>
    {activeSource && <p className="source-disclosure"><Server/> Browsing {activeSource.displayName} through your local Bridge. Use only content you are authorized to access.</p>}
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

    {!busy && !error && !results.length && !selected && <div className="empty-state"><BookOpen/><h2>Search your installed manga source</h2><p>MangaDex English is selected automatically when available.</p></div>}
  </div>;
}

function ReaderStatus({ text }: { text: string }) { return <p className="reader-message" role="status"><LoaderCircle className="spin"/> {text}</p>; }
function ReaderError({ text }: { text: string }) { return <p className="reader-message error" role="alert"><TriangleAlert/> {text}</p>; }
function message(cause: unknown) { return cause instanceof Error ? cause.message : "The manga source could not complete this request."; }
