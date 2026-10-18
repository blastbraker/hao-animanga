/** Bound dead source requests, and cancel speculative lookups after a winner. */
export async function playbackRequest<T>(load: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (parent?.aborted) controller.abort();
  parent?.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException(parent?.aborted ? "Playback lookup cancelled" : "The source took too long to respond. Try another server.", "AbortError"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    timer = setTimeout(cancel, timeoutMs);
    return await Promise.race([aborted, controller.signal.aborted ? aborted : load(controller.signal)]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

/** Prepare only the current source and one alternative; preserve preference order. */
export async function* orderedSourceProbes<T, R>(items: T[], prepare: (item: T, signal: AbortSignal) => Promise<R>) {
  const controller = new AbortController();
  const pending = new Map<number, Promise<PromiseSettledResult<R>>>();
  const start = (index: number) => {
    if (index >= items.length || pending.has(index)) return;
    pending.set(index, Promise.resolve().then(() => prepare(items[index]!, controller.signal)).then(
      (value): PromiseSettledResult<R> => ({ status: "fulfilled", value }),
      (reason): PromiseSettledResult<R> => ({ status: "rejected", reason }),
    ));
  };
  try {
    for (let index = 0; index < items.length; index += 1) {
      start(index);
      start(index + 1);
      const result = await pending.get(index)!;
      pending.delete(index);
      yield { item: items[index]!, index, result };
    }
  } finally {
    controller.abort();
    pending.clear();
  }
}

/** Ordered, coalesced cloud writes; local saving/navigation never waits on these. */
export class PlaybackProgressWriter<T> {
  private jobs = new Map<string, { pending?: { value: T; waiters: { resolve: () => void; reject: (cause: unknown) => void }[] }; running: boolean }>();
  private disposed = false;
  constructor(private readonly write: (value: T) => Promise<unknown>) {}

  save(key: string, value: T): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Player closed"));
    let job = this.jobs.get(key);
    if (!job) { job = { running: false }; this.jobs.set(key, job); }
    const current = job;
    const saved = new Promise<void>((resolve, reject) => {
      current.pending = { value, waiters: [...(current.pending?.waiters ?? []), { resolve, reject }] };
    });
    if (!current.running) void this.drain(key, current);
    return saved;
  }

  private async drain(key: string, job: NonNullable<ReturnType<typeof this.jobs.get>>) {
    job.running = true;
    while (job.pending && !this.disposed) {
      const next = job.pending;
      delete job.pending;
      try { await this.write(next.value); next.waiters.forEach((waiter) => waiter.resolve()); }
      catch (cause) { next.waiters.forEach((waiter) => waiter.reject(cause)); }
    }
    this.jobs.delete(key);
  }

  dispose() {
    this.disposed = true;
    for (const job of this.jobs.values()) {
      job.pending?.waiters.forEach((waiter) => waiter.reject(new Error("Player closed")));
      delete job.pending;
    }
  }
}
