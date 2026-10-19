"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronDown, CircleHelp, RefreshCw, Settings } from "lucide-react";
import { OPEN_BETA_ONBOARDING_EVENT } from "../lib/onboarding";

export type BridgeReadiness = { online: boolean; animeCount: number | null; mangaCount: number | null; latencyMs: number | null };

export function HomeSourceStatus({ readiness, connecting, scope, onRetry }: { readiness: BridgeReadiness; connecting: boolean; scope: "personal" | "beta"; onRetry: () => void }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { setTarget(document.getElementById("home-source-status")); }, []);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (!target) return null;
  const label = connecting ? "Connecting sources" : readiness.online ? "Sources online" : "Sources offline";
  return createPortal(
    <div className={`home-source-status ${readiness.online ? "online" : "offline"} ${connecting ? "connecting" : ""}`} ref={root}>
      <button ref={button} className="home-source-status-trigger" aria-label={label} aria-expanded={open} aria-controls="home-source-details" onClick={() => setOpen(!open)}>
        <i aria-hidden="true" /><span role="status">{label}</span><ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && <div id="home-source-details" className="home-source-details" role="region" aria-label="Source connection details">
        <strong>{scope === "beta" ? "Shared Beta Bridge" : "Personal Bridge"}</strong>
        <p>{readiness.online ? "Your connected sources are ready to browse." : "Reconnect your Bridge to browse sources."}</p>
        <dl><div><dt>Anime sources</dt><dd>{readiness.animeCount ?? "Unavailable"}</dd></div><div><dt>Manga sources</dt><dd>{readiness.mangaCount ?? "Unavailable"}</dd></div>{readiness.latencyMs !== null && <div><dt>Response time</dt><dd>{readiness.latencyMs} ms</dd></div>}</dl>
        <Link href="/settings" onClick={() => setOpen(false)}><Settings /> Manage sources</Link>
        <button disabled={connecting} onClick={() => { setOpen(false); onRetry(); }}><RefreshCw /> Reconnect sources</button>
        <button onClick={() => { setOpen(false); window.dispatchEvent(new Event(OPEN_BETA_ONBOARDING_EVENT)); }}><CircleHelp /> Beta guide</button>
      </div>}
    </div>, target,
  );
}
