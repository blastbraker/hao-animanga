"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Work } from "@hao/domain";
import {
  ArrowLeft,
  Bookmark,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  List,
  Minus,
  Moon,
  Plus,
  Search,
  Settings2,
  Square,
  Sun,
  TriangleAlert,
  Volume2,
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
  normalizeNovelSearch,
  normalizeNovelSources,
  normalizeNovelSummary,
  type NovelChapter,
  type NovelChapterContent,
  type NovelSummary,
} from "../../../lib/novel-response";
import {
  filterNovelChapters,
  novelChapterNavigation,
} from "../../../lib/novel-reader";
import {
  NOVEL_BOOKMARKS_KEY,
  NOVEL_READ_KEY,
  NOVEL_RESUMES_KEY,
  groupNovelChapters,
  markNovelChapterRead,
  novelStorageKey,
  parseNovelBookmarks,
  parseNovelReadState,
  parseNovelResumes,
  updateNovelBookmarks,
  updateNovelResumes,
  type NovelBookmark,
} from "../../../lib/novel-state";
import { confidentSourceMatch, sourceFallbackOrder } from "../../../lib/source-match";
import { getCloudReadingState, saveCloudReadingState } from "../../../lib/cloud-reading";

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
  const [readChapterIds, setReadChapterIds] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<NovelBookmark[]>([]);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState("");
  const [selectedPassage, setSelectedPassage] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [spokenText, setSpokenText] = useState("");
  const [ttsRate, setTtsRate] = useState(1);
  const [ttsVoice, setTtsVoice] = useState("");
  const [ttsSleep, setTtsSleep] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const workId = useRef<string | null>(null);
  const speechGeneration = useRef(0);
  const sleepTimer = useRef<number | undefined>(undefined);

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
  const chapterGroups = useMemo(() => groupNovelChapters(visibleChapters), [visibleChapters]);
  const firstUnread = chapters.find((chapter) => !readChapterIds.has(chapter.id)) ?? null;
  const lastReadPosition = chapters.reduce((latest, chapter, index) => readChapterIds.has(chapter.id) ? Math.max(latest, index) : latest, -1);
  const novelKey = novel ? novelStorageKey(novel.sourceId, novel.id) : "";

  useEffect(() => setChapterLimit(120), [chapterQuery]);

  useEffect(() => {
    document.body.classList.add("novel-reader-immersive");
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("hao:novel-reader-settings") || "{}",
      ) as { fontSize?: number; lineHeight?: number; theme?: Theme; ttsRate?: number; ttsVoice?: string; ttsSleep?: number };
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
      if (typeof saved.ttsRate === "number") setTtsRate(Math.max(0.5, Math.min(2, saved.ttsRate)));
      if (typeof saved.ttsVoice === "string") setTtsVoice(saved.ttsVoice);
      if (typeof saved.ttsSleep === "number") setTtsSleep(saved.ttsSleep);
    } catch {
      /* Defaults remain available when storage is blocked. */
    }
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => {
      document.body.classList.remove("novel-reader-immersive");
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
      window.speechSynthesis?.cancel();
      window.clearTimeout(sleepTimer.current);
    };
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
        let bundle: ChapterBundle;
        try {
          bundle = await loadChapterBundle(access.endpoint, novelId, chapterId);
        } catch (originalError) {
          bundle = await findFallbackChapterBundle(access.endpoint, {
            sourceId: parameters.get("sourceId") ?? "",
            title: parameters.get("title") ?? "",
            chapterIndex: Number(parameters.get("chapterIndex") ?? "-1"),
          }).catch(() => { throw originalError; });
          const fallbackChapter = bundle.chapters.find((chapter) => chapter.id === bundle.content.chapterId);
          if (fallbackChapter) window.history.replaceState({}, "", readerUrl(bundle.novel, fallbackChapter));
        }
        if (cancelled) return;
        const normalizedNovel = bundle.novel;
        const normalizedContent = bundle.content;
        const normalizedChapters = bundle.chapters;
        setNovel(normalizedNovel);
        setChapters(normalizedChapters);
        setContent(normalizedContent);
        const key = novelStorageKey(normalizedNovel.sourceId, normalizedNovel.id);
        const cloud = await getCloudReadingState(`novel:${key}`);
        const cloudSettings = cloud?.state.readerSettings;
        if (cloudSettings && typeof cloudSettings === "object" && !Array.isArray(cloudSettings)) {
          const settings = cloudSettings as Record<string, unknown>;
          if (typeof settings.fontSize === "number") setFontSize(Math.max(16, Math.min(28, settings.fontSize)));
          if (typeof settings.lineHeight === "number") setLineHeight(Math.max(1.45, Math.min(2.3, settings.lineHeight)));
          if (settings.theme === "paper" || settings.theme === "sepia" || settings.theme === "dark") setTheme(settings.theme);
        }
        const localReadState = parseNovelReadState(window.localStorage.getItem(NOVEL_READ_KEY));
        const cloudReadIds = Array.isArray(cloud?.state.readChapterIds) ? cloud.state.readChapterIds.filter((id): id is string => typeof id === "string") : null;
        const mergedReadIds = cloudReadIds ?? localReadState[key] ?? [];
        const localBookmarks = parseNovelBookmarks(window.localStorage.getItem(NOVEL_BOOKMARKS_KEY)).filter((item) => item.novelKey === key);
        const cloudBookmarks = Array.isArray(cloud?.state.bookmarks) ? cloud.state.bookmarks as NovelBookmark[] : null;
        setReadChapterIds(new Set(mergedReadIds));
        setBookmarks(cloudBookmarks ?? localBookmarks);
        const localPosition = Number(
          window.localStorage.getItem(`hao:novel-position:${normalizedContent.chapterId}`) || "0",
        );
        const savedPosition = cloud?.state.chapterId === normalizedContent.chapterId && typeof cloud.positionPercent === "number" ? cloud.positionPercent : localPosition;
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
          normalizedChapters.find((chapter) => chapter.id === normalizedContent.chapterId),
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
        if (novel && chapter) saveResume(novel, chapter, percent, workId.current);
        let nextReadChapterIds = readChapterIds;
        if (novel && chapter && percent >= 90) {
          const key = novelStorageKey(novel.sourceId, novel.id);
          const state = markNovelChapterRead(parseNovelReadState(window.localStorage.getItem(NOVEL_READ_KEY)), key, chapter.id);
          window.localStorage.setItem(NOVEL_READ_KEY, JSON.stringify(state));
          nextReadChapterIds = new Set(state[key] ?? []);
          setReadChapterIds(nextReadChapterIds);
        }
        if (novel && chapter) void syncDetailedNovelState(novel, chapter, percent, nextReadChapterIds, bookmarks);
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
  }, [bookmarks, chapters, content, novel, readChapterIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "hao:novel-reader-settings",
        JSON.stringify({ fontSize, lineHeight, theme, ttsRate, ttsVoice, ttsSleep }),
      );
    } catch {
      /* Reader controls still work for this session. */
    }
    const chapter = chapters.find((item) => item.id === content?.chapterId);
    if (novel && chapter) void syncDetailedNovelState(novel, chapter, progress, readChapterIds, bookmarks);
  }, [fontSize, lineHeight, theme, ttsRate, ttsVoice, ttsSleep]);

  function markRead(chapterId: string) {
    if (!novel) return;
    const key = novelStorageKey(novel.sourceId, novel.id);
    const state = markNovelChapterRead(parseNovelReadState(window.localStorage.getItem(NOVEL_READ_KEY)), key, chapterId);
    window.localStorage.setItem(NOVEL_READ_KEY, JSON.stringify(state));
    setReadChapterIds(new Set(state[key] ?? []));
  }

  function openBookmarkComposer() {
    const selection = window.getSelection()?.toString().replace(/\s+/g, " ").trim().slice(0, 800) ?? "";
    setSelectedPassage(selection);
    setBookmarkNote("");
    setSettingsOpen(false);
    setChapterBrowserOpen(false);
    setBookmarkOpen(true);
  }

  function saveBookmark() {
    if (!novel || !content) return;
    const now = new Date().toISOString();
    const bookmark: NovelBookmark = {
      id: `${content.chapterId}:${Date.now()}`,
      novelKey,
      title: novel.title,
      chapterId: content.chapterId,
      chapterTitle: content.title,
      selectedText: selectedPassage,
      note: bookmarkNote.trim(),
      progressPercent: progress,
      href: window.location.pathname + window.location.search,
      createdAt: now,
    };
    const all = updateNovelBookmarks(parseNovelBookmarks(window.localStorage.getItem(NOVEL_BOOKMARKS_KEY)), bookmark);
    window.localStorage.setItem(NOVEL_BOOKMARKS_KEY, JSON.stringify(all));
    const nextBookmarks = all.filter((item) => item.novelKey === novelKey);
    setBookmarks(nextBookmarks);
    const chapter = chapters.find((item) => item.id === content.chapterId);
    if (chapter) void syncDetailedNovelState(novel, chapter, progress, readChapterIds, nextBookmarks);
    setSelectedPassage("");
    setBookmarkNote("");
  }

  function removeBookmark(id: string) {
    const all = parseNovelBookmarks(window.localStorage.getItem(NOVEL_BOOKMARKS_KEY)).filter((item) => item.id !== id);
    window.localStorage.setItem(NOVEL_BOOKMARKS_KEY, JSON.stringify(all));
    const nextBookmarks = all.filter((item) => item.novelKey === novelKey);
    setBookmarks(nextBookmarks);
    const chapter = chapters.find((item) => item.id === content?.chapterId);
    if (novel && chapter) void syncDetailedNovelState(novel, chapter, progress, readChapterIds, nextBookmarks);
  }

  function stopSpeaking() {
    speechGeneration.current += 1;
    window.speechSynthesis?.cancel();
    window.clearTimeout(sleepTimer.current);
    setSpeaking(false);
    setSpokenText("");
  }

  function toggleSpeaking() {
    if (speaking) {
      stopSpeaking();
      return;
    }
    const selected = window.getSelection()?.toString().trim();
    const fullText = document.querySelector(".novel-reader-content")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const text = selected || fullText;
    if (!text || !window.speechSynthesis) return;
    const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((item) => item.trim()).filter(Boolean) ?? [text];
    const generation = ++speechGeneration.current;
    setSpeaking(true);
    if (ttsSleep > 0) sleepTimer.current = window.setTimeout(stopSpeaking, ttsSleep * 60_000);
    const speak = (index: number) => {
      if (generation !== speechGeneration.current || index >= chunks.length) {
        if (generation === speechGeneration.current) stopSpeaking();
        return;
      }
      const chunk = chunks[index]!.slice(0, 500);
      setSpokenText(chunk);
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.rate = ttsRate;
      utterance.voice = voices.find((voice) => voice.name === ttsVoice) ?? null;
      utterance.onend = () => speak(index + 1);
      utterance.onerror = () => stopSpeaking();
      window.speechSynthesis.speak(utterance);
    };
    speak(0);
  }

  const chapterHref = useCallback(
    (chapter: NovelChapter) => {
      const parameters = new URLSearchParams({
        sourceId: chapter.sourceId,
        novelId: chapter.novelId,
        chapterId: chapter.id,
        chapterIndex: String(chapter.index),
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
      if (content && progress >= 90) markRead(content.chapterId);
      stopSpeaking();
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
        if (novel) saveResume(novel, chapter, savedPosition, workId.current);
      } catch (cause) {
        try {
          const fallback = await findFallbackChapterBundle(bridge, {
            sourceId: novel?.sourceId ?? chapter.sourceId,
            title: novel?.title ?? "",
            chapterIndex: chapter.index,
          });
          const fallbackChapter = fallback.chapters.find((item) => item.id === fallback.content.chapterId)!;
          setNovel(fallback.novel);
          setChapters(fallback.chapters);
          setContent(fallback.content);
          const href = readerUrl(fallback.novel, fallbackChapter);
          window.history.pushState({}, "", href);
          setError("");
          window.scrollTo({ top: 0, behavior: "auto" });
          saveResume(fallback.novel, fallbackChapter, 0, workId.current);
        } catch {
          setError(bridgeErrorMessage(cause, "This chapter could not be opened from any installed source."));
        }
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

  function syncDetailedNovelState(
    item: NovelSummary,
    chapter: NovelChapter,
    positionPercent: number,
    readIds: Set<string>,
    savedBookmarks: NovelBookmark[],
  ) {
    const key = novelStorageKey(item.sourceId, item.id);
    return saveCloudReadingState({
      contentKey: `novel:${key}`,
      mediaKind: "NOVEL",
      workId: workId.current,
      title: item.title,
      releaseLabel: chapter.title,
      positionPercent,
      completed: positionPercent >= 95,
      state: {
        sourceId: item.sourceId,
        novelId: item.id,
        chapterId: chapter.id,
        chapterIndex: chapter.index,
        href: readerUrl(item, chapter),
        readChapterIds: [...readIds],
        bookmarks: savedBookmarks,
        readerSettings: { fontSize, lineHeight, theme, ttsRate, ttsVoice, ttsSleep },
      },
    });
  }

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
    if (chapter) saveResume(item, chapter, progress, imported.work.id);
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
  if (!content || !novel)
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
          aria-label="Save a bookmark or highlight"
          title="Save bookmark or selected passage"
          className={bookmarkOpen ? "active" : ""}
          onClick={openBookmarkComposer}
        >
          <Bookmark />
        </button>
        <button
          aria-label={speaking ? "Stop text to speech" : "Read chapter aloud"}
          title={speaking ? "Stop reading" : "Read aloud"}
          className={speaking ? "active" : ""}
          onClick={toggleSpeaking}
        >
          {speaking ? <Square /> : <Volume2 />}
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
          <label>
            Reading voice{" "}
            <select value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)}>
              <option value="">System default</option>
              {voices.map((voice) => <option key={voice.voiceURI} value={voice.name}>{voice.name} ({voice.lang})</option>)}
            </select>
          </label>
          <label>
            Voice speed{" "}
            <select value={ttsRate} onChange={(event) => setTtsRate(Number(event.target.value))}>
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
            </select>
          </label>
          <label>
            Sleep timer{" "}
            <select value={ttsSleep} onChange={(event) => setTtsSleep(Number(event.target.value))}>
              <option value={0}>Off</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option>
            </select>
          </label>
        </section>
      )}
      {bookmarkOpen && (
        <section className="novel-bookmark-panel" aria-label="Bookmarks, highlights, and notes">
          <header><div><strong>Bookmarks & notes</strong><span>Select text first to save it as a highlight.</span></div><button aria-label="Close bookmarks" onClick={() => setBookmarkOpen(false)}><X /></button></header>
          {selectedPassage && <blockquote>{selectedPassage}</blockquote>}
          <textarea value={bookmarkNote} onChange={(event) => setBookmarkNote(event.target.value)} placeholder="Add an optional note…" />
          <button className="button primary" onClick={saveBookmark}><Bookmark /> Save this place</button>
          <div className="novel-bookmark-list">
            {bookmarks.map((item) => <article key={item.id}><a href={item.href}><b>{item.chapterTitle}</b><small>{Math.round(item.progressPercent)}% through chapter</small></a>{item.selectedText && <p>“{item.selectedText}”</p>}{item.note && <p>{item.note}</p>}<button aria-label="Delete bookmark" onClick={() => removeBookmark(item.id)}><X /></button></article>)}
            {!bookmarks.length && <p>Your saved passages and notes will appear here.</p>}
          </div>
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
          {firstUnread && <button className="novel-first-unread" onClick={() => void openChapter(firstUnread)}>Jump to first unread</button>}
          <div className="novel-chapter-browser-results">
            {chapterGroups.map((group) => <section className="novel-volume-group" key={group.label}><h3>{group.label}</h3>{group.chapters.map((chapter) => {
              const position = chapters.indexOf(chapter);
              const active = chapter.id === content.chapterId;
              const read = readChapterIds.has(chapter.id);
              const isNew = lastReadPosition >= 0 && position > lastReadPosition;
              return (
                <a
                  key={chapter.id}
                  href={chapterHref(chapter)}
                  className={`${active ? "active" : ""} ${read ? "read" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    void openChapter(chapter);
                  }}
                >
                  <span>{position + 1}</span>
                  <strong>{chapter.title}</strong>
                  <small>{active ? "Reading" : read ? "Read" : isNew ? "New" : "Unread"}</small>
                </a>
              );
            })}</section>)}
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
      {error && <div className="novel-reader-inline-error" role="alert"><TriangleAlert /> {error}</div>}
      {speaking && spokenText && <div className="novel-tts-current" role="status"><Volume2 /><span>{spokenText}</span></div>}
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

type ChapterBundle = { novel: NovelSummary; chapters: NovelChapter[]; content: NovelChapterContent };

async function loadChapterBundle(endpoint: string, novelId: string, chapterId: string): Promise<ChapterBundle> {
  const [novelPayload, chapterPayload, contentPayload] = await Promise.all([
    bridgeJson<unknown>(endpoint, `/v1/novel/${encodeURIComponent(novelId)}`),
    bridgeJson<unknown>(endpoint, `/v1/novel/${encodeURIComponent(novelId)}/chapters`),
    bridgeJson<unknown>(endpoint, `/v1/novel/chapters/${encodeURIComponent(chapterId)}`),
  ]);
  const novel = normalizeNovelSummary(novelPayload);
  const content = normalizeNovelChapterContent(contentPayload);
  const chapters = normalizeNovelChapters(chapterPayload);
  if (!novel || !content) throw new Error("This source returned invalid novel chapter data.");
  return { novel, chapters, content };
}

async function findFallbackChapterBundle(endpoint: string, request: { sourceId: string; title: string; chapterIndex: number }): Promise<ChapterBundle> {
  if (!request.title || !Number.isInteger(request.chapterIndex) || request.chapterIndex < 0) throw new Error("Chapter fallback needs a title and chapter number.");
  const sources = normalizeNovelSources(await bridgeJson<unknown>(endpoint, "/v1/novel/sources"));
  for (const source of sourceFallbackOrder(sources, request.sourceId).filter((item) => item.id !== request.sourceId)) {
    const parameters = new URLSearchParams({ sourceId: source.id, mode: "search", query: request.title, page: "1" });
    try {
      const results = normalizeNovelSearch(await bridgeJson<unknown>(endpoint, `/v1/novel/catalog?${parameters.toString()}`));
      const match = confidentSourceMatch({ title: request.title, alternateTitles: [] }, results.items);
      if (!match) continue;
      const chapters = normalizeNovelChapters(await bridgeJson<unknown>(endpoint, `/v1/novel/${encodeURIComponent(match.id)}/chapters`));
      const target = chapters.find((chapter) => chapter.index === request.chapterIndex) ?? chapters[request.chapterIndex];
      if (!target) continue;
      return await loadChapterBundle(endpoint, match.id, target.id);
    } catch {
      // Continue through installed sources until one can provide this chapter.
    }
  }
  throw new Error("No installed source could provide this chapter.");
}

function readerUrl(novel: NovelSummary, chapter: NovelChapter) {
  const parameters = new URLSearchParams({ sourceId: novel.sourceId, novelId: novel.id, chapterId: chapter.id, chapterIndex: String(chapter.index), title: novel.title });
  return `/novels/read?${parameters.toString()}`;
}

function saveResume(novel: NovelSummary, chapter: NovelChapter, progressPercent: number, workId: string | null) {
  const key = novelStorageKey(novel.sourceId, novel.id);
  const resumes = updateNovelResumes(parseNovelResumes(window.localStorage.getItem(NOVEL_RESUMES_KEY)), {
    id: key,
    novelKey: key,
    workId,
    title: novel.title,
    chapterTitle: chapter.title,
    chapterIndex: chapter.index,
    progressPercent,
    href: readerUrl(novel, chapter),
    coverUrl: novel.imageUrl ?? null,
    updatedAt: new Date().toISOString(),
  });
  window.localStorage.setItem(NOVEL_RESUMES_KEY, JSON.stringify(resumes));
}
