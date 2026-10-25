import { expect, it } from "vitest";
import { switchAccountCache } from "./account-cache";

it("preserves each account's cached history without exposing it after sign-out or an account switch", () => {
  const data = new Map<string, string>([["hao:anime-continue:v1", "original progress"], ["hao:sidebar-collapsed", "true"]]);
  const storage = { get length() { return data.size; }, clear: () => data.clear(), key: (i: number) => [...data.keys()][i] ?? null, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } } as Storage;
  switchAccountCache("first", storage);
  switchAccountCache(null, storage);
  expect(storage.getItem("hao:anime-continue:v1")).toBeNull();
  switchAccountCache("second", storage);
  expect(storage.getItem("hao:anime-continue:v1")).toBeNull();
  storage.setItem("hao:anime-continue:v1", "second progress");
  switchAccountCache("first", storage);
  expect(storage.getItem("hao:anime-continue:v1")).toBe("original progress");
  expect(storage.getItem("hao:sidebar-collapsed")).toBe("true");
  switchAccountCache("second", storage);
  expect(storage.getItem("hao:anime-continue:v1")).toBe("second progress");
});
