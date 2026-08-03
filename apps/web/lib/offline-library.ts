import { api, bridgeFetch } from "./api";

const CACHE_NAME = "hao-offline-library-v1";
const METADATA_KEY = "hao:offline-library-v1";
const syntheticOrigin = "https://offline.hao.invalid";

export type OfflineItem = {
  key: string;
  kind: "MANGA_CHAPTER" | "EPUB";
  title: string;
  releaseLabel: string;
  byteSize: number;
  itemCount: number;
  savedAt: string;
  snapshot?: unknown;
};

export function parseOfflineItems(raw: string | null): OfflineItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is OfflineItem => Boolean(item && typeof item === "object" && typeof (item as OfflineItem).key === "string"));
  } catch {
    return [];
  }
}

function metadata(): OfflineItem[] {
  return parseOfflineItems(window.localStorage.getItem(METADATA_KEY));
}

function storeMetadata(item: OfflineItem) {
  const items = [item, ...metadata().filter((current) => current.key !== item.key)].slice(0, 200);
  window.localStorage.setItem(METADATA_KEY, JSON.stringify(items));
}

function requestFor(key: string, position: number | "file") {
  return new Request(`${syntheticOrigin}/${encodeURIComponent(key)}/${position}`);
}

export function mangaOfflineKey(sourceId: string, mangaId: string | number, chapterIndex: number) {
  return `manga:${sourceId}:${mangaId}:${chapterIndex}`;
}

export async function cacheMangaChapter(input: {
  key: string;
  title: string;
  releaseLabel: string;
  bridge: string;
  pageUrls: string[];
  snapshot: unknown;
  onProgress?: (completed: number, total: number) => void;
}): Promise<OfflineItem> {
  if (!("caches" in window)) throw new Error("Offline storage is not supported by this browser.");
  const cache = await caches.open(CACHE_NAME);
  let byteSize = 0;
  for (let index = 0; index < input.pageUrls.length; index += 1) {
    const pageUrl = input.pageUrls[index]!;
    const response = await bridgeFetch(input.bridge, pageUrl);
    if (!response.ok) throw new Error(`Page ${index + 1} could not be downloaded.`);
    const blob = await response.blob();
    byteSize += blob.size;
    await cache.put(requestFor(input.key, index), new Response(blob, { headers: { "content-type": blob.type || "image/jpeg" } }));
    input.onProgress?.(index + 1, input.pageUrls.length);
  }
  const item: OfflineItem = {
    key: input.key,
    kind: "MANGA_CHAPTER",
    title: input.title,
    releaseLabel: input.releaseLabel,
    byteSize,
    itemCount: input.pageUrls.length,
    savedAt: new Date().toISOString(),
    snapshot: input.snapshot,
  };
  storeMetadata(item);
  return item;
}

export async function loadCachedMangaChapter<T>(key: string): Promise<{ item: OfflineItem; snapshot: T; pageUrls: string[] } | null> {
  const item = metadata().find((candidate) => candidate.key === key && candidate.kind === "MANGA_CHAPTER");
  if (!item?.snapshot || !("caches" in window)) return null;
  const cache = await caches.open(CACHE_NAME);
  const pageUrls: string[] = [];
  for (let index = 0; index < item.itemCount; index += 1) {
    const response = await cache.match(requestFor(key, index));
    if (!response) return null;
    pageUrls.push(URL.createObjectURL(await response.blob()));
  }
  return { item, snapshot: item.snapshot as T, pageUrls };
}

export async function cacheEpubFile(id: string, file: Blob, title: string): Promise<OfflineItem> {
  if (!("caches" in window)) throw new Error("Offline storage is not supported by this browser.");
  const cache = await caches.open(CACHE_NAME);
  await cache.put(requestFor(`epub:${id}`, "file"), new Response(file, { headers: { "content-type": "application/epub+zip" } }));
  const item: OfflineItem = {
    key: `epub:${id}`,
    kind: "EPUB",
    title,
    releaseLabel: "Complete book",
    byteSize: file.size,
    itemCount: 1,
    savedAt: new Date().toISOString(),
  };
  storeMetadata(item);
  return item;
}

export async function getCachedEpubFile(id: string): Promise<Blob | null> {
  if (!("caches" in window)) return null;
  const response = await (await caches.open(CACHE_NAME)).match(requestFor(`epub:${id}`, "file"));
  return response ? response.blob() : null;
}

export async function getOrCacheEpubFile(id: string, title: string): Promise<{ file: Blob; offline: boolean }> {
  const cached = await getCachedEpubFile(id);
  if (cached) return { file: cached, offline: true };
  const { url } = await api<{ url: string }>(`/epubs/${encodeURIComponent(id)}/download`);
  const response = await fetch(url);
  if (!response.ok) throw new Error("The EPUB could not be downloaded.");
  const file = await response.blob();
  await cacheEpubFile(id, file, title);
  return { file, offline: false };
}

export function offlineItems(): OfflineItem[] {
  return typeof window === "undefined" ? [] : metadata();
}

export async function clearOfflineLibrary(): Promise<void> {
  if ("caches" in window) await caches.delete(CACHE_NAME);
  window.localStorage.removeItem(METADATA_KEY);
}

export function offlineBytes(items: OfflineItem[]) {
  return items.reduce((total, item) => total + item.byteSize, 0);
}

