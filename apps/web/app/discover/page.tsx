"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { MediaKind, ProfilePreferences, Work } from "@hao/domain";
import { Filter, Search, SlidersHorizontal, X } from "lucide-react";
import { api } from "../../lib/api";
import { MediaCard } from "../../components/media-card";
import { cacheProfilePreferences, isWorkAllowed } from "../../lib/profile-preferences";

type ReleaseStatus = "" | "RELEASING" | "FINISHED" | "NOT_YET_RELEASED";
type Maturity = "GENERAL" | "ADULT";
const GENRES = ["Action", "Drama", "Fantasy", "Romance"] as const;

export default function DiscoverPage() {
  return <Suspense fallback={<DiscoverLoading />}><DiscoverPageContent /></Suspense>;
}

function DiscoverPageContent() {
  const searchParameters = useSearchParams();
  const routeQuery = searchParameters.get("q")?.trim() ?? "";
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [kind, setKind] = useState<MediaKind | "">("");
  const [genre, setGenre] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState<ReleaseStatus>("");
  const [maturity, setMaturity] = useState<Maturity>("GENERAL");
  const [items, setItems] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setQuery(routeQuery);
    setSubmittedQuery(routeQuery);
    setInitialized(true);
  }, [routeQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const parameters = new URLSearchParams({ q: submittedQuery, pageSize: "30", maturity });
    if (kind) parameters.set("kind", kind);
    if (genre) parameters.set("genre", genre);
    if (year) parameters.set("year", year);
    if (status) parameters.set("status", status);
    try {
      const [result, preferences] = await Promise.all([
        api<{ items: Work[] }>(`/search?${parameters.toString()}`),
        api<ProfilePreferences>("/profile"),
      ]);
      cacheProfilePreferences(preferences);
      setItems(result.items.filter((work) => isWorkAllowed(work, preferences)));
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "Discovery is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [genre, kind, maturity, status, submittedQuery, year]);

  useEffect(() => {
    if (initialized) void load();
  }, [initialized, load]);

  function submitSearch() {
    setSubmittedQuery(query.trim());
  }

  function clearFilters() {
    setGenre("");
    setYear("");
    setStatus("");
    setMaturity("GENERAL");
  }

  const currentYear = String(new Date().getFullYear());
  const hasFilters = Boolean(genre || year || status || maturity !== "GENERAL");
  const heading = submittedQuery ? `Results for “${submittedQuery}”` : "Popular right now";

  return (
    <div className="page inner-page discover-page">
      <div className="page-intro">
        <span className="eyebrow">THE WHOLE ARCHIVE</span>
        <h1>Discover your next obsession.</h1>
        <p>Popular titles appear first. Search or combine filters to narrow anime, manga, manhwa, and light novels.</p>
      </div>
      <div className="search-panel">
        <label>
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submitSearch()}
            placeholder="Try ‘Frieren’, ‘romance’, or a Japanese title…"
          />
        </label>
        <select value={kind} onChange={(event) => setKind(event.target.value as MediaKind | "")} aria-label="Media type">
          <option value="">All media</option>
          <option value="ANIME">Anime</option>
          <option value="MANGA">Manga</option>
          <option value="MANHWA">Manhwa</option>
          <option value="LIGHT_NOVEL">Light novels</option>
        </select>
        <button className="button primary" onClick={submitSearch}>
          <SlidersHorizontal size={17} /> Search
        </button>
      </div>
      <div className="filter-row" aria-label="Discovery filters">
        <span><Filter size={15} /> Filters</span>
        {GENRES.map((value) => (
          <button type="button" key={value} className={genre === value ? "active" : ""} aria-pressed={genre === value} onClick={() => setGenre(genre === value ? "" : value)}>{value}</button>
        ))}
        <button type="button" className={year === currentYear ? "active" : ""} aria-pressed={year === currentYear} onClick={() => setYear(year === currentYear ? "" : currentYear)}>{currentYear}</button>
        <button type="button" className={status === "RELEASING" ? "active" : ""} aria-pressed={status === "RELEASING"} onClick={() => setStatus(status === "RELEASING" ? "" : "RELEASING")}>Releasing</button>
        <button type="button" className={maturity === "ADULT" ? "active" : ""} aria-pressed={maturity === "ADULT"} onClick={() => setMaturity(maturity === "ADULT" ? "GENERAL" : "ADULT")}>Adult titles</button>
        {hasFilters && <button type="button" className="clear-filters" onClick={clearFilters}><X size={14} /> Clear</button>}
      </div>
      <div className="discover-results-heading">
        <div><span className="eyebrow">ANILIST DISCOVERY</span><h2>{heading}</h2></div>
        {!loading && <span>{items.length} titles</span>}
      </div>
      {loading ? (
        <div className="empty-state">Loading popular titles…</div>
      ) : error ? (
        <div className="empty-state"><Search size={36} /><h2>Discovery unavailable</h2><p>{error}</p><button className="button ghost" onClick={() => void load()}>Retry</button></div>
      ) : items.length ? (
        <div className="catalog-grid">{items.map((work) => <MediaCard key={work.id} work={work} />)}</div>
      ) : (
        <div className="empty-state"><Search size={36} /><h2>No titles found</h2><p>Try another title or remove a filter.</p></div>
      )}
    </div>
  );
}

function DiscoverLoading() {
  return <div className="page inner-page discover-page"><div className="empty-state">Loading discovery…</div></div>;
}
