import { bridgeFetch } from "./api";

export type NarrationManifest = {
  id: string;
  fingerprint: string;
  title: string;
  passages: string[];
};
export type NarrationVoice = { id: string; name: string; language: string };
export type ListeningPosition = {
  chapterId: string;
  fingerprint: string;
  index: number;
  seconds: number;
  voice: string;
  rate: number;
};

export function restoreListeningPosition(
  value: Record<string, unknown> | undefined,
  chapterId: string,
  manifest: NarrationManifest,
  voices: NarrationVoice[],
): ListeningPosition {
  const matches =
    value?.chapterId === chapterId &&
    value.fingerprint === manifest.fingerprint;
  return {
    chapterId,
    fingerprint: manifest.fingerprint,
    index:
      matches && typeof value.index === "number" && Number.isFinite(value.index)
        ? Math.max(
            0,
            Math.min(manifest.passages.length - 1, Math.floor(value.index)),
          )
        : 0,
    seconds:
      matches &&
      typeof value.seconds === "number" &&
      Number.isFinite(value.seconds)
        ? Math.max(0, Math.min(120, value.seconds))
        : 0,
    voice: voices.find((voice) => voice.id === value?.voice)?.id ?? "af_heart",
    rate:
      typeof value?.rate === "number" && Number.isFinite(value.rate)
        ? Math.max(0.5, Math.min(2, value.rate))
        : 1,
  };
}

export async function narrationRequest(
  endpoint: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await bridgeFetch(endpoint, path, init);
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      detail?.message ||
        (response.status === 404
          ? "This Bridge needs the Kokoro update. Ask its owner to update and restart it."
          : "Kokoro is unavailable. Check your Bridge connection and retry."),
    );
  }
  return response;
}

export async function fetchNarrationAudio(
  endpoint: string,
  manifestId: string,
  index: number,
  voice: string,
  signal: AbortSignal,
): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    const response = await bridgeFetch(endpoint, "/v1/narration/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifestId, index, voice }),
      signal,
    });
    if (response.status === 429 && attempt < 20) {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", aborted);
          resolve();
        }, 3000);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
      });
      continue;
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ??
          "Kokoro could not prepare this passage. Retry in a moment.",
      );
    }
    const blob = await response.blob();
    if (
      !blob.type.includes("audio/") ||
      blob.size < 44 ||
      blob.size > 6_000_000
    )
      throw new Error("The Bridge returned invalid narration audio.");
    return blob;
  }
}
