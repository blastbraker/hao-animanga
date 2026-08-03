import type { ReadingState } from "@hao/domain";
import { api } from "./api";

const STORAGE_KEY = "hao:cloud-reading-v1";

export function parseReadingStates(value: string | null): Record<string, ReadingState> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, state]) => {
        if (!state || typeof state !== "object") return false;
        const item = state as Partial<ReadingState>;
        return typeof item.contentKey === "string" && typeof item.clientUpdatedAt === "string";
      }),
    ) as Record<string, ReadingState>;
  } catch {
    return {};
  }
}

export function newerReadingState(left: ReadingState | undefined, right: ReadingState | undefined): ReadingState | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left.clientUpdatedAt) >= Date.parse(right.clientUpdatedAt) ? left : right;
}

function localStates(): Record<string, ReadingState> {
  if (typeof window === "undefined") return {};
  return parseReadingStates(window.localStorage.getItem(STORAGE_KEY));
}

function store(states: Record<string, ReadingState>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
}

export function localReadingState(contentKey: string): ReadingState | null {
  return localStates()[contentKey] ?? null;
}

export async function saveCloudReadingState(input: Omit<ReadingState, "clientUpdatedAt" | "serverUpdatedAt"> & { clientUpdatedAt?: string }): Promise<ReadingState> {
  const state: ReadingState = { ...input, clientUpdatedAt: input.clientUpdatedAt ?? new Date().toISOString() };
  const states = localStates();
  states[state.contentKey] = newerReadingState(states[state.contentKey], state) ?? state;
  store(states);
  try {
    const saved = await api<ReadingState>("/reading-state", { method: "PUT", body: JSON.stringify(state) });
    states[state.contentKey] = newerReadingState(states[state.contentKey], saved) ?? saved;
    store(states);
    return states[state.contentKey]!;
  } catch {
    return state;
  }
}

export async function syncCloudReadingStates(): Promise<Record<string, ReadingState>> {
  const local = localStates();
  if (navigator.onLine) {
    await Promise.allSettled(Object.values(local).map((state) => api("/reading-state", { method: "PUT", body: JSON.stringify(state) })));
  }
  try {
    const response = await api<{ items: ReadingState[] }>("/reading-state");
    for (const remote of response.items) local[remote.contentKey] = newerReadingState(local[remote.contentKey], remote) ?? remote;
    store(local);
  } catch {
    // Local state remains authoritative until connectivity returns.
  }
  return local;
}

export async function getCloudReadingState(contentKey: string): Promise<ReadingState | null> {
  const states = await syncCloudReadingStates();
  return states[contentKey] ?? null;
}

