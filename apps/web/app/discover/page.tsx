"use client";
import { useState } from "react";
import type { MediaKind, Work } from "@hao/domain";
import { Filter, Search, SlidersHorizontal } from "lucide-react";
import { api } from "../../lib/api";
import { MediaCard } from "../../components/media-card";

export default function DiscoverPage() {
  const [query, setQuery] = useState(""); const [kind, setKind] = useState<MediaKind | "">(""); const [items, setItems] = useState<Work[]>([]); const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false);
  async function search() { setLoading(true); setSearched(true); try { const result = await api<{items:Work[]}>(`/search?q=${encodeURIComponent(query)}${kind ? `&kind=${kind}` : ""}`); setItems(result.items); } finally { setLoading(false); } }
  return <div className="page inner-page"><div className="page-intro"><span className="eyebrow">THE WHOLE ARCHIVE</span><h1>Discover your next obsession.</h1><p>Search anime, manga, manhwa, and light novels as one connected catalog.</p></div><div className="search-panel"><label><Search/><input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&void search()} placeholder="Try ‘Frieren’, ‘romance’, or a Japanese title..."/></label><select value={kind} onChange={(e)=>setKind(e.target.value as MediaKind|"")} aria-label="Media type"><option value="">All media</option><option value="ANIME">Anime</option><option value="MANGA">Manga</option><option value="MANHWA">Manhwa</option><option value="LIGHT_NOVEL">Light novels</option></select><button className="button primary" onClick={()=>void search()}><SlidersHorizontal size={17}/> Search</button></div><div className="filter-row"><span><Filter size={15}/> Filters</span>{["Action","Drama","Fantasy","Romance","2026","Releasing"].map(x=><button key={x}>{x}</button>)}</div>{loading ? <div className="empty-state">Searching the archive…</div> : items.length ? <div className="catalog-grid">{items.map(work=><MediaCard key={work.id} work={work}/>)}</div> : <div className="empty-state"><Search size={36}/><h2>{searched ? "No titles found" : "The archive is listening"}</h2><p>{searched ? "Try another title or remove a filter." : "Enter a title above to search AniList."}</p></div>}</div>;
}
