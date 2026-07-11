"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import { BookmarkPlus, Heart, Play, Star } from "lucide-react";
import { api } from "../../../lib/api";

export default function TitlePage({ params }: { params: Promise<{id:string}> }) {
  const [work,setWork]=useState<Work|null>(null); const [saved,setSaved]=useState(false);
  useEffect(()=>{void params.then(({id})=>api<{work:Work}>(`/works/${id}`).then(x=>setWork(x.work)))},[params]);
  if(!work)return <div className="page inner-page empty-state">Opening title…</div>;
  async function save(){await api("/library",{method:"PUT",body:JSON.stringify({workId:work!.id,status:"WATCHING_READING",favorite:true})});setSaved(true)}
  return <div className="title-page"><div className="title-backdrop" style={{backgroundImage:`linear-gradient(0deg,#080a12 5%,rgba(8,10,18,.25)),url(${work.bannerUrl??work.coverUrl})`}}/><div className="title-content"><img className="detail-cover" src={work.coverUrl??"/icon.svg"} alt={`${work.title} cover`}/><div className="detail-copy"><span className="eyebrow">{work.kind.replace("_"," ")} · {work.year}</span><h1>{work.title}</h1><div className="title-meta"><span><Star size={15} fill="currentColor"/> {(work.averageScore??0)/10}</span><span>{work.status}</span><span>{work.maturityRating}</span></div><p>{work.synopsis}</p><div className="genre-row">{work.genres.map(x=><span key={x}>{x}</span>)}</div><div className="hero-actions"><Link href={work.kind==="ANIME"?`/player/${work.id}`:"/reader"} className="button primary"><Play fill="currentColor"/> {work.kind==="ANIME"?"Watch now":"Start reading"}</Link><button className="button ghost" onClick={()=>void save()}>{saved?<Heart fill="currentColor"/>:<BookmarkPlus/>}{saved?"Saved":"Add to library"}</button></div></div></div><section className="content-block detail-section"><div className="section-head"><div><span className="eyebrow">AVAILABLE FROM YOUR SOURCES</span><h2>Episodes & chapters</h2></div></div><div className="source-empty"><b>No content source connected yet.</b><span>Connect Jellyfin, direct media, EPUB, or HAO Bridge in Settings.</span><Link href="/settings">Manage sources →</Link></div></section></div>;
}
