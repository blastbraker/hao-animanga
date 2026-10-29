"use client";
import { useEffect, useState } from "react";
import type { Work } from "@hao/domain";
import { api } from "../lib/api";
import { MediaCard } from "./media-card";
import { SignInGate } from "./viewer-access";

export function GuestCatalog({ kind }: { kind: "MANGA" | "LIGHT_NOVEL" }) {
  const [items, setItems] = useState<Work[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError("");
    void api<{ items: Work[] }>(`/search?${new URLSearchParams({ kind, q: search, pageSize: "30", maturity: "GENERAL" })}`)
      .then((result) => { if (!cancelled) setItems(result.items); })
      .catch(() => { if (!cancelled) setError("The catalog couldn’t be loaded. Please try again shortly."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [kind, search]);
  return <div className="page inner-page discover-page browse-design">
    <div className="browse-heading"><div><h1>{kind === "MANGA" ? "Manga" : "Light Novels"}</h1><p>Find your next read. Create an account when you’re ready to start.</p></div></div>
    <form className="guest-catalog-search" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
      <input aria-label="Search titles" placeholder="Search titles…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button className="button primary">Search</button>
    </form>
    <div className="section-head browse-catalog-heading"><h2>{search ? `Results for “${search}”` : kind === "MANGA" ? "Popular manga & manhwa" : "Popular light novels"}</h2></div>
    {busy ? <div className="browse-skeleton-grid" role="status" aria-label="Loading titles">{Array.from({length: 12}, (_, i) => <div key={i}/>)}</div> : error ? <p role="alert">{error}</p> : <div className="catalog-grid">{items.map((work) => <MediaCard key={work.id} work={work} />)}</div>}
    {!busy && !error && !items.length && <p>No titles found. Try a different search.</p>}
    <SignInGate compact destination={kind === "MANGA" ? "/reader" : "/novels"} />
  </div>;
}
