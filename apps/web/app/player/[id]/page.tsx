"use client";

import { useRef, useState } from "react";
import { Captions, Maximize, Pause, Play, Settings, Volume2 } from "lucide-react";

export default function PlayerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackMessage, setPlaybackMessage] = useState("");

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (!video.currentSrc) {
      setPlaybackMessage("Connect Jellyfin or add an authorized media URL before playing.");
      return;
    }

    setPlaybackMessage("");
    if (!video.paused) {
      video.pause();
      return;
    }

    try {
      await video.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPlaybackMessage(error instanceof Error ? error.message : "Playback could not start.");
    }
  }

  return <div className="player-page">
    <div className="video-stage">
      <video
        ref={videoRef}
        poster="https://s4.anilist.co/file/anilistcdn/media/anime/banner/21827-3EwjBS6ebj1C.jpg"
        onClick={() => void togglePlayback()}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button className="center-play" aria-label={playing ? "Pause" : "Play"} onClick={() => void togglePlayback()}>
        {playing ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}
      </button>
      <div className="player-controls">
        <button aria-label={playing ? "Pause" : "Play"} onClick={() => void togglePlayback()}>{playing ? <Pause/> : <Play/>}</button>
        <Volume2/><span>00:00</span><div className="video-track"><i/></div><span>24:00</span><Captions/><Settings/><Maximize/>
      </div>
    </div>
    <div className="now-playing">
      <div>
        <span className="eyebrow">NOW PLAYING · PERSONAL MEDIA</span>
        <h1>Sample episode</h1>
        <p>Connect Jellyfin or add an authorized HLS/MP4 URL to begin playback.</p>
        {playbackMessage && <p role="status">{playbackMessage}</p>}
      </div>
      <select aria-label="Episode"><option>Episode 1</option></select>
    </div>
  </div>;
}
