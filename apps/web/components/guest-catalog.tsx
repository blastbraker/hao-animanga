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
  return <div className="page inner-page discover-page">
    <div className="page-intro"><span className="eyebrow">EXPLORE THE ARCHIVE</span><h1>{kind === "MANGA" ? "Manga & manhwa" : "Light novels"}</h1><p>Find your next read. Create an account when you’re ready to start.</p></div>
    <form className="guest-catalog-search" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
      <input aria-label="Search titles" placeholder="Search titles…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button className="button primary">Search</button>
    </form>
    {busy ? <p role="status">Loading titles…</p> : error ? <p role="alert">{error}</p> : <div className="media-grid">{items.map((work) => <MediaCard key={work.id} work={work} />)}</div>}
    {!busy && !error && !items.length && <p>No titles found. Try a different search.</p>}
    <SignInGate compact destination={kind === "MANGA" ? "/reader" : "/novels"} />
  </div>;
}
