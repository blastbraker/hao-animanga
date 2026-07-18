"use client";

import Link from "next/link";
import { Activity, BookOpen, Compass, Play, ShieldCheck, Shuffle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BETA_ONBOARDING_STORAGE_KEY, hasCompletedBetaOnboarding, OPEN_BETA_ONBOARDING_EVENT } from "../lib/onboarding";

export function BetaOnboarding({ autoOpen }: { autoOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!autoOpen) return;
    try {
      setOpen(!hasCompletedBetaOnboarding(window.localStorage));
    } catch {
      setOpen(true);
    }
  }, [autoOpen]);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_BETA_ONBOARDING_EVENT, show);
    return () => window.removeEventListener(OPEN_BETA_ONBOARDING_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    startButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function dismiss(complete: boolean) {
    if (complete) {
      try {
        window.localStorage.setItem(BETA_ONBOARDING_STORAGE_KEY, "complete");
      } catch {
        /* The tour can still close when browser storage is unavailable. */
      }
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="onboarding-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && dismiss(false)}>
      <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
        <button className="onboarding-close" aria-label="Close beta guide" onClick={() => dismiss(false)}>
          <X />
        </button>
        <img className="brand-mark" src="/brand/hao-logo-64.png" alt="" />
        <span className="eyebrow">WELCOME TO THE PRIVATE BETA</span>
        <h1 id="onboarding-title">Everything is ready. Start with what you love.</h1>
        <p id="onboarding-description">Your approved anime and manga sources are already connected. You do not need to install a Bridge or add repositories.</p>

        <div className="onboarding-grid">
          <article>
            <Compass />
            <div><b>Discover</b><span>Search AniList or browse trending and recently updated titles.</span></div>
          </article>
          <article>
            <Play />
            <div><b>Watch</b><span>Open an anime, choose an episode, and try another server if a stream fails.</span></div>
          </article>
          <article>
            <BookOpen />
            <div><b>Read</b><span>Use webtoon, left-to-right, right-to-left, or double-page layouts and save bookmarks.</span></div>
          </article>
          <article>
            <Shuffle />
            <div><b>Automatic recovery</b><span>HAO ranks source health and tries another installed source when one fails.</span></div>
          </article>
          <article>
            <Activity />
            <div><b>Activity</b><span>Resume from your timeline, enable release alerts, and review source issues.</span></div>
          </article>
        </div>

        <div className="onboarding-note">
          <ShieldCheck />
          <p>Third-party sources are not operated or endorsed by HAO. Use only content you are authorized to access. A source may occasionally be unavailable.</p>
        </div>

        <div className="onboarding-actions">
          <button ref={startButton} className="button primary" onClick={() => dismiss(true)}>Start exploring</button>
          <Link className="button ghost" href="/activity" onClick={() => dismiss(true)}>Open activity</Link>
        </div>
        <small>You can reopen this guide anytime with <b>Beta guide</b> at the top of HAO.</small>
      </section>
    </div>
  );
}
