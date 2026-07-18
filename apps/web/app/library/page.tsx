"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LibraryEntry } from "@hao/domain";
import { FolderPlus, Grid3X3, Heart, Library as LibraryIcon, List, Search, X } from "lucide-react";
import { api, type LibraryResponse } from "../../lib/api";
import { MediaCard } from "../../components/media-card";
import { libraryProgressLabel } from "../../lib/library-progress";

type View = "grid" | "list";
type Sort = "updated" | "title" | "rating" | "progress";
type CustomList = { id: string; name: string; description: string; workIds: string[] };

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [status, setStatus] = useState("ALL");
  const [kind, setKind] = useState("ALL");
  const [sort, setSort] = useState<Sort>("updated");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState<View>("grid");
  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<CustomList[]>([]);
  const [activeList, setActiveList] = useState("ALL");
  const [newListName, setNewListName] = useState("");
  useEffect(() => { Promise.all([api<LibraryResponse>("/library"), api<{ items: CustomList[] }>("/lists")]).then(([library, custom]) => { setEntries(library.items); setLists(custom.items); }).catch(() => undefined).finally(() => setLoading(false)); }, []);
  const selectedList = lists.find((list) => list.id === activeList);
  const filtered = useMemo(() => entries.filter((entry) => !selectedList || selectedList.workIds.includes(entry.work.id)).filter((entry) => status === "ALL" || entry.status === status).filter((entry) => kind === "ALL" || entry.work.kind === kind).filter((entry) => !favoritesOnly || entry.favorite).filter((entry) => !query.trim() || `${entry.work.title} ${entry.work.alternateTitles.join(" ")} ${entry.work.genres.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => sort === "title" ? left.work.title.localeCompare(right.work.title) : sort === "rating" ? (right.rating ?? -1) - (left.rating ?? -1) : sort === "progress" ? (right.progress?.positionPercent ?? 0) - (left.progress?.positionPercent ?? 0) : right.updatedAt.localeCompare(left.updatedAt)), [entries, favoritesOnly, kind, query, selectedList, sort, status]);
  async function createList() { const name = newListName.trim(); if (!name) return; const list = await api<CustomList>("/lists", { method: "POST", body: JSON.stringify({ name }) }); setLists((current) => [...current, list]); setActiveList(list.id); setNewListName(""); setView("list"); }
  async function setListMembership(listId: string, workId: string, included: boolean) { await api(`/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(workId)}`, { method: "PUT", body: JSON.stringify({ included }) }); setLists((current) => current.map((list) => list.id === listId ? { ...list, workIds: included ? [...new Set([...list.workIds, workId])] : list.workIds.filter((id) => id !== workId) } : list)); }
  return <div className="page inner-page library-page">
    <div className="library-heading"><div><span className="eyebrow">YOUR PERMANENT COLLECTION</span><h1>Library</h1><p>{entries.length} titles, safely yours across every source.</p></div><div className="view-toggle"><button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Grid3X3 /></button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><List /></button></div></div>
    <div className="tabs">{[["ALL","All"],["WATCHING_READING","In progress"],["PLANNING","Planning"],["COMPLETED","Completed"],["ON_HOLD","On hold"],["DROPPED","Dropped"]].map(([value,label]) => <button key={value} onClick={() => setStatus(value!)} className={status === value ? "active" : ""}>{label}</button>)}</div>
    <div className="custom-list-bar"><select aria-label="Custom list" value={activeList} onChange={(event) => setActiveList(event.target.value)}><option value="ALL">All library titles</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name} ({list.workIds.length})</option>)}</select><label><FolderPlus/><input value={newListName} onChange={(event) => setNewListName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createList(); }} placeholder="New custom list"/><button disabled={!newListName.trim()} onClick={() => void createList()}>Create</button></label>{selectedList && <span>Switch to list view to add or remove titles.</span>}</div>
    <div className="library-tools"><label><Search/><input aria-label="Search library" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your library"/></label><select aria-label="Media type" value={kind} onChange={(event) => setKind(event.target.value)}><option value="ALL">All media</option><option value="ANIME">Anime</option><option value="MANGA">Manga</option><option value="MANHWA">Manhwa</option><option value="LIGHT_NOVEL">Light novels</option></select><select aria-label="Sort library" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="updated">Recently updated</option><option value="title">Title A–Z</option><option value="rating">My rating</option><option value="progress">Progress</option></select><button className={favoritesOnly ? "active" : ""} onClick={() => setFavoritesOnly((value) => !value)}><Heart fill={favoritesOnly ? "currentColor" : "none"}/>Favorites</button></div>
    {loading ? <div className="empty-state">Loading your library…</div> : filtered.length ? view === "grid" ? <div className="catalog-grid">{filtered.map((entry) => <MediaCard key={entry.id} work={entry.work} progress={entry.progress?.positionPercent ?? undefined} progressLabel={libraryProgressLabel(entry)} userRating={entry.rating}/>)}</div> : <div className="library-list">{filtered.map((entry) => <div key={entry.id}><Link href={entry.work.source.kind === "ANILIST" ? `/title/${entry.work.id}?anilistId=${entry.work.source.externalId}` : `/title/${entry.work.id}`}><img src={entry.work.coverUrl ?? "/icon.svg"} alt=""/><span><b>{entry.work.title}</b><small>{entry.work.kind.replace("_"," ")} · {entry.status.replaceAll("_"," ")} · {libraryProgressLabel(entry)}</small></span></Link>{entry.favorite && <Heart fill="currentColor"/>}{entry.rating !== null && <strong>{entry.rating.toFixed(1)}</strong>}{selectedList ? <button aria-label={`Remove ${entry.work.title} from ${selectedList.name}`} onClick={() => void setListMembership(selectedList.id, entry.work.id, false)}><X/></button> : <select aria-label={`Add ${entry.work.title} to custom list`} defaultValue="" onChange={(event) => { if (event.target.value) void setListMembership(event.target.value, entry.work.id, true); event.target.value = ""; }}><option value="">Add to list…</option>{lists.filter((list) => !list.workIds.includes(entry.work.id)).map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select>}</div>)}</div> : <div className="empty-state"><LibraryIcon size={42}/><h2>This shelf is waiting</h2><p>{entries.length ? "Try clearing a filter or searching for another title." : "Start watching or reading and the title will appear here automatically."}</p></div>}
  </div>;
}
