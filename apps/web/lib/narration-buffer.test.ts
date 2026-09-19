import { describe, expect, it, vi } from "vitest";
import {
  joinNarrationWaves,
  NarrationBuffer,
  passageAtTime,
} from "./narration-buffer";

function wave(seconds = 1, sample = 42): ArrayBuffer {
  const result = new ArrayBuffer(44 + seconds * 48000);
  const view = new DataView(result);
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WAVEfmt "],
    [36, "data"],
  ] as const)
    [...text].forEach((char, i) =>
      view.setUint8(offset + i, char.charCodeAt(0)),
    );
  view.setUint32(4, result.byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, result.byteLength - 44, true);
  for (let offset = 44; offset < result.byteLength; offset += 2)
    view.setInt16(offset, sample, true);
  return result;
}
const urls = () => ({
  create: vi.fn(() => `blob:${Math.random()}`),
  revoke: vi.fn(),
});

describe("continuous narration audio", () => {
  it("joins PCM samples without inserting silence or WAV headers between paragraphs", async () => {
    const joined = joinNarrationWaves(
      [wave(1, 11), wave(2, 22), wave(1, 33)],
      4,
    );
    const result = new DataView(await joined.blob.arrayBuffer());
    expect(joined.duration).toBe(4);
    expect(joined.boundaries).toEqual([
      { index: 4, start: 0, duration: 1 },
      { index: 5, start: 1, duration: 2 },
      { index: 6, start: 3, duration: 1 },
    ]);
    expect(result.byteLength).toBe(44 + 4 * 48000);
    expect(result.getInt16(44 + 48000 - 2, true)).toBe(11);
    expect(result.getInt16(44 + 48000, true)).toBe(22);
    expect(result.getInt16(44 + 3 * 48000, true)).toBe(33);
    expect(result.getUint32(40, true)).toBe(4 * 48000);
    expect(passageAtTime(joined, 0.5).index).toBe(4);
    expect(passageAtTime(joined, 1).index).toBe(5);
    expect(passageAtTime(joined, 4).index).toBe(6);
  });

  it("rejects malformed, truncated, and non-PCM audio", () => {
    expect(() => joinNarrationWaves([], 0)).toThrow();
    expect(() => joinNarrationWaves([new ArrayBuffer(5)], 0)).toThrow();
    const invalid = wave();
    new DataView(invalid).setUint16(20, 3, true);
    expect(() => joinNarrationWaves([invalid], 0)).toThrow();
    expect(() => joinNarrationWaves([wave().slice(0, 100)], 0)).toThrow();
  });
});

describe("rolling Kokoro buffer", () => {
  it("prepares eight passages ahead sequentially, then replenishes as playback advances", async () => {
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return new Blob([wave()]);
    });
    const prepared = vi.fn();
    const resources = urls();
    const buffer = new NarrationBuffer(20, fetch, prepared, resources);
    const first = await buffer.get(0);
    expect(first.endIndex).toBe(4);
    buffer.prefetch();
    await vi.waitFor(() => expect(prepared).toHaveBeenLastCalledWith(8));
    expect(fetch).toHaveBeenCalledTimes(12);
    expect(peak).toBe(1);
    const next = await buffer.get(4);
    expect(next.startIndex).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(12);
    buffer.prefetch();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(16));
    await buffer.get(12);
    expect(resources.revoke).toHaveBeenCalledWith(first.url);
    buffer.dispose();
    expect(resources.revoke.mock.calls.length).toBe(
      resources.create.mock.calls.length,
    );
  });

  it("shares requests within a group and handles the short final group", async () => {
    const fetch = vi.fn(async () => new Blob([wave()]));
    const buffer = new NarrationBuffer(6, fetch, () => {}, urls());
    const [one, two] = await Promise.all([buffer.get(0), buffer.get(2)]);
    expect(one).toBe(two);
    expect(fetch).toHaveBeenCalledTimes(4);
    const last = await buffer.get(5);
    expect(last.boundaries.map((part) => part.index)).toEqual([4, 5]);
    expect(last.duration).toBe(2);
    buffer.dispose();
  });

  it("prioritizes a new seek and abandons obsolete background work", async () => {
    const releases: Array<() => void> = [];
    const fetch = vi.fn(
      (_index: number) =>
        new Promise<Blob>((resolve) =>
          releases.push(() => resolve(new Blob([wave()]))),
        ),
    );
    const buffer = new NarrationBuffer(40, fetch, () => {}, urls());
    const old = buffer.get(0).catch((error) => error.name);
    const current = buffer.get(20);
    releases.shift()!();
    await vi.waitFor(() =>
      expect(fetch.mock.calls.map(([index]) => index)).toEqual([0, 20]),
    );
    for (let i = 0; i < 4; i++) {
      releases.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      if (i < 3) await vi.waitFor(() => expect(releases.length).toBe(1));
    }
    expect(await old).toBe("AbortError");
    expect((await current).startIndex).toBe(20);
    expect(fetch.mock.calls.map(([index]) => index)).toEqual([
      0, 20, 21, 22, 23,
    ]);
    buffer.dispose();
  });

  it("can retry a failed group, and aborts outstanding work on voice change or close", async () => {
    const fetch = vi
      .fn(async () => new Blob([wave()]))
      .mockRejectedValueOnce(new Error("offline"));
    const buffer = new NarrationBuffer(8, fetch, () => {}, urls());
    await expect(buffer.get(0)).rejects.toThrow("offline");
    await expect(buffer.get(0)).resolves.toMatchObject({ startIndex: 0 });
    buffer.dispose();
    await expect(buffer.get(4)).rejects.toMatchObject({ name: "AbortError" });
    let signal: AbortSignal | undefined;
    const pending = new NarrationBuffer(
      4,
      (_index, nextSignal) =>
        new Promise((_resolve, reject) => {
          signal = nextSignal;
          signal.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          );
        }),
      () => {},
      urls(),
    );
    const result = pending.get(0);
    pending.dispose();
    expect(signal?.aborted).toBe(true);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
