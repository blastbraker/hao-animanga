"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Work } from "@hao/domain";
import { BookOpenText, FileUp, Search, Settings2, ShieldCheck } from "lucide-react";
import { MediaCard } from "../../components/media-card";
import { api } from "../../lib/api";

const GENRES = ["Fantasy", "Romance", "Adventure", "Drama", "Comedy"] as const;
type Shelf = "POPULAR" | "RELEASING" | "NEW";
type UploadResult = { filename: string; manifest: { title?: string; creator?: string; chapters?: unknown[] }; work?: Work };

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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const parameters = new URLSearchParams({ q: submittedQuery, kind: "LIGHT_NOVEL", pageSize: "30", maturity: "GENERAL" });
    if (genre) parameters.set("genre", genre);
    if (shelf === "RELEASING") parameters.set("status", "RELEASING");
    if (shelf === "NEW") parameters.set("year", String(new Date().getFullYear()));
    try {
      const result = await api<{ items: Work[] }>(`/search?${parameters.toString()}`);
      setItems(result.items);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "The light-novel catalog is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [genre, shelf, submittedQuery]);

  useEffect(() => { void load(); }, [load]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadMessage("");
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api<UploadResult>("/epubs", { method: "POST", body });
      if (result.work) setItems((current) => [result.work!, ...current.filter((item) => item.id !== result.work!.id)]);
      const chapterCount = result.manifest.chapters?.length ?? 0;
      setUploadMessage(`${result.manifest.title || result.filename} is ready${chapterCount ? ` with ${chapterCount} chapters` : ""}.`);
    } catch (cause) {
      setUploadMessage(cause instanceof Error ? cause.message : "The EPUB could not be uploaded.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="page inner-page novels-page">
      <section className="novels-hero">
        <div>
          <span className="eyebrow"><BookOpenText /> LIGHT NOVEL LIBRARY</span>
          <h1>Stories worth staying up for.</h1>
          <p>Discover light novels with AniList metadata, keep your EPUBs private, and prepare extension sources through your own HAO Bridge.</p>
        </div>
        <button className="novel-upload-card" type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>
          <FileUp />
          <span><b>{uploading ? "Checking EPUB…" : "Upload an EPUB"}</b><small>Validated, private, and limited to 50 MB</small></span>
        </button>
        <input ref={fileInput} className="visually-hidden" type="file" accept=".epub,application/epub+zip" onChange={(event) => void upload(event.target.files?.[0])} />
      </section>

      {uploadMessage && <p className="novel-upload-status" role="status">{uploadMessage}</p>}

      <section className="novel-catalog" aria-labelledby="novel-catalog-heading">
        <div className="novel-search">
          <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && setSubmittedQuery(query.trim())} placeholder="Search light novels…" /></label>
          <button className="button primary" onClick={() => setSubmittedQuery(query.trim())}><Search /> Search</button>
        </div>
        <div className="novel-filter-bar">
          <div className="novel-shelves" aria-label="Novel shelf">
            {([['POPULAR', 'Popular'], ['RELEASING', 'Releasing'], ['NEW', 'New this year']] as const).map(([value, label]) => <button key={value} className={shelf === value ? "active" : ""} aria-pressed={shelf === value} onClick={() => setShelf(value)}>{label}</button>)}
          </div>
          <label><Settings2 /><select aria-label="Novel genre" value={genre} onChange={(event) => setGenre(event.target.value)}><option value="">All genres</option>{GENRES.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
        <div className="discover-results-heading">
          <div><span className="eyebrow">ANILIST NOVEL DISCOVERY</span><h2 id="novel-catalog-heading">{submittedQuery ? `Results for “${submittedQuery}”` : shelf === "POPULAR" ? "Popular light novels" : shelf === "RELEASING" ? "Currently releasing" : "New this year"}</h2></div>
          {!loading && <span>{items.length} titles</span>}
        </div>
        {loading ? <div className="empty-state">Opening the shelves…</div> : error ? <div className="empty-state"><BookOpenText /><h2>Catalog unavailable</h2><p>{error}</p><button className="button ghost" onClick={() => void load()}>Retry</button></div> : items.length ? <div className="catalog-grid">{items.map((work) => <MediaCard key={work.id} work={work} />)}</div> : <div className="empty-state"><Search /><h2>No light novels found</h2><p>Try another title, shelf, or genre.</p></div>}
      </section>

      <aside className="novel-source-note">
        <ShieldCheck />
        <div><b>Source code stays on your Bridge</b><span>Third-party novel repositories are never bundled by HAO. Add one in Settings only after accepting the repository disclaimer.</span></div>
      </aside>
    </div>
  );
}
