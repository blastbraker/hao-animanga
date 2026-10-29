"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LibraryEntry, LibraryStatus } from "@hao/domain";
import {
  ArrowUpRight,
  FolderPlus,
  Grid3X3,
  Heart,
  Library as LibraryIcon,
  List,
  Search,
  X,
} from "lucide-react";
import { api, type LibraryResponse } from "../../lib/api";
import { libraryProgressLabel } from "../../lib/library-progress";
import { librarySynopsis } from "../../lib/library-synopsis";
import { NOVEL_RESUMES_KEY, parseNovelResumes } from "../../lib/novel-state";
import { ACTIVITY_STORAGE_KEY, parseActivity } from "../../lib/beta-features";

type View = "grid" | "list";
type Sort = "updated" | "title" | "rating" | "progress";
type CustomList = {
  id: string;
  name: string;
  description: string;
  workIds: string[];
};

const LIBRARY_STATUSES: Array<{ value: LibraryStatus; label: string }> = [
  { value: "PLANNING", label: "Planning" },
  { value: "WATCHING_READING", label: "In progress" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "COMPLETED", label: "Completed" },
  { value: "DROPPED", label: "Dropped" },
];

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [status, setStatus] = useState<LibraryStatus | "ALL">("ALL");
  const [kind, setKind] = useState("ALL");
  const [sort, setSort] = useState<Sort>("updated");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState<View>("grid");
  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<CustomList[]>([]);
  const [activeList, setActiveList] = useState("ALL");
  const [newListName, setNewListName] = useState("");
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [resumeHrefs, setResumeHrefs] = useState<Record<string, string>>({});
  const [historyHrefs, setHistoryHrefs] = useState<Record<string, string>>({});
  const [showListForm, setShowListForm] = useState(false);
  const [creatingList, setCreatingList] = useState(false);

  useEffect(() => {
    try {
      setResumeHrefs(
        Object.fromEntries(
          parseNovelResumes(
            window.localStorage.getItem(NOVEL_RESUMES_KEY),
          ).flatMap((item) => (item.workId ? [[item.workId, item.href]] : [])),
        ),
      );
      setHistoryHrefs(
        Object.fromEntries(
          parseActivity(window.localStorage.getItem(ACTIVITY_STORAGE_KEY))
            .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
            .map((item) => [
              `${item.kind === "watch" ? "ANIME" : item.href.startsWith("/novels") ? "LIGHT_NOVEL" : "MANGA"}:${item.title}`,
              item.href,
            ]),
        ),
      );
    } catch {
      /* The cloud library still works when local storage is disabled. */
    }
    Promise.all([
      api<LibraryResponse>("/library"),
      api<{ items: CustomList[] }>("/lists"),
    ])
      .then(([library, custom]) => {
        setEntries(library.items);
        setLists(custom.items);
      })
      .catch((cause) =>
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Your library could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const selectedList = lists.find((list) => list.id === activeList);
  const filtered = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            !selectedList || selectedList.workIds.includes(entry.work.id),
        )
        .filter((entry) => status === "ALL" || entry.status === status)
        .filter((entry) => kind === "ALL" || entry.work.kind === kind)
        .filter((entry) => !favoritesOnly || entry.favorite)
        .filter(
          (entry) =>
            !query.trim() ||
            `${entry.work.title} ${entry.work.alternateTitles.join(" ")} ${entry.work.genres.join(" ")}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .sort((left, right) =>
          sort === "title"
            ? left.work.title.localeCompare(right.work.title)
            : sort === "rating"
              ? (right.rating ?? -1) - (left.rating ?? -1)
              : sort === "progress"
                ? (right.progress?.positionPercent ?? 0) -
                  (left.progress?.positionPercent ?? 0)
                : right.updatedAt.localeCompare(left.updatedAt),
        ),
    [entries, favoritesOnly, kind, query, selectedList, sort, status],
  );

  async function createList() {
    const name = newListName.trim();
    if (!name || creatingList) return;
    setCreatingList(true);
    try {
      const list = await api<CustomList>("/lists", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setLists((current) => [...current, list]);
      setActiveList(list.id);
      setNewListName("");
      setView("list");
      setShowListForm(false);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The list could not be created.",
      );
    } finally {
      setCreatingList(false);
    }
  }

  async function setListMembership(
    listId: string,
    workId: string,
    included: boolean,
  ) {
    try {
      await api(
        `/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(workId)}`,
        { method: "PUT", body: JSON.stringify({ included }) },
      );
      setLists((current) =>
        current.map((list) =>
          list.id === listId
            ? {
                ...list,
                workIds: included
                  ? [...new Set([...list.workIds, workId])]
                  : list.workIds.filter((id) => id !== workId),
              }
            : list,
        ),
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The list could not be updated.",
      );
    }
  }

  async function updateEntry(
    entry: LibraryEntry,
    patch: Partial<Pick<LibraryEntry, "status" | "favorite">>,
  ) {
    const optimistic = { ...entry, ...patch };
    setMessage("");
    setEntries((current) =>
      current.map((item) => (item.id === entry.id ? optimistic : item)),
    );
    setUpdating((current) => new Set(current).add(entry.id));
    try {
      const saved = await api<LibraryEntry>("/library", {
        method: "PUT",
        body: JSON.stringify({
          workId: entry.work.id,
          status: optimistic.status,
          favorite: optimistic.favorite,
          rating: entry.rating,
          notes: entry.notes,
        }),
      });
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? saved : item)),
      );
    } catch (cause) {
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? entry : item)),
      );
      setMessage(
        cause instanceof Error
          ? cause.message
          : "That library change could not be saved.",
      );
    } finally {
      setUpdating((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  }

  const resumes = entries
    .filter(
      (entry) =>
        entry.status === "WATCHING_READING" &&
        entry.progress &&
        (kind === "ALL" || entry.work.kind === kind),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  const resumeFor = (entry: LibraryEntry) =>
    resumeHrefs[entry.work.id] ??
    historyHrefs[
      `${entry.work.kind === "MANHWA" ? "MANGA" : entry.work.kind}:${entry.work.title}`
    ];
  const countFor = (value: string) =>
    entries.filter(
      (entry) =>
        (kind === "ALL" || entry.work.kind === kind) &&
        (!selectedList || selectedList.workIds.includes(entry.work.id)) &&
        (value === "ALL" || entry.status === value),
    ).length;
  return (
    <div className="page inner-page library-page browse-design">
      <div className="browse-heading">
        <div>
          <h1>
            Your library{" "}
            <small>{loading ? "" : `${entries.length} titles`}</small>
          </h1>
          <p>Everything you love, all in one place.</p>
        </div>
        <div className="browse-heading-actions">
          <button
            className="button primary"
            aria-expanded={showListForm}
            onClick={() => setShowListForm((value) => !value)}
          >
            <FolderPlus size={17} /> New list
          </button>
          <div className="view-toggle">
            <button
              className={view === "grid" ? "active" : ""}
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
              aria-label="Grid view"
            >
              <Grid3X3 />
            </button>
            <button
              className={view === "list" ? "active" : ""}
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              aria-label="List view"
            >
              <List />
            </button>
          </div>
        </div>
      </div>
      <div className="browse-tabs" aria-label="Library media type">
        {[
          ["ALL", "All"],
          ["ANIME", "Anime"],
          ["MANGA", "Manga"],
          ["MANHWA", "Manhwa"],
          ["LIGHT_NOVEL", "Light Novels"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={kind === value}
            className={kind === value ? "active" : ""}
            onClick={() => setKind(value!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="browse-tabs status-tabs" aria-label="Library status">
        {[
          ["ALL", "All statuses"],
          ...LIBRARY_STATUSES.map((item) => [item.value, item.label]),
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={status === value}
            onClick={() => setStatus(value as LibraryStatus | "ALL")}
            className={status === value ? "active" : ""}
          >
            {label} <span>{countFor(value!)}</span>
          </button>
        ))}
      </div>
      {(showListForm || lists.length > 0) && (
        <div className="custom-list-bar">
          <select
            aria-label="Custom list"
            value={activeList}
            onChange={(event) => setActiveList(event.target.value)}
          >
            <option value="ALL">All library titles</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.workIds.length})
              </option>
            ))}
          </select>
          {showListForm && (
            <label>
              <FolderPlus />
              <input
                aria-label="New list name"
                value={newListName}
                onChange={(event) => setNewListName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createList();
                }}
                placeholder="New custom list"
              />
              <button
                disabled={!newListName.trim() || creatingList}
                onClick={() => void createList()}
              >
                {creatingList ? "Creating…" : "Create"}
              </button>
            </label>
          )}
          {selectedList && (
            <span>Switch to list view to add or remove titles.</span>
          )}
        </div>
      )}
      {resumes.length > 0 && (
        <section className="browse-resume-section">
          <div className="section-head">
            <h2>Pick up where you left off</h2>
          </div>
          <div className="browse-resume-row">
            {resumes.map((entry) => (
              <Link
                className="browse-resume-card"
                href={workHref(entry, resumeFor(entry))}
                key={entry.id}
              >
                <img src={entry.work.coverUrl ?? "/icon.svg"} alt="" />
                <div>
                  <b>{entry.work.title}</b>
                  <small>{libraryProgressLabel(entry)}</small>
                  <span className="browse-progress">
                    <i
                      style={{
                        width: `${entry.progress?.positionPercent ?? 0}%`,
                      }}
                    />
                  </span>
                </div>
                <span className="resume-action">
                  Resume <ArrowUpRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="library-tools">
        <label>
          <Search />
          <input
            aria-label="Search library"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
          />
        </label>
        <select
          aria-label="Sort library"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="updated">Recently updated</option>
          <option value="title">Title A-Z</option>
          <option value="rating">My rating</option>
          <option value="progress">Progress</option>
        </select>
        <button
          aria-pressed={favoritesOnly}
          className={favoritesOnly ? "active" : ""}
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          <Heart fill={favoritesOnly ? "currentColor" : "none"} />
          Favorites
        </button>
      </div>
      {message && (
        <p className="library-message" role="alert">
          {message}
        </p>
      )}
      {loading ? (
        <div className="empty-state">Loading your library...</div>
      ) : filtered.length ? (
        view === "grid" ? (
          <div className="library-redesign-grid">
            {filtered.map((entry) => (
              <LibraryGridItem
                key={entry.id}
                entry={entry}
                resumeHref={resumeFor(entry)}
                busy={updating.has(entry.id)}
                onUpdate={updateEntry}
              />
            ))}
          </div>
        ) : (
          <div className="library-list">
            {filtered.map((entry) => (
              <div key={entry.id}>
                <Link href={workHref(entry, resumeFor(entry))}>
                  <img src={entry.work.coverUrl ?? "/icon.svg"} alt="" />
                  <span>
                    <b>{entry.work.title}</b>
                    <small>
                      {entry.work.kind.replace("_", " ")} ·{" "}
                      {libraryProgressLabel(entry) ?? "Not started"}
                    </small>
                  </span>
                </Link>
                <button
                  className={`library-favorite ${entry.favorite ? "active" : ""}`}
                  aria-label={`${entry.favorite ? "Remove" : "Add"} ${entry.work.title} ${entry.favorite ? "from" : "to"} favorites`}
                  disabled={updating.has(entry.id)}
                  onClick={() =>
                    void updateEntry(entry, { favorite: !entry.favorite })
                  }
                >
                  <Heart fill={entry.favorite ? "currentColor" : "none"} />
                </button>
                <select
                  className="library-status-select"
                  aria-label={`Status for ${entry.work.title}`}
                  value={entry.status}
                  disabled={updating.has(entry.id)}
                  onChange={(event) =>
                    void updateEntry(entry, {
                      status: event.target.value as LibraryStatus,
                    })
                  }
                >
                  {LIBRARY_STATUSES.map((item) => (
                    <option value={item.value} key={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {entry.rating !== null && (
                  <strong>{entry.rating.toFixed(1)}</strong>
                )}
                {selectedList ? (
                  <button
                    aria-label={`Remove ${entry.work.title} from ${selectedList.name}`}
                    onClick={() =>
                      void setListMembership(
                        selectedList.id,
                        entry.work.id,
                        false,
                      )
                    }
                  >
                    <X />
                  </button>
                ) : (
                  <select
                    aria-label={`Add ${entry.work.title} to custom list`}
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value)
                        void setListMembership(
                          event.target.value,
                          entry.work.id,
                          true,
                        );
                      event.target.value = "";
                    }}
                  >
                    <option value="">Add to list...</option>
                    {lists
                      .filter((list) => !list.workIds.includes(entry.work.id))
                      .map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="empty-state">
          <LibraryIcon size={42} />
          <h2>This shelf is waiting</h2>
          <p>
            {entries.length
              ? "Try clearing a filter or searching for another title."
              : "Start watching or reading and the title will appear here automatically."}
          </p>
        </div>
      )}
    </div>
  );
}

function LibraryGridItem({
  entry,
  resumeHref,
  busy,
  onUpdate,
}: {
  entry: LibraryEntry;
  resumeHref: string | undefined;
  busy: boolean;
  onUpdate: (
    entry: LibraryEntry,
    patch: Partial<Pick<LibraryEntry, "status" | "favorite">>,
  ) => Promise<void>;
}) {
  return (
    <article className="library-grid-item library-landscape-card">
      <Link
        className="library-cover"
        href={workHref(entry, resumeHref)}
        aria-label={`Open ${entry.work.title}`}
      >
        <img src={entry.work.coverUrl ?? "/icon.svg"} alt="" loading="lazy" />
      </Link>
      <div className="library-card-body">
        <Link className="library-card-title" href={workHref(entry, resumeHref)}>
          {entry.work.title}
        </Link>
        <span className="library-kind">
          {entry.work.kind.replaceAll("_", " ")}
          {entry.rating != null
            ? ` · My rating ${entry.rating.toFixed(1)}`
            : ""}
        </span>
        <p className="library-card-synopsis">
          {librarySynopsis(entry.work.synopsis)}
        </p>
        <p className="library-card-progress">
          {libraryProgressLabel(entry) ?? "Not started"}
        </p>
        <span className="browse-progress">
          <i style={{ width: `${entry.progress?.positionPercent ?? 0}%` }} />
        </span>
        <div className="library-entry-actions">
          <button
            className={entry.favorite ? "active" : ""}
            aria-label={`${entry.favorite ? "Remove" : "Add"} ${entry.work.title} ${entry.favorite ? "from" : "to"} favorites`}
            disabled={busy}
            onClick={() => void onUpdate(entry, { favorite: !entry.favorite })}
          >
            <Heart fill={entry.favorite ? "currentColor" : "none"} />
          </button>
          <select
            aria-label={`Status for ${entry.work.title}`}
            value={entry.status}
            disabled={busy}
            onChange={(event) =>
              void onUpdate(entry, {
                status: event.target.value as LibraryStatus,
              })
            }
          >
            {LIBRARY_STATUSES.map((item) => (
              <option value={item.value} key={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <Link className="resume-action" href={workHref(entry, resumeHref)}>
            {entry.progress ? "Resume" : "Open"}
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function workHref(entry: LibraryEntry, resumeHref?: string): string {
  if (resumeHref) return resumeHref;
  return entry.work.source.kind === "ANILIST"
    ? `/title/${entry.work.id}?anilistId=${entry.work.source.externalId}`
    : `/title/${entry.work.id}`;
}
