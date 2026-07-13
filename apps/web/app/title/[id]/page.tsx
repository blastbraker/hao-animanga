"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import { BookmarkPlus, CircleAlert, Heart, Play, RefreshCw, Star } from "lucide-react";
import { api } from "../../../lib/api";

export default function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const [work, setWork] = useState<Work | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setWork(null); setError("");
    void params.then(async ({ id }) => {
      try {
        return await api<{ work: Work }>(`/works/${id}`);
      } catch (cause) {
        const externalId = new URLSearchParams(window.location.search).get("anilistId");
        if (!externalId) throw cause;
        return api<{ work: Work }>(`/works/anilist/${encodeURIComponent(externalId)}`);
      }
    }).then(({ work: nextWork }) => {
      if (!cancelled) setWork(nextWork);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "This title could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [params, reloadKey]);

  if (error) return <div className="page inner-page"><div className="empty-state title-error"><CircleAlert/><h2>Title unavailable</h2><p>{error}</p><button className="button primary" onClick={()=>setReloadKey((value)=>value+1)}><RefreshCw/>Retry</button><Link className="button ghost" href="/discover">Back to Discover</Link></div></div>;
  if (!work) return <div className="page inner-page empty-state">Opening title…</div>;

  async function save() {
    await api("/library", { method: "PUT", body: JSON.stringify({ workId: work!.id, status: "WATCHING_READING", favorite: true }) });
    setSaved(true);
  }

  const playerHref = work.kind === "ANIME" ? "/player/anime" : "/reader";
  return <div className="title-page">
    <div className="title-backdrop" style={{ backgroundImage: `linear-gradient(0deg,#080a12 5%,rgba(8,10,18,.25)),url(${work.bannerUrl ?? work.coverUrl})` }}/>
    <div className="title-content">
      <img className="detail-cover" src={work.coverUrl ?? "/icon.svg"} alt={`${work.title} cover`}/>
      <div className="detail-copy">
        <span className="eyebrow">{work.kind.replace("_", " ")} · {work.year}</span><h1>{work.title}</h1>
        <div className="title-meta"><span><Star size={15} fill="currentColor"/> {((work.averageScore ?? 0) / 10).toFixed(1)}</span><span>{work.status}</span><span>{work.maturityRating}</span></div>
        <p>{work.synopsis}</p><div className="genre-row">{work.genres.map((genre)=><span key={genre}>{genre}</span>)}</div>
        <div className="hero-actions"><Link href={playerHref} className="button primary"><Play fill="currentColor"/> {work.kind === "ANIME" ? "Find in anime sources" : "Find in manga sources"}</Link><button className="button ghost" onClick={()=>void save()}>{saved ? <Heart fill="currentColor"/> : <BookmarkPlus/>}{saved ? "Saved" : "Add to library"}</button></div>
      </div>
    </div>
    <section className="content-block detail-section"><div className="section-head"><div><span className="eyebrow">AVAILABLE FROM YOUR SOURCES</span><h2>Episodes & chapters</h2></div></div><div className="source-empty"><b>Choose an installed source to continue.</b><span>HAO keeps AniList metadata separate from extension availability so titles are never silently mismatched.</span><Link href={playerHref}>Browse your sources →</Link></div></section>
  </div>;
}
