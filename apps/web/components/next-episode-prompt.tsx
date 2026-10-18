import { Play, X } from "lucide-react";
import { episodeDisplayLabel, type EpisodeLike } from "../lib/episode-title";

type Props = {
  episode: EpisodeLike;
  countdown: number;
  autoplay: boolean;
  playing: boolean;
  buffering: boolean;
  onPlay: () => void;
  onDismiss: () => void;
};

export function NextEpisodePrompt({ episode, countdown, autoplay, playing, buffering, onPlay, onDismiss }: Props) {
  const status = !autoplay ? "Autoplay is off" : countdown === 0 ? "Episode finished" : buffering ? "Waiting for playback" : !playing ? "Countdown paused" : `Starting in ${countdown}s`;

  return (
    <section className="next-episode-prompt" aria-label="Next episode">
      <div className="next-episode-heading">
        <span>UP NEXT</span>
        <span className="next-episode-countdown" role="timer" aria-live="off">{status}</span>
        <button className="next-episode-dismiss" aria-label="Dismiss next episode and cancel autoplay for this episode" onClick={onDismiss}><X aria-hidden="true" /></button>
      </div>
      <strong title={episodeDisplayLabel(episode)}>{episodeDisplayLabel(episode)}</strong>
      <span className="next-episode-announcement" role="status">{autoplay ? "The next episode will play when this episode ends." : "The next episode is ready. Autoplay is off."}</span>
      <div className="next-episode-actions">
        <button className="next-episode-play" onClick={onPlay}><Play aria-hidden="true" fill="currentColor" />Play now</button>
        <button className="next-episode-stay" onClick={onDismiss}>Not now</button>
      </div>
    </section>
  );
}
