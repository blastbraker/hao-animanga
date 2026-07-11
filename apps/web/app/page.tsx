"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import { ArrowRight, BookOpen, Play, Sparkles } from "lucide-react";
import { api, type DiscoverResponse } from "../lib/api";
import { MediaCard } from "../components/media-card";

const fallback: Work[] = [{ id:"10000000-0000-4000-8000-000000000001",kind:"ANIME",title:"Violet Evergarden",alternateTitles:[],synopsis:"A former child soldier learns the meaning of the words left to her by someone dear.",coverUrl:"https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21827-ubzq619ZA2E9.png",bannerUrl:"https://s4.anilist.co/file/anilistcdn/media/anime/banner/21827-3EwjBS6ebj1C.jpg",year:2018,status:"FINISHED",genres:["Drama","Fantasy"],maturityRating:"PG-13",averageScore:85,source:{kind:"ANILIST",externalId:"21827"} }];

export default function HomePage() {
  const [data, setData] = useState<DiscoverResponse>({ featured: fallback, trending: fallback, updated: fallback });
  useEffect(() => { api<DiscoverResponse>("/discover").then(setData).catch(() => undefined); }, []);
  const hero = data.featured[0] ?? fallback[0]!;
  return <div className="page home-page">
    <section className="hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,10,18,.98) 8%, rgba(8,10,18,.64) 54%, rgba(8,10,18,.2)), linear-gradient(0deg,#080a12 0%,transparent 48%), url(${hero.bannerUrl ?? hero.coverUrl})` }}>
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={14}/> FEATURED ARCHIVE</span><h1>{hero.title}</h1><p>{hero.synopsis}</p><div className="hero-meta"><span>{hero.year}</span><span>{hero.status}</span><span>{hero.averageScore}% score</span></div><div className="hero-actions"><Link href={`/player/${hero.id}`} className="button primary"><Play size={18} fill="currentColor"/> Watch now</Link><Link href={`/title/${hero.id}`} className="button ghost">View details</Link></div></div>
      <div className="hero-index"><b>01</b><span>/ 04</span></div>
    </section>
    <section className="content-block continue-block"><div className="section-head"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Continue your journey</h2></div><Link href="/library">View library <ArrowRight size={16}/></Link></div>
      <div className="continue-grid"><Link href={`/player/${hero.id}`} className="continue-card"><img src={hero.coverUrl ?? "/icon.svg"} alt=""/><div><span className="type-label">ANIME · EPISODE 7</span><h3>{hero.title}</h3><p>42% watched · 13 min remaining</p><div className="track"><i style={{width:"42%"}}/></div></div><Play className="round-play" fill="currentColor"/></Link><Link href="/reader" className="continue-card accent"><div className="paper-preview"><BookOpen/></div><div><span className="type-label">LIGHT NOVEL · CHAPTER 3</span><h3>Your uploaded EPUB</h3><p>Ready when you add your first book</p><div className="track"><i style={{width:"8%"}}/></div></div></Link></div>
    </section>
    <MediaRow title="Trending across HAO" eyebrow="DISCOVER SOMETHING NEW" items={data.trending}/>
    <MediaRow title="Fresh from the shelves" eyebrow="RECENTLY UPDATED" items={data.updated}/>
  </div>;
}

function MediaRow({ title, eyebrow, items }: { title: string; eyebrow: string; items: Work[] }) { return <section className="content-block"><div className="section-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><Link href="/discover">Explore all <ArrowRight size={16}/></Link></div><div className="media-row">{items.map((work) => <MediaCard key={work.id} work={work}/>)}</div></section>; }
