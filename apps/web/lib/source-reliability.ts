import { normalizeTitle } from "@hao/domain";

export const SOURCE_RELIABILITY_STORAGE_KEY = "hao:source-reliability:v1";

export type SourceKind = "anime" | "manga";
export type SourceReliabilityRecord = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  averageLatencyMs: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};
export type SourceReliabilityMap = Record<string, SourceReliabilityRecord>;

export function sourceReliabilityKey(kind: SourceKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

export function parseSourceReliability(raw: string | null): SourceReliabilityMap {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Partial<SourceReliabilityRecord>;
        const number = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : 0;
        return [[key, {
          successes: number(record.successes),
          failures: number(record.failures),
          consecutiveFailures: number(record.consecutiveFailures),
          averageLatencyMs: number(record.averageLatencyMs),
          lastSuccessAt: typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : null,
          lastFailureAt: typeof record.lastFailureAt === "string" ? record.lastFailureAt : null,
        } satisfies SourceReliabilityRecord]];
      }),
    );
  } catch {
    return {};
  }
}

export function updateSourceReliability(
  records: SourceReliabilityMap,
  kind: SourceKind,
  sourceId: string,
  succeeded: boolean,
  latencyMs: number,
  now = new Date(),
): SourceReliabilityMap {
  const key = sourceReliabilityKey(kind, sourceId);
  const current = records[key] ?? {
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    averageLatencyMs: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
  const measuredLatency = Number.isFinite(latencyMs) ? Math.max(0, latencyMs) : 0;
  const averageLatencyMs = current.averageLatencyMs > 0 ? Math.round(current.averageLatencyMs * .7 + measuredLatency * .3) : Math.round(measuredLatency);
  return {
    ...records,
    [key]: succeeded
      ? { ...current, successes: Math.min(100, current.successes + 1), consecutiveFailures: 0, averageLatencyMs, lastSuccessAt: now.toISOString() }
      : { ...current, failures: Math.min(100, current.failures + 1), consecutiveFailures: Math.min(10, current.consecutiveFailures + 1), averageLatencyMs, lastFailureAt: now.toISOString() },
  };
}

export function rankSourcesByReliability<T extends { id: string }>(
  sources: T[],
  kind: SourceKind,
  preferredSourceId = "",
  records = readSourceReliability(),
): T[] {
  const preferred = sources.find((source) => source.id === preferredSourceId);
  const remaining = sources.filter((source) => source.id !== preferredSourceId).sort((left, right) => reliabilityScore(records[sourceReliabilityKey(kind, right.id)]) - reliabilityScore(records[sourceReliabilityKey(kind, left.id)]));
  return preferred ? [preferred, ...remaining] : remaining;
}

export function dedupeSourceResults<T extends { title: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeTitle(item.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function recordSourceResult(kind: SourceKind, sourceId: string, succeeded: boolean, latencyMs: number) {
  if (typeof window === "undefined") return;
  try {
    const next = updateSourceReliability(parseSourceReliability(window.localStorage.getItem(SOURCE_RELIABILITY_STORAGE_KEY)), kind, sourceId, succeeded, latencyMs);
    window.localStorage.setItem(SOURCE_RELIABILITY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Source access remains available when preference storage is blocked. */
  }
}

function readSourceReliability(): SourceReliabilityMap {
  if (typeof window === "undefined") return {};
  try {
    return parseSourceReliability(window.localStorage.getItem(SOURCE_RELIABILITY_STORAGE_KEY));
  } catch {
    return {};
  }
}

function reliabilityScore(record?: SourceReliabilityRecord): number {
  if (!record) return 0;
  const attempts = record.successes + record.failures;
  const successRate = attempts ? record.successes / attempts : 0;
  const latencyPenalty = Math.min(20, record.averageLatencyMs / 500);
  return successRate * 50 - record.consecutiveFailures * 25 - latencyPenalty;
}
