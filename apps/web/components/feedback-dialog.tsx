"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, MessageSquarePlus, Send, X } from "lucide-react";
import { api } from "../lib/api";

type FeedbackCategory = "bug" | "idea" | "content" | "account" | "other";

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function show() {
    setError("");
    setSaved(false);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const detail = message.trim();
    if (detail.length < 5) { setError("Tell us a little more so we can investigate."); return; }
    setBusy(true);
    setError("");
    try {
      await api("/feedback", {
        method: "POST",
        body: JSON.stringify({ category, message: detail, pageUrl: `${window.location.pathname}${window.location.search}` }),
      });
      setSaved(true);
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Feedback could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="feedback-launcher" onClick={show} aria-label="Send feedback"><MessageSquarePlus/><span>Feedback</span></button>
    {open && <div className="feedback-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <header><div><span className="eyebrow">PRIVATE BETA FEEDBACK</span><h2 id="feedback-title">Tell us what happened.</h2></div><button aria-label="Close feedback" onClick={() => setOpen(false)}><X/></button></header>
        {saved ? <div className="feedback-success"><CheckCircle2/><h3>Feedback received</h3><p>It is now visible in the HAO admin inbox with the page where you sent it.</p><button className="button primary" onClick={() => setOpen(false)}>Done</button></div> : <form onSubmit={submit}>
          <label>Type<select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}><option value="bug">Something is broken</option><option value="idea">Feature idea</option><option value="content">Title or source issue</option><option value="account">Account or access</option><option value="other">Other feedback</option></select></label>
          <label>What should we know?<textarea ref={textareaRef} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={6} placeholder="What were you trying to do, and what happened instead?"/></label>
          <small>The current page is included automatically. Do not include passwords, tokens, or private provider credentials.</small>
          {error && <p className="feedback-error" role="alert">{error}</p>}
          <button className="button primary" disabled={busy || message.trim().length < 5}><Send/>{busy ? "Sending..." : "Send feedback"}</button>
        </form>}
      </section>
    </div>}
  </>;
}
