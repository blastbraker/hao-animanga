// Keep the native audio element (including Safari/Media Session support), but
// play several PCM passages as ONE file so paragraph boundaries never reload it.
export const NARRATION_BATCH_SIZE = 4;
const LOOKAHEAD_BATCHES = 2;

export type NarrationBoundary = {
  index: number;
  start: number;
  duration: number;
};
export type NarrationBatch = {
  startIndex: number;
  endIndex: number;
  url: string;
  duration: number;
  boundaries: NarrationBoundary[];
};

export function narrationBatchStart(index: number): number {
  return Math.floor(index / NARRATION_BATCH_SIZE) * NARRATION_BATCH_SIZE;
}

export function passageAtTime(
  batch: Pick<NarrationBatch, "boundaries">,
  time: number,
): NarrationBoundary {
  for (let index = batch.boundaries.length - 1; index >= 0; index--) {
    if (time >= batch.boundaries[index]!.start) return batch.boundaries[index]!;
  }
  return batch.boundaries[0]!;
}

export function joinNarrationWaves(waves: ArrayBuffer[], startIndex: number) {
  if (!waves.length || waves.length > NARRATION_BATCH_SIZE)
    throw new Error("Invalid narration buffer size");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const boundaries: NarrationBoundary[] = [];
  let size = 0;
  for (const [offset, wave] of waves.entries()) {
    const data = new DataView(wave);
    const tag = (position: number, expected: string) =>
      [...expected].every(
        (char, i) => data.getUint8(position + i) === char.charCodeAt(0),
      );
    if (
      wave.byteLength < 46 ||
      wave.byteLength > 6_000_000 ||
      !tag(0, "RIFF") ||
      !tag(8, "WAVEfmt ") ||
      !tag(36, "data") ||
      data.getUint32(4, true) !== wave.byteLength - 8 ||
      data.getUint32(16, true) !== 16 ||
      data.getUint16(20, true) !== 1 ||
      data.getUint16(22, true) !== 1 ||
      data.getUint32(24, true) !== 24000 ||
      data.getUint32(28, true) !== 48000 ||
      data.getUint16(32, true) !== 2 ||
      data.getUint16(34, true) !== 16 ||
      data.getUint32(40, true) !== wave.byteLength - 44 ||
      (wave.byteLength - 44) % 2 !== 0
    ) {
      throw new Error(
        "The Bridge returned an unsupported narration audio format.",
      );
    }
    const pcm = new Uint8Array(wave, 44);
    boundaries.push({
      index: startIndex + offset,
      start: size / 48000,
      duration: pcm.byteLength / 48000,
    });
    chunks.push(pcm);
    size += pcm.byteLength;
  }
  const header = waves[0]!.slice(0, 44);
  const view = new DataView(header);
  view.setUint32(4, size + 36, true);
  view.setUint32(40, size, true);
  return {
    blob: new Blob([header, ...chunks], { type: "audio/wav" }),
    boundaries,
    duration: size / 48000,
  };
}

type Task = {
  index: number;
  resolve: (wave: ArrayBuffer) => void;
  reject: (error: unknown) => void;
};
type FetchAudio = (index: number, signal: AbortSignal) => Promise<Blob>;
const cancelled = () =>
  new DOMException("Narration request cancelled", "AbortError");

/** One generation request at a time, foreground seeks before background work. */
export class NarrationBuffer {
  private readonly controller = new AbortController();
  private readonly batches = new Map<number, NarrationBatch>();
  private readonly pending = new Map<number, Promise<NarrationBatch>>();
  private readonly queue: Task[] = [];
  private running = false;
  private focus = 0;
  private disposed = false;

  constructor(
    private readonly count: number,
    private readonly fetchAudio: FetchAudio,
    private readonly onPrepared: (passages: number) => void = () => {},
    private readonly urls = {
      create: (blob: Blob) => URL.createObjectURL(blob),
      revoke: (url: string) => URL.revokeObjectURL(url),
    },
  ) {}

  async get(index: number): Promise<NarrationBatch> {
    if (this.disposed) throw cancelled();
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new Error("Invalid narration passage");
    this.focus = narrationBatchStart(index);
    this.prune();
    const focus = this.focus;
    try {
      return await this.prepare(focus);
    } catch (error) {
      // A quick seek away and back can encounter a cancelled old preparation.
      if (
        !this.disposed &&
        this.focus === focus &&
        error instanceof DOMException &&
        error.name === "AbortError"
      )
        return this.prepare(focus);
      throw error;
    }
  }

  prefetch(): void {
    const focus = this.focus;
    // Fill the nearest group first; never send competing requests to Kokoro.
    void (async () => {
      for (let offset = 1; offset <= LOOKAHEAD_BATCHES; offset++) {
        const start = focus + NARRATION_BATCH_SIZE * offset;
        if (this.disposed || focus !== this.focus || start >= this.count)
          return;
        await this.prepare(start);
      }
    })().catch(() => {
      /* A foreground request will retry a failed prefetch. */
    });
  }

  private wanted(start: number) {
    return (
      !this.disposed &&
      start >= this.focus &&
      start <= this.focus + LOOKAHEAD_BATCHES * NARRATION_BATCH_SIZE
    );
  }

  private prepare(start: number): Promise<NarrationBatch> {
    const cached = this.batches.get(start);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(start);
    if (existing) return existing;
    const promise = (async () => {
      const waves: ArrayBuffer[] = [];
      const end = Math.min(this.count, start + NARRATION_BATCH_SIZE);
      for (let index = start; index < end; index++) {
        if (!this.wanted(start)) throw cancelled();
        waves.push(
          await new Promise<ArrayBuffer>((resolve, reject) => {
            this.queue.push({ index, resolve, reject });
            void this.pump();
          }),
        );
      }
      if (!this.wanted(start)) throw cancelled();
      const audio = joinNarrationWaves(waves, start);
      const batch = {
        startIndex: start,
        endIndex: end,
        boundaries: audio.boundaries,
        duration: audio.duration,
        url: this.urls.create(audio.blob),
      };
      this.batches.set(start, batch);
      this.prune();
      return batch;
    })().finally(() => this.pending.delete(start));
    this.pending.set(start, promise);
    return promise;
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        this.queue.sort(
          (a, b) =>
            Math.abs(a.index - this.focus) - Math.abs(b.index - this.focus),
        );
        const task = this.queue.shift()!;
        if (!this.wanted(narrationBatchStart(task.index))) {
          task.reject(cancelled());
          continue;
        }
        try {
          const blob = await this.fetchAudio(
            task.index,
            this.controller.signal,
          );
          if (this.disposed) throw cancelled();
          task.resolve(await blob.arrayBuffer());
        } catch (error) {
          task.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private prune() {
    for (const [start, batch] of this.batches) {
      if (
        start < this.focus - NARRATION_BATCH_SIZE ||
        start > this.focus + LOOKAHEAD_BATCHES * NARRATION_BATCH_SIZE
      ) {
        this.urls.revoke(batch.url);
        this.batches.delete(start);
      }
    }
    if (!this.disposed)
      this.onPrepared(
        [...this.batches.values()]
          .filter((batch) => batch.startIndex > this.focus)
          .reduce(
            (count, batch) => count + batch.endIndex - batch.startIndex,
            0,
          ),
      );
  }

  dispose() {
    this.disposed = true;
    this.controller.abort();
    for (const task of this.queue.splice(0)) task.reject(cancelled());
    for (const batch of this.batches.values()) this.urls.revoke(batch.url);
    this.batches.clear();
  }
}
