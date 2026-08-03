"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Work } from "@hao/domain";
import { ArrowLeft, BookOpenText, ChevronLeft, ChevronRight, Cloud, Minus, Moon, Plus, Sun, TriangleAlert } from "lucide-react";
import { api } from "../../../../lib/api";
import { getCloudReadingState, saveCloudReadingState } from "../../../../lib/cloud-reading";
import { getOrCacheEpubFile, offlineItems } from "../../../../lib/offline-library";

type EpubAsset = {
  id: string;
  originalName: string;
  manifest: { title?: string; creator?: string };
  work: Work | null;
};
type EpubLocation = {
  start?: { cfi?: string; href?: string; percentage?: number; displayed?: { page?: number; total?: number } };
};
type TocItem = { href: string; label: string };

export default function EpubReaderPage() {
  const { id } = useParams<{ id: string }>();
  const viewer = useRef<HTMLDivElement>(null);
  const rendition = useRef<{ display: (target?: string) => Promise<unknown>; next: () => Promise<unknown>; prev: () => Promise<unknown>; themes: { fontSize: (value: string) => void; select: (name: string) => void; register: (name: string, rules: Record<string, unknown>) => void }; on: (name: string, callback: (value: EpubLocation) => void) => void } | null>(null);
  const currentCfi = useRef<string | null>(null);
  const readerSettings = useRef<{ fontSize: number; theme: "paper" | "dark" }>({ fontSize: 100, theme: "paper" });
  const [asset, setAsset] = useState<EpubAsset | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [fontSize, setFontSize] = useState(100);
  const [theme, setTheme] = useState<"paper" | "dark">("paper");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Opening your EPUB…");
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.classList.add("novel-reader-immersive");
    let cancelled = false;
    let book: { destroy: () => void } | null = null;
    void api<{ items: EpubAsset[] }>("/epubs").catch(() => {
      const cached = offlineItems().find((item) => item.key === `epub:${id}`);
      if (!cached) throw new Error("This EPUB has not been saved on this device.");
      return { items: [{ id, originalName: cached.title, manifest: { title: cached.title }, work: null }] };
    })
      .then(async ({ items }) => {
        const selected = items.find((item) => item.id === id);
        if (!selected) throw new Error("This EPUB is not in your private library.");
        if (cancelled || !viewer.current) return;
        setAsset(selected);
        const title = selected.work?.title || selected.manifest.title || selected.originalName;
        const [{ file, offline }, cloud, module] = await Promise.all([
          getOrCacheEpubFile(id, title),
          getCloudReadingState(`epub:${id}`),
          import("epubjs"),
        ]);
        if (cancelled || !viewer.current) return;
        const createBook = module.default;
        const loadedBook = createBook(await file.arrayBuffer());
        book = loadedBook;
        const navigation = await loadedBook.loaded.navigation;
        setToc((navigation.toc ?? []).map((item: { href: string; label: string }) => ({ href: item.href, label: item.label })));
        const rendered = loadedBook.renderTo(viewer.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto" });
        rendition.current = rendered;
        rendered.themes.register("paper", { body: { background: "#f3efe4", color: "#25231f" }, a: { color: "#7c5148" } });
        rendered.themes.register("dark", { body: { background: "#11131a", color: "#e7e9ef" }, a: { color: "#60efe3" } });
        const cloudReaderSettings = cloud?.state.readerSettings;
        const savedFont = cloudReaderSettings && typeof cloudReaderSettings === "object" && typeof (cloudReaderSettings as Record<string, unknown>).fontSize === "number" ? Number((cloudReaderSettings as Record<string, unknown>).fontSize) : 100;
        const savedTheme = cloudReaderSettings && typeof cloudReaderSettings === "object" && (cloudReaderSettings as Record<string, unknown>).theme === "dark" ? "dark" : "paper";
        setFontSize(savedFont);
        setTheme(savedTheme);
        readerSettings.current = { fontSize: savedFont, theme: savedTheme };
        rendered.themes.fontSize(`${savedFont}%`);
        rendered.themes.select(savedTheme);
        rendered.on("relocated", (location: EpubLocation) => {
          currentCfi.current = location.start?.cfi ?? null;
          const position = Math.max(0, Math.min(100, (location.start?.percentage ?? 0) * 100));
          setProgress(position);
          void saveCloudReadingState({
            contentKey: `epub:${id}`,
            mediaKind: "EPUB",
            workId: selected.work?.id ?? null,
            title,
            releaseLabel: location.start?.href ?? "EPUB",
            positionPercent: position,
            completed: position >= 98,
            state: { cfi: location.start?.cfi ?? null, href: `/novels/epub/${id}`, readerSettings: readerSettings.current },
          });
        });
        const cfi = typeof cloud?.state.cfi === "string" ? cloud.state.cfi : undefined;
        await rendered.display(cfi);
        if (selected.work) {
          const library = await api<{ items: Array<{ work: Work; status: string; favorite: boolean; rating: number | null; notes: string }> }>("/library");
          const existing = library.items.find((entry) => entry.work.id === selected.work!.id);
          await api("/library", { method: "PUT", body: JSON.stringify({ workId: selected.work.id, status: existing?.status === "COMPLETED" ? "COMPLETED" : "WATCHING_READING", favorite: existing?.favorite ?? false, rating: existing?.rating ?? null, notes: existing?.notes ?? "" }) });
        }
        setStatus(offline ? "Available offline" : "Downloaded for offline reading");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "The EPUB could not be opened."));
    return () => {
      cancelled = true;
      document.body.classList.remove("novel-reader-immersive");
      book?.destroy();
    };
  }, [id]);

  function changeFont(delta: number) {
    const next = Math.max(75, Math.min(160, fontSize + delta));
    setFontSize(next);
    readerSettings.current = { fontSize: next, theme };
    rendition.current?.themes.fontSize(`${next}%`);
    saveReaderPreferences(next, theme);
  }

  function changeTheme(next: "paper" | "dark") {
    setTheme(next);
    readerSettings.current = { fontSize, theme: next };
    rendition.current?.themes.select(next);
    saveReaderPreferences(fontSize, next);
  }

  function saveReaderPreferences(nextFont: number, nextTheme: "paper" | "dark") {
    if (!asset) return;
    void saveCloudReadingState({ contentKey: `epub:${id}`, mediaKind: "EPUB", workId: asset.work?.id ?? null, title: asset.work?.title || asset.manifest.title || asset.originalName, releaseLabel: "EPUB", positionPercent: progress, completed: progress >= 98, state: { cfi: currentCfi.current, href: `/novels/epub/${id}`, readerSettings: { fontSize: nextFont, theme: nextTheme } } });
  }

  return (
    <div className={`epub-reader ${theme}`}>
      <header className="epub-toolbar">
        <Link href="/novels" aria-label="Back to novels"><ArrowLeft /></Link>
        <div><b>{asset?.work?.title || asset?.manifest.title || "EPUB reader"}</b><span><Cloud /> {status}</span></div>
        <label><BookOpenText /><select aria-label="Table of contents" defaultValue="" onChange={(event) => void rendition.current?.display(event.target.value)}><option value="" disabled>Chapters</option>{toc.map((item) => <option value={item.href} key={item.href}>{item.label}</option>)}</select></label>
        <button aria-label="Decrease text size" onClick={() => changeFont(-10)}><Minus /></button>
        <button aria-label="Increase text size" onClick={() => changeFont(10)}><Plus /></button>
        <button aria-label={theme === "paper" ? "Use dark theme" : "Use paper theme"} onClick={() => changeTheme(theme === "paper" ? "dark" : "paper")}>{theme === "paper" ? <Moon /> : <Sun />}</button>
      </header>
      {error ? <div className="epub-error" role="alert"><TriangleAlert /><h1>Couldn’t open this book</h1><p>{error}</p><Link className="button primary" href="/novels">Return to novels</Link></div> : <div className="epub-stage" ref={viewer} aria-label="EPUB pages" />}
      {!error && <footer className="epub-navigation"><button onClick={() => void rendition.current?.prev()}><ChevronLeft /> Previous</button><span>{Math.round(progress)}%</span><button onClick={() => void rendition.current?.next()}>Next <ChevronRight /></button></footer>}
    </div>
  );
}
