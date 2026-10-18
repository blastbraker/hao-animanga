import { afterEach, describe, expect, it, vi } from "vitest";
import { orderedSourceProbes, playbackRequest, PlaybackProgressWriter } from "./playback-loading";
import { PLAYBACK_HLS_CONFIG } from "./hls-recovery";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => vi.useRealTimers());

describe("bounded source loading", () => {
  it("times out an unresponsive source and aborts its network request", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const request = playbackRequest((value) => { signal = value; return new Promise(() => {}); }, undefined, 500);
    const result = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(500); await result;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels without starting work if the lookup is already obsolete", async () => {
    const controller = new AbortController(); controller.abort();
    const load = vi.fn();
    await expect(playbackRequest(load, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(load).not.toHaveBeenCalled();
  });
  it("cleans up a successful request's timeout", async () => {
    vi.useFakeTimers();
    await expect(playbackRequest(async () => [1])).resolves.toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("prepares only one alternative and honors source order even if it finishes first", async () => {
    const first = deferred<string>();
    const signals: AbortSignal[] = [];
    const prepare = vi.fn((source: string, signal: AbortSignal) => { signals.push(signal); return source === "preferred" ? first.promise : Promise.resolve(source); });
    const probes = orderedSourceProbes(["preferred", "backup", "untouched"], prepare);
    const result = probes.next();
    await Promise.resolve(); await Promise.resolve();
    expect(prepare.mock.calls.map(([source]) => source)).toEqual(["preferred", "backup"]);
    first.resolve("first");
    expect((await result).value).toMatchObject({ item: "preferred", result: { status: "fulfilled", value: "first" } });
    await probes.return();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
  });
  it("advances past a failed source, with prepared results ready for fallback", async () => {
    const probes = orderedSourceProbes([1, 2, 3], async (item) => { if (item === 1) throw new Error("offline"); return item; });
    expect((await probes.next()).value?.result.status).toBe("rejected");
    expect((await probes.next()).value).toMatchObject({ item: 2, result: { value: 2 } });
    await probes.return();
  });
});

describe("non-blocking ordered progress", () => {
  it("coalesces pending positions and sends new-episode progress after the old episode", async () => {
    const first = deferred<void>();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const writer = new PlaybackProgressWriter<number>(write);
    const a = writer.save("work", 1);
    const b = writer.save("work", 2);
    const c = writer.save("work", 3);
    expect(write.mock.calls).toEqual([[1]]);
    first.resolve(); await Promise.all([a, b, c]);
    expect(write.mock.calls).toEqual([[1], [3]]);
  });
  it("continues after a failed sync", async () => {
    const first = deferred<void>();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const writer = new PlaybackProgressWriter<number>(write);
    const a = writer.save("work", 1).catch(() => "failed");
    const b = writer.save("work", 2);
    first.reject(new Error("offline"));
    expect(await a).toBe("failed"); await b;
    expect(write.mock.calls).toEqual([[1], [2]]);
  });
  it("does not send queued account data after the player is unmounted", async () => {
    const first = deferred<void>();
    const write = vi.fn(() => first.promise);
    const writer = new PlaybackProgressWriter<number>(write);
    const a = writer.save("work", 1);
    const b = writer.save("work", 2).catch(() => "cancelled");
    writer.dispose(); first.resolve(); await a;
    expect(await b).toBe("cancelled");
    expect(write).toHaveBeenCalledOnce();
  });
  it("uses a finite back buffer and longer forward cushion", () => {
    expect(PLAYBACK_HLS_CONFIG.maxBufferLength).toBe(60);
    expect(PLAYBACK_HLS_CONFIG.maxMaxBufferLength).toBe(120);
    expect(PLAYBACK_HLS_CONFIG.backBufferLength).toBe(30);
    expect(PLAYBACK_HLS_CONFIG.maxBufferSize).toBeLessThanOrEqual(60_000_000);
  });
});
