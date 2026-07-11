"use client";
import { useEffect, useState } from "react";
import type { LibraryEntry } from "@hao/domain";
import { Grid3X3, List, Library as LibraryIcon } from "lucide-react";
import { api, type LibraryResponse } from "../../lib/api";
import { MediaCard } from "../../components/media-card";

export default function LibraryPage() {
  const [entries,setEntries]=useState<LibraryEntry[]>([]); const [status,setStatus]=useState("ALL");
  useEffect(()=>{api<LibraryResponse>("/library").then(x=>setEntries(x.items)).catch(()=>undefined)},[]);
  const filtered=status==="ALL"?entries:entries.filter(x=>x.status===status);
  return <div className="page inner-page"><div className="library-heading"><div><span className="eyebrow">YOUR PERMANENT COLLECTION</span><h1>Library</h1><p>{entries.length} titles, safely yours across every source.</p></div><div className="view-toggle"><button className="active"><Grid3X3/></button><button><List/></button></div></div><div className="tabs">{[["ALL","All"],["WATCHING_READING","In progress"],["PLANNING","Planning"],["COMPLETED","Completed"],["ON_HOLD","On hold"]].map(([value,label])=><button key={value} onClick={()=>setStatus(value!)} className={status===value?"active":""}>{label}</button>)}</div>{filtered.length?<div className="catalog-grid">{filtered.map(entry=><MediaCard key={entry.id} work={entry.work} progress={entry.progress?.positionPercent??undefined}/>)}</div>:<div className="empty-state"><LibraryIcon size={42}/><h2>This shelf is waiting</h2><p>Save a title from Discover and it will appear here.</p></div>}</div>;
}
