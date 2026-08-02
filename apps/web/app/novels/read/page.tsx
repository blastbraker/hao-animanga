"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import {
  ArrowLeft,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  List,
  Minus,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  api,
  bridgeErrorMessage,
  bridgeJson,
  getActiveBridge,
  type LibraryResponse,
} from "../../../lib/api";
import { recordActivity } from "../../../lib/beta-features";
import {
  normalizeNovelChapterContent,
  normalizeNovelChapters,
  normalizeNovelSummary,
  type NovelChapter,
  type NovelChapterContent,
  type NovelSummary,
} from "../../../lib/novel-response";
import {
  filterNovelChapters,
  novelChapterNavigation,
} from "../../../lib/novel-reader";

type Theme = "paper" | "sepia" | "dark";

export default function NovelReaderPage() {
  const [bridge, setBridge] = useState("");
  const [novel, setNovel] = useState<NovelSummary | null>(null);
  const [chapters, setChapters] = useState<NovelChapter[]>([]);
  const [content, setContent] = useState<NovelChapterContent | null>(null);
  const [busy, setBusy] = useState("Opening chapter…");
  const [chapterBusy, setChapterBusy] = useState(false);
  const [error, setError] = useState("");
  const [fontSize, setFontSize] = useState(19);
  const [lineHeight, setLineHeight] = useState(1.85);
  const [theme, setTheme] = useState<Theme>("paper");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterBrowserOpen, setChapterBrowserOpen] = useState(false);
  const [chapterQuery, setChapterQuery] = useState("");
  const [chapterLimit, setChapterLimit] = useState(120);
  const [progress, setProgress] = useState(0);
  const workId = useRef<string | null>(null);

  const navigation = useMemo(
    () => novelChapterNavigation(chapters, content?.chapterId),
    [chapters, content?.chapterId],
  );
  const currentPosition = navigation.currentIndex;
  const previousChapter = navigation.previous;
  const nextChapter = navigation.next;
  const filteredChapters = useMemo(
    () => filterNovelChapters(chapters, chapterQuery),
    [chapterQuery, chapters],
  );
  const visibleChapters = filteredChapters.slice(0, chapterLimit);

  useEffect(() => setChapterLimit(120), [chapterQuery]);

  useEffect(() => {
    document.body.classList.add("novel-reader-immersive");
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("hao:novel-reader-settings") || "{}",
      ) as { fontSize?: number; lineHeight?: number; theme?: Theme };
      if (typeof saved.fontSize === "number")
        setFontSize(Math.max(16, Math.min(28, saved.fontSize)));
      if (typeof saved.lineHeight === "number")
        setLineHeight(Math.max(1.45, Math.min(2.3, saved.lineHeight)));
      if (
        saved.theme === "paper" ||
        saved.theme === "sepia" ||
        saved.theme === "dark"
      )
        setTheme(saved.theme);
    } catch {
      /* Defaults remain available when storage is blocked. */
    }
    return () => document.body.classList.remove("novel-reader-immersive");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const parameters = new URLSearchParams(window.location.search);
    const novelId = parameters.get("novelId");
    const chapterId = parameters.get("chapterId");
    if (!novelId || !chapterId) {
      setBusy("");
      setError("Choose a novel chapter from the Novels tab first.");
      return;
    }
    void getActiveBridge()
      .then(async (access) => {
        if (cancelled) return;
        setBridge(access.endpoint);
        const [novelPayload, chapterPayload, contentPayload] =
          await Promise.all([
            bridgeJson<unknown>(
              access.endpoint,
              `/v1/novel/${encodeURIComponent(novelId)}`,
            ),
            bridgeJson<unknown>(
              access.endpoint,
              `/v1/novel/${encodeURIComponent(novelId)}/chapters`,
            ),
            bridgeJson<unknown>(
              access.endpoint,
              `/v1/novel/chapters/${encodeURIComponent(chapterId)}`,
            ),
          ]);
        if (cancelled) return;
        const normalizedNovel = normalizeNovelSummary(novelPayload);
        const normalizedContent = normalizeNovelChapterContent(contentPayload);
        if (!normalizedNovel || !normalizedContent)
          throw new Error("This source returned invalid novel chapter data.");
        const normalizedChapters = normalizeNovelChapters(chapterPayload);
        setNovel(normalizedNovel);
        setChapters(normalizedChapters);
        setContent(normalizedContent);
        const savedPosition = Number(
          window.localStorage.getItem(`hao:novel-position:${chapterId}`) || "0",
        );
        window.requestAnimationFrame(() =>
          window.scrollTo({
            top: Math.max(
              0,
              (document.documentElement.scrollHeight - window.innerHeight) *
                Math.min(1, savedPosition / 100),
            ),
          }),
        );
        void addToLibrary(
          normalizedNovel,
          normalizedChapters.find((chapter) => chapter.id === chapterId),
        ).catch(() => undefined);
        recordActivity({
          id: `novel:${normalizedNovel.sourceId}:${normalizedNovel.id}`,
          kind: "read",
          title: normalizedNovel.title,
          detail: normalizedContent.title,
          href: window.location.pathname + window.location.search,
          sourceName: "Novel extension",
          progressPercent: savedPosition,
        });
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            bridgeErrorMessage(cause, "This chapter could not be opened."),
          );
      })
      .finally(() => {
        if (!cancelled) setBusy("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!content) return;
    let timer: number | undefined;
    function onScroll() {
      const maximum = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const percent = Math.max(
        0,
        Math.min(100, Math.round((window.scrollY / maximum) * 1000) / 10),
      );
      setProgress(percent);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        window.localStorage.setItem(
          `hao:novel-position:${content!.chapterId}`,
          String(percent),
        );
        const chapter = chapters.find((item) => item.id === content!.chapterId);
        if (workId.current && chapter)
          void api("/progress", {
            method: "PUT",
            body: JSON.stringify({
              workId: workId.current,
              releaseItemId: null,
              completedUnits: chapter.index + 1,
              positionSeconds: null,
              positionPercent: percent,
            }),
          }).catch(() => undefined);
      }, 700);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [chapters, content]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "hao:novel-reader-settings",
        JSON.stringify({ fontSize, lineHeight, theme }),
      );
    } catch {
      /* Reader controls still work for this session. */
    }
  }, [fontSize, lineHeight, theme]);

  const chapterHref = useCallback(
    (chapter: NovelChapter) => {
      const parameters = new URLSearchParams({
        sourceId: chapter.sourceId,
        novelId: chapter.novelId,
        chapterId: chapter.id,
        title: novel?.title ?? "Novel",
      });
      return `/novels/read?${parameters.toString()}`;
    },
    [novel?.title],
  );

  const openChapter = useCallback(
    async (
      chapter: NovelChapter,
      historyMode: "push" | "replace" | "none" = "push",
    ) => {
      if (!bridge || chapter.id === content?.chapterId || chapterBusy) return;
      setChapterBusy(true);
      setError("");
      if (content)
        window.localStorage.setItem(
          `hao:novel-position:${content.chapterId}`,
          String(progress),
        );
      try {
        const payload = await bridgeJson<unknown>(
          bridge,
          `/v1/novel/chapters/${encodeURIComponent(chapter.id)}`,
        );
        const normalized = normalizeNovelChapterContent(payload);
        if (!normalized)
          throw new Error("This source returned invalid novel chapter data.");
        setContent(normalized);
        setChapterBrowserOpen(false);
        const href = chapterHref(chapter);
        if (historyMode === "push") window.history.pushState({}, "", href);
        if (historyMode === "replace")
          window.history.replaceState({}, "", href);
        const savedPosition = Number(
          window.localStorage.getItem(`hao:novel-position:${chapter.id}`) ||
            "0",
        );
        setProgress(savedPosition);
        window.requestAnimationFrame(() =>
          window.scrollTo({
            top: Math.max(
              0,
              (document.documentElement.scrollHeight - window.innerHeight) *
                Math.min(1, savedPosition / 100),
            ),
            behavior: "auto",
          }),
        );
        if (novel)
          recordActivity({
            id: `novel:${novel.sourceId}:${novel.id}`,
            kind: "read",
            title: novel.title,
            detail: normalized.title,
            href,
            sourceName: "Novel extension",
            progressPercent: savedPosition,
          });
      } catch (cause) {
        setError(
          bridgeErrorMessage(cause, "This chapter could not be opened."),
        );
      } finally {
        setChapterBusy(false);
      }
    },
    [bridge, chapterBusy, chapterHref, content, novel, progress],
  );

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.key === "ArrowLeft" && previousChapter) {
        event.preventDefault();
        void openChapter(previousChapter);
      }
      if (event.key === "ArrowRight" && nextChapter) {
        event.preventDefault();
        void openChapter(nextChapter);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [nextChapter, openChapter, previousChapter]);

  useEffect(() => {
    function restoreFromHistory() {
      const chapterId = new URLSearchParams(window.location.search).get(
        "chapterId",
      );
      const chapter = chapters.find((item) => item.id === chapterId);
      if (chapter) void openChapter(chapter, "none");
    }
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, [chapters, openChapter]);

  async function addToLibrary(item: NovelSummary, chapter?: NovelChapter) {
    const imported = await api<{ work: Work }>("/works/import-extension", {
      method: "POST",
      body: JSON.stringify({
        kind: "LIGHT_NOVEL",
        sourceId: item.sourceId,
        externalId: item.id,
        title: item.title,
        synopsis: item.description ?? "",
        coverUrl: item.imageUrl ?? null,
        status: item.status ?? null,
        genres: item.genres,
      }),
    });
    workId.current = imported.work.id;
    const library = await api<LibraryResponse>("/library");
    const existing = library.items.find(
      (entry) => entry.work.id === imported.work.id,
    );
    await api("/library", {
      method: "PUT",
      body: JSON.stringify({
        workId: imported.work.id,
        status:
          !existing || existing.status === "PLANNING"
            ? "WATCHING_READING"
            : existing.status,
        favorite: existing?.favorite ?? false,
        rating: existing?.rating ?? null,
        notes: existing?.notes ?? "",
      }),
    });
    if (chapter)
      await api("/progress", {
        method: "PUT",
        body: JSON.stringify({
          workId: imported.work.id,
          releaseItemId: null,
          completedUnits: chapter.index + 1,
          positionSeconds: null,
          positionPercent: progress,
        }),
      });
  }

  if (busy)
    return (
      <div className="novel-reader-loading">
        <BookMarked />
        <p>{busy}</p>
      </div>
    );
  if (error || !content || !novel)
    return (
      <div className="novel-reader-loading error">
        <TriangleAlert />
        <h1>Chapter unavailable</h1>
        <p>{error || "This chapter could not be loaded."}</p>
        <Link className="button ghost" href="/novels">
          Back to Novels
        </Link>
      </div>
    );

  return (
    <div className={`novel-reader-page theme-${theme}`}>
      <aside className="novel-reader-tools" aria-label="Novel reader controls">
        <Link href="/novels" aria-label="Back to novels" title="Back to novels">
          <ArrowLeft />
        </Link>
        <button
          aria-label="Browse chapters"
          title="Browse chapters"
          className={chapterBrowserOpen ? "active" : ""}
          onClick={() => {
            setSettingsOpen(false);
            setChapterBrowserOpen((value) => !value);
          }}
        >
          <List />
        </button>
        <button
          aria-label="Reader settings"
          title="Reader settings"
          className={settingsOpen ? "active" : ""}
          onClick={() => {
            setChapterBrowserOpen(false);
            setSettingsOpen((value) => !value);
          }}
        >
          <Settings2 />
        </button>
        <button
          aria-label="Decrease text size"
          title="Decrease text size"
          disabled={fontSize <= 16}
          onClick={() => setFontSize((value) => Math.max(16, value - 1))}
        >
          <Minus />
        </button>
        <button
          aria-label="Increase text size"
          title="Increase text size"
          disabled={fontSize >= 28}
          onClick={() => setFontSize((value) => Math.min(28, value + 1))}
        >
          <Plus />
        </button>
        <button
          aria-label="Toggle reader theme"
          title="Toggle reader theme"
          onClick={() =>
            setTheme((value) =>
              value === "dark" ? "paper" : value === "paper" ? "sepia" : "dark",
            )
          }
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
        <span>{Math.round(progress)}%</span>
      </aside>
      {settingsOpen && (
        <section className="novel-reader-settings" aria-label="Reader settings">
          <label>
            Text size{" "}
            <input
              type="range"
              min="16"
              max="28"
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </label>
          <label>
            Line spacing{" "}
            <input
              type="range"
              min="1.45"
              max="2.3"
              step="0.05"
              value={lineHeight}
              onChange={(event) => setLineHeight(Number(event.target.value))}
            />
          </label>
          <label>
            Theme{" "}
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
            >
              <option value="paper">Paper</option>
              <option value="sepia">Sepia</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </section>
      )}
      {chapterBrowserOpen && (
        <section
          className="novel-chapter-browser"
          aria-label="Search and choose a chapter"
        >
          <header>
            <div>
              <strong>Chapters</strong>
              <span>{chapters.length.toLocaleString()} available</span>
            </div>
            <button
              aria-label="Close chapter browser"
              onClick={() => setChapterBrowserOpen(false)}
            >
              <X />
            </button>
          </header>
          <label className="novel-chapter-search">
            <Search />
            <input
              autoFocus
              type="search"
              value={chapterQuery}
              placeholder="Search title or chapter number…"
              onChange={(event) => setChapterQuery(event.target.value)}
            />
          </label>
          <div className="novel-chapter-browser-results">
            {visibleChapters.map((chapter) => {
              const position = chapters.indexOf(chapter);
              const active = chapter.id === content.chapterId;
              return (
                <a
                  key={chapter.id}
                  href={chapterHref(chapter)}
                  className={active ? "active" : ""}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    void openChapter(chapter);
                  }}
                >
                  <span>{position + 1}</span>
                  <strong>{chapter.title}</strong>
                  {active && <small>Reading</small>}
                </a>
              );
            })}
            {visibleChapters.length === 0 && (
              <p>No chapters match “{chapterQuery}”.</p>
            )}
            {visibleChapters.length < filteredChapters.length && (
              <button onClick={() => setChapterLimit((value) => value + 200)}>
                Show 200 more
              </button>
            )}
          </div>
          <footer>
            Showing {visibleChapters.length.toLocaleString()} of{" "}
            {filteredChapters.length.toLocaleString()}
          </footer>
        </section>
      )}
      {chapterBusy && (
        <div className="novel-reader-chapter-loading" role="status">
          Opening chapter…
        </div>
      )}
      <header className="novel-reader-heading">
        <span>{novel.title}</span>
        <b>{content.title}</b>
      </header>
      <article className="novel-reader-sheet" style={{ fontSize, lineHeight }}>
        <h1>{content.title}</h1>
        <div
          className="novel-reader-content"
          dangerouslySetInnerHTML={{ __html: content.html }}
        />
      </article>
      <nav className="novel-reader-navigation" aria-label="Chapter navigation">
        {previousChapter ? (
          <Link
            href={chapterHref(previousChapter)}
            aria-disabled={chapterBusy}
            onClick={(event) => {
              event.preventDefault();
              void openChapter(previousChapter);
            }}
          >
            <ChevronLeft /> Previous chapter
          </Link>
        ) : (
          <span />
        )}
        <span>
          {currentPosition + 1} of {chapters.length}
        </span>
        {nextChapter ? (
          <Link
            href={chapterHref(nextChapter)}
            aria-disabled={chapterBusy}
            onClick={(event) => {
              event.preventDefault();
              void openChapter(nextChapter);
            }}
          >
            Next chapter <ChevronRight />
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
