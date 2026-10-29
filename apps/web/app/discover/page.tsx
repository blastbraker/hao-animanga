"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { MediaKind, ProfilePreferences, Work } from "@hao/domain";
import { ArrowUpRight, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import { MediaCard } from "../../components/media-card";
import {
  cacheProfilePreferences,
  isWorkAllowed,
} from "../../lib/profile-preferences";
import { useViewerAccess } from "../../components/viewer-access";

type ReleaseStatus = "" | "RELEASING" | "FINISHED" | "NOT_YET_RELEASED";
type Maturity = "GENERAL" | "ADULT";
const GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Thriller",
] as const;

export default function DiscoverPage() {
  return (
    <Suspense fallback={<DiscoverLoading />}>
      <DiscoverPageContent />
    </Suspense>
  );
}

function DiscoverPageContent() {
  const { signedIn } = useViewerAccess();
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
  const requestId = useRef(0);

  useEffect(() => {
    setQuery(routeQuery);
    setSubmittedQuery(routeQuery);
    setInitialized(true);
  }, [routeQuery]);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError("");
    const parameters = new URLSearchParams({
      q: submittedQuery,
      pageSize: "30",
      maturity,
    });
    if (kind) parameters.set("kind", kind);
    if (genre) parameters.set("genre", genre);
    if (year) parameters.set("year", year);
    if (status) parameters.set("status", status);
    try {
      const [result, preferences] = await Promise.all([
        api<{ items: Work[] }>(`/search?${parameters.toString()}`),
        signedIn ? api<ProfilePreferences>("/profile") : Promise.resolve(null),
      ]);
      if (request !== requestId.current) return;
      if (preferences) cacheProfilePreferences(preferences);
      setItems(
        result.items.filter((work) =>
          isWorkAllowed(
            work,
            preferences ?? { maturityCeiling: "MATURE", hideUnrated: false },
          ),
        ),
      );
    } catch (cause) {
      if (request !== requestId.current) return;
      setItems([]);
      setError(
        cause instanceof Error
          ? cause.message
          : "Discovery is temporarily unavailable.",
      );
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [genre, kind, maturity, status, submittedQuery, year, signedIn]);

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
  const heading = submittedQuery
    ? `Results for “${submittedQuery}”`
    : "Popular right now";

  return (
    <div className="page inner-page discover-page browse-design">
      <div className="browse-heading">
        <div>
          <h1>Discover</h1>
          <p>Find your next favorite.</p>
        </div>
      </div>
      <div className="browse-tabs" aria-label="Media type">
        {(
          [
            ["", "All"],
            ["ANIME", "Anime"],
            ["MANGA", "Manga"],
            ["MANHWA", "Manhwa"],
            ["LIGHT_NOVEL", "Light Novels"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={kind === value}
            className={kind === value ? "active" : ""}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="search-panel">
        <label>
          <Search />
          <input
            aria-label="Search discovery"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submitSearch()}
            placeholder="Try ‘Frieren’, ‘romance’, or a Japanese title…"
          />
        </label>
        <button className="button primary" onClick={submitSearch}>
          <Search size={17} /> Search
        </button>
      </div>
      <div className="browse-filters" aria-label="Discovery filters">
        <label>
          Genre
          <select
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
          >
            <option value="">All genres</option>
            {GENRES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            <option value="">Any year</option>
            {Array.from(
              { length: 60 },
              (_, i) => Number(currentYear) + 1 - i,
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ReleaseStatus)}
          >
            <option value="">Any status</option>
            <option value="RELEASING">Releasing</option>
            <option value="FINISHED">Finished</option>
            <option value="NOT_YET_RELEASED">Upcoming</option>
          </select>
        </label>
        <label>
          Content
          <select
            value={maturity}
            onChange={(event) => setMaturity(event.target.value as Maturity)}
          >
            <option value="GENERAL">General</option>
            <option value="ADULT">Adult titles</option>
          </select>
        </label>
        {hasFilters && (
          <button className="browse-clear" type="button" onClick={clearFilters}>
            <X size={14} /> Clear filters
          </button>
        )}
      </div>
      <div className="discover-results-heading">
        <div>
          <h2>{heading}</h2>
        </div>
        {!loading && <span>{items.length} titles</span>}
      </div>
      {loading ? (
        <div
          className="browse-skeleton-grid"
          role="status"
          aria-label="Loading titles"
        >
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="empty-state">
          <Search size={36} />
          <h2>Discovery unavailable</h2>
          <p>{error}</p>
          <button className="button ghost" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : items.length ? (
        <>
          <div className="catalog-grid">
            {items.slice(0, 12).map((work) => (
              <MediaCard key={work.id} work={work} />
            ))}
          </div>
          {!submittedQuery && !hasFilters && (
            <section className="mood-section">
              <div className="section-head">
                <h2>Explore by mood</h2>
              </div>
              <div className="mood-grid">
                {[
                  ["Adventure", "A world to get lost in", "Adventure"],
                  ["Cozy", "Slow down, settle in", "Slice of Life"],
                  ["Mystery", "One more twist", "Mystery"],
                  ["Fantasy", "Beyond the everyday", "Fantasy"],
                ].map(([label, copy, filter], i) => (
                  <button
                    key={label}
                    className={`mood-tile mood-${i}`}
                    onClick={() => {
                      setGenre(filter!);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <span>
                      <b>{label}</b>
                      <small>{copy}</small>
                    </span>
                    <ArrowUpRight />
                  </button>
                ))}
              </div>
            </section>
          )}
          {items.length > 12 && (
            <section className="browse-more">
              <div className="section-head">
                <h2>More to explore</h2>
              </div>
              <div className="catalog-grid">
                {items.slice(12).map((work) => (
                  <MediaCard key={work.id} work={work} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="empty-state">
          <Search size={36} />
          <h2>No titles found</h2>
          <p>Try another title or remove a filter.</p>
        </div>
      )}
    </div>
  );
}

function DiscoverLoading() {
  return (
    <div className="page inner-page discover-page">
      <div className="empty-state">Loading discovery…</div>
    </div>
  );
}
