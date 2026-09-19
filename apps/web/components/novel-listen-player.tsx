"use client";

import { useEffect, useRef, useState } from "react";
import "./novel-listen-player.css";
import {
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import {
  getCloudReadingState,
  saveCloudReadingState,
} from "../lib/cloud-reading";
import {
  fetchNarrationAudio,
  narrationRequest,
  restoreListeningPosition,
  type ListeningPosition,
  type NarrationManifest,
  type NarrationVoice,
} from "../lib/narration";
import {
  NarrationBuffer,
  NARRATION_BATCH_SIZE,
  narrationBatchStart,
  passageAtTime,
  type NarrationBatch,
} from "../lib/narration-buffer";

function timestamp(value: number) {
  return `${Math.floor(value / 60)}:${Math.floor(value % 60)
    .toString()
    .padStart(2, "0")}`;
}

export function NovelListenPlayer({
  endpoint,
  chapterId,
  novelKey,
  title,
  onClose,
  onFinished,
  hasNext,
  autoNext,
  onAutoNext,
  sleep,
  sleepUntil,
  onSleep,
}: {
  endpoint: string;
  chapterId: string;
  novelKey: string;
  title: string;
  onClose: () => void;
  onFinished: (advance: boolean) => void;
  hasNext: boolean;
  autoNext: boolean;
  onAutoNext: (value: boolean) => void;
  sleep: number;
  sleepUntil: number;
  onSleep: (minutes: number) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [manifest, setManifest] = useState<NarrationManifest | null>(null);
  const [voices, setVoices] = useState<NarrationVoice[]>([]);
  const [voice, setVoice] = useState("af_heart");
  const [rate, setRate] = useState(1);
  const [index, setIndex] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState<NarrationBuffer | null>(null);
  const [prepared, setPrepared] = useState(0);
  const activeBatch = useRef<NarrationBatch | null>(null);
  const targetIndex = useRef(0);
  const [retry, setRetry] = useState(0);
  const wantsPlay = useRef(true);
  const resumeSeconds = useRef(0);
  const savedAt = useRef(0);
  const position = useRef<ListeningPosition | null>(null);
  const contentKey = `narration:${novelKey}`;
  const save = useRef(() => {});

  save.current = () => {
    const state = position.current;
    if (!state || !manifest) return;
    void saveCloudReadingState({
      contentKey,
      mediaKind: "NOVEL",
      workId: null,
      title,
      releaseLabel: manifest.title,
      positionPercent: Math.min(
        100,
        (100 * (state.index + (duration ? state.seconds / duration : 0))) /
          manifest.passages.length,
      ),
      completed:
        state.index === manifest.passages.length - 1 &&
        duration > 0 &&
        state.seconds >= duration - 0.2,
      state: { ...state },
    }).catch(() => undefined);
  };

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const status = (await (
          await narrationRequest(endpoint, "/v1/narration/status", {
            signal: controller.signal,
          })
        ).json()) as {
          available: boolean;
          message: string;
          voices: NarrationVoice[];
        };
        if (!status.available) throw new Error(status.message);
        const [data, saved] = await Promise.all([
          narrationRequest(
            endpoint,
            `/v1/novel/chapters/${encodeURIComponent(chapterId)}/narration`,
            { method: "POST", signal: controller.signal },
          ).then((response) => response.json() as Promise<NarrationManifest>),
          getCloudReadingState(contentKey).catch(() => null),
        ]);
        if (controller.signal.aborted) return;
        if (!data.passages?.length || !status.voices?.length)
          throw new Error("This chapter has no text available for Kokoro.");
        const restored = restoreListeningPosition(
          saved?.state,
          chapterId,
          data,
          status.voices,
        );
        position.current = restored;
        resumeSeconds.current = restored.seconds;
        targetIndex.current = restored.index;
        setIndex(restored.index);
        setSeconds(restored.seconds);
        setVoice(restored.voice);
        setRate(restored.rate);
        setVoices(status.voices);
        setManifest(data);
        if (restored.index || restored.seconds)
          setNotice("Resuming your saved listening position.");
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not reach Kokoro on your Bridge.",
          );
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [chapterId, contentKey, endpoint]);

  useEffect(() => {
    if (!manifest) return;
    const next = new NarrationBuffer(
      manifest.passages.length,
      (index, signal) =>
        fetchNarrationAudio(endpoint, manifest.id, index, voice, signal),
      setPrepared,
    );
    setSession(next);
    return () => next.dispose();
  }, [endpoint, manifest, voice]);

  const batchStart = narrationBatchStart(index);
  useEffect(() => {
    if (!session || !manifest) return;
    let cancelled = false;
    const element = audio.current!;
    activeBatch.current = null;
    element.pause();
    element.removeAttribute("src");
    element.load();
    setLoading(true);
    setError("");
    setDuration(0);
    void session
      .get(batchStart)
      .then((batch) => {
        if (cancelled) return;
        activeBatch.current = batch;
        element.src = batch.url;
        element.load();
        // Prepare up to eight more passages while this continuous group plays.
        session.prefetch();
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Audio generation failed.",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      element.pause();
    };
  }, [session, batchStart, retry, manifest]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
    if (position.current)
      position.current = { ...position.current, rate, voice };
  }, [rate, voice]);

  useEffect(() => {
    const element = audio.current;
    const persist = () => save.current();
    window.addEventListener("pagehide", persist);
    return () => {
      persist();
      element?.pause();
      window.removeEventListener("pagehide", persist);
    };
  }, []);

  function pause() {
    wantsPlay.current = false;
    audio.current?.pause();
    setPlaying(false);
    save.current();
  }

  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  const onSleepRef = useRef(onSleep);
  onSleepRef.current = onSleep;
  useEffect(() => {
    if (!sleepUntil) return;
    const timer = window.setTimeout(
      () => {
        pauseRef.current();
        onSleepRef.current(0);
        setNotice("Sleep timer finished.");
      },
      Math.max(0, sleepUntil - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [sleepUntil]);

  async function play() {
    wantsPlay.current = true;
    setNotice("");
    if (!audio.current?.src) return;
    try {
      await audio.current.play();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      wantsPlay.current = false;
      setPlaying(false);
      setNotice("Audio is ready. Tap Play to allow sound in this browser.");
    }
  }

  function move(next: number) {
    if (!manifest || next < 0 || next >= manifest.passages.length) return;
    save.current();
    resumeSeconds.current = 0;
    targetIndex.current = next;
    setSeconds(0);
    setIndex(next);
    position.current = {
      chapterId,
      fingerprint: manifest.fingerprint,
      index: next,
      seconds: 0,
      voice,
      rate,
    };
    const boundary = activeBatch.current?.boundaries.find(
      (part) => part.index === next,
    );
    if (boundary && audio.current) {
      audio.current.currentTime = boundary.start;
      setDuration(boundary.duration);
    }
  }

  function seek(next: number) {
    if (!audio.current || !duration) return;
    const value = Math.max(0, Math.min(duration, next));
    const boundary = activeBatch.current?.boundaries.find(
      (part) => part.index === index,
    );
    if (!boundary) return;
    audio.current.currentTime = boundary.start + value;
    setSeconds(value);
    if (position.current) position.current.seconds = value;
    save.current();
  }

  useEffect(() => {
    if (!("mediaSession" in navigator) || !manifest) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: manifest.title,
      artist: title,
      album: "HAO · Kokoro",
    });
    const handlers: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: () => {
        void play();
      },
      pause,
      seekbackward: () => seek((position.current?.seconds ?? 0) - 15),
      seekforward: () => seek((position.current?.seconds ?? 0) + 15),
      previoustrack: () => move(index - 1),
      nexttrack: () => move(index + 1),
    };
    for (const [action, handler] of Object.entries(handlers))
      try {
        navigator.mediaSession.setActionHandler(
          action as MediaSessionAction,
          handler!,
        );
      } catch {
        /* Browser-specific support. */
      }
    return () => {
      for (const action of Object.keys(handlers))
        try {
          navigator.mediaSession.setActionHandler(
            action as MediaSessionAction,
            null,
          );
        } catch {
          /* Optional API. */
        }
      navigator.mediaSession.metadata = null;
    };
    // The handlers need the current passage and duration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, index, duration, title]);

  useEffect(() => {
    if ("mediaSession" in navigator)
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  return (
    <section
      className="novel-listen-player"
      aria-label="Kokoro audiobook player"
    >
      <header>
        <div>
          <Headphones />
          <span>
            <strong>Listen with Kokoro</strong>
            <small>English AI narration · generated on your Bridge</small>
          </span>
        </div>
        <button onClick={onClose} aria-label="Close audiobook player">
          <X />
        </button>
      </header>
      <audio
        ref={audio}
        playsInline
        preload="auto"
        onLoadedMetadata={() => {
          const element = audio.current!;
          const batch = activeBatch.current;
          if (!batch) return;
          const boundary =
            batch.boundaries.find(
              (part) => part.index === targetIndex.current,
            ) ?? batch.boundaries[0]!;
          setDuration(boundary.duration);
          element.currentTime =
            boundary.start +
            Math.min(
              resumeSeconds.current,
              Math.max(0, boundary.duration - 0.1),
            );
          resumeSeconds.current = 0;
          element.playbackRate = rate;
          setLoading(false);
          if (wantsPlay.current) void play();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const batch = activeBatch.current;
          if (!batch || !audio.current?.readyState) return;
          const elapsed = audio.current.currentTime;
          const boundary = passageAtTime(batch, elapsed);
          const time = Math.min(
            boundary.duration,
            Math.max(0, elapsed - boundary.start),
          );
          setIndex(boundary.index);
          targetIndex.current = boundary.index;
          setDuration(boundary.duration);
          setSeconds(time);
          if (manifest)
            position.current = {
              chapterId,
              fingerprint: manifest.fingerprint,
              index: boundary.index,
              seconds: time,
              voice,
              rate,
            };
          if (Date.now() - savedAt.current > 15_000) {
            savedAt.current = Date.now();
            save.current();
          }
        }}
        onError={() => {
          if (audio.current?.src) {
            setError(
              "This browser could not play the audio. Retry this passage.",
            );
            setLoading(false);
          }
        }}
        onEnded={() => {
          const next = activeBatch.current?.endIndex;
          if (
            manifest &&
            next !== undefined &&
            next < manifest.passages.length
          ) {
            wantsPlay.current = true;
            move(next);
          } else {
            pause();
            setNotice("Chapter finished.");
            onFinished(autoNext && hasNext);
          }
        }}
      />
      {loading && (
        <p className="novel-listen-status" role="status">
          <LoaderCircle className="spin" /> Buffering continuous narration…
          Preparing several passages before playback. First use may take longer.
        </p>
      )}
      {error && (
        <p className="novel-listen-error" role="alert">
          {error}{" "}
          {manifest ? (
            <button onClick={() => setRetry((value) => value + 1)}>
              Retry passage
            </button>
          ) : (
            <span>Close Listen and reopen it after the Bridge is ready.</span>
          )}
        </p>
      )}
      {notice && (
        <p className="novel-listen-status" role="status">
          {notice}
        </p>
      )}
      {manifest && !loading && !error && (
        <p className="novel-listen-status">
          {prepared
            ? `${prepared} passages prepared ahead`
            : batchStart + NARRATION_BATCH_SIZE >= manifest.passages.length
              ? "Final passages ready"
              : "Preparing more audio in the background…"}
        </p>
      )}
      {manifest && (
        <>
          <p className="novel-listen-passage">{manifest.passages[index]}</p>
          <div className="novel-listen-timeline">
            <span>{timestamp(seconds)}</span>
            <input
              aria-label="Position in current passage"
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={Math.min(seconds, duration || 1)}
              disabled={!duration}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span>{timestamp(duration)}</span>
          </div>
          <div className="novel-listen-transport">
            <button
              aria-label="Previous passage"
              disabled={index === 0}
              onClick={() => move(index - 1)}
            >
              <SkipBack />
            </button>
            <button
              aria-label="Rewind 15 seconds"
              disabled={!duration}
              onClick={() => seek(seconds - 15)}
            >
              <RotateCcw />
              <small>15</small>
            </button>
            <button
              className="novel-listen-play"
              aria-label={playing ? "Pause narration" : "Play narration"}
              disabled={loading || !!error}
              onClick={() => (playing ? pause() : void play())}
            >
              {playing ? <Pause /> : <Play />}
            </button>
            <button
              aria-label="Forward 15 seconds"
              disabled={!duration}
              onClick={() => seek(seconds + 15)}
            >
              <RotateCw />
              <small>15</small>
            </button>
            <button
              aria-label="Next passage"
              disabled={index + 1 >= manifest.passages.length}
              onClick={() => move(index + 1)}
            >
              <SkipForward />
            </button>
          </div>
          <div className="novel-listen-options">
            <label>
              Voice
              <select
                aria-label="Voice"
                value={voice}
                onChange={(event) => {
                  pause();
                  resumeSeconds.current = position.current?.seconds ?? 0;
                  setVoice(event.target.value);
                  setNotice(
                    "Voice changed. Your place is kept; press Play when ready.",
                  );
                }}
              >
                {voices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.language}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Speed
              <select
                aria-label="Speed"
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sleep timer
              <select
                aria-label="Sleep timer"
                value={sleep}
                onChange={(event) => onSleep(Number(event.target.value))}
              >
                {[0, 15, 30, 60].map((value) => (
                  <option key={value} value={value}>
                    {value ? `${value} minutes` : "Off"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Passage
              <select
                aria-label="Passage"
                value={index}
                onChange={(event) => move(Number(event.target.value))}
              >
                {manifest.passages.map((_, i) => (
                  <option key={i} value={i}>
                    {i + 1} of {manifest.passages.length}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {hasNext && (
            <label className="novel-listen-autonext">
              <input
                type="checkbox"
                checked={autoNext}
                onChange={(event) => onAutoNext(event.target.checked)}
              />{" "}
              Continue to next chapter
            </label>
          )}
        </>
      )}
    </section>
  );
}
